# Estelio — Produkty i kosmetyki

**Redesign „lekki nowy”,24.10.2026.**

Rozpakuj cały ZIP i otwórz `index.html`. Podgląd działa bez instalowania pakietów i bez serwera. Claude Code przekaż cały katalog.

## Zawartość

- `index.html` — podgląd katalogu i formularzy.
- `kosmetyki.fragment.html` — sam komponent do osadzenia.
- `kosmetyki.css` — wygląd i responsywność.
- `kosmetyki.js` — dodawanie, edycja, usuwanie, wyszukiwanie i paginacja.
- `model.js` — funkcje prezentacji i demonstracyjny parser ceny.
- `demo-adapter.js`, `demo.js` — dane i operacje wyłącznie w pamięci.
- `makiety/01-katalog-i-dodawanie.png` — widok główny.
- `makiety/02-firma-edycja-usuwanie.png` — nowa firma, edycja i potwierdzenie usunięcia.
- `KOSMETYKI_WDROZENIE_DLA_CLAUDE.md` — plan i kryteria odbioru.
- `INTEGRACJA_KODU.md` — sposób podłączenia do istniejącego systemu.
- `testy-modelu.cjs`, `WYNIK_TESTOW.txt`, `WERYFIKACJA.md` — wyniki i ograniczenia.
- `ESTELIO_STANDARD_REDESIGNU.md` — ustalony sposób dostarczania redesignów.

Zapis/edycja/usuwanie zmieniają tylko pamięć otwartej strony. Odświeżenie przywraca dane przykładowe. Nic nie łączy się z Estelio.

To katalog nazw i cen w sprzedaży, nie magazyn. Nie dodano ilości ani przyjęć towaru. Nie narzucono ceny netto/brutto ani zasad podatkowych.

48/48 testów modelu/adaptera demo PASS. Testy przeglądarkowe i rzeczywiste API nie zostały wykonane. Makiety wykonano silnikiem graficznym; nie są zrzutami kodu. Zgodność wizualna1:1 wymaga odbioru po uruchomieniu.
