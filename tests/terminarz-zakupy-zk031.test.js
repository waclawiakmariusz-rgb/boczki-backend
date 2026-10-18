// tests/terminarz-zakupy-zk031.test.js — ZK-03.1: regresje odtwarzające potwierdzone usterki N01–N05, N13 oraz
// zmianę zasady Z8 (umawianie po terminie ważności). Każdy test MA OBLEWAĆ na kodzie sprzed naprawy.
// Rodzaj prób: jednostkowe na repozytorium w pamięci. Próby na rzeczywistej bazie: narzedzia/testy-integracyjne/.
const Z = require('../routes/terminarz-zakupy');
const { repoPamiec } = require('./helpers/repoPamiec');
const { logika, domena } = Z;

const T = 'salon-zk031';
const DZIS = '2026-10-18';
const ctx = (tryb = 'aktywna', autor = 'Ola') => ({ tenant: T, autor, autor_id: 'u-ola', rola: 'manager', teraz: `${DZIS} 10:00:00`, tryb, techniczna: true, zapisany: tryb, przerwa_od: null, widziKwoty: true });
const saldo = async (repo, id) => (await domena.saldoSkladnikow(repo, [id]))[id];
const sprzedaz = (repo, r) => { repo._T.sprzedaz.push({ status: 'AKTYWNY', kategoria_produktu: null, data_waznosci: null, karnet_zamkniety_w: null, grupa_id: null, zwrot_do_id: null, szczegoly: '', platnosc: 'Karta', data_sprzedazy: `${DZIS} 09:00:00`, ...r }); return r.id; };

