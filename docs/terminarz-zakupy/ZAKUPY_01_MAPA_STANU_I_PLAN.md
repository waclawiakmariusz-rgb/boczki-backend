# ZAKUPY_01 — mapa stanu i plan: realizacja zakupionych zabiegów w Terminarzu

**Etap ZK-01 (rozpoznanie i zatwierdzenie kontraktów) · Claude Code · 16.10.2026 · kod: `dev` = `ce8230b`**

Dokument odpowiada na §3 i ZK-01 specyfikacji `Estelio_Terminarz_Realizacja_Zakupow_Specyfikacja_Claude_Code_v1_2026-10-16.md`. **W tym etapie nie zmieniono produktu, bazy ani ustawień salonów.** Integracja zakupów pozostaje wyłączona (zmienna `TERMINARZ_ZAKUPY_TENANTS` nie jest ustawiona w `.env` ani w `ecosystem.config.js`); żadne saldo nie zostało zmienione ani zaimportowane.

**Źródła:** kod repozytorium (odwołania `plik:linia` według `ce8230b`), schemat rzeczywistej bazy pobrany **jednym połączeniem tylko do odczytu** (`SHOW CREATE TABLE`, `COUNT(*)`, bez danych osobowych — skrypt i wynik: `po9/rozpoznanie-schemat.js`, `po9/rozpoznanie-schemat.json`), wcześniejsze raporty (`WYNIK_2`, odbiór iteracji 2 — C03/C04/C05, `WYNIK_8`). Tam, gdzie czegoś nie udało się ustalić, jest to napisane wprost.

---

## 0. Streszczenie (co z czego powstaje)

1. **Jednostka zabiegowa nie istnieje w rdzeniu.** `Sprzedaz` nie ma kolumn ilości, wykorzystania ani pozostałych zabiegów; „karnet” w rdzeniu to wiersz sprzedaży z `data_waznosci` i ręcznym „Zakończ” (`karnet_zamkniety_w`). Liczba zabiegów jest zakodowana **wyłącznie w tekście** wariantu cennika („5x”, „2x Przyłożenia”, „1 obszar 4x”). Jedyny licznik jednostek to dobudowany, wyłączony model T02/T03 w `routes/terminarz.js` — **to on będzie jedynym właścicielem salda** (brak konkurencyjnego mechanizmu w rdzeniu; §1 spec).
2. **Jeden wiersz `Sprzedaz` = jedna pozycja** paragonu (`<baza>-<nr>`), nie transakcja. Identyfikator pozycji jest stabilny i unikalny → nadaje się jako klucz źródła zakupu. Powielenie „× N” to N osobnych wierszy ze wspólnym `grupa_id`.
3. **Portfel = `Zadatki`** (wpłata, bon podarunkowy z flagą `bon`, zwroty, kary). To wyłącznie pieniądze z tekstowym `cel`. Sprzedaż „za Portfel” tworzy **normalny wiersz `Sprzedaz`** z `platnosc='Portfel'` i zdejmuje zadatek (FIFO). Dlatego: zakup pakietu opłacony z portfela jest już w `Sprzedaz` jako zwykła pozycja → **mapujemy wiersz `Sprzedaz`, nigdy wpłatę**. Sama wpłata z opisem „5 × endermologia” nie daje jednostek (D09, P10) — wymagana jest sprzedaż w rdzeniu (istniejący proces), która zużyje te środki raz.
4. **Rdzeń nie ma stanu „nieopłacone/szkic”.** Każdy zapisany wiersz `Sprzedaz` jest z punktu widzenia rdzenia rozliczony (MediRaty/TubaPay to metoda płatności, nie stan). Kwalifikacja finansowa sprowadza się więc do: `status='AKTYWNY'`, `kwota>0`, brak `zwrot_do_id`, brak późniejszego zwrotu, nie produkt, nie wiersz „Dopłata”.
5. **Do poprawy w T02/T03 (lista w §7):** 12 konkretnych rozbieżności ze specyfikacją, w tym C03/C04, `UNIQUE(pozycja, typ)` blokujący „wykonaj → cofnij → wykonaj”, brak W/F i brak odwróceń, przycinanie salda do zera, import jako skutek uboczny odczytu, brak weryfikacji ważności przy przesunięciu, operacje jednostkowe poza blokadą salonu, identyfikacja klientki po nazwie w zakupach bez `id_klienta`.
6. **Dane pilotażowe: brak.** `Term_Oferty`, `Term_Zakupy`, `Term_Zakupy_Skladniki`, `Term_Zakupy_Ruchy` mają 0 wierszy w całej bazie; `Term_Migracje` kompletne (7/7); `kontrola_zakupow='off'` w obu salonach z terminarzem. Nic do migrowania ze starego modelu — można zmienić schemat bez przenoszenia historii.
7. **Środowisko:** nadal brak odrębnej bazy testowej (to samo, co w `WYNIK_8` §B). Próby zapisujące jednostki w ZK-02+ wymagają jej utworzenia przez właściciela (hPanel) — bez niej wykonam tylko testy jednostkowe na mockach i podgląd; nie będę ćwiczył sald na wspólnej bazie.

---

## 1. Mapa obecnego systemu (§3.2)

Legenda kolumn: **Plik/moduł** · **Źródło danych** · **Obecne zachowanie** · **Konieczna zmiana** · **Wpływ na salon bez dodatku**.

### 1.1 Sprzedaż

| | |
|---|---|
| Plik/moduł | `routes/sprzedaz.js` (`add_sale` :470, `add_multi_sale` :567, `edit_sale` :797, `delete_sale` :972, `add_zwrot` :1037, `emergency_edit_sale` :1127, karnety :1251–1391); `public/index.html` kasa :20300–21100, historia profilu :16423–16600 |
| Źródło danych | Tabela `Sprzedaz` (DDL z bazy): `id VARCHAR(50) PK`, `tenant_id`, `data_sprzedazy`, `klient`, `zabieg` (=kategoria cennika), `szczegoly` (=wariant, czasem z sufiksem `[Rabat: …]` lub `N szt.`), `sprzedawca`, `kwota`, `komentarz`, `status` ('AKTYWNY'/'USUNIĘTY'), `platnosc`, `id_klienta`, `pracownik_dodajacy`, `id_zadatku` (lista ID zadatków), `czy_rozliczone`, `typ_zabiegu`, `kategoria_produktu` (Kosmetyk/Suplement/NULL), `data_waznosci`, `karnet_zamkniety_w/_przez`, `grupa_id`, `zwrot_do_id`, `zawieszenia_liczba`, `zawieszenia_dni_lacznie`, `utworzono_w`. **Brak:** `usluga_id`, `ilosc`, `updated_at`, `wersja`, statusu płatności. |
| Obecne zachowanie | `Sprzedaz.id` = **pozycja**: `uniqueIdBase + '-' + idx` (`sprzedaz.js:619`); w bazie 3867/3868 wierszy ma sufiks. Nagłówek paragonu istnieje tylko jako wspólny prefiks. Ilość: zabiegi powielane jako osobne wiersze z `grupa_id` (UI scala je do „× N”, `index.html:16483–16540`); kosmetyki jako tekst „N szt.” w `szczegoly`. Usługa dopasowywana do cennika **po tekstach** `TRIM(kategoria)=TRIM(zabieg)`, `TRIM(wariant)=TRIM(szczegoly bez sufiksu rabatu)` (`sprzedaz.js:536–539`). Usunięcie = soft-delete `status='USUNIĘTY'` (`:984`), zadatki wracają automatycznie (`:999–1012`). Zwrot = **nowy ujemny wiersz** z `zwrot_do_id`, `zabieg='ZWROT: …'`, datą dzisiejszą; częściowy dozwolony do sumy oryginału (`:1062–1070`); **oryginał nie jest zmieniany, karnet nie jest zamykany**. Edycja (`edit_sale`, `emergency_edit_sale`) nadpisuje pola bez wersji; ślad tylko tekstowo w `Logi`. |
| Konieczna zmiana | **Żadnej w `Sprzedaz`.** Dodatek czyta: `id` (klucz pozycji), `grupa_id`, `id_klienta`, `zabieg`/`szczegoly` (→ `Uslugi.id` przez istniejące dopasowanie tekstowe + `Term_Oferty`), `data_sprzedazy`, `data_waznosci`, `karnet_zamkniety_w`, `status`, `kwota`, `zwrot_do_id` (wiersze zwrotów wskazujące na zakup), `kategoria_produktu`. Dodatek przechowuje **migawkę pól istotnych + skrót** (`zrodlo_hash`) i porównuje przy każdym sprawdzeniu źródła (§4.3 spec: brak `updated_at`). |
| Wpływ bez dodatku | Zero. Sprzedaż nie wie o `Term_*`; nie dodajemy kolumn, kluczy obcych ani wywołań terminarza do `sprzedaz.js`. |

