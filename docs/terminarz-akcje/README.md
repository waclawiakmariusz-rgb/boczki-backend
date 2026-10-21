# „Więcej działań" — przyciski przestały się ucinać

Zgłoszenie właściciela (ze zrzutem ekranu), 21.10.2026:
> „niepotrzebny jest ten tekst: *Nieobecność potwierdza człowiek…* / te chipsy z opcjami źle się
> prezentują: Przełóż całą wizytę / Spóźniona / Nieobecna (potwierdzona) / Odwołaj wizytę /
> Skasuj wizytę"

## Co było nie tak

Przyciski stały w zwykłym `.trm-row` — jednym rzędzie **bez zawijania**. Przy pięciu akcjach
nie mieściły się w panelu i zwężały, aż napisy ucinały się w połowie słowa. Na zrzucie od
właściciela widać **„Przełóż całą w"**, **„Nieobecna (po"**, **„Odwołaj wizyt"**.

To nie jest drobiazg kosmetyczny. Obcięta etykieta przy przycisku, który **odwołuje** albo
**kasuje** wizytę, to proszenie się o pomyłkę — zwłaszcza że obie akcje wyglądają podobnie
(obie czerwone, obie zaczynają się od innego słowa niż to, co widać).

## Jak jest teraz

- rząd działań ma własny kontener `.trm-akcje`: **zawija się** do kolejnych linii,
- żaden przycisk nie zwęża się poniżej swojej treści (`flex: 0 0 auto` + `white-space: nowrap`),
- na ekranie węższym niż 560 px **każda akcja dostaje własny rząd** na całą szerokość —
  pełne etykiety i duże cele dotykowe,
- **akapit z objaśnieniem usunięty.** Wyjaśnienie różnicy między odwołaniem a skasowaniem
  zostaje tam, gdzie decyzja naprawdę zapada: w formularzu kasowania („Jeśli klientka naprawdę
  odwołała wizytę — użyj Odwołaj wizytę, nie kasowania").

## Pomiar, nie oko

Szerokość treści przycisku (`scrollWidth`) kontra jego rzeczywista szerokość — ucięcie widać
liczbą:

```
Panel (szeroki ekran) — kontener 448px, rzędów: 2
    ok  Przełóż całą wizytę       szerokość  129  treść potrzebuje  127
    ok  Spóźniona                 szerokość   81  treść potrzebuje   79
    ok  Nieobecna (potwierdzona)  szerokość  173  treść potrzebuje  171
    ok  Odwołaj wizytę            szerokość  108  treść potrzebuje  106
    ok  Skasuj wizytę             szerokość   98  treść potrzebuje   96
ucięte przyciski: 0
czy został akapit o nieobecności/odwołaniu: false

iPhone 390px — kontener 318px, rzędów: 5
    (każdy przycisk 318 px, treść 316 — pełne etykiety)
ucięte przyciski na telefonie: 0
BLEDY JS: brak
```

| Plik | Co widać |
|---|---|
| `akcje-01-panel.png` | panel na szerokim ekranie: dwa rzędy, pełne napisy, bez akapitu |
| `akcje-02-iphone.png` | iPhone: każda akcja w osobnym rzędzie na całą szerokość |

## Testy

`tests/terminarz-akcje-wizyty.test.js` (5 prób): własny kontener zamiast `.trm-row`, zawijanie
rzędu, przyciski bez zwężania, kolumna poniżej 560 px, komplet pięciu działań i brak usuniętego
akapitu. Sprawdzone, że strażnik łapie regres — po skasowaniu `flex-wrap` próba pada.
