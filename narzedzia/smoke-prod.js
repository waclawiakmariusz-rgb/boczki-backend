// narzedzia/smoke-prod.js — test dymny PO KAŻDYM WDROŻENIU (reguła z 2026-10-10: „nic nie może
// okazać się zepsute, a działało"). Chrome headless + CDP, bez dodatkowych pakietów (Node ≥ 22).
//
// Sprawdza na żywym serwerze:
//   1. nagłówek CSP nie blokuje żadnego zasobu (skrypty, style, fonty, piksele) — Log.entryAdded
//   2. Chart.js i Sortable są załadowane (typeof === 'function')
//   3. zero nieobsłużonych wyjątków JS podczas startu aplikacji i otwierania widoków
//   4. Analiza → Miesiąc renderuje liczby (nie „Wystąpił błąd krytyczny"), Pracownik/Rok/BI się otwierają
//   5. /pomoc/ i /pomoc-manager/ odpowiadają 200
//
// Użycie (hasło TYLKO z env, nigdy w repo):
//   PROFIL_LOGIN=demo PROFIL_HASLO=... node narzedzia/smoke-prod.js                         # produkcja
//   B=http://127.0.0.1:3999 PROFIL_LOGIN=demo PROFIL_HASLO=... node narzedzia/smoke-prod.js  # lokalnie
//   opcjonalnie TENANT=demo-estelio, CHROME=ścieżka do chrome.exe
// Kod wyjścia 1 = coś nie gra; wynik wklej użytkownikowi ZANIM powiesz, że wdrożenie jest OK.
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

const CHROME = process.env.CHROME || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PORT = 9337;
const B = process.env.B || 'https://estelio.com.pl';
const TENANT = process.env.TENANT || 'demo-estelio';
const WIDOKI = ['monthly_report', 'dashboard', 'yearly', 'bi', 'treatment_analysis', 'analiza-konsultacji'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => http.get(url, (res) => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject));
const problemy = [];
const ok = (msg) => console.log('  ✓ ' + msg);
const zle = (msg) => { problemy.push(msg); console.log('  ✗ ' + msg); };