### 1.2 Katalog

| | |
|---|---|
| Plik/moduł | `routes/sprzedaz.js` (`sales_dictionary` :420, `add_sales_def` :1163, `edit_service` :1235, `delete_service` :1210), `routes/typy_zabiegow.js`, `routes/predef.js`; terminarz: `routes/terminarz.js` `uslugi()` :383–397, `trm_usluga_zapisz` :862–877 |
| Źródło danych | `Uslugi` (DDL): `id VARCHAR(36)` (UUID), `tenant_id`, `kategoria`, `wariant`, `cena`, `zrodlo`, `typ_zabiegu`, `waznosc_dni` (NULL = bezterminowo). `Term_Uslugi` (`usluga_id`=`Uslugi.id`, `czas_min`, bufory, zasoby, `aktywna`, `wersja`). `Typy_Zabiegow` = klasyfikator (ikona/kolor). |
| Obecne zachowanie | **Stabilne ID istnieje, ale rdzeń go nie używa**: słownik nie zwraca `id`, edycja/usunięcie idą po parze tekstów `(kategoria, wariant)` i zmiana nazwy zrywa powiązanie tekstowe ze starymi sprzedażami. **Usunięcie usługi to twardy `DELETE`** (`sprzedaz.js:1210`) — brak archiwizacji; osieroca `Term_Uslugi`/`Term_Oferty` (brak FK/kaskady). **Wariant = tekst**; „Endermologia / 40 min” i „/ 60 min” to dwa wiersze bez relacji. **Pakiet w katalogu = liczba w tekście wariantu** (769 z 1006 usług ma wzorzec `Nx`); brak pola „liczba zabiegów”, brak zestawów (A+B). Jedyne mapowanie oferta→składniki to `Term_Oferty`/`Term_Oferty_Skladniki` (dodatek), z propozycją z tekstu „4x” wyłącznie jako podpowiedź (`terminarz.js:643–650`). |
| Konieczna zmiana | W rdzeniu: **brak** (D12, §4.2.9). W dodatku: `Term_Oferty` dostaje **wersjonowanie** (`wersja`, `obowiazuje_od/do`, pełna lista składników per wersja, stan propozycja/zatwierdzona/wycofana) i **rodzaj oferty**: `pakiet` (N jednostek na przyszłość), `pojedynczy_z_gory` (1 jednostka), `nie_ewidencjonuj` (sprzedaż oznacza wykonany zabieg / produkt / inne). Składnik: `usluga_wyk_id` + `jednostki` + `jednostka_miary` ('sesja'; „przyłożenie” jako jawna decyzja mapowania). Twardy `DELETE` usługi w rdzeniu: dodatek zachowuje migawkę nazwy w zakupie (`Term_Zakupy.nazwa`, składnik `usluga_nazwa`) i oznacza składnik „usługa wycofana — do uzgodnienia” zamiast tracić historię (§6.2). |
| Wpływ bez dodatku | Zero; nie dodajemy pól do cennika. |

### 1.3 Własność (salon, klientka, placówka)

| | |
|---|---|
| Plik/moduł | `routes/klienci.js` (`generujNoweIdKlienta` :89, `edit_client_data` :635, `soft_delete_client` :938, `anonymize_client` :961, `mark_deceased` :1038, `restore_client` :1146); `routes/sessions.js`; `routes/terminarz.js` :1182–1189 |
| Źródło danych | `Klienci` (DDL): `id` (UUID, PK techniczny), **`id_klienta VARCHAR(50)` = klucz biznesowy** (liczby od 1001), `imie_nazwisko`, `telefon`, `status` ENUM('AKTYWNY','USUNIETY','ZANONIMIZOWANY'), `zmarly`, `ostrzezenie`, pola usunięcia. `Sprzedaz.id_klienta`, `Zadatki.id_klienta`, `Term_Rezerwacje.id_klienta`, `Term_Zakupy.id_klienta` wskazują `Klienci.id_klienta`. Salon = `tenant_id` w każdej tabeli; **placówek nie ma** (jeden salon = jeden tenant). |
| Obecne zachowanie | W bazie **0** sprzedaży bez `id_klienta` (`Sprzedaz_ksztalt.bez_id_klienta=0`). Zmiana nazwy nie przepisuje `Sprzedaz.klient` (inwariant „gdy znamy `id_klienta`, identyfikujemy po ID”, `klienci.js:336`). **Scalania duplikatów klientek nie ma** (tylko soft-delete z powodem „Duplikat”, bez przepisania historii). Anonimizacja: `imie_nazwisko='Klient #<id>'`, telefon/notatki NULL, saldo portfela wymaga decyzji. `EST-0113` to numer **wizyty** (`Term_Rezerwacje.id`), nie klientki. |
| Konieczna zmiana | Dodatek: klucz zakupu **wyłącznie `(tenant_id, id_klienta)`**; usunąć dopasowanie po nazwie z `Term_Zakupy` (`terminarz.js:695`, `1225`) i z importu (`:673`). Sprzedaż bez `id_klienta` → źródło „bez właściciela — do przypisania” (nie importować jako uprawnienie). Z12/Z09: scalenie nie istnieje w rdzeniu → **NIE DOTYCZY z dowodem** (brak ścieżki); przy wprowadzeniu scalania w przyszłości dodatek przepisze `id_klienta` w swoich tabelach jednym kontrolowanym krokiem. Anonimizacja: dodatek nie przechowuje danych osobowych poza `klient_nazwa` w `Term_Zakupy` — **usunąć tę kolumnę z nowego modelu** (nazwę brać z `Klienci` przy odczycie). Inna placówka: NIE DOTYCZY (brak modelu placówek). |
| Wpływ bez dodatku | Zero. |

### 1.4 Płatność

| | |
|---|---|
| Plik/moduł | `routes/sprzedaz.js` :586–608 (splity Mix), :741 (`get_sale_mix`), :1045 (metody zwrotu); `routes/analityka.js` :27–36, :322–342 (Portfel wyłączony z utargu) |
| Źródło danych | `Sprzedaz.platnosc` (dowolny tekst; w bazie: Karta 1839, Portfel 1031, Gotówka 465, Mix 194, Blik 110, NULL 104, MediRaty 54, TubaPay 33, Przelew 15, Booksy 12, TPay 9, „-” 2). `Platnosci` (DDL: `id`, `data_platnosci`, `klient`, `metoda_platnosci`, `kwota`, `status`) — **tylko splity Mix**, id `<baza>-SPLIT-<n>`, bez FK do sprzedaży. |
| Obecne zachowanie | **Nie istnieje stan „nieopłacone”, „szkic”, „link w toku”** — zapis sprzedaży jest równoznaczny z rozliczeniem. Raty (MediRaty) = metoda; rdzeń uznaje zakup za rozliczony w chwili zapisu. Zwrot = osobny ujemny wiersz (częściowy dopuszczalny). Anulowanie = soft-delete. |
| Konieczna zmiana | Kontrakt źródła: **zakup rozliczony ⇔ wiersz `Sprzedaz` AKTYWNY, `kwota>0`, bez `zwrot_do_id`**. Stany „niepotwierdzona płatność/częściowa wpłata” (P12) → **NIE DOTYCZY z dowodem**: rdzeń nie potrafi ich wyrazić; link TPay/Tpay tworzy sprzedaż dopiero po opłaceniu (do potwierdzenia w ZK-03 na kodzie `platnosc_link`, nie zakładam). Zwrot częściowy kwoty bez ilości → sprawa „zakres do ustalenia”, blokada nowych przypisań (Z03). Kwoty i metoda płatności **nie wchodzą do odpowiedzi dla ról bez praw finansowych** (Z12) — patrz §1.11. |
| Wpływ bez dodatku | Zero. |

### 1.5 Portfel

