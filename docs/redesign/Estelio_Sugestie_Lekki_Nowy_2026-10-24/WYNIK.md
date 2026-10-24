# Sugestie zabiegów — wynik wdrożenia redesignu (24.10.2026)

Zasada właściciela: wyłącznie oprawa; logika bez zmian. Gałąź `dev`. Bez main/produkcji. Próby: izolowana MariaDB 3307, salon `demo-test` (3 reguły).

## 1. Mapa (rozdz. 3 specyfikacji)

| Pytanie | Ustalenie z kodu |
|---|---|
| Ekran | `#setup-sugestie` w `public/index.html`; lista renderowana przez `renderKreatorSugestii()` z `regulyCache` (`pobierzReguly()` → `get_suggestion_rules`, lista kompletna) |
| Zdarzenie | **zakup** — stary ekran: „Gdy klient kupił:"; sugestie generuje `generujSugestie(klient)` z historii sprzedaży (`REKOMENDACJE_REGULY` + `regulyCache`). Kopia „Po zakupie" zgodna |
| Pola | `#sug_matka`, `#sug_dziecko` — `<input type="text" list="lista-zabiegow-sugestie">` (**dowolny tekst**, datalist z kategorii cennika `salesDictCache.zabiegi`); `#sug_opis` — opcjonalny |
| Identyfikator reguły | **brak ID w kontrakcie** — para `(matka, dziecko)` (tekst); `delete_suggestion_rule` kasuje `WHERE matka = ? AND dziecko = ? LIMIT 1` (twarde usunięcie) |
| Walidacja | front: oba pola wymagane, A ≠ A (alerty); backend: bez reguły duplikatów (INSERT) |
| Zapis | `zapiszReguleSugestii()` (onclick, czyta `event.target`) → `add_suggestion_rule {matka, dziecko, opis, pracownik}`; po odpowiedzi alert, czyszczenie **tylko** opisu, `pobierzReguly()` |
| Pomoc | slot `admin.sugestie` — zachowany |

## 2. Zmiany

- `public/index.html`: sekcja `#setup-sugestie` (nowy znacznik; `#sug_opis` to teraz `<textarea>` z tym samym id — `.value` czytane tak samo); `renderKreatorSugestii()` — tylko szablon wiersza (te same dane, `escHtml`, ten sam `usunRegule(matka, dziecko)`, licznik, stan pusty); **dwa literały**: etykieta przycisku po zapisie („Zapisz Regułę" → „Dodaj regułę") i treść `confirm` w `usunRegule` (pytanie z parą źródło → propozycja).
- `public/sugestie.css` *(nowy)* — `.estelio-suggestions`, 920/580 px, tryb ciemny.
- `public/sugestie.js` *(nowy)* — podgląd reguły (lokalnie) i wyszukiwarka listy „Wyniki: X z Y". Zero fetch/POST.
- `tests/sugestie-redesign.test.js` *(8)*; pełny zestaw **906/906**.
- `narzedzia/proby/sugestie.json` — scenariusz w panelu.

## 3. S01–S18

| ID | Wynik | Dowód |
|---|---|---|
| S01 odczyt | PASS | I: 3 reguły z danych, licznik 3; Z `01-desktop.png` |
| S02 dodanie | PASS | I: 1 POST `add_suggestion_rule {matka:'Storz', dziecko:'Endermologia LPG', opis}`; opis wyczyszczony, pola zabiegów zostają (jak dotąd) |
| S03 wybrana pozycja → edycja | n.d. | kontrakt tekstowy, bez ID ofert |
| S04 puste pola | PASS | I: alert „Wybierz oba zabiegi!", 0 POST (jak dotąd) |
| S05 A → A | PASS | I: alert „muszą być różne", 0 POST (jak dotąd); duplikaty — backend bez reguły (jak dotąd) |
| S06 dwuklik | PASS | I: 1 POST (przycisk `disabled` na czas zapisu — jak dotąd) |
| S07 usunięcie anulowane | PASS | I: `confirm` z „Storz → …", 0 mutacji |
| S08 usunięcie potwierdzone | PASS | I: 1 POST `delete_suggestion_rule {matka, dziecko}` |
| S09 błąd / inne okno | bez zmian | `pobierzReguly()` po odpowiedzi — jak dotąd |
| S10 filtr | PASS | I: „xyz" → „Wyniki: 0 z 3" + „Nie znaleziono reguł" + „Wyczyść"; fragment nazwy bez ogonków → „Wyniki: 1 z 3" |
| S11 HTML/cudzysłów/ogonki | PASS | I: `<b>` pokazane jako tekst (`escHtml` w szablonie, `textContent` w podglądzie) |
| S12 tylko odczyt / salon | bez zmian | backend |
| S13 klawiatura | PASS (częściowo) | datalist natywny (strzałki/Enter/Esc przeglądarki); przycisk zapisu nie jest submitem → Enter nie wysyła |
| S14 320/400/800×550/200 % | PASS | I: `poza: []`, bez poziomego scrolla; Z `05-telefon-400.png` |
| S15 odbiorca sugestii | PASS (konstrukcyjnie) | `generujSugestie()` nietknięte; te same dane w `regulyCache` |
| S16 SPA | PASS | listenery raz (`data-prezentacja-gotowa`) |
| S17 reguły historyczne | bez zmian | tekst, bez konwersji |
| S18 inne moduły | PASS | T: CSS zawężony; 906/906 |

## 4. Gdzie spec ustąpiła zasadzie „logika bez zmian"

Własny combobox z listbox/ARIA zamiast natywnego `datalist`, błędy pod polami zamiast alertów, dialog usuwania zamiast `confirm`, stany „niepewny wynik", ochrona draftu w routingu — wymagałyby zmian w handlerach. Zostały: `datalist`, alerty, `confirm` (tylko treść pytania wg spec).

## 5. Poza zakresem, nie ruszane

- Reguła nie ma ID — usunięcie po parze nazw skasuje **pierwszą** z identycznych par (`LIMIT 1`). Istniało.
- Nazwa z apostrofem rozbije `onclick="usunRegule('…')"` (jak w Pracownikach). Istniało.