function katalog(repo) {
    repo.dodajUsluge({ id: 'U-A', kategoria: 'Endermologia', wariant: '1x' });
    repo.dodajUsluge({ id: 'U-A5', kategoria: 'Endermologia', wariant: '5x' });
    repo.dodajUsluge({ id: 'U-A10', kategoria: 'Endermologia', wariant: '10x' });
    repo.dodajUsluge({ id: 'U-B', kategoria: 'Meltivio', wariant: '1x' });
    repo.dodajOferte('U-A5', [{ wersja: 1, rodzaj: 'pakiet', od: '2026-01-01 00:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 5 }] }]);
    repo.dodajOferte('U-A10', [{ wersja: 1, rodzaj: 'pakiet', od: '2026-01-01 00:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 10 }] }]);
}
/** Zwraca ID pozycji wizyty (tak jak repoPamiec). */
const pozycja = (repo, { id_klienta = '1001', usluga_id = 'U-A', start = '2026-11-20 12:00:00', stan = 'zaplanowana' } = {}) => {
    const rez = repo.dodajRezerwacje({ id_klienta, klient_nazwa: 'K ' + id_klienta });
    return repo.dodajPozycje({ rezerwacja_id: rez, usluga_id, start, kategoria: 'Endermologia', stan });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('N01 — pełna treść żądania uczestniczy w idempotencji', () => {
    test('dwa różne żądania rejestracji (inne sprzedaz_id/wersja w zagnieżdżonych pozycjach) mają RÓŻNE skróty', () => {
        const a = { pozycje: [{ sprzedaz_id: 'PAR-A-1', wersja_id: 1 }] };
        const b = { pozycje: [{ sprzedaz_id: 'PAR-B-1', wersja_id: 9 }] };
        expect(logika.skrotZadania('rejestracja', a)).not.toBe(logika.skrotZadania('rejestracja', b));
    });
    test('to samo żądanie semantycznie (inna kolejność kluczy obiektu) ma TEN SAM skrót', () => {
        const a = { pozycje: [{ sprzedaz_id: 'X', wersja_id: 1 }], operacja: 'rej' };
        const b = { operacja: 'rej', pozycje: [{ wersja_id: 1, sprzedaz_id: 'X' }] };
        expect(logika.skrotZadania('rejestracja', a)).toBe(logika.skrotZadania('rejestracja', b));
    });
    test('kolejność TABLICY ma znaczenie (inna kolejność pozycji = inne żądanie)', () => {
        const a = { pozycje: [{ sprzedaz_id: 'A' }, { sprzedaz_id: 'B' }] };
        const b = { pozycje: [{ sprzedaz_id: 'B' }, { sprzedaz_id: 'A' }] };
        expect(logika.skrotZadania('rejestracja', a)).not.toBe(logika.skrotZadania('rejestracja', b));
    });
    test('zmiana decyzji w zagnieżdżonej liście (powiaz → niezwiazana) zmienia skrót', () => {
        const a = { skladnik_id: 7, decyzje: [{ pozycja_id: 3, decyzja: 'powiaz' }] };
        const b = { skladnik_id: 7, decyzje: [{ pozycja_id: 3, decyzja: 'niezwiazana' }] };
        expect(logika.skrotZadania('uruchomienie', a)).not.toBe(logika.skrotZadania('uruchomienie', b));
    });
    test('logika.hash ma ten sam kontrakt dla zagnieżdżeń (nie tylko skrotZadania)', () => {
        expect(logika.hash({ p: [{ id: 'A' }] })).not.toBe(logika.hash({ p: [{ id: 'B' }] }));
    });
    test('rozróżnia typy i wartości puste: null, "", 0, brak klucza', () => {
        const h = (o) => logika.skrotZadania('x', o);
        expect(h({ a: null })).not.toBe(h({ a: '' }));
        expect(h({ a: 0 })).not.toBe(h({ a: '0' }));
        expect(h({ a: undefined })).not.toBe(h({ a: null }));
        expect(h({ a: [1] })).not.toBe(h({ a: { 0: 1 } }));
    });
});

describe('N02 — zakup zapisany w całości albo wcale', () => {
    test('błąd przy DRUGIM składniku nie zostawia rodzica, pierwszego składnika ani G', async () => {
        const repo = repoPamiec(T); katalog(repo);
        repo.dodajUsluge({ id: 'U-AB', kategoria: 'Pakiet', wariant: '5A+4B' });
        repo.dodajOferte('U-AB', [{ wersja: 1, rodzaj: 'pakiet', od: '2026-01-01 00:00:00', skladniki: [{ usluga_wyk_id: 'U-A', jednostki: 5 }, { usluga_wyk_id: 'U-B', jednostki: 4 }] }]);
        sprzedaz(repo, { id: 'OK-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 });
        sprzedaz(repo, { id: 'ZLY-1', id_klienta: '1001', zabieg: 'Pakiet', szczegoly: '5A+4B', kwota: 2000 });
        const oryg = repo.wstawRuch.bind(repo); let n = 0;
        repo.wstawRuch = async (r) => { if (r.typ === 'G' && ++n === 3) throw new Error('awaria zapisu ruchu B'); return oryg(r); };
        const w = await domena.zarejestrujZakupy(repo, ctx(), { pozycje: [{ sprzedaz_id: 'OK-1' }, { sprzedaz_id: 'ZLY-1' }] });
        repo.wstawRuch = oryg;
        expect(w.wyniki.find(x => x.sprzedaz_id === 'OK-1').wynik).toBe('zarejestrowano');
        expect(w.wyniki.find(x => x.sprzedaz_id === 'ZLY-1').wynik).toBe('blad');
        expect(repo._T.zakupy.filter(z => z.sprzedaz_id === 'ZLY-1')).toHaveLength(0);
        const idZly = (repo._T.zakupy.find(z => z.sprzedaz_id === 'ZLY-1') || {}).id;
        expect(repo._T.skladniki.filter(s => s.zakup_id === idZly)).toHaveLength(0);
        expect(w.zarejestrowano).toBe(1);
        const sklOk = repo._T.skladniki.filter(s => s.zakup_id === repo._T.zakupy.find(z => z.sprzedaz_id === 'OK-1').id);
        expect((await saldo(repo, sklOk[0].id)).G).toBe(5); // poprawny zakup z tej samej partii zostaje
    });
});

describe('N03 — dopłata należy do właściwego zakupu', () => {
    const paragon5i10 = (repo, { grupy = [null, null] } = {}) => {
        sprzedaz(repo, { id: 'P-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 200, platnosc: 'Portfel', grupa_id: grupy[0] });
        sprzedaz(repo, { id: 'P-2', id_klienta: '1001', zabieg: 'Endermologia Dopłata', szczegoly: '', kwota: 700, grupa_id: grupy[0] });
        sprzedaz(repo, { id: 'P-3', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '10x', kwota: 300, platnosc: 'Portfel', grupa_id: grupy[1] });
        sprzedaz(repo, { id: 'P-4', id_klienta: '1001', zabieg: 'Endermologia Dopłata', szczegoly: '', kwota: 1400, grupa_id: grupy[1] });
    };
    test('5x i 10x na jednym paragonie bez grup: żadna dopłata nie trafia automatycznie do obu — wymagane rozstrzygnięcie', () => {
        const repo = repoPamiec(T); katalog(repo); paragon5i10(repo);
        const par = repo._T.sprzedaz;
        const d5 = logika.powiazaneDoplaty(par.find(r => r.id === 'P-1'), par);
        const d10 = logika.powiazaneDoplaty(par.find(r => r.id === 'P-3'), par);
        expect(d5.niejednoznaczne).toBe(true);
        expect(d10.niejednoznaczne).toBe(true);
        expect(d5.powiazane).toHaveLength(0);
        expect(d10.powiazane).toHaveLength(0);
        expect(d5.kandydatki.map(x => x.id).sort()).toEqual(['P-2', 'P-4']);
    });
    test('5x i 10x z ROZŁĄCZNYMI grupami: każdy dostaje swoją dopłatę', () => {
        const repo = repoPamiec(T); katalog(repo); paragon5i10(repo, { grupy: ['G-5', 'G-10'] });
        const par = repo._T.sprzedaz;
        const d5 = logika.powiazaneDoplaty(par.find(r => r.id === 'P-1'), par);
        const d10 = logika.powiazaneDoplaty(par.find(r => r.id === 'P-3'), par);
        expect([d5.niejednoznaczne, d5.powiazane.map(x => x.id)]).toEqual([false, ['P-2']]);
        expect([d10.niejednoznaczne, d10.powiazane.map(x => x.id)]).toEqual([false, ['P-4']]);
    });
    test('dwa powielone egzemplarze tej samej oferty we WSPÓLNEJ grupie: dopłata niejednoznaczna, nie dzielona po cichu', () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'D-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 200, platnosc: 'Portfel', grupa_id: 'G1' });
        sprzedaz(repo, { id: 'D-2', id_klienta: '1001', zabieg: 'Endermologia Dopłata', szczegoly: '', kwota: 700, grupa_id: 'G1' });
        sprzedaz(repo, { id: 'D-3', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, grupa_id: 'G1' });
        const par = repo._T.sprzedaz;
        const a = logika.powiazaneDoplaty(par.find(r => r.id === 'D-1'), par);
        const b = logika.powiazaneDoplaty(par.find(r => r.id === 'D-3'), par);
        expect(a.niejednoznaczne).toBe(true);
        expect(b.niejednoznaczne).toBe(true);
        expect(a.powiazane.concat(b.powiazane)).toHaveLength(0);
    });
    test('jeden egzemplarz + jedna dopłata: bez zmian, powiązanie automatyczne', () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'E-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 200, platnosc: 'Portfel' });
        sprzedaz(repo, { id: 'E-2', id_klienta: '1001', zabieg: 'Endermologia Dopłata', szczegoly: '', kwota: 700 });
        const par = repo._T.sprzedaz;
        const d = logika.powiazaneDoplaty(par.find(r => r.id === 'E-1'), par);
        expect([d.niejednoznaczne, d.powiazane.map(x => x.id)]).toEqual([false, ['E-2']]);
    });
});

describe('N04 — korekta historii uwzględnia cały aktualny bilans', () => {
    test('G=10, historia U=3, wykonane w terminarzu U=5, R=1 → zmiana historii 3→5 ODRZUCONA (B byłoby −1)', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'H-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '10x', kwota: 1700 });
        const c = ctx();
        await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'H-1' }] });
        const s = repo._T.skladniki[0];
        await domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 3, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'karta', operacja_id: 1 });
        // sześć wizyt: pięć wykonanych w terminarzu, jedna nadal zarezerwowana
        const poz = []; for (let i = 0; i < 6; i++) poz.push({ id: pozycja(repo, { start: `2026-11-2${i} 10:00:00` }) });
        for (const p of poz) {
            const pid = await repo.wstawPrzydzial({ pozycja_id: p.id, skladnik_id: s.id, ilosc: 1, cykl: 1, operacja_id: 2 });
            await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: 1, ilosc: 1, przydzial_id: pid, operacja_id: 2, data_zdarzenia: c.teraz, kto: c.autor });
            p._przydzial = pid;
        }
        for (const p of poz.slice(0, 5)) { // pięć wykonanych: R− i U+
            await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: -1, ilosc: 1, przydzial_id: p._przydzial, operacja_id: 3, data_zdarzenia: c.teraz, kto: c.autor });
            await repo.wstawRuch({ skladnik_id: s.id, typ: 'U', kierunek: 1, ilosc: 1, przydzial_id: p._przydzial, operacja_id: 3, data_zdarzenia: c.teraz, kto: c.autor });
        }
        const przed = await saldo(repo, s.id);
        expect([przed.G, przed.U, przed.R, przed.B]).toEqual([10, 8, 1, 1]); // 3 historyczne + 5 w terminarzu
        await expect(domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 5, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'korekta', operacja_id: 4 }))
            .rejects.toThrow(/wizyt|przydzielon|niemożliw|ujemn/i);
        const po = await saldo(repo, s.id);
        expect([po.U, po.R, po.B]).toEqual([8, 1, 1]); // żadnych nowych ruchów
    });
    test('korekta w dół (3→1) nadal dozwolona i daje poprawny bilans', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'H-2', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '10x', kwota: 1700 });
        const c = ctx();
        await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'H-2' }] });
        const s = repo._T.skladniki[0];
        await domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 3, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'karta', operacja_id: 1 });
        await domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 1, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'korekta', operacja_id: 2 });
        expect((await saldo(repo, s.id)).U).toBe(1);
    });
});

