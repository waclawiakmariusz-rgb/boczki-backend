// Siatka dnia na telefonie: czy to NAPRAWDĘ siatka z kafelkami, czy dalej lista zastępcza.
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
  const dzien = '2026-10-23';

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9515','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-si-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9515/json'); } catch(e){} }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await sleep(1500);
  await ev(`pokaz('terminarz', document.querySelector('#menu-terminarz button'))`); await sleep(3000);
  await ev(`TRM.data='${dzien}'; TRM.widokZmien('dzien')`); await sleep(3000);

  const stan = JSON.parse(await ev(`(function(){
    const g = document.querySelector('.trm-grid'), inner = document.querySelector('.trm-grid-inner');
    const karty = [...document.querySelectorAll('.trm-karta')];
    const lista = document.querySelectorAll('.trm-ag-row').length;
    const kol = [...document.querySelectorAll('.trm-col-h')].filter(x => !x.classList.contains('hours'));
    const godziny = document.querySelector('.trm-hours');
    return JSON.stringify({
      siatka: !!g, kafelkow: karty.length, wierszyListy: lista, kolumn: kol.length,
      widocznaSzerokosc: g ? Math.round(g.clientWidth) : 0, szerokoscTresci: inner ? Math.round(inner.scrollWidth) : 0,
      wysokoscSiatki: g ? Math.round(g.clientHeight) : 0,
      szerokoscKolumny: kol[0] ? Math.round(kol[0].getBoundingClientRect().width) : 0,
      godzinyPrzyklejone: godziny ? getComputedStyle(godziny).position : 'brak',
      dokument: Math.round(document.documentElement.scrollWidth), ekran: Math.round(document.documentElement.clientWidth),
      podpowiedz: (document.querySelector('.trm-przesun')||{}).textContent || 'brak',
      kafelekDotyk: karty[0] ? getComputedStyle(karty[0]).touchAction : 'brak',
    });
  })()`) || '{}');
  console.log('iPhone 390×844 — widok Dzień');
  console.log('   siatka na ekranie:', stan.siatka, '| kafelków:', stan.kafelkow, '| wierszy listy zastępczej:', stan.wierszyListy);
  console.log('   kolumn osób:', stan.kolumn, '· szerokość kolumny:', stan.szerokoscKolumny + 'px');
  console.log('   siatka widoczna:', stan.widocznaSzerokosc + 'px, treść:', stan.szerokoscTresci + 'px → przewijanie w bok:', stan.szerokoscTresci > stan.widocznaSzerokosc);
  console.log('   kolumna godzin:', stan.godzinyPrzyklejone, '· wysokość siatki:', stan.wysokoscSiatki + 'px');
  console.log('   dokument', stan.dokument + 'px / ekran', stan.ekran + 'px →', stan.dokument > stan.ekran ? 'STRONA SIĘ ROZJEŻDŻA' : 'ok, strona nie wystaje');
  console.log('   podpowiedź:', String(stan.podpowiedz).slice(0, 80));
  console.log('   kafelek, touch-action:', stan.kafelekDotyk);
  console.log('   po wejsciu w Dzien — pozycja siatki wzgledem ekranu:', await ev(`(function(){const g=document.querySelector('.trm-grid'); return g ? Math.round(g.getBoundingClientRect().top) : null;})()`), '| scrollTop kontenera:', await ev(`(function(){const m=document.querySelector('.main-content'); return m ? Math.round(m.scrollTop) : 'brak'; })()`), '| scrollY:', await ev(`Math.round(window.scrollY)`));
  await strzal('siatka-01-telefon.png');

  // przesuwamy siatkę w bok — czy kolumna godzin zostaje i czy widać kolejne osoby
  await ev(`document.querySelector('.trm-grid').scrollLeft = 400`); await sleep(900);
  console.log('\npo przesunięciu w bok o 400px:');
  console.log('   widoczne osoby:', await ev(`(function(){ const g=document.querySelector('.trm-grid'); const r=g.getBoundingClientRect(); return [...document.querySelectorAll('.trm-col-h')].filter(x=>!x.classList.contains('hours')).filter(x=>{const b=x.getBoundingClientRect(); return b.right > r.left+40 && b.left < r.right;}).map(x=>(x.querySelector('.name')||{}).textContent).join(', '); })()`));
  console.log('   godziny nadal widoczne z lewej:', await ev(`(function(){ const h=document.querySelector('.trm-col-h.hours'), g=document.querySelector('.trm-grid'); if(!h) return false; const b=h.getBoundingClientRect(), r=g.getBoundingClientRect(); return Math.abs(b.left - r.left) < 3; })()`));
  await strzal('siatka-02-przesunieta.png');

  // klik w kafelek otwiera szczegóły
  const kl = await ev(`(function(){ const k=document.querySelector('.trm-karta'); if(!k) return 'brak kafelka'; k.click(); return 'kliknieto'; })()`); await sleep(2500);
  console.log('\nklik w kafelek:', kl, '→ dymek podglądu:', await ev(`!!document.querySelector('.trm-bubble')`));
  console.log('   dymek mieści się na ekranie:', await ev(`(function(){const b=document.querySelector('.trm-bubble'); if(!b) return 'brak dymka'; const r=b.getBoundingClientRect(), w=document.documentElement.clientWidth, h=document.documentElement.clientHeight; return JSON.stringify({szerokosc:Math.round(r.width), poza_prawo:Math.max(0,Math.round(r.right-w)), poza_lewo:Math.max(0,Math.round(-r.left)), poza_dol:Math.max(0,Math.round(r.bottom-h))});})()`));
  console.log('   treść dymka:', await ev(`(document.querySelector('.trm-bubble')||{}).innerText`).then(s => String(s).replace(/\s+/g, ' ').slice(0, 110)));
  await strzal('siatka-03-szczegoly.png');
  await send('Emulation.clearDeviceMetricsOverride');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
