// routes/raport-salonu.js — „Raport Salonu” dla panelu admina (9.11.2026).
//
// Co robi: dla jednego salonu (login z Licencje) składa raport aktywności: licencja, dziennik Logi
// (per dzień, per akcja, ostatnie wpisy), ostatnie logowania, włączone dodatki, maile wprowadzające,
// lista kontrolna wdrożenia, podejrzane dane oraz ślady we WSZYSTKICH tabelach z kolumną tenant_id.
//
// ZASADY (wymóg właściciela):
//  • wyłącznie SELECT — moduł nie ma ani jednego INSERT/UPDATE/DELETE/ALTER; zero zmian schematu,
//    zero nowych tabel (bez wpływu na hartowanie i migracje startowe);
//  • tenant_id danych salonu = Licencje.id_bazy (NIE login) — pomyłka z 7.11 zapisana w pamięci;
//  • generowanie wyłącznie na kliknięcie admina (ok. 130 zapytań zliczających) — nigdy w pętli po salonach;
//  • zapytania do tabel wykonywane po kilka naraz (limit współbieżności), żeby nie zająć całej puli;
//  • hasła/tokeny/PIN-y maskowane zanim cokolwiek opuści serwer;
//  • admin: ten sam token co reszta admin.html (tabela admin_sessions, nagłówek X-Admin-Token).
const express = require('express');

const LIMIT_WSPOLBIEZNOSCI = 4;
const CACHE_SCHEMATU_MS = 10 * 60 * 1000;
const OSTATNIE_LOGI = 150;
const DNI_AKTYWNOSCI = 30;

// ───────────────────────── czyste funkcje (testowane bez bazy) ─────────────────────────

