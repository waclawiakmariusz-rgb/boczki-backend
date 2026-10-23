// Rabaty po redesignie: payload add_discount_def dla obu typów (fetch przechwycony — nic nie idzie do bazy),
// dwuklik, blokada właściwego przycisku, lista z realnych danych, podgląd, zrzut desktop + telefon. Sprząta profil Chrome.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2] || '.'; const PROFIL = os.tmpdir() + '/est-rb-' + Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());
const sprzatnij = () => { try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (e) {} };
(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9545','--window-size=1663,946','--lang=pl-PL','--user-data-dir=' + PROFIL,'about:blank'], { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:9545/json'); } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception || {}).description || '').split('\n')[0]); };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); if (r.result && r.result.exceptionDetails) throw new Error('EVAL: ' + (r.result.exceptionDetails.exception || {}).description); return r.result && r.result.result ? r.result.result.value : null; };
  const zrzut = async n => { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(sh.result.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: B + '/index.html' }); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module','konsultacje']));`);
  await send('Page.reload', { ignoreCache: true }); await sleep(8000);
  await ev(`(function(){ window.__p={alerty:[],posty:[]}; window.alert=m=>window.__p.alerty.push(String(m)); const f=window.fetch;
    window.fetch=function(u,o){ try{ if(o&&o.method==='POST'&&o.body){ const b=JSON.parse(o.body); if(b.action==='add_discount_def'){ window.__p.posty.push(b); return new Promise(res=>setTimeout(()=>res(new Response(JSON.stringify({status:'success',message:'(atrapa) Dodano'}),{status:200,headers:{'Content-Type':'application/json'}})),600)); } } }catch(e){} return f.apply(this,arguments); }; })()`);
  await ev(`pokaz('sekcja-kreator-rabatow', null)`); await sleep(2500);
  const stan = async () => JSON.parse(await ev(`(function(){ const s=document.getElementById('sekcja-kreator-rabatow'); const W=s.getBoundingClientRect().width;
    const poza=[...s.querySelectorAll('.rb-card, .rb-badge, input, button')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && r.right - s.getBoundingClientRect().left > W+1;}).length;
    return JSON.stringify({ kontener: Math.round(W), poza, scrollX: document.querySelector('.main-content').scrollWidth > document.querySelector('.main-content').clientWidth+1,
      licznik: document.getElementById('rabaty-licznik').textContent, wierszy: s.querySelectorAll('.rb-wiersz').length, pierwszyWiersz: (s.querySelector('.rb-wiersz')||{innerText:''}).innerText.replace(/\\s+/g,' ').trim(),
      typSelect: document.getElementById('rabat-typ').value, jednostka: s.querySelector('[data-rb-jednostka]').textContent, podglad: s.querySelector('.rb-podglad').innerText.replace(/\\s+/g,' ').trim(),
      przycisk: s.querySelector('button[onclick]').textContent.trim(), przyciskDisabled: s.querySelector('button[onclick]').disabled, pomocDisabled: (s.querySelector('.pk-btn')||{}).disabled, pomocTekst: (s.querySelector('.pk-btn')||{textContent:''}).textContent.trim() }); })()`));
  let p = await stan(); console.log('po wejściu:', JSON.stringify(p));
  // PROCENT 10
  await ev(`(function(){ const n=document.getElementById('rabat-nazwa'); n.value='Stała klientka'; n.dispatchEvent(new Event('input')); const w=document.getElementById('rabat-wartosc'); w.value='10'; w.dispatchEvent(new Event('input')); })()`); await sleep(200);
  p = await stan(); console.log('PROCENT 10 → podgląd:', p.podglad, '| jednostka:', p.jednostka, '| select:', p.typSelect);
  await zrzut('rabaty-01-desktop.png');
  await ev(`(function(){ const b=document.querySelector('button[onclick="zapiszDefinicjeRabatu()"]'); b.click(); b.click(); })()`); await sleep(200);
  p = await stan(); console.log('w trakcie zapisu: przycisk „' + p.przycisk + '” disabled:', p.przyciskDisabled, '| pomoc „?” disabled:', p.pomocDisabled, 'tekst:', JSON.stringify(p.pomocTekst));
  await sleep(1500);
  console.log('po zapisie: POST-ów:', await ev(`window.__p.posty.length`), '| payload:', await ev(`JSON.stringify(window.__p.posty[0])`), '| alerty:', await ev(`JSON.stringify(window.__p.alerty)`), '| nazwa po:', JSON.stringify(await ev(`document.getElementById('rabat-nazwa').value`)));
  // KWOTA 50 przez segment
  await ev(`window.__p.posty=[]; (function(){ const r=document.querySelector('input[name="rb-typ-segment"][value="KWOTA"]'); r.click(); const n=document.getElementById('rabat-nazwa'); n.value='Bon 50'; n.dispatchEvent(new Event('input')); const w=document.getElementById('rabat-wartosc'); w.value='50'; w.dispatchEvent(new Event('input')); })()`); await sleep(200);
  p = await stan(); console.log('KWOTA 50 → podgląd:', p.podglad, '| jednostka:', p.jednostka, '| select:', p.typSelect);
  await ev(`document.querySelector('button[onclick="zapiszDefinicjeRabatu()"]').click()`); await sleep(1200);
  console.log('zapis KWOTA: payload:', await ev(`JSON.stringify(window.__p.posty[0])`));
  // pusty → alert, zero POST
  await ev(`window.__p.posty=[]; window.__p.alerty=[]; document.getElementById('rabat-wartosc').value=''; document.querySelector('button[onclick="zapiszDefinicjeRabatu()"]').click()`); await sleep(300);
  console.log('pusta wartość: alert:', await ev(`JSON.stringify(window.__p.alerty)`), '| POST-ów:', await ev(`window.__p.posty.length`));
  console.log('lista: licznik', p.licznik, '| wierszy', p.wierszy, '| pierwszy:', JSON.stringify(p.pierwszyWiersz), '| kontener', p.kontener, '| poza', p.poza, '| scrollX', p.scrollX);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(600);
  p = await stan(); console.log('390px: kontener', p.kontener, '| poza', p.poza, '| scrollX', p.scrollX); await zrzut('rabaty-02-telefon.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true }); await sleep(600);
  p = await stan(); console.log('320px: kontener', p.kontener, '| poza', p.poza, '| scrollX', p.scrollX);
  console.log('BLEDY JS:', errs.length ? errs.slice(0, 4) : 'brak');
  ws.close(); ch.kill(); await sleep(800); sprzatnij(); process.exit(0);
})().catch(e => { console.error('BLAD:', e.message); sprzatnij(); process.exit(1); });