describe('N05 — rozstrzygnięcie wizyty nie znika między zakupami', () => {
    test('wizyta wyłączona z zakupu X („niezwiazana”) jest nadal kandydatem dla zakupu Y i daje dokładnie jeden przydział', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'X-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 });
        sprzedaz(repo, { id: 'Y-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '10x', kwota: 1700 });
        const c = ctx();
        await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'X-1' }, { sprzedaz_id: 'Y-1' }] });
        const zX = repo._T.zakupy.find(z => z.sprzedaz_id === 'X-1'), zY = repo._T.zakupy.find(z => z.sprzedaz_id === 'Y-1');
        const sX = repo._T.skladniki.find(s => s.zakup_id === zX.id), sY = repo._T.skladniki.find(s => s.zakup_id === zY.id);
        for (const s of [sX, sY]) await domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'nowy zakup', operacja_id: 1 });
        const p = pozycja(repo, { start: '2026-11-25 10:00:00' });

        const kandX = await domena.kandydaciWizyt(repo, c, { skladnik_id: sX.id });
        expect(kandX.kandydaci.map(k => k.id)).toContain(p);
        await domena.uruchomSkladnik(repo, c, { skladnik_id: sX.id, decyzje: [{ pozycja_id: p, decyzja: 'niezwiazana', uzasadnienie: 'będzie z pakietu 10x' }], skrot: kandX.skrot, potwierdzenie_zaleznych: true, operacja_id: 2 });

        const kandY = await domena.kandydaciWizyt(repo, c, { skladnik_id: sY.id });
        expect(kandY.kandydaci.map(k => k.id)).toContain(p);
        expect(kandY.do_decyzji).toBeGreaterThanOrEqual(1); // wizyta NADAL wymaga decyzji dla zakupu Y
        const w = await domena.uruchomSkladnik(repo, c, { skladnik_id: sY.id, decyzje: [{ pozycja_id: p, decyzja: 'powiaz' }], skrot: kandY.skrot, potwierdzenie_zaleznych: true, operacja_id: 3 });
        expect(w.powiazan).toBe(1);
        expect(repo._T.przydzialy.filter(x => x.pozycja_id === p && x.stan === 'zarezerwowany')).toHaveLength(1);
        expect((await saldo(repo, sX.id)).R).toBe(0);
        expect((await saldo(repo, sY.id)).R).toBe(1);
    });
    test('decyzja globalna („jednorazowa”) nadal wyklucza wizytę ze wszystkich zakupów', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'J-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 });
        sprzedaz(repo, { id: 'J-2', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '10x', kwota: 1700 });
        const c = ctx();
        await domena.zarejestrujZakupy(repo, c, { pozycje: [{ sprzedaz_id: 'J-1' }, { sprzedaz_id: 'J-2' }] });
        const s1 = repo._T.skladniki[0], s2 = repo._T.skladniki[1];
        for (const s of [s1, s2]) await domena.weryfikujSkladnik(repo, c, { skladnik_id: s.id, hist_wykorzystane: 0, hist_wycofane: 0, hist_potracone: 0, zrodlo_ustalen: 'nowy', operacja_id: 1 });
        const p = pozycja(repo, { start: '2026-11-26 10:00:00' });
        const k1 = await domena.kandydaciWizyt(repo, c, { skladnik_id: s1.id });
        await domena.uruchomSkladnik(repo, c, { skladnik_id: s1.id, decyzje: [{ pozycja_id: p, decyzja: 'jednorazowa', uzasadnienie: 'płatna osobno' }], skrot: k1.skrot, potwierdzenie_zaleznych: true, operacja_id: 2 });
        const k2 = await domena.kandydaciWizyt(repo, c, { skladnik_id: s2.id });
        const kand = k2.kandydaci.find(k => k.id === p);
        expect(kand && kand.rozliczenie).toBeTruthy(); // widoczna, ale z powodem; nie wymaga decyzji
        expect(k2.do_decyzji).toBe(0);
    });
});

