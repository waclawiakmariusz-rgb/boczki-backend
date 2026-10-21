// Ile ekranu zjada naglowek, zanim zacznie sie siatka (iPhone 390x844).
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s=''; r.on('data',d=>s+=d); r.on('end',()=>{ try { res(JSON.parse(s)); } catch(e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());
(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9517','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-pm-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9517/json'); } catch(e){} }
  const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((a,b)=>{ws.onopen=a;ws.onerror=b;});
  let id=0; const pend=new Map();
  ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id);}};
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async e=>{const r=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:e}); return r.result&&r.result.result?r.result.result.value:null;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:B+'/index.html'}); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz']));`);
  await send('Page.reload',{ignoreCache:true}); await sleep(8000);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }); await sleep(1200);
  await ev(`pokaz('terminarz', document.querySelector('#menu-terminarz button'))`); await sleep(2500);
  await ev(`TRM.data='2026-10-23'; TRM.widokZmien('dzien')`); await sleep(3000);
  const w = JSON.parse(await ev(`(function(){
    const el = s => document.querySelector(s);
    const h = s => { const e = el(s); if(!e) return null; const r = e.getBoundingClientRect(); return {wys:Math.round(r.height), gora:Math.round(r.top + window.scrollY)}; };
    const g = el('.trm-grid');
    return JSON.stringify({ ekran: window.innerHeight,
      siatkaOd: g ? Math.round(g.getBoundingClientRect().top + window.scrollY) : null,
      bloki: { top:h('.trm-top'), szukaj:h('.trm-szukaj'), pasek:h('.trm-pasek'), widoki:h('.trm-views'), liczniki:h('.trm-counters'), zmiany:h('.trm-zmiany'), filtry:h('.trm-filtry'), podpowiedz:h('.trm-przesun') } });
  })()`) || '{}');
  console.log('ekran', w.ekran + 'px · siatka zaczyna się na', w.siatkaOd + 'px od góry');
  for (const [k, v] of Object.entries(w.bloki || {})) if (v) console.log('   ', k.padEnd(12), 'wysokość', String(v.wys).padStart(4), 'od góry', v.gora);
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
