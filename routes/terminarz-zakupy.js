// routes/terminarz-zakupy.js — ewidencja jednostek zakupionych zabiegów (model v2), w granicach dodatku Terminarz.
// ZK-02 (model, transakcje, migracja) + ZK-03 (klasyfikacja źródeł, rozbita sprzedaż, rejestracja, stan początkowy, istniejące wizyty).
//
//  Spec: design/terminarz 2.0/raport naprawczy/po3/Estelio_Terminarz_Realizacja_Zakupow_Specyfikacja_Claude_Code_v1_2026-10-16.md,
//        decyzje ZK-02, przegląd ZK-02/polecenia ZK-03 (R1–R6, Z3-01…Z3-08); rozpoznanie: docs/terminarz-zakupy/ZAKUPY_01_MAPA_STANU_I_PLAN.md
//
//  Zasady (D01–D20, §4.2, §7, §15):
//   • rdzeń (Sprzedaz, Zadatki, Klienci, Uslugi) jest TYLKO czytany; żadnych kolumn, FK ani wywołań w sprzedaz.js,
//   • jeden właściciel salda: ten moduł. Saldo składnika liczone z ruchów ze znakiem: G/W/U/F/R → L = G−W−U−F, B = L−R;
//     ujemny wynik NIE jest przycinany do zera — składnik dostaje stan „niespojny” i blokadę użycia,
//   • przydział (rezerwacja) ≠ realizacja (fakt wykonania) ≠ ruch (niezmienny zapis); korekta = odwrócenie, nigdy usunięcie,
//   • każda mutacja jednostek przez wTransakcjiSalonu() (routes/terminarz.js): GET_LOCK('trm:<salon>') → BEGIN → … → COMMIT → RELEASE_LOCK,
//   • idempotencja: Term_Operacje (klucz per salon + skrót żądania); ten sam klucz z innym żądaniem = błąd (A07),
//     a stan domeny (przydział zużyty/zwolniony) blokuje podwójne zużycie także przy innym kluczu (A08),
//   • źródło (wiersz Sprzedaz + wiersze powiązane „Dopłata” + suma zwrotów) jest czytane ponownie W TRANSAKCJI przed KAŻDĄ operacją
//     jednostkową (rezerwacja, przeniesienie, wykonanie, potrącenie, korekta, zmiana źródła) — składnia MariaDB: LOCK IN SHARE MODE
//     (FOR SHARE to błąd składni na MariaDB 11.8.9 — sprawdzone na rzeczywistym silniku, ZK02-R1). Hash źródła wykrywa zmiany między
//     odczytami; NIE zastępuje blokady i NIE koordynuje zapisów rdzenia (zwrot = nowy wiersz) — patrz ZAKUPY_03_WYNIK §R2,
//   • schemat v2 NIE jest tworzony przy starcie serwera: start tylko CZYTA schemat (sprawdzSchematV2, bez zapisów); migrację wykonuje
//     narzedzia/terminarz-zakupy-migracja.js (preflight pełnego modelu v1, weryfikacja typów kolumn, rejestr Term_Migracje),
//   • trzy niezależne rzeczy (R4): dostępność techniczna (licencja + lista salonów + schematy), ZAPISANY stan ewidencji (Term_Ewidencja,
//     nigdy nie maskowany przez brak dostępności) i dozwolone operacje (tryb efektywny). Brak dostępności przy istniejących przydziałach
//     = przerwa (przerwa_od); powrót wymaga uzgodnienia przez managera, nie samego przywrócenia zmiennej.
'use strict';
const crypto = require('crypto');

const WERSJA_SCHEMATU_V2 = '2026-10-17';
const TRYBY = ['nie_uruchomiono', 'przygotowanie', 'aktywna', 'konczenie', 'wstrzymana', 'zakonczona', 'uzgadnianie'];
const PRZEJSCIA = {
  nie_uruchomiono: ['przygotowanie'],
  przygotowanie: ['aktywna', 'nie_uruchomiono'],
  aktywna: ['konczenie', 'wstrzymana', 'uzgadnianie'],
  konczenie: ['zakonczona', 'aktywna', 'wstrzymana'],
  wstrzymana: ['uzgadnianie', 'konczenie'],
  zakonczona: ['uzgadnianie'],
  uzgadnianie: ['aktywna', 'konczenie'],
};
const TRYBY_NOWE_PRZYDZIALY = new Set(['aktywna']);
const TRYBY_MUTACJE = new Set(['aktywna', 'konczenie']);
const RODZAJE_OFERTY = ['pakiet', 'pojedynczy_z_gory', 'nie_ewidencjonuj', 'nieobslugiwany'];
const KWALIFIKACJE = ['pakiet', 'pojedynczy_z_gory', 'nie_ewidencjonuj', 'do_sprawdzenia'];
const DECYZJE_WIZYT = ['powiaz', 'jednorazowa', 'wyjasnienie', 'historyczna', 'niezwiazana'];
/** N05: decyzje ważne TYLKO w kontekście ocenianego składnika — nie wykluczają wizyty z innych zakupów klientki. */
const DECYZJE_LOKALNE = new Set(['niezwiazana', 'historyczna']);

class BladDomeny extends Error { constructor(msg, extra) { super(msg); this.extra = extra || {}; this.uzytkownika = true; } }

