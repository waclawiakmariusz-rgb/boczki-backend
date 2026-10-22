# Estelio — Przyjęcie towaru: polecenia wdrożenia zatwierdzonej makiety

**Data:** 19.10.2026  
**Wzorzec wizualny:** `MAKIETA_PRZYJECIE_TOWARU.png`, 1663 × 946 px.  
**Zakres:** widok Kosmetyki → Przyjęcie towaru i jego lokalne interakcje.  
**Cel:** odtworzyć zatwierdzony wygląd oraz opisaną obsługę formularza w istniejącym Estelio.  
**Rodzaj materiału:** specyfikacja dla Claude Code; nie jest to implementacja ani raport z testów produktu.

## 1. Polecenie nadrzędne

Wdróż widok według załączonej makiety. Traktuj ją jako wzorzec, nie luźną inspirację. Zachowaj kompozycję dwóch kart, ich proporcje, kolejność pól, hierarchię tekstu, kolorystykę i położenie akcji. Nie proponuj kolejnego układu ani alternatywnego motywu.

Otwórz grafikę przed edycją kodu. Po implementacji uruchom rzeczywisty widok, wykonaj zrzut przy odpowiadającym obszarze roboczym i porównaj z makietą. Skoryguj widoczne rozbieżności przed oddaniem pracy. Samo stwierdzenie „zastosowano podobne kolory” nie oznacza wykonania zadania.

Zakres nie obejmuje Terminarza, jego zakupów, Sprzedaży, raportów ani innych ekranów magazynowych. Nawigacja boczna, logo, ikony globalnego menu i mechanizm wyboru salonu pozostają istniejącymi komponentami aplikacji. Nie odtwarzaj ich ponownie z grafiki.

Realne wartości pochodzą z obecnych danych i formularza. Przykład na makiecie — Bruno Vassari, Firming Pack, 6 sztuk, 80,00 / 98,40 zł i 31.12.2027 — służy tylko do odtworzenia stanu testowego. Nie ustawiaj tych wartości domyślnie użytkownikom.

## 2. Rozpoznanie przed zmianą kodu

W istniejącym repozytorium znajdź implementację tego widoku, jego style, dane słownika, obsługę zależności Firma–Model, walidację i handler zapisu. Nie zakładaj nazw endpointów ani pól na podstawie makiety.

Zapisz w raporcie krótką mapę: element UI → istniejąca zmienna/pole → obecny zapis. Szczególnie ustal:

1. Jak zapisywany jest rodzaj „Detal” i które funkcje odczytują stan starej kontrolki.
2. Czy Firma/Model są wyłącznie wyborem z listy, czy pozwalają także na dotychczasowe dodanie/wybranie nowej wartości.
3. Skąd pochodzą Typ, Netto i Brutto oraz czy obecnie występuje ich automatyczne uzupełnianie lub przeliczanie.
4. Jakie reguły mają ilość, ceny, data ważności i pola opcjonalne.
5. Jaka jest obecna akcja po sukcesie: reset, pozostanie w widoku albo nawigacja.
6. Jak aktualizowane są stan magazynu, partie, historia i powiązane dane.

To jest rozpoznanie istniejącego kodu, nie lista pytań do właściciela. Zachowaj kontrakt biznesowy. Jeśli kod ujawni rzeczywistą sprzeczność z niniejszą specyfikacją, wskaż konkretną funkcję i skutek, zamiast po cichu zmieniać znaczenie pola.

## 3. Zakres zmian wizualnych

### Usuń z tego widoku

- Cały niebieski pasek z zaznaczoną opcją „Detal”: kontrolkę, etykietę, obramowanie i miejsce po pasku.
- Zieloną pełną belkę powtarzającą „Bruno Vassari Firming Pack” lub inną wybraną nazwę.
- Przycisk „ZAPISZ” rozciągnięty na całą szerokość formularza.
- Lokalne etykiety pisane wersalikami, np. „NETTO (SZT):”.

Nie zastępuj „Detal” nieaktywnym checkboxem, przełącznikiem, osobną kartą ani plakietką. Użytkownik nie podejmuje już tej decyzji.

