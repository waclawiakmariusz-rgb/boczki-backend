# Estelio — redesign widoku Rabaty

Styl: „lekki nowy” (zwany też „nowy lekki”). Data: 22.10.2026.
Dokument wykonawczy dla Claude Code. Zakres: warstwa prezentacji istniejącego widoku rabatów salonu.

## 1. Polecenie

Przebuduj wygląd istniejącego „Kreatora Rabatów” zgodnie z makietą `makiety/01-rabaty-desktop.png` i poniższymi zasadami. Zachowaj istniejące źródła danych, uprawnienia, kontrakt zapisu oraz sposób stosowania rabatów przy sprzedaży. Nowy tytuł widoku: **Rabaty**.

Makieta pokazuje wyłącznie obszar treści. Menu boczne, logo, globalny nagłówek, chat, inne moduły i szerokość powłoki Estelio pozostają poza zakresem. Nie odtwarzaj przeglądarki ani paska systemowego ze zrzutu wejściowego. Nie przenoś do aplikacji podpisu „Propozycja wyglądu • przykładowe dane”.

W tej paczce jest projekt graficzny i specyfikacja, nie kod wdrożeniowy. Nie przeglądano obecnego repozytorium. Nazwy plików aplikacji, endpointy i klucze danych ustal na podstawie rzeczywistego kodu, nie zgaduj ich.

## 2. Co wiadomo ze źródeł

Na przesłanym ekranie widoczne są:

- tytuł „Kreator Rabatów” i długa różowa linia;
- przycisk pomocy „?” umieszczony osobno nad formularzem;
- pola: nazwa rabatu, typ rabatu, wartość;
- wybrany typ „Procentowy (%)” — lista pozostałych opcji nie jest rozwinięta;
- fioletowy przycisk „ZAPISZ NOWY RABAT”;
- sekcja „Aktywne Rabaty” z jedną zieloną kartą: „Urodziny”, „−15%”, „PROCENT”;
- duża niewykorzystana przestrzeń po prawej.

Dostarczony przewodnik `Estelio_Przewodnik_po_Systemie_2026-06-08.html` opisuje rabaty salonu jako procentowe lub kwotowe, konfigurowane w zakładce Rabaty. Jest to historyczna dokumentacja, nie dowód aktualnego kontraktu backendu. Jej inne fragmenty dotyczą kodów Stripe i zakupu abonamentu Estelio — **tych procesów nie należy łączyć z rabatami salonu**.

Makieta używa istniejącego przykładu „Urodziny −15%” i niezapisanego przykładu „Stała klientka −10%”. Nie twórz takich danych w bazie tylko dlatego, że są na grafice.

## 3. Problemy wizualne i rozwiązania

| Obecny element | Zmiana |
|---|---|
| Fioletowy przycisk, zielona karta, różowy tytuł | Jeden akcent bordowy; stan rabatu komunikowany treścią, nie jaskrawym tłem |
| Wąski formularz i mała karta pod nim, reszta ekranu pusta | Dwie kolumny: formularz po lewej, istniejące rabaty po prawej |
| Małe szare etykiety WIELKIMI LITERAMI | Czytelne etykiety zdaniowe, większy kontrast |
| Rozwijana lista z dwoma typami | Dwa segmenty „Procentowy” / „Kwotowy”, jeśli kod potwierdza dokładnie te dwie opcje |
| Pole wartości bez stale widocznej jednostki | Sufiks `%` albo waluta salonu, zgodnie z typem |
| „ZAPISZ NOWY RABAT” z emoji dyskietki | „Dodaj rabat”, przycisk bordowy z normalną wielkością liter |
| Zielony kafelek rabatu | Neutralny poziomy wiersz: ikona, nazwa i typ, wartość po prawej |
| Oderwane „?” pod nagłówkiem | Pomoc w prawym górnym rogu nagłówka treści |
| Brak kontroli wyglądu tworzonej pozycji | Niewielki, lokalny podgląd nazwy i wartości, bez obliczania cen |

## 4. Układ strony

### Nagłówek

