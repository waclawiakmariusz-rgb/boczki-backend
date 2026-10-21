# Historia bez podsumowania wartości

Polecenie właściciela, 21.10.2026:
> „w historii skasuj »559,00 zł / wartość wykonanych« — takich informacji nie pokazuj
> przy kliencie i przy pracowniku w Historia."

## Co zniknęło

Kafelek **„wartość wykonanych"** z podsumowania nad listą — w obu trybach Historii:

- **Klientka** — zostaje: wizyt · wykonanych · odwołanych · nieobecności · skasowanych (pomyłki),
- **Pracownik** — zostaje: wykonanych zabiegów · klientek · czas przy pracy · odwołanych · nieobecności.

Historia ma odpowiadać na pytanie **co się działo** — kto przyszedł, co zrobiliśmy, co przepadło.
Sumowanie wartości zamieniało ją w raport przychodu o konkretnej klientce, a przy pracowniku
czytało się jak ocena wyników. Od pieniędzy jest Sprzedaż, Analiza i profil klientki.

## Czego NIE ruszałem (do decyzji)

Przy **każdej pozycji** listy nadal stoi kwota pojedynczego zabiegu (np. `200,00 zł`) — widać ją
na obu zrzutach po prawej stronie wiersza. Polecenie dotyczyło podsumowania; kwoty przy
pozycjach zostały, bo recepcja czasem potrzebuje wiedzieć, ile kosztował dany zabieg.
Jeśli mają zniknąć też one — to jedna linijka w każdym z dwóch widoków.

Backend nadal liczy i oddaje `podsumowanie.wartosc` (akcje `trm_historia_klientki`
i `trm_historia_pracownika`) — nic nie wycinałem z API, żeby nie ruszać rzeczy, których
ta prośba nie dotyczyła. Pole po prostu nie jest wyświetlane.

## Próba w izolowanym środowisku

```
kafelki u klientki:  6 wizyt | 1 wykonanych | 1 odwołanych | 1 nieobecności | 2 skasowanych (pomyłki)
czy gdziekolwiek „wartość wykonanych": false

kafelki u pracownika: 1 wykonanych zabiegów | 10 klientek | 1 h czas przy pracy | 9 odwołanych | 2 nieobecności
czy gdziekolwiek „wartość wykonanych": false

BLEDY JS: brak
```

| Plik | Co widać |
|---|---|
| `kwoty-01-klientka.png` | Historia → Klientka: pięć kafelków, bez wartości |
| `kwoty-02-pracownik.png` | Historia → Pracownik: pięć kafelków, bez wartości |

## Testy

`tests/terminarz-historia-bez-kwot.test.js` (5 prób): żaden z dwóch widoków nie buduje kafelka
„wartość wykonanych", nie ma go nigdzie w module, a pozostałe kafelki są na swoim miejscu
(gdyby ktoś przy okazji wyciął za dużo). Pełny zestaw: 782/782.
