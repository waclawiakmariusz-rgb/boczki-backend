// Zdjęcie widoku „Tydzień": czy przełącznik ma cztery pozycje, czy stare wejście nie wywala
// aplikacji i czy pozostałe widoki nadal działają. Na koniec pomiar szerokości na iPhonie.
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

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9501','--window-size=1400,1000','--user-data-dir=' + os.tmpdir() + '/est-wid-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9501/json'); } catch(e){} }
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

  console.log('przelacznik widokow:', await ev(`[...document.querySelectorAll('#trm-views button')].map(b=>b.textContent.trim()).join(' | ')`));
  await strzal('widoki-01-przelacznik.png');

  // stare wejście (np. z zakładki sprzed zmiany) nie może wywalić modułu
  await ev(`TRM.widokZmien('tydzien')`); await sleep(2500);
  console.log('po TRM.widokZmien("tydzien") — widok:', await ev(`TRM.widok`), '| siatka dnia na ekranie:', await ev(`!!document.querySelector('.trm-grid')`));

  // pozostałe widoki nadal działają
  for (const w of ['agenda', 'zasoby', 'historia', 'dzien']) {
    await ev(`TRM.widokZmien('${w}')`); await sleep(2200);
    const podpis = await ev(`(document.getElementById('trm-sub')||{}).textContent`);
    const tresc = await ev(`(document.getElementById('trm-main')||{}).childElementCount`);
    console.log('  widok', String(w).padEnd(9), 'podpis:', String(podpis).padEnd(28), 'elementow w tresci:', tresc);
  }
  await ev(`TRM.widokZmien('agenda')`); await sleep(2200); await strzal('widoki-02-agenda.png');
  await ev(`TRM.widokZmien('dzien')`); await sleep(2200);

  // iPhone 13 — audyt z docs/terminarz-iphone/ pokazywał, że pasek widoków wystawał o 16 px
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await sleep(2000);
  const pas = await ev(`(function(){ const p=document.getElementById('trm-views'); if(!p) return 'brak'; const r=p.getBoundingClientRect(); return JSON.stringify({szerokosc:Math.round(r.width), poza:Math.max(0, Math.round(r.right - document.documentElement.clientWidth)), przyciskow:p.querySelectorAll('button').length}); })()`);
  console.log('\niPhone 390px — pasek widoków:', pas);
  await strzal('widoki-03-iphone.png');
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
