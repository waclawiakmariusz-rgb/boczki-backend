# Estelio — Kreator Produktu / Kosmetyku

**Redesign „lekki nowy” • 24.10.2026 • instrukcja wykonawcza dla Claude Code.**

## 1. Cel i granice zadania

Przeprojektuj istniejący ekran Administracja → Kosmetyki oraz jego formularz edycji zgodnie z dwiema makietami. Zachowaj dotychczasowe dane, reguły walidacji, zakres salonu, uprawnienia, powiązania i operacje zapisu.

Nowy tytuł w obszarze treści: **Produkty i kosmetyki**. Na źródłowej liście są również suplementy oraz szczotka do ciała, dlatego nie zawężamy funkcji do samych preparatów kosmetycznych. Nazwy w menu i adres widoku pozostają dotychczasowe.

To jest **katalog nazw i cen dostępnych w rejestracji sprzedaży**. Nie jest to formularz przyjęcia towaru ani ustawiania stanu magazynowego. Nie dodawaj pól ilości, minimum, kategorii magazynowej, partii, dat ważności, marży, VAT, zdjęcia produktu czy dostawy. Nie łącz tego redesignu z wcześniejszą paczką magazynową.

Nie zmieniaj sidebaru, logo, innych ekranów, rozliczeń, raportów ani działania terminarza. Jeżeli istnieją zależności katalogu od magazynu, zachowaj je; nie dodawaj nowych synchronizacji i nie usuwaj dotychczasowych jako „porządkowania”.

Paczka nie jest poleceniem wdrożenia na main/produkcję. Nie wprowadzaj migracji bazy z powodu zmiany prezentacji.

## 2. Źródła i ustalenia

Oceniono cztery zrzuty użytkownika:

| Zrzut | Widoczne elementy |
|---|---|
| image(20261024-060244).png | Nagłówek, opis, wyszukiwarka, Firma, Model (nazwa), Cena sprzedaży (PLN), Dodaj do bazy, lista z edycją i usuwaniem |
| image(20261024-060301).png | Otwarta lista firm oraz opcja „Nowa…”; obok jest także akcja „Dodaj nową” |
| image(20261024-060313).png | Długa lista produktów z firmami, nazwami i cenami; brak wyraźnego wyrównania cen |
| image(20261024-060341).png | Modal edycji: tekstowe pola Firma, Model, Cena sprzedaży; Anuluj i Zapisz zmiany |

Przewodnik managera z 08.06.2026 opisuje sprzedaż produktów, powiązania z magazynem i rozróżnienie kosmetyków/suplementów. Nie dowodzi obecnego kontraktu tego kreatora; aktualny kod ma pierwszeństwo w ustalaniu faktycznego działania.

Nie analizowano repozytorium ani rzeczywistego API. Niepotwierdzone są: format ID, zapis firmy jako osobnego obiektu lub nazwy, moment dodawania firmy, dopuszczalność zera, limity ceny, polityka duplikatów, sposób usuwania i wpływ edycji na powiązane moduły. Nie zastępuj tych niewiadomych regułami demo.

## 3. Mapa przed zmianą kodu

Znajdź stary komponent po „Kreator Produktu”, „Istniejące produkty”, „Dodaj do bazy” lub aktualnej pozycji menu. Opisz w raporcie rzeczywiste pliki:

1. Widok, jego CSS, ładowanie produktów i firm, zapis, edycja, usuwanie.
2. Pola API, identyfikacja rekordu, salonu i sesji, role uprawniające do operacji.
3. Semantyka firmy: rekord słownikowy z ID czy nazwa tekstowa; co robi „Nowa…” i „Dodaj nową”; czy działają tak samo.
4. Czy edycja pola Firma dotyczy jednego produktu, czy osobnego wspólnego rekordu firmy. Nie wykonuj masowej zmiany nazw przy edycji pojedynczego produktu.
5. Semantyka ceny: przechowywana jednostka, precyzja, limity, zero, separator. Na zrzucie jest **Cena sprzedaży (PLN)**, nie „cena brutto”. Nie dopisuj netto/brutto bez potwierdzenia w kodzie.
6. Unikalność: ta sama nazwa u różnych firm, warianty, duplikaty pary firma+nazwa, wielkość liter i polskie znaki.
7. Zależności od sprzedaży i magazynu, sposób zachowania historycznych pozycji, reagowanie na produkt już użyty.
8. Czy usuwanie jest twarde, archiwalne lub blokowane przez powiązania; nie zmieniaj mechanizmu w tym zadaniu.
9. Wielkość katalogu i sposób ładowania: pełny zbiór, paginacja, lazy loading. Wyszukiwarka i licznik muszą obejmować rzeczywisty zakres danych.

