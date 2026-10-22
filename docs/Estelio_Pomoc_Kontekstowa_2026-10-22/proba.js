// Pomoc kontekstowa — pilotaż: trzy typy osadzenia, zachowanie klawiatury, nienaruszalność formularza.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s=''; r.on('data',d=>s+=d); r.on('end',()=>{ try { res(JSON.parse(s)); } catch(e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9521','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-pk-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9521/json'); } catch(e){} }
  const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((a,b)=>{ws.onopen=a;ws.onerror=b;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id);} else if(d.method==='Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception||{}).description||'').split('\n')[0]);};
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async e=>{const r=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:e}); return r.result&&r.result.result?r.result.result.value:null;};
  const klawisz=async (key,code,kc)=>{ await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:kc,nativeVirtualKeyCode:kc}); await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:kc,nativeVirtualKeyCode:kc}); };
  const strzal=async n=>{const s=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(OUT+'/'+n, Buffer.from(s.result.data,'base64')); console.log('zrzut',n);};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:B+'/index.html'}); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module'])); localStorage.removeItem('boczki_theme');`);
  await send('Page.reload',{ignoreCache:true}); await sleep(8000);

  console.log('komponent wczytany:', await ev(`!!window.POMOC`));
  console.log('arkusz wczytany:', await ev(`[...document.styleSheets].some(s => (s.href||'').includes('pomoc-kontekstowa.css'))`));
  console.log('katalog tresci:', await ev(`fetch('/pomoc-tresci.json').then(r=>r.ok?r.json():null).then(d=>d?('wersja '+d.wersjaKatalogu+', kontekstow: '+Object.keys(d.konteksty).length):'BRAK')`));

  // ── 1. OSADZENIE W NAGŁÓWKU STRONY: Stan Magazynowy
  await ev(`pokaz('magazyn', null)`); await sleep(2000);
  console.log('\n1) NAGŁÓWEK STRONY — Stan Magazynowy');
  console.log('   przycisk w naglowku:', await ev(`!!document.querySelector('#magazyn .pk-btn')`), '| rozmiar:', await ev(`(function(){const b=document.querySelector('#magazyn .pk-btn'); if(!b) return '-'; const r=b.getBoundingClientRect(); const k=getComputedStyle(b,'::before'); return Math.round(r.width)+'x'+Math.round(r.height)+' (kolo '+k.width+')';})()`));
  console.log('   nazwa dla czytnika:', await ev(`(document.querySelector('#magazyn .pk-btn')||{}).ariaLabel || (document.querySelector('#magazyn .pk-btn')||{}).getAttribute?.('aria-label')`));
  await ev(`document.querySelector('#magazyn .pk-btn').click()`); await sleep(700);
  const k1 = JSON.parse(await ev(`(function(){const k=document.querySelector('.pk-karta'); if(!k) return JSON.stringify({brak:true}); const r=k.getBoundingClientRect(); return JSON.stringify({szer:Math.round(r.width), rola:k.getAttribute('role'), ariaModal:k.getAttribute('aria-modal'), fokusWKarcie:document.activeElement===k, tytul:(k.querySelector('.pk-tytul')||{}).textContent, pozycji:k.querySelectorAll('.pk-lista li').length, link:(k.querySelector('.pk-link')||{}).href, grot:getComputedStyle(document.querySelector('.pk-grot')).display});})()`) || '{}');
  console.log('   chmurka:', JSON.stringify(k1));
  console.log('   aria-expanded przycisku:', await ev(`document.querySelector('#magazyn .pk-btn').getAttribute('aria-expanded')`));
  await strzal('pomoc-01-magazyn.png');

  // Esc zamyka pomoc i wraca fokus na przycisk
  await klawisz('Escape','Escape',27); await sleep(500);
  console.log('   po Esc — chmurka:', await ev(`!!document.querySelector('.pk-karta')`), '| fokus na przycisku:', await ev(`document.activeElement === document.querySelector('#magazyn .pk-btn')`));

  // ── 2. OSADZENIE W FORMULARZU: Nowy Produkt
  await ev(`pokaz('rap_add', null)`); await sleep(1500);
  await ev(`document.getElementById('rap_p_name').value='Krem testowy'; document.getElementById('rap_p_qty').value='7';`);
  console.log('\n2) FORMULARZ — Nowy Produkt');
  console.log('   przycisk przy naglowku formularza:', await ev(`!!document.querySelector('#rap_add .pk-btn')`));
  await ev(`document.querySelector('#rap_add .pk-btn').focus()`);
  console.log('   fokus na przycisku:', await ev(`document.activeElement === document.querySelector('#rap_add .pk-btn')`));
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await send('Input.dispatchKeyEvent',{type:'char',key:'Enter',text:String.fromCharCode(13),unmodifiedText:String.fromCharCode(13)});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await sleep(800);
  console.log('   Enter otworzyl pomoc:', await ev(`!!document.querySelector('.pk-karta')`));
  console.log('   tytul:', await ev(`(document.querySelector('.pk-tytul')||{}).textContent`));
  console.log('   wskazowka:', await ev(`(document.querySelector('.pk-wskazowka')||{}).innerText`));
  console.log('   formularz NIE wyslany, wartosci na miejscu:', await ev(`document.getElementById('rap_p_name').value === 'Krem testowy' && document.getElementById('rap_p_qty').value === '7'`));
  await strzal('pomoc-02-formularz.png');
  await klawisz('Escape','Escape',27); await sleep(400);
  console.log('   po Esc wartosci nadal na miejscu:', await ev(`document.getElementById('rap_p_name').value === 'Krem testowy'`));

  // ── 3. OSADZENIE W ZAKŁADCE: profil klientki
  await ev(`pokaz('klient-profil', null)`); await sleep(1500);
  console.log('\n3) ZAKŁADKA — profil klientki');
  console.log('   kontekst na starcie:', await ev(`(document.getElementById('pk-profil-slot')||{}).getAttribute?.('data-pomoc')`));
  await ev(`document.querySelector('#pk-profil-slot .pk-btn').click()`); await sleep(700);
  console.log('   chmurka (pomoc nadrzedna):', await ev(`(document.querySelector('.pk-tytul')||{}).textContent`));
  await strzal('pomoc-03-zakladka.png');
  await ev(`przelaczTabProfilu('zadatki', document.querySelectorAll('.pp-tab')[3])`); await sleep(700);
  console.log('   po zmianie zakladki — chmurka zamknieta:', await ev(`!document.querySelector('.pk-karta')`), '| nowy kontekst:', await ev(`document.getElementById('pk-profil-slot').getAttribute('data-pomoc')`));

  // ── 4. JEDNA CHMURKA NA RAZ + brak wplywu na dane
  await ev(`pokaz('magazyn', null)`); await sleep(1200);
  await ev(`document.querySelector('#magazyn .pk-btn').click()`); await sleep(500);
  await ev(`pokaz('rap_add', null)`); await sleep(1200);
  await ev(`(document.querySelector('#rap_add .pk-btn')||{}).click?.()`); await sleep(600);
  console.log('\n4) Jedna chmurka naraz — otwartych chmurek:', await ev(`document.querySelectorAll('.pk-karta').length`));

  // ── 5. TELEFON
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }); await sleep(1200);
  await ev(`pokaz('magazyn', null)`); await sleep(1500);
  await ev(`document.querySelector('#magazyn .pk-btn').click()`); await sleep(800);
  const m = JSON.parse(await ev(`(function(){const k=document.querySelector('.pk-karta'); if(!k) return JSON.stringify({brak:true}); const r=k.getBoundingClientRect(), W=document.documentElement.clientWidth, H=document.documentElement.clientHeight; return JSON.stringify({szer:Math.round(r.width), poza_prawo:Math.max(0,Math.round(r.right-W)), poza_lewo:Math.max(0,Math.round(-r.left)), poza_dol:Math.max(0,Math.round(r.bottom-H)), dokument:Math.round(document.documentElement.scrollWidth), ekran:W});})()`) || '{}');
  console.log('\n5) iPhone 390 — chmurka:', JSON.stringify(m));
  await strzal('pomoc-04-telefon.png');
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('\nBLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
