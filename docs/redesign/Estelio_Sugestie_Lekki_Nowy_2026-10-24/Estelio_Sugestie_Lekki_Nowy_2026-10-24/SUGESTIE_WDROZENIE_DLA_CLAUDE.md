# Estelio — Sugestie zabiegów / Cross-selling

**Redesign „lekki nowy”, 24.10.2026. Instrukcja wykonawcza dla Claude Code.**

## 1. Co masz wykonać

Zmień prezentację istniejącego ekranu **Kreator Sugestii (Cross-selling)** według dwóch makiet z tej paczki. Użyj dostarczonego HTML/CSS/JS jako wzorca zachowania i wyglądu. Zachowaj obecną logikę dopasowania sugestii, zapis, uprawnienia i izolację salonów.

Zakres: nagłówek treści, formularz nowej reguły, podgląd wpisywanej treści, lista aktywnych reguł, wyszukiwanie na tej liście i potwierdzenie usunięcia. Nie przeprojektowuj sidebaru, menu administracji, logo, modułu retencji, sprzedaży, profilu klienta ani terminarza. Nie zmieniaj routingu ani nazw w globalnym menu tylko dlatego, że tytuł treści jest krótszy.

To nie jest nowy silnik rekomendacji. Nie dodawaj AI, automatycznych wiadomości, zapisywania wizyt, liczników skuteczności, przełączników aktywności, priorytetów, cykli ani edycji istniejącej reguły, których nie potwierdzono na źródłowym ekranie.

Nie wprowadzaj migracji bazy dla zmiany wyglądu. Nie uruchamiaj wdrożenia produkcyjnego na podstawie samej paczki.

## 2. Źródło i fakty

Analiza obejmuje zrzut `image(20261024-054128).png` oraz lokalny przewodnik managera z 08.06.2026 (karta „Cross-sell (sugestie)”). Repozytorium i API Estelio nie były dostępne do tej analizy.

| Element źródła | Ustalony fakt |
|---|---|
| Tytuł | Kreator Sugestii (Cross-selling) |
| Opis | „Jeśli klient kupił Zabieg A, system podpowie recepcji, by zaproponować Zabieg B” |
| Pierwsze pole | „Jeśli klient był na…”; placeholder „Wpisz lub wybierz…” |
| Drugie pole | „Zaproponuj mu…”; placeholder „Wpisz lub wybierz…” |
| Trzecie pole | Argumentacja opcjonalna |
| Zapis | Zapisz regułę |
| Lista | Aktywne reguły; przy każdej ikona × do usunięcia |
| Przykłady | Storz → Endermologia LPG; Endermologia Alliance → Endermologia Infinity; Alma SpaDeep → Endermologia Infinity |
| Pomoc | Przycisk „?” w prawym górnym rogu treści |

### Rozbieżność, której nie wolno rozstrzygnąć samą grafiką

„Klient kupił” i „klient był na” to różne zdarzenia. W projekcie przyjęto **„Po zakupie”** na podstawie opisu i kart reguł. Przed integracją ustal w kodzie, czy warunek odnosi się do zakupu, wykonania zabiegu czy innej historii. Jeśli do wykonania — zmień spójnie kopię na „Po zabiegu”, opis formularza i podgląd, zachowując istniejący trigger. Nie podpinać nowego zdarzenia terminarza.

Przewodnik podaje też ogólny przykład „po strzyżeniu zaproponuj odżywkę”. Nie dowodzi to obecnego zakresu katalogu. Jeśli kod dopuszcza kosmetyki/inne rodzaje ofert, zachowaj je: użyj tytułu „Sugestie dla zespołu”, neutralnego placeholdera „Wpisz lub wybierz…” i właściwych etykiet. Nie zawężaj backendu do zabiegów przez zmianę UI.

## 3. Inwentaryzacja przed implementacją

