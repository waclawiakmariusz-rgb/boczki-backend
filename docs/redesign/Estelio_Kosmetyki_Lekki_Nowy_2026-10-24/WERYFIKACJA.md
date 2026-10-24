# Weryfikacja paczki —24.10.2026

## Wykonano

- `node --test testy-modelu.cjs`: **48/48 PASS**.
- Parser demo: przecinek/kropka, grosze, zero, błędne formaty, brak częściowego parsowania tekstu, roundtrip.
- Filtrowanie, polskie znaki, podział13 rekordów na strony, pusta lista i usunięcie ostatniego rekordu strony.
- Dodawanie, edycja pojedynczego ID, firma jednego produktu, brak mutacji po błędnej cenie.
- Usuwanie po ID, blokada powiązanego produktu, konflikty wersji, idempotencja demonstracyjna, prawa odczytu i błędy.
- `node --check` dla plików JS, kontrola fragmentu HTML, ID/ARIA, lokalnych odwołań i integralności ZIP.

## Nie wykonano

- Uruchomienia UI w przeglądarce ani testów DOM. W tej sesji brak działającego Chromium został stwierdzony przy wcześniejszym module; nie deklarujemy testów interakcji jako zaliczonych.
- Porównania screenshotów HTML z makietami, mobile, dotyku, klawiatury i czytnika ekranu.
- Integracji z rzeczywistym API, sesją, salonami, cennikiem, magazynem i historią sprzedaży.

## Próby UI dla Claude

1. Odczyt13 produktów,6 na stronie; wyszukiwanie „Eye” pokazuje właściwy produkt.
2. Dodanie produktu dla istniejącej firmy i nowej firmy; po sukcesie firma zostaje, nazwa/cena są puste.
3. Przełączanie nowa firma/lista zachowuje nazwę produktu i cenę.
4. Błędne pola pokazują komunikaty; błędna cena nie zmienia się na0.
5. Edytuj cenę, anuluj, wróć do edycji, odrzuć: lista niezmieniona. Powtórz i zapisz: zmienia tylko wybrane ID.
6. Zmieniona nazwa wypadająca z filtra: sukces i filtr zachowane.
7. Usuwanie anulowane, potwierdzone, blokowane; ostatni rekord strony koryguje numer strony.
8. Dwuklik, błędy odczytu/zapisu/timeout i uprawnienia zgodnie ze scenariuszami URL.
9. Długa nazwa, HTML w nazwie, polskie znaki: tekst, bez wykonania kodu.
10. Mobile320/400px,800×550,desktop,zoom200%, Escape, Tab, Enter, powrót fokusu.

Testy modelu nie dowodzą działania interfejsu ani poprawności produkcyjnego Estelio. Pełne kryteria K01–K20 znajdują się w głównej instrukcji.
