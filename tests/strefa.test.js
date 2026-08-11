// Testy strefy czasowej polaczen z baza.
//
// Powod (2026-08-11): MySQL na Hostingerze stoi w UTC, wiec NOW() zapisywalo godzine
// o 2 h wczesniejsza niz realna - Dziennik Zdarzen pokazywal 07:32 dla zdarzenia
// z 09:32. Te testy pilnuja, zeby wyliczanie offsetu nie popsulo sie po cichu,
// zwlaszcza w oknie zmiany czasu (tam pierwsza wersja poprawki sie mylila).
//
// Nie wymagaja bazy danych - sprawdzaja sama logike.

const { offsetPL } = require('../db-strefa');

describe('offsetPL - offset czasu polskiego dla MySQL', () => {

  test('lato: czas letni +02:00', () => {
    expect(offsetPL(new Date('2026-08-11T09:00:00Z'))).toBe('+02:00');
    expect(offsetPL(new Date('2026-06-01T12:00:00Z'))).toBe('+02:00');
  });

  test('zima: czas zimowy +01:00', () => {
    expect(offsetPL(new Date('2026-01-15T09:00:00Z'))).toBe('+01:00');
    expect(offsetPL(new Date('2026-12-24T18:00:00Z'))).toBe('+01:00');
  });

  test('zmiana na czas letni (29.03.2026, 01:00 UTC) - przelacza sie co do godziny', () => {
    expect(offsetPL(new Date('2026-03-29T00:30:00Z'))).toBe('+01:00');   // pol godziny przed
    expect(offsetPL(new Date('2026-03-29T01:30:00Z'))).toBe('+02:00');   // pol godziny po
  });

  test('zmiana na czas zimowy (25.10.2026, 01:00 UTC) - przelacza sie co do godziny', () => {
    expect(offsetPL(new Date('2026-10-25T00:30:00Z'))).toBe('+02:00');
    expect(offsetPL(new Date('2026-10-25T01:30:00Z'))).toBe('+01:00');
  });

  test('format akceptowany przez MySQL: +GG:MM', () => {
    for (const kiedy of ['2026-01-15T09:00:00Z', '2026-08-11T09:00:00Z', '2026-10-25T01:30:00Z']) {
      expect(offsetPL(new Date(kiedy))).toMatch(/^[+-]\d{2}:\d{2}$/);
    }
  });

  test('bez argumentu liczy dla chwili biezacej', () => {
    expect(offsetPL()).toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(offsetPL()).toBe(offsetPL(new Date()));
  });

  test('offset zgadza sie z tym, co o Warszawie mowi system', () => {
    // Niezalezne zrodlo prawdy: ile minut Warszawa jest przed UTC wg Intl.
    const teraz = new Date();
    const godzinaWarszawa = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false,
    }).format(teraz));
    const godzinaUTC = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', hour: '2-digit', hour12: false,
    }).format(teraz));

    const roznica = (godzinaWarszawa - godzinaUTC + 24) % 24;
    expect(offsetPL()).toBe(`+0${roznica}:00`);
  });
});