/** Nazwa znormalizowana do wykrywania dubli: małe litery, bez podwójnych spacji, bez znaków interpunkcyjnych. */
function normalizujNazwe(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Maskuje wartości pól, które wyglądają na sekret (hasło, token, PIN). Zwraca kopię. */
function maskujSekrety(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = /haslo|password|token|secret|pin/i.test(k) ? '***' : v;
  return out;
}

/** Liczy wiersze Logi per dzień (klucz YYYY-MM-DD) i per akcja; zwraca też ostatnie N wierszy. */
function podsumujLogi(wiersze, ostatnieN = OSTATNIE_LOGI) {
  const perDzien = {};
  const perAkcja = {};
  let bledy = 0;
  let sesjaWygasla = 0;
  for (const w of wiersze || []) {
    const d = w.dzien || (w.data_zdarzenia ? String(w.data_zdarzenia).slice(0, 10) : '');
    if (d) perDzien[d] = (perDzien[d] || 0) + 1;
    const a = String(w.akcja || '').trim() || '(bez akcji)';
    perAkcja[a] = (perAkcja[a] || 0) + 1;
    if (/^BŁĄD/i.test(a)) {
      bledy++;
      if (/sesja wygasła/i.test(String(w.opis || ''))) sesjaWygasla++;
    }
  }
  const dni = Object.entries(perDzien).sort((a, b) => a[0].localeCompare(b[0])).map(([dzien, n]) => ({ dzien, n }));
  const akcje = Object.entries(perAkcja).sort((a, b) => b[1] - a[1]).map(([akcja, n]) => ({ akcja, n }));
  const ostatnie = (wiersze || []).slice(0, ostatnieN);
  return { dni, akcje, bledy, sesja_wygasla: sesjaWygasla, ostatnie };
}

/**
 * Lista kontrolna wdrożenia salonu. `liczby` to zliczenia z bazy (0 gdy brak tabeli).
 * Każda pozycja: { klucz, nazwa, ok, szczegol }.
 */
function listaKontrolna(l) {
  const n = (k) => Number((l || {})[k]) || 0;
  const poz = [];
  const dodaj = (klucz, nazwa, ok, szczegol) => poz.push({ klucz, nazwa, ok: !!ok, szczegol: szczegol || '' });
  dodaj('rodo', 'Pierwsza zgoda RODO podpisana', n('rodo') > 0, n('rodo') ? `${n('rodo')} zgód` : 'brak zgód w rejestrze');
  dodaj('oswiadczenia', 'Oświadczenie zdrowotne podpisane', n('oswiadczenia') > 0, n('oswiadczenia') ? `${n('oswiadczenia')} oświadczeń` : 'brak');
  dodaj('pracownicy', 'Zespół wpisany (więcej niż właścicielka)', n('pracownicy') > 1, `${n('pracownicy')} os. w zespole, ${n('uzytkownicy')} kont z PIN-em`);
  dodaj('uslugi', 'Cennik usług', n('uslugi') > 0, n('uslugi') ? `${n('uslugi')} pozycji` : 'pusty');
  dodaj('kosmetyki', 'Kosmetyki detaliczne (słownik Produktów)', n('slownik') > 0, n('slownik') ? `${n('slownik')} produktów, stan: ${n('magazyn')} pozycji` : 'brak produktów');
  dodaj('magazyn_pro', 'Magazyn pro (materiały)', n('raport_magazyn') > 0, n('raport_magazyn') ? `${n('raport_magazyn')} pozycji w ${n('raport_kategorie')} kategoriach` : 'pusty');
  dodaj('klienci', 'Kartoteka klientek', n('klienci') > 0, n('klienci') ? `${n('klienci')} klientek` : 'brak');
  dodaj('sprzedaz', 'Pierwsza sprzedaż', n('sprzedaz') > 0, n('sprzedaz') ? `${n('sprzedaz')} pozycji${l.sprzedaz_ostatnia ? `, ostatnia ${l.sprzedaz_ostatnia}` : ''}` : 'brak sprzedaży');
  dodaj('terminarz', 'Terminarz włączony i ustawiony', n('terminarz_feature') > 0 || n('term_ustawienia') > 0, n('term_ustawienia') ? 'ustawienia zapisane' : (n('terminarz_feature') ? 'dodatek włączony, bez ustawień' : 'wyłączony'));
  dodaj('grafik', 'Grafik zespołu w Terminarzu', n('term_grafik') > 0, n('term_grafik') ? `${n('term_grafik')} wpisów grafiku` : 'brak');
  dodaj('wizyty', 'Pierwsza wizyta w Terminarzu', n('rezerwacje') > 0, n('rezerwacje') ? `${n('rezerwacje')} rezerwacji${l.rezerwacja_ostatnia ? `, ostatnia ${l.rezerwacja_ostatnia}` : ''}` : 'brak rezerwacji');
  dodaj('maile', 'Maile wprowadzające wysłane', n('maile_wyslane') > 0, n('maile_wyslane') ? `${n('maile_wyslane')} z serii` : 'żaden');
  return poz;
}

/**
 * Wykrywa podejrzane dane na podstawie surowych wierszy (tylko potrzebne kolumny).
 * Zwraca listę { typ, waga: 'blad'|'uwaga', opis, ile, przyklady[] }.
 */
function wykryjPodejrzane(d) {
  const w = [];
  const dodaj = (typ, waga, opis, przyklady) => { if (przyklady.length) w.push({ typ, waga, opis, ile: przyklady.length, przyklady: przyklady.slice(0, 8) }); };
  const uslugi = d.uslugi || [];
  dodaj('uslugi_puste', 'blad', 'Usługi bez nazwy lub bez ceny (zapisane pustym formularzem)',
    uslugi.filter(u => !normalizujNazwe(u.kategoria) && !normalizujNazwe(u.wariant) || u.cena == null || u.cena === '')
      .map(u => `${String(u.kategoria || '').trim() || '(bez kategorii)'} / ${String(u.wariant || '').trim() || '(bez wariantu)'} — ${u.cena == null || u.cena === '' ? 'bez ceny' : u.cena + ' zł'}`));
  const dubleUslug = znajdzDuble(uslugi, u => `${normalizujNazwe(u.kategoria)} | ${normalizujNazwe(u.wariant)}`, u => `${String(u.kategoria || '').trim()} / ${String(u.wariant || '').trim()}`);
  dodaj('uslugi_duble', 'uwaga', 'Ta sama usługa wpisana dwa razy (różnice tylko w wielkości liter lub spacjach)', dubleUslug);

  const zlaData = (x) => { if (!x) return false; const r = String(x).slice(0, 4); return r < '1950' || r > '2100'; };
  const rm = d.raport_magazyn || [];
  dodaj('magazyn_pro_daty', 'blad', 'Magazyn pro: nieprawdopodobna data ważności (rok przed 1950 albo po 2100)',
    rm.filter(p => zlaData(p.data_waznosci)).map(p => `${String(p.nazwa || '').trim()} — ${String(p.data_waznosci).slice(0, 10)}`));
  dodaj('magazyn_pro_ujemne', 'blad', 'Magazyn pro: stan ujemny', rm.filter(p => Number(p.ilosc) < 0).map(p => `${String(p.nazwa || '').trim()} — ${p.ilosc}`));
  dodaj('magazyn_pro_duble', 'uwaga', 'Magazyn pro: ten sam produkt pod dwiema nazwami (przestawione słowa lub literówka w wielkości liter)',
    znajdzDuble(rm, p => normalizujNazwe(p.nazwa).split(' ').sort().join(' '), p => `${String(p.nazwa || '').trim()} (${Number(p.ilosc) || 0} ${String(p.jednostka || '').trim()})`));
  const detalWPro = rm.filter(p => /detal|kosmetyk|sprzeda/i.test(String(p.kategoria || '')));
  dodaj('kosmetyki_w_magazynie_pro', 'uwaga', 'Magazyn pro: kategoria wygląda na kosmetyki detaliczne — do sprzedaży służy moduł Kosmetyki (słownik + stan)',
    detalWPro.map(p => `${String(p.kategoria || '').trim()} › ${String(p.nazwa || '').trim()}`));

  const mg = d.magazyn || [];
  dodaj('kosmetyki_daty', 'blad', 'Kosmetyki: nieprawdopodobna data ważności', mg.filter(p => zlaData(p.data_waznosci)).map(p => `${String(p.nazwa_produktu || '').trim()} — ${String(p.data_waznosci).slice(0, 10)}`));
  dodaj('kosmetyki_ujemne', 'blad', 'Kosmetyki: stan ujemny', mg.filter(p => Number(p.ilosc) < 0).map(p => `${String(p.nazwa_produktu || '').trim()} — ${p.ilosc}`));

  const sl = d.slownik || [];
  dodaj('slownik_duble', 'uwaga', 'Słownik Produktów: ten sam produkt wpisany dwa razy',
    znajdzDuble(sl, s => `${normalizujNazwe(s.firma)} | ${normalizujNazwe(s.model).split(' ').sort().join(' ')}`, s => `${String(s.firma || '').trim()} ${String(s.model || '').trim()}`));
  dodaj('slownik_bez_ceny', 'uwaga', 'Słownik Produktów: brak ceny detalicznej', sl.filter(s => s.cena_detal == null || s.cena_detal === '').map(s => `${String(s.firma || '').trim()} ${String(s.model || '').trim()}`));

  const pr = d.pracownicy || [];
  dodaj('pracownicy_duble', 'uwaga', 'Zespół: to samo imię dwa razy', znajdzDuble(pr, p => normalizujNazwe(p.imie), p => String(p.imie || '').trim()));
  return w;
}

/** Zwraca etykiety grup (co najmniej 2 wiersze o tym samym kluczu), każda grupa jako „A ≈ B”. */
function znajdzDuble(wiersze, klucz, etykieta) {
  const grupy = new Map();
  for (const w of wiersze || []) {
    const k = klucz(w);
    if (!k || !k.replace(/[\s|]/g, '')) continue;
    if (!grupy.has(k)) grupy.set(k, []);
    grupy.get(k).push(etykieta(w));
  }
  return [...grupy.values()].filter(g => g.length > 1).map(g => g.join(' ≈ '));
}

/** Wykonuje zadania (funkcje zwracające Promise) po `limit` naraz, zachowując kolejność wyników. */
async function poKilka(zadania, limit = LIMIT_WSPOLBIEZNOSCI) {
  const wyniki = new Array(zadania.length);
  let i = 0;
  async function pracownik() {
    while (i < zadania.length) { const j = i++; wyniki[j] = await zadania[j](); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, zadania.length) }, pracownik));
  return wyniki;
}