### Wprowadź

- Nagłówek strony i krótki opis.
- Białą kartę formularza z trzema grupami pól i poziomymi separatorami.
- Osobną kartę podsumowania po prawej.
- Pole liczby sztuk z przyciskami minus i plus oraz możliwością wpisania wartości.
- Sufiks „zł” wewnątrz pól cenowych.
- Dwie akcje w stopce formularza: „Anuluj” po lewej i „Przyjmij towar” po prawej.

## 4. Zasady odwzorowania obrazu

Obraz ma 1663 × 946 px i nie zawiera paska przeglądarki ani systemu operacyjnego. Przy porównaniu używaj zrzutu viewportu, a nie całego pulpitu. Powiększenie przeglądarki: 100%. Porównuj te same dane i ten sam stan formularza.

W makiecie lewa nawigacja zajmuje około 264 px, a obszar treści około 1399 px. Nie zmieniaj szerokości rzeczywistego menu, aby zgadzała się ta liczba. Dopasuj okno testowe tak, aby obszar roboczy po prawej miał około 1399 CSS px; porównuj jego wycinek. Makieta nie jest poleceniem zmiany globalnej nawigacji.

### 4.1. Punkty odniesienia w makiecie

Współrzędne są orientacyjnymi punktami pomiarowymi obrazu. Służą do odbioru kompozycji; nie pozycjonuj całego formularza absolutnie według pikseli.

| Element | Położenie i rozmiar w obrazie |
|---|---|
| Tytuł strony | początek około x=304, y=43 |
| Opis pod tytułem | początek około x=304, y=97 |
| Karta formularza | x≈294, y≈149, szerokość≈929, wysokość≈750 |
| Karta podsumowania | x≈1243, y≈149, szerokość≈390, wysokość≈540 |
| Przerwa między kartami | 20 px |
| Margines treści od boków obszaru roboczego | około 30 px |
| Wewnętrzny początek pól w formularzu | x≈324; około 30 px od krawędzi karty |
| Pierwszy rząd pól | góra≈264, wysokość≈60 px |
| Separatory grup formularza | y≈362, y≈572, y≈784 |
| Rząd ilości i daty | góra≈472, wysokość≈60 px |
| Rząd cen | góra≈684, wysokość≈60 px |
| Przyciski w stopce | góra≈813, wysokość≈56 px |
| Przycisk główny | prawa krawędź wyrównana do pól; szerokość≈278 px |

### 4.2. Układ desktopowy

- Obszar obu kart ma szerokość maksymalną około 1340 px. Przy szerokim oknie wyśrodkuj go wewnątrz dostępnego obszaru aplikacji.
- Karta formularza zajmuje około 70% szerokości, podsumowanie około 30%; docelowy odstęp to 20 px.
- Przy szerokości roboczej 1399 px: boczne marginesy po 30 px, formularz około 929 px, podsumowanie około 390 px.
- Górne krawędzie obu kart leżą na tej samej wysokości. Podsumowanie kończy się wcześniej niż formularz — nie rozciągaj go sztucznie do wysokości lewej karty.
- Nagłówek strony jest nad kartami. Jego tekst zaczyna się około 10 px dalej w prawo niż krawędź lewej karty, zgodnie z makietą.
- W formularzu: padding 30 px; grupy oddzielone cienką linią i przestrzenią. Brak osobnych ramek wokół każdej grupy.
- Pierwszy rząd: Marka, Model, Typ. Model jest najszerszy. Przy rozmiarze referencyjnym szerokości około 255 / 345 / 230 px, z odstępami po 20 px.
- Drugi rząd: Liczba sztuk oraz Data ważności. Nie rozciągaj krótkiej ilości na całą szerokość karty; łączny rząd jest krótszy niż rząd cen, jak na makiecie.
- Trzeci rząd: Netto i Brutto, po połowie dostępnej szerokości, z odstępem około 32 px.
- Stopka znajduje się w karcie pod ostatnim separatorem. Nie jest pływającym paskiem przy dolnej krawędzi ekranu.
- Nie ustawiaj sztywnej wysokości karty ani ukrywania nadmiaru: komunikat walidacji ma zwiększać jej wysokość, a nie nakładać się na pole.