Znajdź istniejący widok po tekście „Kreator Sugestii”, „cross”, „ZAPISZ REGUŁĘ” lub identyfikatorze aktualnej pozycji menu. W raporcie podaj faktyczne ścieżki plików, a nie proponowane nowe nazwy endpointów.

Ustal z kodu:

1. Źródło reguł, format rekordów, stabilne ID, zakres salonu.
2. Źródło obu list ofert; czy dopuszczają dowolny tekst, czy wyłącznie wybór istniejącej oferty; czy zapis to ID, nazwa, wariant, grupa.
3. Rzeczywiste zdarzenie uruchamiające sugestię i miejsce jej prezentacji recepcji.
4. Dopuszczalność A → A, A → B powtórzonego, A → B i B → A, wielu propozycji dla A; ewentualna kolejność i limity.
5. Reguły dla usuniętej/wyłączonej oferty, zmiany nazwy, identycznych nazw i dawnych rekordów tekstowych.
6. Faktyczne reguły walidacji, długości pól, tekst opcjonalny, błędy API.
7. Uprawnienia dodawania i usuwania; mechanizm sesji, salonu, CSRF i konfliktów.
8. Zachowanie usuwania: twarde usunięcie czy archiwizacja, wpływ na już wyświetlone sugestie. Nie zmieniaj tego bez osobnego zadania.
9. Czy lista jest kompletna, stronicowana czy ładowana częściami. Licznik i wyszukiwarka nie mogą udawać globalnych wyników przy częściowym zbiorze.

Nie zatrzymuj prac nad stylem dla rutynowej analizy kodu. Nierozstrzygnięte znaczenie biznesowe zapisz jawnie w raporcie; nie wymyślaj nowej reguły.

## 4. Układ i hierarchia

### Nagłówek

Małe „Administracja / Sugestie” jako tekst, bez fikcyjnego linku. H1 „Sugestie zabiegów”. Opis: „Ustal, co zespół może zaproponować przy kolejnej rozmowie z klientką.” Przy prawej krawędzi istniejąca pomoc „?”. Bez emoji mózgu, plusów w tytule i wielkich liter w etykietach.

### Formularz — lewa karta

H2 „Dodaj regułę”, opis „Połącz zakupiony zabieg z kolejną propozycją.”

| Kolejność | Element | Zachowanie |
|---|---|---|
| 1 | Po zakupie | Wyszukiwanie/wybór według dotychczasowego kontraktu |
| 2 | Zaproponuj | Analogiczna kontrolka; strzałka pomiędzy polami pokazuje kierunek |
| 3 | Wskazówka dla zespołu (opcjonalnie) | Pole wielowierszowe, podpowiedź „Krótki argument, który pomoże w rozmowie.” |
| 4 | Stopka | „Reguła pojawi się na liście po zapisaniu.” i główny przycisk „Dodaj regułę” |

Zachowane trzy pola biznesowe. Nie wprowadzaj wymogu argumentacji. Nie generuj argumentów automatycznie. Nie poprawiaj istniejących treści pracowników ani nazw zabiegów przy migracji widoku. Przykładowe zdania w paczce służą wizualizacji; nie zapisuj ich jako domyślnych reguł salonu.

### Podgląd — prawa karta

H2 „Podgląd sugestii”, opis „Przykład treści dla zespołu”. Jasnoróżowy panel: warunek, strzałka, propozycja i wpisana wskazówka. Stopka „Podgląd nie zapisuje reguły.”

Podgląd reaguje na lokalne wpisywanie, bez API zapisu. Nie przedstawiaj go jako identycznego okna recepcji, jeżeli obecny odbiorca reguł wygląda inaczej — to przykład treści, a nie przebudowa innego modułu. Nie pokazuj danych klientek, efektów medycznych czy wyniku algorytmu.

Użyj „Zaproponuj: [nazwa]”. Nie odmieniaj automatycznie nazw produktów. Makieta używa „Zaproponuj Endermologię LPG” wyłącznie dla przykładu; w kodzie celowo zastosowano bezpieczny gramatycznie dwukropek.

