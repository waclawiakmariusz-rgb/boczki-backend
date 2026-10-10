// narzedzia/profil-startu.js — profil startu aplikacji Estelio w Chrome headless (CDP, bez pakietów;
// Node ≥ 22 ma wbudowany WebSocket). Loguje się przez API, wstrzykuje sesję do localStorage,
// przeładowuje stronę (ścieżka F5 = pełny start aplikacji) i zbiera: long tasks, profil CPU
// (self-time per funkcja), czasy wywołań API, koszt wybranych funkcji renderujących.
//
// Użycie (hasło TYLKO z env, nigdy w repo):
//   PROFIL_LOGIN=demo PROFIL_HASLO=... node narzedzia/profil-startu.js                  # produkcja
//   B=http://127.0.0.1:3999 PROFIL_LOGIN=demo PROFIL_HASLO=... node narzedzia/profil-startu.js   # lokalnie
//   opcjonalnie TENANT=demo-estelio, CHROME=ścieżka do chrome.exe
//
// Dodane 2026-10-10 po znalezieniu 10,6 s blokady karty w renderTabelaZabiegow (innerHTML += w pętli).
// Uruchamiaj po każdej większej zmianie w index.html — „Czekaj" w przeglądarce to długie zadanie JS,
// a ten skrypt wskazuje funkcję i linię.
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');

const CHROME = process.env.CHROME || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const B = process.env.B || 'https://estelio.com.pl';
const TENANT = process.env.TENANT || 'demo-estelio';
const PROFIL_S = 14;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getJson = (url) => new Promise((resolve, reject) => http.get(url, (res) => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject));

