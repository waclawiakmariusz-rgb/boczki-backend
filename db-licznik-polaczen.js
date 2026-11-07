// db-licznik-polaczen.js — MINIMALNA DIAGNOSTYKA puli mysql2 (5.11.2026, v2 po recenzji): liczy FIZYCZNE otwarcia połączeń i zdarzenia
// puli, zapisuje kody błędów bazy z czasem. Nie zmienia zachowania puli ani zapytań, nie dodaje zapytań do bazy, nie zapisuje SQL.
//
// Po co: na współdzielonym hostingu użytkownik bazy ma limit MAX_CONNECTIONS_PER_HOUR 500, a bezczynne połączenia są zamykane
// po wait_timeout=20 s. Z zewnątrz nie da się wiarygodnie policzyć, ile razy TA instancja otwiera połączenie (globalne liczniki serwera
// obejmują wszystkich klientów; USER_STATISTICS wyłączone; dziennik aplikacji nie widzi błędów, gdy baza jest niedostępna).
// Stąd licznik w procesie: zdarzenie `connection` puli mysql2 = nowe fizyczne połączenie; `acquire`/`release` = pobranie/zwrot
// (NIE są nowym połączeniem); `enqueue` = żądanie czekało na wolne połączenie.
//
// Obserwowane ścieżki błędów (po kodzie, bez treści SQL) — wszystkie, których używa aplikacja (wywołania z callbackiem):
//   pool.query(…, cb)            731 miejsc w routes/ i server.js
//   pool.execute(…, cb)          (w aplikacji 0 miejsc; skrypty narzędziowe) — obserwowane na wszelki wypadek
//   pool.getConnection(cb)       4 miejsca (raport, rejestracja-zaloz, terminarz, start) i wewnętrznie każda z powyższych
//   connection.query/execute/beginTransaction/commit/rollback(…, cb) na połączeniu z getConnection — owijane raz na każde
//                                NOWE fizyczne połączenie (zdarzenie `connection`), więc obejmuje też połączenia używane wielokrotnie
// Każdy obiekt błędu liczony DOKŁADNIE RAZ (WeakSet): odmowa getConnection w trakcie pool.query/execute nie jest liczona drugi raz
// jako błąd zapytania. NIE obserwowane (aplikacja ich nie używa): pool.promise()/connection.promise(), zapytania bez callbacka
// (strumienie), błędy zgłaszane zdarzeniem 'error' zapytania zamiast callbacka.
//
// Log (co INTERWAL, domyślnie 10 min):
//   [db-pula] <czas UTC> · nowe połączenia +N (łącznie M, tempo X/h) · pobrania +P · zwroty +Z · czekało w kolejce +K · błędy +B {KOD: n} · wolne/limit
// i przy każdym błędzie (ten sam kod najwyżej raz na 10 s): [db-pula] błąd <KOD> (<gdzie>) ×n od startu
'use strict';

const ZNACZNIK = Symbol('db-licznik-polaczen');

function podepnij(pula, opcje = {}) {
  const coMs = opcje.coMs || 10 * 60 * 1000;
  const log = opcje.log || console;
  const teraz = opcje.teraz || Date.now;
  const l = { nowe: 0, pobrania: 0, zwroty: 0, kolejka: 0, bledy: 0, kody: {}, start: teraz() };
  let okno = { ...l, kody: {}, od: teraz() };
  const ostatniLog = new Map(); // kod → czas ostatniego wpisu (ograniczenie wpisów)
  const policzone = new WeakSet(); // obiekty błędów już policzone (ten sam błąd przechodzi przez kilka warstw)

  const zlicz = (pole) => { l[pole]++; okno[pole]++; };
  pula.on('connection', () => zlicz('nowe'));
  pula.on('acquire', () => zlicz('pobrania'));
  pula.on('release', () => zlicz('zwroty'));
  pula.on('enqueue', () => zlicz('kolejka'));

  const blad = (e, gdzie) => {
    if (!e) return;
    if (typeof e === 'object') { if (policzone.has(e)) return; policzone.add(e); }
    const kod = (e.code || e.errno) ? String(e.code || e.errno) : 'BEZ_KODU';
    l.bledy++; okno.bledy++; l.kody[kod] = (l.kody[kod] || 0) + 1; okno.kody[kod] = (okno.kody[kod] || 0) + 1;
    const t = teraz(); const ost = ostatniLog.get(kod) || 0;
    if (t - ost >= 10000) { ostatniLog.set(kod, t); log.error(`[db-pula] błąd ${kod} (${gdzie}) ×${l.kody[kod]} od startu`); }
  };
  pula.on('error', (e) => blad(e, 'pula'));

  // owija metodę wołaną z callbackiem jako ostatnim argumentem; bez callbacka (np. wewnętrzne conn.query(obiektZapytania)) przepuszcza bez zmian
  const owin = (obiekt, metoda, gdzie) => {
    const orig = obiekt[metoda];
    if (typeof orig !== 'function') return;
    obiekt[metoda] = function (...args) {
      const i = args.length - 1;
      if (i >= 0 && typeof args[i] === 'function') {
        const cb = args[i];
        args[i] = function (err, ...r) { if (err) blad(err, gdzie); return cb.call(this, err, ...r); };
      }
      return orig.apply(this, args);
    };
  };
  owin(pula, 'query', 'query');
  owin(pula, 'execute', 'execute');
  owin(pula, 'getConnection', 'getConnection');
  pula.on('connection', (c) => {
    if (!c || typeof c !== 'object' || c[ZNACZNIK]) return;
    c[ZNACZNIK] = true;
    for (const m of ['query', 'execute', 'beginTransaction', 'commit', 'rollback']) owin(c, m, 'połączenie.' + m);
  });

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
