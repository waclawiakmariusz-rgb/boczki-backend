#!/usr/bin/env node
/*
  PRÓBA EKRANU — jedno narzędzie do automatycznych prób w przeglądarce (Chrome headless przez CDP, bez bibliotek).

  Co robi: loguje się do salonu, wchodzi w sekcję, wpisuje dane, klika, zmienia viewport i tryb ciemny,
  robi zrzuty w dowolnym momencie, nagrywa POST-y (payload), alerty, confirm-y, błędy JS i mierzy, czy coś
  wychodzi poza ekran. Wynik: katalog z PNG + raport.json + raport.md.

  Użycie:
    node narzedzia/proba-ekranu.js <scenariusz.json> [--srodowisko test|prod] [--produkcja-tak] [--zapis-tak] [--okno]

  Środowiska:
    test (domyślne)  http://localhost:3999, salon demo-test, izolowana MariaDB 3307. Zapisy wolno.
    prod             https://estelio.com.pl, salon demo. WYMAGA --produkcja-tak. Domyślnie TYLKO ODCZYT:
                     każdy POST z akcją spoza listy odczytów jest przechwytywany i NIE dociera do serwera.
                     --zapis-tak zdejmuje tę blokadę (użyj wyłącznie na wyraźne polecenie właściciela).

  Hasła: nigdy w repo. Pliki poza repozytorium:
    test: C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt
    prod: C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-prod.txt  (login salonu w pierwszej linii, hasło w drugiej)

  Scenariusz (JSON):
    {
      "nazwa": "rabaty",
      "sekcja": "sekcja-kreator-rabatow",            // pokaz('…') po zalogowaniu
      "korzen": "#sekcja-kreator-rabatow",           // do pomiaru „co wyszło poza ekran”
      "przechwyc": ["add_discount_def"],             // akcje POST, które mają NIE dotrzeć do serwera (odpowiedź-atrapa)
      "opoznienieAtrapy": 600,                       // ms — żeby złapać stan „w trakcie zapisu”
      "kroki": [
        { "viewport": [1663, 946] },
        { "wpisz": "#rabat-nazwa", "wartosc": "Urodziny" },
        { "wybierz": "#rabat-typ", "wartosc": "KWOTA" },   // select
        { "kliknij": "input[name=rb-typ-segment][value=KWOTA]" },
        { "czekaj": 300 },
        { "zrzut": "wypelniony" },
        { "kliknij": "button[onclick='zapiszDefinicjeRabatu()']", "dwuklik": true },
        { "czekaj": 200 }, { "zrzut": "w-trakcie-zapisu" }, { "czekaj": 1200 },
        { "js": "document.querySelector('#rabaty-licznik').textContent", "opis": "licznik" },
        { "sprawdz": "window.__proba.posty.length === 1", "opis": "jeden POST przy dwukliku" },
        { "ciemny": true }, { "zrzut": "ciemny" }, { "ciemny": false },
        { "viewport": [390, 844] }, { "zrzut": "telefon" },
        { "pomiar": true }
      ]
    }
*/
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ─── argumenty ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const plikScenariusza = argv.find(a => !a.startsWith('--'));
const flaga = n => argv.includes('--' + n);
const opcja = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
if (!plikScenariusza) { console.error('Użycie: node narzedzia/proba-ekranu.js <scenariusz.json> [--srodowisko test|prod] [--produkcja-tak] [--zapis-tak] [--okno]'); process.exit(2); }
const SRODOWISKO = opcja('srodowisko', 'test');
const SEKRETY = 'C:/Users/aaell/estelio-srodowisko-testowe';
const SRODOWISKA = {
  test: { baza: 'http://localhost:3999', login: 'demo-test', plikHasla: SEKRETY + '/haslo-salonu-demo-test.txt', pracownik: 'Ola', pin: '1111', rola: 'manager', zapisWolno: true },
  prod: { baza: 'https://estelio.com.pl', login: null, plikHasla: SEKRETY + '/haslo-salonu-demo-prod.txt', pracownik: null, pin: null, rola: 'manager', zapisWolno: false },
};
const ENV = SRODOWISKA[SRODOWISKO];
if (!ENV) { console.error('Nieznane środowisko: ' + SRODOWISKO); process.exit(2); }
if (SRODOWISKO === 'prod' && !flaga('produkcja-tak')) { console.error('Produkcja wymaga jawnego --produkcja-tak (i --zapis-tak, jeśli próba ma coś zapisać).'); process.exit(2); }
const ZAPIS_WOLNO = ENV.zapisWolno || flaga('zapis-tak');
// Na produkcji bez --zapis-tak przepuszczamy tylko akcje odczytowe; wszystko inne dostaje odpowiedź-atrapę.
const ODCZYTY_PROD = /^(login|verify_pin|get_|an_get_|akon_get_|rap_get|tk_list|tk_get|tk_licznik|pref_slownik$|pref_klientki$|pref_wielu$|loj_stan|get_pin_users|get_admin_users|get_targets|odp_getReportData|booksy_preview)/;