- Okruszek „Administracja / Rabaty”, tylko jako kontekst; nie dodawaj nowego routingu. Jeśli aplikacja ma własne breadcrumbs, użyj ich. Nie umieszczaj niedziałającego linku „Administracja”.
- Tytuł „Rabaty”.
- Opis „Przygotuj rabaty dostępne przy sprzedaży.”
- Istniejący wspólny przycisk pomocy „?” po prawej. Przenieś obecny punkt dostępu; nie twórz drugiego.
- Usuń długą kolorową linię oraz emoji nożyczek w tytule.

### Obszar roboczy

Szerokość maksymalna treści: 1120 px, szerokość płynna w dostępnym obszarze aplikacji. Kontener wyśrodkowany w obszarze treści, nie względem całego okna wraz z menu. Na szerokim ekranie padding zewnętrzny 32 px, odstęp pod nagłówkiem 28 px. Dwie kolumny w proporcji ok. 54/46, odstęp 24 px, wyrównanie do góry. Prawy panel ma wysokość wynikającą z treści, bez sztucznego rozciągania do wysokości formularza.

Nie próbuj wypełniać całego monitora formularzem. Pozostałe spokojne tło jest prawidłowe. Celem jest sensowny rozkład dwóch powiązanych sekcji, a nie maksymalna liczba kart.

### Lewa karta — Nowy rabat

Kolejność:

1. Tytuł „Nowy rabat”.
2. Opis „Podaj nazwę, wybierz typ i ustaw wartość.”
3. Etykieta „Nazwa rabatu” i pole tekstowe. Przykładowy placeholder: „Np. Stała klientka”. Pomoc: „Ta nazwa pojawi się na liście przy sprzedaży.”
4. Etykieta „Typ rabatu” i wybór procentowy/kwotowy.
5. Etykieta „Wartość rabatu”, pole z jednostką wewnątrz po prawej i odpowiednia podpowiedź.
6. Pasek „Podgląd” — wyłącznie odzwierciedlenie niezapisanego formularza.
7. Delikatny separator i „Dodaj rabat” wyrównany do prawej.

Nie dodawaj przycisku „Anuluj” do pełnostronicowego, pustego formularza. Zachowaj istniejące reguły ostrzegania o niezapisanych zmianach, jeśli już występują. Nie dodawaj automatycznego zapisu.

### Prawa karta — Aktywne rabaty

- Nagłówek „Aktywne rabaty” z małym neutralnym licznikiem rzeczywiście załadowanych aktywnych pozycji. Jeżeli istnieje paginacja, licznik całkowity musi pochodzić ze źródła danych, a nie z długości bieżącej strony.
- Opis „Dostępne do wyboru przy sprzedaży.”
- Wiersze: dekoracyjna ikona etykiety; nazwa; „Rabat procentowy” albo „Rabat kwotowy”; wartość po prawej.
- Wartość prezentowana np. „−15%” albo „−50 zł” zgodnie z typem. Znak minus jest prezentacją obniżki; nie odwracaj znaku wysyłanego do API.
- Licznik i lista pochodzą z aktualnych danych, nie z makiety.
- Pod listą opcjonalnie zdanie „Zapisany rabat pojawi się na tej liście.” — można pominąć przy dużej liczbie pozycji.

Na zrzucie nie widać edycji, usuwania ani przełącznika aktywności. Nie dodawaj ich w tym zadaniu. Jeśli analiza kodu ujawni istniejące akcje dostępne na innym stanie tej samej listy, zachowaj je i ich uprawnienia; odnotuj sposób wkomponowania w raporcie. Bez takich akcji wiersz jest informacyjny: bez kursora pointer, chevronu i sugestii, że można go kliknąć.

## 5. Typ rabatu i podgląd

Wybór typu przedstaw jako jeden segmentowany zestaw natywnych radio z etykietami, nie dwa niezależne przełączniki. Jeden typ zawsze wybrany. Domyślny typ zachowaj z bieżącej implementacji; na referencji jest procentowy.

| Typ | Sufiks | Pomoc pod polem | Przykład podglądu |
|---|---|---|---|
| Procentowy | % | Wpisz wartość procentową rabatu. | Stała klientka · −10% |
| Kwotowy | zł w salonie PLN; inaczej obecna waluta | Wpisz kwotę rabatu w walucie salonu. | Stała klientka · −50 zł |