| | |
|---|---|
| Plik/moduł | `routes/klienci.js` (`manage_deposit` :701 — WPŁATA/EDIT_GOAL/KARA/ZWROT/USUN/EDIT_AMOUNT/EDIT_FULL/OZNACZ_BON/PRZEPISZ, `merge_deposits` :900, `get_wallet` :434); `routes/sprzedaz.js` `rozliczZadatekAutomatycznie` :303–369; `routes/ustawienia_zadatki.js` (kalkulator wysokości zadatku, nic nie zapisuje) |
| Źródło danych | `Zadatki` (DDL): `id`, `id_klienta`, `data_wplaty`, `klient`, `typ` ('WPŁATA'/'WYPŁATA'), `kwota`, `metoda`, `cel` (tekst), `status` (w bazie: AKTYWNY 120, WYKORZYSTANY 1093, PRZEPADŁ (KARA) 85, USUNIĘTY 17, ZWRÓCONY 11; w kodzie też 'SCALONY'), `pracownicy`, `czy_rozliczone`, `bon` (bon podarunkowy = zadatek kwotowy). |
| Obecne zachowanie | Portfel = suma WPŁATA+AKTYWNY. Przy sprzedaży „za Portfel” zadatek jest zużywany FIFO (całość → WYKORZYSTANY; część → reszta jako `DEP-REST-…`), a **w `Sprzedaz` powstaje zwykły wiersz pozycji** z `platnosc='Portfel'` i `id_zadatku`. Przewodnik z 08.06 (pakiet 5 × endermologia = wpłata 1500 zł, odejmowana kolejnymi sprzedażami „za Portfel”) opisuje więc proces, w którym **każdy kolejny zabieg jest osobną sprzedażą 1x za Portfel** — nie ma jednego wiersza „5x”. |
| Konieczna zmiana | **Nie budujemy konwersji portfel→jednostki w tym wdrożeniu** (§5.2 pkt 5: rdzeń nie ma wiarygodnej obsługi takiej konwersji z historią i korektą; byłby to osobny kontrakt finansowy). Zasady: (a) `Zadatki` nigdy nie są źródłem składnika; (b) w kreatorze przy klientce z saldem portfela i bez zakupów pokazujemy „To środki w portfelu, nie liczba zabiegów…” (§16.3) i przejście do Sprzedaży; (c) sprzedaż „za Portfel” jest zwykłym źródłem (jeśli oferta ma mapowanie typu `pakiet`), bo pieniądze zostały użyte raz w rdzeniu; (d) dla **starego portfela** klientki nic nie przeksięgowujemy — recepcja nadal sprzedaje kolejne 1x za Portfel jak dziś. P10 spełnione przez brak ścieżki. **Decyzja właściciela (§11, D-1)**: czy w ZK-03 pokazać w panelu profilu także saldo portfela obok uprawnień (tylko informacyjnie). |
| Wpływ bez dodatku | Zero. |

### 1.6 Dotychczasowa realizacja („wykorzystany”, „zamknięty”, „wizyta”)

| | |
|---|---|
| Plik/moduł | `routes/sprzedaz.js` :1251–1391 (`extend/suspend/suspend_all/close/reopen_karnet`), `routes/klienci.js` :254, :289, :492–521 (wygasające), `public/index.html` `renderKarnetInfo` :15630 |
| Źródło danych | `Sprzedaz.data_waznosci` (snapshot `data_sprzedazy + Uslugi.waznosc_dni`), `karnet_zamkniety_w/_przez`, `zawieszenia_*`, `grupa_id` (akcje działają na pojedynczy `id` albo całą grupę). |
| Obecne zachowanie | „Wykorzystany” w rdzeniu dotyczy **zadatków** (pieniędzy), nie zabiegów. „Zakończony” = ręczna flaga karnetu bez liczby; pomoc wprost mówi: „pojedynczy zabieg — klient mógł go wykorzystać w dniu zakupu, po prostu Zakończ”. „Wizyta” w rdzeniu nie istnieje; most E11 (`trm_rozlicz_start/powiaz`, `terminarz.js:1432–1470`) jedynie **powiązuje** wizytę ze sprzedażą zapisaną po kliknięciu „Rozlicz” (`Term_Rezerwacje.sprzedaz_id`, `Term_Pozycje.sprzedaz_id`). Liczbę wykonanych zabiegów zna tylko T02/T03 (puste tabele). |
| Konieczna zmiana | Flaga „karnet zakończony” **nie jest synchronizowana** z saldem (§7.4). Dodatek traktuje `karnet_zamkniety_w IS NOT NULL` jako powód niedostępności („zakończony w Sprzedaży”) z możliwością uzgodnienia — nie jako „wszystkie wykonane”. `data_waznosci` z rdzenia to ważność źródłowa; przedłużenie/zawieszenie w rdzeniu jest zmianą źródła wykrywaną przez porównanie pól (§12.2). Wykonanie zabiegu z pakietu **nie wywołuje `trm_rozlicz_*`** i nie tworzy wiersza `Sprzedaz` (D08). |
| Wpływ bez dodatku | Zero; akcje karnetów bez zmian. |

### 1.7 Zmiany źródła (edycja, zmiana klientki, zwrot, usunięcie, korekta ilości)

| | |
|---|---|
| Plik/moduł | `routes/sprzedaz.js` `edit_sale` :797–900 (bez wersji), `emergency_edit_sale` :1127, `delete_sale` :972, `add_zwrot` :1037; `routes/logi.js` (`Logi`: `id` UUID, `data_zdarzenia`, `pracownik`, `akcja`, `modul`, `opis` tekst; `GET get_system_logs` = 300 ostatnich, bez kursora) |
| Obecne zachowanie | **Brak wersji rekordów i strukturalnego dziennika zmian sprzedaży.** `Logi` zapisuje tekst „przed → po” bez `rekord_id`; nie da się odpytać „co się zmieniło od X” inaczej niż po `data_zdarzenia` (sekundowa rozdzielczość, bez tie-breakera). Zmiana klientki w sprzedaży = `edit_sale` nadpisuje `id_klienta`. Zmniejszenie ilości = `delete_sale` jednego z powielonych wierszy albo zwrot częściowy. |
| Konieczna zmiana | **Uzgadnianie przez porównanie pól** (§4.3), nie przez dziennik: `Term_Zakupy` przechowuje `zrodlo_hash` = skrót istotnych pól (`status`, `kwota`, `zabieg`, `szczegoly`, `id_klienta`, `data_sprzedazy`, `data_waznosci`, `karnet_zamkniety_w`, `grupa_id`, `kategoria_produktu`) oraz `zwroty_suma` (SUM ujemnych wierszy z `zwrot_do_id = id`). Kontrola: przy otwarciu karty klientki, **przed każdą mutacją jednostek (w transakcji)**, cyklicznie co 5 min dla salonów z aktywną ewidencją (istniejący `tickSprawy`, `terminarz.js:1626`), ręcznie „Odśwież zakupy”. Wykryta różnica → składniki zakupu `stan_zrodla='do_uzgodnienia'` + sprawa typu Z (nowy typ `E20`), bez automatycznych zmian U. Brak rekordu (`status='USUNIĘTY'` lub nieistniejący) = źródło usunięte (Z07). **Nie dodajemy synchronicznego wywołania terminarza do `sprzedaz.js`.** Ogólne wersjonowanie sprzedaży w rdzeniu: poza zakresem; wskazane jako przyszła poprawa niezależna od dodatku. |
| Wpływ bez dodatku | Zero. |

### 1.8 Terminarz (pozycje wielousługowe, wykonanie, anulacja, serie, import, przeciąganie, konflikt)

| | |
|---|---|
| Plik/moduł | `routes/terminarz.js`: tabele :55–343, `trm_zapisz` :1186–1253, `trm_zmien` :1254–1313, `trm_anuluj` :1314–1360, `trm_obecnosc` :1361–1393, `trm_pozycja_stan` :1394–1430, most E11 :1432–1470, sprawy :1471+; `routes/terminarz-silnik.js` (czysta logika zasobów, `sprawdzKomplet`, `szukajTerminy`); `public/terminarz.js` |
| Źródło danych | `Term_Rezerwacje` (klient, status, obecność, `wersja`, `klucz_idem` UNIQUE, `sprzedaz_id`), `Term_Pozycje` (1 usługa = 1 pozycja; `usluga_id`, `stan` zaplanowana/w_trakcie/wykonana/przerwana/anulowana/niewykonana/odmowa, `start_fakt/koniec_fakt/wykonawca_fakt`, `zakup_skladnik_id`, `sprzedaz_id`), `Term_Zajecia`, `Term_Historia` (`przed_json/po_json`), `Term_Sprawy*`. |
| Obecne zachowanie | Wielousługowość: tak (do 8 pozycji, każda własny stan). Zapis: `GET_LOCK('trm:'+tenant, 8)` na tym samym połączeniu, idempotencja po `klucz_idem` (ponowienie zwraca tę samą wizytę), kontrola zasobów i jednostek pod blokadą, `COMMIT` po wszystkim, `RELEASE_LOCK` w `finally` — **zgodne z §15.2** dla `trm_zapisz` i `trm_zmien`. Wykonanie: `trm_pozycja_stan` per pozycja, wykonawca z pola `d.wykonawca` (domyślnie osoba z sesji), `start_fakt=COALESCE(start_fakt, start)` (**planowana godzina podstawiana jako faktyczna** — §9.2.4 zabrania). Anulacja: per pozycja albo wszystkie zaplanowane; wykonanej części nie anuluje. Nieobecność: pozycje → `niewykonana`, zwolnienie jednostek. Przeciąganie: podgląd → `trm_zmien` z `potwierdz`, ponowne sprawdzenie pod blokadą, kontrola `wersja`. **Serii nie ma** (brak akcji; limitu brak → spec: domyślnie 20, maks. 50). Importu wizyt nie ma (Booksy = podgląd maili w innym module). Konflikty = `Term_Sprawy` (E02–E19). |
| Konieczna zmiana | Patrz §7 (lista rozbieżności T02/T03) i §8 (plan transakcji). Serie: nowa akcja `trm_zapisz_serie` (lista konkretnych terminów, całość albo zaznaczony podzbiór, zapotrzebowanie per składnik przed zapisem). |
| Wpływ bez dodatku | Zero (moduł i tak jest tylko dla salonów z włączonym `terminarz`). |

