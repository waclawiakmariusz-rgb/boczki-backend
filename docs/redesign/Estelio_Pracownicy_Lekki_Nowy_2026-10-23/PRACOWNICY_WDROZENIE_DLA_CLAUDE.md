# Estelio — Pracownicy: redesign „lekki nowy”

Data: 23.10.2026. Status: projekt graficzny i specyfikacja do implementacji. Nie jest to raport z przeglądu kodu ani potwierdzenie wdrożenia.

## 1. Polecenie dla Claude Code

Przeprojektuj wyłącznie zawartość istniejącego widoku Administracja → Pracownicy zgodnie z `01-pracownicy-makieta.png` i tym dokumentem. Zachowaj istniejące źródło danych, identyfikatory, uprawnienia, powiązania ze sprzedażą oraz kontrakty zapisu. Najpierw znajdź właściwy komponent i jego obsługę w repozytorium. Następnie wdroż wygląd i opisane zachowania w istniejącej architekturze.

To ekran listy osób biorących udział w sprzedaży. Nie rozszerzaj zadania o konta użytkowników, role, PIN-y, moduł Dostępy, grafik pracy, prowizje ani terminarz. Nie zmieniaj menu, logo, nagłówka aplikacji i pozostałych modułów. Nie dodawaj nowego backendu ani migracji do zadania wizualnego.

Makieta pokazuje sam obszar treści. Nie traktuj braku bocznego menu na grafice jako polecenia usunięcia go z Estelio. Przykładowych nazwisk z makiety nie zapisuj do bazy.

## 2. Co wiemy ze zrzutu i co sprawdzić w kodzie

Zrzut źródłowy: `image(20261022-091924).png`, przekazany przez użytkownika. Na ekranie jest jedno pole „Imię i nazwisko”, przycisk „Dodaj”, lista ośmiu osób i akcja oznaczona czerwonym krzyżykiem. W prawym górnym rogu istnieje pomoc „?”.

Zanim zmienisz obsługę, zanotuj w raporcie:

- plik renderujący ekran i funkcje pobierania, dodawania oraz usuwania;
- faktyczny identyfikator rekordu i sposób powiązania ze sprzedażą;
- obecne reguły duplikatów, długości nazwy, kolejności listy i uprawnień;
- co rzeczywiście robi krzyżyk: usunięcie rekordu, ukrycie, dezaktywacja lub inna operacja;
- wpływ tej operacji na historyczną sprzedaż i raporty oraz istniejące blokady;
- aktualny mechanizm pomocy i prawdziwy adres jej sekcji.

Nie zgaduj endpointów ani semantyki usuwania. Nie deklaruj w interfejsie, że „historia pozostaje bez zmian”, dopóki nie potwierdzisz tego w kodzie. Jeżeli odkryjesz sprzeczność z projektem, dopasuj tylko treść opisującą rzeczywisty skutek i opisz różnicę. Błąd biznesowy zgłoś osobno, bez rozszerzania redesignu o zmianę modelu danych.

## 3. Układ docelowy

### Nagłówek

- H1: „Pracownicy”.
- Podtytuł: „Lista osób biorących udział w sprzedaży.”
- Po prawej dotychczasowa pomoc „?” z polem kliknięcia 44 × 44 px.
- Odstęp od nagłówka do kart: 24 px.

### Dwie karty

Desktop: 38% szerokości na formularz, 62% na listę, po odjęciu odstępu 24 px. Wyrównanie do górnej krawędzi. Lewa karta ma wysokość wynikającą z treści; nie rozciągaj jej do wysokości prawej.

Lewa karta:

1. H2 „Dodaj pracownika”.
2. Opis „Wpisz osobę, którą chcesz dodać do listy.”
3. Etykieta „Imię i nazwisko”.
4. Pole tekstowe z placeholderem „np. Anna Kowalska”.
5. Przycisk z ikoną plusa „Dodaj pracownika”, na szerokość wnętrza tej karty.

Prawa karta:

1. H2 „Lista pracowników” oraz dyskretny licznik rekordów obok.
2. Opis „Osoby biorące udział w sprzedaży.”
3. Lista wierszy: okrąg z pierwszą literą nazwy, nazwa, przycisk z ikoną kosza i tekstem „Usuń”.

Licznik pobieraj z rzeczywistego stanu listy. Jeśli istnieje stronicowanie, nie przedstawiaj liczby bieżącej strony jako całkowitej. Zachowaj dotychczasową kolejność rekordów. Nie dokładaj sortowania, wyszukiwarki, paginacji ani edycji nazw w ramach tego zadania.

