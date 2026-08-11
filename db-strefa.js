// Ustawia czas polski na polaczeniach z baza.
//
// PROBLEM (wykryty 2026-08-11): serwer MySQL na Hostingerze stoi w UTC
// (@@system_time_zone = UTC), a caly system zapisuje czas funkcjami bazy -
// NOW() w 97 miejscach, CURDATE() w 24, CURRENT_TIMESTAMP jako DEFAULT kolumn
// w 51. Efekt: uzytkownik dodal pracownika o 09:32, a Dziennik Zdarzen pokazywal
// 07:32. Latem rozjazd wynosi 2 h, zima 1 h.
//
// DLACZEGO OFFSET, A NIE 'Europe/Warsaw': ta baza nie ma zaladowanych tabel stref
// (mysql.time_zone_name), wiec SET time_zone = 'Europe/Warsaw' konczy sie bledem
// "Unknown or incorrect time zone". Zostaje offset - ale offset zmienia sie
// dwa razy w roku, wiec wyliczamy go w Node z prawdziwego kalendarza stref
// (Intl/IANA), zamiast wpisywac na sztywno "+02:00".
//
// Poprawka dziala NA PRZYSZLOSC. Wpisy sprzed jej wdrozenia zostaja w UTC.

/**
 * Offset strefy Europe/Warsaw na podany moment, w formacie MySQL ("+02:00" / "+01:00").
 * Liczony z kalendarza IANA, wiec sam ogarnia zmiane czasu letniego i zimowego.
 */
function offsetPL(kiedy = new Date()) {
  // Pytamy o offset wprost przez Intl. Kuszaca alternatywa - porownanie tego samego
  // momentu sformatowanego w dwoch strefach i sparsowanego przez new Date() - myli sie
  // DOKLADNIE w oknie zmiany czasu (sprawdzone: 29.03.2026 01:30 UTC dawalo +01:00
  // zamiast +02:00), bo parsuje godzine, ktora w strefie lokalnej nie istnieje
  // albo wystepuje dwa razy.
  const opis = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Warsaw',
    timeZoneName: 'longOffset',
  }).formatToParts(kiedy).find((cz) => cz.type === 'timeZoneName');

  // Format to "GMT+02:00", a przy zerowym offsecie samo "GMT".
  const offset = (opis ? opis.value : '').replace('GMT', '').trim();
  return offset || '+00:00';
}

/**
 * Podpina ustawianie strefy do puli polaczen.
 *
 * Pula trzyma polaczenia dlugo, wiec sam moment ich tworzenia nie wystarcza:
 * polaczenie otwarte przed zmiana czasu miałoby stary offset jeszcze przez wiele
 * godzin po niej. Dlatego przy kazdym wypozyczeniu sprawdzamy, czy offset zapisany
 * dla tego polaczenia jest nadal aktualny - zapytanie SET leci tylko wtedy, gdy nie jest
 * (czyli praktycznie dwa razy w roku, a nie przy kazdym zapytaniu).
 *
 * @param {object} pula      pula mysql2 (createPool)
 * @param {function} [log]   opcjonalny logger, domyslnie console.log
 */
function podepnij(pula, log = console.log) {
  const ustawioneDla = new Map();   // threadId -> offset, ktory to polaczenie ma ustawiony

  const ustaw = (polaczenie, powod) => {
    const offset = offsetPL();
    const poprzedni = ustawioneDla.get(polaczenie.threadId);

    // Zapisujemy OD RAZU, nie w callbacku: nastepne wypozyczenie tego polaczenia
    // moze nastapic zanim SET zdazy odpowiedziec, a wtedy widzielismy pusta mape
    // i wysylalismy SET jeszcze raz (przy starcie sypalo sie to komunikatami
    // "offset zmienil sie", choc nic sie nie zmienilo).
    ustawioneDla.set(polaczenie.threadId, offset);

    polaczenie.query(`SET time_zone = '${offset}'`, (err) => {
      if (err) {
        // Nie wywracamy aplikacji - system zadziala, tylko z czasem UTC jak dotad.
        ustawioneDla.delete(polaczenie.threadId);
        log(`[strefa] Nie udalo sie ustawic czasu polskiego (${powod}): ${err.message}`);
        return;
      }
      // Log tylko przy PRAWDZIWEJ zmianie offsetu, czyli dwa razy w roku.
      if (poprzedni && poprzedni !== offset) {
        log(`[strefa] Zmiana czasu: ${poprzedni} -> ${offset}. Polaczenia przestawione.`);
      }
    });
  };

  pula.on('connection', (polaczenie) => ustaw(polaczenie, 'nowe polaczenie'));

  pula.on('acquire', (polaczenie) => {
    if (ustawioneDla.get(polaczenie.threadId) !== offsetPL()) ustaw(polaczenie, 'zmiana czasu');
  });

  // Polaczenie zamkniete przez serwer nie wroci - nie trzymajmy po nim wpisu.
  pula.on('release', (polaczenie) => {
    if (polaczenie.connection && polaczenie.connection._closing) ustawioneDla.delete(polaczenie.threadId);
  });

  log(`[strefa] Czas bazy ustawiany na polski (teraz ${offsetPL()}).`);
}

module.exports = { offsetPL, podepnij };
