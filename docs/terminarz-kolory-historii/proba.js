// Kolory stanów w historii klientki — czy pięć stanów naprawdę różni się kolorem.
// Mierzę wyliczone kolory (getComputedStyle), nie oglądam na oko.
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
  const kl = (await post({ action: 'trm_szukaj_klienta', tenant_id: T, pracownik: 'Ola', fraza: 'Julia' }, h)).klienci[0];

  // żeby na zrzucie było widać WSZYSTKIE pięć stanów, jedną zaplanowaną oznaczam jako nieobecność
  const hist = await post({ action: 'trm_historia_klientki', tenant_id: T, pracownik: 'Ola', id_klienta: kl.id_klienta, od: '2025-12-27', do: '2027-01-21' }, h);
  const maNieobecna = (hist.wizyty || []).some(w => w.obecnosc === 'nieobecny');
  if (!maNieobecna) {
    const kandydat = (hist.wizyty || []).find(w => !w.usunieta && w.status === 'potwierdzona' && !w.pozycje.some(p => p.stan === 'wykonana'));
    if (kandydat) {
      const r = await post({ action: 'trm_obecnosc', tenant_id: T, pracownik: 'Ola', id: kandydat.id, wersja: kandydat.wersja, obecnosc: 'nieobecny' }, h);
      console.log('oznaczam wizytę', kandydat.numer, 'jako nieobecność:', r.status, r.message || '');
    }
  }

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9499','--window-size=1400,1100','--user-data-dir=' + os.tmpdir() + '/est-kol-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9499/json'); } catch(e){} }
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
  await ev(`TRM.historiaKlientki('${kl.id_klienta}')`); await sleep(3500);

  console.log('\nLEGENDA — wyliczony kolor kwadratu:');
  const leg = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.trm-hist-legenda .poz')].map(p=>{const i=p.querySelector('.pr'); const s=getComputedStyle(i); return {opis:p.textContent.trim(), tlo:(s.backgroundImage!=='none'?'wzór: ':'')+s.backgroundColor, rozmiar:s.width+'×'+s.height};}))`) || '[]');
  leg.forEach(x => console.log('   ', String(x.opis).padEnd(22), String(x.tlo).padEnd(34), x.rozmiar));

  console.log('\nWIERSZE — pasek z lewej i tło:');
  const w = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.trm-hist-wizyta')].map(x=>{const s=getComputedStyle(x); const p=x.querySelector('.trm-pill'); const ps=p?getComputedStyle(p):null; return {stan:[...x.classList].filter(c=>c!=='trm-hist-wizyta').join(''), data:(x.querySelector('.data b')||{}).textContent, pasek:s.borderLeftColor+' '+s.borderLeftWidth, tlo:(s.backgroundImage!=='none'?'wzór ':'')+s.backgroundColor, plakietka:(p?p.textContent.trim():'—')+(ps?' '+ps.color+' na '+ps.backgroundColor:'')};}))`) || '[]');
  w.forEach(x => console.log('   ', String(x.stan).padEnd(11), String(x.data).padEnd(10), ('pasek ' + x.pasek).padEnd(30), ('tło ' + x.tlo).padEnd(28), x.plakietka));

  const unikalne = new Set(leg.map(x => x.tlo));
  console.log('\nróżnych kolorów w legendzie:', unikalne.size, 'z', leg.length);
  await strzal('kolory-01-historia.png');
  // dalsza część listy — tam leżą „odbyła się" i „odwołana"
  await ev(`(document.querySelectorAll('.trm-hist-wizyta')[5]||document.querySelector('.trm-hist-os')).scrollIntoView({block:'end',behavior:'instant'})`); await sleep(900);
  await strzal('kolory-02-dalej.png');
  await ev(`document.body.classList.add('dark-mode')`); await sleep(1500);
  const legC = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.trm-hist-legenda .poz')].map(p=>{const i=p.querySelector('.pr'); const s=getComputedStyle(i); return {opis:p.textContent.trim(), tlo:(s.backgroundImage!=='none'?'wzór: ':'')+s.backgroundColor};}))`) || '[]');
  console.log('\nLEGENDA W TRYBIE CIEMNYM:');
  legC.forEach(x => console.log('   ', String(x.opis).padEnd(22), x.tlo));
  await strzal('kolory-03-ciemny.png');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