describe('N13 — stan absolutny źródła sprawdzany przy PIERWSZYM imporcie', () => {
    test('pakiet już w całości zwrócony przed rejestracją nie daje dostępnego prawa', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'Z-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 });
        sprzedaz(repo, { id: 'Z-9', id_klienta: '1001', zabieg: 'ZWROT: Endermologia', szczegoly: '', kwota: -900, zwrot_do_id: 'Z-1' });
        const w = await domena.zarejestrujZakupy(repo, ctx(), { pozycje: [{ sprzedaz_id: 'Z-1' }] });
        const wynik = w.wyniki[0];
        if (wynik.wynik === 'zarejestrowano') {
            const z = repo._T.zakupy.find(x => x.sprzedaz_id === 'Z-1');
            expect(z.stan_zrodla).not.toBe('ok'); // zarejestrowany, ale oznaczony do wyjaśnienia
        } else {
            expect(wynik.wynik).toMatch(/wymaga_rozstrzygniecia|pominiete|blad/);
        }
    });
    test('pakiet zwrócony częściowo przed rejestracją wymaga uzgodnienia zakresu', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'ZC-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 });
        sprzedaz(repo, { id: 'ZC-9', id_klienta: '1001', zabieg: 'ZWROT: Endermologia', szczegoly: '', kwota: -300, zwrot_do_id: 'ZC-1' });
        const w = await domena.zarejestrujZakupy(repo, ctx(), { pozycje: [{ sprzedaz_id: 'ZC-1' }] });
        const z = repo._T.zakupy.find(x => x.sprzedaz_id === 'ZC-1');
        expect(w.wyniki[0].wynik === 'zarejestrowano' ? z.stan_zrodla : 'nie-zarejestrowano').not.toBe('ok');
    });
    test('pakiet ręcznie zakończony (karnet_zamkniety_w) przed rejestracją nie staje się dostępny', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'K-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900, karnet_zamkniety_w: '2026-10-01 12:00:00' });
        const w = await domena.zarejestrujZakupy(repo, ctx(), { pozycje: [{ sprzedaz_id: 'K-1' }] });
        const z = repo._T.zakupy.find(x => x.sprzedaz_id === 'K-1');
        expect(w.wyniki[0].wynik === 'zarejestrowano' ? z.stan_zrodla : 'nie-zarejestrowano').not.toBe('ok');
    });
    test('zdrowy pakiet (bez zwrotów, niezakończony) nadal rejestruje się ze stanem „ok”', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'OK-9', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 900 });
        const w = await domena.zarejestrujZakupy(repo, ctx(), { pozycje: [{ sprzedaz_id: 'OK-9' }] });
        expect(w.wyniki[0].wynik).toBe('zarejestrowano');
        expect(repo._T.zakupy.find(x => x.sprzedaz_id === 'OK-9').stan_zrodla).toBe('ok');
    });
    test('oferta za 0 zł NIE jest uznawana za zwróconą (0 >= 0)', async () => {
        const repo = repoPamiec(T); katalog(repo);
        sprzedaz(repo, { id: 'Z0-1', id_klienta: '1001', zabieg: 'Endermologia', szczegoly: '5x', kwota: 0 });
        const w = await domena.zarejestrujZakupy(repo, ctx(), { pozycje: [{ sprzedaz_id: 'Z0-1' }] });
        expect(w.wyniki[0].wynik).toBe('zarejestrowano');
        expect(repo._T.zakupy.find(x => x.sprzedaz_id === 'Z0-1').stan_zrodla).toBe('ok');
    });
});

