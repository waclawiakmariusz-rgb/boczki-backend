# Zgłoszenie #10 — „wykonawca w dwóch miejscach"

Gosia (recepcja), 20.10.2026: *„Gdy chcę umówić konkretną wizytę jest w dwóch miejscach wykonawca,
nie rozumiem dlaczego. Na zrzucie widać, że Julia wykona usługę i jednocześnie wykonawca to
Dominika."* — zrzut: `zgloszenie-gosi.png`.

## Co się naprawdę działo

Wykonawca był w **trzech** miejscach, z czego tylko jedno trafiało do bazy:

1. nagłówek panelu („· DominikaR") — w rzeczywistości **kolumna**, w którą kliknięto,
2. lista „Usługi i wykonawcy" — prawdziwy wykonawca, osobno przy każdym zabiegu,
3. pole „Wykonawca" w kroku z terminem — **ustawienie hurtowe**, nie stan wizyty.

Pole (3) ustawia wybraną osobę przy każdym zabiegu, ale tylko tam, gdzie wolno jej go wykonywać
(lista „Kto wykonuje zabieg?" przy usłudze). Przy pozostałych `terminarz.js` po cichu wstawiał
`pracownik = null`, czyli „ktokolwiek" — silnik dobierał inną osobę, a w polu nadal widniała ta
wybrana. Stąd „Julia wykona, a wykonawca to Dominika". Żadnego komunikatu, żadnego śladu.

## Co zmieniono

- Pole nazywa się teraz **„Wykonawca dla wszystkich zabiegów"** — widać, że to ustawienie hurtowe.
- Gdy wybrana osoba nie wykonuje któregoś zabiegu, pod polem pojawia się ostrzeżenie z nazwą
  zabiegu i informacją, że wykona go osoba dobrana automatycznie. Manager dostaje skrót
  „Przypisz … do tego zabiegu →" prosto do Ustawień; recepcja — zdanie, kogo o to poprosić.
- Nagłówek panelu mówi **„· z kolumny Marta"** zamiast samego imienia, żeby nie udawał wykonawcy.

## Próba (izolowane środowisko)

Marta nie wykonuje „Endermologii / 1x" (w danych testowych: tylko Anna i Ola):

```
naglowek panelu: Nowa wizyta | Czwartek, 22 października 2026 · z kolumny Marta
etykieta pola:   Wykonawca dla wszystkich zabiegów
wartosc pola:    Marta
ostrzezenie:     ⚠ Marta nie wykonuje zabiegu: Endermologia / 1x. Ten zabieg wykona osoba
                 dobrana automatycznie — zobaczysz ją niżej, po wybraniu godziny.
                 Przypisz Marta do tego zabiegu →
wykonawca w pozycji: [{"usluga":"DEMO-U-A","pracownik":null}]

po zmianie na Anne (wykonuje ten zabieg):
  ostrzezenie: brak (poprawnie)
  wykonawca w pozycji: ["Anna"]
BLEDY JS: brak
```

Zachowanie zapisu nie zmieniło się ani o jotę — zmieniło się to, że recepcja widzi, co się dzieje.

| Plik | Co widać |
|---|---|
| `zgloszenie-gosi.png` | zrzut z ticketu: pole „WYKONAWCA: DominikaR", a niżej „— Julia" |
| `ostrzezenie-jasny.png` | nowe ostrzeżenie pod polem, z linkiem dla managera |
| `ostrzezenie-ciemny.png` | to samo w trybie ciemnym (Gosia pracuje na ciemnym) |