Wiersz ma co najmniej 60 px wysokości i cienki separator. Ostatni wiersz nie potrzebuje dolnego separatora. Brak pasów zebra i ciężkiej tabeli. Cały wiersz nie jest przyciskiem. Okrąg z literą jest dekoracyjny i nie sugeruje profilu pracownika. Powtarzające się inicjały są poprawne; identyfikacja operacji zawsze przez rzeczywisty klucz rekordu.

## 4. Parametry wizualne

Wartości poniżej odnoszą się do pikseli CSS, nie do rozdzielczości makiety. Obraz służy do oceny kompozycji; konkretne wartości z dokumentu mają pierwszeństwo przed artefaktami generowania.

| Element | Wartość |
| --- | --- |
| Tło treści | `#FAF8F5` |
| Tło kart | `#FFFFFF` |
| Obramowania | `#E7E1DE`, 1 px |
| Tekst główny | `#242126` |
| Tekst pomocniczy | `#67616B` |
| Akcent i przycisk główny | `#842D49` |
| Hover głównego przycisku | `#70243D` |
| Jasne tło inicjału/licznika | `#F8EDF1` |
| Tekst akcji usuwania | `#744555`; hover `#9B2442` |
| Promień kart | 18 px |
| Promień pola i przycisku | 12 px |
| Cień karty | `0 6px 24px rgba(36,33,38,.04)` |
| Maksymalna szerokość treści | 1120 px, wyśrodkowana w istniejącym obszarze treści |
| Padding obszaru | 32 px desktop, 20 px mobile, 16 px przy 320 px |
| Padding kart | 24 px desktop, 20 px mobile, 16 px przy 320 px |
| Font | istniejący bezszeryfowy font Estelio; fallback system-ui |
| H1 | 28/36 px, 700 |
| H2 | 20/28 px, 600 |
| Nazwa, input, przycisk | 16/24 px |
| Etykieta i opisy | 14/20 px |
| Input i główna akcja | min. 44 px wysokości; docelowo 48 px |
| Inicjał | koło 40 × 40 px; litera 16 px, 600 |
| Fokus | obrys 2 px `#842D49`, odsunięty o 2 px |

Zastosuj płaskie wypełnienia. Nie odtwarzaj delikatnego szumu lub pozornego gradientu z rastra. Nie dodawaj szeryfowych fontów, wielkich liter w etykietach, emoji ani dekoracji marketingowych. Ikony z istniejącej biblioteki Estelio, jednolite 18–20 px.

## 5. Dodawanie — pełna ścieżka

1. Wejście na stronę nie ustawia automatycznie fokusu w polu, żeby na telefonie nie otwierać klawiatury.
2. Pole ma widoczny label i jest prawdziwym elementem formularza. Enter uruchamia tę samą operację co przycisk.
3. Kliknięcie przy pustym polu pokazuje pod nim „Wpisz imię i nazwisko.”, ustawia `aria-invalid` i przenosi fokus do pola. Placeholder nie zastępuje etykiety.
4. Nie wymuszaj dwóch wyrazów: obecne dane zawierają także same imiona. Zachowaj dotychczasowe reguły walidacji i limity. Nie zmieniaj automatycznie wielkości liter ani nazw już zapisanych.
5. Podczas zapisu etykieta przycisku to „Dodawanie…”. Blokuj ponowne wysłanie tego formularza i zmianę jego danych do czasu wyniku. Inne funkcje strony pozostają dostępne.
6. Sukces potwierdzaj dopiero po odpowiedzi serwera. Uaktualnij listę i licznik zgodnie z odpowiedzią lub ponownym odczytem. Wyczyść pole, pokaż „Dodano pracownika.” w spokojnym komunikacie statusu, przywróć fokus do pola.
7. Przy błędzie zachowaj wpisaną nazwę, odblokuj formularz i pokaż komunikat blisko akcji. Dla nieznanego błędu: „Nie udało się dodać pracownika. Spróbuj ponownie.” Nie pokazuj surowego wyjątku serwera.
8. Duplikaty obsługuj według istniejącego kontraktu. Nie wprowadzaj nowej globalnej unikalności nazw. Jeśli serwer odrzuca duplikat, pokaż „Taka osoba jest już na liście.” i zachowaj tekst.
9. Przy niejednoznacznym wyniku sieciowym sprawdź listę przed kolejną próbą. Nie ponawiaj automatycznie mutacji, jeśli istniejący kontrakt nie gwarantuje idempotencji.

## 6. Usuwanie — pełna ścieżka

Mały krzyżyk zastąp akcją z ikoną i tekstem. Nazwa dostępności: „Usuń pracownika: {nazwa}”. Pojedyncze kliknięcie otwiera potwierdzenie, nie wykonuje od razu operacji.

