# ZAKUPY_03 — kontrakt źródeł (adapter Sprzedaż → ewidencja jednostek)

**Data:** 16.10.2026 · **Kod:** `routes/terminarz-zakupy.js` (`logika.kandydatNaZakup`, `logika.powiazaneDoplaty`, `logika.wersjaDlaDaty`, `logika.klasyfikuj`, `logika.porownajZrodlo`, `repoSql.zrodloSprzedaz`) · **Commit:** `0edfec5`
**Testy kontraktu:** `tests/terminarz-zakupy-zk03.test.js` (opis Z3-01, mock) oraz `narzedzia/testy-integracyjne/terminarz-zakupy-zk03.js` (rzeczywista MariaDB 11.8.9, wyniki w `po10/wynik-terminarz-zakupy-zk03.json`).

Dokument opisuje, **co dodatek czyta z rdzenia, jak to interpretuje i czego nie robi**. Rdzeń (Sprzedaż, Klientki, portfel, zadatki) nie jest zmieniany. Wszystkie relacje i migawki są danymi dodatku (`Term_Zakupy.zrodlo_*`, `zrodla_json`, `zwroty_suma`, `stan_zrodla`).

## 1. Co jest czytane z rdzenia

| Źródło | Kolumny używane | Po co |
|---|---|---|
| `Sprzedaz` (wiersz kanoniczny) | `id, status, id_klienta, zabieg, szczegoly, kategoria_produktu, kwota, data_sprzedazy, data_waznosci, karnet_zamkniety_w, grupa_id, zwrot_do_id` | tożsamość zakupu, właściciel, nazwa i wariant oferty, data do wyboru wersji, ważność |
| `Sprzedaz` (cały paragon) | `id = <baza>` lub `id LIKE '<baza>-%'`, bez `USUNIĘTY` | wiersze „Dopłata” i powielone pozycje tej samej oferty |
| `Sprzedaz` (zwroty) | `zwrot_do_id IN (kanon + kandydatki dopłat)`, `SUM(ABS(kwota))` | suma zwrotów per wiersz finansujący |
| `Uslugi` | `id, kategoria, wariant, cena, waznosc_dni` | dopasowanie tekstowe „zabieg + wariant” → pozycja cennika |
| `Term_Oferty`, `Term_Oferty_Wersje`, `Term_Oferty_Skladniki` | wersje składu (dodatek) | skład i rodzaj oferty obowiązujący w dacie sprzedaży |

Identyfikator źródła to **ID wiersza kanonicznego Sprzedaży** (`Term_Zakupy.sprzedaz_id`, UNIQUE w salonie razem z `tenant_id`). Baza paragonu = część ID przed ostatnim `-n` (`logika.bazaParagonu`). Wszystkie zapytania ograniczają się do `tenant_id` z sesji.

Odczyt w transakcji dodatku (rezerwacja, wykonanie, potrącenie, korekta, zmiana źródła, uruchomienie) używa `LOCK IN SHARE MODE` na wierszu kanonicznym. Poza transakcją (podgląd, lista, uzgadnianie) — zwykły `SELECT`.

## 2. Klasyfikacja wiersza (Z3-01, `logika.klasyfikuj`)

Kolejność rozstrzygania (pierwsza pasująca reguła wygrywa):

