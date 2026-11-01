# Sposób współpracy i odbiór

ChatGPT: specyfikacja, makiety, recenzja raportów/diffów, lista ryzyk i poprawek. Claude Code: inspekcja repozytorium, implementacja, uruchomienie testów, raport i pakiet. Użytkownik: kierunek produktu i decyzja o wdrożeniu. Bez przekazanych plików lub połączonego repozytorium ChatGPT nie widzi automatycznie pracy Claude.

## Każda runda

Zlecenie ma identyfikator, commit bazowy, cel użytkownika, zakres plików/modułów, zachowania, kryteria odbioru i ograniczenia. Claude oddaje commit/diff, działający podgląd lub build, dowody testów i znane ograniczenia. Recenzent wiąże uwagi z plikiem i scenariuszem, nie pisze ogólnego „popraw bezpieczeństwo”.

Wynik: **PRZYJĘTE**, **DO POPRAWY** lub **BRAK DOWODU**. Przyjęcie makiety nie jest zgodą na produkcję. Odbiór jednej poprawki nie otwiera ponownego redesignu przyjętych wcześniej modułów.

## Scenariusze wydania operacyjnego

| ID | Scenariusz | Warunek odbioru |
|---|---|---|
| F01 | Dwie osoby o tym samym nazwisku | wybór po stabilnym ID, dane pomocnicze i brak automatycznego zgadywania |
| F02 | Zabieg + kosmetyk, portfel + karta | zgodny koszyk, jedno księgowanie, właściwy stan produktu i saldo |
| F03 | Wpłata zadatku i późniejsze wykorzystanie | wpływ policzony raz; historia obu zdarzeń |
| F04 | Zwykła korekta vs rzeczywisty zwrot | odrębne przebiegi; limit zwrotu i powód; bez nadpisania pierwotnego zakupu zwrotem |
| F05 | Wizyta z dwiema usługami u różnych osób | sprawdzony cały ciąg, zasoby i bufory, bez częściowego zapisu |
| F06 | Ktoś zajmuje termin między podglądem a zapisem | konflikt; żadnej drugiej rezerwacji |
| F07 | Zmiana terminu nieudana | stary termin i przydział jednostek zachowane |
| F08 | Wykonanie jednej usługi pakietu łączonego | zmienia się tylko właściwy składnik; brak drugiego zużycia przy rozliczeniu |
| F09 | Rozliczenie, timeout, powrót do wizyty | jedna sprzedaż i jedno powiązanie; wynik nieustalony jest sprawdzany |
| F10 | Hold: regulamin, brak wpłaty, wygaśnięcie | zgoda nie potwierdza pieniędzy; termin zwalnia zgodnie z serwerem |
| F11 | Spóźniona wpłata po wygaśnięciu | saldo/wyjaśnienie bez samoczynnego odzyskania terminu |
| F12 | Telefon „Nie odebrała” | próba i kolejny termin, zadanie aktywne; „Umówiona” nie tworzy wizyty |
| F13 | Otwarcie sprawy w dzwonku | odczyt nie zamyka sprawy; rozwiązanie ma wynik i aktora |
| F14 | Terminarz wyłączony / ewidencja wstrzymana | poprawny zakres UI i odmowa API; historia nie znika |
| F15 | Manager próbuje nadać konto | odmowa serwera; właściciel zachowuje właściwe narzędzie |
| F16 | Recepcja po managerze na tym samym tablecie | brak raportów/cache poprzednika i nowy aktor w każdej operacji |
| F17 | Wynik dnia na WWW i telefonie | identyczne źródło, strefa, filtry i suma; Mix nie zwiększa liczby transakcji |
| F18 | Rezerwacja techniczna vs urlop | recepcja nie dostaje edycji danych kadrowych przez skrót |

Do tego pełna matryca SEC z dokumentu 03. Testy integracyjne weryfikują skutki w bazie, nie tylko status HTTP. Testy UI nie dowodzą autoryzacji serwera. Test na syntetycznych danych nie dowodzi automatycznie zgodności wszystkich historycznych zakupów.

## Zwięzły raport Claude

- Cel i rezultat dla użytkownika.
- Branch/commit oraz zmienione pliki.
- Co wynika z kodu, co z konfiguracji, co z wykonanych testów.
- Testy: polecenie, środowisko, wynik, ograniczenie.
- Zmiany kontraktów/migracje i kompatybilność WWW.
- Ryzyka otwarte, plan cofnięcia i następne zlecenie.

Nie uznajemy liczby testów za kryterium jakości. Sprawdzamy realne scenariusze, wyścigi i granice uprawnień. Dla krytycznych operacji finansowych oraz dostępu do danych potrzebny niezależny przegląd kodu przed szerszym wdrożeniem; recenzja na podstawie raportu ma ograniczony zakres.