Nie zgaduj endpointów ani nazw tabel. Wykonaj rutynowe rozpoznanie samodzielnie, a nierozstrzygnięte kwestie biznesowe wyodrębnij w raporcie.

## 4. Co zmienia się w interfejsie

| Element obecny | Nowy projekt |
|---|---|
| Wyszukiwarka nad formularzem dodawania | Wyszukiwarka przy tytule katalogu; jasne, że filtruje listę |
| Trzy rozproszone pola i wielki przycisk na całą szerokość | Jedna zwarta sekcja z trzema polami i przyciskiem w stopce |
| Firma + „Nowa…” + drugi link dodawania | Jeden czytelny punkt „+ Dodaj firmę” i stan wpisywania nazwy |
| „Model (nazwa)” | „Nazwa produktu”; zachowana mapowana nazwa pola backendu |
| Lista jako długie luźne wiersze | Kolumny Firma / Produkt / Cena sprzedaży / Działania |
| Ceny zaraz za nazwami | Własna kolumna, wyrównanie do prawej, dwie cyfry groszy w demo |
| Sam ołówek i czerwony × | Przyciski „Edytuj” i „Usuń”, nazwane także dla czytnika ekranu |
| Mały modal z drobnymi polami | Czytelny dialog 500px, pola48px, właściwy fokus i stan zmian |

Zachowane trzy pola biznesowe: firma, nazwa/model, cena sprzedaży. Nowy układ nie zmienia typu produktu, jego klasyfikacji ani relacji z magazynem.

## 5. Widok główny

### Nagłówek

Tekst kontekstu „Administracja / Kosmetyki”, H1 „Produkty i kosmetyki”, opis „Nazwy i ceny produktów dostępnych w rejestracji sprzedaży.”, istniejąca pomoc „?” po prawej. Okruszki nie muszą być linkami; nie twórz fikcyjnego adresu Administracja.

### Dodaj produkt

Karta z H2 „Dodaj produkt”. Desktop: Firma około34%, Nazwa produktu42%, Cena24%. Konkretna proporcja w CSS: 1.2fr / 1.5fr / .85fr, odstęp20px. Wartości pozostają puste przed pierwszym dodaniem. Cena ma placeholder „0,00”, nie automatycznie zapisaną wartość0.

Firma: natywny select albo istniejący dostępny komponent wyboru. Lista ze wszystkich faktycznie dozwolonych firm salonu. Nie wymieniaj katalogu na stałe marki z makiety. Nazwy oryginalne zachowane.

Pod wyborem jeden przycisk tekstowy „+ Dodaj firmę”. Nie pozostawiaj równocześnie drugiej opcji „Nowa…”, jeśli robi dokładnie to samo. Jeżeli stary kod rozróżnia te akcje biznesowo, najpierw to opisz i zachowaj obie funkcje z jednoznacznymi nazwami.

Nazwa produktu: zwykły input; przykładowy tekst nie jest wpisywany do prawdziwej konfiguracji.

Cena sprzedaży: input z miejscem na „zł”, obsługa przecinka według kontraktu. Nie zmieniaj ceny przy każdym znaku, nie przesuwaj kursora agresywnym formatowaniem. Błąd zrozumiały przy polu. Puste pole, NaN i błędna odpowiedź nie stają się ceną0.

Stopka: „Produkt pojawi się w katalogu po zapisaniu.” i „Dodaj produkt”. Brak emoji i uppercase. Na mobile przycisk pełnej szerokości.

### Dodaj firmę — stan formularza

Po kliknięciu „+ Dodaj firmę” obszar Firmy zastąp inputem „Nazwa nowej firmy”, wskazówką „Firma dla dodawanego produktu.” i akcją „Wróć do listy firm”. Pozostałe pola nie znikają ani nie resetują się. Powrót przywraca poprzednio wybraną firmę.

