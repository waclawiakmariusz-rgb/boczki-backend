# Estelio — Przyjęcie towaru: HTML / CSS / JavaScript

**Wersja:** 19.10.2026. **Zakres:** Kosmetyki → Przyjęcie towaru.

To jest rzeczywisty kod interfejsu przygotowany na podstawie zatwierdzonej makiety. Paczka zawiera osobny fragment do osadzenia w Estelio oraz demonstrację formularza. Nie jest wdrożeniem do repozytorium ani integracją z bazą salonu.

## Uruchomienie

1. Rozpakuj cały ZIP do jednego folderu.
2. Otwórz `index.html` w aktualnej przeglądarce. Zachowaj obok pliki CSS, JS i katalog `assets`.
3. Formularz ma przykładowe wartości z makiety. Zmień ilość, cenę lub produkt.
4. Pod formularzem rozwiń **Podgląd interaktywny**. Możesz otworzyć pusty formularz i sprawdzić trzy odpowiedzi symulowanego zapisu: sukces, odmowę, utratę odpowiedzi.

Nie potrzeba kompilacji, npm, Reacta ani dostępu do Internetu. Kalendarz daty korzysta z natywnego wyboru przeglądarki; data pozostaje też edytowalna tekstowo.

Alternatywnie: uruchom w tym katalogu `python3 -m http.server 8765` i otwórz `http://localhost:8765`.

## Pliki

| Plik | Przeznaczenie |
|---|---|
| `index.html` | Kompletny podgląd w kontekście przykładowego menu Estelio. |
| `przyjecie-towaru.fragment.html` | Sam widok do osadzenia w istniejącej aplikacji. Bez bocznego menu. |
| `przyjecie-towaru.css` | Wygląd formularza, podsumowania, walidacji, okna anulowania i układ responsywny. |
| `przyjecie-towaru.js` | Obsługa formularza oraz publiczny interfejs `EstelioGoodsReceipt.mount`. |
| `demo.js` | Fikcyjny katalog, stan makiety i symulowany zapis. Nie trafia do produkcji. |
| `demo-shell.css` | Wyłącznie otoczka demonstracji. Nie trafia do istniejącej powłoki aplikacji. |
| `assets/estelio-logo.png` | Oryginalny przekazany znak Estelio, użyty w podglądzie. |
| `INTEGRACJA_DLA_CLAUDE.md` | Konkretne polecenia podłączenia do istniejących danych i zapisu. |
| `PRZYJECIE_TOWARU_CLAUDE_CODE.md` | Pełna wcześniej przygotowana specyfikacja wyglądu i odbioru. |
| `MAKIETA_PRZYJECIE_TOWARU.png` | Zatwierdzona grafika referencyjna. |
| `tests/obliczenia.test.cjs` | Uruchamialne testy obliczeń, dat i wymagania adaptera. |
| `WERYFIKACJA.md` | Co sprawdzono i czego nie udało się potwierdzić. |

## Co jest zaimplementowane

- Układ dwóch kart, pola i typografia według specyfikacji makiety.
- Brak kontrolki „Detal” i zielonego paska z nazwą produktu.
- Marka → lista modeli; uzupełnianie typu i cen z dostarczonego katalogu.
- Licznik z minus/plus i możliwością wpisania liczby.
- Podsumowanie na żywo: 6 × 98,40 zł = 590,40 zł.
- Niezależne ceny netto/brutto, obliczenia w groszach; bez zakładania stawki VAT.
- Walidacja przy polach, format daty, potwierdzenie odrzucenia zmian.
- Stan zapisu, ochrona przed ponownym wysłaniem w trakcie żądania, rozróżnienie odmowy od nieznanego wyniku.
- CSS reagujący na szerokość obszaru formularza, nie tylko całej przeglądarki.

Zapis w `index.html` jest wyraźnie oznaczoną **symulacją**. Nie zmienia magazynu. Właściwy komponent nie ma wbudowanego endpointu ani domyślnego udawanego sukcesu: wymaga adaptera istniejącego Estelio.

Nie potwierdzono jeszcze wizualnej zgodności 1:1 w uruchomionej przeglądarce; szczegóły w `WERYFIKACJA.md`. Właściwe działanie w Estelio wymaga zachowania jego rzeczywistych reguł walidacji i podłączenia handlerów, zgodnie z `INTEGRACJA_DLA_CLAUDE.md`.
