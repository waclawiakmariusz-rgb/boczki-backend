# Magazyn Estelio — „lekki nowy”

HTML, CSS i JavaScript odpowiadające dwóm zatwierdzonym makietom dodawania produktu. Wszystkie siedem pól zachowane. Bez frameworka, kompilacji i zewnętrznych zależności.

## Uruchomienie

Rozpakuj całą paczkę. Otwórz `index.html` w aktualnej przeglądarce. Nie przenoś samego HTML bez folderów `assets` i `js`.

- `index.html` — formularz z przykładowymi danymi makiety.
- `kategorie.html` — ten sam formularz z otwartymi kategoriami.
- `nowy.html` — formularz od pustego stanu.
- `edycja.html` — wariant „Obecna ilość” i „Zapisz zmiany”.

Działają wyszukiwanie kategorii, grupowanie, wybór klawiaturą, walidacja, demonstracyjny zapis i potwierdzenie odrzucenia zmian. Dane żyją tylko w pamięci danego podglądu. Odświeżenie strony przywraca dane przykładowe. Nie ma połączenia z magazynem Estelio.

## Przekazanie Claude

Przekaż **cały ZIP**. Polecenia są w `WDROZENIE_CLAUDE.md`. Kod osadzany w aplikacji to `formularz.fragment.html`, `assets/magazyn.css`, `js/model.js`, `js/magazyn.js` oraz adapter utworzony na podstawie `js/adapter-estelio.template.js`.

W `makiety/` są obie referencje graficzne. Podglądy nie przebudowują menu i pozostałych ekranów Estelio.

## Testy

```sh
node --test tests/model.test.cjs
```

Wynik wykonany przy przygotowaniu paczki: **13/13 PASS**. Zakres i ograniczenia w `WERYFIKACJA.md`. Testy te nie zastępują odbioru działania rzeczywistego magazynu.
