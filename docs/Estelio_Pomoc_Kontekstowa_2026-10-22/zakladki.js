// Sześć zakładek profilu klientki: czy każda ma WŁASNĄ pomoc (nie nadrzędną).
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s=''; r.on('data',d=>s+=d); r.on('end',()=>{ try { res(JSON.parse(s)); } catch(e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());
(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9525','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-zk-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9525/json'); } catch(e){} }
  const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((a,b)=>{ws.onopen=a;ws.onerror=b;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id);} else if(d.method==='Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception||{}).description||'').split('\n')[0]);};
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async e=>{const r=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:e}); return r.result&&r.result.result?r.result.result.value:null;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:B+'/index.html'}); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module']));`);
  await send('Page.reload',{ignoreCache:true}); await sleep(8000);
  await ev(`pokaz('klient-profil', null)`); await sleep(1500);
  const taby = ['podsumowanie','wizyty','produkty','zadatki','analityki','dokumenty'];
  console.log('ZAKŁADKA'.padEnd(16) + 'KONTEKST'.padEnd(34) + 'TYTUŁ CHMURKI');
  console.log('-'.repeat(86));
  let ogolne = 0;
  for (let i = 0; i < taby.length; i++) {
    await ev(`przelaczTabProfilu('${taby[i]}', document.querySelectorAll('.pp-tab')[${i}])`); await sleep(500);
    const ctx = await ev(`document.getElementById('pk-profil-slot').getAttribute('data-pomoc')`);
    await ev(`document.querySelector('#pk-profil-slot .pk-btn').click()`); await sleep(450);
    const tytul = await ev(`(document.querySelector('.pk-tytul')||{}).textContent || 'BRAK'`);
    if (/ogólnie/i.test(String(tytul))) ogolne++;
    console.log(taby[i].padEnd(16) + String(ctx).padEnd(34) + tytul);
    await ev(`POMOC.zamknij()`); await sleep(150);
  }
  console.log('-'.repeat(86));
  console.log('zakładek z pomocą nadrzędną (ma być 0):', ogolne);
  const s=await send('Page.captureScreenshot',{format:'png'});
  await ev(`przelaczTabProfilu('zadatki', document.querySelectorAll('.pp-tab')[3]); document.querySelector('#pk-profil-slot .pk-btn').click()`); await sleep(600);
  const s2=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(process.argv[2]+'/pomoc-05-zakladka-zadatki.png', Buffer.from(s2.result.data,'base64'));
  console.log('zrzut pomoc-05-zakladka-zadatki.png');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,3) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
