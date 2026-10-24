# Próba: kosmetyki (test, zapis wolno) — 2026-10-24T08:08:18.895Z

| Co | Wynik |
|---|---|
| POST-y przechwycone | 1 — delete_dictionary_entry |
| POST-y zablokowane (produkcja) | 0 |
| Alerty | „(atrapa: przechwycone)”; „✅ (atrapa: przechwycone)” |
| Confirm-y | „Usunąć produkt?

BioVital — Kolagen do picia 30 saszetek

Sprawdź wybraną pozycję przed potwierdzeniem. Usunięcie powiedzie się tylko, jeśli stan w magazynie wynosi 0 sztuk.”; „Usunąć produkt?

BioVital — Kolagen do picia 30 saszetek

Sprawdź wybraną pozycję przed potwierdzeniem. Usunięcie powiedzie się tylko, jeśli stan w magazynie wynosi 0 sztuk.” |
| Sprawdzenia | PASS: K01: licznik = liczba wierszy; PASS: K12: widoczne tylko pasujące; PASS: K06: pusta nazwa — blokuje walidacja natywna (required), 0 POST; PASS: K02/K06: istniejąca firma → 1 POST add_model {firma, model, cena}; dwuklik = 1; PASS: K03: „+ Dodaj firmę” → pole nowej firmy, „Wróć do listy firm” widoczne (te same funkcje co dotąd); PASS: K04: powrót z nowej firmy — nazwa i cena zostają, 0 nowych POST; PASS: K03: nowa firma → add_model z wpisaną nazwą firmy (zapis w tej samej operacji, jak dotąd); PASS: po zapisie formularz wraca do listy firm (jak dotąd); PASS: K07: Edytuj → dialog z danymi wybranego wpisu (old = new na starcie); PASS: K07/K08: zapis edycji → 1 POST edit_dictionary_entry {old_*, new_*}, firma jednego wpisu, dwuklik = 1; PASS: po zapisie dialog zamknięty (jak dotąd); PASS: K09: X zamyka dialog bez zapisu; PASS: K10: Usuń → anuluj: pytanie z nazwą i warunkiem stanu 0, 0 mutacji; PASS: K10: Usuń → potwierdź: 1 POST delete_dictionary_entry {firma, model} (jak dotąd; backend blokuje przy stanie > 0); PASS: K17: dialog mieści się na 400 px |
| Błędy JS | brak |
| Zrzuty | 01-01-desktop.png, 02-02-filtr.png, 03-03-formularz-wypelniony.png, 04-04-nowa-firma.png, 05-05-dialog-edycji.png, 06-06-ciemny.png, 07-07-telefon-400.png, 08-08-telefon-dialog.png |

## Payloady
```json
[
  {
    "action": "delete_dictionary_entry",
    "firma": "BioVital",
    "model": "Kolagen do picia 30 saszetek",
    "pracownik": "Ola"
  }
]
```