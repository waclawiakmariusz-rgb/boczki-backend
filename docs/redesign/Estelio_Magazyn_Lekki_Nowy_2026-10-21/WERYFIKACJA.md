# Weryfikacja — 21.10.2026

## Wykonane

- 13 testów modelu i adaptera demonstracyjnego: 13 PASS, 0 FAIL.
- Kontrola składni wszystkich plików JavaScript przez `node --check`.
- Kontrola lokalnych odwołań HTML do plików CSS/JS i stron wariantów.
- Obecność siedmiu pól w każdym punkcie wejścia i fragmencie.
- Dołączenie dwóch zatwierdzonych makiet PNG.
- Kontrola integralności gotowego archiwum ZIP.

Testy obejmują: pustą cenę vs zero, precyzję liczb bez utraty cyfr, polski separator dziesiętny, błędne liczby, daty, wyszukiwanie po ścieżce, kategorie archiwalne, aktualizację tylko zmienionych pól, idempotencję i konflikty adaptera demo.

## Niewykonane

- Odbiór wizualny renderowania w przeglądarce, dotyku i rzeczywistej klawiatury mobilnej.
- Testy integracyjne rzeczywistego API i bazy Estelio.
- Weryfikacja działania przy produkcyjnych uprawnieniach i równoległych ruchach magazynowych.

W dostępnym środowisku nie ma lokalnego silnika przeglądarki do renderowania. Z wcześniejszych prób wiadomo, że przeglądarka zdalna nie ma dostępu do lokalnego serwera podglądu. Nie oznaczam tych kontroli jako wykonanych. Makiety w folderze `makiety/` to referencje projektowe, a nie dowód renderowania kodu.

Odbiór M01–M20 oraz porównanie dwóch widoków i wersji mobilnej opisuje `WDROZENIE_CLAUDE.md`. Dopiero podłączenie i sprawdzenie adaptera w Estelio potwierdzi gotowość do wdrożenia produkcyjnego.
