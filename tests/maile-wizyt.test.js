// Powiadomienia e-mail o wizytach — reguły, które decydują, KTO dostanie wiadomość.
//
// To pierwsza poczta Estelio do klientek salonu, nie do właścicieli. Polecenie właściciela
// brzmiało: „pilnuj, żebyś wysyłał tylko do właściwych osób". Ten plik jest zapisem tej zasady:
// każdy powód odmowy ma swój test, a wysyłka musi przejść komplet warunków.
const modul = require('../routes/maile-wizyt');

const cichyLog = { info() {}, error() {}, warn() {} };
const SALON = 'salon-x';

// Atrapa bazy: zwraca wiersze dobrane po treści zapytania; INSERT IGNORE zachowuje się jak UNIQUE.
function atrapaBazy({ ustawienia = { wlaczone: 1, potwierdzenia: 1, przypomnienia: 1, godzina_przypomnienia: 18 }, wizyta = null, pozycje = [], licencja = null, wizytyJutro = [], historia = new Set() } = {}) {
  const zap = [];
  return {
    zap, historia,
    query(sql, params, cb) {
      const c = typeof params === 'function' ? params : cb;
      const p = typeof params === 'function' ? [] : params;
      const s = String(sql);
      zap.push({ sql: s, params: p });
      if (/^CREATE TABLE/i.test(s)) return c(null, {});
      if (/FROM Maile_wizyt_ustawienia/i.test(s)) return c(null, ustawienia ? [ustawienia] : []);
      if (/FROM Licencje/i.test(s)) return c(null, licencja ? [licencja] : [{ nazwa_salonu: 'Boczki na bok', miasto: 'Siedlce', ulica: 'Główna 1', telefon: '600100200', email: 'salon@example.pl' }]);
      if (/FROM Term_Rezerwacje r\s+LEFT JOIN Klienci/i.test(s)) return c(null, wizyta ? [wizyta] : []);
      if (/FROM Term_Pozycje/i.test(s)) return c(null, pozycje);
      if (/SELECT r\.id FROM Term_Rezerwacje/i.test(s)) return c(null, wizytyJutro);
      if (/INSERT IGNORE INTO Maile_wizyt_wyslane/i.test(s)) {
        const klucz = p[0] + '|' + p[1] + '|' + p[2];
        if (historia.has(klucz)) return c(null, { affectedRows: 0 });
        historia.add(klucz); return c(null, { affectedRows: 1 });
      }
      if (/^DELETE FROM Maile_wizyt_wyslane/i.test(s)) { historia.delete(p[0] + '|' + p[1] + '|' + p[2]); return c(null, { affectedRows: 1 }); }
      if (/^SELECT/i.test(s)) return c(null, []);
      return c(null, { affectedRows: 1 });
    },
  };
}

const WIZYTA_OK = {
  id: 77, tenant_id: SALON, status: 'potwierdzona', id_klienta: '1002', klient_nazwa: 'Julia Wiśniewska',
  dzien: '2026-10-23', godzina: '14:00', koniec: '15:00',
  email: 'julia@example.pl', bez_maili: 0, status_klientki: 'AKTYWNY', zmarly: 0,
};
const atrapaPoczty = () => { const wyslane = []; return { wyslane, async wyslijMailWizyty(x) { wyslane.push(x); return { messageId: '<id>', odpowiedz: '250 Ok' }; } }; };
const dziennik = (db) => db.zap.filter(z => /INSERT INTO Maile_wizyt_log/i.test(z.sql));