| # | Warunek na wierszu | Kategoria | Rodzaj / powód | Jednostki |
|---|---|---|---|---|
| 1 | zakup już istnieje w `Term_Zakupy` dla tego `sprzedaz_id` | `istniejace` albo `zmienione` | porównanie migawki (§5): `brak`/`opisowa` → istniejące; `istotna`/`zwrot`/`usuniete` → zmienione | bez zmian G |
| 2 | `status <> 'AKTYWNY'` | `pominiete` | usunięty | 0 |
| 3 | `kategoria_produktu` niepuste | `pominiete` | produkt | 0 |
| 4 | `zwrot_do_id` albo `zabieg` zaczyna się od `ZWROT:` | `pominiete` | wiersz zwrotu | 0 |
| 5 | `kwota < 0` | `pominiete` | kwota ujemna | 0 |
| 6 | `zabieg` kończy się słowem `Dopłata` | `pominiete` | wiersz dopłaty (część płatności, nie oferta) | 0 |
| 7 | brak `id_klienta` | `wymaga_rozstrzygniecia` | brak ID klientki — wymaga jawnego powiązania; podpowiedź po nazwie nie jest dopasowaniem | 0 |
| 8 | pusta nazwa usługi | `pominiete` | brak nazwy usługi | 0 |
| 9 | brak pozycji w `Uslugi` dla pary (zabieg, wariant bez sufiksu rabatu) | `wymaga_mapowania` | zmieniona nazwa albo usunięta usługa | 0 |
| 10 | usługa bez żadnej wersji składu / bez wersji zatwierdzonej | `wymaga_mapowania` | oferta bez zatwierdzonego składu | 0 |
| 11 | sprzedaż sprzed pierwszej zatwierdzonej wersji | `wymaga_rozstrzygniecia` | manager wskazuje jawnie wersję (`wersje_do_wyboru`) | 0 do czasu wskazania |
| 12 | dwie zatwierdzone wersje obowiązywały w dniu sprzedaży (data bez godziny) | `wymaga_rozstrzygniecia` | nie zgadujemy wersji (`wersje_do_wyboru`) | 0 do czasu wskazania |
| 13 | wersja rodzaju `nie_ewidencjonuj` (zwykłe „1x”) | `pominiete` | sprzedaż dokumentuje wykonany zabieg albo inny zapis | 0 |
| 14 | wersja rodzaju `nieobslugiwany` (abonament/czas/rodzinny) | `pominiete` | kalendarz działa bez licznika | 0 |
| 15 | dopłata niejednoznaczna (§4) | `wymaga_rozstrzygniecia` | manager wskazuje powiązanie jawnie (`powiazane` w żądaniu rejestracji) | skład znany, rejestracja wstrzymana |
| 16 | wersja `pakiet` | `gotowe` | kwalifikacja `pakiet`; stan początkowy **do sprawdzenia** | składniki wersji × 1 egzemplarz |
| 17 | wersja `pojedynczy_z_gory` | `gotowe` | kwalifikacja `do_sprawdzenia` — potwierdzenie per zakup | 1 składnik × 1 jednostka po potwierdzeniu |
| 18 | `kwota = 0` przy wersji `pakiet` | `gotowe` | powód: „wpis za 0 zł — prawo wymaga potwierdzenia stanu, nie wynika z ceny” | jak 16, bez automatycznego zera wykorzystania |

Reguły niezmienne:

- **Żaden parser tekstu nie tworzy jednostek.** Liczba z nazwy wariantu („5x”, „5 ×”, „2 przyłożenia”) jest tylko podpowiedzią w edytorze składu (`pewna:false`, etykieta „z nazwy: N … — sprawdź … i zatwierdź”, `routes/terminarz.js` ok. linii 724). Jednostki pochodzą wyłącznie z zatwierdzonej wersji składu.
- **Rejestracja nigdy nie ustawia wykorzystania historycznego.** Każdy składnik powstaje jako `niezweryfikowany`; puste pola weryfikacji oznaczają „nie wiem”, nie zero (Z3-04). Dotyczy to również sprzedaży z dzisiejszą datą wpisanej z opóźnieniem i importu po przerwie (Z3-T27).
- **Portfel, sam zadatek, bon kwotowy** nie mają wiersza oferty w `Sprzedaz` z nazwą usługi, więc nie są kandydatami (nie ma czego klasyfikować). Komunikat UI: „Środki w portfelu nie są liczbą zabiegów.”

## 3. Powielone wiersze i `grupa_id`

Rdzeń zapisuje dwa egzemplarze tej samej oferty jako **dwa wiersze** `<baza>-1`, `<baza>-2` (rozbijanie przy sprzedaży). Każdy wiersz = osobne źródło = osobny `Term_Zakupy` ze składnikami wersji. Suma dla „2 × (5A+4B)” = 10 A + 8 B. `grupa_id` nie jest ani trzecim źródłem, ani mnożnikiem — służy wyłącznie do przypisania dopłaty do właściwego egzemplarza (§4).

Dowód: Z3-T10 (mock + rzeczywista baza).

## 4. Rozbita sprzedaż: „Zadatek” + „Dopłata”

Sposób zapisu w rdzeniu (`public/index.html` ok. 21044, `routes/sprzedaz.js` ok. 692): dopłata ma `zabieg = "<nazwa matki> Dopłata"`, ten sam paragon, `grupa_id` odziedziczone po matce, własną kwotę. Kanoniczny wiersz (matka) ma kwotę części opłaconej z portfela/zadatku.

Kontrakt adaptera (`logika.powiazaneDoplaty`):