### 1.9 Istniejący model T02/T03

| | |
|---|---|
| Plik/moduł | `routes/terminarz.js` :205–301 (tabele), :638–705 (`propozycjaOferty`, `zatwierdzoneOferty`, `saldaSkladnikow`, `importujZakupy`, `zakupyKlientki`), :1066–1148 (akcje `trm_zakupy_klientki`, `trm_oferty_lista`, `trm_oferta_zapisz`, `trm_zakupy_import`, `trm_zakup_bilans`), ruchy w `trm_zapisz` :1210–1245, `trm_anuluj` :1336, `trm_obecnosc` :1377, `trm_pozycja_stan` :1416–1418; `public/terminarz.js` :670–745 (kreator), :1373–1418 (zakładka „Pakiety i zakupy”) |
| Źródło danych | `Term_Oferty` (UNIQUE `tenant, usluga_id`; `stan`, `zrodlo`), `Term_Oferty_Skladniki` (`usluga_wyk_id`, `jednostki`), `Term_Zakupy` (UNIQUE `tenant, sprzedaz_id`; `id_klienta`, `klient_nazwa`, `oferta_id`, `nazwa`, `data_zakupu`, `data_waznosci`, `stan` aktywny/zamkniety, `bilans_status` na poziomie **zakupu**), `Term_Zakupy_Skladniki` (`jednostki_przyznane`, `jednostki_historyczne`), `Term_Zakupy_Ruchy` (`typ` rezerwacja/zuzycie/zwolnienie/korekta, **UNIQUE `tenant, pozycja_id, typ`**), `Term_Pozycje.zakup_skladnik_id`, `Term_Ustawienia.kontrola_zakupow`, `Term_Migracje`. |
| Obecne zachowanie | Które naprawdę używane: **żadne na danych** (0 wierszy we wszystkich czterech tabelach zakupów; `Term_Migracje` 7/7 obecne; `kontrola_zakupow='off'` dla `boczki-salon-glowny-001` i `demo-estelio`). Kod przetestowany w `WYNIK_2` na danych demo, potem wyczyszczony. Saldo = `przyznane − historyczne − wykonane − zarezerwowane`, przycinane `Math.max(0, …)`. Import leniwy w **odczycie** `trm_zakupy_klientki` (`:1075`). Zakup = 1 wiersz `Sprzedaz` → 1 `Term_Zakupy` → składniki wg mapowania; ilość z `grupa_id` nie jest mnożona (każdy powielony wiersz to osobny zakup — to poprawne). |
| Konieczna zmiana | Zestawienie „zostaje / do poprawy” w §7. |
| Wpływ bez dodatku | Tabele istnieją w bazie dla wszystkich (wspólne, z `tenant_id`), ale **bez wpisu salonu w `TERMINARZ_ZAKUPY_TENANTS` nic ich nie czyta ani nie zapisuje** (`zakupyAktywne`, `terminarz.js:301`; `trm_zakupy_klientki` zwraca `integracja:'off'` bez importu, `:1069`; `trm_zapisz` odrzuca `zakup_skladnik_id`, `:1214`). |

### 1.10 Aktywacja (`TERMINARZ_ZAKUPY_TENANTS`, `zakupy_integracja`, `kontrola_zakupow`, licencja dodatku)

| | |
|---|---|
| Plik/moduł | `routes/features.js` (`Features_Catalog`, `Tenant_Features`, `toggle_feature` manager+, cache 5 min, `makeHasFeature`), `routes/terminarz.js` :23 (`FEATURE_KEY='terminarz'`), :301, :345–348 (seed katalogu, 0 zł), :351, :372–375, :770, :791–798, :825–826; `public/terminarz.js` :45, :671, :703, :1363 |
| Obecne zachowanie | Cztery warstwy: (1) **licencja dodatku** `Tenant_Features(terminarz).enabled=1` — włącza manager w Dodatkach; każda akcja poza `trm_init` → `code:'DODATEK'` bez niej; (2) **lista techniczna** `TERMINARZ_ZAKUPY_TENANTS` (env, czytana tylko w `terminarz.js:301`) — bez wpisu `zakupy_integracja='off'`, UI zakupów ukryte, akcje `trm_oferty_*`/`trm_zakupy_import`/`trm_zakup_bilans` odmawiają; (3) **schemat** `schemat.gotowy` (Term_Migracje) — brak elementu wyłącza integrację; (4) **`kontrola_zakupow`** per salon — jedyne znaczenie: przy `on` każda pozycja wizyty musi mieć zakup (`:1215`), przy `off` można umówić pojedynczy zabieg z cennika. Nie ma stanu „ewidencja aktywna / przygotowanie / kończenie / wstrzymana / zakończona” (§14.1). |
| Konieczna zmiana | Rozdzielić trzy decyzje (§14.1 akapit): **dostęp do dodatku** (jak dziś: licencja + lista techniczna), **aktywność ewidencji** (nowe: `Term_Ewidencja` per salon — tryb `nie_uruchomiono / przygotowanie / aktywna / konczenie / wstrzymana / zakonczona / uzgadnianie`, `rozpoczeto`, `punkt_uzgodnienia`, `zakonczono`, autor; przełącza manager), **dopuszczenie usługi bez zakupu** (nowe: `Term_Uslugi.wymaga_zakupu` 0/1 + globalny domyślny `Term_Ustawienia.kontrola_zakupow` jako wartość początkowa przy aktywacji, przeglądana przez managera). `kontrola_zakupow='off'` **nie wyłącza ewidencji** (§4.2.8): wizyty z przydziałem nadal rezerwują i rozliczają. Mutacje jednostek dozwolone tylko w trybach `aktywna` (wszystkie) i `konczenie` (bez nowych przydziałów); w `przygotowanie` tylko propozycje bez R. |
| Wpływ bez dodatku | Zero; wartości domyślne = jak dziś (`nie_uruchomiono`). |

### 1.11 Bezpieczeństwo (sesja PIN, rola, salon)

| | |
|---|---|
| Plik/moduł | `routes/sessions.js` (`Sesje`: token, tenant_id, login, expires; TTL 8 h; `deleteSessionsFor`), `routes/users.js` (`verify_pin`, `wymagajZarzadzania`), `routes/terminarz.js` :355–360 (`rola()` z `Użytkownicy` przy każdym żądaniu), :776–789 (tożsamość `TOZSAMOSC`, wymóg `PIN`), :706–713 (`maskuj` — cena NULL dla specjalisty przy cudzych wizytach), `server.js` :703–714 (`validateTenantAccess`, `ENFORCE_SESSION`) |
| Obecne zachowanie | Autor = `sesja.login` (verify_pin), rola dociągana z bazy przy każdym żądaniu (zmiana roli/wylogowanie działają od następnego zapisu — zgodne z §18.1). `tenant_id` z treści musi zgadzać się z sesją (`validateTenantAccess`). Role w kodzie: `recepcja`, `kosmetolog`, `pracownik`, `praktykantka`, `manager`, `admin`, `megaadmin`. **Osobnego prawa „finanse/widzi kwoty” nie ma**; na froncie nieznana rola = pełny dostęp z ostrzeżeniem (`index.html:12587`). Pole `d.pracownik` nadal przyjmowane, ale sprawdzane z sesją. |
| Konieczna zmiana | Autor operacji jednostkowych **wyłącznie z sesji** (nie z `d.pracownik`, nie z `d.wykonawca` bez walidacji, że to pracownik salonu). Minimalna macierz §18.1 na obecnych rolach: potwierdzenie wykonania — `kosmetolog/pracownik` własne pozycje, `recepcja` tylko gdy `Term_Ustawienia.recepcja_potwierdza_wykonanie=1` (nowe, domyślnie 0; „osobne istniejące uprawnienie” nie istnieje, więc tworzymy jawny przełącznik salonu), `manager+` wszystko; stan początkowy, korekty, mapowania, aktywacja, potrącenia, gratis, wykonanie poza terminarzem — `manager+`. Kwoty/metody: odpowiedzi list zakupów **bez `kwota`/`platnosc`** dla `ROLE_SPECJALISTA`/`praktykantka`; dla `recepcja` i `manager+` jak dziś (brak odrębnego prawa). Nieznana rola → **brak dostępu do mutacji jednostek** (serwer). |
| Wpływ bez dodatku | Zero. |

