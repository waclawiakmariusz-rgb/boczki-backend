// tests/helpers/repoPamiec.js — repozytorium W PAMIĘCI o tym samym kontrakcie co repoSql() z routes/terminarz-zakupy.js.
// Służy do testów domeny (K01–K04, K09, K12) BEZ bazy. Nie dowodzi zachowania transakcji/blokad MariaDB (te wymagają
// izolowanej bazy — narzedzia/testy-integracyjne/terminarz-zakupy.js).
'use strict';

function repoPamiec(tenant, stan = {}) {
  const T = Object.assign({ zakupy: [], skladniki: [], ruchy: [], przydzialy: [], realizacje: [], operacje: [], pozycje: [], rezerwacje: [], sprzedaz: [], ewidencja: null, licznik: 0 }, stan);
  const id = () => ++T.licznik;
  const sklZ = (s) => { const z = T.zakupy.find(x => x.id === s.zakup_id) || {}; return { ...s, id_klienta: z.id_klienta, zakup_stan: z.stan, stan_zrodla: z.stan_zrodla, data_waznosci: z.data_waznosci, zakup_nazwa: z.nazwa, zrodlo_typ: z.zrodlo_typ, sprzedaz_id: z.sprzedaz_id, zrodlo_hash: z.zrodlo_hash, zrodlo_migawka_json: z.zrodlo_migawka_json, zwroty_suma: z.zwroty_suma, kwalifikacja: z.kwalifikacja, data_zakupu: z.data_zakupu }; };
  const upd = (lista, idx, pola) => { const r = lista.find(x => x.id === idx); if (r) Object.assign(r, pola); };
  const repo = {
    tenant, _T: T,
    async skladniki(ids) { return T.skladniki.filter(s => ids.map(Number).includes(s.id)).map(sklZ); },
    async skladnikiZakupow(zakupIds) { return T.skladniki.filter(s => zakupIds.includes(s.zakup_id)).map(sklZ); },
    async zakupyKlientki(idKlienta) { return T.zakupy.filter(z => String(z.id_klienta) === String(idKlienta)).sort((a, b) => (a.data_waznosci ? 0 : 1) - (b.data_waznosci ? 0 : 1) || String(a.data_waznosci || '').localeCompare(String(b.data_waznosci || '')) || a.id - b.id); },
    async zakup(idx) { return T.zakupy.find(z => z.id === Number(idx)) || null; },
    async ruchy(ids) { return T.ruchy.filter(r => ids.includes(r.skladnik_id)); },
    async przydzialyPozycji(pozIds) { return T.przydzialy.filter(p => pozIds.map(Number).includes(p.pozycja_id)); },
    async przydzial(idx) { const p = T.przydzialy.find(x => x.id === Number(idx)); return p ? { ...p } : null; },
    async wstawPrzydzial(r) { const x = { id: id(), tenant_id: tenant, pozycja_id: r.pozycja_id, skladnik_id: r.skladnik_id, ilosc: r.ilosc, ilosc_zuzyta: 0, cykl: r.cykl || 1, stan: r.stan || 'zarezerwowany', operacja_id: r.operacja_id || null }; T.przydzialy.push(x); return x.id; },
    async aktualizujPrzydzial(idx, pola) { upd(T.przydzialy, idx, pola); },
    async realizacja(idx) { const r = T.realizacje.find(x => x.id === Number(idx)); return r ? { ...r } : null; },
    async realizacjePozycji(pozId) { return T.realizacje.filter(r => r.pozycja_id === Number(pozId)); },
    async wstawRealizacje(r) { const x = { id: id(), tenant_id: tenant, stan: 'zapisana', odwrocona_przez: null, zrodlo: 'wizyta', ...r }; T.realizacje.push(x); return x.id; },
    async aktualizujRealizacje(idx, pola) { upd(T.realizacje, idx, pola); },
    async wstawRuch(r) { const x = { id: id(), tenant_id: tenant, kierunek: 1, historyczny: 0, przydzial_id: null, realizacja_id: null, operacja_id: null, odwraca_id: null, ...r }; T.ruchy.push(x); return x.id; },
    async ruch(idx) { return T.ruchy.find(x => x.id === Number(idx)) || null; },
    async odwroceniaRuchu(idx) { return T.ruchy.filter(x => x.odwraca_id === Number(idx)); },
    async zapiszSaldo(sid, saldo) { upd(T.skladniki, sid, { saldo_json: JSON.stringify(saldo) }); },
    async aktualizujSkladnik(idx, pola) { upd(T.skladniki, idx, pola); },
    async aktualizujZakup(idx, pola) { upd(T.zakupy, idx, pola); },
    async wstawZakup(r) { const x = { id: id(), tenant_id: tenant, stan: 'aktywny', stan_zrodla: 'ok', zrodlo_typ: 'sprzedaz', zwroty_suma: 0, wersja: 1, ...r }; T.zakupy.push(x); return x.id; },
    async wstawSkladnik(r) { const x = { id: id(), tenant_id: tenant, stan: 'aktywny', stan_weryfikacji: 'niezweryfikowany', zalezne_uzgodniono: 0, aktywny_od: null, jednostka_miary: 'sesja', jednostki_na_pozycje: 1, hist_wykorzystane: null, hist_wycofane: null, hist_potracone: null, ...r }; T.skladniki.push(x); return x.id; },
    async operacja(klucz) { return T.operacje.find(o => o.klucz === klucz) || null; },
    async wstawOperacje(r) { const x = { id: id(), tenant_id: tenant, ...r }; T.operacje.push(x); return x.id; },
    async aktualizujOperacje(idx, pola) { upd(T.operacje, idx, pola); },
    async pozycja(idx) { const p = T.pozycje.find(x => x.id === Number(idx)); if (!p) return null; const rez = T.rezerwacje.find(r => r.id === p.rezerwacja_id) || {}; return { ...p, id_klienta: rez.id_klienta, klient_nazwa: rez.klient_nazwa, rez_wersja: rez.wersja, rez_status: rez.status }; },
    async aktualizujPozycje(idx, pola) { upd(T.pozycje, idx, pola); },
    async zrodloSprzedaz(sid) { const row = T.sprzedaz.find(s => String(s.id) === String(sid)) || null; const zw = T.sprzedaz.filter(s => s.zwrot_do_id === String(sid) && s.status !== 'USUNIĘTY').reduce((a, s) => a + Math.abs(Number(s.kwota)), 0); return { row, zwrotySuma: zw }; },
    async ewidencja() { return T.ewidencja; },
    async zapiszEwidencje(pola) { T.ewidencja = Object.assign(T.ewidencja || { tenant_id: tenant, tryb: 'nie_uruchomiono' }, pola); },
    async aktywnePrzydzialySkladnika(sid) { return T.przydzialy.filter(p => p.skladnik_id === Number(sid) && p.stan === 'zarezerwowany'); },
    // pomocnicze dla testów
    dodajPozycje(p) { const x = { id: id(), tenant_id: tenant, stan: 'zaplanowana', zakup_skladnik_id: null, jednostki_wymagane: 1, ...p }; T.pozycje.push(x); return x.id; },
    dodajRezerwacje(r) { const x = { id: id(), tenant_id: tenant, status: 'potwierdzona', wersja: 1, ...r }; T.rezerwacje.push(x); return x.id; },
    migawka() { return JSON.parse(JSON.stringify(T)); },
    przywroc(m) { Object.assign(T, JSON.parse(JSON.stringify(m))); },
  };
  return repo;
}

module.exports = { repoPamiec };
