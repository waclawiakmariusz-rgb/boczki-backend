// Skasowanie wizyty wpisanej przez pomyłkę: przycisk w szczegółach, ślad w historii klientki.
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
  const h = { 'x-session-token': tok };

  // wizyta do skasowania: umawiamy ją specjalnie na ten test
  const init = await post({ action: 'trm_init', tenant_id: T, pracownik: 'Ola' }, h);
  const u = (init.uslugi || []).find(x => x.id === 'DEMO-U-A');
  const kl = (await post({ action: 'trm_szukaj_klienta', tenant_id: T, pracownik: 'Ola', fraza: 'Julia' }, h)).klienci[0];
  const zapis = await post({ action: 'trm_zapisz', tenant_id: T, pracownik: 'Ola', idem: 'usun-' + Date.now(),
    klient: { id_klienta: kl.id_klienta, nazwa: kl.nazwa }, start: '2026-10-23T09:00', kanal: 'recepcja',
    pozycje: [{ usluga_id: 'DEMO-U-A', pracownik: 'Anna', czas_min: u.czas_min }] }, h);
  if (zapis.status !== 'success') { console.error('nie udalo sie umowic wizyty do proby:', JSON.stringify(zapis).slice(0, 160)); process.exit(1); }
  const rezId = zapis.rezerwacja.id;
  console.log('umowiono wizyte do skasowania:', rezId, '(' + kl.nazwa + ', 23.10 09:00)');

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9497','--window-size=1400,1000','--user-data-dir=' + os.tmpdir() + '/est-usun-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9497/json'); } catch(e){} }
  const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((a,b)=>{ws.onopen=a;ws.onerror=b;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id);} else if(d.method==='Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception||{}).description||'').split('\n')[0]);};
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async e=>{const r=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:e}); return r.result&&r.result.result?r.result.result.value:null;};
  const strzal=async n=>{const s=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(OUT+'/'+n, Buffer.from(s.result.data,'base64')); console.log('zrzut',n);};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:B+'/index.html'}); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz'])); localStorage.removeItem('boczki_theme');`);
  await send('Page.reload',{ignoreCache:true}); await sleep(8000);
  await ev(`pokaz('terminarz', document.querySelector('#menu-terminarz button'))`); await sleep(2500);
  await ev(`TRM.data='2026-10-23'; TRM.widokZmien('dzien')`); await sleep(2500);

  // 1. przycisk w szczegółach
  await ev(`TRM.otworzSzczegoly(${rezId})`); await sleep(2500);
  await ev(`(function(){ const d=[...document.querySelectorAll('.trm-panel details')].find(x=>x.textContent.includes('Więcej działań')); if(d) d.open = true; })()`); await sleep(600);
  console.log('przyciski w „Więcej działań":', await ev(`[...document.querySelectorAll('.trm-panel details .trm-btn')].map(b=>b.textContent.trim()).join(' | ')`));
  await strzal('usun-01-przycisk.png');

  // 2. formularz
  await ev(`TRM.szcz.tryb='usun'; TRM.us={powod:''}; TRM.renderSzczegoly()`); await sleep(1500);
  console.log('formularz:', await ev(`(document.querySelector('.trm-panel .trm-card h3')||{}).textContent`));
  console.log('ostrzezenie:', await ev(`(document.querySelector('.trm-panel .trm-note.warn')||{}).innerText || ''`).then(s=>String(s).replace(/\s+/g,' ').slice(0,150)));
  await strzal('usun-02-formularz.png');

  // 3. próba bez powodu, potem z powodem
  await ev(`(function(){ const i=document.getElementById('trm-u-powod'); if(i) i.value=''; })()`);
  await ev(`TRM.usunPotwierdz()`); await sleep(1200);
  console.log('po próbie bez powodu — czy wizyta nadal aktywna:', await ev(`TRM.szcz && TRM.szcz.rez ? !TRM.szcz.rez.usunieta : 'brak panelu'`));
  await ev(`(function(){ const i=document.getElementById('trm-u-powod'); if(i) i.value='pomyłka przy zapisie — podwójny wpis'; })()`);
  await ev(`TRM.usunPotwierdz()`); await sleep(3000);
  console.log('po skasowaniu — stan wizyty:', await ev(`TRM.szcz && TRM.szcz.rez ? JSON.stringify({usunieta: TRM.szcz.rez.usunieta, przez: TRM.szcz.rez.usunieta_przez, powod: TRM.szcz.rez.usunieta_powod}) : 'panel zamkniety'`));
  console.log('komunikat w panelu:', await ev(`(document.querySelector('.trm-panel .trm-note.warn')||{}).innerText || ''`).then(s=>String(s).replace(/\s+/g,' ').slice(0,200)));
  await strzal('usun-03-po-skasowaniu.png');

  // 4. czy zniknęła z kalendarza
  await ev(`TRM.panelZamknij(); TRM.widokZmien('dzien')`); await sleep(2500);
  console.log('czy jest na siatce dnia:', await ev(`!!document.querySelector('.trm-karta[data-rezerwacja="${rezId}"]')`));

  // 5. ślad w historii klientki
  await ev(`TRM.historiaKlientki('${kl.id_klienta}')`); await sleep(3500);
  const wiz = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.trm-hist-wizyta')].map(x=>({klasa:[...x.classList].filter(c=>c!=='trm-hist-wizyta').join(''), data:(x.querySelector('.data b')||{}).textContent, plakietka:(x.querySelector('.trm-pill')||{}).textContent, uwaga:(x.querySelector('.uwaga')||{}).textContent})))`) || '[]');
  console.log('\nhistoria klientki:');
  wiz.slice(0, 5).forEach(x => console.log('   ', String(x.data).padEnd(12), String(x.plakietka).padEnd(12), (x.uwaga || '').replace(/\s+/g,' ').slice(0, 95)));
  console.log('kafelki podsumowania:', await ev(`[...document.querySelectorAll('.trm-hist-kafel')].map(k=>k.innerText.replace(/\\s+/g,' ')).join(' | ')`));
  await strzal('usun-04-historia.png');
  console.log('\nBLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
