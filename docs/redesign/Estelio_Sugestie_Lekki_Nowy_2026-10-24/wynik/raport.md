# Próba: sugestie (test, zapis wolno) — 2026-10-24T06:26:41.403Z

| Co | Wynik |
|---|---|
| POST-y przechwycone | 1 — delete_suggestion_rule |
| POST-y zablokowane (produkcja) | 0 |
| Alerty | „(atrapa: przechwycone)” |
| Confirm-y | „Usunąć tę regułę?

Mezoterapia igłowa → Krem regenerujący SPF 30

Ta reguła zostanie usunięta z listy sugestii.”; „Usunąć tę regułę?

Mezoterapia igłowa → Krem regenerujący SPF 30

Ta reguła zostanie usunięta z listy sugestii.” |
| Sprawdzenia | PASS: S01: licznik = liczba reguł; PASS: S04: puste pola — alert jak dotąd, 0 POST; PASS: S05: A → A — dotychczasowa walidacja, 0 POST; PASS: podgląd reaguje na wpisywanie (lokalnie, 0 POST); PASS: S02/S06: dodanie → jeden POST add_suggestion_rule {matka, dziecko, opis}; dwuklik = 1 (przycisk disabled); PASS: po zapisie: opis wyczyszczony, pola zabiegów zostają (jak dotąd); PASS: S10: brak wyników — „Wyniki: 0 z Y” + „Nie znaleziono reguł”; PASS: S10: dopasowania widoczne; PASS: S07: Usuń → anuluj: pytanie z parą źródło → propozycja, 0 mutacji; PASS: S08: Usuń → potwierdź: jeden POST delete_suggestion_rule {matka, dziecko} (jak dotąd) |
| Błędy JS | brak |
| Zrzuty | 01-01-desktop.png, 02-02-formularz-z-podgladem.png, 03-03-filtr.png, 04-04-ciemny.png, 05-05-telefon-400.png |

## Payloady
```json
[
  {
    "action": "delete_suggestion_rule",
    "matka": "Mezoterapia igłowa",
    "dziecko": "Krem regenerujący SPF 30"
  }
]
```