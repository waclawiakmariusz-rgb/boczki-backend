// „Więcej działań": czy przyciski przestały być ucinane i czy zniknął akapit z objaśnieniem.
// Mierzę szerokość treści kontra szerokość przycisku — ucięcie widać liczbą, nie okiem.
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
  // wizyta zaplanowana, żeby pokazały się wszystkie pięć działań
  const init = await post({ action: 'trm_init', tenant_id: T, pracownik: 'Ola' }, h);
  const u = (init.uslugi || []).find(x => x.id === 'DEMO-U-A');
  const kl = (await post({ action: 'trm_szukaj_klienta', tenant_id: T, pracownik: 'Ola', fraza: 'Julia' }, h)).klienci[0];
  const jutro = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
  let rezId = null;
  for (const godz of ['15:00', '15:30', '16:00', '16:30']) {
    const z = await post({ action: 'trm_zapisz', tenant_id: T, pracownik: 'Ola', idem: 'akcje-' + Date.now(),
      klient: { id_klienta: kl.id_klienta, nazwa: kl.nazwa }, start: jutro + 'T' + godz, kanal: 'recepcja',
      pozycje: [{ usluga_id: 'DEMO-U-A', pracownik: 'Anna', czas_min: u.czas_min }] }, h);
    if (z.status === 'success') { rezId = z.rezerwacja.id; console.log('wizyta do próby:', rezId, jutro, godz); break; }
  }
  if (!rezId) { console.error('nie udalo sie umowic wizyty'); process.exit(1); }

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9513','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-ak-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9513/json'); } catch(e){} }
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
  await ev(`TRM.data='${jutro}'; TRM.widokZmien('dzien')`); await sleep(2500);
  await ev(`TRM.otworzSzczegoly(${rezId})`); await sleep(2500);
  await ev(`(function(){ const d=[...document.querySelectorAll('.trm-panel details')].find(x=>x.textContent.includes('Więcej działań')); if(d) d.open = true; })()`); await sleep(800);

  const pomiar = async (opis) => {
    const w = JSON.parse(await ev(`(function(){
      const box = document.querySelector('.trm-akcje') || document.querySelector('.trm-wiecej .trm-row');
      if(!box) return JSON.stringify({brak:true});
      const b = [...box.querySelectorAll('button')];
      const r = box.getBoundingClientRect();
      return JSON.stringify({
        kontener: Math.round(r.width), rzedow: new Set(b.map(x => Math.round(x.getBoundingClientRect().top))).size,
        przyciski: b.map(x => ({ tekst: x.textContent.trim(), szer: Math.round(x.getBoundingClientRect().width), tresc: Math.round(x.scrollWidth), uciety: x.scrollWidth > Math.ceil(x.getBoundingClientRect().width) + 1 })),
      });
    })()`) || '{}');
    console.log('\n' + opis, '— kontener', w.kontener + 'px, rzędów:', w.rzedow);
    (w.przyciski || []).forEach(x => console.log('   ', (x.uciety ? 'UCIĘTY ' : 'ok     ') + String(x.tekst).padEnd(26), 'szerokość', String(x.szer).padStart(4), 'treść potrzebuje', String(x.tresc).padStart(4)));
    return (w.przyciski || []).filter(x => x.uciety).length;
  };
  const uciete = await pomiar('Panel (szeroki ekran)');
  console.log('\nucięte przyciski:', uciete);
  console.log('czy został akapit o nieobecności/odwołaniu:', await ev(`document.querySelector('.trm-panel').innerText.includes('Nieobecność potwierdza człowiek')`));
  await ev(`(document.querySelector('.trm-akcje')||document.body).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(700);
  await strzal('akcje-01-panel.png');

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }); await sleep(2000);
  await ev(`(function(){ const d=[...document.querySelectorAll('.trm-panel details')].find(x=>x.textContent.includes('Więcej działań')); if(d) d.open = true; })()`); await sleep(600);
  const ucieteTel = await pomiar('iPhone 390px');
  console.log('\nucięte przyciski na telefonie:', ucieteTel);
  await ev(`(document.querySelector('.trm-akcje')||document.body).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(700);
  await strzal('akcje-02-iphone.png');
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