Segmenty mapują się na istniejące wartości enum/klucze backendu. Jeśli kod ujawni więcej typów, nie usuwaj ich dla zgodności z rysunkiem — zachowaj pełny wybór w lekkim, istniejącym wzorcu select i zgłoś różnicę. Nie zmieniaj waluty konfiguracji salonu.

Przy zmianie typu zachowaj wpisaną nazwę. Dla wartości zastosuj dotychczasowe zachowanie. Jeśli go nie określono, pozostaw cyfry, natychmiast zmień sufiks i podgląd oraz wykonaj ponowną walidację; nie przeliczaj procentu na kwotę ani odwrotnie. Użytkownik zatwierdza wybrany typ dopiero przy „Dodaj rabat”.

Podgląd nie jest kolejnym polem, nowym rekordem ani symulacją rachunku. Aktualizuje się lokalnie podczas pisania. Przy pustej nazwie pokaż „Nazwa rabatu”; przy pustej lub błędnej wartości pokaż „—”, nigdy „−NaN%”. Nie formatuj tekstu w samym inpucie w sposób przestawiający kursor. Formatowanie polskie stosuj w podglądzie i liście.

## 6. Walidacja i zapis

Najpierw ustal rzeczywiste reguły nazwy, wartości, precyzji, duplikatów i granic procentu na frontendzie oraz backendzie. Nie zakładaj na podstawie projektu, czy 0%, 100%, wartości ujemne lub określona liczba miejsc dziesiętnych są dozwolone. Nie dokładaj nowej reguły biznesowej pod pozorem zmiany wyglądu.

- Zachowaj wymagane pola i ograniczenia z obecnego kontraktu. Jeśli frontend i backend są sprzeczne, opisz to i popraw wyłącznie zgodność z obowiązującym kontraktem; nie wymyślaj nowej polityki rabatów.
- Obsługę przecinka/kropki oprzyj na istniejącym parserze kwot/liczb. Niedozwolona jest częściowa akceptacja ciągów, np. odczytanie `10abc` jako 10.
- Błąd umieść pod właściwym polem, powiąż przez `aria-describedby`, dodaj `aria-invalid`. Nie komunikuj go wyłącznie kolorem.
- Po próbie zapisu z błędami przenieś fokus na pierwsze niepoprawne pole. Nie kasuj pozostałych wartości.
- W czasie żądania pokaż „Zapisywanie…”, zablokuj kolejne wysłanie i zmianę wysyłanych danych. Wykorzystaj istniejące mechanizmy formularza.
- Sukces dopiero po potwierdzeniu serwera: odśwież listę i licznik, pokaż „Rabat został dodany”, wyczyść formularz dopiero po sukcesie zgodnie z istniejącą konwencją. Krótkie wyróżnienie nowej pozycji dopuszczalne, bez pulsowania.
- Jeśli zapis się udał, a odświeżenie listy nie, pokaż „Rabat zapisany. Nie udało się odświeżyć listy” i akcję ponowienia odczytu. Nie wysyłaj ponownie utworzenia rabatu.
- Przy błędzie serwera zachowaj wpisane dane. Przy niepewnym wyniku żądania nie powtarzaj zapisu automatycznie; zastosuj istniejącą idempotencję lub najpierw uzgodnij wynik z listą danych. Nie zgłaszaj sukcesu po samym kliknięciu.
- Uprawnienia, salon i autoryzacja pochodzą z obecnej aplikacji. Redesign nie może ujawnić rabatów innego salonu ani umożliwić dodawania bez uprawnień.

## 7. Stany listy

| Stan | Prezentacja |
|---|---|
| Ładowanie | Dyskretny skeleton w obrębie prawej karty, tekst „Wczytywanie rabatów…” dla technologii asystujących; licznik nie udaje zera |
| Brak rabatów | „Nie ma jeszcze aktywnych rabatów” oraz „Dodaj pierwszy rabat w formularzu.”; licznik 0 po udanym odczycie |
| Jedna pozycja | Jak na makiecie, bez pustych slotów i zbędnej tabeli |
| Wiele pozycji | Kolejne równe wiersze, normalny scroll strony; zachowaj istniejącą paginację, jeśli jest |
| Długa nazwa | Zawijanie, nie nakłada się na kwotę; na małym ekranie wartość może przejść pod nazwę |
| Błąd odczytu | „Nie udało się wczytać rabatów” oraz „Spróbuj ponownie”; nie pokazuj fałszywego pustego stanu |
| Nieznany historyczny typ | Nie oznaczaj go automatycznie jako procentowy; bezpieczna etykieta i raport techniczny, bez zmiany rekordu |