Demo trzyma nową nazwę lokalnie do zapisu produktu. **Nie jest to ustalenie sposobu zapisu Estelio.** Jeśli obecnie firma jest osobno zapisywana od razu, zachowaj ten proces i jego potwierdzenie/błędy, ale w spójnym komponencie wizualnym. Nie udawaj sukcesu dodania firmy przed potwierdzeniem API. Nie wprowadzaj osobnego trwałego słownika, jeśli aktualny system wylicza firmy z produktów.

W razie duplikatu nazwy firmy postępuj według istniejących reguł. Nie scalaj firm tylko na podstawie podobieństwa tekstu.

## 6. Dodawanie — zachowanie

1. Najpierw odczyt danych i uprawnień. Błąd odczytu blokuje zapis, zamiast pokazać pusty katalog jako fakt.
2. Wymagane pola i ograniczenia walidacji pochodzą z aktualnego systemu. Demo wymaga wszystkich trzech pól, dopuszcza zero i maksymalnie dwa miejsca po przecinku — to nie definicja zasad produkcji.
3. Błędy pokazuj przy polach, aria-invalid/aria-describedby; fokus na pierwsze niepoprawne pole.
4. Zapis blokuje ponowne kliknięcia i edycję wysyłanych danych, przycisk „Dodawanie…”.
5. Sukces dopiero po potwierdzeniu serwera. Aktualizuj katalog i licznik.
6. Propozycja UX w demo: po sukcesie zachowaj firmę, wyczyść nazwę i cenę, fokus na nazwę. Ułatwia dodawanie kolejnych produktów tej samej firmy. To czysty formularz, więc samo zachowanie firmy nie uruchamia ostrzeżenia o zmianach.
7. Nie czyść wyszukiwania ani strony listy. Jeżeli nowa pozycja nie jest widoczna przez filtr/stronę, komunikat potwierdza dodanie i zachowanie widoku.
8. Błąd zachowuje wszystkie wartości. Timeout to niepewny wynik; nie wysyłaj automatycznie drugi raz. Ustal rzeczywisty stan przed kolejną próbą.

## 7. Katalog, wyszukiwanie, paginacja

H2 „Katalog produktów”, licznik oraz wyszukiwarka „Szukaj firmy lub produktu…”. Bez dodatkowych statystyk wartości magazynu. Dane w makiecie to przykład, a nie pełen katalog użytkownika.

Tabela desktop: kolumny Firma, Produkt, Cena sprzedaży, Działania. Ceny mają cyfry tabelaryczne i są wyrównane do prawej. Stosuj formatowanie Estelio; nie obcinaj precyzji danych bez potwierdzenia ich kontraktu.

Wyszukiwanie tylko po firmie i nazwie. Demo ignoruje wielkość liter oraz polskie znaki; wszystkie wpisane słowa muszą wystąpić w połączonym tekście. Nie zmienia rekordów, nie filtruje formularza Firmy, nie wysyła mutacji.

W makiecie/demo jest13 pozycji i po6 na stronie, aby dało się porównać stany. Nie jest to limit liczby produktów. Po wyszukiwaniu wracaj na pierwszą stronę; po usunięciu ostatniego rekordu na stronie przejdź na ostatnią istniejącą stronę. Pokaż rzeczywisty zakres np. „1–6 z13 produktów” oraz „1/3”. Kontrolki poprzednia/następna prawidłowo nieaktywne na krańcach.

Jeśli istniejący system ma wspólne rozmiary stron, można zachować jego domyślny rozmiar zamiast6; opisz różnicę w odbiorze. Nie dodawaj dużego zapytania „pobierz wszystko”, jeśli backend już stronicuje. Dla stronicowania serwerowego wyszukiwarka i licznik również muszą działać serwerowo; nie pokazuj lokalnych6 rekordów jako całej bazy.

Na mobile tabela przechodzi w czytelne karty/wiersze: firma mniejszym tekstem, nazwa, cena z etykietą, dwa pełne przyciski. Zachowaj semantykę i dostępność. Brak poziomego przewijania wymagającego odkrywania akcji poza ekranem.

## 8. Edycja produktu

