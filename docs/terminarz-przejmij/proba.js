// Centrum powiadomień bez „Przejmij": co zostało na kartach i w szczegółach sprawy.
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
  const lista = await post({ action: 'trm_sprawy_lista', tenant_id: T, pracownik: 'Ola', zakladka: 'do_dzialania' }, { 'x-session-token': tok });
  const sprawy = lista.sprawy || [];
  console.log('spraw do działania:', sprawy.length, '| pilnych (P0):', sprawy.filter(x => x.priorytet === 'P0').length);
  console.log('typy:', [...new Set(sprawy.map(x => x.typ))].join(', '));

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9505','--window-size=1400,1000','--user-data-dir=' + os.tmpdir() + '/est-pj-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9505/json'); } catch(e){} }
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
  await ev(`TRM.otworzPowiadomienia()`); await sleep(3000);

  console.log('\npodpis pod naglowkiem:', await ev(`(document.querySelector('.trm-panel .muted, .trm-panel .trm-sub')||{}).textContent`));
  console.log('przyciski na pierwszej karcie:', await ev(`[...document.querySelectorAll('.trm-sprawa-karta')][0] ? [...document.querySelectorAll('.trm-sprawa-karta')][0].querySelectorAll('button').length + ' szt: ' + [...[...document.querySelectorAll('.trm-sprawa-karta')][0].querySelectorAll('button')].map(b=>b.textContent.trim()).join(' | ') : 'brak kart'`));
  console.log('czy gdziekolwiek „Przejmij":', await ev(`document.querySelector('.trm-panel').innerText.includes('Przejmij')`));
  console.log('czy „Nikt jeszcze nie przejął":', await ev(`document.querySelector('.trm-panel').innerText.includes('Nikt jeszcze nie przejął')`));
  await strzal('przejmij-01-lista.png');

  if (sprawy.length) {
    await ev(`TRM.otworzSprawe(${sprawy[0].id})`); await sleep(2500);
    console.log('\nprzyciski w szczegolach sprawy:', await ev(`[...document.querySelectorAll('.trm-panel button')].map(b=>b.textContent.trim()).filter(x=>x && x.length<30).join(' | ')`));
    console.log('czy gdziekolwiek „Przejmij":', await ev(`document.querySelector('.trm-panel').innerText.includes('Przejmij')`));
    await strzal('przejmij-02-szczegoly.png');
  }
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
