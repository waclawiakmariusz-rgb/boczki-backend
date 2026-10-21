# Historia → Zabieg: kto chodzi na dany zabieg

Prośba właściciela, 21.10.2026:
> „w historii pokaż oprócz klient, pracownik pokaż zabieg i to tak, żeby można kilka na raz wybrać
> tych zabiegów, takie chipsy. Wtedy pokazuj unikalne osoby (czyli nawet jak Ala chodziła
> 10 zabiegów, na to chcę mieć ją pojedynczą), najlepiej z numerem telefonu »na wierzchu«."

## Co to jest

Trzeci tryb Historii, obok „Klientka" i „Pracownik". Zaznaczasz **jeden albo kilka zabiegów**
(chipsy w kolorach kategorii z cennika), klikasz „Pokaż klientki" i dostajesz **listę osób**,
nie listę wizyt. Ala, która była dziesięć razy, jest **jednym wierszem** z liczbą 10.

Taką listę bierze się do ręki i dzwoni — dlatego **telefon stoi zaraz pod nazwiskiem**,
tym samym krojem co nazwisko, a nie w szarym podpisie na końcu wiersza.

W każdym wierszu: nazwisko, telefon, ile wizyt (i ile z nich wykonanych), kiedy była ostatnio,
czy ma coś umówione, i na które z zaznaczonych zabiegów chodziła. Klik w wiersz otwiera pełną
historię tej klientki.

Nad listą pięć kafelków: **klientek · wizyt razem · wykonanych · z telefonem · ma umówioną**.
„Z telefonem" robi za ostrzeżenie: jeśli z 30 osób tylko 12 ma numer, od razu to widać,
zanim ktoś zaplanuje obdzwanianie.

## Decyzje, które podjąłem po drodze

- **Chipsy to kategorie, nie pozycje cennika.** „Endermologia", a nie „Endermologia 1x" i
  „Endermologia 10x" osobno — pytanie brzmi „kto na to chodzi", a nie „w jakim pakiecie kupiła".
- **Render nie pobiera danych sam.** Zaznaczanie chipsów tylko odświeża ekran; zapytanie idzie
  dopiero po „Pokaż klientki". To świadome — zaznaczenie pięciu zabiegów nie ma oznaczać
  pięciu zapytań do bazy (patrz wpadka z 21.10: zakładka maili robiła 349 zapytań na jedno wejście).
- **Lista nie liczy skasowanych pomyłek** (`usunieta = 1`) ani anulowanych pozycji.
- **Telefon z kartoteki**, a gdy klientka nie ma karty — z samej rezerwacji (`COALESCE`).
- **Kolejność: najpierw te, które były ostatnio.** Przy obdzwanianiu to zwykle właściwa kolejność.
- Maksymalnie 500 osób i 400 dni zakresu — te same granice, co w pozostałych widokach Historii.

## Próba w izolowanym środowisku

```
kategorie w cenniku: Depilacja laserowa — pachy | Endermologia | Fala uderzeniowa | Konsultacja |
                     Masaż relaksacyjny 60 min | Meltivio | Mezoterapia igłowa | Oczyszczanie wodorowe | Pakiet łączony

bez zaznaczonego zabiegu: error — Wybierz przynajmniej jeden zabieg.
przelacznik w Historii: Klientka | Pracownik | Zabieg
przycisk przed zaznaczeniem: nieaktywny

zaznaczone: Depilacja laserowa — pachy + Endermologia | chipsy włączone: 2
czy render sam pobrał dane (nie powinien): false

kafelki: 9 klientek | 25 wizyt razem | 1 wykonanych | 9 z telefonem | 7 ma umówioną
wierszy (unikalnych osob): 9
pierwszy wiersz: Julia Wiśniewska 601 200 302 · 3 wizyty (1 wykonanych) · ostatnia: Cz 22.10 · umówiona Cz 22.10 09:00
telefon widoczny w wierszu: true

po kliknieciu w osobe — tryb: klientka | klientka: Julia Wiśniewska
BLEDY JS: brak
```

Sprawdzenie unikalności wprost: **9 wierszy przy 25 wizytach**.

| Plik | Co widać |
|---|---|
| `zabieg-01-chipsy.png` | chipsy zabiegów, przycisk nieaktywny do czasu zaznaczenia |
| `zabieg-02-lista.png` | lista unikalnych klientek z telefonem na pierwszym planie |
| `zabieg-03-przejscie.png` | klik w wiersz → pełna historia tej klientki |

## Testy

`tests/terminarz-historia-zabiegu.test.js` (9 prób): brak zaznaczenia nie odpytuje bazy,
specjalistka nie przegląda cudzych klientek, zakres do 400 dni, kilka zabiegów naraz bez
duplikatów, grupowanie po klientce, telefon z kartoteki, pominięcie skasowanych i anulowanych,
podsumowanie (w tym „z telefonem"), kolejność od ostatnich wizyt. Pełny zestaw: **805/805**.
