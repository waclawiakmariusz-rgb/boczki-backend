// db-pula-opcje.js — NAJMNIEJSZA ZMIANA PULI (5.11.2026), DOMYŚLNIE WYŁĄCZONA: bez zmiennych środowiska aplikacja zachowuje się
// dokładnie jak produkcja. Powód: użytkownik bazy ma limit 500 nowych połączeń/h, a serwer zamyka bezczynne sesje po 20 s
// (globalne wait_timeout) — pula mysql2 traci wtedy wszystkie wolne połączenia i każda seria ruchu po przerwie otwiera nowe.
//
//   DB_SESJA_WAIT_TIMEOUT=<s>  na każdym NOWYM fizycznym połączeniu puli: `SET SESSION wait_timeout = <s>` (zakres 20–3600).
//                              Serwer zamyka bezczynną sesję dopiero po <s>. Zero dodatkowych zapytań w ruchu, zero timerów.
//                              Zmiana sesyjna (nie globalna) — dopuszczalność na hostingu wymaga potwierdzenia u dostawcy.
//   DB_PULA_IDLE_MS=<ms>       mysql2 `idleTimeout`: wolne połączenie bezczynne dłużej niż <ms> zamyka SAM KLIENT (porządnie, zanim
//                              zrobi to serwer — bez wyścigu „wydane z puli, a już zabite”). Ma być KRÓTSZE niż DB_SESJA_WAIT_TIMEOUT.
//   DB_PULA_MAX_IDLE=<n>       mysql2 `maxIdle`. PUŁAPKA (mysql2 3.21.0, lib/base/pool.js:50): sprzątanie po idleTimeout działa TYLKO
//                              gdy maxIdle < connectionLimit; przy domyślnym maxIdle = connectionLimit idleTimeout jest martwy
//                              (sprawdzone na izolowanej: 3 wolne połączenia żyły mimo idleTimeout 3 s). Dlatego z DB_PULA_IDLE_MS
//                              trzeba podać DB_PULA_MAX_IDLE = connectionLimit − 1 (dla limitu 10 → 9). `sprawdzKonfiguracje` to pilnuje.
'use strict';

function podepnij(pula, opcje = {}) {
  const log = opcje.log || console;
  const waitTimeout = Number(opcje.waitTimeout) || 0;
  const wynik = { sesje: 0, bledySesji: 0 };
  if (waitTimeout >= 20 && waitTimeout <= 3600) {
    pula.on('connection', (c) => {
      c.query('SET SESSION wait_timeout = ?', [waitTimeout], (e) => {
        if (e) { wynik.bledySesji++; log.error(`[db-pula] SET SESSION wait_timeout: ${e.code || e.message}`); } else wynik.sesje++;
      });
    });
  }
  return wynik;
}

// Zwraca listę ostrzeżeń o konfiguracji (pusta = spójna). Nic nie zmienia — tylko mówi, kiedy ustawienie nie zadziała.
function sprawdzKonfiguracje({ connectionLimit = 10, maxIdle, idleTimeout, waitTimeout } = {}) {
  const uwagi = [];
  const limit = Number(connectionLimit) || 10;
  const mi = maxIdle === undefined || maxIdle === null ? limit : Number(maxIdle);
  const it = Number(idleTimeout) || 0;
  const wt = Number(waitTimeout) || 0;
  if (it > 0 && mi >= limit) uwagi.push(`DB_PULA_IDLE_MS=${it} BEZ SKUTKU: mysql2 3.21.0 sprząta bezczynne połączenia tylko gdy maxIdle (${mi}) < connectionLimit (${limit}); ustaw DB_PULA_MAX_IDLE=${limit - 1}`);
  if (it > 0 && wt > 0 && it >= wt * 1000) uwagi.push(`DB_PULA_IDLE_MS=${it} nie jest krótsze niż DB_SESJA_WAIT_TIMEOUT=${wt} s: serwer zamknie bezczynne połączenie wcześniej niż klient`);
  if (wt > 0 && it === 0) uwagi.push(`DB_SESJA_WAIT_TIMEOUT=${wt} bez DB_PULA_IDLE_MS: bezczynne połączenia zamyka serwer po ${wt} s (jak dziś po 20 s), nie klient`);
  if (wt > 0 && (wt < 20 || wt > 3600)) uwagi.push(`DB_SESJA_WAIT_TIMEOUT=${wt} poza zakresem 20–3600 — wyłączone`);
  return uwagi;
}

module.exports = { podepnij, sprawdzKonfiguracje };