describe('komu wolno wysłać', () => {
  const m = () => modul(atrapaBazy({}), { mailer: atrapaPoczty(), log: cichyLog });

  test('klientka z adresem i bez zastrzeżeń — wolno', () => {
    expect(m().wolnoWyslac(WIZYTA_OK, 'potwierdzenie')).toEqual({ ok: true, email: 'julia@example.pl' });
  });

  test('rezerwacja techniczna (brak klientki) — nie wysyłamy', () => {
    const w = m().wolnoWyslac({ ...WIZYTA_OK, id_klienta: null }, 'potwierdzenie');
    expect(w.ok).toBe(false); expect(w.powod).toMatch(/techniczna/);
  });

  test('wizyta anulowana — nie wysyłamy', () => {
    expect(m().wolnoWyslac({ ...WIZYTA_OK, status: 'anulowana' }, 'przypomnienie').ok).toBe(false);
  });

  test('klientka poprosiła o brak wiadomości — nie wysyłamy', () => {
    const w = m().wolnoWyslac({ ...WIZYTA_OK, bez_maili: 1 }, 'potwierdzenie');
    expect(w.ok).toBe(false); expect(w.powod).toMatch(/nie chce/);
  });

  test('karta zmarłej klientki — nie wysyłamy', () => {
    expect(m().wolnoWyslac({ ...WIZYTA_OK, zmarly: 1 }, 'potwierdzenie').ok).toBe(false);
  });

  test('karta usunięta albo zanonimizowana — nie wysyłamy', () => {
    expect(m().wolnoWyslac({ ...WIZYTA_OK, status_klientki: 'USUNIETY' }, 'potwierdzenie').ok).toBe(false);
    expect(m().wolnoWyslac({ ...WIZYTA_OK, status_klientki: 'ZANONIMIZOWANY' }, 'potwierdzenie').ok).toBe(false);
  });

  test('brak adresu albo wpis niebędący adresem — nie wysyłamy', () => {
    for (const zly of [null, '', '   ', 'nie dotyczy', 'brak', 'anna@', '@poczta.pl', 'anna poczta.pl']) {
      const w = m().wolnoWyslac({ ...WIZYTA_OK, email: zly }, 'potwierdzenie');
      expect(w.ok).toBe(false);
    }
  });

  test('adres z wielkich liter i spacji jest normalizowany', () => {
    expect(m().wolnoWyslac({ ...WIZYTA_OK, email: '  JULIA@Example.PL ' }, 'potwierdzenie')).toEqual({ ok: true, email: 'julia@example.pl' });
  });
});

describe('przełączniki', () => {
  const trybPrzed = process.env.MAILE_WIZYT;
  afterEach(() => { if (trybPrzed === undefined) delete process.env.MAILE_WIZYT; else process.env.MAILE_WIZYT = trybPrzed; });

  test('wyłącznik globalny off — nic nie wychodzi, nawet przy włączonym salonie', async () => {
    process.env.MAILE_WIZYT = 'off';
    const poczta = atrapaPoczty();
    const r = await modul(atrapaBazy({ wizyta: WIZYTA_OK }), { mailer: poczta, log: cichyLog }).wyslij(SALON, 77, 'potwierdzenie');
    expect(r.wyslano).toBe(false); expect(r.powod).toMatch(/globalnie/);
    expect(poczta.wyslane).toHaveLength(0);
  });

  test('salon wyłączony — nic nie wychodzi, nawet przy globalnym on', async () => {
    process.env.MAILE_WIZYT = 'on';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ ustawienia: { wlaczone: 0, potwierdzenia: 1, przypomnienia: 1, godzina_przypomnienia: 18 }, wizyta: WIZYTA_OK });
    const r = await modul(db, { mailer: poczta, log: cichyLog }).wyslij(SALON, 77, 'potwierdzenie');
    expect(r.wyslano).toBe(false); expect(poczta.wyslane).toHaveLength(0);
  });

  test('brak wiersza ustawień = salon wyłączony (nowy salon niczego nie wysyła)', async () => {
    process.env.MAILE_WIZYT = 'on';
    const poczta = atrapaPoczty();
    const r = await modul(atrapaBazy({ ustawienia: null, wizyta: WIZYTA_OK }), { mailer: poczta, log: cichyLog }).wyslij(SALON, 77, 'potwierdzenie');
    expect(r.wyslano).toBe(false); expect(poczta.wyslane).toHaveLength(0);
  });

  test('tryb proba — decyzja liczona, ale poczta milczy i historia pusta', async () => {
    process.env.MAILE_WIZYT = 'proba';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ wizyta: WIZYTA_OK });
    const r = await modul(db, { mailer: poczta, log: cichyLog }).wyslij(SALON, 77, 'potwierdzenie');
    expect(r.wyslano).toBe(false); expect(r.powod).toMatch(/próbny/);
    expect(poczta.wyslane).toHaveLength(0); expect(db.historia.size).toBe(0);
  });

  test('osobno da się wyłączyć same potwierdzenia', async () => {
    process.env.MAILE_WIZYT = 'on';
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ ustawienia: { wlaczone: 1, potwierdzenia: 0, przypomnienia: 1, godzina_przypomnienia: 18 }, wizyta: WIZYTA_OK });
    const m = modul(db, { mailer: poczta, log: cichyLog });
    expect((await m.wyslij(SALON, 77, 'potwierdzenie')).wyslano).toBe(false);
    expect((await m.wyslij(SALON, 77, 'przypomnienie')).wyslano).toBe(true);
  });
});

