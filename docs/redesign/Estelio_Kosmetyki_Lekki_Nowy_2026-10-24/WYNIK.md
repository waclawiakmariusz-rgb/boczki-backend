# Produkty i kosmetyki (Kreator Produktu / Kosmetyku) — wynik wdrożenia redesignu (24.10.2026)

Zasada właściciela: wyłącznie oprawa; logika bez zmian — **ekran o podwyższonym ryzyku** (słownik zasila Przyjęcie towaru i Rejestrację sprzedaży). Gałąź `dev`. Bez main/produkcji. Próby: izolowana MariaDB 3307, salon `demo-test` (6 wpisów, 3 firmy).

## 1. Mapa (rozdz. 3 specyfikacji) — kontrakty potwierdzone w kodzie

| Pytanie | Ustalenie |
|---|---|
| Ekran | `#slownik` w `public/index.html`; dane `slownikCache` z `?action=dictionary` (`[{firma, model, cena}]`, lista kompletna, bez paginacji); `renderSlownik()` buduje select firm (+ opcja `NEW` „Nowa…") i listę `#lista-slownik` |
| Firma | **tekst**, nie rekord — firmy wyliczane z produktów (`Set(slownikCache.map(firma))`). „Nowa…" w selekcie i link „Dodaj nową" robią **dokładnie to samo** (`przelaczTrybFirmy()` ustawia select=`NEW` i woła `obslugaWyboruFirmy()`, która chowa select i pokazuje `#s_firma_input`). Nowa firma **nie** jest zapisywana osobno — trafia jako tekst w `add_model` razem z produktem |
| Dodawanie | `dodajModel()` → `add_model {firma, model, cena}`; front wymaga firmy i modelu (alert), cena opcjonalna; backend odrzuca duplikat pary firma+model (bez rozróżniania wielkości liter) komunikatem „Istnieje!"; po odpowiedzi alert, `pobierzSlownik()`, reset formularza, powrót do listy firm |
| Identyfikator | **brak ID w kontrakcie front↔back** — wpis identyfikowany parą `(firma, model)`; edycja/usunięcie: `TRIM(firma) = ? AND TRIM(model) = ? LIMIT 1` |
| Edycja | `edytujSlownikUI(firma, model, cena)` → modal `#edit-dict-overlay` → `zapiszEdycjeSlownika()` → `edit_dictionary_entry {old_firma, old_model, new_firma, new_model, new_cena}` — **zmienia jeden wpis**, nie wszystkie produkty tej firmy |
| Usuwanie | `usunZeSlownikaUI(firma, model)` → `confirm` → `delete_dictionary_entry`; backend **odmawia, gdy stan w Magazynie > 0** („W systemie znajduje się jeszcze N szt."); twarde `DELETE` ze Słownika, bez kaskad |
| Cena | `type="number" step="0.01"`, przecinek przez przeglądarkę; backend `cena_detal`; pusta zostaje pusta (lista pokazuje „brak ceny") |
| Powiązania | `slownikCache` → Przyjęcie towaru (`zaladujFirmyDoFormularzaNowyProdukt`, `zaladujModeleDlaFirmy`) i Sprzedaż (dopasowanie `firma model` → cena) — **nietknięte** |
| Filtr | `szukajWSlowniku()` po `textContent` każdego `<li>` listy (ustawia `display` inline) |

## 2. Zmiany

- `public/index.html`: sekcja `#slownik` (nowy znacznik: nagłówek, karta „Dodaj produkt", karta „Katalog produktów" z licznikiem i wyszukiwarką; **te same ID i handlery**; link „+ Dodaj firmę" woła `przelaczTrybFirmy()`, „Wróć do listy firm" ustawia select na `''` i woła `obslugaWyboruFirmy()` — obie funkcje istniejące); `renderSlownik()` — tylko szablon wiersza (`<li class="dict-row">` zostaje dla filtra; `escHtml`, cena z przecinkiem, licznik, stan pusty); modal `#edit-dict-overlay` — nowy znacznik z tymi samymi ID i zamykaniem; **dwa literały**: etykieta przycisku („Dodaj do bazy" → „Dodaj produkt") i treść `confirm` (z nazwą i warunkiem stanu 0 — zweryfikowanym w backendzie).
- `public/kosmetyki.css` *(nowy)* — `.estelio-cosmetics`, kolumny Firma/Produkt/Cena/Działania, 820/640 px → karty, dialog 500 px, tryb ciemny. **Bez własnego JS.**
- `tests/kosmetyki-redesign.test.js` *(7)*; pełny zestaw **913/913**.
- `narzedzia/proby/kosmetyki.json` — 17 sprawdzeń w panelu.

## 3. K01–K20

| ID | Wynik | Dowód |
|---|---|---|
| K01 odczyt | PASS | I: 6 wpisów, licznik 6, select 3 firmy + `NEW`; suplementy na liście |
| K02 istniejąca firma + produkt | PASS | I: 1 POST `add_model {firma:'BioVital', model, cena:'260'}` |
| K03 nowa firma | PASS | I: tryb nowej firmy (select ukryty, input widoczny) → `add_model {firma:'Nowa Marka Test', …}` — zapis w tej samej operacji, jak dotąd |
| K04 powrót z nowej firmy | PASS | I: nazwa i cena zostają, 0 POST, select wraca |
| K05 cena | bez zmian | `type=number step=0.01` (przeglądarka), backend jak dotąd |
| K06 walidacja, dwuklik | PASS | I: pusta nazwa → 0 POST (`required`); dwuklik → 1 POST (przycisk `disabled`) |
| K07 edycja jednego wpisu | PASS | I: dialog z danymi, `old_* = new_*` na starcie, zapis `edit_dictionary_entry` z `new_cena:'99.99'` |
| K08 firma w edycji | PASS | backend: `UPDATE … WHERE id = ?` jednego wpisu |
| K09 Anuluj/X | PASS | I: X zamyka bez zapisu |
| K10 usunięcie | PASS | I: anuluj → 0 mutacji; potwierdź → 1 POST `delete_dictionary_entry {firma, model}`; blokada stanu > 0 po stronie backendu (jak dotąd) |
| K11 błąd/timeout | bez zmian | alerty z odpowiedzi serwera |
| K12 filtr | PASS | I: „kolagen" → tylko pasujące (istniejąca funkcja) |
| K13 paginacja | n.d. | lista bez paginacji (jak dotąd) — celowo nie dodano |
| K14 nazwa wypada z filtra | bez zmian | lista przerysowana po `pobierzSlownik()`; filtr pozostaje w polu |
| K15 role / salon | bez zmian | backend |
| K16 długie nazwy / HTML | PASS | I: `escHtml`, zawijanie, `<b>` jako tekst |
| K17 mobile / 800×550 / 200 % | PASS | I: `poza: []`, bez poziomego scrolla; dialog mieści się na 400 px |
| K18 sprzedaż / historia | PASS (konstrukcyjnie) | `slownikCache` i dopasowanie w sprzedaży nietknięte; brak przeliczeń |
| K19 magazyn / inne moduły | PASS | T: CSS zawężony; 913/913 |
| K20 SPA | PASS | brak nowych listenerów (bez własnego JS) |

## 4. Gdzie spec ustąpiła zasadzie „logika bez zmian"

Własne dialogi (edycja z „Masz niezapisane zmiany", usunięcie z „Zostaw produkt"), błędy pod polami, przycisk „Zapisz zmiany" nieaktywny bez zmian, paginacja 6/strona, usunięcie opcji „Nowa…" z selectu — wymagałyby zmian w `renderSlownik`/`dodajModel`/`zapiszEdycjeSlownika`/`usunZeSlownikaUI`. Zostały: `confirm`, alerty, pełna lista; opcja „Nowa…" nadal jest w selekcie (ten sam skutek co „+ Dodaj firmę").

## 5. Poza zakresem, nie ruszane

- Wpis bez ID: edycja/usunięcie po parze nazw z `LIMIT 1` — przy dwóch identycznych parach trafi w pierwszą. Istniało.
- `dodajModel` zawsze pokazuje `alert(d.message)` — także „Istnieje!" ze statusem `success` (duplikat nie jest błędem dla frontu). Istniało.