### Aktywne reguły — karta pełnej szerokości

Nagłówek, licznik faktycznej listy, wyszukiwarka. Poniżej wiersze:

- mała etykieta „Po zakupie”, nazwa źródłowa;
- strzałka;
- mała etykieta „Zaproponuj”, nazwa docelowa, wskazówka poniżej jeśli istnieje;
- jawny przycisk z ikoną kosza i tekstem „Usuń”.

Zastępujemy małe karty wciśnięte z lewej czytelną listą. Nie ucinaj informacji potrzebnych do identyfikacji reguły. Długie nazwy i argumenty zawijają się. Nie używaj samego koloru do odróżniania warunku i propozycji.

Wyszukiwanie obejmuje obie nazwy i wskazówkę, działa bez rozróżniania wielkości liter i polskich znaków w demo. Nie modyfikuje danych ani ich dopasowywania do klientów. Przy filtrze pokaż „Wyniki: X z Y”; Y oznacza cały dostępny zbiór, a nie wymyśloną liczbę. Zachowaj wyszukiwanie po dodaniu/usunięciu. Jeżeli nowy rekord nie pasuje do filtra, komunikat sukcesu informuje o aktywnym filtrowaniu.

## 5. Wybór zabiegów i niejednoznaczne nazwy

Lista otwiera się przy polu, nie w nowym pełnym oknie. Wpisywanie zawęża propozycje. Aktywna pozycja klawiatury ma jasnoróżowe tło. Brak wybranego elementu nie jest błędem, dopóki kontrakt dopuszcza zwykły tekst.

- Strzałki zmieniają aktywną propozycję; Enter ją wybiera, ESC zamyka listę, Tab pozwala przejść dalej.
- Enter przy otwartej liście nie wysyła całego formularza.
- Wybór myszą i dotykiem działa bez utraty wpisanej wartości.
- Jeśli tylko katalog: wymagaj właściwej tożsamości pozycji, nie samego podobieństwa nazwy.
- Jeżeli dowolny tekst dozwolony: brak wyników nie blokuje wpisu. Nie twórz przy tym nowego zabiegu w cenniku.
- Każda zmiana tekstu po wyborze unieważnia wcześniejsze ID. Nie wysyłaj ID starej oferty z nową nazwą.
- Dwie oferty o tej samej nazwie rozróżnij danymi faktycznie dostępnymi w systemie, np. wariantem. Nie zgaduj identyfikacji.
- Nie konwertuj starych reguł po nazwie na ID automatycznie podczas odczytu.
- Zachowaj istniejącą walidację duplikatów, reguł zwrotnych i A → A. Demo celowo nie narzuca tych zasad.
- Dla dużego katalogu użyj istniejącego wyszukiwania serwerowego z obsługą spóźnionych odpowiedzi i dostępności. Demo filtruje mały katalog lokalnie i pokazuje maksymalnie 30 propozycji z informacją o zawężeniu. Nie myl tego z limitem katalogu.

## 6. Dodawanie — stany i przebieg

1. Odczytaj autoryzowane dane. Do ukończenia odczytu nie pozwalaj zapisywać.
2. Użytkownik wpisuje lub wybiera dwie pozycje i opcjonalną wskazówkę.
3. Podgląd zmienia się lokalnie. Wyszukiwanie listy i otwieranie pomocy nie zapisują niczego.
4. Kliknięcie „Dodaj regułę” uruchamia dotychczasową walidację. Błędy przy polach, fokus na pierwszy błąd, wartości pozostają.
5. W trakcie zapisu blokuj ponowne wysłanie oraz edycję wysyłanej reguły. Przycisk „Dodawanie…”.
6. Dopiero potwierdzony zapis dodaje regułę do listy i czyści formularz. Ogłoś „Reguła została dodana.”.
7. Błąd pozostawia draft. Timeout nie może udawać pewnego niepowodzenia ani wywoływać automatycznej powtórki.
8. W razie konfliktu/niepewnego wyniku wczytaj stan, zachowując draft. Ustal, czy poprzednia operacja dotarła. Jeżeli API ma idempotencję, użyj jej. Nie twórz drugiego rekordu przez automatyczne ponowienie.
9. Odświeżenie strony oraz routing SPA powinny respektować dotychczasowe ostrzeżenie o niezapisanym formularzu. Nie ostrzegaj o zmianie samego wyszukiwania listy.

