# Jak fizycznie działa rozliczanie płatności w Estelio — opis dla recenzenta

**Data:** 18.10.2026 · **Autor:** Claude Code na polecenie właściciela · **Źródło:** kod `routes/sprzedaz.js`, `routes/klienci.js`, `public/index.html` (ekran sprzedaży), `schema.sql`, plus praktyka salonu opisana przez właściciela. To opis **rdzenia** (modułu Sprzedaż), nie dodatku Terminarz. Dodatek tylko czyta to, co tu powstaje.

## 1. Przebieg przy kasie, tak jak robi to recepcja

1. Klientka po zabiegu (albo przy zakupie pakietu z góry) podchodzi do recepcji. Recepcja otwiera **ekran sprzedaży** w Estelio, wybiera klientkę z kartoteki (albo dodaje nową), dodaje **pozycje**: zabieg z cennika (kategoria + wariant, np. „Endermologia” / „10x”), produkt z magazynu, ewentualnie zadatek.
2. Przy każdej pozycji wybiera **sposób płatności**: Gotówka, Karta, Przelew, **Portfel** (środki klientki w salonie), **Mix** (podział jednej pozycji na kilka sposobów).
3. Wybiera, kto sprzedał (jeden lub kilku pracowników — od tego liczą się prowizje w Analizie), zatwierdza. Jeden ekran = jeden **paragon** Estelio. To nie jest paragon fiskalny: Estelio nie ma integracji z drukarką fiskalną, kasa fiskalna jest poza systemem.
4. Klientka wychodzi. Jeśli kupiła pakiet, recepcja pilnuje jego wykorzystania **poza systemem** (karta klientki, pamięć). Estelio zna tylko ważność pakietu i tekst wariantu. **Rdzeń nie liczy zabiegów w pakiecie** — to jest luka, którą wypełnia dodatek.

## 2. Co powstaje w bazie

Trzy tabele. Wszystkie mają `tenant_id` (salon) i miękkie usuwanie przez `status`.

**`Sprzedaz` — jedna pozycja paragonu = jeden wiersz.** Kolumny istotne: `id`, `data_sprzedazy`, `klient` (nazwa), `id_klienta`, `zabieg` (kategoria z cennika albo nazwa produktu), `szczegoly` (wariant, np. „10x”, „1 obszar 4x [Rabat: -20%]”, a dla produktu ilość sztuk), `kwota`, `platnosc` (Gotówka/Karta/Przelew/Portfel/mix), `sprzedawca` (imiona), `status` (AKTYWNY/USUNIĘTY), `id_zadatku` (jeśli opłacono z portfela), `data_waznosci`, `karnet_zamkniety_w`, `typ_zabiegu`, `kategoria_produktu` (dla produktów), `grupa_id`, `zwrot_do_id`.

**`Zadatki` — pieniądze klientki w salonie („portfel”).** Jeden wiersz = jedna wpłata. `typ = 'WPŁATA'`, `kwota`, `metoda` (jak wpłacono), `cel` (na co), `status` (AKTYWNY → WYKORZYSTANY / USUNIĘTY / SCALONY), `bon = 1` dla bonu podarunkowego. Portfel klientki to suma jej wierszy AKTYWNY.

**`Platnosci` — rozbicie płatności mieszanej.** Gdy pozycja ma `platnosc = 'mix'`, prawdziwe kwoty per metoda leżą tutaj: wiersze `<paragon>-SPLIT-1`, `-SPLIT-2`… z `metoda_platnosci` i `kwota`. **Reguła księgowa:** każde sumowanie utargu po metodzie musi pomijać wiersze `mix` w `Sprzedaz` i brać je z `Platnosci`, inaczej liczy podwójnie.

## 3. Identyfikatory: paragon, pozycje, powielenia

- Paragon dostaje jeden **identyfikator bazowy**; każda pozycja to `<baza>-1`, `<baza>-2`… (`uniqueIdBase + '-' + idx`). Dlatego „ten sam paragon” rozpoznaje się po wspólnej bazie `id` przed ostatnim `-n`.
- **Ilość zabiegów nie istnieje jako liczba.** Jeśli klientka kupuje dwa egzemplarze tej samej oferty, recepcja **powiela pozycję przyciskiem** i powstają dwa osobne wiersze z tym samym `grupa_id` (`Sprzedaz.grupa_id`, komentarz w kodzie: „wspólny identyfikator pozycji powielonych przyciskiem”). `grupa_id` służy też do tego, by przedłużenie/zakończenie karnetu działało na całej grupie naraz.
- Dla produktów ilość sztuk jest tekstem w `szczegoly` („3 szt.”) i zdejmuje stan magazynu metodą FIFO po partiach.

