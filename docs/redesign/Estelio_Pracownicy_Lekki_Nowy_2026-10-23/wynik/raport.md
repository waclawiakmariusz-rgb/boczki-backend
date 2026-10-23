# Próba: pracownicy (test, zapis wolno) — 2026-10-23T15:03:34.001Z

| Co | Wynik |
|---|---|
| POST-y przechwycone | 1 — delete_employee |
| POST-y zablokowane (produkcja) | 0 |
| Alerty | „(atrapa: przechwycone)”; „(atrapa: przechwycone)”; „(atrapa: przechwycone)” |
| Confirm-y | „Usunąć pracownika?

Czy chcesz usunąć Anna z listy pracowników?
Osoba zniknie z listy przy sprzedaży. Wcześniejsze sprzedaże zapisane na tę osobę zostają.”; „Usunąć pracownika?

Czy chcesz usunąć Anna z listy pracowników?
Osoba zniknie z listy przy sprzedaży. Wcześniejsze sprzedaże zapisane na tę osobę zostają.” |
| Sprawdzenia | PASS: P01: licznik = liczba wierszy z danych; PASS: P03: pusty formularz + Enter — zero żądań, blokuje walidacja natywna (required); PASS: P04: dodanie → jeden POST add_sales_def {typ:Pracownik, wartosc}; PASS: P04: po odpowiedzi pole wyczyszczone (jak dotąd); PASS: P06: samo imię przechodzi bez nowej reguły dwóch wyrazów; PASS: P07: Usuń → Anuluj: pytanie z nazwą, zero mutacji; PASS: P08: Usuń → potwierdź: jeden POST delete_employee z imieniem (jak dotąd); PASS: P02: na telefonie „Usuń” z tekstem i min. 44 px |
| Błędy JS | brak |
| Zrzuty | 01-01-desktop.png, 02-02-dluga-nazwa.png, 03-03-ciemny.png, 04-04-telefon-400.png, 05-05-telefon-320.png |

## Payloady
```json
[
  {
    "action": "delete_employee",
    "imie": "Anna",
    "pracownik": "Ola"
  }
]
```