## 7. Usuwanie

Przycisk „Usuń” otwiera potwierdzenie, nigdy nie usuwa tylko wskutek wejścia w szczegóły. Dialog:

- tytuł „Usunąć tę regułę?”;
- opis „Ta reguła zostanie usunięta z listy sugestii.”;
- dokładna para źródło → propozycja;
- przyciski „Zostaw regułę” (domyślny fokus) i „Usuń regułę”.

Operacja po stabilnym ID i w aktualnym salonie. W czasie zapisu blokada wielokrotnego kliknięcia. Sukces dopiero po serwerze; wiersz znika i aktualizuje się licznik. Błąd zostawia wiersz. Nie oferuj fikcyjnego „Cofnij”, jeśli backend nie ma odpowiedniej operacji.

ESC anuluje przed rozpoczęciem usuwania. W trakcie operacji dialog nie znika. Przy niepewnym wyniku przycisk „Zostaw regułę” zmienia się na neutralne „Zamknij”, ponieważ nie można obiecywać, że reguła nadal istnieje. Zamknij dialog i wczytaj aktualny stan; brak automatycznej powtórki. Po anulowaniu fokus wraca do przycisku inicjującego, po usunięciu do nagłówka listy.

Usunięcie tej reguły nie jest usuwaniem zabiegu, zakupu, wizyty ani klienta. Zachowaj rzeczywistą semantykę kasowania/archiwizacji reguły.

## 8. Puste dane, błędy i uprawnienia

| Stan | UI |
|---|---|
| Pobieranie | „Wczytywanie reguł…”, bez aktywnego zapisu |
| Błąd odczytu | Błąd i „Wczytaj ponownie”; nie pokazuj pustej listy jako poprawnego wyniku |
| Brak reguł | „Nie ma jeszcze reguł” i wskazanie formularza powyżej |
| Brak wyników filtra | „Nie znaleziono reguł”, „Wyczyść wyszukiwanie” |
| Brak podpowiedzi | Informacja zależna od dopuszczalności dowolnego tekstu |
| Wskazówka pusta | Dozwolona; na liście brak sztucznego „brak argumentacji” |
| Tylko odczyt | Lista i wyszukiwanie dostępne, zapis nieaktywny, usuwanie niedostępne |
| Nieprawidłowy/stary rekord | Nie usuwaj automatycznie, zgłoś i użyj istniejącego zachowania dla rekordów historycznych |
| Odebranie uprawnień podczas pracy | Backend odmawia; aktualizuj stan po ponownym odczycie |
| Równoległa zmiana | Obsłuż aktualny mechanizm konfliktu; nie nadpisuj cudzych zmian |
| Wygaśnięta sesja | Istniejąca ścieżka ponownego logowania; nie czyść draftu niepotrzebnie |

Nie wprowadzaj uprawnień wyłącznie w JS. Każda mutacja nadal wymaga autoryzacji po stronie serwera. Nie wolno użyć globalnej listy reguł między salonami.

## 9. Dokładna warstwa wizualna

