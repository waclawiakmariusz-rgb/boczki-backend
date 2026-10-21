# „Zbyt wiele zapytań" — pętla w zakładce powiadomień (21.10.2026)

Zgłoszenie właściciela zaraz po wdrożeniu: *„Nie udało się wczytać ustawień: Zbyt wiele zapytań",
„Błąd: Zbyt wiele zapytań", „padła baza znowu!!"*.

## Baza nie padła

```
BAZA ODPOWIADA w 187 ms → MariaDB 11.8.9
polaczenia teraz: 132 / limit 2000
baza dziala nieprzerwanie od 103 h
API odpowiada: 200 w 69 ms
```

Komunikat pochodził z **naszego własnego ogranicznika zapytań** (120/minutę z jednego IP) —
i ogranicznik zadziałał prawidłowo, bo coś faktycznie zasypywało serwer.

## Przyczyna: pętla w nowej zakładce

Pomiar zapytań do `/api` przy normalnej pracy:

```
ZAPYTAN PRZY STARCIE APLIKACJI (F5): 22
wejscie w Terminarz              +5
widok Tydzien                    +2
widok Agenda                     +2
Ustawienia                       +0
zakladka Powiadomienia e-mail    +349   ← PĘTLA
   175 × trm_maile_ustawienia
   174 × trm_maile_dziennik
```

Zakładka „Powiadomienia e-mail" (dodana 21.10) wczytywała dane, a po ich otrzymaniu wywoływała
przerysowanie Ustawień — przerysowanie z kolei uruchamiało wczytywanie od nowa. Każde otwarcie tej
zakładki wystrzeliwało setki zapytań w kilka sekund i wyczerpywało minutowy limit **dla całego
stanowiska**, przez co sypały się też inne ekrany („Błąd: Zbyt wiele zapytań" w dowolnym miejscu).

## Co poprawione

1. **Koniec pętli.** Zakładka wczytuje się tylko wtedy, gdy nie ma danych i nic się nie pobiera;
   pobranie ma blokadę na czas trwania, a przerysowanie następuje **raz**, po komplecie danych.
   Po zapisie i po wysyłce próbki odświeżenie idzie osobną ścieżką (`TRM.maileOdswiez`).
   Pomiar po poprawce: **349 → 2 zapytania**.
2. **Limit liczony per stanowisko, nie per salon.** Recepcja, manager i tablet wychodzą do internetu
   jednym adresem IP, więc licznik jednego stanowiska zabierał budżet pozostałym. Kluczem jest teraz
   IP + token sesji; żądania bez sesji (logowanie, ruch anonimowy) nadal dzielą pulę po IP.
3. **Limit domyślny 120 → 300/min.** Start aplikacji to ~22 zapytania, przejście po widokach
   Terminarza kolejne ~10. 300 daje zapas na normalną pracę i wciąż ucina zapętlenie.
   Nadpisywalny przez `API_RATE_LIMIT` (środowisko testowe).

## Wniosek na przyszłość

Przy każdej nowej zakładce, która sama pobiera dane: **render nie może wywoływać pobierania bez
warunku**. Pomiar liczby zapytań (`Network.requestWillBeSent` w headless) wychwytuje to w minutę —
warto go robić dla każdego ekranu, który ładuje coś po wejściu.
