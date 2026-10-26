# Estelio — Ustawienia zadatków, „lekki nowy”

1. Rozpakuj cały ZIP do jednego katalogu.
2. Otwórz `index.html` — działa bez instalowania pakietów i bez serwera.
3. Claude Code przekaż CAŁY katalog, zwłaszcza `ZADATKI_WDROZENIE_DLA_CLAUDE.md` i `INTEGRACJA_KODU.md`.

## Zawartość

- `index.html`: podgląd z przykładową konfiguracją.
- `zadatki.fragment.html`: treść do osadzenia w istniejącym widoku.
- `zadatki.css`: izolowane style i responsywność.
- `zadatki.js`: obsługa UI, stanów i adaptera.
- `demo-model.js`, `demo.js`: dane i obliczenia tylko demonstracyjne, nie do produkcji.
- `makiety/01-ustawienia-zadatkow.png`: kierunek graficzny.
- `ZADATKI_WDROZENIE_DLA_CLAUDE.md`: szczegółowy plan i kryteria odbioru.
- `INTEGRACJA_KODU.md`: adapter, struktura danych, stany błędów.
- `testy-modelu.cjs`, `WERYFIKACJA.md`: wykonane testy i ograniczenia.
- `ESTELIO_STANDARD_REDESIGNU.md`: uzgodniony sposób dostarczania redesignów.

## Ważne

Zapis w podglądzie działa tylko w pamięci otwartej strony. Nie zapisuje niczego w Estelio. Zaokrąglenia do 5 i 10 zł są widoczne, ale wynik podglądu wymaga podłączenia istniejącego kalkulatora — nie zgadujemy jego zasad.

Uruchomione testy: 28/28, wyłącznie model i adapter demo. Nie przeprowadzono testu przeglądarkowego ani integracji z backendem. Makieta nie jest zrzutem tego HTML. Zakres: zawartość Ustawień zadatków, bez zmiany innych modułów.