Nie dodawaj wyszukiwarki, filtrowania, metryk użycia, automatycznych promocji, terminów ważności ani przypisywania rabatu klientkom w ramach tej zmiany. Są to osobne funkcjonalności.

## 8. Parametry wizualne

| Element | Parametry CSS / zalecenie |
|---|---|
| Font | Obecny font UI Estelio; fallback system-ui, sans-serif |
| Tło treści | #FAF8F5 |
| Karty | #FFFFFF, border 1px #E7E1DE, radius 18px, cień 0 4px 18px rgba(45,30,35,.04) |
| Padding kart | 24–28px desktop, 20px mały ekran, 16px przy 320px |
| Nagłówek strony | 28px / 36px, semibold, #242126 |
| Nagłówki kart | 20px / 28px, semibold |
| Etykiety | 14px / 20px, medium, #242126; bez uppercase |
| Opis / pomoc | 13px / 19px, #67616B; sprawdź kontrast na faktycznym tle |
| Pola | min-height 44px, tekst 16px, tło białe, border 1px #D9D4D8, radius 10px |
| Pole z jednostką | Stały sufiks po prawej, odpowiedni padding tekstu; jednostka również w nazwie dostępnej |
| Fokus | Outline 2px #842D49, odstęp 2px; nie usuwaj fokusu klawiatury |
| Segmenty | 44px minimum, tło #F7F5F6; wybrany #F8EDF1 z bordowym tekstem i oznaczeniem checked |
| Podgląd | Tło #F7F6F5, radius 12px, padding 16px; bez cienia |
| Primary | #842D49, biały tekst 14–16px semibold, min-height 44px, radius 10px, padding poziomy 20px |
| Primary hover | #70243D, bez gradientu |
| Badge wartości | #F8EDF1, tekst #842D49, 20px / 26px semibold, radius 10px |
| Wiersz listy | Border 1px #E7E1DE, radius 12px, padding 16px, gap 12px |
| Ikony | Jeden obecny zestaw ikon liniowych; 18–20px; dekoracyjne aria-hidden |
| Przerwy między polami | 20–24px; etykieta–pole 8px; pole–opis 6px |

Obraz jest powiększoną makietą. Wymiary w tabeli są wiążące, nie odczytuj rozmiaru pola w pikselach PNG. Rysunek może mieć miękkie artefakty cienia; przy implementacji stosuj płaskie kolory powyżej.

## 9. Responsywność i obsługa klawiatury

- Szerokość progów odnosi się do dostępnego kontenera treści po odjęciu menu, nie do całego monitora.
- Od około 920px dostępnej szerokości: dwie kolumny. Poniżej: jedna kolumna, formularz nad listą. Wybierz container query, jeśli projekt je wspiera, albo istniejący mechanizm responsywności uwzględniający sidebar.
- Odstęp zewnętrzny na telefonie 16px, przy bardzo wąskim ekranie 12px. Przycisk zapisu na małym ekranie na pełną szerokość.
- Brak horyzontalnego scrolla przy 320px i zoomie 200%. Nazwy i opisy zawijają się. Badge nie wypycha karty poza kontener.
- Naturalna kolejność Tab: nazwa → typ → wartość → zapis; pomoc dostępna w kolejności wynikającej z nagłówka. Radio obsługiwane strzałkami. Nie zamieniaj formularza w klikalne divy.
- Podgląd nie jest ogłaszany przez live region przy każdym znaku. Komunikat wyniku zapisu ogłoś przez `role=status`, istotny błąd przez istniejący wzorzec alertu.
- Zachowaj semantyczne nagłówki h1/h2, label, fieldset/legend, listę rabatów oraz prawidłowe `type` przycisków.

## 10. Pomoc kontekstowa

Użyj wspólnego komponentu pomocy, jeśli został wdrożony. Nie buduj drugiego systemu tooltipów. Jeśli nie ma jeszcze nowego komponentu, zachowaj obecną działającą pomoc i przygotuj miejsce na jej podpięcie; redesign rabatów nie wymaga wdrożenia pomocy w całym Estelio.