Dialog otwierany przez „Edytuj” konkretnego rekordu. Tytuł „Edytuj produkt”, opis „Zaktualizuj dane wybranego produktu.”. Zachowujemy trzy pola, jak w starym modalu. W źródle Firma jest tekstowa; projekt pozostawia ją tekstową, bez zakładania nowego mechanizmu globalnego zarządzania markami.

- Formularz wypełniony danymi wybranego ID. Nie identyfikuj rekordu samą nazwą.
- Przycisk „Zapisz zmiany” nieaktywny przy braku zmian; równoważny zapis260/260,00 nie jest zmianą w demo.
- Cena formatowana do wejścia, ale bez zaokrąglania finansowego na własną rękę.
- Edycja działa na kopii danych; lista nie zmienia się podczas wpisywania.
- Zapis w toku blokuje drugi zapis i przypadkowe zamknięcie; sukces aktualizuje rekord z odpowiedzi serwera, zamyka modal i zachowuje filtr oraz stronę.
- Jeżeli zmieniona nazwa/marka przestaje pasować do filtra, zniknięcie z listy jest oczekiwane. Komunikat sukcesu przypomina, że filtr nadal działa.
- Błąd pozostawia modal i draft. Serwerowe błędy pól mapuj na odpowiednie inputy.
- Anuluj/X/ESC bez zmian zamykają. Przy zmianach pokaż wewnętrzne potwierdzenie „Masz niezapisane zmiany” z „Wróć do edycji” / „Odrzuć zmiany”. Nie otwieraj kolejnego modala nad modalem.
- Przy niepewnym zapisie nie obiecuj, że zmiany nie zostały zapisane. Wymagaj sprawdzenia katalogu; zamknięcie z porzuceniem draftu jest świadomą akcją.
- Konflikt wersji nie nadpisuje cudzego rekordu. Użyj istniejącego mechanizmu aplikacji.

Zmiana Firmy w jednym produkcie nie może przypadkowo zostać poleceniem zbiorczej zmiany nazwy firmy we wszystkich produktach. Jeśli aktualny kontrakt ma inny zakres, ujawnij to i zachowaj go, nie zgaduj.

Nie wolno dodawać przeliczania historycznych sprzedaży ani korekt stanów magazynowych jako efektu redesignu. Zachowaj faktyczne powiązania i istniejące ścieżki aktualizacji. Nie umieszczaj w UI obietnicy „nie zmienia historii”, dopóki nie jest potwierdzona.

## 9. Usuwanie

Przycisk „Usuń” otwiera dialog z tytułem „Usunąć produkt?”, opisem „Sprawdź wybraną pozycję przed potwierdzeniem.” oraz firmą, nazwą i aktualną ceną. Domyślny fokus na „Zostaw produkt”. Drugi przycisk „Usuń produkt”. X/ESC działają jak anulowanie przed wysłaniem żądania.

Usuwanie wyłącznie po właściwym identyfikatorze i w salonie użytkownika. Wiersz znika dopiero po potwierdzeniu. Nie oferuj fikcyjnego cofania ani kasowania powiązanych transakcji. Jeśli backend blokuje produkt użyty w sprzedaży/magazynie, pokaż jego bezpieczny komunikat i zachowaj pozycję. Nie obchodź ograniczenia dodatkową kaskadą ani automatyczną archiwizacją.

Przy niepewnym wyniku „Zostaw produkt” zmienia się na „Zamknij”: nie można obiecywać, że produkt został zachowany. Po zamknięciu wczytaj aktualny katalog przed kolejną mutacją. Po sukcesie fokus wraca do listy; po anulowaniu do pierwotnego przycisku.

## 10. Stany obowiązkowe

| Stan | Oczekiwany widok |
|---|---|
| Pobieranie | Wczytywanie katalogu, brak aktywnych mutacji |
| Błąd odczytu | Błąd i Wczytaj ponownie, bez pozornej pustej bazy |
| Pusty katalog | Katalog jest jeszcze pusty + wskazanie formularza |
| Brak wyników | Nie znaleziono produktów + Wyczyść wyszukiwanie |
| Tylko odczyt | Lista i wyszukiwanie dostępne, mutacje niedostępne |
| Brak praw do jednej operacji | Ukryj/wyłącz tę akcję zgodnie z polityką aplikacji; backend także egzekwuje uprawnienia |
| Nieznana/brakująca firma | Nie wybieraj automatycznie pierwszej firmy; zachowaj kontekst i pokaż problem |
| Nazwy historyczne/duplikaty | Bez cichego scalania, przemianowania lub usuwania |
| Produkt już usunięty w innym oknie | Odświeżenie listy; nie usuwa innego rekordu |
| Konflikt/timeout | Draft zachowany, bez automatycznej powtórki i fałszywego sukcesu |
| Odebrana rola/wygaśnięta sesja | Dotychczasowa ścieżka Estelio, bez obejścia uprawnień |

