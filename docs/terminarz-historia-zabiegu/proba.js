// Historia → Zabieg: chipsy, wielokrotny wybór, lista UNIKALNYCH klientek z telefonem.
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
  const init = await post({ action: 'trm_init', tenant_id: T, pracownik: 'Ola' }, h);
  const katy = [...new Set((init.uslugi || []).map(u => String(u.kategoria || '').trim()).filter(Boolean))];
  console.log('kategorie w cenniku:', katy.join(' | '));

  // kontrakt serwera
  const bez = await post({ action: 'trm_historia_zabiegu', tenant_id: T, pracownik: 'Ola', od: '2025-12-27', do: '2027-01-19', kategorie: [] }, h);
  console.log('bez zaznaczonego zabiegu:', bez.status, '—', String(bez.message || '').slice(0, 60));
  const jedna = await post({ action: 'trm_historia_zabiegu', tenant_id: T, pracownik: 'Ola', od: '2025-12-27', do: '2027-01-19', kategorie: [katy[0]] }, h);
  console.log(`\njeden zabieg („${katy[0]}"):`, jedna.status, '| klientek:', (jedna.klientki || []).length, '| wizyt razem:', (jedna.podsumowanie || {}).wizyt);
  (jedna.klientki || []).slice(0, 6).forEach(k => console.log('   ', String(k.nazwa).padEnd(22), String(k.telefon || 'brak telefonu').padEnd(14), String(k.wizyt).padStart(2), 'wizyt · ostatnia:', String(k.ostatnia || '—').padEnd(11), '· umówiona:', k.najblizsza || '—'));
  const suma = (jedna.klientki || []).reduce((s, k) => s + k.wizyt, 0);
  console.log('   sprawdzenie unikalności: wierszy', (jedna.klientki || []).length, 'przy', suma, 'wizytach łącznie');

  const kilka = await post({ action: 'trm_historia_zabiegu', tenant_id: T, pracownik: 'Ola', od: '2025-12-27', do: '2027-01-19', kategorie: katy }, h);
  console.log(`\nwszystkie zabiegi (${katy.length}):`, kilka.status, '| klientek:', (kilka.klientki || []).length, '| podsumowanie:', JSON.stringify(kilka.podsumowanie));

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9509','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-zb-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9509/json'); } catch(e){} }
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
  await ev(`TRM.widokZmien('historia')`); await sleep(2000);
  console.log('\nprzelacznik w Historii:', await ev(`[...document.querySelectorAll('.trm-historia .trm-segment button')].map(b=>b.textContent.trim()).join(' | ')`));
  await ev(`TRM.histTryb('zabieg')`); await sleep(1500);
  console.log('chipsy:', await ev(`[...document.querySelectorAll('.trm-hist-chip')].map(b=>b.textContent.trim()).join(' | ')`));
  console.log('przycisk przed zaznaczeniem:', await ev(`(function(){const b=[...document.querySelectorAll('.trm-historia button')].find(x=>x.textContent.includes('Pokaż klientki')); return b ? (b.disabled ? 'nieaktywny' : 'aktywny') : 'brak';})()`));
  await strzal('zabieg-01-chipsy.png');

  // zaznaczamy dwa chipsy i pokazujemy
  await ev(`(function(){const c=[...document.querySelectorAll('.trm-hist-chip')]; c[0].click(); if(c[1]) c[1].click();})()`); await sleep(1200);
  console.log('\nzaznaczone:', await ev(`TRM.hist.zabiegi.join(' + ')`), '| chipsy włączone:', await ev(`document.querySelectorAll('.trm-hist-chip.on').length`));
  console.log('czy render sam pobrał dane (nie powinien):', await ev(`!!TRM.hist.dane`));
  await ev(`(function(){const b=[...document.querySelectorAll('.trm-historia button')].find(x=>x.textContent.includes('Pokaż klientki')); b.click();})()`); await sleep(3000);
  console.log('kafelki:', await ev(`[...document.querySelectorAll('.trm-hist-kafel')].map(k=>k.innerText.replace(/\\s+/g,' ')).join(' | ')`));
  console.log('wierszy (unikalnych osob):', await ev(`document.querySelectorAll('.trm-hist-osoba').length`));
  console.log('pierwszy wiersz:', await ev(`(document.querySelector('.trm-hist-osoba')||{}).innerText`).then(s => String(s).replace(/\s+/g, ' ').slice(0, 130)));
  console.log('telefon widoczny w wierszu:', await ev(`!!document.querySelector('.trm-hist-osoba .tel')`));
  await strzal('zabieg-02-lista.png');

  // klik w wiersz prowadzi do pełnej historii tej klientki
  await ev(`(function(){const w=document.querySelector('.trm-hist-osoba[role=button]'); if(w) w.click();})()`); await sleep(3000);
  console.log('\npo kliknieciu w osobe — tryb:', await ev(`TRM.hist.tryb`), '| klientka:', await ev(`(TRM.hist.klient||{}).nazwa || '—'`));
  await strzal('zabieg-03-przejscie.png');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