// ═══════════════════ LOGIKA CZYSTA (bez bazy) ═══════════════════
const logika = {
  /** Saldo składnika z listy ruchów {typ:'G'|'W'|'U'|'F'|'R', kierunek:+1|-1, ilosc}. Niezmienniki §7.1 — bez przycinania. */
  saldo(ruchy) {
    const s = { G: 0, W: 0, U: 0, F: 0, R: 0, U_hist: 0, U_term: 0 };
    for (const r of ruchy || []) {
      const q = Number(r.ilosc) * (Number(r.kierunek) || 1);
      if (!(r.typ in s)) continue;
      s[r.typ] += q;
      if (r.typ === 'U') { if (r.historyczny) s.U_hist += q; else s.U_term += q; }
    }
    s.L = s.G - s.W - s.U - s.F;
    s.B = s.L - s.R;
    s.niespojny = [s.G, s.W, s.U, s.F, s.R].some(x => x < 0) || s.L < 0 || s.B < 0;
    return s;
  },
  /** Powód niedostępności składnika do NOWEGO przydziału na datę `data` (YYYY-MM-DD) albo null. */
  powodNiedostepnosci(skl, zakup, saldo, data, tryb) {
    if (tryb === 'niedostepna') return 'ewidencja zakupów jest technicznie niedostępna — historia i rezerwacje zachowane';
    if (!TRYBY_NOWE_PRZYDZIALY.has(tryb)) return tryb === 'nie_uruchomiono' || tryb === 'przygotowanie' ? 'ewidencja zakupów nie jest uruchomiona' : tryb === 'uzgadnianie' ? 'ewidencja po przerwie wymaga uzgodnienia przez managera' : `ewidencja w trybie „${tryb}” — nowe umówienia z pakietu wstrzymane`;
    if (saldo.niespojny || skl.stan === 'niespojny') return 'stan niespójny — wymaga sprawdzenia';
    if (zakup.stan_zrodla && zakup.stan_zrodla !== 'ok') return zakup.stan_zrodla === 'usuniete' ? 'zakup usunięty w Sprzedaży — wymaga wyjaśnienia' : zakup.stan_zrodla === 'wycofane' ? 'zakup wycofany/zwrócony — wymaga wyjaśnienia' : 'zakup zmieniony w Sprzedaży — wymaga wyjaśnienia';
    if (zakup.stan && zakup.stan !== 'aktywny') return zakup.stan === 'zamkniety' ? 'zakup zakończony w Sprzedaży — do uzgodnienia' : `zakup: ${zakup.stan}`;
    if (zakup.kwalifikacja === 'do_sprawdzenia') return 'ta sprzedaż dokumentuje pojedynczy zabieg — potwierdź, czy zakupiono go na przyszłość';
    if (skl.stan === 'wycofany') return 'składnik wycofany';
    if (skl.stan === 'do_uzgodnienia') return 'składnik wymaga uzgodnienia';
    if (skl.stan_weryfikacji !== 'zweryfikowany') return 'stan do sprawdzenia — najpierw potwierdź, ile zabiegów pozostało';
    if (!skl.zalezne_uzgodniono || !skl.aktywny_od) return 'najpierw rozstrzygnij istniejące wizyty';
    if (skl.zawieszono_od && skl.zawieszono_do && data >= String(skl.zawieszono_od).slice(0, 10) && data <= String(skl.zawieszono_do).slice(0, 10)) return `składnik zawieszony do ${String(skl.zawieszono_do).slice(0, 10)}`;
    // Z8: termin ważności NIE blokuje umówienia (decyzja właściciela 18.10.2026) — jest ostrzeżeniem, patrz logika.ostrzezenia().
    if (saldo.B <= 0) return saldo.R > 0 ? 'wszystkie pozostałe zabiegi są już umówione' : saldo.L <= 0 ? 'pakiet wykorzystany' : 'brak dostępnych jednostek';
    return null;
  },
  waznosc(skl, zakup) {
    const lok = skl.data_waznosci_lok ? String(skl.data_waznosci_lok).slice(0, 10) : null;
    const zr = zakup.data_waznosci ? String(zakup.data_waznosci).slice(0, 10) : null;
    return lok || zr || null;
  },
  bezSufiksuRabatu: (w) => String(w || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim(),
  bazaParagonu: (id) => String(id || '').replace(/-\d+$/, ''),
  hash: (obj) => crypto.createHash('sha256').update(logika.kanonicznie(obj)).digest('hex'), // N01: ten sam kontrakt co skrotZadania (zagnieżdżenia!)
  /** Migawka istotnych pól wiersza Sprzedaz (nazwy kolumn z rzeczywistej bazy) + powiązane wiersze finansujące + sumy zwrotów. Deterministyczna. */
  migawkaZrodla(row, zwrotySuma, powiazane) {
    if (!row) return null;
    const m = {
      id: String(row.id), status: String(row.status || 'AKTYWNY'), id_klienta: row.id_klienta == null ? null : String(row.id_klienta),
      zabieg: String(row.zabieg || '').trim(), szczegoly: logika.bezSufiksuRabatu(row.szczegoly), kategoria_produktu: row.kategoria_produktu || null,
      kwota: row.kwota == null ? null : Number(row.kwota).toFixed(2), data_sprzedazy: row.data_sprzedazy ? String(row.data_sprzedazy).slice(0, 10) : null,
      data_waznosci: row.data_waznosci ? String(row.data_waznosci).slice(0, 10) : null, karnet_zamkniety_w: row.karnet_zamkniety_w ? String(row.karnet_zamkniety_w).slice(0, 19) : null,
      grupa_id: row.grupa_id || null, zwrot_do_id: row.zwrot_do_id || null, zwroty_suma: Number(zwrotySuma || 0).toFixed(2),
    };
    // rozbita sprzedaż (Z3-01 §4.2): wiersze „<nazwa> Dopłata” z tego samego paragonu finansują tę samą usługę — ich status, kwota i zwroty wchodzą do odcisku
    m.powiazane = (powiazane || []).map(p => ({ id: String(p.id), status: String(p.status || 'AKTYWNY'), kwota: p.kwota == null ? null : Number(p.kwota).toFixed(2), zwroty_suma: Number(p.zwroty_suma || 0).toFixed(2) })).sort((a, b) => a.id.localeCompare(b.id));
    return m;
  },
  /** Porównanie migawek: 'brak' | 'opisowa' | 'istotna' | 'usuniete' | 'zwrot'. Zmiana opisowa (kwota, data sprzedaży) nie dotyka praw. */
  porownajZrodlo(stara, nowa) {
    if (!nowa) return 'usuniete';
    if (nowa.status !== 'AKTYWNY') return 'usuniete';
    if (!stara) return 'brak';
    const istotne = ['id_klienta', 'zabieg', 'szczegoly', 'kategoria_produktu', 'data_waznosci', 'karnet_zamkniety_w', 'zwrot_do_id'];
    if (Number(nowa.zwroty_suma) !== Number(stara.zwroty_suma)) return 'zwrot';
    const sp = stara.powiazane || [], np = nowa.powiazane || [];
    if (sp.length !== np.length || sp.some((p, i) => p.id !== np[i].id)) return 'istotna';
    if (sp.some((p, i) => p.status !== np[i].status)) return 'istotna';
    if (sp.some((p, i) => Number(p.zwroty_suma) !== Number(np[i].zwroty_suma))) return 'zwrot'; // zwrot przypisany do dopłaty (Z3-T12)
    if (istotne.some(k => String(stara[k]) !== String(nowa[k]))) return 'istotna';
    if (['kwota', 'data_sprzedazy', 'grupa_id'].some(k => String(stara[k]) !== String(nowa[k])) || sp.some((p, i) => p.kwota !== np[i].kwota)) return 'opisowa';
    return 'brak';
  },
  /** Czy wiersz Sprzedaz jest KANDYDATEM na zakup (jeszcze nie: czy daje jednostki — o tym decyduje kwalifikacja/oferta). */
  kandydatNaZakup(row) {
    if (!row) return { ok: false, powod: 'brak rekordu' };
    if (String(row.status || 'AKTYWNY') !== 'AKTYWNY') return { ok: false, powod: 'usunięty' };
    if (row.kategoria_produktu) return { ok: false, powod: 'produkt' };
    if (row.zwrot_do_id || /^ZWROT:/.test(String(row.zabieg || ''))) return { ok: false, powod: 'wiersz zwrotu' };
    if (Number(row.kwota) < 0) return { ok: false, powod: 'kwota ujemna' };
    if (/dopłata\s*$/i.test(String(row.zabieg || '').trim())) return { ok: false, powod: 'wiersz dopłaty (część płatności, nie oferta)' };
    if (!row.id_klienta) return { ok: false, powod: 'brak ID klientki — wymaga jawnego powiązania' };
    if (!String(row.zabieg || '').trim()) return { ok: false, powod: 'brak nazwy usługi' };
    return { ok: true };
  },
  /**
   * Wiersze „Dopłata” powiązane z kanonicznym wierszem w tym samym paragonie (Z3-01 §4.2). Zasada z kodu rdzenia (index.html:21044,
   * sprzedaz.js:692): dopłata ma zabieg = `<kategoria matki> Dopłata`, ten sam paragon, grupa_id odziedziczone po matce.
   * Zwraca { powiazane:[...], niejednoznaczne:boolean } — gdy w paragonie jest kilka pozycji tej samej oferty i dopłata nie ma grupa_id
   * pozwalającej ją przypisać, powiązanie jest niejednoznaczne (sprawa; manager wskazuje jawnie).
   */
  powiazaneDoplaty(kanon, paragon) {
    const nazwa = String(kanon.zabieg || '').trim();
    const doplaty = (paragon || []).filter(r => String(r.id) !== String(kanon.id) && new RegExp('^' + nazwa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+Dopłata$', 'i').test(String(r.zabieg || '').trim()));
    if (!doplaty.length) return { powiazane: [], niejednoznaczne: false, kandydatki: [] };
    // N03 (ZK-03.1): „rodzeństwo” to KAŻDY inny wiersz główny tej samej kategorii na paragonie, niezależnie od wariantu.
    // Wcześniej porównywany był też wariant — przy „Endermologia 5x” i „Endermologia 10x” żaden nie widział drugiego
    // jako rodzeństwa i OBA dostawały OBIE dopłaty, z `niejednoznaczne:false`. Wariant nie rozróżnia dopłat, bo wiersz
    // dopłaty ma wariant pusty.
    const rodzenstwo = (paragon || []).filter(r => String(r.id) !== String(kanon.id) && String(r.zabieg || '').trim() === nazwa && logika.kandydatNaZakup(r).ok);
    if (!rodzenstwo.length) return { powiazane: doplaty, niejednoznaczne: false, kandydatki: doplaty };
    // Wspólna `grupa_id` (tak właśnie wygląda powielenie pozycji przyciskiem) NIE rozstrzyga, do którego egzemplarza
    // należy dopłata — rozstrzyga tylko grupa wyłączna dla tego wiersza głównego.
    if (kanon.grupa_id) {
      const grupaDzielona = rodzenstwo.some(r => r.grupa_id && String(r.grupa_id) === String(kanon.grupa_id));
      const moje = doplaty.filter(d => d.grupa_id && String(d.grupa_id) === String(kanon.grupa_id));
      if (!grupaDzielona && moje.length) return { powiazane: moje, niejednoznaczne: false, kandydatki: doplaty };
    }
    return { powiazane: [], niejednoznaczne: true, kandydatki: doplaty };
  },
  /**
   * N13 (ZK-03.1): STAN ABSOLUTNY źródła, sprawdzany także przy PIERWSZYM imporcie — nie tylko różnica migawek.
   * Bez tego pakiet już zwrócony albo ręcznie zakończony przed rejestracją utrwalał się jako zdrowy (`stan_zrodla='ok'`),
   * bo pierwsza migawka zapisywała stan problematyczny jako punkt odniesienia.
   * Kwota bazowa = wiersz główny + jednoznacznie powiązane dopłaty; zwroty liczone do każdego z tych wierszy.
   * Wpis za 0 zł NIE jest „zwrócony w całości” (brak dodatniej ceny ≠ pełny zwrot).
   */
  stanAbsolutnyZrodla(row, zwrotySuma, powiazane) {
    if (!row) return { stan: 'usuniete', powod: 'brak wiersza sprzedaży' };
    if (String(row.status || 'AKTYWNY') !== 'AKTYWNY') return { stan: 'usuniete', powod: 'wiersz usunięty w Sprzedaży' };
    const kwota = Number(row.kwota) || 0;
    const kwotaRazem = kwota + (powiazane || []).reduce((a, p) => a + (Number(p.kwota) || 0), 0);
    const zwrotyRazem = (Number(zwrotySuma) || 0) + (powiazane || []).reduce((a, p) => a + (Number(p.zwroty_suma) || 0), 0);
    if (kwotaRazem > 0 && zwrotyRazem + 0.001 >= kwotaRazem) return { stan: 'wycofane', powod: `zakup zwrócony w całości (${zwrotyRazem.toFixed(2)} z ${kwotaRazem.toFixed(2)} zł) — uzgodnij, co z jednostkami` };
    if (zwrotyRazem > 0) return { stan: 'do_uzgodnienia', powod: `zwrot częściowy (${zwrotyRazem.toFixed(2)} z ${kwotaRazem.toFixed(2)} zł) — kwoty nie przeliczamy na zabiegi, ustal zakres` };
    if (row.karnet_zamkniety_w) return { stan: 'do_uzgodnienia', powod: `pakiet zakończony ręcznie w Sprzedaży (${String(row.karnet_zamkniety_w).slice(0, 10)}) — ustal, ile zabiegów faktycznie pozostało` };
    return { stan: 'ok', powod: null };
  },
  /**
   * Z8 (zasada salonu, decyzja właściciela 18.10.2026): zabieg po terminie ważności MOŻNA umówić, ale z widoczną
   * informacją. Ważność nie jest już powodem odmowy (patrz `powodNiedostepnosci`), tylko ostrzeżeniem.
   */
  ostrzezenia(skl, zakup, data) {
    const out = [];
    const waz = logika.waznosc(skl, zakup || {});
    if (waz && String(data).slice(0, 10) > waz) out.push({ kod: 'PO_TERMINIE', tekst: `Ten zabieg z pakietu jest już po terminie — pakiet był ważny do ${waz}.` });
    return out;
  },
  /** Wersja mapowania obowiązująca w dacie sprzedaży (precyzja: dzień). Zwraca { wersja } | { brak:true } | { niejednoznaczna:true, kandydatki }. */
  wersjaDlaDaty(wersje, dataSprzedazy) {
    const d = String(dataSprzedazy || '').slice(0, 10); if (!d) return { brak: true };
    const pasujace = (wersje || []).filter(w => String(w.obowiazuje_od || '').slice(0, 10) <= d && (!w.obowiazuje_do || String(w.obowiazuje_do).slice(0, 10) >= d));
    if (!pasujace.length) return { brak: true };
    const tegoDnia = pasujace.filter(w => String(w.obowiazuje_od).slice(0, 10) === d || (w.obowiazuje_do && String(w.obowiazuje_do).slice(0, 10) === d));
    if (pasujace.length > 1 && tegoDnia.length) return { niejednoznaczna: true, kandydatki: pasujace }; // dwie wersje tego samego dnia, źródło ma tylko datę → nie zgadujemy (Z3-T16)
    return { wersja: pasujace.sort((a, b) => b.wersja - a.wersja)[0] };
  },
  /**
   * Klasyfikacja jednego wiersza Sprzedaz (Z3-01). Wejście: { row, paragon, usluga (wiersz Uslugi dopasowany po tekstach lub null),
   * wersje (Term_Oferty_Wersje dla usługi, z składnikami), istniejacy (Term_Zakupy lub null), migawka (gdy istniejący) }.
   * Wyjście: { kategoria: gotowe|wymaga_mapowania|wymaga_rozstrzygniecia|pominiete|istniejace|zmienione, rodzaj, powod, wersja, skladniki, powiazane, niejednoznaczne }.
   */
  klasyfikuj({ row, paragon, usluga, wersje, istniejacy, migawkaAktualna }) {
    const k = logika.kandydatNaZakup(row);
    const bazowe = { sprzedaz_id: row ? String(row.id) : null, zabieg: row ? row.zabieg : null, szczegoly: row ? logika.bezSufiksuRabatu(row.szczegoly) : null, data: row && row.data_sprzedazy ? String(row.data_sprzedazy).slice(0, 10) : null, id_klienta: row ? row.id_klienta : null, grupa_id: row ? row.grupa_id : null };
    if (istniejacy) {
      let stara = null; try { stara = istniejacy.zrodlo_migawka_json ? JSON.parse(istniejacy.zrodlo_migawka_json) : null; } catch (e) { stara = null; }
      const zm = migawkaAktualna ? logika.porownajZrodlo(stara, migawkaAktualna) : 'brak';
      return { ...bazowe, kategoria: zm === 'brak' || zm === 'opisowa' ? 'istniejace' : 'zmienione', rodzaj: istniejacy.kwalifikacja || 'pakiet', powod: zm === 'brak' || zm === 'opisowa' ? 'zakup już zarejestrowany' : `zmiana źródła od ostatniego sprawdzenia: ${zm}`, zakup_id: istniejacy.id, zmiana: zm };
    }
    if (!k.ok) return { ...bazowe, kategoria: /ID klientki/.test(k.powod) ? 'wymaga_rozstrzygniecia' : 'pominiete', rodzaj: 'pominiety', powod: k.powod };
    const dop = logika.powiazaneDoplaty(row, paragon);
    if (!usluga) return { ...bazowe, kategoria: 'wymaga_mapowania', rodzaj: null, powod: 'brak pozycji w cenniku dla tej nazwy i wariantu (zmieniona nazwa albo usunięta usługa)', powiazane: dop.powiazane.map(p => p.id), niejednoznaczne: dop.niejednoznaczne };
    if (!wersje || !wersje.length) return { ...bazowe, usluga_id: usluga.id, kategoria: 'wymaga_mapowania', rodzaj: null, powod: 'oferta bez zatwierdzonego składu (mapowania)', powiazane: dop.powiazane.map(p => p.id), niejednoznaczne: dop.niejednoznaczne };
    const zatw = wersje.filter(w => w.stan === 'zatwierdzona');
    if (!zatw.length) return { ...bazowe, usluga_id: usluga.id, kategoria: 'wymaga_mapowania', rodzaj: null, powod: 'mapowanie oferty nie jest zatwierdzone', powiazane: dop.powiazane.map(p => p.id) };
    const w = logika.wersjaDlaDaty(zatw, row.data_sprzedazy);
    if (w.brak) return { ...bazowe, usluga_id: usluga.id, kategoria: 'wymaga_rozstrzygniecia', rodzaj: null, powod: 'sprzedaż sprzed pierwszej wersji mapowania — wskaż jawnie, która wersja składu obowiązuje dla tego zakupu', wersje_do_wyboru: zatw.map(x => ({ id: x.id, wersja: x.wersja, rodzaj: x.rodzaj })), powiazane: dop.powiazane.map(p => p.id) };
    if (w.niejednoznaczna) return { ...bazowe, usluga_id: usluga.id, kategoria: 'wymaga_rozstrzygniecia', rodzaj: null, powod: 'dwie wersje mapowania obowiązywały w dniu sprzedaży — źródło ma tylko datę, nie zgadujemy wersji', wersje_do_wyboru: w.kandydatki.map(x => ({ id: x.id, wersja: x.wersja, rodzaj: x.rodzaj })), powiazane: dop.powiazane.map(p => p.id) };
    const wer = w.wersja;
    if (wer.rodzaj === 'nie_ewidencjonuj') return { ...bazowe, usluga_id: usluga.id, kategoria: 'pominiete', rodzaj: 'nie_ewidencjonuj', powod: 'oferta nie jest ewidencjonowana (sprzedaż dokumentuje wykonany zabieg albo inny zapis bez prawa na przyszłość)', wersja: wer.wersja, wersja_id: wer.id };
    if (wer.rodzaj === 'nieobslugiwany') return { ...bazowe, usluga_id: usluga.id, kategoria: 'pominiete', rodzaj: 'nieobslugiwany', powod: 'typ oferty nieobsługiwany przez ewidencję (abonament/czas/rodzinny) — kalendarz działa bez licznika', wersja: wer.wersja, wersja_id: wer.id };
    if (dop.niejednoznaczne) return { ...bazowe, usluga_id: usluga.id, kategoria: 'wymaga_rozstrzygniecia', rodzaj: wer.rodzaj, powod: 'w paragonie jest kilka pozycji tej oferty i dopłata, której nie da się jednoznacznie przypisać — wskaż powiązanie jawnie', wersja: wer.wersja, wersja_id: wer.id, powiazane: [], niejednoznaczne: true, skladniki: (wer.skladniki || []).map(s => ({ usluga_wyk_id: s.usluga_wyk_id, jednostki: Number(s.jednostki), jednostka_miary: s.jednostka_miary || 'sesja', jednostki_na_pozycje: Number(s.jednostki_na_pozycje) || 1 })), kwalifikacja: wer.rodzaj === 'pojedynczy_z_gory' ? 'do_sprawdzenia' : 'pakiet' };
    const skl = (wer.skladniki || []).map(s => ({ usluga_wyk_id: s.usluga_wyk_id, jednostki: Number(s.jednostki), jednostka_miary: s.jednostka_miary || 'sesja', jednostki_na_pozycje: Number(s.jednostki_na_pozycje) || 1 }));
    const zero = Number(row.kwota) === 0;
    return { ...bazowe, usluga_id: usluga.id, kategoria: 'gotowe', rodzaj: wer.rodzaj, wersja: wer.wersja, wersja_id: wer.id, skladniki: skl, powiazane: dop.powiazane.map(p => p.id),
      kwalifikacja: wer.rodzaj === 'pojedynczy_z_gory' ? 'do_sprawdzenia' : 'pakiet', // „1×” nawet z jawnej oferty wymaga potwierdzenia per zakup (§2.2 decyzji)
      powod: wer.rodzaj === 'pojedynczy_z_gory' ? 'pojedynczy zabieg kupiony na przyszłość — po rejestracji wymaga potwierdzenia kwalifikacji dla tego zakupu' : zero ? 'wpis za 0 zł — prawo do zabiegu wymaga potwierdzenia stanu, nie wynika z ceny' : 'oferta zatwierdzona; stan początkowy do sprawdzenia' };
  },
  /**
   * N01 (ZK-03.1): deterministyczna serializacja CAŁEGO ładunku, na wszystkich poziomach zagnieżdżenia.
   * Wcześniej `JSON.stringify(dane, Object.keys(dane).sort())` — lista kluczy w `replacer` obowiązuje też obiekty
   * zagnieżdżone, więc `{pozycje:[{sprzedaz_id:'A'}]}` i `{pozycje:[{sprzedaz_id:'B'}]}` dawały identyczny skrót
   * `{"pozycje":[{}]}`: ten sam klucz operacji z innym żądaniem zwracał cudzy wynik zamiast konfliktu.
   * Klucze obiektów sortowane (kolejność pól nie jest treścią), kolejność TABLIC zachowana (jest treścią biznesową).
   * Typy i wartości puste rozróżnione: `null` ≠ `""` ≠ `0` ≠ `"0"` ≠ brak klucza; tablica ≠ obiekt.
   */
  kanonicznie(v) {
    if (v === undefined) return '<undef>';
    if (v === null) return 'null';
    if (Array.isArray(v)) return '[' + v.map(logika.kanonicznie).join(',') + ']';
    if (v instanceof Date) return '"' + v.toISOString() + '"';
    if (typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + logika.kanonicznie(v[k])).join(',') + '}';
    return JSON.stringify(v);
  },
  skrotZadania: (rodzaj, dane) => crypto.createHash('sha256').update(rodzaj + '|' + logika.kanonicznie(dane === undefined ? {} : dane)).digest('hex'),
  przejscieTrybu: (z, do_) => !!(PRZEJSCIA[z] || []).includes(do_),
  /** Skrót zbioru kandydatów (id pozycji + wersje wizyt) — podgląd musi być aktualny przy uruchomieniu (Z3-T24). */
  skrotKandydatow: (lista) => crypto.createHash('sha256').update(JSON.stringify((lista || []).map(p => [p.id, p.rez_wersja, p.stan]).sort((a, b) => a[0] - b[0]))).digest('hex'),
  TRYBY, TRYBY_NOWE_PRZYDZIALY, TRYBY_MUTACJE, RODZAJE_OFERTY, KWALIFIKACJE, DECYZJE_WIZYT, WERSJA_SCHEMATU_V2,
};

// ═══════════════════ SCHEMAT V2 (kontrolowana migracja — NIE przy starcie) ═══════════════════
const KOL = ' DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
/** Tabele modelu v1 (tworzone przez routes/terminarz.js przy starcie), które migracja v2 rozszerza — muszą istnieć (schemat bazowy). */
const TABELE_V1 = ['Term_Oferty', 'Term_Oferty_Skladniki', 'Term_Zakupy', 'Term_Zakupy_Skladniki', 'Term_Zakupy_Ruchy', 'Term_Pozycje', 'Term_Uslugi', 'Term_Ustawienia', 'Term_Migracje', 'Term_Rezerwacje'];
/** [nazwa elementu, SQL]. Każdy krok idempotentny (IF NOT EXISTS / ER_DUP_FIELDNAME). Zero DROP/DELETE/TRUNCATE. */
const SCHEMAT_V2 = [
  ['Term_Oferty_Wersje', `CREATE TABLE IF NOT EXISTS Term_Oferty_Wersje (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, oferta_id INT NOT NULL, wersja INT NOT NULL DEFAULT 1,
      rodzaj VARCHAR(24) NOT NULL DEFAULT 'pakiet', stan VARCHAR(16) NOT NULL DEFAULT 'propozycja',
      obowiazuje_od DATETIME NULL, obowiazuje_do DATETIME NULL, autor VARCHAR(100) NULL, utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_of_w (tenant_id, oferta_id, wersja))${KOL}`],
  ['Term_Oferty_Skladniki.wersja_id', `ALTER TABLE Term_Oferty_Skladniki ADD COLUMN wersja_id INT NULL`],
  ['Term_Oferty_Skladniki.jednostka_miary', `ALTER TABLE Term_Oferty_Skladniki ADD COLUMN jednostka_miary VARCHAR(20) NOT NULL DEFAULT 'sesja'`],
  ['Term_Oferty_Skladniki.jednostki_na_pozycje', `ALTER TABLE Term_Oferty_Skladniki ADD COLUMN jednostki_na_pozycje INT NOT NULL DEFAULT 1`],
  ['Term_Zakupy.zrodlo_typ', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_typ VARCHAR(16) NOT NULL DEFAULT 'sprzedaz'`],
  ['Term_Zakupy.oferta_wersja_id', `ALTER TABLE Term_Zakupy ADD COLUMN oferta_wersja_id INT NULL`],
  ['Term_Zakupy.zrodlo_hash', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_hash CHAR(64) NULL`],
  ['Term_Zakupy.zrodlo_migawka_json', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_migawka_json TEXT NULL`],
  ['Term_Zakupy.zrodlo_sprawdzono', `ALTER TABLE Term_Zakupy ADD COLUMN zrodlo_sprawdzono DATETIME NULL`],
  ['Term_Zakupy.zrodla_json', `ALTER TABLE Term_Zakupy ADD COLUMN zrodla_json TEXT NULL`],
  ['Term_Zakupy.zwroty_suma', `ALTER TABLE Term_Zakupy ADD COLUMN zwroty_suma DECIMAL(10,2) NOT NULL DEFAULT 0`],
  ['Term_Zakupy.stan_zrodla', `ALTER TABLE Term_Zakupy ADD COLUMN stan_zrodla VARCHAR(16) NOT NULL DEFAULT 'ok'`],
  ['Term_Zakupy.kwalifikacja', `ALTER TABLE Term_Zakupy ADD COLUMN kwalifikacja VARCHAR(24) NULL`],
  ['Term_Zakupy.kwalifikowal', `ALTER TABLE Term_Zakupy ADD COLUMN kwalifikowal VARCHAR(100) NULL`],
  ['Term_Zakupy.kwalifikowano', `ALTER TABLE Term_Zakupy ADD COLUMN kwalifikowano DATETIME NULL`],
  ['Term_Zakupy.wersja', `ALTER TABLE Term_Zakupy ADD COLUMN wersja INT NOT NULL DEFAULT 1`],
  ['Term_Zakupy_Skladniki.stan', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN stan VARCHAR(16) NOT NULL DEFAULT 'aktywny'`],
  ['Term_Zakupy_Skladniki.stan_weryfikacji', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN stan_weryfikacji VARCHAR(16) NOT NULL DEFAULT 'niezweryfikowany'`],
  ['Term_Zakupy_Skladniki.punkt_odciecia', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN punkt_odciecia DATETIME NULL`],
  ['Term_Zakupy_Skladniki.hist_wykorzystane', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN hist_wykorzystane INT NULL`],
  ['Term_Zakupy_Skladniki.hist_wycofane', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN hist_wycofane INT NULL`],
  ['Term_Zakupy_Skladniki.hist_potracone', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN hist_potracone INT NULL`],
  ['Term_Zakupy_Skladniki.zrodlo_ustalen', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zrodlo_ustalen VARCHAR(300) NULL`],
  ['Term_Zakupy_Skladniki.zweryfikowal', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zweryfikowal VARCHAR(100) NULL`],
  ['Term_Zakupy_Skladniki.zweryfikowano', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zweryfikowano DATETIME NULL`],
  ['Term_Zakupy_Skladniki.zalezne_uzgodniono', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zalezne_uzgodniono TINYINT(1) NOT NULL DEFAULT 0`],
  ['Term_Zakupy_Skladniki.uzgodnienie_wersja', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN uzgodnienie_wersja INT NOT NULL DEFAULT 0`],
  ['Term_Zakupy_Skladniki.aktywny_od', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN aktywny_od DATETIME NULL`],
  ['Term_Zakupy_Skladniki.data_waznosci_lok', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN data_waznosci_lok DATE NULL`],
  ['Term_Zakupy_Skladniki.zawieszono_od', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zawieszono_od DATE NULL`],
  ['Term_Zakupy_Skladniki.zawieszono_do', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN zawieszono_do DATE NULL`],
  ['Term_Zakupy_Skladniki.jednostka_miary', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN jednostka_miary VARCHAR(20) NOT NULL DEFAULT 'sesja'`],
  ['Term_Zakupy_Skladniki.jednostki_na_pozycje', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN jednostki_na_pozycje INT NOT NULL DEFAULT 1`],
  ['Term_Zakupy_Skladniki.usluga_nazwa', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN usluga_nazwa VARCHAR(300) NULL`],
  ['Term_Zakupy_Skladniki.saldo_json', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN saldo_json TEXT NULL`],
  ['Term_Zakupy_Skladniki.plan_json', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN plan_json TEXT NULL`],
  ['Term_Zakupy_Skladniki.plan_skrot', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN plan_skrot CHAR(64) NULL`],
  ['Term_Zakupy_Skladniki.wersja', `ALTER TABLE Term_Zakupy_Skladniki ADD COLUMN wersja INT NOT NULL DEFAULT 1`],
  ['Term_Przydzialy', `CREATE TABLE IF NOT EXISTS Term_Przydzialy (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, pozycja_id INT NOT NULL, skladnik_id INT NOT NULL,
      ilosc INT NOT NULL DEFAULT 1, ilosc_zuzyta INT NOT NULL DEFAULT 0, cykl INT NOT NULL DEFAULT 1,
      stan VARCHAR(16) NOT NULL DEFAULT 'zarezerwowany', operacja_id INT NULL, utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, zmieniono DATETIME NULL,
      INDEX idx_poz (tenant_id, pozycja_id), INDEX idx_skl (tenant_id, skladnik_id, stan))${KOL}`],
  ['Term_Realizacje', `CREATE TABLE IF NOT EXISTS Term_Realizacje (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, pozycja_id INT NULL, przydzial_id INT NULL, skladnik_id INT NOT NULL,
      ilosc INT NOT NULL DEFAULT 1, wykonawca_fakt VARCHAR(100) NULL, data_fakt DATETIME NOT NULL, zapisal VARCHAR(100) NULL, zapisal_id VARCHAR(36) NULL,
      zapisano DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, cykl INT NOT NULL DEFAULT 1, stan VARCHAR(12) NOT NULL DEFAULT 'zapisana',
      odwrocona_przez INT NULL, operacja_id INT NULL, powod VARCHAR(300) NULL, zrodlo VARCHAR(16) NOT NULL DEFAULT 'wizyta',
      INDEX idx_poz (tenant_id, pozycja_id), INDEX idx_skl (tenant_id, skladnik_id))${KOL}`],
  ['Term_Zakupy_Ruchy2', `CREATE TABLE IF NOT EXISTS Term_Zakupy_Ruchy2 (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, skladnik_id INT NOT NULL, typ CHAR(1) NOT NULL, kierunek TINYINT NOT NULL DEFAULT 1,
      ilosc INT NOT NULL, historyczny TINYINT(1) NOT NULL DEFAULT 0, przydzial_id INT NULL, realizacja_id INT NULL, operacja_id INT NULL, odwraca_id INT NULL,
      data_zdarzenia DATETIME NULL, kto VARCHAR(100) NULL, kto_id VARCHAR(36) NULL, powod VARCHAR(300) NULL, zapisano DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_skl (tenant_id, skladnik_id), INDEX idx_odw (tenant_id, odwraca_id))${KOL}`],
  ['Term_Operacje', `CREATE TABLE IF NOT EXISTS Term_Operacje (
      id INT AUTO_INCREMENT PRIMARY KEY, tenant_id VARCHAR(100) NOT NULL, klucz VARCHAR(64) NOT NULL, rodzaj VARCHAR(32) NOT NULL,
      autor VARCHAR(100) NULL, autor_id VARCHAR(36) NULL, skrot CHAR(64) NOT NULL, stan VARCHAR(12) NOT NULL DEFAULT 'zapisano', wynik_json TEXT NULL,
      utworzono DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_op (tenant_id, klucz))${KOL}`],
  ['Term_Ewidencja', `CREATE TABLE IF NOT EXISTS Term_Ewidencja (
      tenant_id VARCHAR(100) NOT NULL PRIMARY KEY, tryb VARCHAR(20) NOT NULL DEFAULT 'nie_uruchomiono', rozpoczeto DATETIME NULL,
      punkt_uzgodnienia DATETIME NULL, zakonczono DATETIME NULL, przerwa_od DATETIME NULL, zmienil VARCHAR(100) NULL, zmieniono DATETIME NULL, raport_json TEXT NULL)${KOL}`],
  ['Term_Pozycje.jednostki_wymagane', `ALTER TABLE Term_Pozycje ADD COLUMN jednostki_wymagane INT NOT NULL DEFAULT 1`],
  ['Term_Pozycje.rozliczenie', `ALTER TABLE Term_Pozycje ADD COLUMN rozliczenie VARCHAR(16) NULL`],
  ['Term_Pozycje.wykonanie_data_fakt', `ALTER TABLE Term_Pozycje ADD COLUMN wykonanie_data_fakt DATETIME NULL`],
  ['Term_Pozycje.wykonanie_zapisal', `ALTER TABLE Term_Pozycje ADD COLUMN wykonanie_zapisal VARCHAR(100) NULL`],
  ['Term_Uslugi.wymaga_zakupu', `ALTER TABLE Term_Uslugi ADD COLUMN wymaga_zakupu TINYINT(1) NULL`],
  ['Term_Ustawienia.recepcja_potwierdza_wykonanie', `ALTER TABLE Term_Ustawienia ADD COLUMN recepcja_potwierdza_wykonanie TINYINT(1) NOT NULL DEFAULT 0`],
  ['Term_Ustawienia.potracenie_nieobecnosc', `ALTER TABLE Term_Ustawienia ADD COLUMN potracenie_nieobecnosc VARCHAR(5) NOT NULL DEFAULT 'off'`],
  ['Term_Ustawienia.seria_limit', `ALTER TABLE Term_Ustawienia ADD COLUMN seria_limit INT NOT NULL DEFAULT 20`],
];
const ELEMENTY_V2 = SCHEMAT_V2.map(([n]) => n);
/** Oczekiwane typy kolumn (INFORMATION_SCHEMA.COLUMN_TYPE, małe litery) wyprowadzone z DDL — do weryfikacji wznowionej/częściowej migracji (R3). */
const TYP_SQL = { 'INT': 'int(11)', 'TINYINT': 'tinyint(4)', 'DATETIME': 'datetime', 'DATE': 'date', 'TEXT': 'text' };
function oczekiwaneKolumny(zDefinicja) {
  const out = {}; // 'Tabela.kolumna' → column_type (albo { typ, def } gdy zDefinicja)
  const typ = (t) => { const u = t.toUpperCase(); if (TYP_SQL[u]) return TYP_SQL[u]; const m = u.match(/^(VARCHAR|CHAR|DECIMAL|TINYINT|INT)\((\d+(?:,\d+)?)\)$/); return m ? `${m[1].toLowerCase()}(${m[2]})` : u.toLowerCase(); };
  const dodaj = (k, t, def) => { out[k] = zDefinicja ? { typ: typ(t), def } : typ(t); };
  for (const [nazwa, sql] of SCHEMAT_V2) {
    const alter = sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+) ([A-Z]+(?:\(\d+(?:,\d+)?\))?)([^\n]*)$/i);
    if (alter) { dodaj(`${alter[1]}.${alter[2]}`, alter[3], (alter[3] + alter[4]).trim()); continue; }
    const cr = sql.match(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*)\)\s*DEFAULT CHARSET/i);
    if (cr) for (const def of cr[2].split(/,\s*\n|,\s(?=[a-z_]+ (?:INT|TINYINT|VARCHAR|CHAR|DECIMAL|DATETIME|DATE|TEXT)\b)/)) { const d = def.trim(); const m = d.match(/^(\w+) ((?:INT|TINYINT|VARCHAR|CHAR|DECIMAL|DATETIME|DATE|TEXT)(?:\(\d+(?:,\d+)?\))?)/i); if (m && !/^(INDEX|UNIQUE|PRIMARY|KEY)$/i.test(m[1])) dodaj(`${cr[1]}.${m[1]}`, m[2], d.slice(m[1].length + 1).replace(/\s+(AUTO_INCREMENT\s+)?PRIMARY KEY$/i, ' NOT NULL')); }
  }
  return out;
}