## 11. Specyfikacja wizualna

| Element | Wartość |
|---|---|
| Kontener | max1120px w treści istniejącej strony |
| Tło | #FAF8F5 |
| Karta | #FFF, border1px #E7E1DE, radius18px, delikatny cień |
| Tekst | #242126; opisy #67616B |
| Akcent | #842D49; hover #70243D |
| Jasny akcent | #F8EDF1 |
| Typografia | Obecny font sans-serif Estelio, fallback system-ui |
| H1 / H2 | 30/38px oraz21/29px, weight650 |
| Pole | 48px wysokości,16px tekstu, radius10px |
| Label | 14px, weight550, bez uppercase |
| Odstępy | padding26px, mobile20px, gap20px |
| Akcje | min44px, radius10px, tekst14px |
| Tabela | 14px, nazwa weight500, cena cyfry tabelaryczne, separatory1px |
| Dialog edycji | szerokość500px, max viewport−32px, padding26px |
| Dialog usunięcia | szerokość430px |
| Fokus | outline2px #842D49, offset3px |

Wymiary to CSS px. Nie kopiuj rozmiarów z powiększonego PNG. Grafika jest odniesieniem kompozycji; CSS określa wykonanie. Bez gradientów, emoji, domyślnego czerwonego obramowania prawidłowego pola Firma i automatycznego zielonego koloru wszystkich cen.

Każdy styl ogranicz do `.estelio-cosmetics`. Nie nadpisuj globalnych h1/input/select/button/table, layoutu body ani wspólnych klas. `index.html` ma osobną ramkę demonstracyjną body/main — nie kopiować jej do Estelio.

## 12. Responsywność i dostępność

- Do820px dostępnej treści: formularz dwukolumnowy, cena niżej.
- Do640px: pola w jednej kolumnie, akcja szeroka, lista jako karty z widoczną ceną i działaniami.
- Dialog ma maksymalną wysokość viewportu i własne przewijanie, tak aby przy800×550 i klawiaturze ekranowej dało się dojść do zapisu.
- Sprawdź320,400,800×550,desktop,zoom200%; uwzględnij szerokość rzeczywistego sidebaru.
- Wszystkie pola mają label i błędy połączone przez aria-describedby. Cena ma zrozumiałą walutę w kontekście; rozważ dopisanie „w złotych” w nazwie dostępnej, jeśli systemowy komponent tego wymaga.
- Natywny select zapewnia obsługę klawiatury. Jeśli zastąpisz go wspólną wyszukiwarką Estelio, zachowaj wybór tylko istniejącej firmy oraz osobną jawną ścieżkę dodania.
- Natywny dialog/istniejący dostępny komponent: fokus wewnątrz, tło nieaktywne, powrót fokusu po zamknięciu.
- Gdy pod wpływem zapisu/filtra znika przycisk źródłowy, fokus do nagłówka katalogu.
- Dane użytkownika przez textContent/binding tekstowy. Nazwa firmy lub produktu nie może wykonać HTML/JS.
- Pomoc bez wysyłania formularza, ESC zamyka, link do pełnej instrukcji tylko do zweryfikowanego rozdziału. Nie wymyślaj kotwic.

## 13. Podłączenie kodu

Przeczytaj `INTEGRACJA_KODU.md`. `index.html` jest demonstracją, fragment służy osadzeniu. `model.js` i kontroler można przenieść do aktualnego frameworka zamiast montować drugi system obsługi DOM.

Nie wdrażaj `demo-adapter.js` / `demo.js`. Nie przenoś danych przykładowych ani domyślnej ceny. Rzeczywisty adapter podłącza aktualny odczyt, walidację, create/update/delete i autoryzację. Idempotencja i wersje obecne w demo nie są dowodem, że istnieją już w Estelio.

