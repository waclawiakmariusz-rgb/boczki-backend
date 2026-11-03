// tests/lojalnosc-bonus-powitalny.test.js — ticket #22 (3.11.2026): bonus powitalny przy KAŻDYM pierwszym założeniu konta Klubu
// (link rejestracyjny, kod od recepcji, link/QR z panelu), jeden wpis na klientkę (strażnik NOT EXISTS w INSERT).
const request = require('supertest');
const express = require('express');
const { mockDb } = require('./helpers/mockDb');
const lojalnoscFactory = require('../routes/lojalnosc');
const { wyczyscCacheLoj, makeKlubToken } = lojalnoscFactory;

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api', lojalnoscFactory(db));
  return app;
}
const INIT = Array.from({ length: 21 }, () => ({ rows: [] }));
const KLIENT_OK = { rows: [{ imie_nazwisko: 'Anna Kowalska', telefon: '500 123 456', status: '', zmarly: 0 }] };
const USTAWIENIA_20 = { rows: [{ bonus_powitalny_pkt: 20 }] };
const USTAWIENIA_0 = { rows: [{ bonus_powitalny_pkt: 0 }] };
const OK = { rows: { affectedRows: 1 } };
const JUZ_BYL = { rows: { affectedRows: 0 } };

beforeEach(() => wyczyscCacheLoj());

const wpisBonusu = (db) => db.query.mock.calls.find(c => /INSERT INTO Lojalnosc_Punkty/.test(c[0]) && /powitalny/i.test(c[0]));

describe('bonus powitalny — aktywacja linkiem/QR z panelu (POST /api/klub/aktywuj)', () => {
  const token = () => makeKlubToken({ t: 't-bonus', k: '42', typ: 'akt', exp: Date.now() + 60000 });

  test('salon ma bonus 20 → wpis BONUS ref AKT@42, odpowiedź bonus: 20, log z dopiskiem', async () => {
    const db = mockDb(...INIT, KLIENT_OK, { rows: [] }, { rows: [] }, OK /* INSERT konta */, OK /* wnioski */, USTAWIENIA_20, OK /* INSERT bonus */);
    const res = await request(buildApp(db)).post('/api/klub/aktywuj').send({ token: token(), pin: '1234', zgoda: true });
    expect(res.body.status).toBe('success');
    expect(res.body.bonus).toBe(20);
    const ins = wpisBonusu(db);
    expect(ins).toBeTruthy();
    expect(ins[0]).toMatch(/NOT EXISTS/);              // strażnik: jeden bonus na klientkę
    expect(ins[1][0]).toBe('t-bonus'); expect(ins[1][1]).toBe('42'); expect(ins[1][2]).toBe(20); expect(ins[1][3]).toBe('AKT@42');
    const log = db.query.mock.calls.find(c => /INSERT INTO Logi/.test(c[0]) && /AKTYWACJA KONTA/.test(JSON.stringify(c[1])));
    expect(JSON.stringify(log[1])).toMatch(/bonus powitalny 20 pkt/);
  });

  test('klientka miała już BONUS (INSERT nic nie wstawił) → bonus: 0, bez dopisku w logu', async () => {
    const db = mockDb(...INIT, KLIENT_OK, { rows: [] }, { rows: [] }, OK, OK, USTAWIENIA_20, JUZ_BYL);
    const res = await request(buildApp(db)).post('/api/klub/aktywuj').send({ token: token(), pin: '1234', zgoda: true });
    expect(res.body.status).toBe('success');
    expect(res.body.bonus).toBe(0);
    const log = db.query.mock.calls.find(c => /INSERT INTO Logi/.test(c[0]) && /AKTYWACJA KONTA/.test(JSON.stringify(c[1])));
    expect(JSON.stringify(log[1])).not.toMatch(/bonus powitalny/);
  });

  test('salon z bonusem 0 → żadnego INSERT do księgi punktów', async () => {
    const db = mockDb(...INIT, KLIENT_OK, { rows: [] }, { rows: [] }, OK, OK, USTAWIENIA_0);
    const res = await request(buildApp(db)).post('/api/klub/aktywuj').send({ token: token(), pin: '1234', zgoda: true });
    expect(res.body.status).toBe('success');
    expect(res.body.bonus).toBe(0);
    expect(wpisBonusu(db)).toBeUndefined();
  });
});

