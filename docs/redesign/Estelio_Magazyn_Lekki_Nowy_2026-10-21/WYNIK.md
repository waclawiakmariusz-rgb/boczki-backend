# Magazyn → Nowy produkt / Edycja — wynik wdrożenia redesignu (23.10.2026)

Zasada właściciela: zmienia się wyłącznie oprawa; logika i funkcjonalność bez zmian. Punkt odniesienia: `przed-redesign-2026-10-22` = `fca9edd`.
Prace na `dev`. **Bez wdrożenia na main/produkcję, bez zapisu w realnym salonie** (próby: izolowana MariaDB 3307, salon `demo-test`).

## 1. Mapa (rozdz. 4 specyfikacji)

| Pytanie | Odpowiedź z kodu |
|---|---|
| Widok / montowanie | sekcja `#rap_add.section.rap_view-section`, wejście przez `pokaz('rap_add')`; edycja przez `rap_edit(id)` (ustawia `#rap_p_id` i pola, potem `pokaz('rap_add')`) |
| Kategorie | `?action=rap_getCategories` → `rap_categoriesFlat` = `[id, nazwa, rodzic_id, pelna_sciezka]`; `rap_populateCategorySelects()` wstawia do `<select id="rap_p_cat">` opcje o **wartości = pełna ścieżka** („Rodzic > Dziecko"); brak stanu archiwalnego; rodzic jest wybieralny (to zwykła pozycja) |
| Zapis | `rap_zapiszProdukt()` → `rap_apiCall('rap_saveProduct', {id, category, nazwa, ilosc, unit, min, price_gross, expiration, userFull})`; ten sam handler dla create (`id` pusty) i edit (pełny rekord) |
| Reguły pól | natywne: nazwa `required`, kategoria `required`, ilość/minimum `type=number step=0.1`, cena `step=0.01`, data `type=date`; backend: **odmowa duplikatu nazwy w kategorii** |
| Pusta cena / data | wysyłane jako `''` (jak dotąd); backend rozstrzyga |
| Edycja | pełny rekord, bez wersji/ochrony przed równoległą korektą (jak dotąd — **nie dokładano**, spec: „nie deklaruj ochrony bez testu integracyjnego") |
| Create a stan | jedno `rap_saveProduct` tworzy produkt ze stanem = `ilosc`; brak drugiego naliczenia (M09: 12 → 12.00) |
| Po sukcesie | alert „✅ Zapisano produkt!", `rap_resetProdForm()`, `pokaz('rap_magazyn')`, `rap_fetchInventory()` |

## 2. Zmiany w kodzie

- `public/index.html` — sekcja `#rap_add`: nowy znacznik wg fragmentu z paczki. **Wszystkie ID pól, atrybuty walidacji, `onsubmit`, `rap_zapiszProdukt`, `rap_edit`, `rap_resetProdForm` — bez zmian** (0 linii JS w index.html; strażnik w teście).
- `public/magazyn-produkt.css` *(nowy)* — selektory zawężone do `.estelio-inventory`, container queries 760/600 px, tryb ciemny.
- `public/magazyn-produkt.js` *(nowy)* — prezentacja: panel kategorii nad **tym samym** `<select id="rap_p_cat">` (opcje bierze z selectu, ustawia `select.value` + `change`), tryb dodaj/edytuj po `#rap_p_id` (obserwator klasy `active`), Anuluj z pytaniem. Zero fetch/POST/walidacji (strażnik).
- `tests/magazyn-produkt-redesign.test.js` *(nowy)* — 9 strażników. Pełny zestaw: **877/877**.
- `narzedzia/proby/magazyn-produkt.json`, `magazyn-produkt-pelny.json` — scenariusze w panelu prób.

## 3. Wyniki M01–M20

**I** = próba integracyjna w Chrome headless (`proby-wyniki/`, galerie `raport.html`), **Z** = zrzut, **T** = test jednostkowy, **—** = nie wykonano.

| ID | Wynik | Dowód |
|---|---|---|
| M01 układ jak makieta | PASS | Z `04-referencyjny-jak-makieta.png` (1536×1024, dane z makiety) |
| M02 otwarty picker | PASS | Z `02-picker-otwarty.png`; 6 opcji = 6 w selekcie, grupy po rodzicu, lokalny scroll |
| M03 te same nazwy w różnych gałęziach | PASS (konstrukcyjnie) | opcje identyfikowane pełną ścieżką (tak działa istniejący select) |
| M04 „tygodniowa higien" / „plyny" bez ogonków | PASS | I: 1 wynik „Higieniczne"; „plyny" → tylko pozycje z „Płyny" |
| M05 wybieralny rodzic / archiwalna | PASS / n.d. | rodzic to zwykła opcja (jak dotąd); archiwum nie istnieje w modelu |
| M06 puste pola | PASS | I: 0 POST, `checkValidity()=false`, pierwsze niepoprawne `rap_p_name` |
| M07 `12,5` | bez zmian | pole `type=number` (jak dotąd) — przecinek odrzuca przeglądarka, `12.5` przyjmuje |
| M08 cena 3 miejsca / tekst w ilości | bez zmian | natywna walidacja `step` (jak dotąd) |
| M09 nowy produkt 12 szt. | PASS | I (pełny): backend „Zapisano", lista: ilość 12.00, cena 49, baza: 1 wiersz |
| M10 edycja nazwy nie rusza ilości | PASS | I (pełny): po edycji ilość 12.00, stary wpis zniknął |
| M11 dwie równoległe korekty | — | brak mechanizmu wersji w istniejącym kontrakcie; nie dokładano |
| M12 dwuklik / duplikat | PASS | I: dwuklik = 1 POST (przycisk `disabled`); ponowne dodanie tej samej nazwy → backend odmawia, bez fałszywego sukcesu |
| M13 utrata odpowiedzi | — | stary kod nie ma „sprawdź wynik"; nie dokładano (logika) |
| M14 wyczyszczenie daty/ceny | bez zmian | `''` w payloadzie jak dotąd |
| M15 Anuluj | PASS | I: `confirm` „Odrzucić zmiany?", po zgodzie reset + `pokaz('rap_magazyn')`, 0 POST |
| M16 brak sesji/praw | — | poza zakresem oprawy (backend bez zmian) |
| M17 400 / 320 / 800×550 / zoom 200 % | PASS | I: `poza: []`, `poziomyScroll: false` na 1024, 800×550, 400, 320, 400×275@2; Z `09`, `10` (picker na 400 px mieści się) |
| M18 klawiatura | PASS | I: Enter w pickerze wybiera i **nie** wysyła; Escape zamyka bez zmiany wyboru |
| M19 wielokrotne wejście | PASS | listenery podpinane raz (`data-prezentacja-gotowa`), I: wejścia 4× w sekcję, 1 POST na zapis |
| M20 inne ekrany | PASS | T: CSS zawężony; JS działa tylko w `#rap_add`; 877/877 |

## 4. Gdzie spec ustąpiła zasadzie „logika bez zmian"

Komponent `EstelioInventoryForm.mount` z adapterem, `operationId`/`expectedVersion`, stany `conflict`/`unknown`, błędy pod polami, kanoniczne ciągi dziesiętne, `changes` w edycji — wszystko to zmieniałoby walidację i kontrakt zapisu. Zostały: natywna walidacja, alerty, pełny rekord w edycji. Picker kategorii, tryb edycji i Anuluj są czysto prezentacyjne.

## 5. Poza zakresem, nie ruszane (do decyzji)

- Edycja wysyła pełny rekord bez wersji — równoległa dostawa może zostać nadpisana (M11). Istniało.
- Pusta cena → `''`; co backend z tym robi (NULL czy 0) — nie sprawdzano.
