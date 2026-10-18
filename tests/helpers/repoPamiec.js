// tests/helpers/repoPamiec.js — repozytorium W PAMIĘCI o tym samym kontrakcie co repoSql() z routes/terminarz-zakupy.js.
// Służy do testów domeny (K01–K04, K09, K12, Z3-*) BEZ bazy. Nie dowodzi zachowania transakcji/blokad MariaDB (te wymagają
// izolowanej bazy — narzedzia/testy-integracyjne/terminarz-zakupy.js).
'use strict';
const { logika } = require('../../routes/terminarz-zakupy');

function repoPamiec(tenant, stan = {}) {
  const T = Object.assign({ zakupy: [], skladniki: [], ruchy: [], przydzialy: [], realizacje: [], operacje: [], pozycje: [], rezerwacje: [], sprzedaz: [], uslugi: [], oferty: [], wersje: [], wersjeSkladniki: [], ewidencja: null, licznik: 0 }, stan);
  const id = () => ++T.licznik;
  const sklZ = (s) => { const z = T.zakupy.find(x => x.id === s.zakup_id) || {}; return { ...s, id_klienta: z.id_klienta, zakup_stan: z.stan, stan_zrodla: z.stan_zrodla, data_waznosci: z.data_waznosci, zakup_nazwa: z.nazwa, zrodlo_typ: z.zrodlo_typ, sprzedaz_id: z.sprzedaz_id, zrodlo_hash: z.zrodlo_hash, zrodlo_migawka_json: z.zrodlo_migawka_json, zrodla_json: z.zrodla_json, zwroty_suma: z.zwroty_suma, kwalifikacja: z.kwalifikacja, data_zakupu: z.data_zakupu, oferta_wersja_id: z.oferta_wersja_id }; };
  const upd = (lista, idx, pola) => { const r = lista.find(x => x.id === idx); if (r) Object.assign(r, pola); };
  const sprz = (row) => row ? { ...row } : null;
  const repo = {
    tenant, _T: T,
    async skladniki(ids) { return T.skladniki.filter(s => ids.map(Number).includes(s.id)).map(sklZ); },
    async skladnikiZakupow(zakupIds) { return T.skladniki.filter(s => zakupIds.includes(s.zakup_id)).map(sklZ); },
    async skladnikiSalonu(filtr = {}) { return T.skladniki.filter(s => !filtr.stan_weryfikacji || s.stan_weryfikacji === filtr.stan_weryfikacji).map(sklZ); },
    async zakupyKlientki(idKlienta) { return T.zakupy.filter(z => String(z.id_klienta) === String(idKlienta)).sort((a, b) => (a.data_waznosci ? 0 : 1) - (b.data_waznosci ? 0 : 1) || String(a.data_waznosci || '').localeCompare(String(b.data_waznosci || '')) || a.id - b.id); },
    async zakup(idx) { const z = T.zakupy.find(x => x.id === Number(idx)); return z ? { ...z } : null; },
    async zakupyPoSprzedazy(ids) { return T.zakupy.filter(z => ids.map(String).includes(String(z.sprzedaz_id))); },
    async zakupyDoUzgodnienia(limit = 200) { return T.zakupy.filter(z => (z.zrodlo_typ || 'sprzedaz') === 'sprzedaz' && z.stan === 'aktywny').slice(0, limit); },
    async ruchy(ids) { return T.ruchy.filter(r => ids.includes(r.skladnik_id)); },
    async przydzialyPozycji(pozIds) { return T.przydzialy.filter(p => pozIds.map(Number).includes(p.pozycja_id)); },
    async przydzial(idx) { const p = T.przydzialy.find(x => x.id === Number(idx)); return p ? { ...p } : null; },
    async wstawPrzydzial(r) { const x = { id: id(), tenant_id: tenant, pozycja_id: r.pozycja_id, skladnik_id: r.skladnik_id, ilosc: r.ilosc, ilosc_zuzyta: 0, cykl: r.cykl || 1, stan: r.stan || 'zarezerwowany', operacja_id: r.operacja_id || null }; T.przydzialy.push(x); return x.id; },
    async aktualizujPrzydzial(idx, pola) { upd(T.przydzialy, idx, pola); },
    async realizacja(idx) { const r = T.realizacje.find(x => x.id === Number(idx)); return r ? { ...r } : null; },
    async realizacjePozycji(pozIds) { return T.realizacje.filter(r => pozIds.map(Number).includes(r.pozycja_id)); },
    async wstawRealizacje(r) { const x = { id: id(), tenant_id: tenant, stan: 'zapisana', odwrocona_przez: null, zrodlo: 'wizyta', ...r }; T.realizacje.push(x); return x.id; },
    async aktualizujRealizacje(idx, pola) { upd(T.realizacje, idx, pola); },
    async wstawRuch(r) { const x = { id: id(), tenant_id: tenant, kierunek: 1, historyczny: 0, przydzial_id: null, realizacja_id: null, operacja_id: null, odwraca_id: null, ...r }; T.ruchy.push(x); return x.id; },
    async ruch(idx) { return T.ruchy.find(x => x.id === Number(idx)) || null; },
    async zapiszSaldo(sid, saldo) { upd(T.skladniki, sid, { saldo_json: JSON.stringify(saldo) }); },
    async aktualizujSkladnik(idx, pola) { upd(T.skladniki, idx, pola); },
    async aktualizujZakup(idx, pola) { upd(T.zakupy, idx, pola); },
    async wstawZakup(r) { if (T.zakupy.some(z => String(z.sprzedaz_id) === String(r.sprzedaz_id))) { const e = new Error('Duplicate entry'); e.code = 'ER_DUP_ENTRY'; throw e; } const x = { id: id(), tenant_id: tenant, stan: 'aktywny', stan_zrodla: 'ok', zrodlo_typ: 'sprzedaz', zwroty_suma: 0, wersja: 1, ...r }; T.zakupy.push(x); return x.id; },
    async wstawSkladnik(r) { const x = { id: id(), tenant_id: tenant, stan: 'aktywny', stan_weryfikacji: 'niezweryfikowany', zalezne_uzgodniono: 0, aktywny_od: null, jednostka_miary: 'sesja', jednostki_na_pozycje: 1, hist_wykorzystane: null, hist_wycofane: null, hist_potracone: null, plan_json: null, plan_skrot: null, ...r }; T.skladniki.push(x); return x.id; },
    async operacja(klucz) { return T.operacje.find(o => o.klucz === klucz) || null; },
    async wstawOperacje(r) { const x = { id: id(), tenant_id: tenant, ...r }; T.operacje.push(x); return x.id; },
    async aktualizujOperacje(idx, pola) { upd(T.operacje, idx, pola); },
    async pozycja(idx) { const p = T.pozycje.find(x => x.id === Number(idx)); if (!p) return null; const rez = T.rezerwacje.find(r => r.id === p.rezerwacja_id) || {}; return { ...p, id_klienta: rez.id_klienta, klient_nazwa: rez.klient_nazwa, rez_wersja: rez.wersja, rez_status: rez.status }; },
    async aktualizujPozycje(idx, pola) { upd(T.pozycje, idx, pola); },
    async pozycjeKlientkiUslugi(idKlienta, uslugaId) {
      return T.pozycje.filter(p => { const rez = T.rezerwacje.find(r => r.id === p.rezerwacja_id) || {}; return String(rez.id_klienta) === String(idKlienta) && String(p.usluga_id) === String(uslugaId) && !['anulowana', 'odrzucona', 'wygasla'].includes(rez.status) && ['zaplanowana', 'w_trakcie', 'przerwana'].includes(p.stan); })
        .map(p => { const rez = T.rezerwacje.find(r => r.id === p.rezerwacja_id) || {}; return { id: p.id, rezerwacja_id: p.rezerwacja_id, usluga_id: p.usluga_id, kategoria: p.kategoria, wariant: p.wariant || null, pracownik: p.pracownik || null, start: p.start, stan: p.stan, rozliczenie: p.rozliczenie || null, rez_wersja: rez.wersja, rez_status: rez.status, aktywne_przydzialy: T.przydzialy.filter(a => a.pozycja_id === p.id && a.stan === 'zarezerwowany').length, zuzyte_przydzialy: T.przydzialy.filter(a => a.pozycja_id === p.id && a.stan === 'zuzyty').length }; }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
    },
    async zrodloSprzedaz(sid) {
      const row = sprz(T.sprzedaz.find(s => String(s.id) === String(sid) && String(s.status || 'AKTYWNY') !== '__brak__'));
      if (!row) return { row: null, zwrotySuma: 0, paragon: [], powiazane: [] };
      const baza = logika.bazaParagonu(sid);
      const paragon = T.sprzedaz.filter(s => (String(s.id) === baza || String(s.id).startsWith(baza + '-')) && String(s.status || 'AKTYWNY') !== 'USUNIĘTY').map(sprz);
      const dop = logika.powiazaneDoplaty(row, paragon);
      const suma = (x) => T.sprzedaz.filter(s => String(s.zwrot_do_id) === String(x) && String(s.status || 'AKTYWNY') !== 'USUNIĘTY').reduce((a, s) => a + Math.abs(Number(s.kwota)), 0);
      return { row, zwrotySuma: suma(sid), paragon, powiazane: dop.powiazane.map(p => ({ ...p, zwroty_suma: suma(p.id) })), kandydatki: dop.kandydatki.map(p => ({ ...p, zwroty_suma: suma(p.id) })), niejednoznaczne: dop.niejednoznaczne };
    },
    async sprzedazeDoPodgladu({ id_klienta, limit = 300 } = {}) { return T.sprzedaz.filter(s => !id_klienta || String(s.id_klienta) === String(id_klienta)).map(sprz).slice(0, limit); },
    async paragony(bazy) { return T.sprzedaz.filter(s => bazy.some(b => String(s.id) === b || String(s.id).startsWith(b + '-')) && String(s.status || 'AKTYWNY') !== 'USUNIĘTY').map(sprz); },
    async uslugiCennika() { return T.uslugi.map(u => ({ ...u, wariant: u.wariant || '' })); },
    async wersjeOfert() { return T.wersje.map(w => ({ ...w, usluga_id: (T.oferty.find(o => o.id === w.oferta_id) || {}).usluga_id, skladniki: T.wersjeSkladniki.filter(s => s.wersja_id === w.id) })); },
    async ewidencja() { return T.ewidencja ? { ...T.ewidencja } : null; },
    async zapiszEwidencje(pola) { T.ewidencja = Object.assign(T.ewidencja || { tenant_id: tenant, tryb: 'nie_uruchomiono', przerwa_od: null }, pola); },
    async aktywnePrzydzialySkladnika(sid) { return T.przydzialy.filter(p => p.skladnik_id === Number(sid) && p.stan === 'zarezerwowany'); },
    async liczniki() { return { zakupy: T.zakupy.length, zweryfikowane: T.skladniki.filter(s => s.stan_weryfikacji === 'zweryfikowany').length, niezweryfikowane: T.skladniki.filter(s => s.stan_weryfikacji !== 'zweryfikowany').length, uruchomione: T.skladniki.filter(s => s.zalezne_uzgodniono && s.aktywny_od).length, z_planem: T.skladniki.filter(s => s.plan_json && !s.aktywny_od).length, zrodla_do_uzgodnienia: T.zakupy.filter(z => z.stan_zrodla !== 'ok').length, aktywne_przydzialy: T.przydzialy.filter(p => p.stan === 'zarezerwowany').length, realizacje: T.realizacje.filter(r => r.stan === 'zapisana').length, kwalifikacje_do_potwierdzenia: T.zakupy.filter(z => z.kwalifikacja === 'do_sprawdzenia').length }; },
    // pomocnicze dla testów
    // N02: punkty zapisu — w pamięci realizowane migawką tablic stanu (odpowiednik SAVEPOINT / ROLLBACK TO SAVEPOINT).
    async savepoint(n) { (T._sp = T._sp || {})[n] = JSON.stringify(T, (k, v) => k === '_sp' ? undefined : v); },
    async doSavepoint(n) { const s = (T._sp || {})[n]; if (!s) return; const kopia = JSON.parse(s); for (const k of Object.keys(kopia)) { if (Array.isArray(T[k])) { T[k].length = 0; T[k].push(...kopia[k]); } else T[k] = kopia[k]; } },
    async zwolnijSavepoint(n) { if (T._sp) delete T._sp[n]; },
    dodajPozycje(p) { const x = { id: id(), tenant_id: tenant, stan: 'zaplanowana', zakup_skladnik_id: null, jednostki_wymagane: 1, rozliczenie: null, ...p }; T.pozycje.push(x); return x.id; },
    dodajRezerwacje(r) { const x = { id: id(), tenant_id: tenant, status: 'potwierdzona', wersja: 1, ...r }; T.rezerwacje.push(x); return x.id; },
    dodajUsluge(u) { T.uslugi.push({ wariant: '', ...u }); return u.id; },
    dodajOferte(usluga_id, wersje) { const o = { id: id(), tenant_id: tenant, usluga_id, stan: 'zatwierdzona' }; T.oferty.push(o); for (const w of wersje) { const x = { id: id(), tenant_id: tenant, oferta_id: o.id, wersja: w.wersja || 1, rodzaj: w.rodzaj || 'pakiet', stan: w.stan || 'zatwierdzona', obowiazuje_od: w.od, obowiazuje_do: w.do || null }; T.wersje.push(x); for (const s of (w.skladniki || [])) T.wersjeSkladniki.push({ wersja_id: x.id, jednostka_miary: 'sesja', jednostki_na_pozycje: 1, ...s }); } return o.id; },
    migawka() { return JSON.parse(JSON.stringify(T)); },
    przywroc(m) { Object.assign(T, JSON.parse(JSON.stringify(m))); },
  };
  return repo;
}

module.exports = { repoPamiec };
