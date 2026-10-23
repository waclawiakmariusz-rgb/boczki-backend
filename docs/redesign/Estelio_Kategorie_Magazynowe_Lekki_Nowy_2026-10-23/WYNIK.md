# Kategorie magazynowe — wynik wdrożenia redesignu (23.10.2026)

Zasada właściciela: wyłącznie oprawa; logika i funkcjonalność bez zmian. Gałąź `dev`. Bez main/produkcji. Próby: izolowana MariaDB 3307, salon `demo-test` (6 kategorii w 2 gałęziach).

## 1. Mapa (rozdz. 2 specyfikacji) — co robią stare kontrolki

| Pytanie | Ustalenie z kodu |
|---|---|
| Ekran | `#rap_categories` w `public/index.html`; drzewo renderuje `rap_renderCategoryTree()` z `rap_categoriesFlat` (`[id, nazwa, rodzic_id, pelna_sciezka]`, lista kompletna, bez stronicowania) — **budowane z pełnej ścieżki** „A > B", nie z `rodzic_id` (zgłoszenie #8) |
| Dodawanie | `rap_zapiszKategorie()` → `rap_saveCategory {name, parentId}`; `parentId` = id rodzica z `<select id="rap_c_parent">`, `''` = poziom główny; po sukcesie alert, czyszczenie nazwy, **rodzic zostaje** |
| ✏️ (fiolet) | `rap_zmienNazweKategorii(id, nazwa)` → `prompt` → `rap_editCategory {id, nazwa}`; serwer przepisuje ścieżki podkategorii i produktów; odrzuca pustą nazwę i znak „>" |
| **↪ (turkus)** | **= „Przenieś"** — `rap_przeniesKategorie(id, sciezka)` → `prompt` z numerowaną listą (0 = poziom główny; wyklucza siebie i potomków) → `rap_editCategory {id, parentId}`; serwer dodatkowo blokuje cykl i duplikat ścieżki. Interpretacja z makiety **potwierdzona** |
| × (czerwony) | `rap_deleteCategory(id)` → `confirm` → `rap_deleteCategory {id}`; **serwer odmawia**, gdy kategoria ma podkategorie lub produkty (kod `NIEPUSTA`, komunikat z liczbami); fizyczne `DELETE` tylko pustej |
| Uprawnienia / salon | `rap_apiCall` dodaje `tenant_id`; bez zmian |

## 2. Zmiany

- `public/index.html`: sekcja `#rap_categories` (nowy znacznik: dwie karty, dialog wyboru miejsca); `rap_renderCategoryTree()` — **tylko szablon wiersza** (te same dane, te same 3 akcje z tymi samymi argumentami, `esc()`), licznik `#rap_kat-licznik`, stan pusty; `rap_zapiszKategorie()` — **jeden literał** etykiety przycisku („➕ DODAJ KATEGORIĘ" → „Dodaj kategorię").
- `public/kategorie-magazyn.css` *(nowy)* — `.est-categories`, 960/420 px, tryb ciemny.
- `public/kategorie-magazyn.js` *(nowy)* — prezentacja: dialog „Wybierz miejsce" nad **tym samym** `<select id="rap_c_parent">` (opcje z selectu, wybór do selectu + `change`), rozwijanie/zwijanie (stan lokalny), szukanie bez ogonków z przodkami, menu „⋯". Zero fetch/POST (strażnik).
- `tests/kategorie-magazyn-redesign.test.js` *(7)*; pełny zestaw **892/892**.
- `narzedzia/proby/kategorie-magazyn.json` — scenariusz w panelu (26 sprawdzeń).

## 3. KAT01–KAT16

| ID | Wynik | Dowód |
|---|---|---|
| KAT01 desktop 1440, 800×550 | PASS | Z `01-desktop.png`; licznik 6 = liczba węzłów; korzenie rozwinięte; menu w ekranie (`kat-menu-gora` przy dole) |
| KAT02 400 / 320 / zoom 200 % | PASS | I: `poza: []`, bez poziomego scrolla; dialog mieści się na 400 px; Z `07`, `08` |
| KAT03 główna i podkategoria | PASS | I: dialog → „Higieniczne" → `rap_saveCategory {name:'Rękawiczki', parentId:<id>}`; poziom główny = `''` |
| KAT04 pusta nazwa, Enter, dwuklik | PASS | I: pusta → 0 POST (`required`); dwuklik → 1 POST (przycisk `disabled`, jak dotąd) |
| KAT05 te same nazwy w gałęziach | PASS (konstrukcyjnie) | węzły po pełnej ścieżce; w dialogu przy filtrze pokazywana pełna ścieżka |
| KAT06 picker: filtr, zaznaczenie, anuluj | PASS | I: roboczy wybór + Anuluj → select bez zmian; Escape zamyka; filtr „tygodniowa higien" → 1 opcja; „Wybierz miejsce" ustawia select |
| KAT07 przenieś do siebie/potomka | bez zmian | lista kandydatów w `rap_przeniesKategorie` wyklucza siebie i potomków; serwer blokuje cykl — jak dotąd |
| KAT08 przeniesienie | PASS | I: menu → Przenieś → prompt `0` → `rap_editCategory {id, parentId:''}` |
| KAT09 zmiana nazwy | PASS | I: menu → Zmień nazwę → prompt → `rap_editCategory {id, nazwa}` |
| KAT10 usuń | PASS | I: menu → Usuń → `confirm` → `rap_deleteCategory {id}`; serwer odmawia niepustej (jak dotąd) |
| KAT11 błąd API | bez zmian | `alert(res.message)` — jak dotąd |
| KAT12 zmiana w innej sesji | bez zmian | brak wersjonowania w kontrakcie; nie dokładano |
| KAT13 pusta / brak dopasowania | PASS | I: „plyny" → „Dopasowania: 2" z przodkiem; „xyzxyz" → „Brak dopasowań…" (osobny komunikat); stan pusty renderowany |
| KAT14 klawiatura | PASS (częściowo) | chevrony z `aria-expanded`, radio w dialogu, Escape; brak `role=tree` (celowo, wg spec) |
| KAT15 role / salon | bez zmian | backend |
| KAT16 regresja | PASS | T: CSS zawężony; 892/892 |

## 4. Gdzie spec ustąpiła zasadzie „logika bez zmian"

Dialogi „Zmień nazwę" / „Przenieś kategorię" / „Usunąć kategorię?" zamiast `prompt`/`confirm`, komunikaty statusu zamiast alertów, kody błędów, stan „zapis udany / odczyt nieudany" — wymagałyby zmian w `rap_zmienNazweKategorii`, `rap_przeniesKategorie`, `rap_deleteCategory`. Zostały `prompt` i `confirm` (z menu „⋯" wołane te same funkcje). Jedyny nowy dialog to **wybór miejsca** — czysto prezentacyjny (ustawia select).

## 5. Poza zakresem, nie ruszane

- `rap_przeniesKategorie` używa `prompt` z numerami — pierwszy kandydat do osobnej poprawki UX (można podpiąć ten sam dialog wyboru miejsca, ale to zmiana handlera).
- `rap_zmienNazweKategorii` i `rap_deleteCategory` nie blokują dwukliku (jak dotąd).