### 4.3. Styl lokalny

Stosuj tokeny w obrębie tego widoku, bez zmiany globalnych selektorów `input`, `button`, `label`, `h1` i bez zmiany motywu innych stron. Przykładowa granica stylów: własny kontener widoku `estelio-goods-receipt`.

| Element | Wartość docelowa |
|---|---|
| Tło obszaru roboczego | ciepły krem bliski `#FDF9F7`; zachowaj istniejące tło, jeśli odpowiada makiecie |
| Karty | `#FFFFFF` |
| Główny tekst | `#101828` |
| Etykiety i tekst pomocniczy | `#667085`, czytelny na jasnym tle |
| Tło wnętrza pól | bardzo jasne, bliskie `#FCFCFD` |
| Obramowanie pól | 1 px, `#D8DCE3` |
| Separatory | 1 px, `#E7E9EE` |
| Akcent / główny przycisk | przygaszony róż, bliski `#A85D72`; bez mocnego gradientu |
| Główna kwota w podsumowaniu | przygaszony róż, bliski `#A4576C` |
| Tło ikony produktu | jasny róż, `#FCF3F5` |
| Promień kart | około 22 px |
| Promień pól i przycisków | około 14 px |
| Cień kart | szeroki, bardzo delikatny, ciepły; orientacyjnie 0 / 8 / 28 px, krycie około 4% |
| Tytuł strony | około 40 px, wysokość wiersza 48 px, grubość 700 |
| Opis pod tytułem | około 20 px, wysokość wiersza 28 px |
| Nagłówki grup formularza | około 28–30 px, wysokość wiersza 36 px, grubość 650–700 |
| Etykiety | około 16 px, wysokość wiersza 22 px, grubość 500 |
| Wartości pól | około 18 px, wysokość wiersza 24 px |
| Nagłówek podsumowania | około 24 px, grubość 650–700 |
| Łączna kwota | około 54 px, wysokość wiersza 64 px, grubość 650–700 |
| Wysokość pola na desktopie | około 60 px |
| Wysokość przycisków stopki | około 56 px |

Wykorzystaj istniejącą lokalną czcionkę interfejsu, jeżeli odpowiada wzorcowi. Preferowany charakter: Inter / systemowy bezszeryfowy. Nie zmieniaj fontu całej aplikacji ani nie dodawaj zewnętrznej usługi fontów do tego zadania. Dopasuj rozmiar i grubość na porównaniu obrazu.

Makieta rastrowa zawiera subtelne różnice odcieni i antyaliasing. Nie kopiuj jej jako tła formularza i nie odtwarzaj szumu obrazu. Odbiór dotyczy wyglądu rzeczywistych komponentów, nie identyczności każdego piksela wygenerowanego PNG.

## 5. Dokładna treść i kolejność

### Nagłówek strony

- Tytuł: **Przyjęcie towaru**
- Opis: **Wybierz produkt i uzupełnij dane przyjęcia.**

Nie dodawaj krokomierza, zakładek, breadcrumbs ani dodatkowego nagłówka „Nowa dostawa”.

### Grupa Produkt

| Etykieta | Odpowiednik starego pola | Wartość w przykładzie |
|---|---|---|
| Marka | Firma | Bruno Vassari |
| Model | Model | Firming Pack |
| Typ | Typ | Kremy |

„Marka” jest nową etykietą prezentacyjną. Nie zmieniaj z tego powodu nazwy pola w API ani danych historycznych.

### Grupa Przyjmowana partia

| Etykieta | Element | Wartość w przykładzie |
|---|---|---|
| Liczba sztuk | jeden wspólny obrys z minusem, edytowalną liczbą i plusem | 6 |
| Data ważności | pole daty z ikoną kalendarza po prawej | 31.12.2027 |

### Grupa Ceny za sztukę