## 4. Portfel, zadatek, bon

- **Wpłata do portfela** (`manage_deposit`, typ WPŁATA) tworzy wiersz w `Zadatki` ze statusem AKTYWNY. Może być też pozycją na paragonie sprzedaży (typ „Zadatek” w pozycji — wtedy trafia do `Zadatki`, nie do `Sprzedaz`). Wpłata mieszana ma własne wiersze w `Platnosci`.
- **Zapłata z portfela**: pozycja z `platnosc = 'Portfel'` (lub 'Zadatek'). Kod `rozliczZadatekAutomatycznie` bierze aktywne wpłaty klientki po kolei: wpłata mniejsza lub równa potrzebnej kwocie dostaje status WYKORZYSTANY; wpłata większa dostaje WYKORZYSTANY, a **reszta wraca jako nowy wiersz** `DEP-REST-…` ze statusem AKTYWNY. Pozycja sprzedaży dostaje `id_zadatku`.
- **Bon podarunkowy** to wpłata z `bon = 1`. **Portfel to pieniądze, nie zabiegi** — wpłata „na 5 endermologii” jest wpłatą kwoty z celem w tekście; prawo do zabiegów powstaje dopiero przy sprzedaży pozycji opłaconej z tego portfela.
- Scalanie zadatków (`merge_deposits`) daje status SCALONY starym wierszom; usunięcie = USUNIĘTY (miękkie). **Przychód liczy się po wierszach WYKORZYSTANY**, nie tylko AKTYWNY.

## 5. Dopłata — rozbita sprzedaż jednej usługi

To najważniejszy przypadek dla ewidencji jednostek. Ekran sprzedaży (`weryfikujZadatek`): **jeśli recepcja wybierze Portfel, a cena pozycji jest wyższa niż saldo, ekran dzieli pozycję na dwa wiersze**:

| Wiersz | `zabieg` | `szczegoly` | `platnosc` | `kwota` |
|---|---|---|---|---|
| `<baza>-1` | `Endermologia` | `10x` | `Portfel` | tyle, ile było w portfelu, np. 200 |
| `<baza>-2` | `Endermologia Dopłata` | (puste) | Karta / Gotówka / Przelew / mix | reszta, np. 1500 |

Skutki w rdzeniu: wiersz „X Dopłata” nie istnieje w cenniku, więc nie dostaje ważności (`data_waznosci = NULL`); ważność i wariant są na wierszu głównym. Oba wiersze dzielą paragon i, jeśli pozycja była powielona, `grupa_id`. **Jedna usługa = jeden wiersz główny + zero lub jeden wiersz dopłaty.** Dlatego dla ewidencji: prawo powstaje z wiersza głównego, dopłata to część finansowania tej samej usługi i nigdy nie jest drugim pakietem.

## 6. Płatność mieszana (Mix)

Jedna pozycja, kilka metod: `Sprzedaz.platnosc = 'mix'`, a podział w `Platnosci` (`<baza>-SPLIT-n`). Suma splitów musi równać się kwocie pozycji, serwer to sprawdza. Mix nie tworzy dodatkowych pozycji sprzedaży i nie dotyka portfela, chyba że jeden ze splitów to Portfel — wtedy działa punkt 4.

## 7. Zwroty

- Zwrot to **nowy wiersz** w `Sprzedaz` z dzisiejszą datą, `kwota` ujemna, `zabieg = 'ZWROT: <oryginał>'`, `zwrot_do_id = id oryginalnej pozycji`, `platnosc` = jak oddano pieniądze (Gotówka/Karta/Przelew). Oryginał **nie jest zmieniany** (stare raporty zostają).
- Zwrot może być **częściowy**; kolejne zwroty do tej samej pozycji sumują się i nie mogą przekroczyć kwoty oryginału. Zwrotu zwrotu nie ma.
- Zwrot produktu może przywrócić sztuki do magazynu. Zwrot usługi **nie mówi nic o liczbie zabiegów** — to kwota. Zwrot do wiersza „Dopłata” jest tak samo legalny jak do wiersza głównego i dotyczy tej samej usługi.
- Zwrot nie zasila portfela automatycznie (metody: tylko Gotówka, Karta, Przelew).

