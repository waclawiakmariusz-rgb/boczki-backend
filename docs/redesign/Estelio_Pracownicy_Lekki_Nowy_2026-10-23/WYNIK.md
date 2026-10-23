# Pracownicy — wynik wdrożenia redesignu (23.10.2026)

Zasada właściciela: wyłącznie oprawa; logika bez zmian. Gałąź `dev`. Bez main/produkcji. Próby: izolowana MariaDB 3307, salon `demo-test`.

## 1. Mapa (rozdz. 2 specyfikacji)

| Pytanie | Ustalenie z kodu |
|---|---|
| Ekran | `#setup-pracownicy` w `public/index.html`; lista renderowana w `pobierzSlownikSprzedazy()` do `#pracownicy-list` z `d.pracownicy` (ta sama tablica zasila chipy sprzedawców w Sprzedaży → P13 konstrukcyjnie zachowane) |
| Dodawanie | `dodajDefinicje(event,'Pracownik')` → `add_sales_def {typ:'Pracownik', wartosc, pracownik}`; po odpowiedzi `alert(d.message)`, `pobierzSlownikSprzedazy(true)`, czyszczenie pola |
| Identyfikator | **brak ID** — rekord identyfikowany **imieniem** (tekst); backend `DELETE FROM Pracownicy WHERE imie = ? LIMIT 1` |
| Usuwanie — rzeczywisty skutek | `usunPracownika(imie)` → `confirm` → `delete_employee` → fizyczne usunięcie wiersza z `Pracownicy`. Sprzedaże trzymają sprzedawcę jako tekst (`Sprzedaz.sprzedawca`), więc **wcześniejsze sprzedaże i raporty zostają**; osoba znika z listy wyboru przy sprzedaży |
| Duplikaty / długość / kolejność | frontend: tylko `required`; reguły duplikatu po stronie serwera (nie zmieniano); kolejność z backendu |
| Pomoc | istniejący slot `admin.pracownicy` (komponent „?") — zachowany |

## 2. Zmiany

- `public/index.html`: sekcja `#setup-pracownicy` (nowy znacznik; `#def_prac required`, ten sam `onsubmit`, `#pracownicy-list`); szablon wiersza listy w `pobierzSlownikSprzedazy()` (inicjał, nazwa przez `escHtml`, przycisk „Usuń" z `aria-label`, ten sam `onclick="usunPracownika('…')"`, licznik `#pracownicy-licznik`, stan pusty); **jedna zmiana literału**: treść `confirm` w `usunPracownika` — pytanie z nazwą i zweryfikowanym skutkiem (zamiast „Usunąć?").
- `public/pracownicy.css` *(nowy)* — selektory zawężone do `.est-employees`, 900/340 px, tryb ciemny. **Bez własnego JS.**
- `tests/pracownicy-redesign.test.js` *(nowy, 8)*; pełny zestaw **885/885**.
- `narzedzia/proby/pracownicy.json` — scenariusz w panelu.

## 3. P01–P14

| ID | Wynik | Dowód |
|---|---|---|
| P01 desktop, licznik | PASS | I+Z `01-desktop.png`: 3 osoby z danych, licznik 3 |
| P02 400 / 320 / zoom 200 % | PASS | I: `poza: []`, bez poziomego scrolla; „Usuń" z tekstem, ≥ 44 px; Z `04`, `05` |
| P03 pusty + Enter | PASS | I: 0 żądań, blokuje `required` (walidacja natywna — jak dotąd) |
| P04 dodanie | PASS | I: 1 POST `add_sales_def {typ:'Pracownik', wartosc:'Testowa Osoba'}`, pole wyczyszczone po odpowiedzi |
| P04 szybki dwuklik | **bez zmian** | stary kod nie blokuje przycisku na czas zapisu; nie dokładano (logika). Obserwacja w rozdz. 5 |
| P05 błąd zapisu | bez zmian | `alert(d.message)` z serwera — jak dotąd |
| P06 samo imię | PASS | I: „Ola" → POST, bez nowej reguły dwóch wyrazów |
| P07 Usuń → Anuluj | PASS | I: `confirm` z nazwą i skutkiem, 0 mutacji |
| P08 Usuń → potwierdź | PASS | I: 1 POST `delete_employee {imie}` |
| P09 odmowa serwera | bez zmian | `alert(d.message)` — jak dotąd |
| P10 pusta lista / błąd | PASS / bez zmian | stan pusty renderowany („Nie ma jeszcze pracowników"); błąd odczytu bez obsługi (jak dotąd) |
| P11 długa nazwa, `<b>`, `&` | PASS | I: zawija się (wysokość wiersza rośnie), nie wychodzi, `escHtml` → tekst; Z `02` |
| P12 klawiatura | PASS (częściowo) | Enter w polu wysyła formularz; przyciski z `aria-label`; dialog = natywny `confirm` |
| P13 Sprzedaż | PASS (konstrukcyjnie) | ta sama tablica `d.pracownicy` zasila chipy sprzedawców; nie zmieniano |
| P14 inne moduły | PASS | T: CSS zawężony; 885/885 |

## 4. Gdzie spec ustąpiła zasadzie „logika bez zmian"

Własny dialog zamiast `confirm`, „Dodawanie…/Usuwanie…" z blokadą, komunikaty statusu zamiast alertów, błąd pod polem, szkielet ładowania, obsługa „rekord zniknął w innej sesji", `error.code` — wszystko wymagałoby zmian w `dodajDefinicje`/`usunPracownika`/`pobierzSlownikSprzedazy`. Zostały alerty i `confirm`; zmieniłem tylko **treść** pytania, bo spec wymagała, by opisywało rzeczywisty skutek (zweryfikowany w kodzie).

## 5. Poza zakresem, nie ruszane

- `dodajDefinicje` nie blokuje przycisku na czas zapisu — szybki dwuklik może wysłać dwa `add_sales_def`. Istniało.
- Nazwa z apostrofem rozbije `onclick="usunPracownika('…')"` (atrybut budowany z surowej nazwy). Istniało; nie zmieniano, bo to kontrakt wywołania.
