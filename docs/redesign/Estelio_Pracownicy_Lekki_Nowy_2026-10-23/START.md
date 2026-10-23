# Zacznij tutaj

Pakiet: Estelio / Administracja → Pracownicy / „lekki nowy”, 23.10.2026.

1. Otwórz `01-pracownicy-makieta.png`.
2. Przeczytaj `PRACOWNICY_WDROZENIE_DLA_CLAUDE.md` w całości.
3. Znajdź aktualny ekran i obsługę jego danych w repozytorium. Sprawdź szczególnie skutek dotychczasowej akcji usuwania.
4. Wprowadź lokalny redesign i wykonaj wymienione próby odbiorowe.

Makieta przedstawia tylko obszar treści. Zachowaj menu i pozostałe moduły Estelio. To lista osób biorących udział w sprzedaży; nie rozszerzaj jej o zarządzanie kontami, rolami i PIN-ami. Dane na grafice są fikcyjne.

Gotowe polecenie do wklejenia:

> Wdróż redesign Administracja → Pracownicy na podstawie tej paczki. Źródłem układu jest makieta PNG, a parametrów i zachowań dokument PRACOWNICY_WDROZENIE_DLA_CLAUDE.md. Zachowaj istniejące kontrakty danych i ogranicz CSS do tego modułu. Najpierw ustal rzeczywiste działanie obecnego usuwania. Zakończ raportem zmian i wynikami prób P01–P14. Nie publikuj na produkcji w ramach tego polecenia.

## Działający podgląd

Rozpakuj cały ZIP i otwórz `index.html` w aktualnej przeglądarce. Nie potrzeba instalacji ani serwera. Następnie przeczytaj `INTEGRACJA_KODU.md`. Kod nie wysyła danych do Estelio, a `demo.js` działa tylko w pamięci strony.

Do integracji użyj `pracownicy.fragment.html`, `pracownicy.css` i `pracownicy.js`. Nie dołączaj `demo.js` do produkcji.
