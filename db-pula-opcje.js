// db-pula-opcje.js — OPCJE PULI do pomiaru przed/po (5.11.2026). Wszystkie DOMYŚLNIE WYŁĄCZONE (bez zmiennych środowiska
// aplikacja zachowuje się dokładnie jak produkcja). Włącza się je zmiennymi, żeby porównać warianty na izolowanej bazie:
//
//   DB_SESJA_WAIT_TIMEOUT=<s>   wariant A: na każdym NOWYM fizycznym połączeniu puli `SET SESSION wait_timeout = <s>` (zakres 20–3600).
//                              Serwer zamyka bezczynną sesję dopiero po <s> zamiast po globalnych 20 s; połączenia bezczynne dłużej niż
//                              mysql2 `idleTimeout` zamyka SAM KLIENT (porządnie, bez „martwych” połączeń). Zero dodatkowych zapytań.
//                              UWAGA: zmiana sesyjna — jej dopuszczalność na hostingu wymaga potwierdzenia u dostawcy (nie obchodzić polityki).
//   DB_PULA_PING_MS=<ms>        wariant B: co <ms> (≥ 3000) jedno `SELECT 1` na każdym WOLNYM połączeniu puli (najwyżej `maxPing` naraz),
//                              żeby serwer nie zamykał ich po 20 s. Jeden przebieg naraz; po błędzie 3 ticki przerwy; stop() przy zamykaniu;
//                              nie tworzy nowych połączeń (pinguje tylko już wolne).
//   maxIdle / idleTimeout       przekazywane przez server.js z DB_PULA_MAX_IDLE / DB_PULA_IDLE_MS do createPool (mysql2 ≥ 3.x).
'use strict';

function podepnij(pula, opcje = {}) {
  const log = opcje.log || console;
  const waitTimeout = Number(opcje.waitTimeout) || 0;
  const pingMs = Number(opcje.pingMs) || 0;
  const maxPing = Number(opcje.maxPing) || 3;
  const minPingMs = Number(opcje._minPingMs) || 3000; // _minPingMs tylko dla testów (realne timery, krótkie odstępy)
  const wynik = { sesje: 0, bledySesji: 0, pingi: 0, bledyPingow: 0, stop: () => {} };

  if (waitTimeout >= 20 && waitTimeout <= 3600) {
    pula.on('connection', (c) => {
      c.query('SET SESSION wait_timeout = ?', [waitTimeout], (e) => {
        if (e) { wynik.bledySesji++; log.error(`[db-pula] SET SESSION wait_timeout: ${e.code || e.message}`); } else wynik.sesje++;
      });
    });
  }

  if (pingMs >= minPingMs) {
    let wToku = false, przerwa = 0;
    const tick = () => {
      if (wToku) return;
      if (przerwa > 0) { przerwa--; return; }
      const wolnych = pula._freeConnections && typeof pula._freeConnections.length === 'number' ? pula._freeConnections.length : 0;
      const ile = Math.min(maxPing, wolnych);
      if (ile <= 0) return;
      wToku = true;
      let pozostalo = ile; const wziete = [];
      const koniec = () => { if (--pozostalo === 0) { for (const c of wziete) c.release(); wToku = false; } };
      for (let i = 0; i < ile; i++) {
        pula.getConnection((e, c) => {
          if (e) { wynik.bledyPingow++; przerwa = 3; return koniec(); }
          wziete.push(c);
          c.query('SELECT 1', (e2) => { if (e2) { wynik.bledyPingow++; przerwa = 3; } else wynik.pingi++; koniec(); });
        });
      }
    };
    const t = setInterval(tick, pingMs); if (t.unref) t.unref();
    wynik.stop = () => clearInterval(t);
  }
  return wynik;
}

module.exports = { podepnij };
