// routes/booksyParser.js
// Parser powiadomień Booksy (no-reply@booksy.com) -> ustrukturyzowana wizyta.
// Czysta logika (bez IO) — łatwa do testów na próbkach maili.
//
// Typy maili:
//   'nowa'      — "<Klient>: nowa rezerwacja ..."
//   'zmiana'    — "Zmiany w rezerwacji ..." (temat = STARA godzina; treść = nowa, kanoniczna)
//   'odwolanie' — "<Klient>: odwołał wizytę ..." LUB "Odwołanie wizyty z dnia ..." (Tablet — bez klienta)
//
// WAŻNE: data/godzina wizyty zawsze z KANONICZNEJ linii w treści
// ("środa, 17 czerwca 2026, 11:45 - 12:45"), nie z tematu.

const MIESIACE = {
  'stycznia': 1, 'lutego': 2, 'marca': 3, 'kwietnia': 4, 'maja': 5, 'czerwca': 6,
  'lipca': 7, 'sierpnia': 8, 'września': 9, 'wrzesnia': 9, 'października': 10, 'pazdziernika': 10,
  'listopada': 11, 'grudnia': 12
};

function dwa(n) { return String(n).padStart(2, '0'); }

// "17 czerwca 2026" -> "2026-06-17" (null jeśli nie rozpoznano)
function dataZTekstu(dzien, miesiacNazwa, rok) {
  const m = MIESIACE[String(miesiacNazwa || '').toLowerCase()];
  if (!m || !dzien || !rok) return null;
  return `${rok}-${dwa(m)}-${dwa(parseInt(dzien, 10))}`;
}

// Wzorce maila "zmiana" (przełożenie/edycja terminu). Booksy używa kilku sformułowań:
//   "Zmiany w rezerwacji ..."                       (klasyczny — stara godzina w temacie)
//   "X: zmienił rezerwację" / "zmieniła rezerwację" (przełożenie — stary termin w treści)
//   "X: zmienił dane rezerwacji"
//   "X: potwierdzenie propozycji zmiany terminu"    (tylko nowy termin)
//   treść: "przesunął/przesunęła swoją wizytę ... z dnia ... na inny termin"
const ZMIANA_WZORCE = [
  /Zmiany w rezerwacji/i,
  /zmieni(ł|ła|li|l)\s+(dane\s+)?rezerwacj/i,
  /przesun(ął|ęła|eli|al|ela)\s+swoj/i,
  /potwierdzenie propozycji zmiany terminu/i,
  /potwierdzi(ł|ła|l)\s+Twoją propozycję/i
];

function rozpoznajTyp(subject, text) {
  const s = (subject || '') + '\n' + (text || '');
  if (/odwoła|odwolanie|Odwołanie/i.test(s)) return 'odwolanie';
  if (ZMIANA_WZORCE.some(re => re.test(s))) return 'zmiana';
  if (/nowa rezerwacja/i.test(s)) return 'nowa';
  return 'nieznany';
}

// Kanoniczna linia: "<dzień tyg>, 17 czerwca 2026, 11:45 - 12:45"
function kanoniczna(text) {
  const re = /[A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ]+,\s*(\d{1,2})\s+([A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ]+)\s+(\d{4}),\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/;
  const m = re.exec(text || '');
  if (!m) return { data: null, godzOd: null, godzDo: null };
  return { data: dataZTekstu(m[1], m[2], m[3]), godzOd: m[4], godzDo: m[5] };
}

// Stara wizyta z TEMATU maila "zmiana": "Zmiany w rezerwacji czwartek, 9 lipca 2026 o 12:00"
function staraZTematu(subject) {
  const re = /(\d{1,2})\s+([A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ]+)\s+(\d{4})\s+o\s+(\d{1,2}:\d{2})/;
  const m = re.exec(subject || '');
  if (!m) return { data: null, godzOd: null };
  return { data: dataZTekstu(m[1], m[2], m[3]), godzOd: m[4] };
}

// Stara wizyta z TREŚCI maila o przełożeniu ("zmienił rezerwację"):
//   "...przesunął swoją wizytę ... z dnia<dzień tyg>, 20 maja 2026<10:00>na inny termin."
// Uwaga: w treści tekstowej Booksy fragmenty bywają sklejone (brak spacji) — stąd \s* zamiast \s+.
function staraZTresci(text) {
  const re = /z\s*dnia\s*[A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ]+,\s*(\d{1,2})\s+([A-Za-zżźćńółęąśŻŹĆĄŚĘŁÓŃ]+)\s+(\d{4})\s*(\d{1,2}:\d{2})\s*na\b/i;
  const m = re.exec(text || '');
  if (!m) return { data: null, godzOd: null };
  return { data: dataZTekstu(m[1], m[2], m[3]), godzOd: m[4] };
}

