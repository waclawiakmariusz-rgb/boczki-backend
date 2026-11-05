// db-licznik-polaczen.js — MINIMALNA DIAGNOSTYKA puli mysql2 (5.11.2026): liczy FIZYCZNE otwarcia połączeń i zdarzenia puli,
// zapisuje kody błędów bazy z czasem. Nie zmienia zachowania puli ani zapytań, nie dodaje zapytań do bazy, nie zapisuje SQL.
//
// Po co: na współdzielonym hostingu użytkownik bazy ma limit MAX_CONNECTIONS_PER_HOUR 500, a bezczynne połączenia są zamykane
// po wait_timeout=20 s. Z zewnątrz nie da się wiarygodnie policzyć, ile razy TA instancja otwiera połączenie (globalne liczniki serwera
// obejmują wszystkich klientów; USER_STATISTICS wyłączone; dziennik aplikacji nie widzi błędów, gdy baza jest niedostępna).
// Stąd licznik w procesie: zdarzenie `connection` puli mysql2 = nowe fizyczne połączenie; `acquire`/`release` = pobranie/zwrot
// (NIE są nowym połączeniem); `enqueue` = żądanie czekało na wolne połączenie. Błędy zapytań/pobrań obserwowane PO kodzie (bez treści).
//
// Log (co INTERWAL, domyślnie 10 min, i na starcie okna):
//   [db-pula] <czas UTC> · nowe połączenia +N (łącznie M, tempo X/h) · pobrania +P · zwroty +Z · czekało w kolejce +K · błędy +B {KOD: n} · wolne/limit
// i przy każdym błędzie (z ograniczeniem: ten sam kod najwyżej raz na 10 s): [db-pula] błąd <KOD> (<gdzie>) ×n
'use strict';

function podepnij(pula, opcje = {}) {
  const coMs = opcje.coMs || 10 * 60 * 1000;
  const log = opcje.log || console;
  const teraz = opcje.teraz || Date.now;
  const l = { nowe: 0, pobrania: 0, zwroty: 0, kolejka: 0, bledy: 0, kody: {}, start: teraz() };
  let okno = { ...l, kody: {}, od: teraz() };
  const ostatniLog = new Map(); // kod → czas ostatniego wpisu (ograniczenie wpisów)

  const zlicz = (pole) => { l[pole]++; okno[pole]++; };
  pula.on('connection', () => zlicz('nowe'));
  pula.on('acquire', () => zlicz('pobrania'));
  pula.on('release', () => zlicz('zwroty'));
  pula.on('enqueue', () => zlicz('kolejka'));

  const blad = (e, gdzie) => {
    const kod = (e && (e.code || e.errno)) ? String(e.code || e.errno) : 'BEZ_KODU';
    l.bledy++; okno.bledy++; l.kody[kod] = (l.kody[kod] || 0) + 1; okno.kody[kod] = (okno.kody[kod] || 0) + 1;
    const t = teraz(); const ost = ostatniLog.get(kod) || 0;
    if (t - ost >= 10000) { ostatniLog.set(kod, t); log.error(`[db-pula] błąd ${kod} (${gdzie}) ×${l.kody[kod]} od startu`); }
  };
  pula.on('error', (e) => blad(e, 'pula'));

  // obserwacja błędów zapytań i pobrań — tylko kody; sygnatury (sql, cb) / (sql, params, cb) / (opcje, cb) / bez cb zachowane
  const oryginalQuery = pula.query;
  pula.query = function (...args) {
    const i = args.length - 1;
    if (i >= 0 && typeof args[i] === 'function') {
      const cb = args[i];
      args[i] = function (err, ...r) { if (err) blad(err, 'query'); return cb.call(this, err, ...r); };
    }
    return oryginalQuery.apply(this, args);
  };
  const oryginalGet = pula.getConnection;
  pula.getConnection = function (cb) {
    return oryginalGet.call(this, (err, c) => { if (err) blad(err, 'getConnection'); return cb(err, c); });
  };

  const wolne = () => (pula._freeConnections && typeof pula._freeConnections.length === 'number') ? pula._freeConnections.length : '?';
  const limit = () => (pula.config && pula.config.connectionLimit) || '?';
  const linia = () => {
    const t = teraz(); const h = Math.max(1, t - okno.od) / 3600000;
    const kody = Object.keys(okno.kody).length ? ' ' + JSON.stringify(okno.kody) : '';
    log.log(`[db-pula] ${new Date(t).toISOString()} · nowe połączenia +${okno.nowe} (łącznie ${l.nowe}, tempo ${(okno.nowe / h).toFixed(0)}/h) · pobrania +${okno.pobrania} · zwroty +${okno.zwroty} · czekało w kolejce +${okno.kolejka} · błędy +${okno.bledy}${kody} · wolne ${wolne()}/${limit()}`);
    okno = { nowe: 0, pobrania: 0, zwroty: 0, kolejka: 0, bledy: 0, kody: {}, od: t };
  };
  const timer = setInterval(linia, coMs); if (timer.unref) timer.unref();
  return { stan: () => ({ ...l, kody: { ...l.kody } }), linia, stop: () => clearInterval(timer) };
}

module.exports = { podepnij };
