# Estelio — Sugestie zabiegów, „lekki nowy”

**Pełna paczka, 24.10.2026.** Rozpakuj ZIP i otwórz `index.html`. Nie wymaga instalowania pakietów ani serwera. Claude Code przekaż cały katalog.

## W środku

| Plik | Przeznaczenie |
|---|---|
| index.html | Działający lokalnie podgląd |
| sugestie.fragment.html | Fragment do osadzenia w istniejącym ekranie |
| sugestie.css | Wygląd i responsywność |
| sugestie.js | Formularz, podgląd, lista, wybór i usuwanie |
| model.js | Wspólne funkcje prezentacji i wyszukiwania |
| demo-adapter.js / demo.js | Przykładowe dane i zapis w pamięci |
| makiety/01-sugestie-desktop.png | Cały obszar treści |
| makiety/02-wybor-i-usuniecie.png | Osobne komponenty: lista wyboru i dialog |
| SUGESTIE_WDROZENIE_DLA_CLAUDE.md | Szczegółowy zakres, plan, stany i kryteria odbioru |
| INTEGRACJA_KODU.md | Kontrakt podłączenia do obecnego Estelio |
| testy-modelu.cjs | Testy modelu i adaptera demo |
| WERYFIKACJA.md | Wyniki i niewykonane próby |
| ESTELIO_STANDARD_REDESIGNU.md | Uzgodniony standard paczek |

## Ważne

Dodawanie/usuwanie w podglądzie zmienia tylko pamięć otwartej strony. Odświeżenie przywraca dane przykładowe. Nic nie łączy się z Estelio.

Przed wdrożeniem Claude musi sprawdzić **zakup vs wykonanie zabiegu** oraz **dowolny tekst vs wybór z katalogu**. Na starym ekranie opisy nie są jednoznaczne; nie zmieniamy reguł biznesowych na podstawie samego wyglądu.

Nie jest to przebudowa menu ani modułu retencji. Dwie makiety wykonano silnikiem graficznym; nie są screenshotami uruchomionego HTML.

Testy modelu/adaptera demo: 36/36 PASS. Nie wykonano odbioru przeglądarkowego ani testów rzeczywistego API Estelio. Dokładna zgodność wizualna wymaga odbioru po uruchomieniu.