describe('wysyłka', () => {
  const trybPrzed = process.env.MAILE_WIZYT;
  beforeEach(() => { process.env.MAILE_WIZYT = 'on'; });
  afterEach(() => { if (trybPrzed === undefined) delete process.env.MAILE_WIZYT; else process.env.MAILE_WIZYT = trybPrzed; });

  test('idzie na adres z karty klientki i trafia do dziennika', async () => {
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ wizyta: WIZYTA_OK, pozycje: [{ kategoria: 'Endermologia', wariant: '1x', pracownik: 'Anna', od: '14:00', do_: '15:00' }] });
    const r = await modul(db, { mailer: poczta, log: cichyLog }).wyslij(SALON, 77, 'potwierdzenie', 'Ola');
    expect(r).toEqual({ wyslano: true, email: 'julia@example.pl' });
    expect(poczta.wyslane[0].email).toBe('julia@example.pl');
    expect(poczta.wyslane[0].salon.nazwa).toBe('Boczki na bok');
    expect(poczta.wyslane[0].wizyta.pozycje[0].kategoria).toBe('Endermologia');
    expect(dziennik(db)[0].params).toEqual(expect.arrayContaining(['julia@example.pl', 'potwierdzenie', 'wyslany']));
  });

  test('drugie wywołanie nie wysyła nic — jedna wiadomość na wizytę i rodzaj', async () => {
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ wizyta: WIZYTA_OK });
    const m = modul(db, { mailer: poczta, log: cichyLog });
    await m.wyslij(SALON, 77, 'potwierdzenie');
    const drugi = await m.wyslij(SALON, 77, 'potwierdzenie');
    expect(drugi.wyslano).toBe(false);
    expect(poczta.wyslane).toHaveLength(1);
  });

  test('potwierdzenie i przypomnienie to osobne wpisy — oba mogą pójść', async () => {
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ wizyta: WIZYTA_OK });
    const m = modul(db, { mailer: poczta, log: cichyLog });
    expect((await m.wyslij(SALON, 77, 'potwierdzenie')).wyslano).toBe(true);
    expect((await m.wyslij(SALON, 77, 'przypomnienie')).wyslano).toBe(true);
    expect(poczta.wyslane.map(x => x.typ)).toEqual(['potwierdzenie', 'przypomnienie']);
  });

  test('gdy poczta padnie, rezerwacja znika i błąd ląduje w dzienniku', async () => {
    const db = atrapaBazy({ wizyta: WIZYTA_OK });
    const poczta = { async wyslijMailWizyty() { throw new Error('SMTP timeout'); } };
    const r = await modul(db, { mailer: poczta, log: cichyLog }).wyslij(SALON, 77, 'potwierdzenie');
    expect(r.wyslano).toBe(false);
    expect(db.historia.size).toBe(0);
    expect(dziennik(db)[0].params).toEqual(expect.arrayContaining(['blad']));
  });

  test('nie ma takiej wizyty — cisza, bez wyjątku', async () => {
    const poczta = atrapaPoczty();
    const r = await modul(atrapaBazy({ wizyta: null }), { mailer: poczta, log: cichyLog }).wyslij(SALON, 999, 'potwierdzenie');
    expect(r.wyslano).toBe(false);
    expect(poczta.wyslane).toHaveLength(0);
  });
});

describe('przypomnienia dzień wcześniej', () => {
  const trybPrzed = process.env.MAILE_WIZYT;
  beforeEach(() => { process.env.MAILE_WIZYT = 'on'; });
  afterEach(() => { if (trybPrzed === undefined) delete process.env.MAILE_WIZYT; else process.env.MAILE_WIZYT = trybPrzed; });
  const oGodzinie = (h) => () => new Date(2026, 9, 22, h, 5, 0);

  test('o godzinie salonu wysyła na wizyty jutrzejsze', async () => {
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ wizyta: WIZYTA_OK, wizytyJutro: [{ id: 77 }] });
    const r = await modul(db, { mailer: poczta, log: cichyLog, teraz: oGodzinie(18) }).tick();
    expect(r.wyslane).toBe(1);
    expect(poczta.wyslane[0].typ).toBe('przypomnienie');
    const zapytanie = db.zap.find(z => /SELECT r\.id FROM Term_Rezerwacje/i.test(z.sql));
    expect(zapytanie.params).toContain('2026-10-23');          // jutro względem 22.10
    expect(zapytanie.sql).toMatch(/status NOT IN/);            // odwołane pomijamy
  });

  test('o innej godzinie nic nie robi i nie pyta o wizyty', async () => {
    const poczta = atrapaPoczty();
    const db = atrapaBazy({ wizyta: WIZYTA_OK, wizytyJutro: [{ id: 77 }] });
    const r = await modul(db, { mailer: poczta, log: cichyLog, teraz: oGodzinie(9) }).tick();
    expect(r.wyslane).toBe(0);
    expect(db.zap.some(z => /SELECT r\.id FROM Term_Rezerwacje/i.test(z.sql))).toBe(false);
  });
});