| Element | Parametr CSS |
|---|---|
| Obszar | max-width 1120px; w istniejącej treści za sidebar |
| Tło strony | #FAF8F5; jeżeli host ma już zgodne, pozostaw |
| Font | Obecny sans-serif Estelio; fallback system-ui |
| Tekst | #242126; drugorzędny #67616B |
| Akcent | #842D49, hover #70243D |
| Jasny panel | #F8EDF1 |
| Karta | biała, border 1px #E7E1DE, radius18px, bardzo delikatny cień |
| Nagłówek strony | 30px/38px, font-weight650, letter-spacing −0.7px |
| H2 | 21px/29px, font-weight650 |
| Pola | 48px, font16px, radius10px, border #D9D4D8 |
| Etykiety | 14px, font-weight550, zdaniowe |
| Przyciski | min-height44px, radius10px, font14px |
| Układ górny | 1.62fr / 1fr, gap20px, wyrównane karty |
| Padding | 26px desktop; 20px mobile |
| Wiersz reguły | padding18px 26px; separatorem cienka linia |
| Fokus | 2px #842D49, offset3px |
| Dialog | width440px, max-width calc(100vw − 32px), padding28px |

Wszystkie style ogranicz do `.estelio-suggestions`. Nie zmieniaj globalnych input/button/h1 ani wspólnych klas card. Demo ma osobny styl body/main tylko dla podglądu, którego nie należy przenosić do Estelio.

Grafiki mogą zawierać delikatne różnice renderowania i fontów. CSS i powyższe parametry są jednoznacznym wzorcem; nie kopiuj tekstur, pseudo-gradientów ani obrazu całego UI jako tła. Makiety są z silnika graficznego, nie są screenshotami wykonanej aplikacji.

## 10. Responsywność i dostępność

- Przy dostępnej szerokości treści do920px: formularz, podgląd, lista w jednej kolumnie.
- Do580px: oba wybory pod sobą, strzałka znika; przycisk na szerokość karty; wyszukiwarka pod tytułem listy; reguła ma warunek i propozycję jeden pod drugim.
- Nie ukrywaj istotnych pól na telefonie. Sprawdź320px,400px,800×550, desktop i zoom200%, także po odjęciu sidebaru.
- Dropdown ma ograniczoną wysokość i wewnętrzne przewijanie. Sprawdź czy host nie obcina go overflow; gdy konieczne użyj istniejącej warstwy popover z pozycjonowaniem i przerzucaniem nad pole przy dolnej krawędzi. Sam wysoki z-index nie rozwiązuje overflow.
- Docelowo umieść popup w widocznym obszarze także z klawiaturą ekranową. Demo nie ma silnika pozycjonowania zewnętrznego; jest to punkt odbioru integracji.
- Combobox: label, aria-expanded, aria-controls, aria-autocomplete, aria-activedescendant; listbox i option. Sprawdź czytnik ekranu, nie tylko wygląd.
- Prawdziwe button/form/dialog; żadnych klikanych divów zamiast przycisków.
- Dialog utrzymuje fokus i blokuje tło. Zamknięcie przywraca fokus. Nie otwieraj kilku dialogów nad sobą.
- Nie ogłaszaj całego podglądu przy każdej literze. Ogłaszaj sukces/błąd i wynik filtrowania.
- Dane użytkownika wstawiaj jako tekst; nigdy jako HTML. Nie wykonuj argumentacji zawierającej znaczniki.

## 11. Pomoc kontekstowa

Propozycja krótkiej treści:

> **Jak działa reguła sugestii?** Połącz zabieg z kolejną propozycją i opcjonalnie dodaj krótką wskazówkę dla zespołu. Podgląd pokazuje treść tworzonej reguły. Reguła pojawi się na liście po zapisaniu.

Dopasuj pierwsze zdanie do potwierdzonego triggera i zakresu ofert. Podłącz istniejącą pomoc Estelio zamiast budować drugi globalny system pomocy. Link do pełnej instrukcji dodaj wyłącznie do sprawdzonego rozdziału z istniejącą kotwicą; w demo nie ma zgadywanego linku. Pytajnik nie wysyła formularza.

## 12. Kolejność pracy dla Claude