// ───────────────────────── router ─────────────────────────

module.exports = (db) => {
  const router = express.Router();
  const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
  const bezpieczne = (sql, params, domyslne) => q(sql, params).catch((e) => ({ __blad: e.code || e.message, __domyslne: domyslne }));
  const liczba = async (sql, params) => { const r = await bezpieczne(sql, params, 0); return Array.isArray(r) && r[0] ? Number(Object.values(r[0])[0]) || 0 : 0; };

  // ── admin: ten sam token co reszta panelu (tabela admin_sessions z routes/admin.js) ──
  function wymagajAdmina(req, res, next) {
    const token = req.headers['x-admin-token'] || (req.query && req.query.admin_token);
    if (!token) return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
    db.query('SELECT expires FROM admin_sessions WHERE token = ?', [token], (err, rows) => {
      if (err || !rows || !rows.length || Date.now() > Number(rows[0].expires)) {
        return res.status(403).json({ status: 'error', message: 'Sesja wygasła — zaloguj się ponownie.' });
      }
      next();
    });
  }

  // ── schemat: tabele z tenant_id + pierwsza kolumna datowa; jedno zapytanie, pamiętane 10 min ──
  let schematCache = { kiedy: 0, tabele: null };
  async function tabeleZTenantem() {
    if (schematCache.tabele && Date.now() - schematCache.kiedy < CACHE_SCHEMATU_MS) return schematCache.tabele;
    const rows = await q(
      `SELECT table_name t, column_name k, data_type d, ordinal_position p FROM information_schema.columns
       WHERE table_schema = DATABASE() AND (column_name = 'tenant_id' OR data_type IN ('datetime','timestamp','date'))
       ORDER BY table_name, ordinal_position`);
    const map = new Map();
    for (const r of rows) {
      const t = r.t || r.TABLE_NAME, k = r.k || r.COLUMN_NAME, d = r.d || r.DATA_TYPE;
      if (!map.has(t)) map.set(t, { tabela: t, maTenant: false, kolumnaDaty: null });
      const e = map.get(t);
      if (k === 'tenant_id') e.maTenant = true;
      else if (!e.kolumnaDaty && ['datetime', 'timestamp', 'date'].includes(String(d).toLowerCase())) e.kolumnaDaty = k;
    }
    const tabele = [...map.values()].filter(e => e.maTenant).sort((a, b) => a.tabela.localeCompare(b.tabela));
    schematCache = { kiedy: Date.now(), tabele };
    return tabele;
  }

  // GET /api/admin/raport-salonu?login=X  (albo ?id_bazy=X)
  router.get('/admin/raport-salonu', wymagajAdmina, async (req, res) => {
    const start = Date.now();
    let zapytan = 0;
    const licz = (p) => { zapytan++; return p; };
    try {
      const login = String(req.query.login || '').trim();
      const idBazy = String(req.query.id_bazy || '').trim();
      if (!login && !idBazy) return res.status(400).json({ status: 'error', message: 'Podaj login salonu (?login=) albo id_bazy.' });

      const lic = await licz(q(login ? 'SELECT * FROM Licencje WHERE login = ? LIMIT 1' : 'SELECT * FROM Licencje WHERE id_bazy = ? LIMIT 1', [login || idBazy]));
      if (!lic.length) return res.status(404).json({ status: 'error', message: 'Nie znaleziono salonu o takim loginie.' });
      const licencja = maskujSekrety(lic[0]);
      const tenant = lic[0].id_bazy || lic[0].login;

      // ── dziennik Logi ──
      const [logiMeta, logiDni, logiAkcje, logiOstatnie] = await Promise.all([
        licz(bezpieczne('SELECT COUNT(*) n, MIN(data_zdarzenia) od, MAX(data_zdarzenia) do_ FROM Logi WHERE tenant_id = ?', [tenant], [])),
        licz(bezpieczne(`SELECT DATE_FORMAT(data_zdarzenia, '%Y-%m-%d') dzien, COUNT(*) n FROM Logi WHERE tenant_id = ? AND data_zdarzenia >= DATE_SUB(CURDATE(), INTERVAL ${DNI_AKTYWNOSCI} DAY) GROUP BY dzien ORDER BY dzien`, [tenant], [])),
        licz(bezpieczne('SELECT akcja, COUNT(*) n FROM Logi WHERE tenant_id = ? GROUP BY akcja ORDER BY n DESC LIMIT 20', [tenant], [])),
        licz(bezpieczne(`SELECT DATE_FORMAT(data_zdarzenia, '%Y-%m-%d %H:%i') kiedy, pracownik, akcja, modul, opis FROM Logi WHERE tenant_id = ? ORDER BY data_zdarzenia DESC, id DESC LIMIT ${OSTATNIE_LOGI}`, [tenant], [])),
      ]);
      const meta = Array.isArray(logiMeta) && logiMeta[0] ? logiMeta[0] : { n: 0, od: null, do_: null };
      const pods = podsumujLogi(Array.isArray(logiOstatnie) ? logiOstatnie : []);
      const logi = {
        razem: Number(meta.n) || 0, od: meta.od, do: meta.do_,
        dni: Array.isArray(logiDni) ? logiDni.map(r => ({ dzien: r.dzien, n: Number(r.n) })) : [],
        akcje: Array.isArray(logiAkcje) ? logiAkcje.map(r => ({ akcja: r.akcja || '(bez akcji)', n: Number(r.n) })) : [],
        bledy_w_ostatnich: pods.bledy, sesja_wygasla_w_ostatnich: pods.sesja_wygasla,
        ostatnie: pods.ostatnie,
      };

      // ── logowania, dodatki, maile ──
      const [sesje, dodatki, maile] = await Promise.all([
        licz(bezpieczne('SELECT login, created_at, expires FROM Sesje WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 5', [tenant], [])),
        licz(bezpieczne('SELECT feature_key, enabled, monthly_price_grosze, activated_at, cancelled_at, activated_by FROM Tenant_Features WHERE tenant_id = ? ORDER BY activated_at', [tenant], [])),
        licz(bezpieczne('SELECT etap, data_wyslania FROM Maile_wprowadzajace_wyslane WHERE tenant_id = ? ORDER BY data_wyslania', [tenant], [])),
      ]);

      // ── zliczenia do listy kontrolnej ──
      const Z = {};
      const zliczenia = [
        ['rodo', 'SELECT COUNT(*) FROM Rejestr_RODO WHERE tenant_id = ?'],
        ['oswiadczenia', 'SELECT COUNT(*) FROM `Rejestr_Oświadczeń` WHERE tenant_id = ?'],
        ['pracownicy', 'SELECT COUNT(*) FROM Pracownicy WHERE tenant_id = ?'],
        ['uzytkownicy', 'SELECT COUNT(*) FROM `Użytkownicy` WHERE tenant_id = ?'],
        ['uslugi', 'SELECT COUNT(*) FROM Uslugi WHERE tenant_id = ?'],
        ['slownik', 'SELECT COUNT(*) FROM Slownik WHERE tenant_id = ?'],
        ['magazyn', 'SELECT COUNT(*) FROM Magazyn WHERE tenant_id = ?'],
        ['raport_magazyn', 'SELECT COUNT(*) FROM Raport_Magazyn WHERE tenant_id = ?'],
        ['raport_kategorie', 'SELECT COUNT(*) FROM Raport_Kategorie WHERE tenant_id = ?'],
        ['klienci', 'SELECT COUNT(*) FROM Klienci WHERE tenant_id = ? AND data_usuniecia IS NULL'],
        ['sprzedaz', 'SELECT COUNT(*) FROM Sprzedaz WHERE tenant_id = ?'],
        ['rezerwacje', 'SELECT COUNT(*) FROM Term_Rezerwacje WHERE tenant_id = ?'],
        ['term_ustawienia', 'SELECT COUNT(*) FROM Term_Ustawienia WHERE tenant_id = ?'],
        ['term_grafik', 'SELECT COUNT(*) FROM Term_Grafik WHERE tenant_id = ?'],
        ['terminarz_feature', "SELECT COUNT(*) FROM Tenant_Features WHERE tenant_id = ? AND feature_key = 'terminarz' AND enabled = 1"],
        ['maile_wyslane', 'SELECT COUNT(*) FROM Maile_wprowadzajace_wyslane WHERE tenant_id = ?'],
        ['tickety', 'SELECT COUNT(*) FROM Zgloszenia_Tickety WHERE tenant_id = ?'],
      ];
      const wynikiZliczen = await poKilka(zliczenia.map(([k, sql]) => () => licz(liczba(sql, [tenant])).then(n => [k, n])));
      for (const [k, n] of wynikiZliczen) Z[k] = n;
      const [ostSprz, ostRez] = await Promise.all([
        licz(bezpieczne('SELECT DATE_FORMAT(MAX(data_sprzedazy), "%Y-%m-%d") d FROM Sprzedaz WHERE tenant_id = ?', [tenant], [])),
        licz(bezpieczne('SELECT DATE_FORMAT(MAX(start), "%Y-%m-%d") d FROM Term_Rezerwacje WHERE tenant_id = ?', [tenant], [])),
      ]);
      Z.sprzedaz_ostatnia = Array.isArray(ostSprz) && ostSprz[0] ? ostSprz[0].d : null;
      Z.rezerwacja_ostatnia = Array.isArray(ostRez) && ostRez[0] ? ostRez[0].d : null;

      // ── surowe wiersze do wykrywania podejrzanych danych (tylko potrzebne kolumny) ──
      const [uslugi, raportMagazyn, magazyn, slownik, pracownicy] = await Promise.all([
        licz(bezpieczne('SELECT kategoria, wariant, cena FROM Uslugi WHERE tenant_id = ?', [tenant], [])),
        licz(bezpieczne('SELECT kategoria, nazwa, ilosc, jednostka, data_waznosci FROM Raport_Magazyn WHERE tenant_id = ?', [tenant], [])),
        licz(bezpieczne('SELECT nazwa_produktu, ilosc, data_waznosci FROM Magazyn WHERE tenant_id = ?', [tenant], [])),
        licz(bezpieczne('SELECT firma, model, cena_detal FROM Slownik WHERE tenant_id = ?', [tenant], [])),
        licz(bezpieczne('SELECT imie FROM Pracownicy WHERE tenant_id = ?', [tenant], [])),
      ]);
      const tab = (x) => (Array.isArray(x) ? x : []);
      const podejrzane = wykryjPodejrzane({ uslugi: tab(uslugi), raport_magazyn: tab(raportMagazyn), magazyn: tab(magazyn), slownik: tab(slownik), pracownicy: tab(pracownicy) });

      // ── ślady we wszystkich tabelach z tenant_id ──
      const tabele = await licz(tabeleZTenantem());
      const slady = await poKilka(tabele.map(({ tabela, kolumnaDaty }) => async () => {
        const sql = `SELECT COUNT(*) n${kolumnaDaty ? `, MAX(\`${kolumnaDaty}\`) ost` : ''} FROM \`${tabela}\` WHERE tenant_id = ?`;
        const r = await licz(bezpieczne(sql, [tenant], null));
        if (!Array.isArray(r) || !r[0]) return { tabela, blad: r && r.__blad ? r.__blad : 'brak wyniku' };
        return { tabela, n: Number(r[0].n) || 0, ostatnia: r[0].ost || null, wg: kolumnaDaty };
      }));
      const zDanymi = slady.filter(s => s.n > 0).sort((a, b) => b.n - a.n);
      const bledyTabel = slady.filter(s => s.blad);

      return res.json({
        status: 'success',
        wygenerowano: new Date().toISOString(),
        czas_ms: Date.now() - start,
        zapytan,
        licencja,
        tenant_id: tenant,
        logi,
        sesje: tab(sesje).map(maskujSekrety),     // SQL i tak nie pobiera tokenu — maskowanie to druga linia obrony
        dodatki: tab(dodatki).map(maskujSekrety),
        maile: Array.isArray(maile) ? maile : [],
        lista_kontrolna: listaKontrolna(Z),
        zliczenia: Z,
        podejrzane,
        tabele: { wszystkich: tabele.length, z_danymi: zDanymi, bledy: bledyTabel },
      });
    } catch (e) {
      return res.status(500).json({ status: 'error', message: e.code || e.message });
    }
  });

  return router;
};

module.exports.czysteFunkcje = { normalizujNazwe, maskujSekrety, podsumujLogi, listaKontrolna, wykryjPodejrzane, znajdzDuble, poKilka };
