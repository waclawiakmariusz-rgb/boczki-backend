// narzedzia/testy-integracyjne/kandydat-sesja-odczyty.js — próby wydania „odczyty tylko z sesją” (2026-10-18) na KANDYDACIE
// uruchomionym lokalnie na izolowanej bazie, przez rzeczywiste trasy HTTP. Nic nie zapisuje poza bazą izolowaną.
//   node narzedzia/testy-integracyjne/kandydat-sesja-odczyty.js --haslo <plik z hasłem salonu demo-test> [--b http://localhost:3999] [--wynik plik.json]
// Odmawia pracy na adresie innym niż localhost. Tryb --prod-odczyt <https://host> (osobno): WYŁĄCZNIE próby, które nie wymagają sesji
// i nie zwracają danych przy poprawnym działaniu (oczekiwane 403/404) — do kontroli po wdrożeniu na salonie demo.
const fs = require('fs');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const PROD = arg('--prod-odczyt');
const B = PROD || arg('--b') || 'http://localhost:3999'; const TENANT = PROD ? 'demo-estelio' : 'demo-test'; const OBCY = 'zk02-test';
if (!PROD && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) { console.error('ODMOWA: próby zapisujące tylko na localhost. Podano: ' + B); process.exit(2); }
const wyniki = []; let fail = 0;
const zapisz = (id, wynik, opis, dowod) => { wyniki.push({ id, wynik, opis, dowod: dowod ? String(dowod).slice(0, 300) : undefined }); if (wynik === 'FAIL') fail++; console.log(`${wynik.padEnd(4)} ${id} — ${opis}${dowod ? ' · ' + String(dowod).slice(0, 150) : ''}`); };
const sprawdz = (id, ok, opis, dowod) => zapisz(id, ok ? 'PASS' : 'FAIL', opis, dowod);
const req = async (metoda, sciezka, { tok, body, headers } = {}) => { const r = await fetch(B + sciezka, { method: metoda, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tok ? { 'x-session-token': tok } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'follow' }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { st: r.status, j, t }; };
const brakDanych = (r) => !r.j || (!Array.isArray(r.j) && !Object.values(r.j).some(v => Array.isArray(v) && v.length > 0));

(async () => {
  // ── 1. Prywatne odczyty BEZ tokenu → 403, bez danych (to była luka) ─────────────────────────────────────
  const prywatne = [
    ['GET', `/api/klienci?action=get_clients&tenant_id=${TENANT}`, 'lista klientek'],
    ['GET', `/api?action=get_clients&tenant_id=${TENANT}`, 'lista klientek przez dispatcher GET (redirect)'],
    ['GET', `/api/sprzedaz?action=full_sales_history&tenant_id=${TENANT}&id_klienta=1001`, 'historia sprzedaży'],
    ['GET', `/api/klienci?action=get_all_deposits&tenant_id=${TENANT}`, 'portfele/zadatki'],
    ['GET', `/api/users?action=get_pin_users&tenant_id=${TENANT}`, 'pracownicy'],
    ['GET', `/api/rodo?action=get_all_rodo&tenant_id=${TENANT}`, 'zgody RODO / baza SMS'],
    ['GET', `/api/get_system_logs?tenant_id=${TENANT}`, 'logi systemowe'],
    ['GET', `/api/foto?action=foto_sesje&tenant_id=${TENANT}`, 'sesje zdjęciowe'],
    ['GET', `/api/zgody?action=zgody_lista&tenant_id=${TENANT}`, 'zgody płatności'],
    ['GET', `/api/lojalnosc?action=loj_czlonkowie&tenant_id=${TENANT}`, 'członkowie Klubu'],
    ['GET', `/api/dokumenty_dodatkowe?tenant_id=${TENANT}`, 'dokumenty dodatkowe'],
    ['GET', `/api/analityka?action=get_bi_data&tenant_id=${TENANT}`, 'analityka BI'],
    ['GET', `/api/features?tenant_id=${TENANT}`, 'dodatki salonu'],
  ];
  for (const [m, s, opis] of prywatne) { const r = await req(m, s); sprawdz('SO-1', r.st === 403 && brakDanych(r), `bez tokenu: ${opis} → 403 bez danych`, `${m} ${s.split('&')[0]} → ${r.st} ${String(r.t).slice(0, 60)}`); }
  const dbs = await req('GET', '/dbstatus');
  sprawdz('SO-1b', dbs.st === 404, '/dbstatus bez tokenu admina → 404 (wcześniej host i nazwa bazy)', `${dbs.st}`);

  // ── 2. Publiczne wywołania stron bez logowania NIE są blokowane strażnikiem (odpowiedź ≠ 403 SESJA) ─────
  const publiczne = [
    ['GET', '/api/foto/mobile-info?t=zly-token', 'foto.html: info z QR (zły token → błąd własny, nie 403 sesji)'],
    ['GET', '/api/foto/urzadzenie?dt=zly', 'foto.html: sparowany telefon'],
    ['POST', '/api/foto/dzien', 'foto.html: potwierdzenie dnia PIN-em', { dt: 'zly', pracownik: 'X', pin: '0000' }],
    ['GET', '/api/zgoda/info?t=zly-token', 'platnosc.html: zgoda z linku'],
    ['POST', '/api/zgoda/akceptuj', 'platnosc.html: akceptacja', { t: 'zly', imie_nazwisko: 'X', telefon: '0' }],
    ['POST', '/api/klub/info', 'klub.html: aplikacja klientki', {}],
    ['POST', '/api/klub/login', 'klub.html: logowanie Klubu', {}],
    ['GET', '/api/klub/img/demo-test/brak.jpg', 'klub.html: obrazek nagrody'],
    ['GET', '/api/stripe/config', 'zamow.html: konfiguracja Stripe'],
    ['GET', '/api/gus?nip=0000000000', 'zamow.html: GUS'],
    ['GET', '/api/voucher/weryfikuj?kod=X', 'zamow.html: voucher'],
    ['GET', '/api/rejestracja/check-login?login=x', 'rejestracja.html: login wolny?'],
    ['GET', '/api/predef/zabiegi', 'rejestracja.html: katalog zabiegów'],
    ['GET', '/api/reset-hasla/weryfikuj?token=x', 'reset-hasla.html'],
    ['GET', '/api/blog/posts', 'blog.html'],
    ['GET', '/api/help-kb/global', 'czat pomocy: baza globalna'],
    ['POST', '/api/magda/login', 'magda.html: logowanie księgowej', { haslo: 'x' }],
    ['POST', '/api/billing/login', 'billing.html', { login: 'x', haslo: 'x' }],
    ['POST', '/api/admin/login', 'admin.html', { token: 'x' }],
  ];
  for (const [m, s, opis, body] of publiczne) { const r = await req(m, s, { body }); const zablokowane = r.st === 403 && r.j && r.j.code === 'SESJA'; sprawdz('SO-2', !zablokowane && r.st !== 500, `publiczne: ${opis} → nie jest blokowane strażnikiem sesji`, `${m} ${s} → ${r.st} ${String(r.t).slice(0, 50)}`); }
  for (const strona of ['/foto.html', '/klub.html', '/platnosc.html', '/zamow.html', '/rejestracja.html', '/reset-hasla.html', '/blog.html', '/zaloguj']) { const r = await req('GET', strona); sprawdz('SO-2b', r.st === 200, `strona publiczna ${strona} ładuje się (200)`, `${r.st}`); }

  if (PROD) return koniec();

  // ── 3. Zalogowana praca: własny token → dane; obcy salon → 403; wygasły → 401 ──────────────────────────
  const HASLO = fs.readFileSync(arg('--haslo'), 'utf8').trim();
  const login = await req('POST', '/api', { body: { action: 'login', login: TENANT, haslo: HASLO } }); const S = login.j && login.j.session_token;
  const vp = await req('POST', '/api', { tok: S, body: { action: 'verify_pin', tenant_id: TENANT, imie: 'Ola', pin: '1111' } }); const M = vp.j && vp.j.session_token;
  if (!M) throw new Error('brak sesji PIN: ' + JSON.stringify(vp.j));
  const kl = await req('GET', `/api/klienci?action=get_clients&tenant_id=${TENANT}`, { tok: M });
  sprawdz('SO-3a', kl.st === 200 && Array.isArray(kl.j.klienci) && kl.j.klienci.length >= 3, 'z własnym tokenem: lista klientek wraca', `n=${kl.j && kl.j.klienci && kl.j.klienci.length}`);
  const disp = await req('GET', `/api?action=get_clients&tenant_id=${TENANT}`, { tok: M });
  sprawdz('SO-3b', disp.st === 200 && Array.isArray(disp.j.klienci), 'dispatcher GET z tokenem: przekierowanie zachowuje nagłówek', `n=${disp.j && disp.j.klienci && disp.j.klienci.length}`);
  const obcy = await req('GET', `/api/klienci?action=get_clients&tenant_id=${OBCY}`, { tok: M });
  sprawdz('SO-3c', obcy.st === 403 && brakDanych(obcy), 'token salonu A na danych salonu B → 403 bez danych', `${obcy.st}`);
  const wyg = await req('GET', `/api/klienci?action=get_clients&tenant_id=${TENANT}`, { tok: 'nie-ma-takiego' });
  sprawdz('SO-3d', wyg.st === 401, 'nieznany/wygasły token → 401 „Sesja wygasła”', `${wyg.st} ${wyg.j && wyg.j.message}`);
  for (const a of ['get_pin_users', 'get_months', 'get_all_deposits', 'get_features_catalog', 'get_discounts']) { const r = await req('GET', `/api?action=${a}&tenant_id=${TENANT}`, { tok: M }); sprawdz('SO-3e', r.st === 200, `zalogowany odczyt przez dispatcher: ${a} → 200`, `${r.st}`); }
  const dok = await req('GET', `/api/dokumenty/${TENANT}/nie-ma.pdf`, { tok: M });
  sprawdz('SO-3f', dok.st !== 403 || !(dok.j && dok.j.code === 'SESJA'), 'trasa z salonem w ścieżce nadal sprawdza dostęp sama (bez podwójnej blokady)', `${dok.st}`);
  koniec();

  function koniec() {
    const out = { kiedy: new Date().toISOString(), serwer: B, tryb: PROD ? 'prod-odczyt (bez sesji, tylko oczekiwane odmowy)' : 'kandydat lokalny', wyniki };
    if (arg('--wynik')) fs.writeFileSync(arg('--wynik'), JSON.stringify(out, null, 2));
    console.log(`\nRAZEM: ${wyniki.filter(w => w.wynik === 'PASS').length} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
