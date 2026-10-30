# Szybka rezerwacja do wpłaty zadatku (hold) — specyfikacja

Data: 30.10.2026. Zatwierdzone przez właściciela po rozmowie o „Panu X, który dzwoni, ale nikt go nigdy nie widział”.

## Problem

Osoba spoza kartoteki dzwoni i chce termin. Żeby go dostać, musi wpłacić zadatek. Musi być zapisana podczas rozmowy, ale:
nie ma konta, nie potwierdziła regulaminu, nie wiadomo kim jest, może nigdy nie zapłacić. Nie wolno robić jej konta na wyrost,
a termin nie może wisieć w nieskończoność. Trzeba ją też wyraźnie odróżnić od klientek, które faktycznie chodzą.

## Decyzje właściciela

| Temat | Decyzja |
|---|---|
| Czas trzymania terminu (hold) | wcześniejsze z dwóch: 24 h od zapisu albo 24 h przed wizytą; wizyta za mniej niż 24 h → hold 2 h (nigdy dłużej niż do startu wizyty) |
| Kwota zadatku | domyślnie 50% sumy umawianych zabiegów, pole edytowalne, podpowiedź „zaokrąglij w górę do 10 zł” |
| Potwierdzenie wpłaty | ręczne, przycisk „Zadatek wpłynął” (recepcja widzi wpłatę w panelu tpay); **bez API tpay** |
| Kto może zwolnić hold wcześniej | recepcja i manager |
| Ile holdów na numer telefonu | jeden aktywny |
| Wpłata po wygaśnięciu | strona linku po wygaśnięciu nie pokazuje płatności; jeśli pieniądze mimo to doszły, lądują jako zwykły zadatek na koncie osoby, bez wizyty, a recepcja dostaje Sprawę „nowy termin albo zwrot” |

## Co już istniało i zostało użyte

- Rezerwacja może istnieć bez numeru klientki (kolumna `id_klienta` jest opcjonalna; imię i telefon mają własne kolumny), serwer znał już flagę `bez_kartoteki`.
- Stan `do_wplaty` („Do wpłaty”) i `wygasla` były w modelu i w etykietach ekranu (rezerwa pod etap B), ale nikt ich nie zapisywał.
- Dodatek „Link do płatności z regulaminem” (`platnosc_link`, pilot Boczków): osoba spoza bazy wpisuje dane, akceptuje regulamin, dopiero potem widzi tpay. W tym momencie powstaje profil z dowodem akceptacji (kto, kiedy, IP). **Konto powstaje dokładnie wtedy, gdy regulamin jest potwierdzony.**
- Tykanie w tle co minutę (`tickSprawy`) i Sprawy w Centrum powiadomień.

## Czego nie ma i nie będzie w tej partii

Potwierdzenia wpłaty od tpay. Link prowadzi na hostowaną stronę tpay generowaną ręcznie w ich panelu, więc recepcja nadal
wkleja link tpay (jak dziś w Administracja → Płatności online), a wpłatę potwierdza ręcznie. „Potwierdzona” znaczy „recepcja
zobaczyła wpłatę”, nie „bank potwierdził”.

## Przebieg

1. **Zapis podczas rozmowy.** Kreator nowej wizyty → zamiast szukać w kartotece: „Szybka rezerwacja bez kartoteki” → imię i nazwisko, telefon, zabiegi, termin. Zapis tworzy rezerwację w stanie `do_wplaty` z terminem ważności (`hold_do`). Godzina jest zajęta jak przy zwykłej wizycie. Drugi hold na ten sam telefon jest odrzucany.
2. **Karta na siatce:** kreskowana ramka, bursztynowa plakietka „Do wpłaty do czw 10:00”.
3. **Panel wizyty → sekcja „Zadatek”:** kwota (50%, edytowalna, „zaokrąglij do 10 zł”), pole na link tpay, „Utwórz link do zadatku” → gotowy link Estelio do skopiowania (SMS z telefonu salonu). Ślad w historii wizyty. Przyciski „Zadatek wpłynął” i „Zwolnij termin”.
4. **Strona linku** pokazuje wizytę (data, godzina, zabiegi, termin wpłaty), dane wstępnie wypełnione z holdu. Po akceptacji regulaminu: profil, przypięcie do rezerwacji, wpis w historii „regulamin zaakceptowany online”, Sprawa „sprawdź wpłatę w tpay”. Po wygaśnięciu holdu strona mówi „termin został zwolniony, zadzwoń do salonu” i nie pokazuje płatności.
5. **„Zadatek wpłynął”** (kwota, metoda): rekord zadatku z celem „wizyta EST-… data godzina”, stan `potwierdzona`, ślad w historii. Gdy osoba nie zaakceptowała regulaminu, a pieniądze doszły inną drogą: profil powstaje z adnotacją „regulamin do podpisania w salonie”, a ekran to wyraźnie mówi.
6. **Wygaszanie** w tykaniu co minutę: `hold_do` minął → stan `wygasla`, godzina wolna, pozycje anulowane, link unieważniony, Sprawa „Bez wpłaty — … termin zwolniony, zadzwonić?”. Hold bez akceptacji regulaminu po 7 dniach traci imię i telefon (minimalizacja danych).
7. **Wpłata po wygaśnięciu:** na wygasłej karcie przycisk „Wpłata mimo wygaśnięcia” → zadatek na koncie bez wizyty + Sprawa „nowy termin albo zwrot”. Wizyta nie wraca sama.
8. **Odróżnienie:** do akceptacji regulaminu nie ma konta. Po akceptacji profil ma w kartotece oznaczenie „z linku online”; plakietka „1. wizyta” w terminarzu działa jak dotąd.
9. **Odświeżanie:** gdy licznik dzwonka się zmieni, siatka bieżącego dnia przeładowuje się sama (jedno zapytanie, tylko gdy coś się stało).

## Schemat (tylko dopisane, opcjonalne kolumny; zero zmian istniejących)

| Tabela | Kolumna | Po co |
|---|---|---|
| Term_Rezerwacje | `hold_do DATETIME NULL` | termin ważności holdu |
| Term_Rezerwacje | `zadatek_id VARCHAR(64) NULL` | rekord zadatku po wpłacie |
| ZgodyPlatnosci | `rezerwacja_id INT NULL` | link do zadatku związany z rezerwacją |

Dopisywane idempotentnie przy starcie (ER_DUP_FIELDNAME ignorowane), jak wszystkie dotychczasowe kolumny modułu.

## Sprawy (Centrum powiadomień)

| Typ | Kiedy | Priorytet |
|---|---|---|
| E40 | hold wygasł bez wpłaty | P1, powiązany czas = start wizyty |
| E41 | regulamin zaakceptowany online, czeka wpłata | P1 |
| E42 | wpłata po wygaśnięciu holdu | P1 |

## Dowody

- `tests/terminarz-szybka-rezerwacja.test.js` — reguła terminu holdu (czysta funkcja), strażnik serwera, ekranu, strony linku i przewodnika.
- `narzedzia/proby/terminarz-szybka-rezerwacja.json` — przebieg na bazie izolowanej: hold → karta → link → akceptacja → Sprawa → „Zadatek wpłynął” → potwierdzona; wygaszenie i wpłata po wygaśnięciu.
- Zrzuty z bazy izolowanej w `public/pomoc-terminarz/`.