Nie wymieniaj backendu, aby dopasować go do DTO wzorca. Mapuj DTO do istniejącego kontraktu i zachowaj wszystkie istotne metadane rekordu. Ewentualne brakujące zabezpieczenia raportuj osobno.

## 14. Kolejność wdrożenia

1. Inwentaryzacja z sekcji3, mapa starych trzech pól i operacji.
2. Osadzenie nowych sekcji i scoped CSS w obecnym widoku.
3. Podłączenie realnej listy firm, właściwej ścieżki nowej firmy i katalogu.
4. Podłączenie dodawania, edycji, usuwania bez zmiany skutków biznesowych.
5. Stany błędów, uprawnienia, wyszukiwanie i paginacja całego rzeczywistego zbioru.
6. Testy poniżej na izolowanym środowisku; porównanie desktop/mobile i dialogów z makietami.
7. Raport z wynikami i odstępstwami, diff do przeglądu. Main/produkcja według osobnego polecenia i zasad repozytorium.

## 15. Kryteria odbioru

| ID | Próba | Oczekiwany efekt |
|---|---|---|
| K01 | Odczyt | Pełny właściwy katalog salonu, bez utraty suplementów i akcesoriów |
| K02 | Istniejąca firma + nowy produkt | Jeden rekord, poprawna cena w rejestracji sprzedaży |
| K03 | Nowa firma | Zachowany rzeczywisty moment zapisu i sposób powiązania |
| K04 | Powrót z nowej firmy | Nazwa/cena produktu zachowane, bez przypadkowego tworzenia firmy |
| K05 | Cena przecinek/kropka/grosze/zero/granice | Zgodność z aktualnym parserem i backendem, bez cichego0 |
| K06 | Walidacja i dwuklik | Błędy przy polach; brak podwójnego zapisu |
| K07 | Edycja jednego ID | Zmienia właściwy produkt, nie inny o tej samej nazwie |
| K08 | Firma podczas edycji | Nie tworzy niezamierzonej globalnej zmiany marki |
| K09 | Anuluj/X/ESC z draftem | Można wrócić do edycji lub świadomie odrzucić |
| K10 | Usunięcie/anulowanie/powiązania | Właściwy rekord, respektowanie ograniczeń, brak kaskad dodanych przez redesign |
| K11 | Błąd/timeout/konflikt | Brak fałszywego sukcesu, brak automatycznego ponowienia |
| K12 | Filtr firmy/nazwy, polskie znaki | Właściwe wyniki i licznik całego zakresu |
| K13 | Paginacja i ostatni rekord strony | Poprawne zakresy i przejście na istniejącą stronę |
| K14 | Zmieniona nazwa wypada z filtra | Komunikat sukcesu, filtr zachowany |
| K15 | Role, wygaśnięcie sesji, inne salony | Backend i UI kontrolują dostęp |
| K16 | Długie nazwy / HTML w nazwie | Zawijanie, brak wykonania kodu |
| K17 | Mobile/200%/klawiatura/dialog | Wszystkie akcje dostępne, bez obcięcia zapisu |
| K18 | Sprzedaż i historia | Brak nowego przeliczania historii i zmian powiązań; aktualna polityka cen zachowana |
| K19 | Magazyn i pozostałe moduły | Brak niezamierzonych zmian stanu, klasyfikacji i wyglądu |
| K20 | SPA / opuszczenie widoku | Ostrzeżenie o draftach, demontaż listenerów, brak podwójnych handlerów |

Nie oznaczaj niewykonanych prób jako PASS. Screenshoty odbiorowe na danych testowych.

## 16. Co oddać

Lista zmienionych plików, mapa rzeczywistych kontraktów, weryfikacja ceny i nowej firmy, lista powiązań produktu, wyniki testów K01–K20, screenshot głównego widoku i dialogów desktop/mobile, odstępstwa od makiet. Proponowane zmiany biznesowe wyłącz z redesignu i opisz oddzielnie.

**Stan dostarczonej paczki:** działający lokalny wzorzec z zapisem w pamięci. 48/48 testów modelu/adaptera demonstracyjnego PASS. Brak odbioru w przeglądarce i integracji z backendem; PNG to makiety z silnika graficznego, a nie screenshoty HTML. Zgodność wizualna1:1 pozostaje do sprawdzenia po uruchomieniu.