| Etykieta | Wartość w przykładzie | Sufiks |
|---|---|---|
| Netto | 80,00 | zł |
| Brutto | 98,40 | zł |

Nie dopisuj etykiety „cena zakupu” albo „cena sprzedaży”, jeśli aktualny kontrakt tego jednoznacznie nie potwierdza. Zachowaj istniejące znaczenie obu cen.

### Stopka formularza

- Lewy przycisk: **Anuluj** — biały, cienkie neutralne obramowanie.
- Prawy przycisk: **Przyjmij towar** — przygaszony róż, biała etykieta.
- Bez kapitalików, przycisku „Dalej”, checkboxa potwierdzającego i dodatkowego przycisku „Zapisz”.

## 6. Karta podsumowania

Kolejność od góry:

1. Nagłówek **Podsumowanie**.
2. Wiersz produktu: niewielka liniowa ikona paczki w jasnoróżowym kwadracie; obok Model jako główna nazwa, Marka pod nią i Typ w trzecim wierszu.
3. Separator.
4. Wiersz **Liczba sztuk** — wartość wyrównana do prawej.
5. Wiersz **Brutto za sztukę** — wartość wyrównana do prawej.
6. Separator.
7. Etykieta **Łączna wartość brutto**.
8. Duża kwota w kolorze akcentu.
9. Mniejsza linia działania, np. **6 szt. × 98,40 zł**.

Podsumowanie jest podglądem niezatwierdzonego formularza. Nie pokazuj zielonego znaku sukcesu, tekstu „Przyjęto” ani obietnicy, że stan już się zwiększył.

Reguły:

- Aktualizuj dane bez przeładowania strony po zmianie odpowiednich pól, także przy wpisywaniu i użyciu plus/minus.
- Wyliczenie: liczba sztuk × aktualna cena brutto za sztukę. Przykład: 6 × 98,40 = 590,40 zł.
- Użyj istniejącego bezpiecznego sposobu liczenia kwot. Nie prezentuj artefaktów zmiennoprzecinkowych. Format PL, dwa miejsca po przecinku, spacja przed „zł”.
- Netto nie jest dodawane do brutto. Nie dodawaj VAT ani innych opłat do wyliczonej sumy.
- Brak wymaganej wartości lub niepoprawna liczba → „—” w zależnym podsumowaniu. Nie pokazuj starej kwoty z poprzedniego poprawnego wpisu.
- Puste pole nie oznacza automatycznie zera. Jawne 0,00 zł może być pokazane tylko wtedy, gdy obecna walidacja dopuszcza taką cenę.
- Przed wyborem produktu pokaż spokojny tekst „Wybierz produkt”; w miejscach niewybranych danych użyj „—”. Układ karty pozostaje stabilny.
- Długie nazwy zawijają się w podsumowaniu. Nie ukrywaj informacji wyłącznie w hoverze.
- Podsumowanie nie wywołuje zapisu, rezerwacji ani aktualizacji magazynu.

## 7. Zachowanie pól i interakcji

### 7.1. Marka, Model, Typ

- Zachowaj aktualne źródła danych i relacje pól. Wybranie marki ma ograniczać model zgodnie z istniejącą logiką.
- Jeżeli zmiana marki unieważnia wybrany model, usuń jego nieaktualne powiązanie i podsumowanie. Nie zostawiaj produktu należącego do poprzedniej marki.
- Automatyczne uzupełnienie Typu i cen zachowuje istniejące zasady. Nie nadpisuj ręcznej edycji przypadkowym opóźnionym wynikiem poprzedniego wyszukiwania.
- Pokaż chevron po prawej. Wykorzystaj istniejący komponent wyboru/wyszukiwania; nie dodawaj nowej biblioteki tylko dla tego ekranu.
- Jeśli obecny formularz pozwala wpisać nową markę/model albo obsługuje autouzupełnianie, zachowaj tę możliwość w tym samym wizualnym polu. Makieta z chevronem nie jest poleceniem usunięcia tych funkcji.
- Ładowanie słownika i brak wyników mają komunikat przy odpowiednim polu. Nie zamieniaj błędu pobrania w komunikat, że katalog jest pusty.
- Dla istniejącego wyszukiwania: klawiatura, wybór Enterem, zamknięcie Esc, przewijanie listy i zachowanie fokusu. Długi tekst ma być możliwy do odczytania również na dotyku.