describe('Z8 — zasada salonu: zabieg z pakietu po terminie ważności', () => {
    test('umówienie po terminie jest DOZWOLONE i zwraca ostrzeżenie o przekroczonej ważności', () => {
        const skl = { stan: 'aktywny', stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: `${DZIS} 08:00:00`, data_waznosci_lok: null };
        const zakup = { data_waznosci: '2026-10-01', stan: 'aktywny', stan_zrodla: 'ok', kwalifikacja: 'pakiet' };
        const powod = logika.powodNiedostepnosci(skl, zakup, { G: 5, W: 0, U: 0, F: 0, R: 0, L: 5, B: 5 }, '2026-11-20', 'aktywna');
        expect(powod).toBeNull(); // nie blokuje
        const ostrz = logika.ostrzezenia(skl, zakup, '2026-11-20');
        expect(ostrz.map(o => o.kod)).toContain('PO_TERMINIE');
        expect(ostrz.find(o => o.kod === 'PO_TERMINIE').tekst).toMatch(/2026-10-01/);
    });
    test('w terminie: brak ostrzeżenia', () => {
        const skl = { stan: 'aktywny', stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: `${DZIS} 08:00:00` };
        const zakup = { data_waznosci: '2026-12-31', stan: 'aktywny', stan_zrodla: 'ok', kwalifikacja: 'pakiet' };
        expect(logika.powodNiedostepnosci(skl, zakup, { G: 5, W: 0, U: 0, F: 0, R: 0, L: 5, B: 5 }, '2026-11-20', 'aktywna')).toBeNull();
        expect(logika.ostrzezenia(skl, zakup, '2026-11-20')).toHaveLength(0);
    });
    test('pozostałe powody niedostępności nadal blokują (brak jednostek, niezweryfikowany, wycofany)', () => {
        const baza = { stan: 'aktywny', stan_weryfikacji: 'zweryfikowany', zalezne_uzgodniono: 1, aktywny_od: `${DZIS} 08:00:00` };
        const zak = { data_waznosci: null, stan: 'aktywny', stan_zrodla: 'ok', kwalifikacja: 'pakiet' };
        expect(logika.powodNiedostepnosci(baza, zak, { G: 5, W: 0, U: 5, F: 0, R: 0, L: 0, B: 0 }, '2026-11-20', 'aktywna')).toMatch(/wykorzystany/);
        expect(logika.powodNiedostepnosci({ ...baza, stan_weryfikacji: 'niezweryfikowany' }, zak, { G: 5, W: 0, U: 0, F: 0, R: 0, L: 5, B: 5 }, '2026-11-20', 'aktywna')).toMatch(/do sprawdzenia/i);
        expect(logika.powodNiedostepnosci({ ...baza, stan: 'wycofany' }, zak, { G: 5, W: 0, U: 0, F: 0, R: 0, L: 5, B: 5 }, '2026-11-20', 'aktywna')).toMatch(/wycofany/);
    });
});