function telefonZTekstu(text) {
  const m = /(\d{3})\s*(\d{3})\s*(\d{3})/.exec(text || '');
  return m ? `${m[1]} ${m[2]} ${m[3]}` : null;
}

function emailZTekstu(text) {
  const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text || '');
  // pomijamy adresy booksy
  if (m && !/booksy\.com/i.test(m[0])) return m[0];
  return null;
}

function pracownikZTekstu(text) {
  const m = /pracownik:\s*(.+)/i.exec(text || '');
  return m ? m[1].trim() : null;
}

// Nazwisko klienta: temat "X: nowa rezerwacja"/"X: odwołał" -> X;
// fallback z From (jeśli to nie "Booksy.com"); fallback z treści "Klient X odwołał".
function klientZMaila(subject, fromName, text) {
  const sub = subject || '';
  const dwukrop = sub.indexOf(':');
  if (dwukrop > 0) {
    const kand = sub.slice(0, dwukrop).trim();
    if (kand && !/^booksy/i.test(kand) && !/odwołanie|zmiany w rezerwacji/i.test(kand)) return kand;
  }
  const mTresc = /Klient\s+(.+?)\s+odwoła/i.exec(text || '');
  if (mTresc) return mTresc[1].trim();
  const fn = (fromName || '').trim();
  if (fn && !/^booksy/i.test(fn)) return fn;
  return null;
}

// Nazwa zabiegu: linia tuż przed linią z ceną/godzinami, po linii kanonicznej.
// Pomija "None" (mail Tablet bez usługi).
function zabiegZTekstu(text, godzOd) {
  if (!text) return null;
  const linie = text.split(/\r?\n/).map(l => l.trim());
  // znajdź linię z ceną typu "219,00 zł, 11:45 - 12:45" lub "300,00 zł+, 15:40 - 17:35"
  for (let i = 0; i < linie.length; i++) {
    if (/\d+,\d{2}\s*zł/i.test(linie[i])) {
      for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
        if (linie[j] && !/^\d/.test(linie[j]) && linie[j] !== 'None') return linie[j];
      }
    }
  }
  // fallback: linia przed "GG:MM - GG:MM" gdy brak ceny
  if (godzOd) {
    for (let i = 0; i < linie.length; i++) {
      if (linie[i].startsWith(godzOd + ' -') || linie[i] === `${godzOd} - `) {
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          if (linie[j] && linie[j] !== 'None' && !/\d{4}/.test(linie[j])) return linie[j];
        }
      }
    }
  }
  return null;
}

function slotKey(data, godzOd, pracownik) {
  if (!data || !godzOd) return null;
  return `${data} ${godzOd} ${(pracownik || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

// Główna funkcja. Wejście: { subject, fromName, text } (text = czysty tekst maila).
function parseBooksyEmail({ subject = '', fromName = '', text = '' } = {}) {
  const typ = rozpoznajTyp(subject, text);
  const kan = kanoniczna(text);
  const pracownik = pracownikZTekstu(text);
  const wynik = {
    typ,
    klient: klientZMaila(subject, fromName, text),
    telefon: telefonZTekstu(text),
    email: emailZTekstu(text),
    dataWizyty: kan.data,
    godzOd: kan.godzOd,
    godzDo: kan.godzDo,
    zabieg: zabiegZTekstu(text, kan.godzOd),
    pracownik,
    slotKey: slotKey(kan.data, kan.godzOd, pracownik),
    staraSlotKey: null
  };
  if (typ === 'zmiana') {
    // Stary termin: najpierw z treści (przełożenie "z dnia ... na inny termin"),
    // w razie braku — z tematu (klasyczne "Zmiany w rezerwacji ... o GG:MM").
    let st = staraZTresci(text);
    if (!st.data) st = staraZTematu(subject);
    wynik.staraSlotKey = slotKey(st.data, st.godzOd, pracownik);
  }
  return wynik;
}

module.exports = { parseBooksyEmail, kanoniczna, rozpoznajTyp, dataZTekstu, slotKey };
