# Tryb ciemny w Terminarzu — przegląd i naprawa

Zgłoszenie właściciela z 19.10.2026: „terminarz ma kulejący tryb dark mode, po zmianie niewiele tam widać”.

## Co było nie tak

Moduł nadpisywał w ciemnym motywie **tylko podstawowe zmienne** (tło, powierzchnia, tekst, kolory stanów). Reszta — kilkadziesiąt miejsc — miała kolory wpisane na sztywno, projektowane pod jasne tło. Stąd trzy rodzaje usterek:

| Rodzaj | Przykład | Skutek |
|---|---|---|
| **Jasne tło, jasny tekst** | nieprzeczytana sprawa w dzwonku (`#fffaf5`), podpowiedzi terminów (`#f4faf6`, `#fdf5f6`), karty w kreatorze po najechaniu, przyciski godzin | tekst praktycznie niewidoczny |
| **Ciemne na ciemnym** | obramowanie karty wizyty `rgba(48,39,32,.12)`, bordowy akcent `#8D2947` w odnośnikach („Co się zmieniło?”, „+ Dodaj przerwę”) | elementy zlewały się z tłem |
| **Jasny element bez potrzeby** | pasek „co zniknęło”, znak notatki, treść notatki w agendzie, plakietki preferencji | raziły w oczy na ciemnym ekranie |

Osobno: licznik przy dzwonku miał biały tekst na jasnym bursztynie (w ciemnym motywie `--t-warn-fg` jaśnieje), a nazwa usługi na karcie wizyty schodziła do kontrastu **2,7:1**.

## Co zmieniono

Wszystko w `public/terminarz.css`, w jednej sekcji na końcu pliku, **wyłącznie pod `body.dark-mode`** — jasny motyw nie zmienił się o piksel.

1. **Zmienne:** akcent jaśnieje do `#e98aa4` (bordo nie istnieje na ciemnym tle), złoto i cień dopasowane.
2. **Wypełnienia akcentem** (przycisk główny, aktywny widok, aktywny segment, krok kreatora, wybrany slot) dostają **ciemny tekst** — biały na jaśniejszym różu znikał.
3. **Punktowe poprawki** wszystkich miejsc z kolorami na sztywno: siatka (karta, bufor, blokada), kreator (karty klientki i usługi, podpowiedzi terminów, przyciski godzin, slot „na brudno”, przełącznik, kroki), centrum powiadomień, historia, pasek zmian, znak notatki, notatka w agendzie, plakietki preferencji.
4. **Pola formularzy** w module dostają paletę modułu zamiast globalnego granatu (tam, gdzie globalne style aplikacji nie wygrywają specyficznością).

## Jak sprawdzone

Przegląd dziesięciu ekranów w trybie ciemnym na izolowanej bazie (MariaDB 3307, salon `demo-test`), przed i po: Dzień, szczegóły wizyty, kreator nowej wizyty, Agenda, Tydzień, dzwonek, Ustawienia, Pakiety i zakupy, „Sprawdź komplet” z zakupami klientki, Historia. Zero błędów JS.

Dodatkowo pomiar kontrastu (WCAG) wyliczonych kolorów w przeglądarce:

| Element | Kontrast po zmianie |
|---|---|
| przycisk główny (tekst na akcencie) | 7,3:1 |
| odnośniki akcentem („Co się zmieniło?”) | 7,0:1 |
| treść paska „co zniknęło” | 10,0:1 |
| znak notatki | 8,2:1 |
| karta klientki i usługi w kreatorze | 13,1:1 |
| liczniki dnia | 8,3:1 |

### Zrzuty

| Plik | Co widać |
|---|---|
| `przed-dzwonek.png` | **przed:** nieprzeczytana sprawa „Odwołano wizytę — Julia Wiśniewska” na jasnym tle, tekst nieczytelny |
| `po-dzwonek.png` | **po:** ta sama sprawa czytelna, odnośniki i przyciski w palecie ciemnej |
| `po-dzien.png` | widok Dzień: obramowania kart widoczne, pasek zmian w ciemnym bursztynie |
| `po-agenda.png` | agenda z plakietkami preferencji i notatkami |
| `po-kreator.png` | kreator wizyty z zakupami klientki i ostrzeżeniem o terminie |