## 8. Karnety i pakiety w rdzeniu

- Przy sprzedaży pozycji z cennika rdzeń odczytuje `Uslugi.waznosc_dni` i zapisuje `data_waznosci = data sprzedaży + dni` (snapshot). Brak dni = brak ważności.
- Manager może **Przedłużyć** (`extend_karnet`, nowa data, działa na całej `grupa_id`), **Zawiesić** (`suspend_karnet`), **Zakończyć** (`close_karnet` → `karnet_zamkniety_w`, `karnet_zamkniety_przez`), **Cofnąć zakończenie** (`reopen_karnet`). Lista wygasających w profilu klientki.
- To wszystko, co rdzeń wie o pakiecie: data ważności i ręczne zakończenie. **Nie ma licznika wykonanych zabiegów, nie ma powiązania wizyty z pakietem.** „Zakończ” może oznaczać „wykorzystany”, „przeterminowany” albo „klientka zrezygnowała” — rdzeń tego nie rozróżnia.

## 9. Edycja, usuwanie, rozliczenie księgowe

- `edit_sale` zmienia pola pozycji; `delete_sale` ustawia `status = 'USUNIĘTY'` (nic nie znika fizycznie). Pozycja już rozliczona przez księgową (panel Magdy, `rozliczone`) nie daje się usunąć bez cofnięcia rozliczenia.
- `emergency_edit_sale` to tryb awaryjny managera z historią.
- Prowizje liczą się w Analizie z pola `sprzedawca`; punkty Klubu nalicza hook po zapisie sprzedaży i wpłaty (`naliczZaSprzedaz`, `naliczZaZadatek`). Żadna z tych rzeczy nie jest ponawiana przez dodatek.

## 10. Przykład: pakiet 1700 zł, klientka ma 200 zł w portfelu, resztę płaci kartą

```
Zadatki:   DEP-001  WPŁATA  200,00  Gotówka  cel="na zabiegi"  AKTYWNY  → po sprzedaży: WYKORZYSTANY
Sprzedaz:  P-1  Endermologia         10x   Portfel  200,00   id_zadatku=DEP-001  data_waznosci=+180 dni
Sprzedaz:  P-2  Endermologia Dopłata       Karta   1500,00   data_waznosci=NULL
```
Jeśli recepcja powieliła pozycję (dwa pakiety): `P-1`, `P-2` główne z tym samym `grupa_id`, dopłaty `P-3`, `P-4` z `grupa_id` odpowiednio odziedziczonym. Zwrot 100 zł kartą do `P-2` daje `Sprzedaz: P-5  ZWROT: Endermologia Dopłata  -100,00  Karta  zwrot_do_id=P-2  data=dziś`.

## 11. Co z tego wynika dla ewidencji jednostek (dodatek)

1. Źródło prawa = **wiersz główny** z cennika; dopłata, zwrot, produkt, sama wpłata do portfela, bon — nigdy.
2. Liczba zabiegów pochodzi wyłącznie z zatwierdzonego przez managera składu oferty; tekst „10x” to podpowiedź.
3. Zmiana finansowania (zwrot do głównego lub do dopłaty, usunięcie, edycja) jest zmianą tego samego prawa; kwota nie przelicza się na zabiegi.
4. Powielone pozycje = osobne prawa; `grupa_id` tylko łączy je ze wspólnymi dopłatami i operacjami karnetu.
5. Historia wykorzystania sprzed ewidencji **nie istnieje w danych**; musi ją podać człowiek, puste pole to „nie wiem”.
6. Rdzeń nie używa żadnych blokad przy zapisie zwrotu; zwrot to zwykły INSERT. Stąd okno równoczesności opisane w ZK-03 i decyzja właściciela dla salonu z jedną recepcją.

## 12. Czego w rdzeniu nie ma (żeby nie zakładać)

Brak: licznika jednostek, powiązania wizyta–zakup, stanu „nieopłacone”, voucherów usługowych (bon jest kwotowy), scalania klientek, dziennika zmian pozycji z kursorem (logi są tekstowe), integracji z kasą fiskalną, automatycznego zwrotu do portfela.
