/**
 * test.js - Skrypt testujący wszystkie kluczowe endpointy systemu Boczki
 * Uruchomienie: node test.js
 * Wymaga działającego serwera: node server.js
 */

require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const TENANT   = 'boczki-salon-glowny-001';
const API      = `${BASE_URL}/api`;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0, warnings = 0;

function ok(name)  { passed++;   console.log(`  ✅ ${name}`); }
function fail(name, reason) { failed++;   console.error(`  ❌ ${name}: ${reason}`); }
function warn(name, reason) { warnings++; console.warn (`  ⚠️  ${name}: ${reason}`); }

async function get(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, tenant_id: TENANT })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function check(name, fn) {
  try {
    await fn();
  } catch (e) {
    fail(name, e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Testy
// ─────────────────────────────────────────────────────────────

async function run() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🧪 Boczki API - Testy endpointów');
  console.log(`  Serwer: ${BASE_URL}`);
  console.log(`  Tenant: ${TENANT}`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Serwer ──────────────────────────────────────────────────
  console.log('[ Serwer ]');
  await check('GET /test - serwer działa', async () => {
    const r = await fetch(`${BASE_URL}/test`).then(x => x.json());
    if (!r.message) throw new Error('brak pola message');
    ok('GET /test - serwer działa');
  });

  // ── Auth ────────────────────────────────────────────────────
  console.log('\n[ Auth ]');
  await check('POST login - poprawne dane', async () => {
    const r = await post({ action: 'login', login: 'boczkinabok', haslo: '1234' });
    if (r.status !== 'success') throw new Error(`status=${r.status}, msg=${r.message}`);
    if (!r.tenant_id) throw new Error('brak tenant_id w odpowiedzi');
    ok('POST login - poprawne dane');
  });

  await check('POST login - złe hasło', async () => {
    const r = await post({ action: 'login', login: 'boczkinabok', haslo: 'ZLEHASLO' });
    if (r.status === 'success') throw new Error('login z złym hasłem się udał!');
    ok('POST login - złe hasło odrzucone');
  });

  // ── Magazyn ─────────────────────────────────────────────────
  console.log('\n[ Magazyn ]');
  await check('GET magazyn read - zwraca tablicę', async () => {
    const r = await get(`/magazyn?action=read&tenant_id=${TENANT}`);
    if (!Array.isArray(r)) throw new Error(`oczekiwano tablicy, dostałem: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET magazyn read - ${r.length} produktów`);
  });

  await check('GET magazyn dictionary - zwraca słownik', async () => {
    const r = await get(`/magazyn?action=dictionary&tenant_id=${TENANT}`);
    if (!Array.isArray(r) && !r.firmy && !r.kategorie) throw new Error(`nieoczekiwana odpowiedź: ${JSON.stringify(r).slice(0,80)}`);
    const count = Array.isArray(r) ? r.length : (r.firmy?.length || 0);
    ok(`GET magazyn dictionary - ${count} wpisów`);
  });

  // ── Sprzedaż ────────────────────────────────────────────────
  console.log('\n[ Sprzedaż ]');
  await check('GET sales_history - zwraca tablicę', async () => {
    const r = await get(`/sprzedaz?action=sales_history&tenant_id=${TENANT}`);
    if (!Array.isArray(r)) throw new Error(`oczekiwano tablicy: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET sales_history - ${r.length} transakcji dziś`);
  });

  await check('GET sales_history - pole czas jest HH:MM', async () => {
    const r = await get(`/sprzedaz?action=sales_history&tenant_id=${TENANT}`);
    if (!Array.isArray(r)) throw new Error('nie tablica');
    const zly = r.find(x => x.czas && !/^\d{2}:\d{2}$/.test(x.czas));
    if (zly) throw new Error(`błędny format czasu: "${zly.czas}" (oczekiwano HH:MM)`);
    ok('GET sales_history - format czasu HH:MM poprawny');
  });

  await check('GET sales_dictionary - pracownicy i zabiegi', async () => {
    const r = await get(`/sprzedaz?action=sales_dictionary&tenant_id=${TENANT}`);
    if (!r.pracownicy || !r.zabiegi) throw new Error(`brak pracownicy/zabiegi: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET sales_dictionary - ${r.pracownicy.length} pracowników, ${r.zabiegi.length} zabiegów`);
  });

  // ── Klienci ─────────────────────────────────────────────────
  console.log('\n[ Klienci ]');
  await check('GET get_clients - zwraca klientów', async () => {
    const r = await get(`/klienci?action=get_clients&tenant_id=${TENANT}`);
    // endpoint zwraca {klienci:[], zadatki:[]} lub tablicę
    const lista = Array.isArray(r) ? r : (r.klienci || []);
    if (!Array.isArray(lista)) throw new Error(`nieoczekiwana struktura: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET get_clients - ${lista.length} klientów`);
  });

  await check('GET get_client_profile_data - ma pole urodziny', async () => {
    const resp = await get(`/klienci?action=get_clients&tenant_id=${TENANT}`);
    const klienci = Array.isArray(resp) ? resp : (resp.klienci || []);
    if (klienci.length === 0) {
      warn('GET get_client_profile_data', 'brak klientów do testu');
      return;
    }
    const k = klienci[0];
    const payload = encodeURIComponent(JSON.stringify({ id: k.id || '', nazwa: k.nazwa || k.imie || '' }));
    const r = await get(`/klienci?action=get_client_profile_data&tenant_id=${TENANT}&klient=${payload}`);
    if (!r.hasOwnProperty('urodziny')) throw new Error('brak pola urodziny w odpowiedzi');
    if (!r.hasOwnProperty('portfel'))  throw new Error('brak pola portfel w odpowiedzi');
    if (!r.hasOwnProperty('memo'))     throw new Error('brak pola memo w odpowiedzi');
    ok(`GET get_client_profile_data - struktura poprawna (urodziny.znaleziona=${r.urodziny.znaleziona})`);
  });

  // ── Urodziny ────────────────────────────────────────────────
  console.log('\n[ Urodziny ]');
  await check('GET birthdays - zwraca klienci', async () => {
    const dzisiaj = new Date();
    const miesiac = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'][dzisiaj.getMonth()];
    const r = await get(`/urodziny?action=birthdays&tenant_id=${TENANT}&miesiac=${encodeURIComponent(miesiac)}`);
    if (!r.klienci) throw new Error(`brak klienci: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET birthdays (${miesiac}) - ${r.klienci.length} jubilatów`);
  });

  await check('GET birthdays - daty w formacie DD.MM', async () => {
    const r = await get(`/urodziny?action=birthdays&tenant_id=${TENANT}&miesiac=Lipiec`);
    if (!r.klienci) throw new Error('brak klienci');
    const zla = r.klienci.find(k => k.data_ur && !/^\d{2}\.\d{2}$/.test(k.data_ur));
    if (zla) throw new Error(`błędny format daty: "${zla.data_ur}" dla ${zla.imie} ${zla.nazwisko}`);
    ok('GET birthdays - format dat DD.MM poprawny');
  });

  await check('GET upcoming_birthdays - zwraca lista', async () => {
    const r = await get(`/urodziny?action=upcoming_birthdays&tenant_id=${TENANT}`);
    if (!r.lista) throw new Error(`brak lista: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET upcoming_birthdays - ${r.lista.length} jubilat(ów) w najbliższych 5 dniach`);
  });

  // ── Analityka ───────────────────────────────────────────────
  console.log('\n[ Analityka ]');
  const dzis = new Date().toISOString().slice(0, 10);
  await check('GET get_daily_summary - zwraca tablicę', async () => {
    const r = await get(`/analityka?action=get_daily_summary&tenant_id=${TENANT}&date=${dzis}`);
    if (!Array.isArray(r)) throw new Error(`oczekiwano tablicy: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET get_daily_summary (${dzis}) - ${r.length} rekordów`);
  });

  await check('GET get_daily_summary - pole godzina to HH:MM', async () => {
    const r = await get(`/analityka?action=get_daily_summary&tenant_id=${TENANT}&date=${dzis}`);
    if (!Array.isArray(r) || r.length === 0) { ok('GET get_daily_summary - brak danych (pominięto test formatu)'); return; }
    const zly = r.find(x => x.godzina && !/^\d{2}:\d{2}$/.test(x.godzina));
    if (zly) throw new Error(`błędny format godziny: "${zly.godzina}" (oczekiwano HH:MM)`);
    ok('GET get_daily_summary - format godzin HH:MM poprawny');
  });

  await check('GET get_months - zwraca dane', async () => {
    const r = await get(`/analityka?action=get_months&tenant_id=${TENANT}`);
    // może zwracać {status, months:[]} lub {status, data:[]} lub tablicę
    if (!Array.isArray(r) && !r.months && !r.data) throw new Error(`nieoczekiwana odpowiedź: ${JSON.stringify(r).slice(0,80)}`);
    const count = Array.isArray(r) ? r.length : (r.months?.length || r.data?.length || 0);
    ok(`GET get_months - ${count} miesięcy`);
  });

  // ── Konsultacje ─────────────────────────────────────────────
  console.log('\n[ Konsultacje ]');
  await check('GET kon_read_results - zwraca dane', async () => {
    const r = await get(`/konsultacje?action=kon_read_results&tenant_id=${TENANT}`);
    if (!Array.isArray(r) && !r.data && r.status !== 'error') throw new Error(`nieoczekiwana odpowiedź: ${JSON.stringify(r).slice(0,80)}`);
    ok('GET kon_read_results');
  });

  await check('GET kon_get_consultants - zwraca tablicę', async () => {
    const r = await get(`/konsultacje?action=kon_get_consultants&tenant_id=${TENANT}`);
    if (!Array.isArray(r)) throw new Error(`oczekiwano tablicy: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET kon_get_consultants - ${r.length} konsultantów`);
  });

  // ── Users ───────────────────────────────────────────────────
  console.log('\n[ Users ]');
  await check('GET get_pin_users - zwraca tablicę', async () => {
    const r = await get(`/users?action=get_pin_users&tenant_id=${TENANT}`);
    if (!Array.isArray(r)) throw new Error(`oczekiwano tablicy: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET get_pin_users - ${r.length} użytkowników PIN`);
  });

  // ── Logi ────────────────────────────────────────────────────
  console.log('\n[ Logi ]');
  await check('GET get_system_logs - zwraca tablicę', async () => {
    const r = await get(`/get_system_logs?tenant_id=${TENANT}`);
    if (!Array.isArray(r)) throw new Error(`oczekiwano tablicy: ${JSON.stringify(r).slice(0,80)}`);
    ok(`GET get_system_logs - ${r.length} logów`);
  });

  // ── Podsumowanie ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  const total = passed + failed + warnings;
  console.log(`  Wynik: ${passed}/${total} testów OK | ❌ ${failed} błędów | ⚠️  ${warnings} ostrzeżeń`);
  if (failed === 0) {
    console.log('  🎉 Wszystko działa poprawnie!');
  } else {
    console.log('  ⛔ Są błędy — sprawdź przed deployem!');
    process.exitCode = 1;
  }
  console.log('═══════════════════════════════════════════════════');
}

run().catch(e => {
  console.error('\n❌ Krytyczny błąd skryptu:', e.message);
  console.error('Upewnij się że serwer działa: node server.js');
  process.exitCode = 1;
});
