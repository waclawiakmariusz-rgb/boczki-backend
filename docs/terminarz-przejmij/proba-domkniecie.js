// Masowe domykanie zaległości: podgląd (bez zapisu), pominięcia, wykonanie, możliwość wznowienia.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s=''; r.on('data',d=>s+=d); r.on('end',()=>{ try { res(JSON.parse(s)); } catch(e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  const mysql = require(process.cwd() + '/node_modules/mysql2/promise');
  require('dotenv').config({ path: process.cwd() + '/.env.test' });
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  // materiał: kilka spraw „sprzed tygodni" — cofamy im termin i priorytet, jak po wygaszeniu
  await c.execute(`UPDATE Term_Sprawy SET priorytet='P1', powiazany_czas = DATE_SUB(NOW(), INTERVAL 20 DAY) WHERE tenant_id=? AND stan IN ('nowa','w_trakcie','oczekuje') AND typ IN ('E05','E13','E02') LIMIT 6`, [T]);
  const [przed] = await c.execute(`SELECT priorytet, COUNT(*) n FROM Term_Sprawy WHERE tenant_id=? AND stan IN ('nowa','w_trakcie','oczekuje') GROUP BY priorytet`, [T]);
  console.log('otwarte sprawy przed:', przed.map(x => x.priorytet + ': ' + x.n).join(' | '));

  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const h = { 'x-session-token': tok };

  const podglad = await post({ action: 'trm_sprawy_domknij', tenant_id: T, pracownik: 'Ola', dni: 7 }, h);
  console.log('\nPODGLĄD (bez `wykonaj`):', JSON.stringify({ podglad: podglad.podglad, do_zamkniecia: podglad.do_zamkniecia, pominietych: podglad.pominietych, wg_typu: podglad.wg_typu }));
  (podglad.przyklady || []).forEach(x => console.log('   np.', x.kiedy, '·', x.tytul));
  (podglad.pominiete || []).forEach(x => console.log('   POMINIĘTA:', x.tytul, '—', x.powod));
  const [poPodgladzie] = await c.execute(`SELECT COUNT(*) n FROM Term_Sprawy WHERE tenant_id=? AND stan='rozwiazana' AND rozwiazano > DATE_SUB(NOW(), INTERVAL 2 MINUTE)`, [T]);
  console.log('   czy podgląd cokolwiek zamknął:', poPodgladzie[0].n > 0 ? 'TAK (źle!)' : 'nie — jak ma być');

  console.log('\nWYKONANIE:');
  const wynik = await post({ action: 'trm_sprawy_domknij', tenant_id: T, pracownik: 'Ola', dni: 7, wykonaj: true }, h);
  console.log('   ', wynik.status, '·', wynik.message, '| zamknięte:', wynik.zamkniete, '| pominięte:', wynik.pominietych);
  const [po] = await c.execute(`SELECT priorytet, COUNT(*) n FROM Term_Sprawy WHERE tenant_id=? AND stan IN ('nowa','w_trakcie','oczekuje') GROUP BY priorytet`, [T]);
  console.log('   otwarte sprawy po:', po.map(x => x.priorytet + ': ' + x.n).join(' | ') || 'brak');
  const [wpisy] = await c.execute(`SELECT kto, akcja, LEFT(opis, 60) opis FROM Term_Sprawy_Dziennik WHERE akcja='rozwiazano' ORDER BY id DESC LIMIT 2`);
  wpisy.forEach(x => console.log('   dziennik sprawy:', x.kto, '·', x.akcja, '·', x.opis));
  const [log] = await c.execute(`SELECT akcja, LEFT(opis,90) opis FROM Logi WHERE tenant_id=? ORDER BY id DESC LIMIT 1`, [T]);
  console.log('   Dziennik Zdarzeń:', log[0] ? log[0].akcja + ' — ' + log[0].opis : 'brak');

  // czy da się wznowić
  const [zamk] = await c.execute(`SELECT id, tytul FROM Term_Sprawy WHERE tenant_id=? AND stan='rozwiazana' ORDER BY rozwiazano DESC LIMIT 1`, [T]);
  if (zamk.length) {
    const w = await post({ action: 'trm_sprawa_wznow', tenant_id: T, pracownik: 'Ola', id: zamk[0].id }, h);
    console.log('\nwznowienie domkniętej sprawy:', w.status, '—', zamk[0].tytul);
  }

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9511','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-dm-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9511/json'); } catch(e){} }
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
  // znowu robimy zaległości, żeby było co pokazać na zrzucie
  await c.execute(`UPDATE Term_Sprawy SET stan='nowa', rozwiazano=NULL, priorytet='P1', powiazany_czas = DATE_SUB(NOW(), INTERVAL 25 DAY) WHERE tenant_id=? AND stan='rozwiazana' LIMIT 5`, [T]);
  await ev(`pokaz('terminarz', document.querySelector('#menu-terminarz button'))`); await sleep(2500);
  await ev(`TRM.otworzPowiadomienia()`); await sleep(3000);
  console.log('\nprzycisk w panelu:', await ev(`(function(){const b=[...document.querySelectorAll('.trm-panel button')].find(x=>x.textContent.includes('Domknij zaległości')); return b ? b.parentElement.innerText.replace(/\\s+/g,' ') : 'brak';})()`));
  await ev(`TRM.domkniecieOtworz()`); await sleep(2500);
  console.log('karta podglądu:', await ev(`(document.querySelector('.trm-domkniecie')||{}).innerText`).then(s => String(s).replace(/\s+/g, ' ').slice(0, 220)));
  await strzal('domkniecie-01-podglad.png');
  console.log('BLEDY JS:', errs.length ? errs.slice(0,4) : 'brak');
  await c.end(); ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