describe('bonus powitalny — aktywacja kodem od recepcji (POST /api/klub/aktywuj_kod)', () => {
  test('kod poprawny + bonus 20 → wpis BONUS ref KOD@42 i odpowiedź bonus: 20', async () => {
    const db = mockDb(
      ...INIT,
      { rows: [{ id: 5, tenant_id: 't-kod', id_klienta: '42', kod: '7K2M', proby: 0 }] }, // kody numeru
      KLIENT_OK, { rows: [] }, { rows: [] },                                            // klient, juzTu, inne (PIN)
      OK /* INSERT konta */, OK /* kod UZYTY */, OK /* wnioski */, USTAWIENIA_20, OK /* INSERT bonus */
    );
    const res = await request(buildApp(db)).post('/api/klub/aktywuj_kod').send({ telefon: '500123456', kod: '7k2m', pin: '1234', zgoda: true });
    expect(res.body.status).toBe('success');
    expect(res.body.bonus).toBe(20);
    const ins = wpisBonusu(db);
    expect(ins).toBeTruthy();
    expect(ins[1][1]).toBe('42'); expect(ins[1][2]).toBe(20); expect(ins[1][3]).toBe('KOD@42');
  });
});

describe('bonus powitalny — rejestracja online nowego numeru (bez zmian zachowania)', () => {
  const valid = () => ({ token: makeKlubToken({ t: 't-rej', k: 'rejestracja', typ: 'rej', exp: Date.now() + 60000 }), imie: 'Nowa Osoba', telefon: '500 999 888', pin: '1234', zgoda: true });
  test('nowy numer → bonus z ref REJ@<nowe id> przez ten sam strażnik NOT EXISTS', async () => {
    const db = mockDb(...INIT, { rows: [] }, { rows: [] }, { rows: [{ maxId: 41 }] }, { rows: [] }, OK, OK, USTAWIENIA_20, OK);
    const res = await request(buildApp(db)).post('/api/klub/rejestracja').send(valid());
    expect(res.body.status).toBe('success');
    expect(res.body.kod).toBe('NOWE');
    expect(res.body.bonus).toBe(20);
    const ins = wpisBonusu(db);
    expect(ins[0]).toMatch(/NOT EXISTS/);
    expect(ins[1][1]).toBe('42'); expect(ins[1][3]).toBe('REJ@42');
  });
});

describe('apka i panel — spięcia', () => {
  const fs = require('fs'); const path = require('path');
  const czytaj = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  test('klub.html pokazuje toast bonusu po aktywacji linkiem i kodem', () => {
    const s = czytaj('public/klub.html');
    expect((s.match(/Bonus powitalny: \+' \+ d\.bonus \+ ' pkt!/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  test('etykieta w panelu nie obiecuje bonusu „tylko za rejestrację online”', () => {
    const s = czytaj('public/index.html');
    expect(s).not.toMatch(/Bonus powitalny za rejestrację online/);
    expect(s).toMatch(/Bonus powitalny za założenie konta w Klubie/);
  });
  test('skrypt wyrównania: odmawia bez --produkcja-tak poza bazą izolowaną, chroni NOT EXISTS, ref WYR@', () => {
    const s = czytaj('narzedzia/klub/wyrownanie-bonusu-powitalnego.js');
    expect(s).toMatch(/estelio_test/); expect(s).toMatch(/NOT EXISTS/); expect(s).toMatch(/'WYR@' \+ id/); expect(s).toMatch(/zapis-tak/);
  });
});
