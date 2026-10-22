// ODCISK ZACHOWANIA ekranu „Przyjęcie towaru”.
// Ten sam skrypt biegnie PRZED redesignem i PO nim. Porównujemy wynik, nie wrażenie.
// Co nagrywa: payload POST action:'add' (fetch jest podmieniony — nic nie trafia do bazy),
// alerty, confirm-y, dokąd prowadzi nawigacja po sukcesie, stan formularza po zapisie,
// jakie pola/ID istnieją, oraz co blokuje walidacja natywna przy pustym formularzu.
// Użycie: node odcisk.js <etykieta> <katalog_wyjściowy>   → <katalog>/odcisk-<etykieta>.json + zrzuty
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const ETYKIETA = process.argv[2] || 'x'; const OUT = process.argv[3] || '.';
const PROFIL = os.tmpdir() + '/est-od-' + Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  // Viewport jak makieta: 1663×946 (headless nie ma paska przeglądarki).
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9541','--window-size=1663,946','--lang=pl-PL','--user-data-dir=' + PROFIL,'about:blank'], { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:9541/json'); } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception || {}).description || '').split('\n')[0]); };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); if (r.result && r.result.exceptionDetails) throw new Error('EVAL: ' + (r.result.exceptionDetails.exception || {}).description); return r.result && r.result.result ? r.result.result.value : null; };
  const zrzut = async nazwa => { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + nazwa, Buffer.from(sh.result.data, 'base64')); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: B + '/index.html' }); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module','konsultacje']));`);
  await send('Page.reload', { ignoreCache: true }); await sleep(8000);

  // Podsłuch: alert/confirm nagrywane, POST action:'add' przechwycony (NIE idzie do serwera).
  await ev(`(function(){
    window.__od = { alerty: [], confirmy: [], posty: [], nawigacja: [] };
    window.alert = m => window.__od.alerty.push(String(m));
    window.confirm = m => { window.__od.confirmy.push(String(m)); return true; };
    const f = window.fetch;
    window.fetch = function(url, opt) {
      try { if (opt && opt.method === 'POST' && opt.body) { const b = JSON.parse(opt.body); if (b.action === 'add') { window.__od.posty.push(b); return Promise.resolve(new Response(JSON.stringify({status:'success',message:'(atrapa)'}), {status:200, headers:{'Content-Type':'application/json'}})); } } } catch(e){}
      return f.apply(this, arguments);
    };
    const p = window.pokaz; window.pokaz = function(id){ window.__od.nawigacja.push(id); return p.apply(this, arguments); };
  })()`);

  const PRZYCISK_NOWY = `document.querySelector("button[onclick*=\\"'nowy'\\"]")`;
  await ev(`pokaz('nowy', ${PRZYCISK_NOWY})`); await sleep(2500);
  const od = { etykieta: ETYKIETA, czas: new Date().toISOString() };

  // 1. Struktura: jakie pola istnieją, jakie mają typy/atrybuty walidacji.
  od.pola = JSON.parse(await ev(`JSON.stringify(['n_firma','n_model','n_nazwa','n_ilosc','n_typ','n_netto','n_brutto','n_min','n_waznosc'].map(id => { const e = document.getElementById(id); if (!e) return { id, brak: true };
    const r = e.getBoundingClientRect(); return { id, tag: e.tagName.toLowerCase(), type: e.type || null, required: e.required, min: e.min || null, step: e.step || null, disabled: e.disabled, readOnly: e.readOnly, widoczny: r.width > 0 && r.height > 0, opcji: e.options ? e.options.length : null }; }))`));
  od.kategoriaChecked = await ev(`(function(){ const r = document.querySelector('#nowy input[name="kategoria"]:checked'); return r ? r.value : null; })()`);
  od.kategoriaWidoczna = await ev(`(function(){ const r = document.querySelector('#nowy input[name="kategoria"]'); if(!r) return null; const b=r.getBoundingClientRect(); return b.width>0&&b.height>0; })()`);
  od.onsubmit = await ev(`(document.querySelector('#nowy form').getAttribute('onsubmit'))`);
  od.pomocSlot = await ev(`(function(){ const s=document.querySelector('#nowy .pk-slot'); return s ? s.getAttribute('data-pomoc') : null; })()`);
  od.przyciskSubmit = await ev(`(function(){ const b=document.querySelector('#nowy button[type="submit"]'); return b ? b.textContent.trim() : null; })()`);
  od.firmyWSlowniku = await ev(`document.getElementById('n_firma').options.length - 1`);
  await zrzut('odcisk-' + ETYKIETA + '-01-pusty.png');

  // 2. Pusty submit: natywna walidacja ma zatrzymać wysyłkę; JS nie dostaje zdarzenia.
  await ev(`document.querySelector('#nowy button[type="submit"]').click()`); await sleep(600);
  od.pustySubmit = { alerty: JSON.parse(await ev(`JSON.stringify(window.__od.alerty)`)), posty: await ev(`window.__od.posty.length`), formValid: await ev(`document.querySelector('#nowy form').checkValidity()`),
    pierwszeNiepoprawne: await ev(`(function(){ const e=document.querySelector('#nowy form :invalid'); return e ? e.id : null; })()`) };

  // 3. Dane referencyjne z makiety: firma+model z realnego słownika (pierwsza para), 6 szt., 80,00 / 98,40, 2027-12-31.
  await ev(`(function(){ const f=document.getElementById('n_firma'); f.selectedIndex = 1; f.dispatchEvent(new Event('change')); })()`); await sleep(300);
  await ev(`(function(){ const m=document.getElementById('n_model'); m.selectedIndex = 1; m.dispatchEvent(new Event('change')); })()`); await sleep(300);
  od.wybor = JSON.parse(await ev(`JSON.stringify({ firma: document.getElementById('n_firma').value, model: document.getElementById('n_model').value, nazwa: document.getElementById('n_nazwa').value, modelDisabled: document.getElementById('n_model').disabled, modeliDlaFirmy: document.getElementById('n_model').options.length - 1 })`));
  // zmiana firmy — czy model się czyści (relacja Firma→Model)
  await ev(`(function(){ const f=document.getElementById('n_firma'); f.selectedIndex = f.options.length > 2 ? 2 : 1; f.dispatchEvent(new Event('change')); })()`); await sleep(300);
  od.poZmianieFirmy = JSON.parse(await ev(`JSON.stringify({ firma: document.getElementById('n_firma').value, model: document.getElementById('n_model').value, nazwa: document.getElementById('n_nazwa').value })`));
  await ev(`(function(){ const f=document.getElementById('n_firma'); f.selectedIndex = 1; f.dispatchEvent(new Event('change')); const m=document.getElementById('n_model'); m.selectedIndex = 1; m.dispatchEvent(new Event('change')); })()`); await sleep(300);
  await ev(`(function(){ const s=(id,v)=>{ const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); };
    s('n_ilosc','6'); s('n_netto','80.00'); s('n_brutto','98.40'); s('n_waznosc','2027-12-31'); document.getElementById('n_typ').value='Kremy'; })()`); await sleep(400);
  od.typOpcje = JSON.parse(await ev(`JSON.stringify([...document.getElementById('n_typ').options].map(o => ({ v: o.value, t: o.textContent })))`));
  od.podsumowanie = await ev(`(function(){ const k=document.querySelector('#nowy .egr-summary'); return k ? k.innerText.replace(/\\s+/g,' ').trim() : null; })()`);
  await zrzut('odcisk-' + ETYKIETA + '-02-wypelniony.png');

  // 4. Zapis: liczba POST-ów przy dwukliku, treść payloadu, alert, nawigacja, stan po.
  await ev(`window.__od.alerty = []; window.__od.posty = []; window.__od.nawigacja = [];`);
  await ev(`(function(){ const b=document.querySelector('#nowy button[type="submit"]'); b.click(); b.click(); })()`); await sleep(1500);
  od.zapis = JSON.parse(await ev(`JSON.stringify({ posty: window.__od.posty, alerty: window.__od.alerty, nawigacja: window.__od.nawigacja,
    aktywnaSekcja: (document.querySelector('.section.active')||{}).id || null,
    poZapisie: { firma: document.getElementById('n_firma').value, model: document.getElementById('n_model').value, modelDisabled: document.getElementById('n_model').disabled, modeliOpcji: document.getElementById('n_model').options.length, nazwa: document.getElementById('n_nazwa').value, ilosc: document.getElementById('n_ilosc').value, netto: document.getElementById('n_netto').value, waznosc: document.getElementById('n_waznosc').value },
    submitTekst: (document.querySelector('#nowy button[type="submit"]')||{}).textContent, submitDisabled: (document.querySelector('#nowy button[type="submit"]')||{}).disabled })`));

  // 5. Walidacja JS (wołam handler wprost, z pominięciem natywnej): które alerty, czy coś wysłano.
  await ev(`pokaz('nowy', ${PRZYCISK_NOWY})`); await sleep(1500);
  od.walidacjaJS = JSON.parse(await ev(`(function(){ const wyniki = [];
    const f=document.getElementById('n_firma'); f.selectedIndex=1; f.dispatchEvent(new Event('change')); const m=document.getElementById('n_model'); m.selectedIndex=1; m.dispatchEvent(new Event('change'));
    const s=(id,v)=>{ document.getElementById(id).value=v; };
    const proba = (opis, ustaw) => { window.__od.alerty=[]; window.__od.posty=[]; m.selectedIndex=1; m.dispatchEvent(new Event('change')); s('n_ilosc','6'); s('n_netto','80'); s('n_brutto','98.40'); s('n_waznosc','2027-12-31'); ustaw(); dodajProdukt({ preventDefault(){}, target: document.querySelector('#nowy form') }); wyniki.push({ opis, alert: window.__od.alerty[0] || null, wyslano: window.__od.posty.length, payload: window.__od.posty[0] || null }); };
    proba('ilosc 0', () => s('n_ilosc','0'));
    proba('netto 0', () => s('n_netto','0'));
    proba('brak daty', () => s('n_waznosc',''));
    proba('brak modelu', () => { document.getElementById('n_model').value=''; });
    proba('poprawne, netto 80,50 z przecinkiem', () => s('n_netto','80,50'));
    return JSON.stringify(wyniki); })()`));
  od.bledyJS = errs.slice(0, 5);
  fs.writeFileSync(OUT + '/odcisk-' + ETYKIETA + '.json', JSON.stringify(od, null, 2));
  console.log(JSON.stringify(od, null, 2));
  ws.close(); ch.kill(); await sleep(800);
  // Profil headless potrafi ważyć >100 MB — 102 takie katalogi zapchały dziś dysk. Sprzątamy po sobie.
  try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('BLAD:', e.message); try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