describe('treść wiadomości', () => {
  const mailer = require('../routes/mailer');
  const wizyta = { dzien: '2026-10-23', godzina: '14:00', koniec: '15:00', klient_nazwa: 'Julia',
    pozycje: [{ kategoria: 'Endermologia', wariant: '1x', pracownik: 'Anna', od: '14:00', do_: '15:00' }] };
  const salon = { nazwa: 'Boczki na bok', adres: 'Główna 1, Siedlce', telefon: '600100200', email: 'salon@example.pl' };

  test('potwierdzenie: salon w nagłówku, data po polsku, zabieg i telefon', () => {
    const html = mailer.zbudujMailWizyty({ salon, wizyta, typ: 'potwierdzenie' });
    expect(html).toContain('Boczki na bok');
    expect(html).toContain('Wizyta umówiona');
    expect(html).toMatch(/piątek, 23 października 2026/);
    expect(html).toContain('Endermologia');
    expect(html).toContain('600100200');
    // Logo Estelio stoi w nagłówku (prośba właściciela 21.10.2026), ale STOPKA należy do salonu:
    // klientka ma w niej dane swojego salonu, nie naszą wizytówkę i nie nasz adres kontaktowy.
    expect(html).toContain('/img/estelio-logo.png');
    expect(html).not.toContain('System zarządzania salonem beauty');
    expect(html).not.toContain('kontakt@estelio.com.pl');
  });

  test('przypomnienie ma inny nagłówek i zapowiada jutro', () => {
    const html = mailer.zbudujMailWizyty({ salon, wizyta, typ: 'przypomnienie' });
    expect(html).toContain('Przypominamy o jutrzejszej wizycie');
    expect(html).toContain('Przypomnienie o wizycie');
  });

  test('każda wiadomość mówi, jak zrezygnować', () => {
    for (const typ of ['potwierdzenie', 'przypomnienie']) {
      expect(mailer.zbudujMailWizyty({ salon, wizyta, typ })).toMatch(/Nie chcesz takich powiadomień/);
    }
  });

  // Dwie obietnice, których nie umiemy dotrzymać (uwaga właściciela 21.10.2026):
  //  • „odpisz na tę wiadomość" — odpowiedź nie trafia do recepcji, tylko do nas albo do właściciela,
  //  • „odpisz »stop«" — nikt nie czyta przychodzącej poczty, rezygnację zaznacza salon w karcie klientki.
  // Tych zdań nie wolno przywrócić, dlatego mają własną próbę.
  test('nie obiecuje, że odpowiedź na maila cokolwiek załatwi', () => {
    for (const typ of ['potwierdzenie', 'przypomnienie']) {
      const html = mailer.zbudujMailWizyty({ salon, wizyta, typ });
      expect(html).not.toMatch(/Odpisz na tę wiadomość/i);
      expect(html).not.toMatch(/odpisz[^<]{0,40}stop/i);
      expect(html).toMatch(/wysyłana automatycznie/i);
      expect(html).toMatch(/nie trafi do recepcji/i);
    }
  });

  test('kieruje do salonu jego własnym kanałem', () => {
    const html = mailer.zbudujMailWizyty({ salon, wizyta, typ: 'potwierdzenie' });
    expect(html).toMatch(/Skontaktuj się bezpośrednio z salonem/);
    expect(html).toContain('600100200');
    expect(html).toContain('salon@example.pl');
    // salon bez kontaktu w licencji: żadnej drogi nie wymyślamy, ale zdanie ma zostać sensowne
    const bezKontaktu = mailer.zbudujMailWizyty({ salon: { nazwa: 'Salon' }, wizyta, typ: 'potwierdzenie' });
    expect(bezKontaktu).toMatch(/Skontaktuj się bezpośrednio z salonem\./);
    expect(bezKontaktu).not.toMatch(/telefonicznie|mailowo/);
  });

  test('salon bez telefonu i adresu nie psuje układu', () => {
    const html = mailer.zbudujMailWizyty({ salon: { nazwa: 'Salon' }, wizyta, typ: 'potwierdzenie' });
    expect(html).toContain('Salon');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });
});