### 1.12 Transakcje

| | |
|---|---|
| Fakt | Jedna baza MariaDB 11.8 (`u393261461_systemb`), jeden proces Node (`ecosystem.config.js: instances: 1`), pula `mysql2`; `Sprzedaz`, `Term_Pozycje`, `Term_Zakupy_Ruchy` w tej samej bazie → **mogą być w jednej transakcji** i pod jednym `GET_LOCK`. `GET_LOCK` jest blokadą po stronie serwera MySQL — działa też przy wielu procesach, o ile każdy używa tego samego klucza `trm:<tenant>` (dziś tak). Sprawdzenie własności: `GET_LOCK` i `RELEASE_LOCK` na **tym samym połączeniu** (`conn` z puli, `terminarz.js:1198/1252`) — poprawnie. |
| Luka | `trm_anuluj`, `trm_obecnosc`, `trm_pozycja_stan`, `trm_zakup_bilans` **nie biorą `GET_LOCK`** — zwolnienie/zużycie/korekta mogą przeplatać się z `trm_zapisz` innego stanowiska (A02, A01 dla zwolnień). Walidacja sald w `trm_zapisz` odbywa się pod blokadą, ale **przed `begin()`** — poprawne tylko dlatego, że wszyscy piszący trzymają blokadę; po dodaniu ścieżek bez blokady przestaje być poprawne. |
| Zmiana | Jedna wspólna funkcja `wTransakcjiSalonu(tenant, fn)`: `GET_LOCK` → `BEGIN` → `fn(conn)` (odczyt źródła `Sprzedaz … FOR SHARE`, odczyt składników `FOR UPDATE`, przeliczenie B dla **pełnej listy pozycji**, zapisy, wynik operacji) → `COMMIT` → `RELEASE_LOCK` w `finally` → dopiero potem sprawy/powiadomienia. Wszystkie mutacje jednostek przez nią (§8). |

### 1.13 Środowisko

| | |
|---|---|
| Fakt | Serwer dev i produkcja czytają **tę samą bazę** (potwierdzone `SELECT DATABASE()` w rozpoznaniu: `u393261461_systemb`, limit 500 połączeń/h). `.env.test.example` i `narzedzia/kopia-tenanta.js` gotowe (`WYNIK_8` §B); **baza testowa nie istnieje** — wymaga hPanel (właściciel). Adres `dev.estelio.com.pl` nie dowodzi izolacji danych. |
| Konsekwencja | ZK-02: testy niezmienników na **mockach/jednostkowe** (`tests/terminarz-zakupy.test.js`, bez bazy) + odczyt schematu; **próby zapisujące jednostki na rzeczywistej bazie dopiero po utworzeniu bazy testowej**. Na wspólnej bazie wykonam w ZK-02 jedynie bezpieczne operacje: `CREATE TABLE IF NOT EXISTS`/`ALTER … ADD COLUMN` nowego schematu nastąpią przy starcie serwera dev (idempotentne, bez danych) — to już dziś standard modułu. |

---

## 2. Rzeczywiste znaczenie rekordów sprzedaży i portfela

| Rekord | Znaczenie w rdzeniu | Dla dodatku |
|---|---|---|
| `Sprzedaz` `<baza>-<n>`, `kategoria_produktu IS NULL`, `kwota>0`, `zwrot_do_id IS NULL`, `zabieg` bez „ZWROT:”, `szczegoly` nie kończy się na „Dopłata” | Sprzedana **jedna pozycja usługowa** (oferta cennika) — pakiet „5x” albo pojedynczy zabieg „1x”. Rdzeń nie rozróżnia „na przyszłość” od „właśnie wykonano”. | Kandydat na zakup. Klasyfikacja zależy od **rodzaju zatwierdzonej oferty** (§3). |
| `Sprzedaz` z `grupa_id` (N wierszy) | N sztuk tej samej oferty (przycisk „Duplikuj”). | N osobnych zakupów o tym samym składzie (P08: 2 × (5A+4B) → 10 A + 8 B, bez dodatkowej puli z nagłówka). Akcje karnetowe rdzenia na `grupa_id` dotykają wszystkich — dodatek traktuje każdy wiersz osobno, ale zmianę ważności wykrywa na każdym. |
| `Sprzedaz` „… Dopłata” (`platnosc` ≠ Portfel) obok pozycji „Zadatek” | Rozbicie jednej usługi na część z portfela i dopłatę (front dzieli na 2 wiersze; `sprzedaz.js:692–714`). | Wiersz „Dopłata” **nie jest ofertą** — pomijany; uprawnienie daje tylko wiersz siostrzany. |
| `Sprzedaz` z `kategoria_produktu` | Kosmetyk/suplement. | Nigdy nie daje jednostek (P11). |
| `Sprzedaz` z `kwota<0` / `zwrot_do_id` | Zwrot pełny/częściowy do wskazanej pozycji; oryginał nietknięty. | Zdarzenie źródła dla zakupu `zwrot_do_id`: suma zwrotów ≥ kwota → pełne unieważnienie wolnych/zarezerwowanych (W), wykonania zostają; częściowy → sprawa „zakres do ustalenia”, blokada nowych przypisań (Z02/Z03). Nigdy nie przelicza złotówek na sesje. |
| `Sprzedaz.status='USUNIĘTY'` | Soft-delete (pomyłka). | Źródło usunięte (Z07): historia zostaje, nowe użycia zablokowane, sprawa. |
| `Sprzedaz.platnosc='Portfel'`, `id_zadatku` | Zapłacono ze środków wcześniej wpłaconych. | Równoważne z opłaceniem; nie potrącamy portfela drugi raz (pieniądze już zdjęte w rdzeniu). |
| `Sprzedaz.data_waznosci`, `karnet_zamkniety_w` | Ważność snapshotowana z cennika; ręczne „Zakończ”. | Ważność źródła; „Zakończ” = powód niedostępności, nie wykonanie. |
| `Zadatki` WPŁATA/AKTYWNY (także `bon=1`) | Wolne środki klientki. | **Pieniądze**, nigdy jednostki (D09). |
| `Zadatki` WYKORZYSTANY | Środki zużyte w sprzedaży. | Bez znaczenia dla salda jednostek. |
| `Zadatki` z `cel` „5 × endermologia” | Tekst informacyjny. | Nie tworzy pakietu; w UI komunikat o portfelu (§16.3). |

---

## 3. Lista obsługiwanych typów źródeł (pierwsze wydanie)

| Źródło (§5.1) | Stan w kodzie/danych | Obsługa w tym wdrożeniu |
|---|---|---|
| Opłacony zakup N × usługa | wiersz `Sprzedaz` z ofertą „Nx” (np. „5x”, „10x”, „4x przyłożenia”) | **TAK** — po zatwierdzeniu mapowania `pakiet` (składniki); stan początkowy wg §13 |
| Zakup 5 × A + 4 × B | w cenniku brak zestawów; może istnieć jako jedna oferta o nazwie opisowej | **TAK** — mapowanie wielowierszowe (C03) na jednej ofercie cennika |
| Dwa zakupy tej samej usługi | dwa wiersze `Sprzedaz` (różne `id`) | **TAK** — osobne `Term_Zakupy`, wybór źródła, FEFO |
| Jednorazowy zabieg kupiony z góry | wiersz „1x”; w praktyce Boczki często zapisywany **w dniu wykonania** (pomoc: „mógł być wykorzystany w dniu zakupu”) | **Warunkowo** — tylko dla ofert jawnie oznaczonych `pojedynczy_z_gory`; domyślnie oferty „1x” = `nie_ewidencjonuj` (**decyzja D-2**, §11) |
| Wpis sprzedaży zabiegu wykonanego wcześniej | nieodróżnialny od zakupu na przyszłość w rdzeniu | **Nie tworzy jednostki**; przy ofercie `pakiet` i dacie sprzedaży ≤ punkt odcięcia → składnik „do weryfikacji” |
| Pakiet opisany tylko nazwą | propozycja z tekstu (`propozycjaOferty`) | **Tylko propozycja** do zatwierdzenia (jak dziś) |
| Wpłata do portfela, zadatek, bon kwotowy | `Zadatki` (bon = `bon=1`) | **Nie** (pieniądze); komunikat + droga do Sprzedaży |
| Voucher na konkretną usługę | **nie istnieje w rdzeniu** (jedyne „vouchery” to kody rabatowe abonamentu w `Kody_rabatowe`) | **NIE DOTYCZY z dowodem** (brak instrumentu) |
| Produkt detaliczny | `kategoria_produktu` | **Nie** |
| Pakiet ratalny | MediRaty/TubaPay = metoda, rdzeń uznaje zakup za rozliczony | **TAK, jak zwykły zakup** (stan rdzenia), bez proporcji |
| Gratis / rekompensata | brak w rdzeniu | **TAK** — nowe źródło `przyznane` (manager, powód, usługa, ilość, ważność), bez wiersza `Sprzedaz` |
| Abonament bez limitu, minutowy, rodzinny | brak w rdzeniu | **Nie** — oferta oznaczana `nie_ewidencjonuj` z typem „nieobsługiwany”; zwykły kalendarz działa |
| Nagroda lojalnościowa (Klub) | `routes/lojalnosc.js`: nagrody/kody, bez jednostek zabiegowych | **Poza zakresem pierwszego wydania** — osobny kontrakt po stronie Klubu; brak podwójnego naliczania, bo wykonanie nie tworzy `Sprzedaz` (§6 raportu lojalności) |