/**
 * Stan schematu (R3) — WYŁĄCZNIE odczyt INFORMATION_SCHEMA + liczniki danych v1. `qx(sql, params)` → Promise<rows>.
 * typ: 'brak_v1' | 'v1_czysty' | 'v1_z_danymi' | 'v2_czesciowy' | 'v2_kompletny' | 'v2_niezgodny'.
 */
async function stanSchematu(qx) {
  const oczek = oczekiwaneKolumny();
  const tabele = [...new Set([...ELEMENTY_V2.map(n => n.split('.')[0]), ...TABELE_V1])];
  const rows = await qx(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ct FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tabele.map(() => '?').join(',')})`, tabele);
  const jestTabela = (t) => rows.some(r => String(r.t).toLowerCase() === t.toLowerCase());
  const kolumna = (t, c) => rows.find(r => String(r.t).toLowerCase() === t.toLowerCase() && String(r.c).toLowerCase() === c.toLowerCase());
  const v1 = { obecne: TABELE_V1.filter(jestTabela), brakujace: TABELE_V1.filter(t => !jestTabela(t)) };
  const v2 = { obecne: [], brakujace: [], niezgodne: [], brakujace_kolumny: [] };
  for (const n of ELEMENTY_V2) { const [t, c] = n.split('.'); (c ? !!kolumna(t, c) : jestTabela(t)) ? v2.obecne.push(n) : v2.brakujace.push(n); }
  for (const [klucz, typ] of Object.entries(oczek)) {
    const [t, c] = klucz.split('.'); const k = kolumna(t, c);
    if (!k) { if (jestTabela(t) && !ELEMENTY_V2.includes(klucz)) v2.brakujace_kolumny.push(klucz); continue; } // tabela v2 z przerwanego/starszego DDL bez kolumny → do dołożenia ALTER-em
    if (String(k.ct).toLowerCase() !== typ) v2.niezgodne.push({ element: klucz, oczekiwane: typ, faktyczne: String(k.ct).toLowerCase() });
  }
  if (v2.brakujace_kolumny.length) v2.brakujace.push(...v2.brakujace_kolumny);
  const licz = async (sql, p) => { try { const r = await qx(sql, p); return Number((r && r[0] && r[0].n) || 0); } catch (e) { if (e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_FIELD_ERROR') return 0; throw e; } };
  const daneV1 = v1.brakujace.length ? null : {
    Term_Oferty: await licz(`SELECT COUNT(*) n FROM Term_Oferty`), Term_Oferty_Skladniki: await licz(`SELECT COUNT(*) n FROM Term_Oferty_Skladniki`),
    Term_Zakupy: await licz(`SELECT COUNT(*) n FROM Term_Zakupy`), Term_Zakupy_Skladniki: await licz(`SELECT COUNT(*) n FROM Term_Zakupy_Skladniki`), Term_Zakupy_Ruchy: await licz(`SELECT COUNT(*) n FROM Term_Zakupy_Ruchy`),
    Term_Pozycje_z_zakupem: await licz(`SELECT COUNT(*) n FROM Term_Pozycje WHERE zakup_skladnik_id IS NOT NULL`),
    Term_Pozycje_osierocone: await licz(`SELECT COUNT(*) n FROM Term_Pozycje p WHERE p.zakup_skladnik_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Term_Zakupy_Skladniki s WHERE s.id = p.zakup_skladnik_id)`),
    Term_Oferty_Skladniki_osierocone: await licz(`SELECT COUNT(*) n FROM Term_Oferty_Skladniki s WHERE NOT EXISTS (SELECT 1 FROM Term_Oferty o WHERE o.id = s.oferta_id)`),
  };
  const sumaV1 = daneV1 ? Object.values(daneV1).reduce((a, b) => a + b, 0) : 0;
  let typ;
  if (v1.brakujace.length) typ = 'brak_v1';
  else if (v2.obecne.length === 0) typ = sumaV1 ? 'v1_z_danymi' : 'v1_czysty';
  else if (v2.niezgodne.length) typ = 'v2_niezgodny'; // niezgodny typ kolumny ma pierwszeństwo przed „częściowy” — wznowienie nie może dobudować schematu na złej definicji (R3)
  else if (v2.brakujace.length) typ = 'v2_czesciowy';
  else typ = 'v2_kompletny';
  return { wersja: WERSJA_SCHEMATU_V2, typ, v1, v2, daneV1, sumaV1, gotowy: typ === 'v2_kompletny', braki: v2.brakujace, niezgodne: v2.niezgodne };
}

/** Sprawdzenie startowe (tylko ODCZYT — bez zapisów do Term_Migracje; rejestr prowadzi wyłącznie narzędzie migracyjne, R3). */
async function sprawdzSchematV2(q, log) {
  const wynik = { wersja: WERSJA_SCHEMATU_V2, sprawdzono: new Date().toISOString(), gotowy: false, braki: [], typ: null, niezgodne: [] };
  try {
    const st = await stanSchematu(q);
    Object.assign(wynik, { gotowy: st.gotowy, braki: st.braki, typ: st.typ, niezgodne: st.niezgodne });
    if (!st.gotowy && log) log.warn(`[terminarz-zakupy] schemat v2: ${st.typ} (${st.braki.length} brakujących, ${st.niezgodne.length} niezgodnych) — ewidencja zakupów niedostępna; migracja: node narzedzia/terminarz-zakupy-migracja.js`);
  } catch (e) { wynik.braki = ['(nie udało się sprawdzić: ' + e.message + ')']; wynik.typ = 'blad'; if (log) log.error('[terminarz-zakupy] sprawdzSchematV2:', e.message); }
  return wynik;
}

/**
 * Kontrolowana migracja v2 (narzędzie, nie start serwera). Pod GET_LOCK('trm:migracja') — ta sama blokada jest sprawdzana (IS_FREE_LOCK)
 * przez wTransakcjiSalonu, więc operacje jednostkowe dodatku są odrzucane na czas migracji (rdzeń/Sprzedaż nie są dotykane ani wstrzymywane).
 * Preflight: pełny model v1 (tabele, dane, osierocone referencje). Dane v1 bez v2 → zatrzymanie z raportem (przeniesienie historii = osobne
 * zadanie). Częściowy v2 → kontynuacja tylko brakujących elementów + weryfikacja typów. Nigdy DROP/DELETE/TRUNCATE. Powtarzalna.
 */
async function migrujV2(qx, { dryRun = false, log = console } = {}) {
  const raport = { wersja: WERSJA_SCHEMATU_V2, dryRun, stanPrzed: null, stanPo: null, zastosowano: [], juzBylo: [], bledy: [], zatrzymano: null };
  const [lock] = await qx(`SELECT GET_LOCK('trm:migracja', 10) AS l`);
  if (!lock || Number(lock.l) !== 1) throw new Error('Nie udało się uzyskać blokady migracji (inny proces migruje?). Nic nie wykonano.');
  try {
    const przed = await stanSchematu(qx); raport.stanPrzed = { typ: przed.typ, v1_brakujace: przed.v1.brakujace, v2_brakujace: przed.v2.brakujace.length, niezgodne: przed.v2.niezgodne, daneV1: przed.daneV1 };
    if (przed.typ === 'brak_v1') { raport.zatrzymano = `Brak schematu bazowego terminarza (v1): ${przed.v1.brakujace.join(', ')}. Najpierw przygotuj schemat bazowy (narzedzia/testy-integracyjne/schemat-bazowy.js albo jednorazowy start serwera na tej bazie). Niczego nie zmieniono.`; log.error('[migracja v2] ' + raport.zatrzymano); return raport; }
    if (przed.typ === 'v1_z_danymi') { raport.zatrzymano = `Stary model T02/T03 zawiera dane (${JSON.stringify(przed.daneV1)}). Ścieżka zakładająca pusty model została zatrzymana — potrzebne przeniesienie historii (osobne zadanie). Niczego nie usunięto.`; log.error('[migracja v2] ' + raport.zatrzymano); return raport; }
    if (przed.typ === 'v2_niezgodny') { raport.zatrzymano = `Schemat v2 istnieje, ale typy kolumn nie zgadzają się z definicją: ${przed.v2.niezgodne.map(x => `${x.element} (${x.faktyczne} ≠ ${x.oczekiwane})`).join('; ')}. Wymaga ręcznej decyzji — migracja niczego nie zmieniła.`; log.error('[migracja v2] ' + raport.zatrzymano); return raport; }
    if (przed.typ === 'v2_czesciowy' && przed.daneV1 && przed.daneV1.Term_Pozycje_osierocone) { raport.zatrzymano = `Osierocone powiązania pozycji (${przed.daneV1.Term_Pozycje_osierocone}) — wznowienie migracji wymaga ich wyjaśnienia.`; log.error('[migracja v2] ' + raport.zatrzymano); return raport; }
    const defy = oczekiwaneKolumny(true);
    const kroki = [...SCHEMAT_V2, ...przed.v2.brakujace_kolumny.map(k => { const [t, c] = k.split('.'); return [k, `ALTER TABLE ${t} ADD COLUMN ${c} ${defy[k].def}`]; })]; // kolumny brakujące w istniejących tabelach v2 (przerwany/starszy DDL) dokładane ALTER-em
    for (const [nazwa, sql] of kroki) {
      if (przed.v2.obecne.includes(nazwa)) { raport.juzBylo.push(nazwa); continue; }
      if (dryRun) { raport.zastosowano.push(nazwa + ' (dry-run)'); continue; }
      try { await qx(sql); raport.zastosowano.push(nazwa); }
      catch (e) { if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_TABLE_EXISTS_ERROR') raport.juzBylo.push(nazwa); else { raport.bledy.push(nazwa + ': ' + e.message); log.error('[migracja v2]', nazwa, e.message); } }
    }
    if (!dryRun) {
      const po = await stanSchematu(qx); raport.stanPo = { typ: po.typ, v2_brakujace: po.v2.brakujace, niezgodne: po.v2.niezgodne };
      if (!po.gotowy) raport.bledy.push(`po migracji schemat nie jest kompletny: ${po.typ} (${po.v2.brakujace.join(', ')}${po.v2.niezgodne.map(x => ' ' + x.element).join('')})`);
      for (const n of ELEMENTY_V2) await qx(`INSERT INTO Term_Migracje (nazwa, wersja, obecna, sprawdzono, uwaga) VALUES (?, ?, ?, NOW(), ?) ON DUPLICATE KEY UPDATE wersja = VALUES(wersja), obecna = VALUES(obecna), sprawdzono = NOW(), uwaga = VALUES(uwaga)`, ['v2:' + n, WERSJA_SCHEMATU_V2, po.v2.obecne.includes(n) ? 1 : 0, po.v2.niezgodne.find(x => x.element === n) ? 'typ niezgodny' : null]).catch(() => {});
    }
  } finally { await qx(`SELECT RELEASE_LOCK('trm:migracja')`).catch(() => {}); }
  return raport;
}

// ═══════════════════ REPOZYTORIUM SQL (bindowane do połączenia transakcji) ═══════════════════
/** `qc(sql, params)` → Promise<rows> na połączeniu transakcji. Każda metoda ogranicza się do tenant. Blokady: FOR UPDATE / LOCK IN SHARE MODE (MariaDB). */
function repoSql(qc, tenant) {
  const q1 = async (sql, p) => (await qc(sql, p))[0] || null;
  const set = (pola) => { const k = Object.keys(pola); return { sql: k.map(x => `${x} = ?`).join(', '), p: k.map(x => pola[x]) }; };
  const SKL = `SELECT s.*, z.id_klienta, z.stan AS zakup_stan, z.stan_zrodla, z.data_waznosci, z.nazwa AS zakup_nazwa, z.zrodlo_typ, z.sprzedaz_id, z.zrodlo_hash, z.zrodlo_migawka_json, z.zrodla_json, z.zwroty_suma, z.kwalifikacja, z.data_zakupu, z.oferta_wersja_id
        FROM Term_Zakupy_Skladniki s JOIN Term_Zakupy z ON z.id = s.zakup_id AND z.tenant_id = s.tenant_id WHERE s.tenant_id = ?`;
  return {
    tenant,
    // N02 (ZK-03.1): punkty zapisu w obrębie transakcji salonu — pozwalają wycofać JEDEN wadliwy zakup z partii,
    // nie przerywając całej transakcji. Nazwa budowana wyłącznie z licznika (nigdy z danych żądania).
    async savepoint(n) { await qc(`SAVEPOINT ${String(n).replace(/[^a-z0-9_]/gi, '')}`); },
    async doSavepoint(n) { await qc(`ROLLBACK TO SAVEPOINT ${String(n).replace(/[^a-z0-9_]/gi, '')}`); },
    async zwolnijSavepoint(n) { await qc(`RELEASE SAVEPOINT ${String(n).replace(/[^a-z0-9_]/gi, '')}`); },
    async skladniki(ids, blokuj) { if (!ids.length) return []; return qc(`${SKL} AND s.id IN (${ids.map(() => '?').join(',')})${blokuj ? ' FOR UPDATE' : ''}`, [tenant, ...ids]); },
    async skladnikiZakupow(zakupIds) { if (!zakupIds.length) return []; return qc(`${SKL} AND s.zakup_id IN (${zakupIds.map(() => '?').join(',')}) ORDER BY s.id`, [tenant, ...zakupIds]); },
    async skladnikiSalonu(filtr = {}) { const w = []; const p = [tenant]; if (filtr.stan_weryfikacji) { w.push('s.stan_weryfikacji = ?'); p.push(filtr.stan_weryfikacji); } return qc(`${SKL}${w.length ? ' AND ' + w.join(' AND ') : ''} ORDER BY s.id LIMIT 500`, p); },
    async zakupyKlientki(idKlienta) { return qc(`SELECT * FROM Term_Zakupy WHERE tenant_id = ? AND id_klienta = ? ORDER BY data_waznosci IS NULL, data_waznosci, data_zakupu, id`, [tenant, String(idKlienta)]); },
    async zakup(id, blokuj) { return q1(`SELECT * FROM Term_Zakupy WHERE tenant_id = ? AND id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async zakupyPoSprzedazy(ids) { if (!ids.length) return []; return qc(`SELECT * FROM Term_Zakupy WHERE tenant_id = ? AND sprzedaz_id IN (${ids.map(() => '?').join(',')})`, [tenant, ...ids.map(String)]); },
    async zakupyDoUzgodnienia(limit = 200) { return qc(`SELECT * FROM Term_Zakupy WHERE tenant_id = ? AND zrodlo_typ = 'sprzedaz' AND stan = 'aktywny' ORDER BY zrodlo_sprawdzono IS NULL DESC, zrodlo_sprawdzono LIMIT ?`, [tenant, Number(limit)]); },
    async ruchy(skladnikIds) { if (!skladnikIds.length) return []; return qc(`SELECT * FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND skladnik_id IN (${skladnikIds.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...skladnikIds]); },
    async przydzialyPozycji(pozycjaIds) { if (!pozycjaIds.length) return []; return qc(`SELECT * FROM Term_Przydzialy WHERE tenant_id = ? AND pozycja_id IN (${pozycjaIds.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...pozycjaIds]); },
    async przydzial(id, blokuj) { return q1(`SELECT * FROM Term_Przydzialy WHERE tenant_id = ? AND id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async wstawPrzydzial(r) { const x = await qc(`INSERT INTO Term_Przydzialy (tenant_id, pozycja_id, skladnik_id, ilosc, ilosc_zuzyta, cykl, stan, operacja_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`, [tenant, r.pozycja_id, r.skladnik_id, r.ilosc, r.cykl || 1, r.stan || 'zarezerwowany', r.operacja_id || null]); return x.insertId; },
    async aktualizujPrzydzial(id, pola) { const s = set(pola); await qc(`UPDATE Term_Przydzialy SET ${s.sql}, zmieniono = NOW() WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async realizacja(id, blokuj) { return q1(`SELECT * FROM Term_Realizacje WHERE tenant_id = ? AND id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async realizacjePozycji(pozycjaIds) { if (!pozycjaIds.length) return []; return qc(`SELECT * FROM Term_Realizacje WHERE tenant_id = ? AND pozycja_id IN (${pozycjaIds.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...pozycjaIds]); },
    async wstawRealizacje(r) { const x = await qc(`INSERT INTO Term_Realizacje (tenant_id, pozycja_id, przydzial_id, skladnik_id, ilosc, wykonawca_fakt, data_fakt, zapisal, zapisal_id, cykl, operacja_id, powod, zrodlo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.pozycja_id || null, r.przydzial_id || null, r.skladnik_id, r.ilosc, r.wykonawca_fakt || null, r.data_fakt, r.zapisal || null, r.zapisal_id || null, r.cykl || 1, r.operacja_id || null, r.powod || null, r.zrodlo || 'wizyta']); return x.insertId; },
    async aktualizujRealizacje(id, pola) { const s = set(pola); await qc(`UPDATE Term_Realizacje SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async wstawRuch(r) { const x = await qc(`INSERT INTO Term_Zakupy_Ruchy2 (tenant_id, skladnik_id, typ, kierunek, ilosc, historyczny, przydzial_id, realizacja_id, operacja_id, odwraca_id, data_zdarzenia, kto, kto_id, powod) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.skladnik_id, r.typ, r.kierunek || 1, r.ilosc, r.historyczny ? 1 : 0, r.przydzial_id || null, r.realizacja_id || null, r.operacja_id || null, r.odwraca_id || null, r.data_zdarzenia || null, r.kto || null, r.kto_id || null, r.powod ? String(r.powod).slice(0, 300) : null]); return x.insertId; },
    async ruch(id) { return q1(`SELECT * FROM Term_Zakupy_Ruchy2 WHERE tenant_id = ? AND id = ?`, [tenant, id]); },
    async zapiszSaldo(skladnikId, saldo) { await qc(`UPDATE Term_Zakupy_Skladniki SET saldo_json = ?, wersja = wersja + 1 WHERE tenant_id = ? AND id = ?`, [JSON.stringify(saldo), tenant, skladnikId]); },
    async aktualizujSkladnik(id, pola) { const s = set(pola); await qc(`UPDATE Term_Zakupy_Skladniki SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async aktualizujZakup(id, pola) { const s = set(pola); await qc(`UPDATE Term_Zakupy SET ${s.sql}, wersja = wersja + 1 WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async wstawZakup(r) { const x = await qc(`INSERT INTO Term_Zakupy (tenant_id, sprzedaz_id, id_klienta, klient_nazwa, oferta_id, usluga_id, nazwa, data_zakupu, data_waznosci, stan, bilans_status, zrodlo_typ, oferta_wersja_id, zrodlo_hash, zrodlo_migawka_json, zrodlo_sprawdzono, zrodla_json, zwroty_suma, stan_zrodla, kwalifikacja, kwalifikowal, kwalifikowano) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'aktywny', 'niezweryfikowany', ?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?, ?)`, [tenant, r.sprzedaz_id, r.id_klienta, r.oferta_id || 0, r.usluga_id || '', r.nazwa || null, r.data_zakupu || null, r.data_waznosci || null, r.zrodlo_typ || 'sprzedaz', r.oferta_wersja_id || null, r.zrodlo_hash || null, r.zrodlo_migawka_json || null, r.zrodlo_sprawdzono || null, r.zrodla_json || null, r.zwroty_suma || 0, r.kwalifikacja || null, r.kwalifikowal || null, r.kwalifikowano || null]); return x.insertId; },
    async wstawSkladnik(r) { const x = await qc(`INSERT INTO Term_Zakupy_Skladniki (tenant_id, zakup_id, usluga_wyk_id, jednostki_przyznane, jednostki_historyczne, stan, stan_weryfikacji, zalezne_uzgodniono, aktywny_od, jednostka_miary, jednostki_na_pozycje, usluga_nazwa, zweryfikowal, zweryfikowano, zrodlo_ustalen) VALUES (?, ?, ?, ?, 0, 'aktywny', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.zakup_id, r.usluga_wyk_id, r.jednostki_przyznane, r.stan_weryfikacji || 'niezweryfikowany', r.zalezne_uzgodniono ? 1 : 0, r.aktywny_od || null, r.jednostka_miary || 'sesja', r.jednostki_na_pozycje || 1, r.usluga_nazwa || null, r.zweryfikowal || null, r.zweryfikowano || null, r.zrodlo_ustalen || null]); return x.insertId; },
    async operacja(klucz) { return q1(`SELECT * FROM Term_Operacje WHERE tenant_id = ? AND klucz = ?`, [tenant, klucz]); },
    async wstawOperacje(r) { const x = await qc(`INSERT INTO Term_Operacje (tenant_id, klucz, rodzaj, autor, autor_id, skrot, stan, wynik_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [tenant, r.klucz, r.rodzaj, r.autor || null, r.autor_id || null, r.skrot, r.stan || 'zapisano', JSON.stringify(r.wynik == null ? null : r.wynik)]); return x.insertId; },
    async aktualizujOperacje(id, pola) { const s = set(pola); await qc(`UPDATE Term_Operacje SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    async pozycja(id, blokuj) { return q1(`SELECT p.*, r.id_klienta, r.klient_nazwa, r.wersja AS rez_wersja, r.status AS rez_status FROM Term_Pozycje p JOIN Term_Rezerwacje r ON r.id = p.rezerwacja_id AND r.tenant_id = p.tenant_id WHERE p.tenant_id = ? AND p.id = ?${blokuj ? ' FOR UPDATE' : ''}`, [tenant, id]); },
    async aktualizujPozycje(id, pola) { const s = set(pola); await qc(`UPDATE Term_Pozycje SET ${s.sql} WHERE tenant_id = ? AND id = ?`, [...s.p, tenant, id]); },
    /** Kandydaci do powiązania (Z3-05): pozycje klientki na tę usługę, nierozstrzygnięte (także przeszłe i poza widocznym tygodniem), z informacją o istniejących przydziałach. */
    async pozycjeKlientkiUslugi(idKlienta, uslugaId) {
      return qc(`SELECT p.id, p.rezerwacja_id, p.usluga_id, p.kategoria, p.wariant, p.pracownik, DATE_FORMAT(p.start,'%Y-%m-%d %H:%i:%s') AS start, p.stan, p.rozliczenie, r.wersja AS rez_wersja, r.status AS rez_status,
          (SELECT COUNT(*) FROM Term_Przydzialy a WHERE a.tenant_id = p.tenant_id AND a.pozycja_id = p.id AND a.stan = 'zarezerwowany') AS aktywne_przydzialy,
          (SELECT COUNT(*) FROM Term_Przydzialy a WHERE a.tenant_id = p.tenant_id AND a.pozycja_id = p.id AND a.stan = 'zuzyty') AS zuzyte_przydzialy
        FROM Term_Pozycje p JOIN Term_Rezerwacje r ON r.id = p.rezerwacja_id AND r.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND r.id_klienta = ? AND p.usluga_id = ? AND r.status NOT IN ('anulowana','odrzucona','wygasla') AND p.stan IN ('zaplanowana','w_trakcie','przerwana')
        ORDER BY p.start`, [tenant, String(idKlienta), String(uslugaId)]);
    },
    /** Adapter źródła: wiersz Sprzedaz (odczyt współdzielony w transakcji — LOCK IN SHARE MODE), wiersze „Dopłata” z paragonu i sumy zwrotów. Brak wiersza → row null. */
    async zrodloSprzedaz(sprzedazId, wTransakcji) {
      const row = await q1(`SELECT id, status, id_klienta, zabieg, szczegoly, kategoria_produktu, kwota, data_sprzedazy, data_waznosci, karnet_zamkniety_w, grupa_id, zwrot_do_id FROM Sprzedaz WHERE tenant_id = ? AND id = ?${wTransakcji ? ' LOCK IN SHARE MODE' : ''}`, [tenant, String(sprzedazId)]);
      if (!row) return { row: null, zwrotySuma: 0, paragon: [], powiazane: [] };
      const baza = logika.bazaParagonu(sprzedazId);
      const paragon = await qc(`SELECT id, status, id_klienta, zabieg, szczegoly, kategoria_produktu, kwota, data_sprzedazy, grupa_id, zwrot_do_id FROM Sprzedaz WHERE tenant_id = ? AND (id = ? OR id LIKE ?) AND COALESCE(status,'') <> 'USUNIĘTY'`, [tenant, baza, baza + '-%']);
      const dop = logika.powiazaneDoplaty(row, paragon);
      const ids = [String(sprzedazId), ...dop.kandydatki.map(p => String(p.id))];
      const zw = await qc(`SELECT zwrot_do_id AS id, COALESCE(SUM(ABS(kwota)), 0) AS s FROM Sprzedaz WHERE tenant_id = ? AND zwrot_do_id IN (${ids.map(() => '?').join(',')}) AND COALESCE(status, '') <> 'USUNIĘTY' GROUP BY zwrot_do_id`, [tenant, ...ids]);
      const suma = (id) => Number((zw.find(x => String(x.id) === String(id)) || {}).s || 0);
      return { row, zwrotySuma: suma(sprzedazId), paragon, powiazane: dop.powiazane.map(p => ({ ...p, zwroty_suma: suma(p.id) })), kandydatki: dop.kandydatki.map(p => ({ ...p, zwroty_suma: suma(p.id) })), niejednoznaczne: dop.niejednoznaczne };
    },
    /** Sprzedaże do podglądu rejestracji (Z3-03): wiersze salonu (opcjonalnie jednej klientki / zakresu dat), bez produktów i zwrotów; limit. */
    async sprzedazeDoPodgladu({ id_klienta, od, do_, limit = 300 } = {}) {
      const w = ['tenant_id = ?']; const p = [tenant];
      if (id_klienta) { w.push('id_klienta = ?'); p.push(String(id_klienta)); }
      if (od) { w.push('data_sprzedazy >= ?'); p.push(od + ' 00:00:00'); } if (do_) { w.push('data_sprzedazy <= ?'); p.push(do_ + ' 23:59:59'); }
      return qc(`SELECT id, status, id_klienta, klient, zabieg, szczegoly, kategoria_produktu, kwota, data_sprzedazy, data_waznosci, karnet_zamkniety_w, grupa_id, zwrot_do_id, platnosc FROM Sprzedaz WHERE ${w.join(' AND ')} ORDER BY data_sprzedazy DESC, id LIMIT ?`, [...p, Number(limit)]);
    },
    async paragony(bazy) { if (!bazy.length) return []; return qc(`SELECT id, status, id_klienta, zabieg, szczegoly, kategoria_produktu, kwota, data_sprzedazy, grupa_id, zwrot_do_id FROM Sprzedaz WHERE tenant_id = ? AND (${bazy.map(() => '(id = ? OR id LIKE ?)').join(' OR ')}) AND COALESCE(status,'') <> 'USUNIĘTY'`, [tenant, ...bazy.flatMap(b => [b, b + '-%'])]); },
    async uslugiCennika() { return qc(`SELECT id, kategoria, COALESCE(wariant,'') AS wariant, cena, waznosc_dni FROM Uslugi WHERE tenant_id = ?`, [tenant]); },
    async wersjeOfert() { const w = await qc(`SELECT w.*, o.usluga_id FROM Term_Oferty_Wersje w JOIN Term_Oferty o ON o.id = w.oferta_id AND o.tenant_id = w.tenant_id WHERE w.tenant_id = ? ORDER BY w.oferta_id, w.wersja`, [tenant]); if (!w.length) return []; const s = await qc(`SELECT wersja_id, usluga_wyk_id, jednostki, jednostka_miary, jednostki_na_pozycje FROM Term_Oferty_Skladniki WHERE tenant_id = ? AND wersja_id IN (${w.map(() => '?').join(',')}) ORDER BY id`, [tenant, ...w.map(x => x.id)]); return w.map(x => ({ ...x, skladniki: s.filter(y => y.wersja_id === x.id) })); },
    async ewidencja() { return q1(`SELECT * FROM Term_Ewidencja WHERE tenant_id = ?`, [tenant]); },
    async zapiszEwidencje(pola) { const k = Object.keys(pola); await qc(`INSERT INTO Term_Ewidencja (tenant_id, ${k.join(', ')}) VALUES (?, ${k.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${k.map(x => `${x} = VALUES(${x})`).join(', ')}`, [tenant, ...k.map(x => pola[x])]); },
    async aktywnePrzydzialySkladnika(skladnikId) { return qc(`SELECT * FROM Term_Przydzialy WHERE tenant_id = ? AND skladnik_id = ? AND stan = 'zarezerwowany' ORDER BY id`, [tenant, skladnikId]); },
    async liczniki() { const r = await q1(`SELECT (SELECT COUNT(*) FROM Term_Zakupy WHERE tenant_id = ?) zakupy, (SELECT COUNT(*) FROM Term_Zakupy_Skladniki WHERE tenant_id = ? AND stan_weryfikacji = 'zweryfikowany') zweryfikowane, (SELECT COUNT(*) FROM Term_Zakupy_Skladniki WHERE tenant_id = ? AND stan_weryfikacji <> 'zweryfikowany') niezweryfikowane, (SELECT COUNT(*) FROM Term_Zakupy_Skladniki WHERE tenant_id = ? AND zalezne_uzgodniono = 1 AND aktywny_od IS NOT NULL) uruchomione, (SELECT COUNT(*) FROM Term_Zakupy_Skladniki WHERE tenant_id = ? AND plan_json IS NOT NULL AND aktywny_od IS NULL) z_planem, (SELECT COUNT(*) FROM Term_Zakupy WHERE tenant_id = ? AND stan_zrodla <> 'ok') zrodla_do_uzgodnienia, (SELECT COUNT(*) FROM Term_Przydzialy WHERE tenant_id = ? AND stan = 'zarezerwowany') aktywne_przydzialy, (SELECT COUNT(*) FROM Term_Realizacje WHERE tenant_id = ? AND stan = 'zapisana') realizacje, (SELECT COUNT(*) FROM Term_Zakupy WHERE tenant_id = ? AND kwalifikacja = 'do_sprawdzenia') kwalifikacje_do_potwierdzenia`, [tenant, tenant, tenant, tenant, tenant, tenant, tenant, tenant, tenant]); return r || {}; },
  };
}

// ═══════════════════ DOMENA (operacje na repozytorium; bez SQL) ═══════════════════
/** ctx = { tenant, autor, autor_id, rola, teraz, tryb (efektywny), techniczna, zapisany, przerwa_od } — autor WYŁĄCZNIE z sesji (router). */
const domena = {
  async saldoSkladnikow(repo, skladnikIds) {
    const ruchy = await repo.ruchy(skladnikIds);
    const out = {}; skladnikIds.forEach(id => { out[id] = logika.saldo(ruchy.filter(r => r.skladnik_id === id)); });
    return out;
  },
  async zapiszProjekcje(repo, skladnikIds) {
    const salda = await domena.saldoSkladnikow(repo, skladnikIds);
    for (const id of skladnikIds) { await repo.zapiszSaldo(id, salda[id]); if (salda[id].niespojny) await repo.aktualizujSkladnik(id, { stan: 'niespojny' }); }
    return salda;
  },
  wymagajTryb(ctx, zbior, co) {
    if (ctx.tryb === 'niedostepna') throw new BladDomeny('Ewidencja zakupów jest technicznie niedostępna (dodatek wyłączony albo brak schematu). Historia i rezerwacje są zachowane; ta operacja została odrzucona w całości.', { code: 'EWIDENCJA_NIEDOSTEPNA', tryb: ctx.zapisany || null });
    if (!zbior.has(ctx.tryb)) throw new BladDomeny(co || (ctx.tryb === 'nie_uruchomiono' || ctx.tryb === 'przygotowanie' ? 'Ewidencja zakupów nie jest uruchomiona w tym salonie.' : ctx.tryb === 'uzgadnianie' ? 'Ewidencja po przerwie wymaga uzgodnienia przez managera — nowe operacje jednostkowe są wstrzymane.' : `Ewidencja zakupów jest w trybie „${ctx.tryb}” — ta operacja jest wstrzymana.`), { code: 'EWIDENCJA', tryb: ctx.tryb });
  },

  /** Idempotentna operacja: ten sam klucz + ten sam skrót → zapisany wynik; ten sam klucz + inny skrót → błąd (A07). */
  async operacja(repo, ctx, { klucz, rodzaj, dane }, fn) {
    if (!klucz) throw new BladDomeny('Brak klucza operacji.');
    const skrot = logika.skrotZadania(rodzaj, dane || {});
    const ist = await repo.operacja(klucz);
    if (ist) {
      if (ist.skrot !== skrot) throw new BladDomeny('Ten klucz operacji został już użyty dla innego żądania.', { code: 'KLUCZ_OPERACJI' });
      let w = null; try { w = JSON.parse(ist.wynik_json); } catch (e) { w = null; }
      return { powtorzenie: true, wynik: w, operacja_id: ist.id };
    }
    const operacja_id = await repo.wstawOperacje({ klucz, rodzaj, autor: ctx.autor, autor_id: ctx.autor_id || null, skrot, stan: 'w_toku', wynik: null });
    const wynik = await fn(operacja_id);
    await repo.aktualizujOperacje(operacja_id, { stan: 'zapisano', wynik_json: JSON.stringify(wynik == null ? null : wynik) });
    return { powtorzenie: false, wynik, operacja_id };
  },

  /** Uzgodnienie źródła zakupu z rdzeniem (adapter). Zwraca { zmiana, migawka, stan_zrodla }. Aktualizuje hash/stan w zakupie. */
  async uzgodnijZrodlo(repo, ctx, zakup, { wTransakcji = true } = {}) {
    if (zakup.zrodlo_typ && zakup.zrodlo_typ !== 'sprzedaz') return { zmiana: 'brak', migawka: null, stan_zrodla: zakup.stan_zrodla || 'ok' };
    const z = await repo.zrodloSprzedaz(zakup.sprzedaz_id, wTransakcji);
    let ustalone = null; try { ustalone = zakup.zrodla_json ? JSON.parse(zakup.zrodla_json) : null; } catch (e) { ustalone = null; }
    const powiazane = Array.isArray(ustalone) ? (z.kandydatki || []).filter(p => ustalone.includes(String(p.id))) : z.powiazane; // powiązania ustalone przy rejestracji (także jawnie) są trwałe — nie przeliczamy ich regułą automatyczną
    const nowa = logika.migawkaZrodla(z.row, z.zwrotySuma, powiazane);
    let stara = null; try { stara = zakup.zrodlo_migawka_json ? JSON.parse(zakup.zrodlo_migawka_json) : null; } catch (e) { stara = null; }
    const zmiana = logika.porownajZrodlo(stara, nowa);
    const pola = { zrodlo_sprawdzono: ctx.teraz };
    if (nowa) { pola.zrodlo_hash = logika.hash(nowa); pola.zrodlo_migawka_json = JSON.stringify(nowa); pola.zwroty_suma = Number(nowa.zwroty_suma); pola.zrodla_json = JSON.stringify(nowa.powiazane.map(p => p.id)); }
    if (zmiana === 'usuniete') pola.stan_zrodla = 'usuniete';
    else if (zmiana === 'zwrot') {
      const kwotaCalosci = Number(nowa.kwota || 0) + nowa.powiazane.reduce((a, p) => a + Number(p.kwota || 0), 0);
      const zwrotyCalosci = Number(nowa.zwroty_suma) + nowa.powiazane.reduce((a, p) => a + Number(p.zwroty_suma || 0), 0);
      pola.stan_zrodla = kwotaCalosci > 0 && zwrotyCalosci >= kwotaCalosci - 0.005 ? 'wycofane' : 'do_uzgodnienia'; // częściowy zwrot (także dopłaty) = zakres do ustalenia, nie przeliczenie na sesje
    }
    else if (zmiana === 'istotna') pola.stan_zrodla = 'do_uzgodnienia';
    await repo.aktualizujZakup(zakup.id, pola);
    return { zmiana, migawka: nowa, stan_zrodla: pola.stan_zrodla || zakup.stan_zrodla || 'ok' };
  },
  /** Kontrola źródła przed operacją jednostkową na składnikach (R2): odmowa z utrwaleniem stanu po rollbacku (pole utrwalPoRollback). */
  async sprawdzZrodlaSkladnikow(repo, ctx, skladniki, { operacja }) {
    for (const s of skladniki) {
      if (s.zrodlo_typ && s.zrodlo_typ !== 'sprzedaz') continue;
      const u = await domena.uzgodnijZrodlo(repo, ctx, { id: s.zakup_id, sprzedaz_id: s.sprzedaz_id, zrodlo_typ: 'sprzedaz', zrodlo_migawka_json: s.zrodlo_migawka_json, stan_zrodla: s.stan_zrodla });
      s.stan_zrodla = u.stan_zrodla;
      if (u.zmiana === 'istotna' || u.zmiana === 'usuniete' || u.zmiana === 'zwrot') {
        const e = new BladDomeny(`Zakup „${s.zakup_nazwa || ''}” wymaga wyjaśnienia — został zmieniony w Sprzedaży po ostatnim sprawdzeniu (${u.zmiana === 'zwrot' ? 'zwrot' : u.zmiana === 'usuniete' ? 'usunięty' : 'zmiana danych'}). ${operacja === 'rezerwacja' ? 'Wizyta nie została zapisana; formularz zachowany.' : 'Operacja nie została wykonana; nic nie zmieniono.'}`, { code: 'ZRODLO', zmiana: u.zmiana, zakup_id: s.zakup_id });
        e.utrwalPoRollback = { zakup_id: s.zakup_id, stan_zrodla: u.stan_zrodla, zmiana: u.zmiana }; throw e;
      }
      if (s.stan_zrodla && s.stan_zrodla !== 'ok') throw new BladDomeny(`Zakup „${s.zakup_nazwa || ''}” wymaga wyjaśnienia (${s.stan_zrodla === 'wycofane' ? 'wycofany/zwrócony' : s.stan_zrodla === 'usuniete' ? 'usunięty w Sprzedaży' : 'zmieniony w Sprzedaży'}). Operacja odrzucona w całości.`, { code: 'ZRODLO', zakup_id: s.zakup_id, stan_zrodla: s.stan_zrodla });
    }
  },

  /** Przyznanie uprawnienia przez salon (gratis/rekompensata/dane testowe) — źródło „przyznane”, bez wiersza Sprzedaz. */
  async przyznaj(repo, ctx, { id_klienta, usluga_wyk_id, usluga_nazwa, jednostki, nazwa, data_waznosci, powod, operacja_id, zweryfikowany = true }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'konczenie']));
    const n = Number(jednostki); if (!Number.isInteger(n) || n <= 0 || n > 500) throw new BladDomeny('Liczba jednostek musi być całkowita (1–500).');
    if (!id_klienta) throw new BladDomeny('Wskaż klientkę (ID).'); if (!usluga_wyk_id) throw new BladDomeny('Wskaż usługę.'); if (!powod) throw new BladDomeny('Podaj powód przyznania.');
    const zrodloId = 'PRZYZNANE:' + crypto.randomUUID();
    const zakupId = await repo.wstawZakup({ sprzedaz_id: zrodloId, zrodlo_typ: 'przyznane', id_klienta: String(id_klienta), usluga_id: usluga_wyk_id, nazwa: nazwa || `Przyznane przez salon: ${usluga_nazwa || usluga_wyk_id}`, data_zakupu: ctx.teraz.slice(0, 10), data_waznosci: data_waznosci || null, kwalifikacja: 'pakiet', kwalifikowal: ctx.autor, kwalifikowano: ctx.teraz, zrodlo_sprawdzono: ctx.teraz });
    const sklId = await repo.wstawSkladnik({ zakup_id: zakupId, usluga_wyk_id, usluga_nazwa, jednostki_przyznane: n, stan_weryfikacji: zweryfikowany ? 'zweryfikowany' : 'niezweryfikowany', zalezne_uzgodniono: zweryfikowany ? 1 : 0, aktywny_od: zweryfikowany ? ctx.teraz : null, zweryfikowal: zweryfikowany ? ctx.autor : null, zweryfikowano: zweryfikowany ? ctx.teraz : null, zrodlo_ustalen: zweryfikowany ? powod : null });
    await repo.wstawRuch({ skladnik_id: sklId, typ: 'G', kierunek: 1, ilosc: n, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'przyznane przez salon: ' + powod });
    await domena.zapiszProjekcje(repo, [sklId]);
    return { zakup_id: zakupId, skladnik_id: sklId };
  },

  /**
   * Podgląd rejestracji (Z3-03, bez mutacji): klasyfikuje sprzedaże salonu/klientki. Zwraca listę z kategorią i powodem.
   */
  async podgladZrodel(repo, ctx, { id_klienta, od, do_, limit } = {}) {
    const rows = await repo.sprzedazeDoPodgladu({ id_klienta, od, do_, limit });
    if (!rows.length) return { pozycje: [], liczniki: {} };
    const cennik = await repo.uslugiCennika(); const wersje = await repo.wersjeOfert();
    const bazy = [...new Set(rows.map(r => logika.bazaParagonu(r.id)))];
    const paragonRows = await repo.paragony(bazy);
    const istniejace = await repo.zakupyPoSprzedazy(rows.map(r => r.id));
    const znajdzUsluge = (r) => { const w = logika.bezSufiksuRabatu(r.szczegoly); return cennik.find(u => String(u.kategoria).trim() === String(r.zabieg || '').trim() && String(u.wariant).trim() === w) || null; };
    const out = [];
    for (const r of rows) {
      const paragon = paragonRows.filter(p => logika.bazaParagonu(p.id) === logika.bazaParagonu(r.id));
      const usl = znajdzUsluge(r);
      const ist = istniejace.find(z => String(z.sprzedaz_id) === String(r.id)) || null;
      let migawkaAktualna = null;
      if (ist) { const z = await repo.zrodloSprzedaz(r.id, false); migawkaAktualna = logika.migawkaZrodla(z.row, z.zwrotySuma, z.powiazane); }
      const k = logika.klasyfikuj({ row: r, paragon, usluga: usl, wersje: usl ? wersje.filter(w => String(w.usluga_id) === String(usl.id)) : [], istniejacy: ist, migawkaAktualna });
      out.push({ ...k, klient: ctx.widziKwoty ? r.klient : undefined, kwota: ctx.widziKwoty ? Number(r.kwota) : undefined, platnosc: ctx.widziKwoty ? r.platnosc : undefined });
    }
    const liczniki = {}; out.forEach(x => { liczniki[x.kategoria] = (liczniki[x.kategoria] || 0) + 1; });
    return { pozycje: out, liczniki };
  },

  /**
   * Rejestracja zakupów (Z3-03): jawna lista sprzedaż_id (+ opcjonalne rozstrzygnięcia: wersja_id, id_klienta, powiazane) → per pozycja atomowo.
   * Idempotentna: trwały klucz źródła (UNIQUE tenant+sprzedaz_id) + Term_Operacje. Powtórzenie nie zwiększa G. Nie tworzy R/U.
   */
  async zarejestrujZakupy(repo, ctx, { pozycje, operacja_id }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'konczenie', 'uzgadnianie']), 'Rejestracja zakupów wymaga trybu przygotowania albo działającej ewidencji.');
    const cennik = await repo.uslugiCennika(); const wersje = await repo.wersjeOfert();
    const wyniki = []; let nrSp = 0;
    for (const p of pozycje || []) {
      const sid = String(p.sprzedaz_id || '');
      const sp = 'zk_sp_' + (++nrSp); let spOtwarty = false;
      try {
        const [ist] = await repo.zakupyPoSprzedazy([sid]);
        if (ist) { wyniki.push({ sprzedaz_id: sid, wynik: 'istnieje', zakup_id: ist.id }); continue; }
        const z = await repo.zrodloSprzedaz(sid, true);
        if (!z.row) { wyniki.push({ sprzedaz_id: sid, wynik: 'blad', powod: 'brak wiersza sprzedaży' }); continue; }
        const row = { ...z.row, id_klienta: z.row.id_klienta || (p.id_klienta ? String(p.id_klienta) : null) };
        const usl = cennik.find(u => String(u.kategoria).trim() === String(row.zabieg || '').trim() && String(u.wariant).trim() === logika.bezSufiksuRabatu(row.szczegoly)) || null;
        let k = logika.klasyfikuj({ row, paragon: z.paragon, usluga: usl, wersje: usl ? wersje.filter(w => String(w.usluga_id) === String(usl.id)) : [], istniejacy: null });
        if (k.kategoria === 'wymaga_rozstrzygniecia' && p.wersja_id && usl) { // jawne wskazanie wersji przez managera (sprzedaż sprzed mapowania / dwie wersje tego dnia)
          const wer = wersje.find(w => w.id === Number(p.wersja_id) && String(w.usluga_id) === String(usl.id) && w.stan === 'zatwierdzona');
          if (wer) k = { ...k, kategoria: ['nie_ewidencjonuj', 'nieobslugiwany'].includes(wer.rodzaj) ? 'pominiete' : 'gotowe', rodzaj: wer.rodzaj, wersja: wer.wersja, wersja_id: wer.id, skladniki: (wer.skladniki || []).map(s => ({ usluga_wyk_id: s.usluga_wyk_id, jednostki: Number(s.jednostki), jednostka_miary: s.jednostka_miary || 'sesja', jednostki_na_pozycje: Number(s.jednostki_na_pozycje) || 1 })), kwalifikacja: wer.rodzaj === 'pojedynczy_z_gory' ? 'do_sprawdzenia' : 'pakiet', powod: `wersja ${wer.wersja} wskazana jawnie przez ${ctx.autor}` };
        }
        if (k.kategoria === 'wymaga_rozstrzygniecia' && k.niejednoznaczne && Array.isArray(p.powiazane)) { k = { ...k, kategoria: 'gotowe', powiazane: p.powiazane.map(String), powod: 'powiązanie dopłat wskazane jawnie' }; }
        if (k.kategoria !== 'gotowe') { wyniki.push({ sprzedaz_id: sid, wynik: k.kategoria, powod: k.powod }); continue; }
        if (!k.skladniki || !k.skladniki.length) { wyniki.push({ sprzedaz_id: sid, wynik: 'blad', powod: 'wersja mapowania bez składników' }); continue; }
        const powiazane = (Array.isArray(p.powiazane) ? (z.kandydatki || []) : z.powiazane).filter(x => (k.powiazane || []).includes(String(x.id)));
        const migawka = logika.migawkaZrodla(row, z.zwrotySuma, powiazane);
        const abs = logika.stanAbsolutnyZrodla(row, z.zwrotySuma, powiazane); // N13: stan absolutny, nie tylko różnica migawek
        if (repo.savepoint) { await repo.savepoint(sp); spOtwarty = true; } // N02: od tego miejsca zaczynają się zapisy tego zakupu
        const zakupId = await repo.wstawZakup({ sprzedaz_id: sid, zrodlo_typ: 'sprzedaz', id_klienta: String(row.id_klienta), oferta_id: wersje.find(w => w.id === k.wersja_id).oferta_id, usluga_id: usl.id, nazwa: `${row.zabieg}${k.szczegoly ? ' / ' + k.szczegoly : ''}`, data_zakupu: k.data, data_waznosci: row.data_waznosci ? String(row.data_waznosci).slice(0, 10) : null, oferta_wersja_id: k.wersja_id, zrodlo_hash: logika.hash(migawka), zrodlo_migawka_json: JSON.stringify(migawka), zrodlo_sprawdzono: ctx.teraz, zrodla_json: JSON.stringify(migawka.powiazane.map(x => x.id)), zwroty_suma: Number(migawka.zwroty_suma), stan_zrodla: abs.stan, kwalifikacja: k.kwalifikacja, kwalifikowal: k.kwalifikacja === 'pakiet' ? ctx.autor : null, kwalifikowano: k.kwalifikacja === 'pakiet' ? ctx.teraz : null });
        const skl = [];
        for (const s of k.skladniki) {
          const nazwaU = (() => { const u = cennik.find(x => String(x.id) === String(s.usluga_wyk_id)); return u ? u.kategoria + (u.wariant ? ' / ' + u.wariant : '') : String(s.usluga_wyk_id); })();
          const sklId = await repo.wstawSkladnik({ zakup_id: zakupId, usluga_wyk_id: s.usluga_wyk_id, usluga_nazwa: nazwaU, jednostki_przyznane: s.jednostki, jednostka_miary: s.jednostka_miary, jednostki_na_pozycje: s.jednostki_na_pozycje, stan_weryfikacji: 'niezweryfikowany' });
          await repo.wstawRuch({ skladnik_id: sklId, typ: 'G', kierunek: 1, ilosc: s.jednostki, operacja_id, data_zdarzenia: k.data ? k.data + ' 00:00:00' : ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: `rejestracja zakupu ${sid} (wersja ${k.wersja})` });
          skl.push(sklId);
        }
        await domena.zapiszProjekcje(repo, skl);
        if (spOtwarty && repo.zwolnijSavepoint) { await repo.zwolnijSavepoint(sp); spOtwarty = false; }
        wyniki.push({ sprzedaz_id: sid, wynik: 'zarejestrowano', zakup_id: zakupId, skladniki: skl, kwalifikacja: k.kwalifikacja, powiazane: migawka.powiazane.map(x => x.id), stan_zrodla: abs.stan, uwaga_zrodla: abs.powod });
      } catch (e) {
        // N02: wadliwy zakup wycofujemy W CAŁOŚCI (rodzic + składniki + ruchy G), poprawne z tej samej partii zostają.
        if (spOtwarty && repo.doSavepoint) { try { await repo.doSavepoint(sp); } catch (e2) { throw e; } spOtwarty = false; }
        if (e && e.code === 'ER_DUP_ENTRY' && /uq_sprz/i.test(String(e.message || ''))) {
          const [ist2] = await repo.zakupyPoSprzedazy([sid]); // kolizja na (tenant_id, sprzedaz_id) = zakup już istnieje
          wyniki.push({ sprzedaz_id: sid, wynik: 'istnieje', zakup_id: ist2 ? ist2.id : null });
        } else if (e && e.code === 'ER_DUP_ENTRY') {
          wyniki.push({ sprzedaz_id: sid, wynik: 'blad', powod: `konflikt unikalności poza kluczem źródła — nie traktujemy tego jako „zakup już istnieje”: ${e.message}` });
        } else wyniki.push({ sprzedaz_id: sid, wynik: 'blad', powod: e.message });
      }
    }
    return { wyniki, zarejestrowano: wyniki.filter(w => w.wynik === 'zarejestrowano').length, pominieto: wyniki.filter(w => w.wynik !== 'zarejestrowano' && w.wynik !== 'istnieje').length, istnialo: wyniki.filter(w => w.wynik === 'istnieje').length };
  },

  /** Kwalifikacja zakupu „1×” jako zabiegu kupionego na przyszłość (manager, per zakup, z powodem) albo jako nieewidencjonowanego. */
  async kwalifikujZakup(repo, ctx, { zakup_id, kwalifikacja, powod }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'konczenie', 'uzgadnianie']));
    if (!['pakiet', 'pojedynczy_z_gory', 'nie_ewidencjonuj'].includes(kwalifikacja)) throw new BladDomeny('Nieznana kwalifikacja.');
    if (!powod) throw new BladDomeny('Podaj podstawę kwalifikacji (np. „klientka kupiła z góry, zabieg nie odbył się”).');
    const z = await repo.zakup(Number(zakup_id), true); if (!z) throw new BladDomeny('Nie znaleziono zakupu.');
    if (z.kwalifikacja === kwalifikacja) return { zakup_id: z.id, powtorzenie: true };
    const pola = { kwalifikacja, kwalifikowal: ctx.autor, kwalifikowano: ctx.teraz };
    if (kwalifikacja === 'nie_ewidencjonuj') { pola.stan = 'zamkniety'; for (const s of await repo.skladnikiZakupow([z.id])) await repo.aktualizujSkladnik(s.id, { stan: 'wycofany', zrodlo_ustalen: `nie ewidencjonujemy: ${powod}`.slice(0, 300) }); }
    await repo.aktualizujZakup(z.id, pola);
    return { zakup_id: z.id, kwalifikacja };
  },

  /** Weryfikacja JEDNEGO składnika (manager): wszystkie liczby jawne (także zero). Zapis jako ruchy historyczne (różnica). */
  async weryfikujSkladnik(repo, ctx, { skladnik_id, hist_wykorzystane, hist_wycofane, hist_potracone, punkt_odciecia, zrodlo_ustalen, operacja_id }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'konczenie', 'uzgadnianie']), 'Weryfikacja składników wymaga trybu przygotowania albo działającej ewidencji.');
    const liczby = { U: hist_wykorzystane, W: hist_wycofane, F: hist_potracone };
    for (const [k, v] of Object.entries(liczby)) if (v === undefined || v === null || v === '' || !Number.isInteger(Number(v)) || Number(v) < 0) throw new BladDomeny(`Podaj jawnie liczbę (także 0): ${k === 'U' ? 'wykorzystane wcześniej' : k === 'W' ? 'wycofane wcześniej' : 'potrącone wcześniej'}.`, { code: 'PUSTE_POLE', pole: k });
    if (!zrodlo_ustalen) throw new BladDomeny('Podaj źródło ustaleń (np. „zweryfikowana karta klientki”, „wykonania w Booksy do 10.2026”).');
    const [s] = await repo.skladniki([Number(skladnik_id)], true); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    if (s.stan === 'wycofany') throw new BladDomeny('Składnik jest wycofany (zakup nieewidencjonowany).');
    const przed = (await domena.saldoSkladnikow(repo, [s.id]))[s.id];
    const G = przed.G, sumaHist = Number(liczby.U) + Number(liczby.W) + Number(liczby.F);
    if (sumaHist > G) throw new BladDomeny(`Zgłoszone historyczne wykorzystanie (${sumaHist}) przekracza zakupione jednostki (${G}). Odszukaj brakujący zakup albo popraw dane — nie zatwierdzamy niemożliwego salda.`, { code: 'BILANS_NIEMOZLIWY' });
    // N04 (ZK-03.1): bilans liczony z PEŁNYCH aktualnych ruchów — zastępujemy tylko dotychczasową część historyczną nową.
    // Wcześniej było `G − nowa historia − R`, co pomijało wykonania, wycofania i potrącenia zapisane już w terminarzu:
    // przy G=10, historii U=3, pięciu wykonanych w terminarzu i R=1 korekta historii 3→5 przechodziła, dając B=−1.
    const dotychH = { U: Number(s.hist_wykorzystane) || 0, W: Number(s.hist_wycofane) || 0, F: Number(s.hist_potracone) || 0 };
    const nowe = {}; for (const k of ['U', 'W', 'F']) nowe[k] = Number(przed[k]) - dotychH[k] + Number(liczby[k]);
    for (const k of ['U', 'W', 'F']) if (nowe[k] < 0) throw new BladDomeny(`Korekta jest niższa niż ruchy już zapisane w terminarzu (${k}: zapisane ${Number(przed[k]) - dotychH[k]}, historia ${dotychH[k]} → ${liczby[k]}). Najpierw skoryguj wykonania w kalendarzu.`, { code: 'BILANS_NIEMOZLIWY' });
    const nowyL = G - nowe.W - nowe.U - nowe.F; const nowyB = nowyL - przed.R;
    if (nowyB < 0) throw new BladDomeny(`Po tej weryfikacji wolna pula (${nowyL}) byłaby mniejsza niż już przydzielone jednostki (${przed.R}). Najpierw uzgodnij zależne wizyty.`, { code: 'ZALEZNE_WIZYTY' });
    let zmian = 0;
    for (const [typ, v] of Object.entries(liczby)) {
      const dotych = Number(typ === 'U' ? s.hist_wykorzystane : typ === 'W' ? s.hist_wycofane : s.hist_potracone) || 0;
      const roznica = Number(v) - dotych; if (!roznica) continue; zmian++;
      await repo.wstawRuch({ skladnik_id: s.id, typ, kierunek: roznica > 0 ? 1 : -1, ilosc: Math.abs(roznica), historyczny: 1, operacja_id, data_zdarzenia: punkt_odciecia || ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: `stan początkowy: ${dotych} → ${Number(v)}; ${zrodlo_ustalen}` });
    }
    await repo.aktualizujSkladnik(s.id, { hist_wykorzystane: Number(liczby.U), hist_wycofane: Number(liczby.W), hist_potracone: Number(liczby.F), punkt_odciecia: punkt_odciecia || s.punkt_odciecia || ctx.teraz, zrodlo_ustalen: String(zrodlo_ustalen).slice(0, 300), stan_weryfikacji: 'zweryfikowany', zweryfikowal: ctx.autor, zweryfikowano: ctx.teraz, stan: s.stan === 'niespojny' ? 'aktywny' : s.stan });
    const po = await domena.zapiszProjekcje(repo, [s.id]);
    return { skladnik_id: s.id, saldo: po[s.id], ruchy_historyczne: zmian, powtorzenie: zmian === 0 && s.stan_weryfikacji === 'zweryfikowany' };
  },

  /** Kandydaci do powiązania (Z3-05) z saldem i skrótem zbioru. */
  async kandydaciWizyt(repo, ctx, { skladnik_id }) {
    const [s] = await repo.skladniki([Number(skladnik_id)]); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    const poz = await repo.pozycjeKlientkiUslugi(s.id_klienta, s.usluga_wyk_id);
    const saldo = (await domena.saldoSkladnikow(repo, [s.id]))[s.id];
    const kandydaci = poz.map(p => ({ id: p.id, rezerwacja_id: p.rezerwacja_id, numer: 'EST-' + String(p.rezerwacja_id).padStart(4, '0'), start: p.start, pracownik: p.pracownik, stan: p.stan, rozliczenie: p.rozliczenie, rez_wersja: p.rez_wersja, przeszla: String(p.start) < ctx.teraz, juz_powiazana: Number(p.aktywne_przydzialy) > 0 || Number(p.zuzyte_przydzialy) > 0, jednostki: Number(s.jednostki_na_pozycje) || 1 }));
    // N05: decyzje lokalne tego składnika (plan) wykluczają wizytę TYLKO tutaj; globalne (`rozliczenie`) — wszędzie.
    let planPrzed = null; try { planPrzed = s.plan_json ? JSON.parse(s.plan_json) : null; } catch (e) { planPrzed = null; }
    const lokalne = {}; for (const d of (planPrzed && planPrzed.decyzje) || []) if (DECYZJE_LOKALNE.has(d.decyzja)) lokalne[Number(d.pozycja_id)] = d;
    for (const k of kandydaci) if (lokalne[k.id]) { k.decyzja_lokalna = lokalne[k.id].decyzja; k.uzasadnienie_lokalne = lokalne[k.id].uzasadnienie || null; }
    const doDecyzji = kandydaci.filter(k => !k.juz_powiazana && !k.rozliczenie && !k.decyzja_lokalna);
    const potrzeba = doDecyzji.reduce((a, k) => a + k.jednostki, 0);
    let plan = null; try { plan = s.plan_json ? JSON.parse(s.plan_json) : null; } catch (e) { plan = null; }
    return { skladnik: { id: s.id, usluga_nazwa: s.usluga_nazwa, stan_weryfikacji: s.stan_weryfikacji, uruchomiony: !!(s.zalezne_uzgodniono && s.aktywny_od), zakup_nazwa: s.zakup_nazwa, id_klienta: s.id_klienta }, saldo, kandydaci, do_decyzji: doDecyzji.length, potrzeba, niedobor: Math.max(0, potrzeba - Math.max(0, saldo.B)), skrot: logika.skrotKandydatow(poz), plan };
  },

  /**
   * Uruchomienie składnika (Z3-05/06): decyzje dla WSZYSTKICH nierozstrzygniętych kandydatów; w trybie przygotowania = plan (bez R);
   * w trybie aktywnym = atomowe przydziały R dla „powiaz” + oznaczenie gotowości, po ponownym sprawdzeniu źródła, salda i aktualności podglądu.
   */
  async uruchomSkladnik(repo, ctx, { skladnik_id, decyzje, skrot, z_planu, potwierdzenie_zaleznych, operacja_id }) {
    domena.wymagajTryb(ctx, new Set(['przygotowanie', 'aktywna', 'uzgadnianie']));
    const [s] = await repo.skladniki([Number(skladnik_id)], true); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    if (s.stan_weryfikacji !== 'zweryfikowany') throw new BladDomeny('Najpierw potwierdź stan początkowy tego składnika.', { code: 'NIEZWERYFIKOWANY' });
    if (s.kwalifikacja === 'do_sprawdzenia') throw new BladDomeny('Ta sprzedaż dokumentuje pojedynczy zabieg — najpierw potwierdź, czy zakupiono go na przyszłość.', { code: 'KWALIFIKACJA' });
    const kand = await domena.kandydaciWizyt(repo, ctx, { skladnik_id: s.id });
    let lista = Array.isArray(decyzje) ? decyzje : (z_planu ? null : []); let skrotPodgladu = skrot;
    if (z_planu) { let plan = null; try { plan = s.plan_json ? JSON.parse(s.plan_json) : null; } catch (e) { plan = null; } if (!plan) throw new BladDomeny('Brak zapisanego planu dla tego składnika.'); lista = plan.decyzje; skrotPodgladu = s.plan_skrot; }
    if (!lista) throw new BladDomeny('Brak decyzji dla istniejących wizyt.');
    if (skrotPodgladu && skrotPodgladu !== kand.skrot) throw new BladDomeny('Istniejące wizyty zmieniły się od podglądu (nowa wizyta, zmiana terminu albo statusu). Odśwież listę i rozstrzygnij ponownie.', { code: 'PODGLAD_NIEAKTUALNY' });
    const doDecyzji = kand.kandydaci.filter(k => !k.juz_powiazana && !k.rozliczenie);
    for (const k of doDecyzji) { const d = lista.find(x => Number(x.pozycja_id) === k.id); if (!d || !DECYZJE_WIZYT.includes(d.decyzja)) throw new BladDomeny(`Wizyta ${k.numer} (${String(k.start).slice(0, 16)}) nie ma rozstrzygnięcia.`, { code: 'BRAK_DECYZJI', pozycja_id: k.id }); if (['wyjasnienie', 'niezwiazana', 'historyczna'].includes(d.decyzja) && !String(d.uzasadnienie || '').trim()) throw new BladDomeny(`Wizyta ${k.numer}: decyzja „${d.decyzja}” wymaga uzasadnienia.`, { code: 'BRAK_UZASADNIENIA', pozycja_id: k.id }); }
    for (const d of lista) if (!doDecyzji.some(k => k.id === Number(d.pozycja_id))) throw new BladDomeny('Decyzja dotyczy wizyty spoza aktualnej listy — odśwież podgląd.', { code: 'PODGLAD_NIEAKTUALNY' });
    const powiaz = doDecyzji.filter(k => lista.find(x => Number(x.pozycja_id) === k.id).decyzja === 'powiaz');
    const potrzeba = powiaz.reduce((a, k) => a + k.jednostki, 0);
    if (potrzeba > Math.max(0, kand.saldo.B)) throw new BladDomeny(`Masz ${Math.max(0, kand.saldo.B)} ${kand.saldo.B === 1 ? 'zabieg' : 'zabiegów'} do przypisania, a wybrano ${potrzeba}. Rozstrzygnij nadmiarowe wizyty jako wymagające zakupu/wyjaśnienia albo dopuszczoną usługę jednorazową.`, { code: 'NIEDOBOR', dostepne: Math.max(0, kand.saldo.B), potrzeba });
    if (!potwierdzenie_zaleznych && !z_planu) throw new BladDomeny('Potwierdź, że lista istniejących wizyt została przejrzana w całości.');
    if (ctx.tryb === 'przygotowanie' || ctx.tryb === 'uzgadnianie') { // plan bez R
      await repo.aktualizujSkladnik(s.id, { plan_json: JSON.stringify({ decyzje: lista, zapisal: ctx.autor, kiedy: ctx.teraz }), plan_skrot: kand.skrot });
      return { skladnik_id: s.id, plan: true, powiazan: powiaz.length, decyzji: lista.length };
    }
    await domena.sprawdzZrodlaSkladnikow(repo, ctx, [s], { operacja: 'uruchomienie' });
    const zakup = { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci, kwalifikacja: s.kwalifikacja };
    const przydzialy = [];
    for (const k of powiaz) {
      const powod = logika.powodNiedostepnosci({ ...s, zalezne_uzgodniono: 1, aktywny_od: ctx.teraz }, zakup, { ...kand.saldo, B: 1 }, String(k.start).slice(0, 10), ctx.tryb);
      if (powod && !/umówione|wykorzystany|dostępnych/.test(powod)) throw new BladDomeny(`Wizyta ${k.numer}: ${powod}. Rozstrzygnij ją inaczej.`, { code: 'NIEDOSTEPNY', pozycja_id: k.id, powod });
      const pid = await repo.wstawPrzydzial({ pozycja_id: k.id, skladnik_id: s.id, ilosc: k.jednostki, cykl: 1, operacja_id });
      await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: 1, ilosc: k.jednostki, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: `powiązanie istniejącej wizyty ${k.numer} przy uruchomieniu` });
      await repo.aktualizujPozycje(k.id, { zakup_skladnik_id: s.id, jednostki_wymagane: k.jednostki, rozliczenie: 'pakiet' });
      przydzialy.push(pid);
    }
    // N05 (ZK-03.1): tylko decyzje GLOBALNE trafiają na pozycję wizyty. „niezwiazana” i „historyczna” znaczą
    // „nie z TEGO zakupu / ujęta w historii TEGO zakupu” — zapisane globalnie wykluczały wizytę także z każdego
    // innego zakupu klientki (wizyta znikała z listy kandydatów dla zakupu Y). Trzymamy je w planie składnika.
    for (const k of doDecyzji) {
      const d = lista.find(x => Number(x.pozycja_id) === k.id);
      if (d.decyzja === 'powiaz' || DECYZJE_LOKALNE.has(d.decyzja)) continue;
      await repo.aktualizujPozycje(k.id, { rozliczenie: d.decyzja === 'jednorazowa' ? 'pojedynczy' : 'do_wyjasnienia' });
    }
    await repo.aktualizujSkladnik(s.id, { zalezne_uzgodniono: 1, uzgodnienie_wersja: Number(s.uzgodnienie_wersja || 0) + 1, aktywny_od: s.aktywny_od || ctx.teraz, plan_json: JSON.stringify({ decyzje: lista, zapisal: ctx.autor, kiedy: ctx.teraz, uruchomiono: true }), plan_skrot: kand.skrot });
    const po = await domena.zapiszProjekcje(repo, [s.id]);
    return { skladnik_id: s.id, plan: false, przydzialy, powiazan: powiaz.length, do_wyjasnienia: doDecyzji.filter(k => lista.find(x => Number(x.pozycja_id) === k.id).decyzja === 'wyjasnienie').map(k => k.id), saldo: po[s.id] };
  },

  /**
   * Rezerwacja jednostek dla pozycji wizyty — cała lista albo nic. pozycje: [{pozycja_id, skladnik_id, ilosc, usluga_id}] (kilka wpisów na pozycję = kilka źródeł, P14).
   * Sprawdza: tryb, właściciela po ID, usługę, stan/weryfikację/uruchomienie, ważność na datę, aktualne źródło (w transakcji), B dla PEŁNEJ listy.
   */
  async rezerwuj(repo, ctx, { pozycje, id_klienta, data, uslugaPozycji, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_NOWE_PRZYDZIALY);
    if (!id_klienta) throw new BladDomeny('Rezerwacja z zakupu wymaga klientki z kartoteki (ID).');
    const ids = [...new Set(pozycje.map(p => Number(p.skladnik_id)))];
    const skl = await repo.skladniki(ids, true);
    if (skl.length !== ids.length) throw new BladDomeny('Nie znaleziono wskazanego zakupu.');
    for (const s of skl) if (String(s.id_klienta || '') !== String(id_klienta)) throw new BladDomeny('Wskazany zakup należy do innej klientki.', { code: 'WLASCICIEL' });
    await domena.sprawdzZrodlaSkladnikow(repo, ctx, skl, { operacja: 'rezerwacja' });
    const salda = await domena.saldoSkladnikow(repo, ids);
    const potrzeba = {};
    for (const p of pozycje) {
      const s = skl.find(x => x.id === Number(p.skladnik_id));
      const uslugaPoz = uslugaPozycji ? uslugaPozycji(p) : p.usluga_id;
      if (uslugaPoz && String(s.usluga_wyk_id) !== String(uslugaPoz)) throw new BladDomeny(`Pakiet „${s.zakup_nazwa || ''}” dotyczy innej usługi (${s.usluga_nazwa || s.usluga_wyk_id}). Wybierz zgodną usługę.`, { code: 'INNY_WARIANT' });
      const powod = logika.powodNiedostepnosci(s, { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci, kwalifikacja: s.kwalifikacja }, salda[s.id], data, ctx.tryb);
      if (powod) throw new BladDomeny(`Nie można umówić z pakietu „${s.zakup_nazwa || ''}”: ${powod}.`, { code: 'NIEDOSTEPNY', powod });
      const q = Math.max(1, Number(p.ilosc) || Number(s.jednostki_na_pozycje) || 1);
      potrzeba[s.id] = (potrzeba[s.id] || 0) + q;
      if (potrzeba[s.id] > salda[s.id].B) throw new BladDomeny(potrzeba[s.id] - q >= salda[s.id].B && salda[s.id].B > 0 ? `W pakiecie „${s.zakup_nazwa || ''}” została ${salda[s.id].B === 1 ? '1 jednostka' : salda[s.id].B + ' jednostki'} — ten formularz chce użyć ${potrzeba[s.id]}. Usuń jedną pozycję albo wybierz inny zakup.` : `Ostatni zabieg z pakietu „${s.zakup_nazwa || ''}” został przed chwilą przypisany do innej wizyty. Ta wizyta nie została zapisana.`, { code: 'BRAK_JEDNOSTEK', dostepne: salda[s.id].B });
    }
    const przydzialy = []; const naPozycje = {};
    for (const p of pozycje) {
      const s = skl.find(x => x.id === Number(p.skladnik_id)); const q = Math.max(1, Number(p.ilosc) || Number(s.jednostki_na_pozycje) || 1);
      const pid = await repo.wstawPrzydzial({ pozycja_id: p.pozycja_id, skladnik_id: s.id, ilosc: q, cykl: 1, operacja_id });
      await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: 1, ilosc: q, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: p.powod || 'umówienie' });
      const np = naPozycje[p.pozycja_id] = naPozycje[p.pozycja_id] || { pierwszy: s.id, suma: 0 }; np.suma += q;
      przydzialy.push({ id: pid, pozycja_id: p.pozycja_id, skladnik_id: s.id, ilosc: q });
    }
    for (const [pozId, np] of Object.entries(naPozycje)) await repo.aktualizujPozycje(Number(pozId), { zakup_skladnik_id: np.pierwszy, jednostki_wymagane: np.suma, rozliczenie: 'pakiet' }); // zakup_skladnik_id = POLE ZGODNOŚCI (pierwsze źródło); prawdą są przydziały
    await domena.zapiszProjekcje(repo, ids);
    return { przydzialy };
  },

  /** Zwolnienie aktywnych przydziałów pozycji (odwołanie, nieobecność, niewykonanie). R − q; U bez zmian. Spójne także przy wycofanym źródle (nie przywraca prawa). */
  async zwolnij(repo, ctx, { pozycja_id, powod, operacja_id }) {
    const prz = (await repo.przydzialyPozycji([Number(pozycja_id)])).filter(x => x.stan === 'zarezerwowany');
    if (!prz.length) return { zwolniono: 0 };
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    let n = 0;
    for (const p of prz) {
      const pl = await repo.przydzial(p.id, true); if (!pl || pl.stan !== 'zarezerwowany') continue;
      const q = pl.ilosc - pl.ilosc_zuzyta; if (q <= 0) { await repo.aktualizujPrzydzial(pl.id, { stan: 'zuzyty' }); continue; }
      await repo.aktualizujPrzydzial(pl.id, { stan: 'zwolniony' });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod });
      n += q;
    }
    await domena.zapiszProjekcje(repo, [...new Set(prz.map(p => p.skladnik_id))]);
    return { zwolniono: n };
  },

  /** Fakt wykonania pozycji: R − q, U + q w jednej transakcji; realizacja z rzeczywistą datą; źródło sprawdzone ponownie (R2). */
  async wykonaj(repo, ctx, { pozycja_id, ilosc, wykonawca_fakt, data_fakt, powod, operacja_id }) {
    const prz = (await repo.przydzialyPozycji([Number(pozycja_id)])).filter(x => x.stan === 'zarezerwowany');
    if (!prz.length) return { zuzyto: 0, realizacje: [], bez_przydzialu: true };
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    const skl = await repo.skladniki([...new Set(prz.map(p => p.skladnik_id))], true);
    await domena.sprawdzZrodlaSkladnikow(repo, ctx, skl, { operacja: 'wykonanie' }); // fizyczny fakt bez prawidłowego źródła → „do wyjaśnienia” (ZK-05), nie fałszywe U
    const dostepne = prz.reduce((a, p) => a + (p.ilosc - p.ilosc_zuzyta), 0);
    let doZuzycia = ilosc == null ? dostepne : Number(ilosc);
    if (!Number.isInteger(doZuzycia) || doZuzycia <= 0) throw new BladDomeny('Liczba wykonanych jednostek musi być dodatnią liczbą całkowitą.');
    if (doZuzycia > dostepne) throw new BladDomeny(`Ta pozycja ma ${dostepne} zarezerwowane jednostki — nie można wykonać ${doZuzycia}.`, { code: 'PONAD_PRZYDZIAL' });
    const dataF = data_fakt || ctx.teraz; if (dataF > ctx.teraz) throw new BladDomeny('Nie zapisujemy przyszłego wykonania.');
    for (const s of skl) { const waz = logika.waznosc(s, { data_waznosci: s.data_waznosci }); if (waz && dataF.slice(0, 10) > waz) throw new BladDomeny(`Pakiet „${s.zakup_nazwa || ''}” był ważny do ${waz} — wykonanie z datą ${dataF.slice(0, 10)} wymaga uzgodnienia (przedłużenie albo rozliczenie do wyjaśnienia).`, { code: 'WAZNOSC' }); }
    const realizacje = []; let zuzyto = 0;
    for (const p of prz) {
      if (doZuzycia <= 0) break;
      const pl = await repo.przydzial(p.id, true); if (!pl || pl.stan !== 'zarezerwowany') throw new BladDomeny('Przydział został w międzyczasie zmieniony. Sprawdź aktualny stan wizyty.', { code: 'STAN' });
      const q = Math.min(doZuzycia, pl.ilosc - pl.ilosc_zuzyta); if (q <= 0) continue;
      const rid = await repo.wstawRealizacje({ pozycja_id: Number(pozycja_id), przydzial_id: pl.id, skladnik_id: pl.skladnik_id, ilosc: q, wykonawca_fakt, data_fakt: dataF, zapisal: ctx.autor, zapisal_id: ctx.autor_id, cykl: pl.cykl, operacja_id, powod });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: pl.id, realizacja_id: rid, operacja_id, data_zdarzenia: dataF, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'wykonanie' });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'U', kierunek: 1, ilosc: q, przydzial_id: pl.id, realizacja_id: rid, operacja_id, data_zdarzenia: dataF, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'wykonanie' });
      const nowaZuzyta = pl.ilosc_zuzyta + q;
      await repo.aktualizujPrzydzial(pl.id, { ilosc_zuzyta: nowaZuzyta, stan: nowaZuzyta >= pl.ilosc ? 'zuzyty' : 'zarezerwowany' });
      realizacje.push({ id: rid, przydzial_id: pl.id, skladnik_id: pl.skladnik_id, ilosc: q }); zuzyto += q; doZuzycia -= q;
    }
    await repo.aktualizujPozycje(Number(pozycja_id), { wykonanie_data_fakt: dataF, wykonanie_zapisal: ctx.autor });
    await domena.zapiszProjekcje(repo, [...new Set(prz.map(p => p.skladnik_id))]);
    return { zuzyto, realizacje, nierozstrzygniete: dostepne - zuzyto };
  },

  /** Potrącenie jednostki z aktywnego przydziału (osobna decyzja, reguła salonu): R − q, F + q; U bez zmian. Źródło sprawdzone ponownie. */
  async potrac(repo, ctx, { pozycja_id, ilosc = 1, powod, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    if (!powod) throw new BladDomeny('Potrącenie wymaga powodu.');
    const prz = (await repo.przydzialyPozycji([Number(pozycja_id)])).filter(x => x.stan === 'zarezerwowany');
    let q = Number(ilosc); if (!Number.isInteger(q) || q <= 0) throw new BladDomeny('Nieprawidłowa liczba jednostek.');
    const dostepne = prz.reduce((a, p) => a + (p.ilosc - p.ilosc_zuzyta), 0);
    if (q > dostepne) throw new BladDomeny(dostepne ? `Do potrącenia dostępne ${dostepne}.` : 'Jednostka została już zwolniona — potrącenie wymagałoby ponownego sprawdzenia wolnej puli; nie zabieramy jednostki innej wizycie.', { code: 'BRAK_PRZYDZIALU' });
    await domena.sprawdzZrodlaSkladnikow(repo, ctx, await repo.skladniki([...new Set(prz.map(p => p.skladnik_id))], true), { operacja: 'potrącenie' });
    let n = 0;
    for (const p of prz) { if (q <= 0) break; const pl = await repo.przydzial(p.id, true); const k = Math.min(q, pl.ilosc - pl.ilosc_zuzyta); if (k <= 0) continue;
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'R', kierunek: -1, ilosc: k, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'potrącenie: ' + powod });
      await repo.wstawRuch({ skladnik_id: pl.skladnik_id, typ: 'F', kierunek: 1, ilosc: k, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'potrącenie: ' + powod });
      await repo.aktualizujPrzydzial(pl.id, { stan: 'potracony' }); q -= k; n += k; }
    await domena.zapiszProjekcje(repo, [...new Set(prz.map(p => p.skladnik_id))]);
    return { potracono: n };
  },

  /** Wycofanie q wolnych jednostek (zwrot/korekta ilości): W + q; wymaga B ≥ q. zakres 'wszystkie_niewykorzystane' zwalnia też aktywne przydziały (wizyty pozostają do wyjaśnienia). */
  async wycofaj(repo, ctx, { skladnik_id, ilosc, zakres = 'wolne', powod, operacja_id }) {
    domena.wymagajTryb(ctx, new Set(['aktywna', 'konczenie', 'uzgadnianie', 'wstrzymana']));
    if (!powod) throw new BladDomeny('Wycofanie wymaga powodu.');
    const [s] = await repo.skladniki([Number(skladnik_id)], true); if (!s) throw new BladDomeny('Nie znaleziono składnika.');
    let saldo = (await domena.saldoSkladnikow(repo, [s.id]))[s.id];
    const zwolnione = [];
    if (zakres === 'wszystkie_niewykorzystane') {
      for (const p of await repo.aktywnePrzydzialySkladnika(s.id)) { const q = p.ilosc - p.ilosc_zuzyta; if (q <= 0) continue; await repo.aktualizujPrzydzial(p.id, { stan: 'zwolniony' }); await repo.wstawRuch({ skladnik_id: s.id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: p.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'wycofanie uprawnień: ' + powod }); await repo.aktualizujPozycje(p.pozycja_id, { rozliczenie: 'do_wyjasnienia' }); zwolnione.push(p.pozycja_id); }
      saldo = (await domena.saldoSkladnikow(repo, [s.id]))[s.id];
    }
    const q = ilosc == null ? saldo.B : Number(ilosc);
    if (!Number.isInteger(q) || q < 0) throw new BladDomeny('Nieprawidłowa liczba jednostek.');
    if (q > saldo.B) throw new BladDomeny(`Wolnych jednostek jest ${saldo.B}, nie można wycofać ${q}${saldo.R ? ` (umówione: ${saldo.R} — najpierw uzgodnij zależne wizyty)` : ''}.`, { code: 'BRAK_WOLNYCH' });
    if (q > 0) await repo.wstawRuch({ skladnik_id: s.id, typ: 'W', kierunek: 1, ilosc: q, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod });
    const po = await domena.zapiszProjekcje(repo, [s.id]);
    return { wycofano: q, zwolnione_pozycje: zwolnione, saldo: po[s.id] };
  },

  /** Korekta błędnego wykonania (manager): odwrócenie realizacji (U − q). wynik: 'odbedzie_sie' (R + q, nowy cykl, po sprawdzeniu źródła i ważności) | 'nie_odbedzie_sie'. */
  async odwrocRealizacje(repo, ctx, { realizacja_id, wynik, powod, data, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    if (!powod) throw new BladDomeny('Korekta wykonania wymaga powodu.');
    if (!['odbedzie_sie', 'nie_odbedzie_sie'].includes(wynik)) throw new BladDomeny('Wskaż rzeczywisty rezultat korekty.');
    const r = await repo.realizacja(Number(realizacja_id), true); if (!r) throw new BladDomeny('Nie znaleziono realizacji.');
    if (r.stan === 'odwrocona') throw new BladDomeny('Ta realizacja została już skorygowana — powtórzenie korekty nie oddaje kolejnej jednostki.', { code: 'JUZ_ODWROCONA' });
    const ruchy = await repo.ruchy([r.skladnik_id]); const ruchU = ruchy.find(x => x.realizacja_id === r.id && x.typ === 'U' && x.kierunek === 1);
    if (!ruchU) throw new BladDomeny('Brak ruchu wykorzystania dla tej realizacji — niespójność, wymaga sprawdzenia.', { code: 'NIESPOJNY' });
    const [s] = await repo.skladniki([r.skladnik_id], true);
    const saldo = logika.saldo(ruchy);
    const wycofanoCalosc = saldo.W > 0 && saldo.G - saldo.U - saldo.F - saldo.W <= 0 && saldo.R === 0;
    if (!wycofanoCalosc) await domena.sprawdzZrodlaSkladnikow(repo, ctx, [s], { operacja: 'korekta' }); // R2: źródło sprawdzane PRZED jakimkolwiek zapisem (także dla „nie odbędzie się” — bez nieuprawnionej wolnej jednostki)
    const odwrId = await repo.wstawRuch({ skladnik_id: r.skladnik_id, typ: 'U', kierunek: -1, ilosc: r.ilosc, realizacja_id: r.id, przydzial_id: r.przydzial_id, operacja_id, odwraca_id: ruchU.id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'korekta wykonania: ' + powod });
    await repo.aktualizujRealizacje(r.id, { stan: 'odwrocona', odwrocona_przez: odwrId });
    let nowyPrzydzial = null;
    if (wycofanoCalosc) {
      await repo.wstawRuch({ skladnik_id: r.skladnik_id, typ: 'W', kierunek: 1, ilosc: r.ilosc, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'korekta po wycofaniu puli: jednostka wraca jako wycofana, nie wolna' });
    } else if (wynik === 'odbedzie_sie') {
      const zakup = { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci, kwalifikacja: s.kwalifikacja };
      const powodN = logika.powodNiedostepnosci(s, zakup, logika.saldo(await repo.ruchy([s.id])), data || ctx.teraz.slice(0, 10), ctx.tryb === 'konczenie' ? 'aktywna' : ctx.tryb);
      if (powodN) throw new BladDomeny(`Jednostka wraca do historii, ale nie można odtworzyć rezerwacji: ${powodN}. Pozycja pozostaje do rozstrzygnięcia.`, { code: 'NIEDOSTEPNY', powod: powodN });
      const stary = r.przydzial_id ? await repo.przydzial(r.przydzial_id) : null;
      const pid = await repo.wstawPrzydzial({ pozycja_id: r.pozycja_id, skladnik_id: r.skladnik_id, ilosc: r.ilosc, cykl: (stary ? stary.cykl : r.cykl) + 1, operacja_id });
      await repo.wstawRuch({ skladnik_id: r.skladnik_id, typ: 'R', kierunek: 1, ilosc: r.ilosc, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'korekta wykonania — zabieg nadal ma się odbyć' });
      if (r.pozycja_id) await repo.aktualizujPozycje(r.pozycja_id, { stan: 'zaplanowana', zakup_skladnik_id: r.skladnik_id, wykonanie_data_fakt: null, wykonanie_zapisal: null });
      nowyPrzydzial = pid;
    } else if (r.pozycja_id) {
      await repo.aktualizujPozycje(r.pozycja_id, { stan: 'niewykonana', wykonanie_data_fakt: null, wykonanie_zapisal: null });
    }
    const po = await domena.zapiszProjekcje(repo, [r.skladnik_id]);
    return { odwrocono: r.ilosc, nowy_przydzial_id: nowyPrzydzial, saldo: po[r.skladnik_id], do_wycofanych: wycofanoCalosc };
  },

  /** Atomowa zmiana źródła przydziału: R − q w starym, R + q w nowym (po pełnej walidacji nowego, z kontrolą źródła); błąd = brak zmiany. */
  async przenies(repo, ctx, { przydzial_id, nowy_skladnik_id, id_klienta, data, powod, operacja_id }) {
    domena.wymagajTryb(ctx, TRYBY_MUTACJE);
    const pl = await repo.przydzial(Number(przydzial_id), true); if (!pl || pl.stan !== 'zarezerwowany') throw new BladDomeny('Przydział nie jest aktywny — nie można zmienić źródła.', { code: 'STAN' });
    const q = pl.ilosc - pl.ilosc_zuzyta; if (q <= 0) throw new BladDomeny('Przydział jest już wykorzystany.');
    const [stary] = await repo.skladniki([pl.skladnik_id], true); const [nowy] = await repo.skladniki([Number(nowy_skladnik_id)], true);
    if (!nowy) throw new BladDomeny('Nie znaleziono nowego zakupu.'); if (nowy.id === stary.id) throw new BladDomeny('To ten sam zakup.');
    if (String(nowy.id_klienta || '') !== String(id_klienta || stary.id_klienta)) throw new BladDomeny('Nowy zakup należy do innej klientki.', { code: 'WLASCICIEL' });
    if (String(nowy.usluga_wyk_id) !== String(stary.usluga_wyk_id)) throw new BladDomeny('Nowy zakup dotyczy innej usługi — nie zamieniamy A na B po cichu.', { code: 'INNY_WARIANT' });
    await domena.sprawdzZrodlaSkladnikow(repo, ctx, [nowy], { operacja: 'zmiana źródła' });
    const salda = await domena.saldoSkladnikow(repo, [nowy.id]);
    const powodN = logika.powodNiedostepnosci(nowy, { stan: nowy.zakup_stan, stan_zrodla: nowy.stan_zrodla, data_waznosci: nowy.data_waznosci, kwalifikacja: nowy.kwalifikacja }, salda[nowy.id], data, ctx.tryb === 'konczenie' ? 'aktywna' : ctx.tryb);
    if (powodN) throw new BladDomeny(`Nie zmieniono zakupu (${powodN}). Wizyta nadal korzysta z dotychczasowego pakietu.`, { code: 'NIEDOSTEPNY', powod: powodN });
    if (salda[nowy.id].B < q) throw new BladDomeny('Nie zmieniono zakupu — w nowym brakuje wolnych jednostek. Wizyta nadal korzysta z dotychczasowego pakietu.', { code: 'BRAK_JEDNOSTEK' });
    await repo.wstawRuch({ skladnik_id: stary.id, typ: 'R', kierunek: -1, ilosc: q, przydzial_id: pl.id, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'zmiana źródła: ' + (powod || '') });
    await repo.aktualizujPrzydzial(pl.id, { stan: 'zwolniony' });
    const pid = await repo.wstawPrzydzial({ pozycja_id: pl.pozycja_id, skladnik_id: nowy.id, ilosc: q, cykl: pl.cykl, operacja_id });
    await repo.wstawRuch({ skladnik_id: nowy.id, typ: 'R', kierunek: 1, ilosc: q, przydzial_id: pid, operacja_id, data_zdarzenia: ctx.teraz, kto: ctx.autor, kto_id: ctx.autor_id, powod: 'zmiana źródła: ' + (powod || '') });
    const aktywne = (await repo.przydzialyPozycji([pl.pozycja_id])).filter(x => x.stan === 'zarezerwowany');
    await repo.aktualizujPozycje(pl.pozycja_id, { zakup_skladnik_id: aktywne.length ? aktywne[0].skladnik_id : nowy.id });
    await domena.zapiszProjekcje(repo, [stary.id, nowy.id]);
    return { stary_przydzial_id: pl.id, nowy_przydzial_id: pid, ilosc: q };
  },

  /** Zmiana trybu ewidencji (manager). Przejście do „aktywna” po przerwie czyści znacznik przerwy (uzgodnienie jest jawną decyzją). */
  async ustawEwidencje(repo, ctx, { tryb, raport }) {
    if (!TRYBY.includes(tryb)) throw new BladDomeny('Nieznany tryb ewidencji.');
    const ew = { tryb: 'nie_uruchomiono', ...((await repo.ewidencja()) || {}) };
    const poprzedni = ew.przerwa_od ? 'uzgadnianie' : ew.tryb; // zapisany stan + przerwa = efektywnie „uzgadnianie”
    if (poprzedni === tryb && !ew.przerwa_od) return { tryb, powtorzenie: true };
    if (!logika.przejscieTrybu(poprzedni, tryb)) throw new BladDomeny(`Z trybu „${poprzedni}” nie można przejść do „${tryb}”.`, { code: 'PRZEJSCIE' });
    const pola = { tryb, zmienil: ctx.autor, zmieniono: ctx.teraz };
    if (tryb === 'aktywna' && !ew.rozpoczeto) pola.rozpoczeto = ctx.teraz;
    if (tryb === 'zakonczona') pola.zakonczono = ctx.teraz;
    if (tryb === 'uzgadnianie' || tryb === 'aktywna') pola.punkt_uzgodnienia = ctx.teraz;
    if (ew.przerwa_od && (tryb === 'aktywna' || tryb === 'konczenie')) pola.przerwa_od = null;
    if (raport) pola.raport_json = JSON.stringify(raport);
    await repo.zapiszEwidencje(pola);
    return { tryb, poprzedni, przerwa_zamknieta: !!(ew.przerwa_od && pola.przerwa_od === null) };
  },

  /** Walidacja przydziałów wizyty na NOWĄ datę (przesunięcie): ważność/zawieszenie/źródło; brak zmian liczników. */
  async sprawdzPrzeniesienie(repo, ctx, { pozycjaIds, data }) {
    const prz = (await repo.przydzialyPozycji(pozycjaIds)).filter(p => p.stan === 'zarezerwowany');
    if (!prz.length) return { ok: true, problemy: [] };
    domena.wymagajTryb(ctx, TRYBY_MUTACJE, 'Ewidencja zakupów jest wstrzymana — przełożenie wizyty z pakietu wymaga działającej ewidencji.');
    const ids = [...new Set(prz.map(p => p.skladnik_id))]; const skl = await repo.skladniki(ids, true); const salda = await domena.saldoSkladnikow(repo, ids);
    const problemy = [];
    for (const s of skl) {
      const zakup = { stan: s.zakup_stan, stan_zrodla: s.stan_zrodla, data_waznosci: s.data_waznosci, kwalifikacja: s.kwalifikacja };
      if (!s.zrodlo_typ || s.zrodlo_typ === 'sprzedaz') { const u = await domena.uzgodnijZrodlo(repo, ctx, { id: s.zakup_id, sprzedaz_id: s.sprzedaz_id, zrodlo_typ: 'sprzedaz', zrodlo_migawka_json: s.zrodlo_migawka_json, stan_zrodla: s.stan_zrodla }); zakup.stan_zrodla = u.stan_zrodla; }
      const powod = logika.powodNiedostepnosci(s, zakup, { ...salda[s.id], B: 1 }, data, 'aktywna'); // przydział już jest — nie wymagamy wolnej jednostki
      if (powod) problemy.push({ skladnik_id: s.id, opis: `Pakiet „${s.zakup_nazwa || ''}”: ${powod}` });
    }
    return { ok: !problemy.length, problemy };
  },

  /** Okresowe uzgadnianie (Z3-07): ponowny odczyt źródeł aktywnych zakupów; zwraca listę zmian do spraw. Bez tworzenia zakupów. */
  async uzgodnijOkresowo(repo, ctx, { limit = 200 } = {}) {
    const zak = await repo.zakupyDoUzgodnienia(limit); const zmiany = [];
    for (const z of zak) { if (z.stan_zrodla !== 'ok') continue; const u = await domena.uzgodnijZrodlo(repo, ctx, z); if (['istotna', 'usuniete', 'zwrot'].includes(u.zmiana)) zmiany.push({ zakup_id: z.id, id_klienta: z.id_klienta, nazwa: z.nazwa, zmiana: u.zmiana, stan_zrodla: u.stan_zrodla }); }
    return { sprawdzono: zak.length, zmiany };
  },
};