Dialog: istniejący komponent Estelio, maks. 440 px, padding 24 px, te same kolory i promienie. Tytuł „Usunąć pracownika?”. Treść pytania „Czy chcesz usunąć {nazwa} z listy pracowników?”. Poniżej opis skutku wynikający wyłącznie z ustaleń w kodzie. Jeśli operacja w rzeczywistości dezaktywuje osobę, użyj precyzyjnej etykiety zgodnej z tą operacją zamiast obiecywać fizyczne usunięcie. Zapisz to odstępstwo w raporcie.

- Przyciski: „Anuluj” i „Usuń”. Fokus początkowo na „Anuluj”.
- Escape i kliknięcie tła przed wysłaniem anulują. Fokus wraca do przycisku danego wiersza.
- Podczas operacji etykieta „Usuwanie…”, brak kolejnego wysłania; dialog pozostaje otwarty do wyniku i przekazuje status czytnikowi ekranu.
- Sukces: zamknij dialog, odśwież listę/licznik, komunikat „Usunięto pracownika.”; fokus na następnej dostępnej akcji, poprzedniej jeśli usunięto ostatni wiersz, albo nagłówku pustej listy.
- Błąd: wiersz pozostaje, dialog zawiera błąd i możliwość anulowania lub ponowienia po rozstrzygnięciu stanu.
- Istniejąca blokada z powodu powiązań: zachowaj ją i objaśnij użytkownikowi na podstawie odpowiedzi serwera. Nie obchodź jej zmianą endpointu ani ręcznym kasowaniem powiązań.
- Utrata uprawnień: wykorzystaj istniejący mechanizm sesji/autoryzacji. Ukrycie przycisku nie zastępuje kontroli po stronie serwera.
- Jeśli rekord zniknął w innej sesji: odśwież listę i poinformuj „Lista pracowników została zaktualizowana.”, bez udawania, że nasze żądanie usunęło rekord.

Nie dodawaj „Cofnij” bez działającego kontraktu odtworzenia rekordu. Nie dopisuj archiwizacji jako nowej funkcji.

## 7. Pomoc kontekstowa

Wykorzystaj dotychczasowy przycisk „?” i istniejący komponent chmurki. Tytuł „Pracownicy w sprzedaży”. Treść: „Tutaj zarządzasz listą osób biorących udział w sprzedaży. Wpisz nazwę osoby i wybierz „Dodaj pracownika”.”

Link „Więcej w pomocy” dodaj tylko do zweryfikowanej sekcji. Nie wymyślaj kotwicy ani nie kieruj do ogólnej strony udającej szczegółową instrukcję. Jeśli nie ma sekcji, uzupełnij istniejącą dokumentację w ramach małej zmiany pomocy i dopiero podłącz sprawdzony link. Chmurka działa kliknięciem, dotykiem i klawiaturą; nie wymaga hovera. Po zamknięciu wraca fokus.

## 8. Stany listy i responsywność

| Stan | Zachowanie |
| --- | --- |
| Pierwsze ładowanie | 3–4 neutralne szkielety wierszy, komunikat „Wczytywanie pracowników…”, bez fikcyjnego licznika 0 |
| Pusta lista | Tytuł „Nie ma jeszcze pracowników”, opis „Dodaj pierwszą osobę w formularzu.”, licznik 0; bez wielkiej ilustracji |
| Błąd odczytu | „Nie udało się wczytać listy pracowników.” i „Spróbuj ponownie”; nie pokazywać pustej listy jako prawidłowej |
| Odświeżanie | Zachować widoczne dane, dyskretnie oznaczyć odświeżanie |
| Długa nazwa | Zawijanie, wzrost wysokości wiersza; akcja zawsze dostępna, bez obcięcia do niezrozumiałych inicjałów |
| Wiele rekordów | Naturalny scroll strony; zachować istniejące stronicowanie, jeśli jest; nie tworzyć nowego zagnieżdżonego scrolla |

Przy szerokości obszaru treści co najmniej 900 px: dwie kolumny. Poniżej 900 px: jedna kolumna, najpierw formularz, potem lista, odstęp 20 px. Mierz dostępną szerokość treści po uwzględnieniu sidebaru, nie tylko całe okno.

Na telefonie zachowaj tekst „Usuń”, co najmniej 44 px wysokości pola kliknięcia i stabilną szerokość akcji. Nazwa może zajmować kilka linii. Przy 320 px zmniejsz odstępy, nie font inputa. Dialog ma szerokość `min(440px, 100% - 32px)` i przewijanie, jeżeli wysokość okna nie mieści treści. Testuj także zoom 200% i ekran 800 × 550 px.

## 9. Integracja i dostępność