1. Jedna rozbita sprzedaż = najwyżej **jedno** źródło prawa (wiersz kanoniczny). Dopłata sama w sobie nigdy nie daje jednostek (reguła 6 w §2).
2. Powiązanie dopłat ustalane w paragonie: wiersze o nazwie `^<nazwa kanonu>\s+Dopłata$` (bez względu na wielkość liter).
3. Gdy w paragonie jest **jedna** pozycja tej oferty → wszystkie jej dopłaty są powiązane.
4. Gdy pozycji tej oferty (ta sama nazwa i wariant) jest **kilka**: dopłata przypisana po `grupa_id` równym `grupa_id` kanonu; jeśli kanon nie ma `grupa_id` albo przypisanie nie daje dokładnie jednego wiersza → `niejednoznaczne = true` → kategoria `wymaga_rozstrzygniecia`, lista `kandydatki`. Manager wskazuje powiązanie jawnie (`trm_zakupy_rejestruj` z polem `powiazane: [id…]`); wskazanie jest zapisywane w `Term_Zakupy.zrodla_json` i od tej chwili obowiązuje przy każdym sprawdzeniu.
5. Migawka źródła obejmuje kanon **i** każdy powiązany wiersz (id, status, kwota, suma zwrotów). Zmiana/usunięcie/zwrot któregokolwiek jest zmianą źródła tego zakupu (§5).
6. Przyznanie jednostek nie obciąża portfela, wykonanie nie tworzy sprzedaży ani wypłaty zadatku (dodatek nie pisze do `Sprzedaz`, `Zadatki`, `Platnosci` — K14).

Scenka kontrolna (Z3-T11/T12, mock + baza): pakiet 1000 zł = 200 zł z portfela (kanon `E-1`) + 800 zł dopłaty (`E-2`). Powstaje jeden zakup, składnik G=5. Zwrot 100 zł z `zwrot_do_id = E-2` → `porownajZrodlo` zwraca `zwrot`, zakup `stan_zrodla = wycofane`, sprawa E20; **kwota nie jest przeliczana na sesje** — zakres ustala manager.

## 5. Migawka i wykrywanie zmian (`logika.migawkaZrodla`, `logika.porownajZrodlo`)

Migawka (`zrodlo_migawka_json`, skrót w `zrodlo_hash`): pola kanonu z §1 + `zwroty_suma` + lista `powiazane[{id, status, kwota, zwroty_suma}]`.

| Wynik | Kiedy | Skutek |
|---|---|---|
| `brak` | identyczne | nic |
| `opisowa` | tylko `kwota`, `data_sprzedazy`, `grupa_id` albo kwota dopłaty | zapis nowej migawki, operacje dozwolone |
| `istotna` | `id_klienta`, `zabieg`, `szczegoly`, `kategoria_produktu`, `data_waznosci`, `karnet_zamkniety_w`, `zwrot_do_id`, zmiana zestawu/statusu powiązanych | zakup `zmienione`, sprawa E20, operacje jednostkowe odrzucone |
| `zwrot` | zmiana sumy zwrotów kanonu **lub** dowolnej powiązanej dopłaty | zakup `wycofane`, sprawa E20, operacje odrzucone |
| `usuniete` | brak wiersza albo `status <> AKTYWNY` | zakup `usuniete`, sprawa E20, operacje odrzucone |

Zmiana właściciela (`id_klienta`) jest `istotna`: nic nie jest przenoszone między klientkami, zakup czeka na wyjaśnienie.

Kiedy sprawdzane (R2): przed rezerwacją, wykonaniem, potrąceniem, korektą/odwróceniem, zmianą źródła i uruchomieniem składnika — wewnątrz transakcji, po ponownym odczycie z blokadą współdzieloną; dodatkowo okresowo (`uzgodnijOkresowo`, co 5. tick = co 5 minut, dla salonów w trybie `aktywna`/`konczenie`) i na żądanie (`trm_zakupy_uzgodnij`, idempotentne). Granica (Z3-T02b, §7 raportu): nowy wiersz zwrotu wstawiony w oknie między odczytem a COMMIT dodatku nie jest blokowany — wykrywany przy następnym sprawdzeniu.

## 6. Wersje składu i „1×”