async function main() {
  if (!process.env.PROFIL_HASLO) throw new Error('Podaj PROFIL_HASLO (i PROFIL_LOGIN) w env — hasła nie trzymamy w kodzie.');
  const post = (body, headers = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(r => r.json());
  const login = await post({ action: 'login', login: process.env.PROFIL_LOGIN || 'demo', haslo: process.env.PROFIL_HASLO });
  if (login.status !== 'success') throw new Error('login: ' + JSON.stringify(login));
  const tok = login.session_token;
  const users = await post({ action: 'get_pin_users', tenant_id: TENANT }, { 'x-session-token': tok });
  const prac = (Array.isArray(users) ? users : []).find(u => /manager|megaadmin|admin/i.test(u.rola)) || users[0];
  if (!prac) throw new Error('brak pracownika w tenancie ' + TENANT);
  console.log('sesja OK, tenant:', TENANT, '| pracownik:', prac.imie, '/', prac.rola, '| cel:', B);

  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${PORT}`, '--window-size=1400,900', '--user-data-dir=' + os.tmpdir() + '/estelio-profil-chrome', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 40 && !targets; i++) { await sleep(250); try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); } catch (e) {} }
    if (!targets) throw new Error('Chrome nie wystartował (sprawdź ścieżkę CHROME)');
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Profiler.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__lt = []; window.__errs = [];
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
      window.addEventListener('error', e => window.__errs.push(String(e.message).slice(0, 160)));
    ` });

    await send('Page.navigate', { url: B + '/index.html' });
    await sleep(4000);
    await send('Runtime.evaluate', { expression: `
      localStorage.setItem('boczki_tenant_id', ${JSON.stringify(TENANT)});
      localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)});
      localStorage.setItem('boczki_user', 'megaadmin');
      localStorage.setItem('boczki_pracownik_imie', ${JSON.stringify(prac.imie)});
      localStorage.setItem('boczki_pracownik_rola', ${JSON.stringify(prac.rola)});
      localStorage.setItem('boczki_features', '[]');
      'ok'` });

    await send('Profiler.setSamplingInterval', { interval: 500 });
    await send('Profiler.start');
    await send('Page.reload', { ignoreCache: true });
    await sleep(PROFIL_S * 1000);
    const prof = await send('Profiler.stop');

    const ev = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const res = performance.getEntriesByType('resource');
      const api = res.filter(r => r.name.includes('/api')).map(r => ({ n: r.name.replace(location.origin, '').replace(/tenant_id=[^&]*/, 'tenant_id=…').slice(0, 70), ms: Math.round(r.duration), kb: Math.round((r.transferSize || 0) / 1024) })).sort((a, b) => b.ms - a.ms);
      const dl = document.getElementById('lista-klientow');
      let tDatalist = null, tKafelki = null;
      try { const a = performance.now(); zaktualizujDataliste(window.wszyscyKlienciDane || []); tDatalist = Math.round(performance.now() - a); } catch (e) { tDatalist = 'ERR ' + e.message; }
      try { const k = document.getElementById('lista-klientow-widok'); const a = performance.now(); renderujKafelkiKlientow(window.wszyscyKlienciDane || [], k); tKafelki = Math.round(performance.now() - a); } catch (e) { tKafelki = 'ERR ' + e.message; }
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0),
        htmlKB: Math.round((nav.transferSize || 0) / 1024), zasoby: res.length, apiCalls: api.length, apiTop: api.slice(0, 12),
        klientow: (window.wszyscyKlienciDane || []).length, opcjiDatalist: dl ? dl.options.length : null,
        longTasks: window.__lt, longTotal: window.__lt.reduce((s, x) => s + x.dur, 0), errs: window.__errs,
        tDatalistMs: tDatalist, tKafelkiMs: tKafelki,
        czyApp: !!(document.getElementById('app-container') && document.getElementById('app-container').style.display !== 'none'),
      };
    })()` });
    const m = ev.result && ev.result.result && ev.result.result.value;
    if (!m) { console.log('EVAL:', JSON.stringify(ev).slice(0, 700)); throw new Error('brak wyniku evaluate'); }
    console.log('\n=== START APLIKACJI (reload z sesją) ===');
    console.log('DOMContentLoaded:', m.domContentLoaded, 'ms | load:', m.load, 'ms | HTML:', m.htmlKB, 'KB | zasobów:', m.zasoby, '| wywołań API:', m.apiCalls);
    console.log('aplikacja widoczna:', m.czyApp, '| klientów w cache:', m.klientow, '| opcji datalist:', m.opcjiDatalist);
    console.log('LONG TASKS (>50 ms) w pierwszych', PROFIL_S, 's:', m.longTasks.length, 'szt., łącznie', m.longTotal, 'ms');
    m.longTasks.slice(0, 15).forEach(t => console.log('   @' + t.start + 'ms  ' + t.dur + 'ms'));
    console.log('koszt zaktualizujDataliste():', m.tDatalistMs, 'ms | renderujKafelkiKlientow():', m.tKafelkiMs, 'ms');
    console.log('najwolniejsze API:'); m.apiTop.forEach(a => console.log('   ' + String(a.ms).padStart(5) + ' ms ' + String(a.kb).padStart(5) + ' KB  ' + a.n));
    if (m.errs.length) console.log('błędy JS:', m.errs.slice(0, 5));

    const p = prof.result.profile; const dt = p.timeDeltas; const nodes = new Map(p.nodes.map(n => [n.id, n]));
    const self = new Map(); let total = 0;
    for (let i = 0; i < p.samples.length; i++) { const n = nodes.get(p.samples[i]); const d = dt[i] || 0; total += d; const cf = n.callFrame; const key = (cf.functionName || '(anonim)') + ' @ ' + (cf.url ? cf.url.replace(B, '') : '') + ':' + cf.lineNumber; self.set(key, (self.get(key) || 0) + d); }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22);
    console.log('\n=== PROFIL CPU — self time (łącznie próbkowano', Math.round(total / 1000), 'ms) ===');
    top.forEach(([k, v]) => console.log('  ' + String(Math.round(v / 1000)).padStart(6) + ' ms  ' + k));
    ws.close();
  } finally { try { chrome.kill(); } catch (e) {} }
}
main().catch(e => { console.error('BLAD:', e.message); process.exit(1); });