### 7.2. Liczba sztuk

- Minus i plus to przyciski pomocnicze, nie submit. Naciśnięcie nie może zapisywać formularza.
- Środek jest normalnym polem do wpisywania, zaznaczania i wklejania liczby. Użytkownik nie musi klikać plusa 50 razy.
- Zachowaj aktualnie dozwoloną jednostkę, krok i granice. Przy standardowych całych sztukach krok wynosi 1, a minus przy 1 jest nieaktywny. Nie wprowadzaj milczącego zaokrąglania ułamków, jeśli obecny kontrakt jest inny.
- Plus z pustego pola może ustawić pierwszą dozwoloną dodatnią wartość; minus z pustego jest nieaktywny.
- Nie poprawiaj nieprawidłowego wpisu do pozornie poprawnej liczby bez informacji. Komunikat powinien wyjaśniać istniejącą regułę.
- Nazwy dostępności: „Zmniejsz liczbę sztuk” i „Zwiększ liczbę sztuk”.

### 7.3. Ceny

- Etykiety stale widoczne nad polami, sufiks waluty po prawej wewnątrz obrysu; sufiks nie wchodzi do wysyłanej wartości.
- Pozwól wpisać polski przecinek, a także obsłuż kropkę, jeśli bieżący formularz ją przyjmuje. Nie formatuj pola destrukcyjnie w trakcie wpisywania, np. po wpisaniu samego „98,”.
- Normalizacja prezentacji do dwóch miejsc po zakończeniu edycji lub zatwierdzeniu, zgodnie z obecnym kontraktem.
- Nie zakładaj stawki 23% na podstawie przykładu 80,00 / 98,40. Nie dodawaj nowego przeliczania Netto↔Brutto. Jeżeli przeliczanie już istnieje, zachowaj jego działanie i sprawdź regresję.
- Błędna cena ma komunikat przy właściwym polu. Wartość brutto w podsumowaniu nie może być na zielono ani udawać poprawnej, jeśli jest błędna.

### 7.4. Data ważności

- Format widoczny: dd.mm.rrrr; zapis w formacie oczekiwanym przez istniejący backend.
- Ikona kalendarza otwiera istniejący picker albo natywne pole zgodnie z obecnym sposobem obsługi. Nie wprowadzaj ciężkiego nowego kalendarza.
- Nie zmieniaj obowiązkowości, dopuszczalnego zakresu ani znaczenia pustej daty w ramach redesignu.
- Zachowaj datę jako datę kalendarzową. Zmiana prezentacji nie może przesunąć dnia przez konwersję strefy czasowej.

### 7.5. „Detal” po usunięciu kontrolki

- Ustaw tę samą wartość rodzajową, którą dotąd przekazywała zaznaczona jedyna opcja. Użyj istniejącego modelu formularza lub adaptera żądania.
- Usuń zależność lokalnego zapisu od wyszukiwania nieistniejącej zaznaczonej kontrolki w DOM.
- Nie dodawaj ukrytej, wymaganej kontrolki, która może zatrzymywać walidację lub przechwytywać fokus.
- Nie zmieniaj wspólnego backendu tak, aby wymuszał Detal także dla innych ekranów korzystających z tego samego zapisu.
- Porównaj żądanie starego i nowego widoku dla tych samych danych. Zmienia się wygląd i etykiety, a znaczenie zapisu pozostaje takie samo.

## 8. Akcje, błędy i potwierdzenie zapisu

### Anuluj

Użyj istniejącego mechanizmu powrotu z tego formularza. Jeśli go nie ma, wróć do widoku „Stan Magazynowy” w module Kosmetyki, bez przeładowania całej aplikacji. Samo anulowanie nie zapisuje danych.

Jeśli formularz zawiera zmiany użytkownika, pokaż małe istniejące okno potwierdzenia w stylu Estelio:

- Tytuł: **Odrzucić wprowadzone zmiany?**
- Treść: **Dane tego przyjęcia nie zostały zapisane.**
- Akcje: **Kontynuuj wpisywanie** oraz **Odrzuć zmiany**.

Nie używaj surowego `window.confirm`. Przy trwającym zapisie nie traktuj anulowania widoku jako cofnięcia żądania, które mogło już dotrzeć do serwera.

### Przyjmij towar

1. Użytkownik może uruchomić istniejącą walidację przyciskiem lub zatwierdzeniem formularza. Sam Enter podczas wyboru pozycji w otwartej liście ma wybrać pozycję, a nie od razu zapisać towar.
2. Jeśli są błędy: zachowaj wszystkie dane, pokaż konkretne komunikaty pod polami i przenieś fokus do pierwszego błędnego pola. Bez ogólnego alertu jako jedynego wyjaśnienia.
3. Podczas zapisu: etykieta **Przyjmowanie…**, mały wskaźnik postępu; szerokość przycisku nie zmienia się. Zabezpiecz przed kolejnym wysłaniem przez podwójne kliknięcie, Enter i ponowne podpięcie handlera przy wejściu do widoku.
4. Po potwierdzonym sukcesie: zaktualizuj dane tak jak dotychczas i pokaż istniejący toast z konkretną informacją, np. **Przyjęto 6 szt. Firming Pack.** Zachowaj obecną uzgodnioną ścieżkę nawigacji/resetu po zapisie; opisz ją w raporcie. Nie resetuj formularza przed sukcesem.
5. Przy jednoznacznej odmowie serwera: zachowaj wpisy i przywróć możliwość poprawienia danych. Błędy przypisane do pól pokaż przy polach; pozostałe w spokojnym komunikacie nad stopką.
6. Przy utracie odpowiedzi: nie twierdź „nie zapisano”, jeśli wynik jest nieznany. Wykorzystaj istniejące sprawdzanie wyniku/idempotencję. Jeśli ich nie ma, pokaż **Nie udało się potwierdzić przyjęcia. Sprawdź, czy towar został dodany, zanim ponowisz zapis.** Nie wykonuj automatycznego ponowienia mutacji z nową tożsamością.

To zadanie nie wymaga nowego systemu transakcji ani przebudowy backendu. Ma jednak zachować istniejące zabezpieczenia i nie wprowadzić duplikatów przez nowy frontend.

## 9. Zachowanie responsywne

Oceniaj szerokość dostępnego obszaru treści, a nie wyłącznie pełnego okna z menu. Globalne zwijanie menu działa według obecnych zasad Estelio.

| Dostępny obszar treści | Układ |
|---|---|
| Około 1280 px i więcej | pełny układ referencyjny: dwie karty, Produkt w trzech kolumnach, reszta jak na grafice |
| Około 1080–1279 px | dwie karty, podsumowanie około 300–340 px; jeśli pierwszy rząd robi się ciasny, Marka i Model w jednym rzędzie, Typ poniżej |
| Poniżej około 1080 px | formularz, następnie podsumowanie w jednej kolumnie; bez ściskania bocznej karty do nieczytelnej szerokości |
| Telefon, około 360–430 px | marginesy około 16 px, padding kart około 20 px; każde pole w osobnym rzędzie; podsumowanie pod formularzem |

Na telefonie: tytuł około 28 px, nagłówki grup około 22 px, kwota podsumowania około 36 px, wartości pól co najmniej 16 px, wysokość pól około 52 px. Przyciski stopki pozostają dostępne: główny może zajmować pełną szerokość, a „Anuluj” osobny wiersz. Zachowaj kolejność fokusu zgodną z kolejnością wizualną.

Przy 800×550 i powiększeniu 200% dopuszczalne jest przewijanie pionowe. Żadna akcja ani błąd nie może być obcięty. Nie dodawaj nowego poziomego przewijania całej strony. Otwarta klawiatura telefonu nie może zakrywać pola bez możliwości przewinięcia do niego. Nie stosuj transformacji skalującej cały formularz.