- Oferta = usługa z cennika; skład to **lista wierszy** (usługa wykonywana, jednostka miary, jednostek w jednym egzemplarzu, jednostek na pozycję w kalendarzu). Dwa wiersze tej samej usługi z innymi warunkami pozostają osobne.
- Zapis tworzy nową wersję tylko gdy skład albo rodzaj się różni; identyczny zapis zwraca tę samą wersję (Z3-T09b). Poprzednia wersja dostaje `obowiazuje_do = NOW()`, nowa `obowiazuje_od = NOW()` (klasyfikacja porównuje z dokładnością do dnia). Istniejące zakupy trzymają swoją `wersja_id` — nic nie jest przeliczane.
- Wersja dla sprzedaży: dzień `data_sprzedazy` zawiera się w `[obowiazuje_od, obowiazuje_do]`. Dwie wersje tego samego dnia → rozstrzygnięcie (reguła 12). Sprzedaż sprzed pierwszej wersji → rozstrzygnięcie (reguła 11).
- Rodzaje: `pakiet` (jednostki na przyszłość), `pojedynczy_z_gory` (dokładnie 1 składnik × 1 jednostka, kwalifikacja per zakup), `nie_ewidencjonuj` (zwykłe „1x”, domyślne dla ofert bez pakietu), `nieobslugiwany`.
- Jawna kwalifikacja (`trm_zakup_kwalifikuj`): `pakiet` / `pojedynczy_z_gory` / `nie_ewidencjonuj`. Powtórzenie nie zwiększa G (Z3-T14). Kwalifikacja nie „otwiera” innych sprzedaży tej usługi — dotyczy jednego `sprzedaz_id`.

## 7. Przykłady wejście → wynik (dane fikcyjne, zestaw demo `narzedzia/testy-integracyjne/dane-demo.js`)

| Wejście (`Sprzedaz`) | Wynik klasyfikacji |
|---|---|
| `DEMO-A-1`: „Endermologia / 10x”, klientka 1001, 1700 zł | `gotowe`, pakiet, wersja 1, składnik Endermologia G=10, stan do sprawdzenia |
| `DEMO-B-1`, `DEMO-B-2`: 2 × „Pakiet łączony / 5 × endermologia + 4 × Meltivio”, ta sama `grupa_id` | 2 × `gotowe`; każdy: Endermologia G=5, Meltivio G=4; razem 10 A + 8 B |
| `DEMO-C-1`: „Endermologia / 1x” | `pominiete`, rodzaj `nie_ewidencjonuj` |
| `DEMO-C-2`: „Konsultacja / 1x z góry” (oferta `pojedynczy_z_gory`) | `gotowe`, kwalifikacja `do_sprawdzenia`; po potwierdzeniu 1 jednostka |
| `DEMO-E-1` (200 zł) + `DEMO-E-2` „Pakiet… Dopłata” (800 zł) | `E-1` → `gotowe` z `powiazane=[E-2]`; `E-2` → `pominiete` (dopłata) |
| zwrot `zwrot_do_id = DEMO-E-2`, −100 zł | przy następnym sprawdzeniu: `zmienione` / `zwrot`, zakup `wycofane`, sprawa E20 |
| „Krem X” (`kategoria_produktu` = kosmetyk) | `pominiete`, produkt |
| „Endermologia / 5x” bez `id_klienta` | `wymaga_rozstrzygniecia`, brak ID klientki |
| „Endermologia / 5x (-10%)” | sufiks rabatu usuwany przy dopasowaniu; wynik jak dla „5x” |
| sprzedaż 2026-01-10, pierwsza wersja składu od 2026-10-16 | `wymaga_rozstrzygniecia`, `wersje_do_wyboru` |
| wersja 1 `obowiazuje_do = 2026-10-16`, wersja 2 `obowiazuje_od = 2026-10-16`, sprzedaż 2026-10-16 | `wymaga_rozstrzygniecia` (dwie wersje tego dnia) |

## 8. Czego adapter nie robi

- Nie zapisuje do `Sprzedaz`, `Zadatki`, `Platnosci`, `Klienci`; nie zmienia `id_klienta`.
- Nie przelicza kwot na jednostki; nie dopisuje gratisów; nie uzupełnia zer wykorzystania.
- Nie dopasowuje po samej nazwie klientki (homonimy — Z3-T26: własność wyłącznie po `(tenant_id, id_klienta)`).
- Link płatności (`routes/zgody.js`, feature `platnosc_link`, pilot jednego salonu) zapisuje wyłącznie `ZgodyPlatnosci` i `TenantRegulaminy`; nie tworzy wiersza `Sprzedaz`. Sprzedaż usługi powstaje potem w rdzeniu jak każda inna, więc dla adaptera ta droga to **nie dotyczy** — klasyfikowany jest dopiero wynikowy wiersz `Sprzedaz`.