---

## 4. Model tożsamości pozycji i jednostek

| Obiekt | Klucz | Uwagi |
|---|---|---|
| Salon | `tenant_id` | we wszystkich kluczach, unikalnościach i zapytaniach |
| Klientka | `(tenant_id, Klienci.id_klienta)` | nazwa nigdy nie jest kluczem; sprzedaż bez `id_klienta` → „bez właściciela” |
| Usługa wykonywana | `Uslugi.id` (UUID) | tak jak `Term_Uslugi.usluga_id`; nazwę migawkujemy w zakupie |
| Oferta sprzedażowa | `Uslugi.id` wiersza cennika + **wersja mapowania** `Term_Oferty_Wersje.id` | sprzedaż → oferta przez istniejące dopasowanie tekstowe (`zabieg`,`szczegoly` bez sufiksu rabatu); brak dopasowania = „bez mapowania” |
| Zakup (źródło) | `(tenant_id, zrodlo_typ, zrodlo_id)`, gdzie dla sprzedaży `zrodlo_id = Sprzedaz.id` (pozycja), dla gratisu `zrodlo_id = Term_Zakupy.id` własny | UNIQUE → idempotentny import; `grupa_id` i baza paragonu tylko informacyjnie |
| Składnik zakupu | `Term_Zakupy_Skladniki.id` | własna weryfikacja, własna ważność/zawieszenie, własny hash źródła |
| Pozycja wizyty | `Term_Pozycje.id` + `Term_Rezerwacje.wersja` | zapotrzebowanie `jednostki_wymagane` (domyślnie 1; >1 tylko przez jawny wariant mapowania) |
| Przydział | `Term_Przydzialy.id` (pozycja, składnik, ilość, cykl, aktywny) | kilka przydziałów na pozycję dopuszczalne (P14); zastępuje jedno pole `Term_Pozycje.zakup_skladnik_id` (pole zostaje jako NULL-owalny alias pierwszego aktywnego przydziału dla zgodności odczytów) |
| Realizacja | `Term_Realizacje.id` (pozycja, ilość, wykonawca, data faktyczna, kto zapisał, cykl) | nigdy nie usuwana; korekta = odwrócenie |
| Ruch | `Term_Zakupy_Ruchy.id` (składnik, typ G/W/U/F/R±, ilość, operacja, przydział/realizacja, odwraca_id) | **bez** `UNIQUE(pozycja, typ)`; idempotencja przez operację + stan domeny |
| Operacja | `Term_Operacje.klucz` UNIQUE per salon (rodzaj, autor z sesji, skrót żądania, wynik, ID obiektów) | ten sam klucz z innym skrótem = błąd (A07) |

Jednostka = całe sesje zdefiniowane przez ofertę. „2 przyłożenia” rozstrzyga mapowanie (`jednostka_miary` + `jednostki_na_pozycje`), nie tekst.

---

## 5. Obecne flagi (stan faktyczny w bazie i w konfiguracji)

| Flaga | Gdzie | Stan |
|---|---|---|
| `Tenant_Features.terminarz` | baza (6 wierszy `Tenant_Features` ogółem; nie odczytałem rozkładu per salon — nie było potrzebne) | wizyty istnieją dla `demo-estelio` (247) i `boczki-salon-glowny-001` (6) — dodatek był włączany co najmniej w tych dwóch |
| `TERMINARZ_ZAKUPY_TENANTS` | `.env` lokalny: **brak**; `ecosystem.config.js`: brak; serwery dev/prod: nie sprawdzałem (brak dostępu), `kontrola-dev.js` z `WYNIK_8` pokazał `zakupy_integracja=off` na dev | integracja wyłączona |
| `Term_Ustawienia.kontrola_zakupow` | baza | `off` / `off` |
| `Term_Migracje` | baza | 7/7 `obecna=1`, wersja `2026-10-15`, sprawdzono 2026-10-16 |
| `schemat.gotowy` | pamięć procesu (4 s po starcie) | `true` na dev (`WYNIK_8`) |

## 6. Znane dane pilotażowe

`Term_Oferty` 0 · `Term_Oferty_Skladniki` 0 · `Term_Zakupy` 0 · `Term_Zakupy_Skladniki` 0 · `Term_Zakupy_Ruchy` 0 · `Term_Pozycje` z `zakup_skladnik_id` 0 (cała baza). **Nie ma żadnej istniejącej historii jednostek do zachowania** — zmiana schematu w ZK-02 nie wymaga przenoszenia danych; tabele i kolumna zostają (nic nie kasujemy), nowe elementy dochodzą obok.

---

## 7. T02/T03 — co zostaje, co trzeba poprawić

### 7.1 Zostaje (zgodne ze spec)
- Rozdzielenie trzech znaczeń: usługa wykonywana / oferta cennika / zakup klientki (`terminarz.js:205–207`).
- Propozycja mapowania z tekstu wyłącznie jako podpowiedź, zatwierdzenie przez managera.
- Import idempotentny po `sprzedaz_id` (UNIQUE), bez zmian w `Sprzedaz`; filtr `kategoria_produktu IS NULL`, `status='AKTYWNY'`.
- `trm_zapisz`: blokada salonu + idempotencja `klucz_idem` + walidacja (właściciel, stan, ważność na datę wizyty, zgodność usługi, wolne) + przeliczenie **wszystkich pozycji formularza** (`wTejWizycie`) + rezerwacja w tej samej transakcji.
- Zwolnienie przy anulacji/nieobecności/niewykonaniu bez wykonania; wykonanie zużywa dokładnie raz; nieobecność nie zużywa.
- Bramkowanie env + schemat (`Term_Migracje`), brak importu przy wyłączonej integracji.
- UI: zakupy klientki nad cennikiem, „Z pakietu”, zakładka „Pakiety i zakupy”, chmurka z pigułką.

### 7.2 Do poprawy (rozbieżność → najmniejsza konieczna zmiana)