## 10. Fokus, hover i dostępność

- Pola mają delikatny akcent po fokusie; błąd rozpoznawalny także po tekście, nie wyłącznie kolorze.
- Hover przycisków: niewielka zmiana tła/koloru, bez przesuwania, powiększania i skoków layoutu.
- Przejścia około 120–160 ms; respektuj ograniczenie animacji użytkownika. Bez animacji dużych kart przy każdej zmianie wartości.
- Etykiety są powiązane z kontrolkami. Placeholder nie zastępuje etykiety.
- Chevrony, ikona pudełka i sufiksy waluty nie są dodatkowymi przystankami fokusu. Ikona kalendarza jest przyciskiem tylko wtedy, gdy rzeczywiście otwiera wybór daty.
- Po zamknięciu listy lub okna anulowania fokus wraca do elementu, który je otworzył.
- Podsumowanie nie przejmuje fokusu przy przeliczeniu; nie odczytuj całej karty na każdą wpisaną cyfrę. Sukces i błędy mają dostępny komunikat.
- Nie polegaj wyłącznie na tooltipach do wyjaśnienia pola albo pokazania pełnej nazwy na telefonie.

## 11. Granice implementacji

Wykorzystaj bieżący stos aplikacji. Nie twórz oddzielnej aplikacji demonstracyjnej, nowego routera, nowego katalogu produktów ani formularza zapisującego do pamięci przeglądarki zamiast obecnego API.

Zmiany CSS i JS ogranicz do tego widoku. Usuń nieużywane lokalne style i obsługę starego „Detal”, ale nie usuwaj wspólnej funkcji, zanim nie sprawdzisz jej pozostałych użytkowników. Wejście, wyjście i powrót do formularza nie mogą wielokrotnie rejestrować tych samych zdarzeń.

Ikony dobierz z już używanego zestawu; ikona paczki ma być prosta, liniowa. Bez emoji jako zastępstwa ikony UI. Nie dodawaj zdjęć produktów ani wysyłania obrazków.

Nie dodawaj: numeru faktury, dostawcy, skanera kodów, listy wielu produktów, magazynu docelowego, stawki VAT, nowego pola obowiązkowego ani panelu statystyk. Te elementy nie występują w zatwierdzonej makiecie.

Prace wykonaj w gałęzi roboczej zgodnie z zasadami repozytorium. Odtwarzalne próby zapisu wykonuj w istniejącym środowisku testowym, na danych fikcyjnych. Sam ten brief nie jest poleceniem merge do main ani wdrożenia na produkcję. Przygotuj gotowy do oceny wynik, bez przerywania pracy pytaniami o rutynowe decyzje układu.

## 12. Kryteria odbioru

### 12.1. Odbiór wizualny

Obowiązkowy stan porównawczy: Bruno Vassari / Firming Pack / Kremy / 6 / 31.12.2027 / 80,00 / 98,40. Podsumowanie: 590,40 zł. Utwórz taki stan na danych demonstracyjnych; nie wprowadzaj w tym celu zmian na rzeczywistym magazynie.

- [ ] Grafika referencyjna i zrzut wdrożenia mają porównywalny obszar roboczy, dane i powiększenie.
- [ ] Zachowane są dwie karty, górne wyrównanie, proporcje szerokości i krótsze podsumowanie.
- [ ] Tytuł, opisy, nazwy grup, pola i przyciski mają identyczne brzmienie i kolejność jak w specyfikacji.
- [ ] Nie ma paska „Detal”, zielonej belki ani pełnej szerokości „ZAPISZ”.
- [ ] Zachowana jest hierarchia typografii: tytuł strony, grupy, etykiety, wartości, duża kwota.
- [ ] Odstępy, obrysy, promienie i akcje odpowiadają wzorcowi; nie zastosowano domyślnego stylu frameworka w miejsce projektu.
- [ ] Główne punkty wyrównania i odstępy mieszczą się orientacyjnie w granicy 4–8 CSS px względem znormalizowanego wzorca; większe różnice są poprawione lub wyjaśnione ograniczeniem istniejącej powłoki aplikacji.
- [ ] Widok został sprawdzony również przy pustych danych, błędzie, długiej nazwie i w trakcie zapisu.

