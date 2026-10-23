# Rabaty — wynik wdrożenia redesignu (23.10.2026)

Zasada: zmienia się wyłącznie oprawa. Punkt odniesienia: `przed-redesign-2026-10-22` = `fca9edd`. Bez wdrożenia, bez zapisu w realnym salonie.

## Mapa stary → nowy (ID i kontrakt bez zmian)

| Element | Pole / funkcja (bez zmian) | Zapis |
|---|---|---|
| Nazwa rabatu | `<input id="rabat-nazwa">` | `nazwa` |
| Segmenty Procentowy / Kwotowy *(nowe radio)* | ustawiają **ten sam** `<select id="rabat-typ">` (PROCENT/KWOTA), który czyta `zapiszDefinicjeRabatu()` | `typ` |
| Wartość rabatu + sufiks `%`/`zł` | `<input type="number" id="rabat-wartosc">` | `wartosc` |
| Dodaj rabat | `onclick="zapiszDefinicjeRabatu()"` → `action:'add_discount_def'` `{nazwa, typ, wartosc, pracownik}` | ten sam |
| Aktywne rabaty + licznik | `zaladujRabaty()` → `?action=get_discounts` → `rabatyCache` (używany też przy sprzedaży, nietknięty) | — |
| Podgląd *(nowy)* | `rabaty.js`, lokalnie; zero fetch | — |
| Pomoc „?" | slot `admin.rabaty` w nagłówku | — |

## Zmiany w kodzie

- `public/index.html` — sekcja `#sekcja-kreator-rabatow`: nowy znacznik; `zaladujRabaty()`: tylko szablon wiersza (te same dane `nazwa/wartosc/typ`, dodatkowo `escHtml` i licznik); `zapiszDefinicjeRabatu()`: **jedna linia** — selektor przycisku `button[onclick="zapiszDefinicjeRabatu()"]` zamiast `button`.
  Powód: od 22.10 w sekcji jest przycisk pomocy „?" (pierwszy `<button>` w DOM) — stary selektor blokowałby pomoc zamiast zapisu. Próba potwierdza: w trakcie zapisu „Dodaj rabat" → „⏳ Zapisywanie..." i `disabled`, „?" nietknięte.
- `public/rabaty.css` *(nowy)* — selektory zawężone do `.estelio-discounts`, tryb ciemny, container queries (920 / 520 / 340 px).
- `public/rabaty.js` *(nowy)* — segmenty → select, podgląd, sufiks. Zero fetch/POST/innerHTML (strażnik).
- `tests/rabaty-redesign.test.js` *(nowy)* — 9 strażników.

## Próby (`wynik/rabaty-proba.js`, Chrome headless, fetch przechwycony)

| Próba | Wynik |
|---|---|
| PROCENT 10 | payload `{action:'add_discount_def', nazwa:'Stała klientka', typ:'PROCENT', wartosc:'10', pracownik:'Ola'}`; podgląd „−10%" |
| KWOTA 50 (segment) | `select = KWOTA`, sufiks „zł", payload `typ:'KWOTA', wartosc:'50'`; podgląd „−50 zł" |
| dwuklik | 1 POST; przycisk zapisu `disabled`, pomoc „?" nie |
| pusta wartość | alert „⛔ Uzupełnij nazwę i wartość rabatu!", 0 POST (jak dotąd) |
| po sukcesie | nazwa/wartość wyczyszczone, lista odświeżona (jak dotąd) |
| lista | 1 rabat z izolowanej bazy: „Urodziny · Rabat procentowy · −15%", licznik 1 |
| 1663 / 390 / 320 px | nic poza kontenerem, brak poziomego przewijania; jedna kolumna < 920 px |
| błędy JS | brak |

Pełny zestaw: **868/868** (47 pakietów). Zrzuty: `wynik/rabaty-01-desktop.png`, `wynik/rabaty-02-telefon.png`.

## Gdzie spec ustąpiła zasadzie „logika bez zmian"

Błędy pod polami zamiast alertu, stany „zapis udany / lista nieudana", skeleton ładowania, komunikat „Rabat został dodany" — wymagałyby zmian w `zapiszDefinicjeRabatu()`/`zaladujRabaty()`. Zostały alerty i dotychczasowy przebieg. Okruszek „Administracja / Rabaty" jest tekstem, nie linkiem.

## Poza zakresem, nie ruszane

- Backend `add_discount_def` — nie sprawdzano granic (0 %, >100 %, ujemne); frontend waliduje tylko „niepuste". Jak dotąd.
- Git: commit na `dev`. Main/produkcja: NIE.