| # | Rozbieżność (gdzie) | Reguła spec | Zmiana |
|---|---|---|---|
| 1 | **C03** — edytor oferty pokazuje/zapisuje 1 składnik (`public/terminarz.js:1392`, `1409`) | §3.3, UX09 | wielowierszowy edytor (dodaj/usuń wiersz), zapis pełnej listy; podgląd wpływu; wersjonowanie |
| 2 | **C04** — `bilans_status` na zakupie; `trm_zakup_bilans` oznacza cały zakup `zweryfikowany` po dowolnym podzbiorze składników (`:1142`); `trm_zapisz` ignoruje `bilans_status` (`:1218–1231`) | §3.3, §7.1, §13.2 | `stan_weryfikacji` per składnik + jawne zero; stan rodzica wyliczany; **serwer odrzuca rezerwację z niezweryfikowanego składnika** |
| 3 | `UNIQUE uq_poz_typ (pozycja_id, typ)` w `Term_Zakupy_Ruchy` (`:266`) + `INSERT IGNORE` | §7.3, R14 | nowa tabela ruchów bez tego klucza; idempotencja przez `Term_Operacje` + stan przydziału; cykle realizacji |
| 4 | Brak W (wycofane), F (potrącone), odwróceń; saldo z 3 typów (`saldaSkladnikow` :657–667) | §7.1 | jedno wyliczenie G/W/U/F/R/L/B z ruchów ze znakiem i `odwraca_id` |
| 5 | `wolne: Math.max(0, …)` (`:701`) maskuje ujemne | §7.1 niezmienniki | brak przycięcia; `L<0` lub `B<0` → składnik `niespojny` + sprawa, blokada użycia |
| 6 | `trm_zakupy_klientki` wykonuje import (mutację) w odczycie (`:1075`) | §5.4, §15.1 | osobna idempotentna akcja `trm_zakupy_uzgodnij` (rejestracja źródła); lista bez mutacji; UI wywołuje uzgodnienie przy otwarciu karty i „Odśwież zakupy” |
| 7 | `trm_zmien` nie sprawdza ważności/stanu źródła dla nowej daty i nie dotyka przydziałów (`:1254–1313`) | §10.1, U08 | w transakcji przełożenia: walidacja składników przydziałów na nowy dzień + aktualny hash źródła; odmowa zachowuje starą wizytę |
| 8 | `trm_anuluj`, `trm_obecnosc`, `trm_pozycja_stan`, `trm_zakup_bilans` bez `GET_LOCK` (`:1328`, `:1368`, `:1407`, `:1130`) | §15.2, A02 | wszystkie mutacje przez `wTransakcjiSalonu` |
| 9 | `przerwana` → automatyczne `zuzycie` (`:1417`) | §9.3, R07 | przerwana = pozycja nierozstrzygnięta; zużycie tylko jawną decyzją (0/1, manager + powód przy nietypowej) |
| 10 | `start_fakt = COALESCE(start_fakt, start)` przy wykonaniu (`:1413`) | §9.2.4 | data wykonania = moment potwierdzenia albo jawnie wskazana (uprawnienie + powód); planowana godzina nie jest dowodem |
| 11 | Klientka po nazwie gdy brak `id_klienta` (`:673`, `:695`, `:1225`); `klient_nazwa` w `Term_Zakupy` | §6.1, Z08 | tylko `id_klienta`; `klient_nazwa` usunięta z nowego modelu; sprzedaż bez ID → „bez właściciela” |
| 12 | Jedno pole `Term_Pozycje.zakup_skladnik_id`, 1 jednostka na pozycję | §6.1, P14, R04 | `Term_Przydzialy` (wiele na pozycję, ilość), `jednostki_wymagane` na pozycji; stare pole = alias |
| 13 | Brak serii, brak kopii/ponownego umówienia z walidacją salda (brak akcji) | §10.2, U12, U15–U17 | `trm_zapisz_serie` (całość albo zaznaczony podzbiór, limit 20/50); kopia = nowy zapis bez kopiowania przydziałów |
| 14 | Brak wykrywania zmian źródła (`Term_Zakupy` to migawka bez hash) | §4.3, §12 | `zrodlo_hash`, `zrodlo_sprawdzono`, `zwroty_suma`; uzgadnianie w 4 momentach; sprawy Z |
| 15 | Jeden przełącznik `kontrola_zakupow`; brak stanu ewidencji; brak flagi per usługa | §4.2.8, §8.4, §14.1 | `Term_Ewidencja`, `Term_Uslugi.wymaga_zakupu`, rozdzielone decyzje |
| 16 | Kwoty (`cena`) w odpowiedziach zakupów/pozycji niezależnie od roli poza `maskuj` wizyt | Z12, §18.1 | filtr pól finansowych per rola w odczytach zakupów |
| 17 | Brak panelu w profilu klientki (UX08), brak historii ruchów w UI (UX12), brak korekt (§9.5), brak „poza terminarzem” (§11.2), brak potrąceń (§9.4) | — | nowe akcje i widoki (ZK-05/ZK-06) |
| 18 | Testy T03 z `WYNIK_2` zakładały `wolne:10` przed weryfikacją i zaliczały A04–A10 jednym opisem | §20.9, C05 | nowa macierz testów per scenariusz; stare oczekiwania nieważne |

Nie wykryto w T02/T03 niczego, co trzeba by **migrować** — tabele puste. `Term_Pozycje.zakup_skladnik_id` i `Term_Ustawienia.kontrola_zakupow` zostają (NULL/`off`).

---

## 8. Plan transakcji (kontrakt spójności)

Wspólna funkcja domenowa (§15.1) w nowym module `routes/terminarz-zakupy.js` (adapter źródeł + saldo + operacje), wołana z `routes/terminarz.js`:

```
operacjaJednostkowa({ tenant, klucz, rodzaj, autorZSesji, zadanie }):
 1. sesja/rola/salon (router) → tryb ewidencji (Term_Ewidencja) → dozwolone rodzaje dla trybu
 2. Term_Operacje: SELECT po (tenant, klucz) — jest i skrót równy → zwróć zapisany wynik;
    jest i skrót inny → błąd A07; brak → kontynuuj
 3. GET_LOCK('trm:'+tenant, 8) na conn → BEGIN
 4. odczyt źródeł: Sprzedaz (pozycje zakupów) … FOR SHARE + SUM zwrotów; porównanie z zrodlo_hash
    → różnica = składnik do_uzgodnienia → operacja odrzucona (formularz zachowany, sprawa Z)
 5. odczyt składników FOR UPDATE, wyliczenie G/W/U/F/R/B z Term_Zakupy_Ruchy (w transakcji)
 6. pełna lista pozycji/przydziałów żądania → walidacja zasobów (silnik) i jednostek razem
 7. zapisy: pozycje, przydziały, realizacje, ruchy (ze znakiem, odwraca_id), wersje, Term_Operacje(wynik, ID)
 8. COMMIT → RELEASE_LOCK (finally, także po błędzie → ROLLBACK)
 9. po commit: Term_Sprawy/powiadomienia (idempotentne po kluczu zdarzenia), odpowiedź = stan z serwera
```

Ponowienie po utracie odpowiedzi: ten sam `klucz` (UI przechowuje go w szkicu do czasu odpowiedzi) → krok 2 zwraca istniejący wynik (A05). Awaria przed commit: nic nie zostaje (A06). Projekcja salda (`Term_Zakupy_Skladniki.saldo_json`) aktualizowana w tej samej transakcji i **odtwarzalna** z ruchów (A14: test porównuje).

---

## 9. Plan migracji schematu (ZK-02, wersja `2026-10-17`)

Zasady: tylko `CREATE TABLE IF NOT EXISTS` / `ALTER … ADD COLUMN` (idempotentne, jak dziś), rejestr w `Term_Migracje`, **żadnych `DROP`/`DELETE`**, stare kolumny zostają NULL-owalne. Odwracalność = kod starszej wersji ignoruje nowe tabele; dane nie giną.

| Element | Zawartość |
|---|---|
| `Term_Oferty` + nowa `Term_Oferty_Wersje` | wersja, `rodzaj` (pakiet/pojedynczy_z_gory/nie_ewidencjonuj/nieobslugiwany), `obowiazuje_od`, `obowiazuje_do`, autor; składniki per wersja (`Term_Oferty_Skladniki.wersja_id`, `jednostka_miary`, `jednostki_na_pozycje`) |
| `Term_Zakupy` | `zrodlo_typ` (sprzedaz/przyznane), `zrodlo_id`, `oferta_wersja_id`, `zrodlo_hash`, `zrodlo_sprawdzono`, `zwroty_suma`, `stan_zrodla` (ok/do_uzgodnienia/usuniete/wycofane), `ilosc_zrodlowa`; UNIQUE `(tenant, zrodlo_typ, zrodlo_id)`; `klient_nazwa` nieużywana |
| `Term_Zakupy_Skladniki` | `stan_weryfikacji` (niezweryfikowany/zweryfikowany), `punkt_odciecia`, `hist_wykorzystane`, `hist_wycofane`, `hist_potracone`, `zrodlo_ustalen`, `zweryfikowal`, `zweryfikowano`, `zalezne_uzgodniono`, `uzgodnienie_wersja`, `data_waznosci_lok`, `zawieszono_od/do`, `aktywny_od` (uruchomienie), `saldo_json` (projekcja), `usluga_nazwa` (migawka) |
| nowa `Term_Przydzialy` | pozycja, składnik, ilość, cykl, stan (zarezerwowany/zuzyty/zwolniony/potracony/odwrocony), operacja |
| nowa `Term_Realizacje` | pozycja, przydział, ilość, wykonawca_fakt, data_fakt, zapisal, zapisano, cykl, odwrocona_przez |
| `Term_Zakupy_Ruchy` → nowa `Term_Zakupy_Ruchy2` | składnik, typ (G/W/U/F/R z kierunkiem), ilość, przydział_id, realizacja_id, operacja_id, odwraca_id, data_zdarzenia, kto, powód — bez `UNIQUE(pozycja, typ)` (stara tabela zostaje pusta, nieczytana) |
| nowa `Term_Operacje` | tenant, klucz UNIQUE, rodzaj, autor, skrot_zadania, stan (w_toku/zapisano/odrzucono), wynik_json, utworzono |
| nowa `Term_Ewidencja` | tenant PK, tryb, rozpoczeto, punkt_uzgodnienia, zakonczono, zmienil, raport_json |
| `Term_Pozycje` | `jednostki_wymagane INT DEFAULT 1`, `rozliczenie` (pakiet/pojedynczy/do_wyjasnienia), `wykonanie_data_fakt` |
| `Term_Uslugi` | `wymaga_zakupu TINYINT NULL` (NULL = wg ustawienia salonu) |
| `Term_Ustawienia` | `recepcja_potwierdza_wykonanie`, `potracenie_nieobecnosc` ('off'/'on'), `seria_limit` (20, maks. 50) |
| `Term_Sprawy.typ` | nowe typy E20 (zmiana źródła), E21 (stan do sprawdzenia), E22 (ważność dotyka terminów), E23 (fakt do wyjaśnienia), E24 (błąd uzgadniania) — kolumna `VARCHAR(10)` wystarcza |

