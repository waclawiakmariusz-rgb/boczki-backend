# Zgłoszenie #11 — kafelek widoczny od razu i przesuwalny

Gosia (recepcja), 20.10.2026: *„Gdy wpisuje się usługę, nie pojawia się ona od razu na ekranie.
Dopiero po wybraniu godziny ją widać. Łatwiej byłoby, gdyby kafelek był »przesuwalny«, po pojawieniu
się można byłoby go od razu przestawić w odpowiednie miejsce."*

## Jak było

Kolejność była sztywna: zabieg → godzina z listy wolnych terminów → dopiero wtedy coś widać na
siatce (zielona „propozycja"). Przy wejściu z przycisku „+ Nowa wizyta" (bez klikniętej godziny)
siatka przez cały czas wyboru pozostawała pusta.

## Jak jest

**Szkic pojawia się zaraz po dodaniu zabiegu** — przerywana ramka w kolumnie wybranej osoby,
z godziną, nazwą zabiegu i podpowiedzią „przeciągnij na właściwą godzinę". Długość kafelka to
suma czasów wybranych zabiegów, więc od razu widać, ile miejsca zajmie wizyta.

**Przeciąganie ustawia termin**: w pionie godzinę (ze skokiem ustawionym w Ustawieniach — 5/10/15/30
minut), w poziomie osobę (przeniesienie do innej kolumny zmienia wykonawcę). Po puszczeniu idzie
**zwykłe sprawdzenie dostępności** — to samo, co przy wyborze godziny z listy, więc grafik, gabinet
i urządzenie są sprawdzane tak samo. Nic nie jest zapisywane do czasu kliknięcia „Umów wizytę".

Przeciągnąć można też gotową zieloną propozycję — „przesuwalny kafelek" działa niezależnie od tego,
czy godzina już padła.

Przeciągnięcie w kreatorze przeskakuje na krok „Termin": skoro ktoś wskazał miejsce na siatce,
decyzja o terminie już zapadła i od razu widać jej wynik.

## Próba (izolowane środowisko)

```
szkic przed dodaniem zabiegu: 0
szkic PO dodaniu zabiegu (bez wybierania godziny): 1
tresc szkicu: 08:00–09:00 Endermologia / 1x przeciągnij na właściwą godzinę
w kolumnie: Anna
godzina w stanie panelu: 2026-10-23 00:00 | wybrana? false

przeciaganie: z kolumny Anny do kolumny Oli, 160 px w dół
po przeciagnieciu — start: 2026-10-23T09:45
                    wykonawca: Ola
                    stan dostepnosci: ok
                    propozycja na siatce: 1 | szkic: 0
BLEDY JS: brak
```

Czyli: szkic znika dopiero wtedy, gdy zastąpi go potwierdzona propozycja.

| Plik | Co widać |
|---|---|
| `zgloszenie-gosi.png` | zrzut z ticketu: panel z dwoma zabiegami, siatka bez kafelka |
| `szkic-po-dodaniu-zabiegu.png` | szkic w kolumnie Anny zaraz po dodaniu zabiegu, przed wyborem godziny |
| `po-przeciagnieciu.png` | po przeciągnięciu do kolumny Oli: krok „Termin", wykonawca Ola, termin dostępny |
| `szkic-ciemny.png` | szkic w trybie ciemnym |

## Czego nie ma

Przeciąganie obsługuje mysz i pióro; na tablecie dotykiem nadal wybiera się godzinę z listy
(ten sam wyjątek co przy przesuwaniu istniejących wizyt — gest przewijania siatki ma pierwszeństwo).
