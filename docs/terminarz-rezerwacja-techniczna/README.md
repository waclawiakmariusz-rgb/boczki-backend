# Rezerwacja techniczna w Terminarzu + koniec zakładania klientek z kalendarza

Dwie decyzje właściciela z 19.10.2026:

> „To dodawanie nowej klientki z poziomu terminarza jest złym pomysłem, trzeba to usunąć.
> Zamiast tego można zrobić coś takiego jak rezerwacja czasu na potrzeby techniczne — np. Ola chciałaby zrobić rezerwację gabinetu na potrzeby szkolenia lub rozmowy kwalifikacyjnej. Obecnie nie ma takiej możliwości."

## 1. Klientki zakłada się w module Klienci

Z kreatora nowej wizyty zniknął przycisk „+ Dodaj nową klientkę" razem z formularzem (imię, telefon, „Dodaj do kartoteki"). W jego miejscu jest zdanie: *„Klientki zakłada się w module **Klienci** — tam są zgody, dokumenty i kontrola duplikatów. Tutaj tylko wyszukujesz istniejący profil."*

Powód jest praktyczny: kartoteka założona w biegu przy ladzie to profil bez zgód, bez dokumentów i bez sprawdzenia, czy ta sama osoba nie figuruje już pod innym numerem. Backend i tak wymagał klientki z kartoteki — teraz interfejs mówi to wprost.

## 2. Rezerwacja techniczna

Blokady czasu istniały w module od początku (`Term_Nieobecnosci`), ale zakładać je mógł **tylko manager** i **tylko w Ustawieniach → Nieobecności i blokady**, razem z urlopami i chorobami. Recepcja, która patrzy na wolne okno w grafiku, nie miała jak zarezerwować gabinetu.

**Teraz:** przycisk **⛔ Rezerwacja techniczna** obok „+ Nowa wizyta" (role operacyjne) oraz przejście **„To nie wizyta — zarezerwuj czas technicznie"** w kreatorze wizyty, z już podstawioną godziną i osobą z klikniętej kolumny. Świadomie bez skrótu klawiaturowego: rezerwacja techniczna to normalny element pracy salonu, a nie funkcja do chowania pod gestem.

W panelu: od–do, powód (szkolenie · rozmowa/spotkanie · serwis, naprawa · inne), osoba (opcjonalnie), gabinet lub urządzenie (opcjonalnie), opis — obowiązkowy, bo zobaczy go cała zmiana. Pod spodem podpowiedź, gdzie rezerwacja będzie widoczna.

**Co z wizytami w tym czasie:** rezerwacja ich **nie odwołuje**. Jeśli nachodzi na umówione wizyty, panel najpierw pokazuje listę i dopiero drugie kliknięcie zapisuje („Zapisz mimo wizyt”). To ta sama zasada, co przy nieobecnościach.

**Szczegóły i zmiana:** kliknięcie w blokadę w siatce otwiera panel — godziny, powód, osoba, gabinet, opis i kto to zapisał. Stamtąd można przesunąć termin, zmienić powód, a najczęstszą zmianę (wydłużenie szkolenia) załatwiają przyciski **−30 min / +30 min / +1 godz.**. Zapis działa od razu: czas zwalnia się albo zajmuje w grafiku.

Nieobecności (urlop, choroba) otwierają się **tylko do podglądu** — ten panel zna wyłącznie powody techniczne, więc edycja urlopu po cichu zmieniłaby mu rodzaj. Zakłada się i zmienia je w Ustawieniach.

**Zdejmowanie:** kliknięcie w blokadę w siatce zdejmuje ją (po potwierdzeniu) — ale tylko rezerwacje techniczne. Urlop i chorobę nadal zmienia manager w Ustawieniach; klik na nich tylko to tłumaczy.

### Uprawnienia

| Rola | Zakłada rezerwację | Zdejmuje rezerwację | Urlop / choroba |
|---|---|---|---|
| Recepcja, manager, właściciel | tak | tak | tylko manager, w Ustawieniach |
| Kosmetolog | nie | nie | nie |

### Granice

- rezerwacja musi mieć początek i koniec w dobrej kolejności, najwyżej 14 dni (dłuższe przerwy to Ustawienia),
- musi wskazywać osobę **albo** gabinet/urządzenie (albo oba),
- powód spoza listy ląduje jako „inne" — urlopu i choroby nie da się tędy założyć,
- opis jest obowiązkowy.

## Próby

### `tests/terminarz-blokady.test.js` (16 prób)

| Grupa | Co sprawdza |
|---|---|
| **B01** zakładanie | zapis rezerwacji gabinetu; osoba, gabinet albo oba naraz; brak jednego i drugiego odrzucony; obowiązkowy opis; zła kolejność dat i rezerwacja dłuższa niż 14 dni; nieznana osoba i nieznany zasób; powód spoza listy → „inne” |
| **B02** wizyty w tym czasie | najpierw ostrzeżenie z listą wizyt i bez zapisu; świadome potwierdzenie zapisuje rezerwację, ale **żadna wizyta nie jest ruszana**; podgląd niczego nie zapisuje |
| **B03** uprawnienia | kosmetolog nie zakłada; recepcja zdejmuje rezerwację techniczną; urlopu recepcja nie zdejmie; manager zdejmuje wszystko |
| **B04** kreator | w `public/terminarz.js` nie ma już dodawania klientki, jest za to podpowiedź o module Klienci; obie akcje zarejestrowane w dyspozytorze |

Pełny przebieg: **652 próby w 31 zestawach.**

### Próba na izolowanej bazie

```
kreator — czy jest przycisk dodania klientki: false
kreator — podpowiedź: „Klientki zakłada się w module Klienci — tam są zgody, dokumenty…"

zapis rezerwacji: ok
blokady w dniu: ["serwis Przegląd techniczny 08:00-20:00 prac:— zasob:4",
                 "szkolenie Szkolenie Vagheggi — cały zespół 12:00-15:00 prac:Ola zasob:1"]
próba umówienia w zarezerwowanym czasie → „Ola nie pracuje w tym czasie (13:00–14:00)."
```

Po zapisie nagłówek kolumny Oli pokazuje `09:00–12:00, 15:00–17:00` — czyli rezerwacja realnie wycięła czas z dostępności, a nie tylko narysowała pasek.

### Zrzuty

| Plik | Co widać |
|---|---|
| `blok-01-kreator-bez-klientki.png` | kreator wizyty bez przycisku zakładania kartoteki |
| `blok-02-panel.png` | panel rezerwacji technicznej |
| `blok-03-grafik.png` | blokada w kolumnie Oli (12:00–15:00) i zmieniony nagłówek jej godzin |
| `blok-04-zasoby.png` | ta sama rezerwacja w widoku Zasoby — Gabinet 1 zajęty |
| `blok-05-szczegoly.png` | szczegóły po kliknięciu w blokadę: godziny, powód, skróty czasu, „Zdejmij rezerwację” |