Rdzeń: **bez zmian schematu**. Start aplikacji: jak dziś (moduł w try/catch, DDL fire-and-forget, `sprawdzSchemat` rozszerzony o nowe elementy; braki wyłączają ewidencję, nie serwer).

---

## 10. Lista plików do zmiany (per etap)

| Etap | Pliki |
|---|---|
| ZK-02 | **nowy** `routes/terminarz-zakupy.js` (schemat v2, saldo, operacje, adapter `Sprzedaz`, `Term_Operacje`, `wTransakcjiSalonu`); `routes/terminarz.js` (wpięcie, `sprawdzSchemat`, tryb ewidencji, przeniesienie ruchów z `trm_zapisz/zmien/anuluj/obecnosc/pozycja_stan` do wspólnej funkcji, usunięcie importu z odczytu); `tests/terminarz-zakupy.test.js` (mocki: niezmienniki, A05–A09, A14, N02–N04, P03–P09); `.env.test.example` (bez zmian treści sekretów) |
| ZK-03 | `routes/terminarz-zakupy.js` (klasyfikacja, wersje ofert, uzgodnienie, weryfikacja per składnik, zależne wizyty, uruchomienie); `public/terminarz.js` + `public/terminarz.css` (UX09 edytor wielowierszowy, UX10 stan początkowy, podgląd importu, stan aktywacji); `public/index.html` tylko `?v=` |
| ZK-04 | `routes/terminarz.js` (kreator/siatka/profil/kopia/seria), `routes/terminarz-silnik.js` (bez zmian logiki zasobów; ewentualnie pomocnicze dla serii), `public/terminarz.js` (UX01–UX03, UX07, seria), `public/terminarz.css` |
| ZK-05 | `routes/terminarz-zakupy.js` (realizacje, korekty, potrącenia, poza terminarzem), `public/terminarz.js` (UX04–UX06, UX12), **`public/index.html`** — wyłącznie wstrzyknięcie panelu „Realizacja zabiegów” po `przetwarzajHistorieKlienta()` (`index.html:16423`), ładowanego tylko gdy `hasFeature('terminarz')` i ewidencja aktywna, z własnym `try/catch` (N07) |
| ZK-06 | `routes/terminarz-zakupy.js` (uzgadnianie źródeł, cykl życia, raport końcowy), `routes/terminarz.js` (sprawy E20–E24, `tickSprawy` + uzgadnianie co 5 min), `public/terminarz.js` (UX11, UX13) |
| ZK-07 | `public/estelio_pomoc_terminarz.html` (scenki), `ZAKUPY_ODBIOR.md`, skrypty testowe na izolowanej bazie |

Nietykane: `routes/sprzedaz.js`, `routes/klienci.js`, `routes/lojalnosc.js`, `routes/analityka.js`, `server.js` (akcje dochodzą do `module.exports.AKCJE` terminarza — dispatcher już je przekazuje).

---

## 11. Decyzje właściciela wymagane przed ZK-02/ZK-03 (tylko te, których kod nie rozstrzyga)

| ID | Pytanie | Moja rekomendacja |
|---|---|---|
| D-1 | Czy w kreatorze/profilu pokazywać saldo portfela (tylko informacyjnie, bez przycisku „Umów”)? | Tak, jedna linia „Portfel: X zł — to środki, nie liczba zabiegów” (§16.3), tylko dla ról z dostępem do portfela dziś (recepcja/manager+). |
| D-2 | Oferty „1x” (pojedynczy zabieg): domyślnie `nie_ewidencjonuj` (sprzedaż = wykonany/rozliczany po wykonaniu, jak dziś) czy `pojedynczy_z_gory` (1 jednostka na przyszłość)? | Domyślnie `nie_ewidencjonuj`; manager przełącza wybrane oferty na `pojedynczy_z_gory` przy przeglądzie (§8.4). Inaczej każda dotychczasowa sprzedaż „1x” w dniu zabiegu stałaby się fałszywą wolną jednostką. |
| D-3 | Zostawić bramkę techniczną `TERMINARZ_ZAKUPY_TENANTS` (lista salonów) obok nowego trybu ewidencji włączanego przez managera? | Tak w pilotażu (dwie zgody: właściciel + manager), do usunięcia po pilotażu. |
| D-4 | Baza testowa (hPanel + `.env.test`) przed ZK-02 — próby zapisujące jednostki tylko tam. | Konieczne przed jakimkolwiek testem z bazą; bez niej ZK-02 kończy się testami na mockach. |
| D-5 | Salon pilotażowy i 4 zakupy do pilotażu (zwykły pakiet, mieszany, dwa zakupy tej samej usługi, zakup z przyszłymi wizytami — §22.1). | `demo-estelio` do odbioru; Boczki dopiero po odbiorze. |

Pozostałe kwestie (potrącenia za nieobecność, recepcja potwierdzająca wykonanie, limit serii) mają domyślne wartości ze spec i przełączniki w ustawieniach — nie blokują.

---

## 12. Kryterium końca ZK-01 — sprawdzenie

- **Z czego powstaje jednostka:** z zatwierdzonej wersji mapowania oferty (`rodzaj=pakiet` lub `pojedynczy_z_gory`) zastosowanej do kwalifikowanego wiersza `Sprzedaz` (pozycja, AKTYWNY, kwota>0, bez zwrotu, nie produkt, nie „Dopłata”, z `id_klienta`) albo z jawnego przyznania managera. ✔
- **Zakup na przyszłość vs portfel vs zapis wcześniejszego wykonania:** portfel = `Zadatki` (nigdy jednostki); sprzedaż pakietu „Nx” = zakup na przyszłość po weryfikacji stanu; sprzedaż „1x” = domyślnie zapis wykonania (`nie_ewidencjonuj`), chyba że oferta jawnie oznaczona (D-2). ✔
- **Ryzyko podwójnego uprawnienia za tę samą wpłatę:** wpłata (`Zadatki`) nie tworzy jednostek; sprzedaż „za Portfel” zużywa zadatek w rdzeniu i tworzy jeden wiersz `Sprzedaz` → jedno źródło; import idempotentny po `Sprzedaz.id`; konwersji portfel→pakiet nie budujemy. **Brak nierozstrzygniętego ryzyka.** ✔
- **Brak zmian sald produkcyjnych:** żadnych zapisów do bazy w tym etapie (jedno połączenie, wyłącznie `SHOW`/`SELECT`). ✔

## 13. Proponowany zakres następnego etapu (ZK-02)

1. Nowy moduł `routes/terminarz-zakupy.js`: schemat v2 (§9), `sprawdzSchemat` rozszerzony, `Term_Operacje`, `wTransakcjiSalonu`, wyliczenie G/W/U/F/R/L/B bez przycinania, adapter odczytu `Sprzedaz` z hashem, tryby ewidencji z odmową mutacji poza `aktywna/konczenie`.
2. Przepięcie `trm_zapisz`, `trm_zmien`, `trm_anuluj`, `trm_obecnosc`, `trm_pozycja_stan` na przydziały/realizacje/ruchy v2 pod jedną blokadą; usunięcie importu z `trm_zakupy_klientki`; `przerwana` bez automatycznego zużycia; data wykonania = potwierdzenie.
3. Testy na mockach: „przyznaj → zarezerwuj → wykorzystaj → cofnij → wykonaj ponownie” dla A bez zmiany B; N02–N04, N05 (brak tabel → ewidencja niedostępna, rdzeń działa), P03–P09, A05–A09, A14; odmowa mutacji przy nieaktywnym module i przy `TERMINARZ_ZAKUPY_TENANTS` pustym.
4. Dostarczenie: opis migracji i odwracalności, lista zmian, wynik testów (pojedynczo, z rodzajem próby), bez aktywacji dla żadnego salonu, push na `dev`.
