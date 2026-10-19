# Notatka (i preferencje) w chmurce podglądu wizyty

Prośba z 19.10.2026: *„w terminarzu po najechaniu na jakąś rezerwację pojawia się dymek
z większą ilością informacji. W przypadku gdy jest notatka, to pokazuj ją też w tym dymku"*
— z zastrzeżeniem: *„chyba że to będzie bardzo obciążające dla systemu, to wtedy nie"*.

## Co się zmieniło

W chmurce (najechanie myszą na wizytę w widoku Dzień) pod listą zabiegów doszły dwa elementy:

- **chipsy preferencji** klientki (maks. 5 — kawa, temperatura, rozmowa, kontakt…),
- **notatka do wizyty** w żółtej ramce z ikoną notatki — tej samej, która znaczy kartę wizyty.

Dotąd znaczek na karcie mówił tylko *„tu jest notatka"*; żeby ją przeczytać, trzeba było
otwierać szczegóły wizyty. Teraz treść widać od razu.

Pliki: `public/terminarz.js` (funkcja `trmPokazBuble`), `public/terminarz.css`
(`.trm-bubble-notatka` + wariant `body.dark-mode`).

## Odpowiedź na obawę o obciążenie: zero dodatkowych zapytań

Chmurka rysuje się **wyłącznie z danych, które są już w pamięci przeglądarki** —
`TRM.dzien.rezerwacje` (pobrane razem z dniem) i `TRM.pref.mapa` (pobrane razem z dniem).
Najechanie myszą nie wywołuje żadnego ruchu do serwera.

Pomiar w izolowanym środowisku (MariaDB 3307 + serwer 3999, Chrome headless z włączonym
podsłuchem sieci `Network.enable`, licznik wyzerowany tuż przed najechaniem):

```
wizyta z notatką: 109|Julia Wiśniewska|Prosi o cieplejszy gabinet, alergia na o
czas renderu chmurki: ~905 ms (w tym 240 ms celowego opóźnienia przed pokazaniem dymka)
zadania sieciowe po najechaniu: 0 []
BLEDY JS: brak
```

**0 żądań do `/api`.** Koszt dla serwera: żaden. Koszt dla przeglądarki: kilka dodatkowych
elementów HTML w dymku, który i tak się rysuje.

Pełny `jest`: **666/666** (31 zestawów).

## Zrzuty

| Plik | Co widać |
|---|---|
| `dymek-notatka-jasny.png` | chmurka Julii Wiśniewskiej: chipsy preferencji + notatka „Prosi o cieplejszy gabinet, alergia na olejek migdałowy" |
| `dymek-notatka-ciemny.png` | ta sama chmurka w trybie ciemnym — notatka na ciepłym tle, tekst czytelny |
