# Próba: kategorie-magazyn (test, zapis wolno) — 2026-10-23T15:34:45.894Z

| Co | Wynik |
|---|---|
| POST-y przechwycone | 1 — rap_deleteCategory |
| POST-y zablokowane (produkcja) | 0 |
| Alerty | „✅ Dodano Kategorię!”; „✅ Zmieniono nazwę na „undefined”.”; „✅ Przeniesiono do „undefined”.” |
| Confirm-y | „⚠️ Czy na pewno usunąć tę kategorię?” |
| Sprawdzenia | PASS: KAT01: licznik = liczba wszystkich kategorii (niezależnie od rozwinięcia); PASS: Zwiń wszystko — licznik bez zmian; PASS: Rozwiń wszystko — wszystkie gałęzie otwarte; PASS: szukanie pokazuje dopasowania z przodkami; PASS: KAT13: brak dopasowań — osobny komunikat, nie pusta baza; PASS: po wyczyszczeniu filtra wszystko widoczne; PASS: KAT06: dialog otwarty, opcje = select (+ Poziom główny zaznaczony); PASS: KAT06: Anuluj — roboczy wybór odrzucony, select bez zmian; PASS: filtr w dialogu bez ogonków → 1 opcja z pełną ścieżką; PASS: Wybierz miejsce — select ustawiony na id Higieniczne, opis zmieniony; PASS: KAT03/KAT04: podkategoria — 1 POST rap_saveCategory {name, parentId=id rodzica}; dwuklik = 1; PASS: po zapisie: nazwa wyczyszczona, rodzic zachowany (jak dotąd); PASS: KAT04: pusta nazwa — blokuje walidacja natywna, 0 POST; PASS: KAT09: Zmień nazwę → rap_editCategory {id, nazwa} (prompt jak dotąd); PASS: KAT08: Przenieś → rap_editCategory {id, parentId} (prompt numerowany jak dotąd; 0 = poziom główny); PASS: KAT10: Usuń → confirm → rap_deleteCategory {id} (jak dotąd; backend blokuje niepuste); PASS: KAT02: dialog mieści się na 400 px; PASS: KAT06: Escape zamyka dialog bez zmiany |
| Błędy JS | brak |
| Zrzuty | 01-01-desktop.png, 02-02-szukanie.png, 03-03-dialog-wyboru-miejsca.png, 04-04-formularz-podkategoria.png, 05-05-menu-akcji.png, 06-06-ciemny.png, 07-07-telefon-400.png, 08-08-telefon-dialog.png |

## Payloady
```json
[
  {
    "action": "rap_deleteCategory",
    "tenant_id": "demo-test",
    "id": "K-MIE"
  }
]
```