- Style ogranicz do kontenera tego modułu, np. `.est-employees`. Zakaz globalnych zmian `button`, `input`, `h1`, `body` i innych stron.
- Zachowaj obecną obsługę sesji, salonu i nagłówków żądań. Nie twórz nowego magazynu danych w localStorage.
- Korzystaj z rzeczywistego klucza rekordu; tekst nazwy nie może stać się nowym identyfikatorem, jeżeli backend posiada ID.
- Nazwy renderuj jako tekst, bez wstrzykiwania HTML. Zachowaj kodowanie polskich znaków.
- Formularz semantyczny, etykiety związane z polami; lista `ul/li` lub równoważna dostępna struktura; inicjały i ozdobne ikony z `aria-hidden`.
- Dialog z nazwą dostępną, kontrolą fokusu, blokadą interakcji z tłem i powrotem fokusu. Użyj istniejącego przetestowanego komponentu.
- Błędy powiąż z polem, sukcesy przez dyskretny live region. Informacja nie może opierać się wyłącznie na kolorze.
- Przejścia 120–160 ms; respektuj `prefers-reduced-motion`. Brak animacji rozciągania całego ekranu.
- Sprawdź kontrast w rzeczywistym CSS. Nie rozjaśniaj tekstów opisowych do jasnoszarego ze starego widoku.

## 10. Kolejność pracy i odbiór

1. Mapa istniejącego kodu i kontraktów z sekcji 2.
2. Zmiana szablonu i lokalnych stylów; zachowanie operacji danych.
3. Podłączenie stanów, komunikatów, dialogu i pomocy.
4. Weryfikacja na danych testowych w istniejącym bezpiecznym środowisku projektu.
5. Raport plików, rzeczywistych wyników i odstępstw. Sam zrzut ekranu nie dowodzi poprawnego zapisu.

| ID | Próba | Warunek odbioru |
| --- | --- | --- |
| P01 | Desktop, 8 osób | Zgodny układ kart, kolory, hierarchia; licznik 8 z danych |
| P02 | 400 px, 320 px, zoom 200% | Bez poziomego przewijania; nazwy i akcje dostępne |
| P03 | Pusty formularz, Enter | Błąd przy polu, brak żądania zapisu |
| P04 | Poprawne dodanie, szybki dwuklik | Jedna aktywna operacja, sukces po serwerze, lista i licznik aktualne |
| P05 | Błąd zapisu | Tekst zachowany, możliwa poprawa/ponowienie, brak fikcyjnego sukcesu |
| P06 | Duplikat i samo imię | Zgodność z dotychczasowym kontraktem, brak nowej reguły dwóch wyrazów |
| P07 | Usuń → Anuluj/Escape | Brak mutacji i poprawny powrót fokusu |
| P08 | Potwierdzone usunięcie | Faktyczny dotychczasowy skutek, aktualny licznik i komunikat |
| P09 | Odmowa serwera/powiązania | Brak usunięcia w UI, wyjaśnienie istniejącej blokady |
| P10 | Pusta lista/błąd ładowania | Dwa wyraźnie różne stany, retry działa |
| P11 | Nazwa długa i znaki specjalne | Bez przepełnienia i interpretacji jako HTML |
| P12 | Klawiatura i dotyk | Wszystkie akcje dostępne, fokus widoczny, dialog i pomoc działają |
| P13 | Sprzedaż po zmianie widoku | Lista osób nadal pochodzi z tego samego źródła; dotychczasowe raporty i powiązania zachowane |
| P14 | Sąsiednie moduły | Brak efektów ubocznych CSS i zmian ich procesów |

Użyj istniejących testów właściwych dla zmienionych ścieżek. Dopisz test tylko dla konkretnego ryzyka, np. błędnego wielokrotnego wywołania zapisu. Nie przebudowuj całej baterii testów przy zmianie wyglądu.

Raport końcowy Claude: zakres i lista plików; wyniki P01–P14 jako PASS/FAIL/NIE WYKONANO; porównanie widoku desktop i mobile; ustalony skutek usuwania; ewentualne różnice względem makiety. Nie oznaczaj niewykonanych prób jako zaliczonych. To zlecenie projektu i implementacji do odbioru, nie polecenie publikacji na produkcji.

## 11. Zawartość paczki

- `01-pracownicy-makieta.png` — makieta treści widoku z fikcyjnymi danymi.
- `PRACOWNICY_WDROZENIE_DLA_CLAUDE.md` — główne polecenie wykonawcze.
- `START.md` — krótkie wprowadzenie dla wykonawcy.
- `ESTELIO_STANDARD_REDESIGNU.md` — zapis standardu przekazywania redesignów.
- `PROMPT_MAKIETY.txt` — parametry i prompt użyte w silniku graficznym.

Paczka zawiera również działający wzorzec HTML/CSS/JS, fragment do osadzenia i adapter demonstracyjny. Szczegóły w `INTEGRACJA_KODU.md`. Claude integruje wzorzec z rzeczywistym repozytorium po rozpoznaniu obecnego komponentu. Testy prototypu nie są testami produkcyjnego Estelio; wyniki zawiera `WERYFIKACJA.md`.