Porównaj obrazy obok siebie lub nakładką. Nie zaliczaj odbioru wyłącznie odczytem CSS albo obecnością elementów w DOM. Nie jest wymagany nowy rozbudowany system testów obrazu: wystarczy odtwarzalny, rzetelny dowód na faktycznie uruchomionym widoku.

### 12.2. Próby działania

| ID | Próba | Wynik wymagany |
|---|---|---|
| PT-01 | Otwarcie pustego formularza | Brak przykładowych danych produkcyjnych i usuniętej kontrolki; czytelne podsumowanie bez fałszywych zer |
| PT-02 | Wybór i zmiana marki/modelu | Właściwe dane produktu; brak modelu z poprzedniej marki i starego podsumowania |
| PT-03 | Plus/minus i wpisanie większej ilości | Jedna poprawna zmiana wartości; żadnego zapisu do API; zachowane limity |
| PT-04 | 6 × 98,40 zł, następnie zmiana na 7 sztuk | Kolejno 590,40 zł i 688,80 zł bez przeładowania |
| PT-05 | Wyczyszczenie/błędna ilość lub cena | Zależny wynik „—”, konkretna walidacja, brak starej sumy |
| PT-06 | Netto/Brutto oraz opcjonalna/podana data | Dotychczasowe przeliczanie i obowiązkowość; poprawny format zapisu, bez przesunięcia dnia |
| PT-07 | Poprawny zapis bez kontrolki Detal | To samo znaczenie payloadu; pojedyncze przyjęcie, poprawna aktualizacja istniejącego magazynu |
| PT-08 | Dwuklik / Enter w trakcie zapisu / ponowne wejście do widoku | Brak dodatkowego żądania wywołanego UI i podwójnego efektu |
| PT-09 | Odmowa serwera / nieznany wynik po utracie odpowiedzi | Dane zachowane, komunikat zgodny z rzeczywistą wiedzą, brak automatycznego duplikowania |
| PT-10 | Anulowanie czystego i zmienionego formularza | Powrót bez zapisu; przy zmianach skuteczne potwierdzenie i możliwość dalszej edycji |
| PT-11 | Telefon 390 px, niski widok 800×550, zoom 200%, klawiatura | Dostępne wszystkie pola, podsumowanie, błędy i akcje |
| PT-12 | Inny ekran ze wspólnymi kontrolkami i zapisami | Brak zmiany wyglądu/semantyki poza zakresem tego widoku |

Wykorzystaj istniejące testy, gdzie pokrywają scenariusz. Dodawaj nowe tylko dla istotnych zmian: kontraktu bez kontrolki, obliczenia podsumowania i ochrony przed powielonym wysłaniem. Nie twórz testów wyłącznie sprawdzających klasy CSS. Testy zapisujące nie mogą używać rzeczywistych danych salonu.

## 13. Co oddać po wykonaniu

1. Zmienione pliki produktu i zwięzłe wyjaśnienie zakresu.
2. `PRZYJECIE_TOWARU_WYNIK.md`: punkt odniesienia kodu, mapa zachowanych pól/API, reguły ceny/ilości/daty, zachowanie po sukcesie i wyniki PT-01–12. Każdy wynik ma wskazywać rodzaj dowodu; niewykonanej próby nie oznaczaj PASS.
3. Zrzuty rzeczywistego wdrożenia na danych fikcyjnych: stan referencyjny desktop, telefon, walidacja oraz zapis w toku. Zrzut porównawczy powinien obejmować cały istotny formularz.
4. Informację: co wykonano lokalnie, co zapisano w git, czy był push, czy było wdrożenie. Nie utożsamiaj tych zdarzeń.

**Warunek zakończenia:** rzeczywisty formularz wizualnie odpowiada zatwierdzonej makiecie, jest wygodny w opisanych stanach i nadal zapisuje ten sam rodzaj przyjęcia do istniejącego Estelio.
