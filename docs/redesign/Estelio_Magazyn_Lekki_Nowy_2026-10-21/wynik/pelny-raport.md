# Próba: magazyn-produkt-pelny (test, zapis wolno) — 2026-10-23T14:14:20.666Z

| Co | Wynik |
|---|---|
| POST-y przechwycone | 0 |
| POST-y zablokowane (produkcja) | 0 |
| Alerty | „✅ Zapisano produkt!” |
| Confirm-y | — |
| Sprawdzenia | PASS: serwer potwierdził utworzenie (prawdziwy POST); PASS: M09: produkt na liście magazynu: ilość 12 (bez podwójnego naliczenia), cena 49; PASS: M12: ten sam produkt drugi raz — backend odmawia (duplikat w kategorii), bez fałszywego sukcesu; PASS: edycja wczytała ilość 12, kategorię i cenę; PASS: serwer potwierdził edycję; PASS: M10: zmiana nazwy nie zmieniła ilości i nie zostawiła starego wpisu |
| Błędy JS | brak |
| Zrzuty | 01-01-gotowy-do-zapisu.png, 02-02-lista-z-nowym-produktem.png, 03-03-edycja-wczytana.png, 04-04-lista-po-edycji.png |

## Payloady
```json
[]
```