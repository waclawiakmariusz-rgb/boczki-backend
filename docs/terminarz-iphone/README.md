# Terminarz na iPhonie — audyt i poprawki (21.10.2026)

Prośba: *„czas na sprawdzenie, jak ten moduł terminarza i wszystkie w nim zawarte elementy
prezentują się na iPhone, czy to się nam nie rozjeżdża"*.

## Jak sprawdzone

Prawdziwa emulacja urządzenia w Chrome (nie samo zwężenie okna): rozmiar ekranu, gęstość pikseli ×3,
obsługa dotyku i user agent Safari na iOS 18. Przejście po **12 widokach i panelach**:
dzień, tydzień, agenda, zasoby, historia, ustawienia, trzy kroki umawiania wizyty, szczegóły wizyty,
rezerwacja techniczna, centrum spraw. Dwa rozmiary: **iPhone 14 (390×844)** i **iPhone SE (375×667)**,
oba motywy.

Mierzone automatycznie: szerokość dokumentu kontra szerokość ekranu, każdy element wystający poza
prawą krawędź (z pominięciem tych, które mają własne przewijanie), każdy przycisk mniejszy niż 32 px.

## Co było nie tak

```
dzien      dokument 390 px / ekran 390 px — ok | wystaje: 8 | male cele: 2
   ↳ poza ekranem o 16 px: div#trm-views „DzieńTydzieńAgendaZasobyHistoria"
   ↳ poza ekranem o 11 px: button „Historia"
   ↳ poza ekranem o 56 px: div.trm-ag-notatka „Prosi o cieplejszy gabinet, alergia na o…"
   ↳ poza ekranem o 56 px: div.trm-pref „☕Kawa z mlekiem🌡️Woli ciepło💬Woli cisz…"
   ↳ maly cel 13×13: input (pokaż anulowane)
   ↳ maly cel 103×24: button „Co się zmieniło?"
ustawienia dokument 390 px — ok | wystaje: 1
   ↳ poza ekranem o 12 px: div.trm-card „Godziny otwarcia salonu…"
```

Trzy rzeczy, każda z własną przyczyną:

1. **Zakładka „Historia" ucięta krawędzią ekranu.** Pasek pięciu widoków nie mieści się w 390 px,
   a nie miał ani zawijania, ani przewijania — ostatnia zakładka po prostu wychodziła poza ekran.
2. **Karty wizyt wystawały o 56 px.** Dzieci siatki CSS mają domyślnie `min-width:auto`, więc długa
   notatka i rząd chipsów preferencji rozpychały wiersz ponad szerokość ekranu.
3. **Wiersz godzin w Ustawieniach** (nazwa dnia + przełącznik + dwa pola czasu + „Dodaj przerwę")
   miał 380 px minimalnej szerokości i wypychał całą kartę poza ekran.

Do tego cele dotyku: linki-przyciski miały 24 px wysokości, a checkbox 13×13 px — przy zalecanych
przez Apple 44 px to trafianie na wyczucie.

## Co poprawione

- pasek widoków **zawija się** do dwóch rzędów zamiast chować „Historię" (zawijanie jest uczciwsze
  od przewijania w poziomie: widać wszystkie zakładki),
- `min-width:0` i zawijanie treści w kartach wizyt — notatka i chipsy układają się w kolejnych liniach,
- wiersz godzin w Ustawieniach zawija się na wąskim ekranie,
- cele dotyku poza panelem: 38 px wysokości i 44 px szerokości minimum, checkbox 20×20 w etykiecie
  o wysokości 38 px (w panelu umawiania było to zrobione już wcześniej),
- zapas 72 px na dole modułu, bo pływający przycisk pomocy zasłaniał ostatnią kartę listy,
- długi chips preferencji („Zawsze przychodzi 15 minut wcześniej") zawija się zamiast być ucinany.

Wszystko w regułach `@media (max-width: 760px)` — na komputerze nic się nie zmienia.

## Wynik po poprawkach

```
iPhone 14 (390×844), motyw jasny:   12 widoków, rozjazdów 0, nic nie wystaje poza ekran
iPhone 14 (390×844), motyw ciemny:  12 widoków, rozjazdów 0
iPhone SE (375×667):                12 widoków, rozjazdów 0
BLEDY JS: brak
```

Zostają dwa „małe cele" w pomiarze — to **same checkboxy 20×20**, które siedzą w etykietach
o wysokości 38–44 px, czyli palec trafia w etykietę, nie w kwadracik. To fałszywy alarm miernika,
nie usterka.

Pełny zestaw testów: **715/715**.

| Plik | Co widać |
|---|---|
| `po-dzien.png` | góra widoku dnia: pasek widoków w dwóch rzędach, „Historia" cała widoczna |
| `po-karty.png` | lista wizyt: chipsy i notatki zawinięte, kolory kategorii na lewej krawędzi |
| `po-panel-umawiania.png` | panel umawiania na pełnym ekranie, stopka z „Umów wizytę" na dole |
| `po-ustawienia.png` | Ustawienia → godziny otwarcia, wiersz dnia zawinięty |
| `po-dzien-ciemny.png` | ten sam widok w trybie ciemnym |

## Czego nie ruszałem

Widok **Dzień na telefonie to lista**, nie siatka z kolumnami — i tak zostaje: siatka z pięcioma
kolumnami na 390 px byłaby nieczytelna. Przeciąganie kafelka-szkicu (#11) działa myszą i piórem;
na dotyku pierwszeństwo ma przewijanie ekranu, więc na telefonie godzinę wybiera się z listy.

## Dopisek 21.10.2026

Po zdjęciu widoku „Tydzień" (patrz `docs/terminarz-widoki/`) pasek widoków ma cztery pozycje
i **mieści się w jednym rzędzie**: 312 px przy ekranie 390 px, zero pikseli poza krawędzią.
Zawijanie do dwóch rzędów zostaje jako zabezpieczenie dla węższych telefonów.
