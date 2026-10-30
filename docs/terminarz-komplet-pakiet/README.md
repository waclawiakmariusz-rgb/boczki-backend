# Komplet kilku zabiegów z pakietu, różne osoby — pokaz z 30.10.2026 (baza izolowana)

Pytanie właściciela: klient ma wykupione pakiety, chce 1× A (u Oli), 2× B i 1× C (ktokolwiek). Jak system to rozplanuje i jak pokaże?

Pokaz na salonie demo: Julia Wiśniewska, pakiet łączony 5× Endermologia + 4× Meltivio. Umówione: 1× Endermologia (Ola), 2× Meltivio (dowolna), 1× Endermologia (dowolna), start 10:00 w poniedziałek.

| Zrzut | Co pokazuje |
|---|---|
| `01-komplet-01-karta-wyniku.png` | lista wolnych godzin dla całego kompletu, wybrane 10:00; na siatce niebieskie „propozycje” tam, gdzie wylądują kolejne zabiegi |
| `02-komplet-02-pozycje-i-wykonawcy.png` | cztery pozycje „Z pakietu”, każda z własnym wykonawcą: Ola przy pierwszej, „Dowolna właściwa osoba” przy pozostałych |
| `03-komplet-03-siatka-kolumny-roznych-osob.png` | po zapisie: jedna wizyta EST-0263, kafelek 10:00–11:00 u Oli i kafelek 11:10–13:40 u Anny (trzy pozycje) |
| `04-komplet-04-panel-cztery-pozycje.png` | panel wizyty: cztery pozycje po kolei z godzinami, wykonawcą, gabinetem/urządzeniem i znacznikiem „Z pakietu” |

Jak silnik to ułożył: 10:00–11:00 Endermologia → Ola · 11:10–11:55 Meltivio → Anna · 11:55–12:40 Meltivio → Anna · 12:40–13:40 Endermologia → Anna · przerwa 10 min (bufor „po” Endermologii).
Reguły: pozycje jedna po drugiej w kolejności dodania; wskazana osoba = tylko ona; „dowolna” = pierwsza kompetentna i wolna w tym oknie (bez preferencji ciągłości); gabinet i urządzenie dobierane z puli zabiegu; każda kolumna pokazuje kafelek tylko ze swoimi pozycjami.

Scenariusz: scratch `komplet-pakiet.json` (wymagał zatwierdzenia stanu składników pakietu Julii jako manager — w demo były „do sprawdzenia”). Wizyta pokazowa po zrzutach usunięta.