1. Przeczytaj `START.md`, ten dokument i `INTEGRACJA_KODU.md`.
2. Obejrzyj obie grafiki i uruchom `index.html`. Demo otwiera pusty formularz z trzema regułami; wypełnienie z makiety jest przykładowym stanem.
3. Zrób mapę elementów i kontraktów opisaną w sekcji3. Potwierdź zakup vs wykonanie, tekst vs ID i typy ofert.
4. Przenieś strukturę i scoped CSS do istniejącej aplikacji. Zachowaj host, router i aktualne komponenty dostępności, jeśli są lepsze od wersji demonstracyjnej.
5. Podłącz realny adapter. Usuń z produkcyjnego builda `demo-adapter.js`, `demo.js` i demonstracyjną stopkę.
6. Podłącz pełne stany: odczyt, formularz, zapis, lista, usuwanie, prawa dostępu i błędy. Wyszukiwanie listy nie zmienia biznesowej logiki dopasowywania reguł.
7. Wykonaj testy na izolowanym środowisku i uzupełnij tabelę odbioru. Żadne testy demonstracyjne nie zastępują odbioru rzeczywistego API.
8. Oddaj diff, raport i porównania widoku. Nie oznaczaj całości jako wdrożonej tylko na podstawie grafiki.

## 13. Kryteria odbioru

| ID | Próba | Warunek zaliczenia |
|---|---|---|
| S01 | Odczyt | Wszystkie dotychczasowe reguły zachowane, właściwy salon |
| S02 | Dodanie | Oba wymagane pola, wskazówka opcjonalna; jeden potwierdzony rekord |
| S03 | Wybrana pozycja → edycja nazwy | Nie zostaje stare ID przy innym tekście |
| S04 | Puste/błędne pola | Błędy przy polach, bez API zapisu |
| S05 | Duplikat/A→A/wiele propozycji | Dokładnie obecna polityka backendu |
| S06 | Utrata sieci/dwuklik | Brak fałszywego sukcesu i automatycznych duplikatów |
| S07 | Usunięcie anulowane | Brak mutacji, fokus wraca do przycisku |
| S08 | Usunięcie potwierdzone | Tylko wskazany rekord; pozostałe zachowane |
| S09 | Błąd/usunięcie w drugim oknie | Lista aktualizowana bez usuwania innego rekordu |
| S10 | Filtr | Obie nazwy i argumentacja, licznik i pusty stan zgodne |
| S11 | Tekst z HTML, cudzysłowem, polskimi znakami | Pokazywany bez wykonania kodu; semantyka zapisu zachowana |
| S12 | Tylko odczyt / inny salon | Kontrola backendu i UI, brak dostępu do cudzych danych |
| S13 | Klawiatura/dotyk | Wybór, ESC, Enter, fokus i dialog działają |
| S14 | 320/400/800×550/200% | Pola, popup i przyciski dostępne bez obcięcia |
| S15 | Odbiorca sugestii | Ten sam warunek i ta sama propozycja co przed redesignem |
| S16 | Nawigacja SPA | Brak powielonych listenerów; ochrona draftu |
| S17 | Reguły historyczne / wyłączona oferta | Brak cichej utraty reguł albo zmiany tożsamości |
| S18 | Inne moduły | Brak wycieku CSS i zmian logiki poza zakresem |

Przed/po porównuj ten sam salon testowy, te same dane i szerokość obszaru treści. Screenshoty z wymyślonymi rekordami, bez danych klientek.

## 14. Co dostarczyć po integracji

Raport ze ścieżkami zmienionych plików, tabelą kontraktów, decyzją zakup/wykonanie, tekst/ID, zakresem katalogu, sprawdzonymi uprawnieniami, wynikami testów, screenami desktop/mobile/popup/dialog oraz listą odstępstw od projektu z przyczynami. Nie deklaruj PASS dla próby niewykonanej.

Ta paczka: 36 testów modelu/adaptera demonstracyjnego PASS. Kontrola składni i struktury plików wykonana. Brak testu przeglądarkowego (środowisko nie ma pliku wykonywalnego Chromium), brak integracji z serwerem Estelio. Dokładną zgodność wyglądu i interakcji należy sprawdzić po uruchomieniu.
