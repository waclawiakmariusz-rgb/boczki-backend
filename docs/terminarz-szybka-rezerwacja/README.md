# Szybka rezerwacja do wpłaty zadatku — dowody z 30.10.2026

Specyfikacja i decyzje: `SPECYFIKACJA.md`. Wszystko poniżej wykonane na bazie IZOLOWANEJ (estelio_test, salon demo-test), dane po próbie usunięte.

## Co zostało zbudowane

| Warstwa | Plik | Zmiana |
|---|---|---|
| Serwer | `routes/terminarz.js` | reguła `terminHoldu` (24 h / 24 h przed / 2 h), zapis `hold` w `trm_zapisz` (stan `do_wplaty`, `hold_do`, jeden hold na telefon), akcje `trm_hold_link`, `trm_hold_wplata`, `trm_hold_zwolnij`, wygaszanie w tykaniu (`wygasHoldy`, Sprawa E40, minimalizacja danych po 7 dniach), most `holdPoAkceptacji`/`holdInfo`, stan linku w `trm_rezerwacja` |
| Moduł zgód | `routes/zgody.js` | kolumna `rezerwacja_id`, strona linku zna hold (blokada `HOLD_WYGASL` / `HOLD_OPLACONY` sprawdzana przed „anulowany”), po akceptacji woła terminarz, eksport `narzedzia` |
| Spięcie | `server.js` | `terminarzHaki` przekazane do zgód, wypełnione po załadowaniu terminarza |
| Strona klienta | `public/platnosc.html` | blok wizyty (termin, zabiegi, wpłata do), podpowiedź danych z rozmowy, komunikat „Termin został zwolniony” |
| Ekran recepcji | `public/terminarz.js`, `terminarz.css` | „Szybka rezerwacja bez kartoteki”, kreskowany kafelek „Do wpłaty do …”, karta **Zadatek** (oś zdarzeń, kwota 50% + „do 10 zł ↑”, link, „Zadatek wpłynął”, „Zwolnij termin”, „Wpłata mimo wygaśnięcia”), odświeżanie siatki po zmianie licznika dzwonka, etykiety E40–E42 |
| Klienci | `routes/klienci.js`, `public/index.html` | plakietki „🔗 z linku online” i „📞 szybka rezerwacja · regulamin do podpisania” |
| Przewodnik | `public/estelio_pomoc_terminarz.html` | nowy rozdział 32, przenumerowanie 33–38, uzupełnienia w 18 i 33, dwa wiersze indeksu, 5 zrzutów `trm-hold-*.png` |

Schemat: trzy dopisane kolumny (`Term_Rezerwacje.hold_do`, `Term_Rezerwacje.zadatek_id`, `ZgodyPlatnosci.rezerwacja_id`), wszystkie NULL-owalne, dopisywane idempotentnie przy starcie. Zero zmian istniejących kolumn i danych.

## Dowody

- `tests/terminarz-szybka-rezerwacja.test.js` — 25 testów: reguła terminu holdu (7 przypadków), strażnik serwera, zgód, strony linku, ekranu, Klientów, przewodnika. Pełny `npx jest`: 65 pakietów, 1061 testów, zielony.
- `narzedzia/proby/terminarz-szybka-rezerwacja-a.json` — H01–H20 PASS: zapis bez kartoteki → „Do wpłaty do …” → link (kwota 50%, zaokrąglenie) → akceptacja regulaminu z telefonu (profil, ślad, Sprawa E41) → drugi hold na ten sam numer odrzucony → „Zadatek wpłynął” → potwierdzona, E41 zamknięta → drugi hold (inny numer) z linkiem → strona linku klienta.
- `narzedzia/proby/terminarz-szybka-rezerwacja-b.json` — W01–W07 PASS po symulowanym upływie czasu (ten sam kod wygaszania, który na serwerze chodzi co minutę): hold znika z siatki, Sprawa E40, strona linku „termin zwolniony” (info i akceptacja), panel „Wygasła bez wpłaty”, „Wpłata mimo wygaśnięcia” = zadatek na koncie bez wizyty + Sprawa E42, E40 zamknięta.
- Zrzuty w tym katalogu (`*hold-*.png`, `klienci-plakietki.png`) i w `public/pomoc-terminarz/trm-hold-0[1-5].png`.

## Stan bazy po pełnym przebiegu (przed sprzątaniem)

| Rezerwacja | Stan | Profil | Zadatek |
|---|---|---|---|
| Jan Testowy, pn 11:00 | potwierdzona | ID 1017, `Regulamin (online przy płatności)` | 100 zł tpay, cel „Wizyta EST-0229 · pn 2.11 11:00 · Endermologia / 1x” |
| Anna Testowa, pn 16:00 | wygasła | ID 1018, `BRAK (szybka rezerwacja)` | 60 zł przelew, cel „Wpłata po wygaśnięciu rezerwacji EST-0230 … nowy termin albo zwrot” |

## Granice do powiedzenia recepcji

1. System nie wie sam, czy pieniądze doszły — bez API tpay. „Potwierdzona” po holdzie = recepcja kliknęła „Zadatek wpłynął”.
2. Link tpay nadal tworzy się ręcznie w panelu tpay i wkleja (jak dotąd w Administracja → Płatności online), tylko teraz z karty wizyty.
3. Hold trzyma godzinę jak zwykła wizyta — inne klientki jej nie dostaną, dopóki nie wygaśnie albo nie zostanie zwolniona ręcznie.
4. Wpłata po wygaśnięciu nie przywraca wizyty. Umawia się ją na nowo, zadatek już czeka na koncie.
