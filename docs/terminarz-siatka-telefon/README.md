# Siatka dnia na telefonie — kafelki zamiast listy zastępczej

Zgłoszenie właściciela, 21.10.2026:
> „siatka terminarza na telefonie nadal prezentuje się źle, chcę widzieć kafelki,
> a nie zastępczy uproszczony interfejs"

## Co było nie tak

Przy ekranie węższym niż 760 px widok Dnia **podmieniał się na listę**:

```js
if (TRM.widok === 'moj' || waski()) { renderAgendaDnia(); … }
```

Decyzja z audytu iPhone'a (`docs/terminarz-iphone/`) brzmiała: „siatka z pięcioma kolumnami na
390 px byłaby nieczytelna". Okazała się błędna — siatka **od początku umiała przewijać się
w poziomie** (kolumna godzin przyklejona z lewej), więc wystarczyło przestać ją podmieniać.

## Co zrobiłem

1. **Telefon dostaje tę samą siatkę co komputer.** Listą zostaje „Mój dzień" — tam jest jedna
   osoba i kolumny nie mają sensu.
2. **Kolumna godzin naprawdę się przykleja.** `kolumnaGodzin()` wstawiała w stylu wiersza
   `position:relative`, co wygrywało z arkuszem — przy przewijaniu w bok godziny odjeżdżały
   razem z kolumnami i nie było wiadomo, na którą godzinę patrzysz.
3. **Kafelek nie blokuje przesuwania.** Miał `touch-action: pan-y`, więc palec położony na
   wizycie nie przesuwał siatki w bok. Na telefonie jest `pan-x pan-y` (przeciąganie wizyty
   i tak ustępuje przewijaniu).
4. **Nagłówek ścieśniony.** Pomiar: siatka zaczynała się **758 px** od góry przy ekranie 844 px,
   czyli pod zgięciem. Mniejsze odstępy, mniejszy tytuł, zwinięty pasek zmian, ukryta
   „Ostatnia aktualizacja" → **667 px**.
5. **Po wejściu w widok Dnia telefon przewija do siatki** i od razu pokazuje zajętą część dnia
   (pierwsza wizyta tuż pod rzędem z imionami), zamiast pustego poranka. Tylko po kliknięciu
   zakładki — przy odświeżaniu danych pozycja zostaje tam, gdzie ją zostawiono.
6. **Dymek podglądu mieści się w ekranie** — wystawał o 20 px poza lewą krawędź.

## Trzy pułapki, które wyszły dopiero w pomiarze

- **`scroll-behavior: smooth`** na kontenerze treści: samo przypisanie `scrollTop` **animuje**
  przewijanie, więc kolejny render (po dociągnięciu preferencji klientek) odtwarzał pozycję
  złapaną w połowie animacji i ekran wracał na górę. Stąd `scrollTo({ behavior: 'auto' })`
  i powtórzenie skoku po 350 ms.
- **Pasek aplikacji z hamburgerem** jest przyklejony na górze: siatka wjeżdżała pod niego
  i znikał rząd z imionami. Wysokość paska liczymy z DOM (`elementFromPoint` + pozycja fixed).
- **Pusty poranek**: siatka zaczyna się o 08:00, a wizyty bywają po 15:00 — bez skoku do
  pierwszej wizyty telefon pokazywał pustą kratkę i wyglądało to na „brak wizyt".

## Pomiar (iPhone 390 × 844)

```
siatka na ekranie: true | kafelków: 2 | wierszy listy zastępczej: 0
kolumn osób: 3 · szerokość kolumny: 197px
siatka widoczna: 344px, treść: 650px → przewijanie w bok: true
kolumna godzin: sticky · wysokość siatki: 692px
dokument 390px / ekran 390px → ok, strona nie wystaje
kafelek, touch-action: pan-x pan-y
po wejściu w Dzień — pozycja siatki względem ekranu: 75px (pod paskiem aplikacji)

po przesunięciu w bok o 400px:
   widoczne osoby: Marta, Ola
   godziny nadal widoczne z lewej: true

klik w kafelek → dymek podglądu: true
   dymek: {"szerokosc":366,"poza_prawo":0,"poza_lewo":0,"poza_dol":0}
BLEDY JS: brak
```

| Plik | Co widać |
|---|---|
| `siatka-01-telefon.png` | siatka z kafelkami na iPhonie, imiona u góry, dzień od pierwszej wizyty |
| `siatka-02-przesunieta.png` | po przesunięciu w bok: Marta i Ola, godziny nadal z lewej |
| `siatka-03-szczegoly.png` | dymek podglądu wizyty, cały w ekranie |
| `pomiar.js` | ile ekranu zjada nagłówek, zanim zacznie się siatka |

## Testy

6 prób w `tests/terminarz-widoki.test.js`: widok Dnia nie podmienia się na listę, lista zostaje
w „Moim dniu", kolumna godzin przyklejona (bez inline `position`), `touch-action` kafelka,
przewijanie do siatki z uwzględnieniem paska aplikacji i `behavior: 'auto'`, dymek w granicach
ekranu. Pełny zestaw: **822/822**.
