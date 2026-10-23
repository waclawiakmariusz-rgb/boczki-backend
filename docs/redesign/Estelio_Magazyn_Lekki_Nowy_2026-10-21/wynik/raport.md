# Próba: magazyn-produkt (test, zapis wolno) — 2026-10-23T14:07:27.937Z

| Co | Wynik |
|---|---|
| POST-y przechwycone | 1 — rap_saveProduct |
| POST-y zablokowane (produkcja) | 0 |
| Alerty | „✅ Zapisano produkt!” |
| Confirm-y | „Odrzucić zmiany?

Wprowadzone dane nie zostały zapisane.” |
| Sprawdzenia | PASS: tryb dodawania: tytuł i przycisk; PASS: M06: pusty formularz nie wysyła — blokuje walidacja natywna (nazwa, kategoria required); PASS: M02: panel otwarty, tyle opcji ile w selekcie; PASS: M04: „tygodniowa higien” bez ogonków znajduje Inwentaryzacja Tygodniowa › Higieniczne; PASS: M04: „plyny” trafia w „Płyny i dezynfekcja” (i jej podkategorię); PASS: M18: Enter w pickerze wybiera kategorię, zamyka panel i NIE wysyła formularza; PASS: M18: Escape zamyka bez zmiany wyboru; PASS: M12: dwuklik = jeden POST rap_saveProduct; PASS: M09: payload create — 7 pól + id pusty + userFull, cena pusta zostaje pusta (nie 0); PASS: tryb edycji po rap_edit(): tytuł, przycisk, etykieta ilości, rap_p_id; PASS: M10: payload edycji ma id produktu, nową nazwę i dotychczasową kategorię (pełny rekord — jak dotąd); PASS: po zapisie edycji formularz wraca do trybu dodawania; PASS: M15: Anuluj ze zmianami pyta, po zgodzie czyści formularz i wraca do listy; zero nowych POST-ów; PASS: M17: panel kategorii mieści się na 400 px |
| Błędy JS | brak |
| Zrzuty | 01-01-pusty.png, 02-02-picker-otwarty.png, 03-03-picker-szukanie.png, 04-04-referencyjny-jak-makieta.png, 05-05-w-trakcie-zapisu.png, 06-06-edycja.png, 07-07-ciemny.png, 08-08-niski-800x550.png, 09-09-telefon-400.png, 10-10-telefon-picker.png |

## Payloady
```json
[
  {
    "action": "rap_saveProduct",
    "tenant_id": "demo-test",
    "id": "P1",
    "category": "Inwentaryzacja miesięczna > Płyny i dezynfekcja",
    "nazwa": "Produkt po edycji nazwy",
    "ilosc": "3.00",
    "unit": "",
    "min": "1.00",
    "price_gross": "",
    "expiration": "",
    "userFull": "Ola"
  }
]
```