/** Widok zakupów klientki do UI (bez mutacji): składniki z saldem, powodami, przydziałami i czasem ostatniego sprawdzenia. */
async function widokZakupow(repo, ctx, { id_klienta, data, katalogNazwa }) {
  if (!id_klienta) return [];
  const zakupy = await repo.zakupyKlientki(id_klienta); if (!zakupy.length) return [];
  const skl = await repo.skladnikiZakupow(zakupy.map(z => z.id));
  const salda = await domena.saldoSkladnikow(repo, skl.map(s => s.id));
  const dzien = data || ctx.teraz.slice(0, 10);
  return zakupy.map(z => {
    const sk = skl.filter(s => s.zakup_id === z.id).map(s => {
      const sa = salda[s.id]; const powod = logika.powodNiedostepnosci(s, z, sa, dzien, ctx.tryb);
      return { id: s.id, usluga_wyk_id: s.usluga_wyk_id, usluga_nazwa: s.usluga_nazwa || (katalogNazwa ? katalogNazwa(s.usluga_wyk_id) : String(s.usluga_wyk_id)), jednostka_miary: s.jednostka_miary || 'sesja', jednostki_na_pozycje: s.jednostki_na_pozycje || 1,
        stan: s.stan, stan_weryfikacji: s.stan_weryfikacji, uruchomiony: !!(s.zalezne_uzgodniono && s.aktywny_od), ma_plan: !!s.plan_json && !s.aktywny_od, waznosc: logika.waznosc(s, z), zawieszono_do: s.zawieszono_do ? String(s.zawieszono_do).slice(0, 10) : null,
        hist: { wykorzystane: s.hist_wykorzystane, wycofane: s.hist_wycofane, potracone: s.hist_potracone, zrodlo_ustalen: s.zrodlo_ustalen, zweryfikowal: s.zweryfikowal, zweryfikowano: s.zweryfikowano ? String(s.zweryfikowano).slice(0, 19) : null },
        przyznane: sa.G, wycofane: sa.W, potracone: sa.F, wykorzystane: sa.U, wykorzystane_historycznie: sa.U_hist, umowione: sa.R, pozostalo: sa.L, do_umowienia: s.stan_weryfikacji === 'zweryfikowany' ? Math.max(0, sa.B) : null,
        niespojny: sa.niespojny, dostepny: !powod, powod: powod || null,
        wykonane: sa.U, zaplanowane: sa.R, wolne: powod ? 0 : sa.B, historyczne: sa.U_hist }; // pola zgodności ze starym UI
    });
    const zwer = sk.filter(s => s.stan_weryfikacji === 'zweryfikowany').length;
    const weryfikacja = !sk.length ? 'brak_skladnikow' : zwer === sk.length ? 'zweryfikowany' : zwer ? 'czesciowo' : 'niezweryfikowany';
    const wyk = sk.every(s => s.pozostalo === 0 && s.przyznane > 0 && s.wycofane === 0 && s.potracone === 0) ? 'w_calosci_wykorzystany' : sk.some(s => s.wykorzystane > 0) ? 'czesciowo_wykorzystany' : sk.some(s => s.pozostalo === 0 && (s.wycofane || s.potracone)) ? 'brak_dostepnych_sprawdz_powody' : 'do_wykorzystania';
    let zrodla = []; try { zrodla = z.zrodla_json ? JSON.parse(z.zrodla_json) : []; } catch (e) { zrodla = []; }
    return { id: z.id, sprzedaz_id: z.sprzedaz_id, zrodlo_typ: z.zrodlo_typ || 'sprzedaz', zrodla_powiazane: zrodla, nazwa: z.nazwa, data_zakupu: z.data_zakupu ? String(z.data_zakupu).slice(0, 10) : null, data_waznosci: z.data_waznosci ? String(z.data_waznosci).slice(0, 10) : null,
      stan: z.stan, stan_zrodla: z.stan_zrodla || 'ok', kwalifikacja: z.kwalifikacja || null, oferta_wersja_id: z.oferta_wersja_id || null, zrodlo_sprawdzono: z.zrodlo_sprawdzono ? String(z.zrodlo_sprawdzono).slice(0, 19) : null, weryfikacja, wykorzystanie: wyk,
      bilans_status: weryfikacja === 'zweryfikowany' ? 'zweryfikowany' : 'niezweryfikowany', skladniki: sk };
  });
}

module.exports = { logika, domena, repoSql, widokZakupow, SCHEMAT_V2, ELEMENTY_V2, TABELE_V1, WERSJA_SCHEMATU_V2, oczekiwaneKolumny, stanSchematu, sprawdzSchematV2, migrujV2, BladDomeny, TRYBY, TRYBY_MUTACJE, TRYBY_NOWE_PRZYDZIALY, RODZAJE_OFERTY, KWALIFIKACJE, DECYZJE_WIZYT };