async function main() {
  if (!process.env.PROFIL_HASLO) throw new Error('Podaj PROFIL_HASLO (i PROFIL_LOGIN) w env — hasła nie trzymamy w kodzie.');
  console.log('Smoke test:', B, '| tenant:', TENANT);

  // 0. strony statyczne
  for (const p of ['/zaloguj', '/pomoc/', '/pomoc-manager/', '/lib/chart.umd.min.js', '/lib/Sortable.min.js']) {
    try { const r = await fetch(B + p); r.ok ? ok(`${p} → ${r.status}`) : zle(`${p} → HTTP ${r.status}`); } catch (e) { zle(`${p} → ${e.message}`); }
  }

  // 1. sesja przez API
  const post = (body, headers = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(r => r.json());
  const login = await post({ action: 'login', login: process.env.PROFIL_LOGIN || 'demo', haslo: process.env.PROFIL_HASLO });
  if (login.status !== 'success') throw new Error('login: ' + JSON.stringify(login));
  const tok = login.session_token;
  const users = await post({ action: 'get_pin_users', tenant_id: TENANT }, { 'x-session-token': tok });
  const prac = (Array.isArray(users) ? users : []).find(u => /manager|megaadmin|admin/i.test(u.rola)) || users[0];
  if (!prac) throw new Error('brak pracownika w tenancie ' + TENANT);
  ok(`login API i pracownik ${prac.imie}/${prac.rola}`);
  const months = await post({ action: 'get_months', tenant_id: TENANT }, { 'x-session-token': tok });
  const miesiac = (months.months || [])[0];
  miesiac ? ok(`get_months → ${months.months.length} miesięcy`) : zle('get_months: brak miesięcy');

  // 2. przeglądarka
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`, '--window-size=1400,1000', '--user-data-dir=' + os.tmpdir() + '/estelio-smoke-chrome', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); } catch (e) {} }
    if (!targets) throw new Error('Chrome nie wystartował (sprawdź ścieżkę CHROME)');
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    const csp = [], wyjatki = [], bledyKonsoli = [], failed = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
      if (d.method === 'Log.entryAdded') { const e = d.params.entry; if (/Content Security Policy/.test(e.text)) csp.push(e.text.slice(0, 160)); else if (e.level === 'error' && e.source === 'network' && !/icon\.png/.test(e.url || '')) failed.push((e.url || '') + ' ' + e.text.slice(0, 80)); }
      else if (d.method === 'Runtime.exceptionThrown') { const ex = d.params.exceptionDetails; wyjatki.push(((ex.exception && ex.exception.description) || ex.text || '').split('\n').slice(0, 2).join(' | ')); }
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') { bledyKonsoli.push(d.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 200)); }
    };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { returnByValue: true, expression: expr }); return r.result && r.result.result && r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

    await send('Page.navigate', { url: B + '/index.html' }); await sleep(3500);
    await send('Runtime.evaluate', { expression: `
      localStorage.setItem('boczki_tenant_id', ${JSON.stringify(TENANT)});
      localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)});
      localStorage.setItem('boczki_user', 'megaadmin');
      localStorage.setItem('boczki_pracownik_imie', ${JSON.stringify(prac.imie)});
      localStorage.setItem('boczki_pracownik_rola', ${JSON.stringify(prac.rola)});
      localStorage.setItem('boczki_features', '[]'); 'ok'` });
    await send('Page.reload', { ignoreCache: true }); await sleep(9000);

    const start = await evalJs(`({ chart: typeof Chart, sortable: typeof Sortable, app: !!document.getElementById('app-container') && document.getElementById('app-container').style.display !== 'none', wersja: (document.querySelector('.ds-wersja')||{}).textContent })`);
    start.app ? ok('aplikacja wystartowała po F5 z sesją (' + (start.wersja || 'bez wersji') + ')') : zle('aplikacja NIE wystartowała (app-container ukryty)');
    start.chart === 'function' ? ok('Chart.js załadowany') : zle('Chart.js NIE załadowany (typeof Chart = ' + start.chart + ')');
    start.sortable === 'function' ? ok('Sortable załadowany') : zle('Sortable NIE załadowany');

    for (const w of WIDOKI) {
      const przed = wyjatki.length + bledyKonsoli.length;
      await send('Runtime.evaluate', { expression: `try { pokaz(${JSON.stringify(w)}); } catch (e) { console.error('pokaz(${w}):', e.message); } 'ok'` });
      await sleep(w === 'monthly_report' ? 7000 : 3500);
      const nowe = wyjatki.length + bledyKonsoli.length - przed;
      if (w === 'monthly_report') {
        const m = await evalJs(`({ total: (document.getElementById('an_rep-total')||{}).innerText, opcji: (document.getElementById('an_reportMonthSelect')||{options:[]}).options.length })`);
        (/zł/.test(m.total || '') && !/błąd/i.test(m.total || '')) ? ok(`Analiza → Miesiąc: total „${m.total}", ${m.opcji} miesięcy`) : zle(`Analiza → Miesiąc: „${m.total}" (opcji: ${m.opcji})`);
      } else {
        nowe === 0 ? ok(`widok ${w}: bez błędów`) : zle(`widok ${w}: ${nowe} nowych błędów`);
      }
    }

    ws.close();
    csp.length === 0 ? ok('CSP: zero zablokowanych zasobów') : zle(`CSP zablokowała ${csp.length} zasobów:\n      ` + [...new Set(csp)].slice(0, 6).join('\n      '));
    wyjatki.length === 0 ? ok('zero nieobsłużonych wyjątków JS') : zle(`${wyjatki.length} wyjątków JS:\n      ` + [...new Set(wyjatki)].slice(0, 6).join('\n      '));
    failed.length === 0 ? ok('zero nieudanych zasobów sieciowych') : zle(`${failed.length} nieudanych zasobów:\n      ` + [...new Set(failed)].slice(0, 6).join('\n      '));
    if (bledyKonsoli.length) console.log('  ℹ console.error (' + bledyKonsoli.length + '):\n      ' + [...new Set(bledyKonsoli)].slice(0, 6).join('\n      '));
  } finally { try { chrome.kill(); } catch (e) {} }

  console.log(problemy.length ? `\nWYNIK: ${problemy.length} PROBLEM(ÓW) — NIE mów, że wdrożenie jest OK.` : '\nWYNIK: OK — wszystkie sprawdzenia przeszły.');
  process.exit(problemy.length ? 1 : 0);
}
main().catch(e => { console.error('BLAD:', e.message); process.exit(1); });