Proponowana treść do sprawdzenia z kodem:

> **Przygotuj rabat do sprzedaży**  
> Nadaj rabatowi nazwę, wybierz procent lub kwotę i wpisz wartość. Po zapisaniu rabat będzie dostępny na liście przy sprzedaży. Samo dodanie rabatu nie zmienia wcześniejszych transakcji.

Ostatnie zdanie opublikuj dopiero po sprawdzeniu rzeczywistej logiki danych. Link prowadzi do zweryfikowanej instrukcji rabatów salonu, nie do voucherów ani kodów Stripe na zakup Estelio. Nie wymyślaj nieistniejącej kotwicy.

## 11. Plan pracy Claude Code

1. Odszukaj widok po obecnych tekstach „Kreator Rabatów” i „ZAPISZ NOWY RABAT”. Ustal moduł CSS, event handlery, istniejący select, pobieranie listy, kontrakt zapisu, walidacje, jednostkę waluty i kontrolę uprawnień.
2. Sporządź krótką mapę stary element → nowy element. Zachowaj stabilne identyfikatory i wywołania, jeśli są potrzebne innym fragmentom aplikacji. Zmiana nazwy widocznej nie oznacza zmiany enumów ani routingu.
3. Zmień układ i style tylko wewnątrz korzenia tego widoku, np. klasy `.estelio-discounts`. Nie używaj ogólnych nadpisań `button`, `input`, `h2`, `.card` wpływających na inne moduły.
4. Podepnij segmenty do obecnego typu i dodaj lokalny podgląd. Zachowaj zapis i źródło listy. Nie wykonuj migracji bazy dla redesignu.
5. Zaimplementuj stany pusty/ładowanie/błąd/zapis, używając istniejących helperów aplikacji. Nie zmieniaj kwot rabatów historycznych.
6. Sprawdź poniższe scenariusze w środowisku z danymi testowymi. Nie zakładaj przykładowych rabatów w salonie produkcyjnym.
7. Oddaj raport z listą zmienionych plików, różnicami względem makiety i wynikami prób. Przedstaw wygląd desktop/mobile oraz oba typy rabatu. Przygotowanie zmiany nie oznacza automatycznej publikacji na main/produkcji.

## 12. Kryteria odbioru

| Próba | Oczekiwany wynik |
|---|---|
| Desktop i jeden rabat | Dwie karty jak na makiecie, brak fioletu/zielonego kafla i pustych atrap rekordów |
| Procentowy i kwotowy | Właściwy typ przesyłany w starym kontrakcie, właściwy sufiks i podgląd |
| Pusty formularz / błędne liczby | Brak nieprawidłowego zapisu, błędy przy polach, dane zachowane |
| Granice i precyzja | Te same reguły co kontrakt backendu; bez nowej polityki rabatów |
| Prawidłowy zapis | Jeden rekord po potwierdzeniu, lista i licznik aktualne |
| Podwójne kliknięcie | Brak dwóch równoległych żądań z UI |
| Błąd lub niepewny wynik zapisu | Dane formularza pozostają, brak fałszywego sukcesu i automatycznego ponownego POST |
| Zapis udany / odczyt listy nieudany | Jasna informacja i ponowienie tylko odczytu |
| Brak rabatów / błąd pobrania | Dwa różne stany, brak mylącego zera podczas błędu |
| Długa nazwa / wiele rekordów | Układ zachowany, brak nachodzenia nazwy na wartość |
| 320px, 400px, tablet, zoom 200% | Jedna kolumna w wąskim kontenerze, bez poziomego przewijania |
| Klawiatura i fokus | Dostęp do wszystkich kontrolek, label/radio działają, widoczny fokus |
| Brak uprawnień / inne salony | Dotychczasowa izolacja i zasady dostępu zachowane |
| Powrót do innych modułów | Brak zmian wyglądu menu, innych formularzy i przycisków |
| Sprzedaż z rabatem | Dotychczasowe zasady stosowania rabatu działają bez zmiany wyniku |

Nie twórz rozbudowanej nowej baterii testów samego CSS. Wykorzystaj istniejące testy zachowania i skup nowe próby na mapowaniu typu, zapisie, walidacji oraz responsywności. Wynik „nie wykonano” raportuj jawnie.
