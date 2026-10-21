# Zgłoszenie #12b — „1. wizyta" liczona przez system

Gosia (recepcja), 20.10.2026: *„Czasami, gdy klient sam się umówi albo my się pomylimy, to jest
pierwsza wizyta, a ktoś już był na takiej wizycie. Warto, aby estelio samo stwierdzało, czy ktoś
miał już umówioną taką wizytę… Gdy ktoś nie zjawi się na pierwszej wizycie, to drugi termin będzie
pierwszą wizytą. System sam mógłby ją zamienić na pierwszą."*

## Jak to działa

**Nic nie jest zapisywane.** Oznaczenie liczy się przy każdym wyświetleniu z dwóch źródeł:

1. wizyty **wykonane** w Terminarzu (stan `wykonana` — umówiona czy odwołana się nie liczy),
2. **sprzedaż** tego zabiegu w module Sprzedaż (bez zwrotów).

Dzięki temu scenariusz Gosi rozwiązuje się sam: jeśli klientka nie przyjdzie na pierwszy termin,
ta wizyta nigdy nie stanie się „wykonana", więc kolejny termin **automatycznie** jest pierwszą
wizytą. Nikt nie musi niczego poprawiać ręcznie.

Drugie źródło jest tu kluczowe: Terminarz działa od niedawna, a salon ma lata historii w Sprzedaży.
Bez tego stała klientka dostałaby „1. wizyta" przy zabiegu, na który chodzi od roku.

## Gdzie to widać

- **Na kafelku w siatce dnia** — zielona plakietka „1. wizyta" obok nazwy zabiegu.
- **W panelu umawiania**, pod każdym wybranym zabiegiem:
  - `✦ Pierwsza wizyta na „Masaż relaksacyjny 60 min" — klientka nie miała tego zabiegu ani w terminarzu, ani w sprzedaży.`
  - `Była już 2× na „Endermologia" · ostatnio Cz 22.10`

## Próba (izolowane środowisko)

```
plakietek „1. wizyta" na siatce: 2   (Lena Dąbrowska, Klaudia Szymańska)

historia dla Julii Wiśniewskiej:
  Endermologia              ile 2  ostatnia 2026-10-22  źródło: terminarz
  Mezoterapia igłowa        ile 3  ostatnia 2026-09-04  źródło: sprzedaz
  Masaż relaksacyjny 60 min ile 0  ostatnia null        → pierwsza wizyta

linie w panelu: Była już 2× na „Endermologia" · ostatnio Cz 22.10 ||
                ✦ Pierwsza wizyta na „Masaż relaksacyjny 60 min" …
BLEDY JS: brak
```

Testy: `tests/terminarz-pierwsza-wizyta.test.js` (13) — oba źródła pytane, liczone tylko wizyty
wykonane, zwroty pomijane, sumowanie i wybór nowszej daty, granica „przed tym dniem", awaria
zapytania nie psuje widoku dnia, rezerwacje techniczne pomijane. Pełny zestaw: **715/715**.

## Koszt

Dwa zapytania na wczytanie dnia (nie jedno na wizytę) i jedno przy wyborze zabiegu w panelu.
Obie tabele mają indeks po kliencie; u Boczków to 2847 wierszy sprzedaży i komplet wizyt Terminarza.

| Plik | Co widać |
|---|---|
| `kafelki.png` | plakietki „1. wizyta" na kafelkach w siatce dnia |
| `panel-umawiania.png` | panel z dwoma zabiegami: jeden znany klientce, drugi pierwszy raz |

## Co zostało poza zakresem

Na bardzo krótkich kafelkach (poniżej 40 minut) plakietki nie ma — nie mieści się w dwóch
linijkach. Informacja jest wtedy w chmurce i w panelu.
