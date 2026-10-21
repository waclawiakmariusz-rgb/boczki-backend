# Kolory stanów w historii klientki

Zgłoszenie właściciela, 21.10.2026:
> „kolory w panelu historii dla konkretnego klienta: odbyła się / zaplanowana / odwołana /
> nieobecność / skasowana (pomyłka) — te kolory są takie same, zrób jakieś zupełnie odmienne
> typu niebieski, zielony, czerwony itd, a nie to samo."

## Co było nie tak

Kwadracik w legendzie miał **12 × 12 px, tło karty (białe) i 3-pikselowy pasek z boku** w kolorze
stanu. Formalnie pięć różnych reguł — w praktyce pięć białych kwadracików, bo kolor zajmował
jedną czwartą szerokości i ginął. Same wiersze też różniły się tylko wąskim paskiem.

## Jak jest teraz

| Stan | Kolor | Co jeszcze go odróżnia |
|---|---|---|
| odbyła się | **zielony** `#15803D` | szare tło (rzecz zamknięta — tak prosił właściciel wcześniej) |
| zaplanowana | **niebieski** `#1D4ED8` | lekko błękitne tło |
| odwołana | **pomarańczowy** `#D97706` | lekko miodowe tło |
| nieobecność | **czerwony** `#DC2626` | lekko różowe tło |
| skasowana (pomyłka) | **szary** `#6B7280` | **kreskowane tło** + przekreślona data |

- kwadrat legendy: **14 × 14 px, wypełniony w całości** kolorem stanu,
- pasek z lewej strony wizyty: **5 px** w tym samym kolorze,
- plakietka słowna („Odbyła się", „Nieobecność"…) dostała ten sam odcień, więc jedno tłumaczy drugie,
- tryb ciemny ma własne, jaśniejsze warianty tych samych barw (`--h-*` pod `body.dark-mode`).

Kolor nie jest jedynym nośnikiem — każdy stan ma podpis w legendzie i plakietkę przy dacie,
a skasowana pomyłka dodatkowo kreskowanie (czytelne przy daltonizmie i na wydruku).

## Pułapka, w którą wpadłem po drodze

Pierwsza wersja zapisywała skrót CSS w złej kolejności:

```css
/* ŹLE: border-color po border-left kasuje kolor lewej krawędzi */
.trm-hist-wizyta.planowana { border-left:5px solid var(--h-plan); border-color:#DCE6FA; }
```

Pomiar pokazał `pasek rgb(220, 230, 250)` zamiast niebieskiego — czyli dokładnie to samo zlanie
kolorów, które miałem naprawić. Stąd osobna próba pilnująca kolejności tych dwóch właściwości.

## Pomiar (izolowane środowisko, nie „na oko")

```
LEGENDA — wyliczony kolor kwadratu:
    odbyła się             rgb(21, 128, 61)      14px×14px
    zaplanowana            rgb(29, 78, 216)      14px×14px
    odwołana               rgb(217, 119, 6)      14px×14px
    nieobecność            rgb(220, 38, 38)      14px×14px
    skasowana (pomyłka)    wzór (kreskowanie)    14px×14px
różnych kolorów w legendzie: 5 z 5

WIERSZE — pasek z lewej i tło:
    nieobecna   So 24.10   pasek rgb(220, 38, 38) 5px    tło rgb(253, 241, 241)   Nieobecność
    skasowana   Pt 23.10   pasek rgb(107, 114, 128) 5px  tło wzór                 Skasowana
    planowana   Cz 22.10   pasek rgb(29, 78, 216) 5px    tło rgb(243, 247, 254)   Zaplanowana
    wykonana    Cz 22.10   pasek rgb(21, 128, 61) 5px    tło rgb(244, 244, 246)   Odbyła się
    odwolana    Śr 21.10   pasek rgb(217, 119, 6) 5px    tło rgb(255, 248, 236)   Odwołana

LEGENDA W TRYBIE CIEMNYM:
    odbyła się  rgb(75, 168, 119) · zaplanowana rgb(127, 167, 245) · odwołana rgb(224, 161, 74)
    nieobecność rgb(240, 120, 120) · skasowana  wzór
BLEDY JS: brak
```

| Plik | Co widać |
|---|---|
| `kolory-01-historia.png` | legenda i góra listy — czerwień, kreskowanie, błękit |
| `kolory-02-dalej.png` | dalsza część listy — zieleń („odbyła się") i pomarańcz („odwołana") |
| `kolory-03-ciemny.png` | ten sam ekran w trybie ciemnym |

## Testy

`tests/terminarz-kolory-historii.test.js` (11 prób) czyta arkusz i sprawdza, czy kolory
**naprawdę** się różnią: pięć różnych wartości, co najmniej 30° różnicy odcienia między czterema
barwnymi stanami, nasycenie powyżej 0,3 (to ma być kolor, nie szarość), stan skasowany poniżej
0,25 (szarość), wypełnienie kwadratu kolorem stanu, rozmiar ≥ 14 px i kolejność `border-color`
przed `border-left`.

Sprawdzone, że strażnik łapie błędy: po przywróceniu starego kwadracika, bordowego koloru
zamiast niebieskiego i złej kolejności właściwości — **3 z 11 prób padają**.
