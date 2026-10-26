# Weryfikacja paczki — 23.10.2026

## Wykonano

- `node --test testy-modelu.cjs`: **28/28 PASS**.
- Testy: dokładny parser liczb, błędne dane, 0/50/100%, pół grosza według reguły demo, jawny brak wyniku dla nieznanych zaokrągleń, odczyt/zapis w pamięci, konflikt wersji, brak uprawnień, niepewny zapis.
- `node --check` dla trzech plików JS i testów: poprawna składnia.
- Kontrola zgodności fragmentu z index.html, obecności lokalnych zasobów i integralności ZIP.

## Nie wykonano

- Uruchomienia UI w przeglądarce, wizualnego porównania HTML z makietą oraz automatycznych zdarzeń DOM. Brak działającego pliku wykonywalnego Chromium w środowisku; instalacja nie powiodła się.
- Testów backendu Estelio, reguł rzeczywistego zaokrąglania, sesji, uprawnień i salonów.
- Odbioru mobilnego, klawiatury i czytnika ekranu.

## Do odbioru po podłączeniu

1. Wczytanie prawdziwej konfiguracji; brak wartości domyślnych po błędzie.
2. Każdy rzeczywisty tryb i zaokrąglenie, zgodność z multisprzedażą.
3. Zmiana tylko przykładu nie odblokowuje zapisu; Enter nie zapisuje.
4. Błędny przykład nie blokuje poprawnego zapisu ustawień.
5. Dwuklik zapisu, błąd, timeout, konflikt wersji; brak fałszywego sukcesu.
6. Stara odpowiedź podglądu nie zastępuje nowszej; demontaż widoku nie zostawia listenerów.
7. 320, 400, 800×550, desktop i zoom 200%, także po odjęciu szerokości menu.
8. Widok czysty i niezapisany, otwarta pomoc, wszystkie błędy, tylko odczyt.

Testy modelu demonstracyjnego nie dowodzą poprawności finansowej Estelio ani zgodności wizualnej 1:1.
