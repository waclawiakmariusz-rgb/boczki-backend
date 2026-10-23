# Kategorie magazynowe — pełny pakiet dla Claude

1. Rozpakuj cały ZIP.
2. Otwórz `index.html` w aktualnej przeglądarce — to działający podgląd z fikcyjnymi danymi.
3. Obejrzyj `01-kategorie-widok.png` i `02-wybor-miejsca.png`.
4. Przeczytaj `WDROZENIE_DLA_CLAUDE.md`. Zawiera polecenie, parametry, ścieżki, kontrakt adaptera oraz odbiór.
5. Przeczytaj `WERYFIKACJA.md`, aby odróżnić wykonane testy od pozostałych.

## Kod

- `kategorie.fragment.html` — fragment do osadzenia;
- `kategorie.css` — lokalne style „lekki nowy”;
- `kategorie-model.js` — walidacja i operacje odczytu drzewa;
- `kategorie.js` — formularz, drzewo, wyszukiwanie, dialogi i picker;
- `demo-adapter.js`, `demo.js` — wyłącznie demonstracja, NIE do produkcji;
- `testy-modelu.cjs` — testy modelu oraz adaptera demonstracyjnego, uruchomienie `node testy-modelu.cjs`.

Przekaż Claude całą paczkę. Polecenie:

> Zintegruj redesign Kategorie magazynowe według WDROZENIE_DLA_CLAUDE.md. Zachowaj obecne dane i reguły backendu. Najpierw rozpoznaj stare kontrolki, zwłaszcza turkusową strzałkę; nie zastępuj nieznanej funkcji przenoszeniem bez sprawdzenia kodu. Użyj prawdziwego adaptera i uprawnień. Zakończ raportem prób KAT01–KAT16. Nie publikuj na produkcji w ramach tego polecenia.

To samodzielny wzorzec frontendowy, nie zmiana wdrożona w Estelio. Żadne działanie podglądu nie zapisuje danych produkcyjnych. Po odświeżeniu demo wraca do stanu początkowego.