// ─── galeria HTML z wyniku (zrzuty z podpisem kroku + tabela) ──────────────
function galeriaHtml(r) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const zrzutyKroki = r.kroki.filter(k => k.plik);
  const fail = r.sprawdzenia.filter(s => s.wynik === 'FAIL').length + r.kroki.filter(k => k.blad).length;
  const wiersz = (a, b) => `<tr><th>${esc(a)}</th><td>${b}</td></tr>`;
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><title>Próba: ${esc(r.scenariusz)}</title>
<style>body{font:15px/1.45 system-ui,sans-serif;margin:0;padding:24px 32px;background:#faf8f5;color:#242126}h1{font-size:24px;margin:0 0 4px}.sub{color:#67616b;margin-bottom:18px}
.stan{display:inline-block;padding:4px 12px;border-radius:999px;font-weight:600;margin-left:8px}.ok{background:#e6f4ea;color:#1e6b3a}.zle{background:#fdecee;color:#9b1c2e}
table{border-collapse:collapse;background:#fff;border:1px solid #e7e1de;border-radius:12px;overflow:hidden;margin-bottom:28px}th,td{padding:8px 14px;text-align:left;vertical-align:top;border-bottom:1px solid #eee}th{color:#67616b;font-weight:500;white-space:nowrap}
.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:20px}figure{margin:0;background:#fff;border:1px solid #e7e1de;border-radius:14px;overflow:hidden}figure img{display:block;width:100%;height:auto;border-bottom:1px solid #eee}
figcaption{padding:10px 14px}figcaption b{display:block}figcaption small{color:#67616b}.steps{margin-top:28px;font-size:13px}.steps li{margin:3px 0}.steps .b{color:#9b1c2e}pre{background:#fff;border:1px solid #e7e1de;border-radius:12px;padding:12px;overflow:auto;font-size:12px}</style>
<h1>Próba: ${esc(r.scenariusz)} <span class="stan ${fail ? 'zle' : 'ok'}">${fail ? fail + ' problem(y)' : 'wszystko OK'}</span></h1>
<div class="sub">${esc(r.srodowisko)}${r.zapisWolno ? ', zapis wolno' : ', tylko odczyt'} · ${esc(r.czas)}</div>
<table>${wiersz('POST-y przechwycone', r.nagrane.posty.length + (r.nagrane.posty.length ? ' — ' + esc(r.nagrane.posty.map(p => p.action).join(', ')) : ''))}
${wiersz('POST-y zablokowane', String(r.nagrane.zablokowane.length))}${wiersz('Alerty', esc(r.nagrane.alerty.join(' | ')) || '—')}${wiersz('Confirm-y', esc(r.nagrane.confirmy.join(' | ')) || '—')}
${wiersz('Sprawdzenia', r.sprawdzenia.map(s => `<span class="stan ${s.wynik === 'PASS' ? 'ok' : 'zle'}" style="margin:2px 6px 2px 0">${s.wynik}</span>${esc(s.opis)}`).join('<br>') || '—')}
${wiersz('Błędy JS', r.bledyJS.length ? esc(r.bledyJS.join(' | ')) : 'brak')}</table>
<div class="g">${zrzutyKroki.map(k => { const i = r.kroki.indexOf(k); const prev = r.kroki.slice(Math.max(0, i - 4), i).filter(p => p.krok.wpisz || p.krok.kliknij || p.krok.wybierz || p.krok.viewport || p.krok.ciemny !== undefined).map(p => esc(JSON.stringify(p.krok)).slice(0, 70)).join(' · ');
    return `<figure><a href="${esc(k.plik)}" target="_blank"><img src="${esc(k.plik)}" alt="${esc(k.krok.zrzut)}" loading="lazy"></a><figcaption><b>${esc(k.plik)}</b><small>${prev || 'stan początkowy'}</small></figcaption></figure>`; }).join('')}</div>
<details class="steps"><summary>Wszystkie kroki (${r.kroki.length})</summary><ol>${r.kroki.map(k => `<li class="${k.blad ? 'b' : ''}">${esc(JSON.stringify(k.krok)).slice(0, 120)}${k.wynik !== undefined ? ' → <b>' + esc(typeof k.wynik === 'string' ? k.wynik : JSON.stringify(k.wynik)) + '</b>' : ''}${k.blad ? ' → BŁĄD: ' + esc(k.blad) : ''}</li>`).join('')}</ol></details>
<details class="steps"><summary>Payloady POST</summary><pre>${esc(JSON.stringify(r.nagrane.posty, null, 2))}</pre></details></html>`;
}
// Tryb: --galeria <katalog wyniku> — odbudowuje raport.html z raport.json bez ponownej próby
if (flaga('galeria')) { const dir = opcja('galeria'); const r = JSON.parse(fs.readFileSync(path.join(dir, 'raport.json'), 'utf8')); fs.writeFileSync(path.join(dir, 'raport.html'), galeriaHtml(r)); console.log('raport.html: ' + path.join(dir, 'raport.html')); process.exit(0); }

const scenariusz = JSON.parse(fs.readFileSync(plikScenariusza, 'utf8'));
const NAZWA = scenariusz.nazwa || path.basename(plikScenariusza, '.json');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const OUT = path.join(__dirname, '..', 'proby-wyniki', NAZWA + '-' + SRODOWISKO + '-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16));
fs.mkdirSync(OUT, { recursive: true });
const PROFIL = path.join(os.tmpdir(), 'est-proba-' + Date.now());
const PORT = 9550 + Math.floor(Math.random() * 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sprzatnij = () => { try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (e) {} };

// ─── logowanie przez API (tak jak robi to front) ───────────────────────────
function sekrety() {
  if (!fs.existsSync(ENV.plikHasla)) throw new Error('Brak pliku z hasłem: ' + ENV.plikHasla);
  const linie = fs.readFileSync(ENV.plikHasla, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (SRODOWISKO === 'test') return { login: ENV.login, haslo: linie[0], pracownik: ENV.pracownik, pin: ENV.pin };
  // prod: login / hasło / pracownik / PIN — każde w osobnej linii
  if (linie.length < 4) throw new Error('Plik ' + ENV.plikHasla + ' ma mieć 4 linie: login salonu, hasło, imię pracownika, PIN.');
  return { login: linie[0], haslo: linie[1], pracownik: linie[2], pin: linie[3] };
}
const post = (b, h = {}) => fetch(ENV.baza + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());
const getJson = u => new Promise((res, rej) => (u.startsWith('https') ? https : http).get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const S = sekrety();
  const l = await post({ action: 'login', login: S.login, haslo: S.haslo });
  if (!l || !l.session_token) throw new Error('Logowanie nie powiodło się: ' + JSON.stringify(l).slice(0, 200));
  const v = await post({ action: 'verify_pin', tenant_id: S.login, imie: S.pracownik, pin: S.pin }, { 'x-session-token': l.session_token });
  if (!v || !v.session_token) throw new Error('PIN nie przyjęty: ' + JSON.stringify(v).slice(0, 200));

  // ─── Chrome + CDP ─────────────────────────────────────────────────────────
  const [w0, h0] = (scenariusz.kroki.find(k => k.viewport) || { viewport: [1663, 946] }).viewport;
  const args = [flaga('okno') ? '' : '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--lang=pl-PL',
    '--remote-debugging-port=' + PORT, '--window-size=' + w0 + ',' + h0, '--user-data-dir=' + PROFIL, 'about:blank'].filter(Boolean);
  const ch = spawn(CHROME, args, { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 60 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:' + PORT + '/json'); } catch (e) {} }
  if (!t) throw new Error('Chrome nie wystartował (' + CHROME + ')');
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map(); const bledyJS = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') bledyJS.push(((d.params.exceptionDetails.exception || {}).description || '').split('\n')[0]); };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); if (r.result && r.result.exceptionDetails) throw new Error('JS: ' + ((r.result.exceptionDetails.exception || {}).description || '').split('\n')[0]); return r.result && r.result.result ? r.result.result.value : null; };
  const zrzut = async n => { const sh = await send('Page.captureScreenshot', { format: 'png' }); const f = String(zrzuty.length + 1).padStart(2, '0') + '-' + n + '.png'; fs.writeFileSync(path.join(OUT, f), Buffer.from(sh.result.data, 'base64')); zrzuty.push(f); return f; };
  const zrzuty = []; const raport = { scenariusz: NAZWA, srodowisko: SRODOWISKO, zapisWolno: ZAPIS_WOLNO, czas: new Date().toISOString(), kroki: [], sprawdzenia: [] };
  const q = s => JSON.stringify(s);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: ENV.baza + '/index.html' }); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${q(S.login)}); localStorage.setItem('boczki_session_token', ${q(v.session_token)}); localStorage.setItem('boczki_user', ${q(S.login)}); localStorage.setItem('boczki_pracownik_imie', ${q(S.pracownik)}); localStorage.setItem('boczki_pracownik_rola', ${q(ENV.rola)}); if(!localStorage.getItem('boczki_features')) localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module','konsultacje']));`);
  await send('Page.reload', { ignoreCache: true }); await sleep(scenariusz.czekajPoStarcie || 8000);

  // Podsłuch w stronie: alerty, confirm-y, POST-y. Przechwycone akcje dostają atrapę i NIE idą do serwera.
  const przechwyc = scenariusz.przechwyc || [];
  await ev(`(function(){
    window.__proba = { alerty: [], confirmy: [], posty: [], zablokowane: [] };
    window.alert = m => window.__proba.alerty.push(String(m));
    window.confirm = m => { window.__proba.confirmy.push(String(m)); return ${scenariusz.confirmOdpowiedz === false ? 'false' : 'true'}; };
    const przechwyc = ${q(przechwyc)}, zapisWolno = ${ZAPIS_WOLNO}, odczyty = ${ODCZYTY_PROD.toString()}, opoz = ${Number(scenariusz.opoznienieAtrapy || 0)};
    const atrapa = (b, pow) => new Promise(res => setTimeout(() => res(new Response(JSON.stringify({ status: 'success', message: '(atrapa: ' + pow + ')' }), { status: 200, headers: { 'Content-Type': 'application/json' } })), opoz));
    const f = window.fetch;
    window.fetch = function (url, opt) {
      try {
        if (opt && opt.method === 'POST' && opt.body) {
          const b = JSON.parse(opt.body);
          if (przechwyc.includes(b.action)) { window.__proba.posty.push(b); return atrapa(b, 'przechwycone'); }
          if (!zapisWolno && !odczyty.test(String(b.action || ''))) { window.__proba.zablokowane.push(b); return atrapa(b, 'produkcja tylko do odczytu'); }
        }
      } catch (e) {}
      return f.apply(this, arguments);
    };
  })()`);

  if (scenariusz.sekcja) { await ev(`pokaz(${q(scenariusz.sekcja)}, document.querySelector('.sidebar button[onclick*="\\'' + ${q(scenariusz.sekcja)} + '\\'"]') || null)`); await sleep(scenariusz.czekajPoSekcji || 2500); }

  const POMIAR = korzen => `(function(){ const s=document.querySelector(${q(korzen)}); if(!s) return JSON.stringify({brakKorzenia:true}); const R=s.getBoundingClientRect(); const mc=document.querySelector('.main-content')||document.documentElement;
    const poza=[...s.querySelectorAll('input,select,button,textarea,h1,h2,[class*=card],[class*=karta],[class*=badge]')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && (r.right>R.right+1 || r.left<R.left-1);}).map(e=>(e.id||e.className||e.tagName).toString().slice(0,40));
    return JSON.stringify({ kontener: Math.round(R.width), poza, poziomyScroll: mc.scrollWidth > mc.clientWidth + 1 }); })()`;

  // ─── kroki ────────────────────────────────────────────────────────────────
  const zdarzenia = sel => `(function(){ const e=document.querySelector(${q(sel)}); if(!e) throw new Error('brak elementu ' + ${q(sel)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`;
  for (const k of scenariusz.kroki) {
    const wpis = { krok: k };
    try {
      if (k.viewport) { const [w, h, dsf] = k.viewport; await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf || 1, mobile: w < 500 }); await sleep(500); }
      else if (k.wpisz) { await ev(`(function(){ const e=document.querySelector(${q(k.wpisz)}); if(!e) throw new Error('brak elementu ' + ${q(k.wpisz)}); e.value=${q(String(k.wartosc ?? ''))}; })()`); await ev(zdarzenia(k.wpisz)); }
      // wybierz: wartość opcji, a gdy takiej nie ma — numer opcji (np. "1" = pierwsza pozycja po placeholderze)
      else if (k.wybierz) { await ev(`(function(){ const e=document.querySelector(${q(k.wybierz)}); if(!e) throw new Error('brak elementu ' + ${q(k.wybierz)}); const w=${q(String(k.wartosc ?? ''))}; e.value=w; if(e.value!==w && /^\\d+$/.test(w)) e.selectedIndex=Number(w); })()`); await ev(zdarzenia(k.wybierz)); }
      else if (k.kliknij) { await ev(`(function(){ const e=document.querySelector(${q(k.kliknij)}); if(!e) throw new Error('brak elementu ' + ${q(k.kliknij)}); e.click(); ${k.dwuklik ? 'e.click();' : ''} })()`); }
      else if (k.klawisz) { for (const typ of ['rawKeyDown', 'char', 'keyUp']) await send('Input.dispatchKeyEvent', { type: typ, key: k.klawisz, code: k.klawisz, text: k.klawisz === 'Enter' ? String.fromCharCode(13) : undefined, windowsVirtualKeyCode: k.klawisz === 'Escape' ? 27 : k.klawisz === 'Enter' ? 13 : 0 }); }
      else if (k.czekaj) { await sleep(k.czekaj); }
      else if (k.zrzut) { wpis.plik = await zrzut(k.zrzut); }
      else if (k.ciemny !== undefined) { await ev(`document.body.classList.${k.ciemny ? 'add' : 'remove'}('dark-mode')`); await sleep(400); }
      else if (k.pokaz) { await ev(`pokaz(${q(k.pokaz)}, null)`); await sleep(k.czekajPo || 1500); }
      else if (k.js) { wpis.wynik = await ev(k.js); }
      else if (k.sprawdz) { const ok = !!(await ev(k.sprawdz)); wpis.wynik = ok ? 'PASS' : 'FAIL'; raport.sprawdzenia.push({ opis: k.opis || k.sprawdz, wynik: wpis.wynik }); }
      else if (k.pomiar) { wpis.wynik = JSON.parse(await ev(POMIAR(k.korzen || scenariusz.korzen || 'body'))); }
      else { wpis.wynik = 'nieznany krok'; }
    } catch (e) { wpis.blad = e.message; }
    raport.kroki.push(wpis);
    const opis = k.opis ? ' (' + k.opis + ')' : '';
    console.log((wpis.blad ? 'BŁĄD ' : '  ok  ') + JSON.stringify(k).slice(0, 90) + opis + (wpis.wynik !== undefined ? ' → ' + (typeof wpis.wynik === 'string' ? wpis.wynik : JSON.stringify(wpis.wynik)) : '') + (wpis.plik ? ' → ' + wpis.plik : '') + (wpis.blad ? ' → ' + wpis.blad : ''));
  }

  raport.nagrane = JSON.parse(await ev(`JSON.stringify(window.__proba)`));
  raport.bledyJS = bledyJS.slice(0, 20);
  raport.zrzuty = zrzuty;
  fs.writeFileSync(path.join(OUT, 'raport.json'), JSON.stringify(raport, null, 2));
  const md = ['# Próba: ' + NAZWA + ' (' + SRODOWISKO + (ZAPIS_WOLNO ? ', zapis wolno' : ', tylko odczyt') + ') — ' + raport.czas, '',
    '| Co | Wynik |', '|---|---|',
    '| POST-y przechwycone | ' + raport.nagrane.posty.length + (raport.nagrane.posty.length ? ' — ' + raport.nagrane.posty.map(p => p.action).join(', ') : '') + ' |',
    '| POST-y zablokowane (produkcja) | ' + raport.nagrane.zablokowane.length + ' |',
    '| Alerty | ' + (raport.nagrane.alerty.map(a => '„' + a + '”').join('; ') || '—') + ' |',
    '| Confirm-y | ' + (raport.nagrane.confirmy.map(a => '„' + a + '”').join('; ') || '—') + ' |',
    '| Sprawdzenia | ' + (raport.sprawdzenia.map(s => s.wynik + ': ' + s.opis).join('; ') || '—') + ' |',
    '| Błędy JS | ' + (bledyJS.length ? bledyJS.slice(0, 5).join('; ') : 'brak') + ' |',
    '| Zrzuty | ' + zrzuty.join(', ') + ' |', '',
    '## Payloady', '```json', JSON.stringify(raport.nagrane.posty, null, 2), '```'].join('\n');
  fs.writeFileSync(path.join(OUT, 'raport.md'), md);
  fs.writeFileSync(path.join(OUT, 'raport.html'), galeriaHtml(raport));
  const fail = raport.sprawdzenia.filter(s => s.wynik === 'FAIL').length + raport.kroki.filter(k => k.blad).length;
  console.log('\nWynik: ' + OUT + '\nsprawdzenia FAIL: ' + raport.sprawdzenia.filter(s => s.wynik === 'FAIL').length + ' | kroki z błędem: ' + raport.kroki.filter(k => k.blad).length + ' | błędy JS: ' + bledyJS.length + ' | zrzutów: ' + zrzuty.length);
  ws.close(); ch.kill(); await sleep(800); sprzatnij(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('BŁĄD: ' + e.message); sprzatnij(); process.exit(1); });
