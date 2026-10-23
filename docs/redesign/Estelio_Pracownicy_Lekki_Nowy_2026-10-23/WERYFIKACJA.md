# Weryfikacja paczki — 23.10.2026

## Wykonano

- Obejrzano zrzut źródłowy widoku Pracownicy i wygenerowaną makietę. Zakres obejmuje pole dodawania i listę osób biorących udział w sprzedaży.
- Sprawdzono składnię `pracownicy.js` i `demo.js` przez `node --check`: bez błędów.
- Sprawdzono kompletność odwołań do lokalnych plików HTML/CSS/JS oraz zgodność fragmentu z podglądem.
- Zweryfikowano spakowanie wszystkich plików i integralność archiwum ZIP.

## Nie wykonano

- Testy interakcji w prawdziwej przeglądarce: uruchomienie `testy-podgladu.cjs` zatrzymało się przed pierwszą próbą z powodu braku pliku wykonywalnego Chromium. Próba pobrania przeglądarki zakończyła się błędem archiwum. Nie ma zaliczonych prób Playwright.
- Porównanie wizualne HTML z makietą i pomiary przepełnienia 320/400 px: wymagają przeglądarki. Responsywność jest opisana i zaimplementowana, lecz nie została tu wizualnie odebrana.
- Testy backendu, sesji, historii sprzedaży, uprawnień i produkcyjnego Estelio: brak dostępu do repozytorium i kontraktów w tym zadaniu.

## Do uruchomienia przez Claude

W istniejącym środowisku z Node, Playwright i Chromium uruchom:

```sh
node testy-podgladu.cjs
```

Skrypt zawiera 16 prób. Testuje podgląd z fikcyjnymi danymi. Po udanym wykonaniu zapisuje `testy-wynik.json` i trzy zrzuty podglądu: desktop, mobile oraz dialog. Te pliki nie znajdują się w obecnej paczce, ponieważ przeglądarka nie wystartowała. Następnie wykonaj oddzielnie odbiór integracji P01–P14 z głównej instrukcji.

Paczka jest wzorcem implementacyjnym do dalszego sprawdzenia, nie potwierdzeniem gotowości produkcyjnej ani zgodności pikselowej 1:1.
