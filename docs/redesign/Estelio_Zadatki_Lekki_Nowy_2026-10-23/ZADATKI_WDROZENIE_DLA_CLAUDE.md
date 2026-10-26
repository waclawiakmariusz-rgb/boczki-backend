# Estelio — Ustawienia zadatków, redesign „lekki nowy”

Data: 23.10.2026. Instrukcja wykonawcza dla Claude Code.

## 1. Zadanie i zakres

Przeprojektuj warstwę prezentacji istniejącego widoku **Ustawienia zadatków** zgodnie z makietą `makiety/01-ustawienia-zadatkow.png`. Zachowaj wszystkie obecne tryby, pola zależne od trybu, reguły obliczeń, walutę, zapis, uprawnienia i zakres obowiązywania ustawień. Dodaj lokalny podgląd wyniku na kwocie przykładowej opisany poniżej.

Zakres obejmuje tylko zawartość tego widoku: nagłówek, formularz, prezentację informacji i podgląd. Nie przebudowuj menu, logo, globalnych elementów Estelio, multisprzedaży, portfela, rejestru zadatków ani terminarza. Nie dodawaj migracji danych dla zmiany wyglądu.

Ta paczka zawiera makietę, specyfikację oraz działający lokalnie podgląd HTML/CSS/JS. Kod UI jest punktem wyjścia do integracji; demo-model.js i demo.js nie są kodem produkcyjnej logiki finansowej. Nie analizowano aktualnego repozytorium. Claude musi odnaleźć rzeczywiste komponenty i kontrakty. Nie zgaduj nazw endpointów, tabel ani wartości enum. Dane w grafice są przykładowe i nie stanowią polecenia zmiany ustawień żadnego salonu.

## 2. Fakty ze zrzutu i niewiadome

Na zrzucie wejściowym widoczne są:

| Element | Widoczna wartość / treść |
|---|---|
| Tytuł | Ustawienia zadatków |
| Opis | Konfiguracja domyślnego wyliczenia zadatku przy multisprzedaży; wartość edytowalna podczas sprzedaży, propozycja systemu |
| Tryb | Procent (X% kwoty zabiegu) |
| Pole dla tego trybu | Procent kwoty zabiegu: 50 |
| Zaokrąglenie | Bez zaokrąglenia (np. 97,50 zł) |
| Akcja | ZAPISZ USTAWIENIA |
| Pomoc | Osobny przycisk „?” nad opisem |

Na drugim zrzucie lista zaokrągleń jest otwarta: „Bez zaokrąglenia (np. 97,50 zł)”, „Do 5 zł (np. 95 lub 100 zł)”, „Do 10 zł (np. 100 zł)”. Lista trybów pozostaje zamknięta. Nie wiadomo, jakie inne tryby istnieją ani jak dokładnie rozstrzygane są kierunek i granice zaokrąglania. Nie wiadomo też, czy 50% jest ustawieniem zapisanym, czy edytowanym, oraz jak system zaokrągla wartości ułamkowe poniżej grosza. Nie wyciągaj tych wniosków ze zrzutu.

W dostarczonych przewodnikach z 08.06.2026 nie znaleziono po frazach dotyczących tego formularza szczegółowego opisu jego trybów i zaokrąglania. Aktualny kod i jego testy są konieczne do weryfikacji. To zadanie nie jest zmianą prawnego znaczenia zadatku, polityki zwrotów ani obowiązku pobierania wpłaty.

## 3. Co zmienia się wizualnie

| Stan obecny | Projekt |
|---|---|
| Różowy tytuł, emoji, długa kolorowa linia | Ciemny czytelny tytuł, krótki opis, brak ozdobnej linii |
| Formularz skupiony z lewej, dużo niewykorzystanej przestrzeni | Ustawienia po lewej, przykład wyniku po prawej |
| Żółty blok dla zwykłego pola procentowego | Neutralne pole z widoczną jednostką %, bez wyglądu ostrzeżenia |
| Małe etykiety uppercase | Etykiety zdaniowe, większy kontrast |
| Zielony przycisk z emoji | Bordowy „Zapisz ustawienia”, jeden główny akcent |
| Pomoc oderwana od nagłówka | Istniejący przycisk „?” w prawym górnym rogu nagłówka treści |
| Opis reguły bez przykładu | Krótka informacja i podgląd konkretnej kwoty |

## 4. Układ

### Nagłówek

- Kontekst „Administracja / Zadatki”, jeśli pasuje do istniejącego wzorca okruszków. Nie twórz fikcyjnego linku do strony Administracja.
- H1: „Ustawienia zadatków”.
- Opis: „Ustal, jak Estelio podpowiada kwotę zadatku przy multisprzedaży.”
- Pomoc „?” po prawej, jeden punkt dostępu, z zachowaniem dotychczasowego działania albo podłączeniem wspólnego komponentu pomocy.

### Kontener roboczy

Maksymalna szerokość 1120 px, szerokość płynna w obszarze treści za menu. Padding zewnętrzny 32 px. Odstęp od nagłówka 28 px. Dwie kolumny około 57% / 43%, przerwa 24 px, wyrównanie do góry. Wysokość kart wynika z treści, bez sztucznego wypełniania pustych miejsc.

Grafika nie zawiera menu i przeglądarki celowo. Nie dodawaj jej jako jednego obrazu do aplikacji. Podpis „Projekt widoku • dane przykładowe” nie jest częścią UI.

### Lewa karta: Sposób wyliczania

1. H2 „Sposób wyliczania”.
2. Opis „Wybierz regułę podpowiedzi dla salonu.”
3. „Tryb wyliczania”: istniejący select ze wszystkimi aktualnymi opcjami. Etykietę widocznego trybu można skrócić do „Procent kwoty zabiegu”, nie zmieniając wartości wysyłanej do API.
4. Obszar parametrów zależnych od wybranego trybu. Na makiecie: „Wysokość zadatku”, input 50 z sufiksem % i podpowiedź „Zadatek wyniesie 50% kwoty zabiegu.”
5. „Zaokrąglenie kwoty”: trzy kafle radio z etykietami „Bez zaokrąglenia”, „Do 5 zł”, „Do 10 zł”. Zachowaj faktyczne wartości enum z istniejącego selecta. Kafle mają semantykę jednego wyboru, a nie przełączników. Jeżeli kod ujawni dodatkowe warianty, zachowaj je i udokumentuj dopasowanie układu.
6. Krótka informacja na jasnoróżowym tle: „To podpowiedź systemu. Kwotę zadatku możesz zmienić podczas sprzedaży.”
7. Separator i przycisk „Zapisz ustawienia”, wyrównany do prawej.

Tekst pomocniczy dla procentu musi odpowiadać aktualnej wartości. Po zmianie z 50 na 30 pokaż np. „Zadatek wyniesie 30% kwoty zabiegu”, a nie nieaktualne objaśnienie o połowie. Nie pokazuj objaśnienia liczbowego przy błędnym lub pustym polu.

Tekst „Kwota pozostaje z dokładnością do groszy” z makiety jest propozycją copy dla trybu bez dodatkowego zaokrąglenia. Potwierdź go z istniejącą logiką precyzji. Jeśli nie opisuje jej dokładnie, zastąp go poprawnym krótkim wyjaśnieniem. Nie zmieniaj obliczeń, aby dopasować je do tekstu na makiecie.

Nie dodawaj przycisku „Anuluj” ani „Przywróć domyślne”, jeśli nie istnieją. Samo wejście na stronę nie zapisuje konfiguracji.

### Prawa karta: Sprawdź na przykładzie

1. H2 „Sprawdź na przykładzie”.
2. Opis „Podgląd dla wartości z formularza.”
3. Pole „Przykładowa kwota zabiegu”, startowo 195,00 zł dla salonu PLN.
4. Opis „Ta kwota służy tylko do podglądu.”
5. Zwięzłe podsumowanie aktywnej reguły, np. „Procent zadatku — 50%” i „Zaokrąglenie — Brak”.
6. Separator, etykieta „Proponowany zadatek” i wyróżniona kwota 97,50 zł.
7. Krótkie objaśnienie, w przykładzie „195,00 zł × 50% = 97,50 zł”.
8. Informacja „Podgląd nie zapisuje ustawień ani płatności.”

To proponowane ulepszenie interfejsu, nie funkcja potwierdzona na starym zrzucie. Zwiększa zrozumiałość konfiguracji, nie zmienia znaczenia zadatku. Nie pokazuj przycisku wpłaty, salda portfela, danych klienta ani kwoty „pozostało do zapłaty”.

## 5. Podgląd musi zgadzać się z multisprzedażą

Najważniejsza reguła: **ta sama konfiguracja i te same dane wejściowe muszą dać ten sam wynik w podglądzie i rzeczywistym kalkulatorze multisprzedaży**. Nie pisz drugiego, niezależnego algorytmu z regułami odtworzonymi z napisów w select.

1. Odszukaj funkcję faktycznie wyliczającą sugerowany zadatek, kolejność operacji, precyzję, sposób zaokrąglania i zachowanie dla wszystkich trybów.
2. Ustal, co znaczy „kwota zabiegu”: cena przed/po rabacie, pozycja/cały koszyk, ilość, składniki kwalifikujące się do zadatku. Nie zakładaj, że obejmuje kosmetyki albo wszystkie pozycje.
3. Podgląd podstawowy przedstawia **jeden przykładowy zabieg w ilości 1**, z kwotą bazową określoną tak samo jak w rzeczywistym algorytmie. Nie sugeruje, że demonstruje wszystkie przypadki multisprzedaży.
4. Wykorzystaj istniejący czysty helper obliczeniowy. Jeżeli logika jest powiązana z DOM lub efektami ubocznymi, wydziel obliczenie bez zmiany jego zachowania, sprawdź zgodność i dopiero użyj go do podglądu. Nie uruchamiaj ścieżki zapisu sprzedaży dla uzyskania przykładu.
5. Jeśli aktualny algorytm jest wyłącznie po stronie serwera i brak bezpiecznego bezstanowego sposobu jego użycia, zgłoś zależność zamiast wprowadzać po cichu nowy API lub niezgodny kalkulator. Resztę redesignu można przygotować; podgląd nie może udawać gotowego.
6. Jeśli konkretny tryb potrzebuje innych wejść niż pojedyncza kwota, dopasuj przykład do jego kontraktu. Jeżeli nie da się go przedstawić w tym prostym przykładzie, pokaż wyjaśnienie ograniczenia zamiast fałszywej liczby. Nie usuwaj trybu z formularza.
7. Reguł zaokrąglania i ich kierunku nie wymyślaj. Nie zastępuj nieznanego wariantu przez „najbliższe 10 zł” ani `Math.round`.
8. Kwoty formatuj mechanizmem używanym w Estelio; zachowaj dokładność właściwą dla waluty. Nie dodawaj arytmetyki na liczbach zmiennoprzecinkowych, jeśli projekt korzysta z groszy lub biblioteki dziesiętnej.

Objaśnienie obliczenia przy włączonym zaokrągleniu musi pokazywać faktyczny wynik po tej operacji. Nie pozostawiaj równania procentowego z inną kwotą niż wynik końcowy. Dla innych trybów zmień etykietę podsumowania; nie pokazuj wszędzie „Procent zadatku”.

Przykładowa kwota jest stanem lokalnym komponentu, nie polem konfiguracji salonu. Nie wysyłaj jej w żądaniu zapisu. Zmiana tej kwoty nie ustawia formularza jako niezapisany i nie uruchamia ostrzeżenia o utracie ustawień. Nie zapisuj przykładu w bazie, portfelu ani historii klienta.

## 6. Tryby, pola i walidacja

Przed zmianą UI przygotuj mapę: obecna opcja → klucz w kontrakcie → parametry → walidacja → obliczenie → prezentacja. Zachowaj wszystkie istniejące opcje, także te niewidoczne na zamkniętym select ze zrzutu.

- Pole procentowe z makiety występuje tylko dla właściwego trybu. Inne parametry prezentuj tym samym stylem.
- Nieaktywnych parametrów nie wymagaj w UI, jeżeli nie wymaga ich kontrakt. Nie usuwaj ich z zapisu, jeśli są przechowywane do ponownego wyboru trybu.
- Zachowaj dotychczasowe zachowanie po przełączeniu trybu. Jeżeli potrzebna jest pamięć wartości między trybami, przechowuj lokalny draft według trybu, bez reinterpretacji procentu jako waluty.
- Zachowaj zakresy i precyzję z backendu. Z grafiki nie wynika, czy 0%, 100%, zadatek większy od kwoty lub ujemne wartości są dopuszczalne. Nie twórz nowych zasad w zadaniu wizualnym.
- Parser liczb musi respektować obecny kontrakt i polski sposób wpisywania. Nie dopuszczaj częściowej interpretacji `50abc` jako 50. Nie przestawiaj kursora przez formatowanie inputu po każdym znaku.
- Błędy przy polach, przez `aria-describedby` i `aria-invalid`; po błędnym zapisie fokus na pierwsze niepoprawne pole.
- Brak/poprawianie kwoty przykładu: wynik „—” i krótka wskazówka, bez NaN, Infinity lub fałszywego 0 zł.
- Błędne ustawienia: wynik przykładu „—”, ponieważ nie można go wiarygodnie policzyć.
- Błędna wyłącznie kwota przykładu nie blokuje zapisu poprawnej konfiguracji; jest poza formularzem zapisywanych ustawień i nie bierze udziału w jego natywnej walidacji.
- Nie pokazuj jako faktu ograniczeń, których nie potwierdzono w kodzie. Rozbieżności frontend/backend zapisz w raporcie, bez ukrytej zmiany polityki biznesowej.

## 7. Zapis i stany formularza

| Stan | Zachowanie |
|---|---|
| Pobieranie konfiguracji | Skeleton/„Wczytywanie ustawień…”, kontrolki nieaktywne; nie podstawiaj 50% jako rzeczywistego ustawienia |
| Odczyt zakończony | Pola z konfiguracji salonu; lokalny przykład przeliczony na tej podstawie |
| Brak zmian | Przycisk zapisu nieaktywny, krótka informacja „Brak niezapisanych zmian”; jeżeli istniejący komponent używa innej sprawdzonej konwencji, zachowaj ją spójnie |
| Zmiana ustawień | Dyskretne „Niezapisane zmiany” przy stopce; przykład liczy draft, nie starą konfigurację |
| Zmiana samego przykładu | Bez statusu niezapisanych ustawień i bez aktywowania przycisku zapisu |
| Zapis w toku | „Zapisywanie…”, blokada kolejnego wysłania i edycji wysyłanej konfiguracji |
| Sukces | „Ustawienia zapisane”, wartości pozostają widoczne, stan czysty; nie czyść formularza jak przy dodawaniu nowego rekordu |
| Błąd zapisu | Draft pozostaje, brak sukcesu, komunikat i możliwość kontrolowanego ponowienia |
| Niepewny wynik / zerwane połączenie | Nie powtarzaj automatycznie zapisu; ustal aktualną konfigurację przez istniejący mechanizm odczytu/wersji |
| Błąd pierwszego odczytu | „Nie udało się wczytać ustawień” i „Spróbuj ponownie”; nie pozwalaj nadpisać konfiguracji wartościami zastępczymi |
| Nieznana zapisana opcja | Nie zamieniaj jej po cichu na domyślną; pokaż stan wymagający wyjaśnienia i zablokuj przypadkowe nadpisanie |

Przy zapisie używaj dotychczasowej autoryzacji, identyfikacji salonu, walidacji i zabezpieczeń. Sukces sygnalizuj dopiero po potwierdzeniu serwera. Jeśli backend normalizuje wartości, wyświetl wynik zwrócony przez serwer i przelicz podgląd. W razie konfliktu wersji skorzystaj z istniejącego mechanizmu; nie wprowadzaj po cichu nowego modelu współbieżności.

Nie zmieniaj momentu zastosowania nowych ustawień w otwartej już multisprzedaży. Sprawdź i opisz istniejący mechanizm. Nie dopisuj komunikatu „Dotyczy tylko nowych sprzedaży”, dopóki kod tego nie potwierdzi. Redesign nie może sam przeliczać wcześniejszych wpłat ani zmieniać wartości w otwartych transakcjach.

## 8. Parametry wizualne

| Element | Specyfikacja |
|---|---|
| Font | Obecny sans-serif UI Estelio, fallback `system-ui, sans-serif` |
| Tło | #FAF8F5 |
| Karta | #FFFFFF, border 1px #E7E1DE, radius 18px, shadow 0 4px 18px rgba(45,30,35,.04) |
| Padding karty | 24–28px desktop, 20px mobile, 16px przy 320px |
| Tytuł strony | 28px/36px, semibold, #242126 |
| Tytuł sekcji | 20px/28px, semibold |
| Etykiety | 14px/20px, medium, #242126; bez uppercase |
| Opis / hint | 13px/19px, #67616B; sprawdź kontrast z tłem |
| Input i select | Min-height 44px, font 16px, białe tło, border #D9D4D8, radius 10px |
| Sufiks | % lub waluta zgodna z danymi; miejsce zarezerwowane paddingiem, jednostka także w nazwie dostępnej |
| Przerwy | Etykieta–pole 8px, pole–hint 6px, między grupami 20–24px |
| Wskazówka | #F8EDF1, radius 12px, padding 16px; ikona informacji, nie ostrzeżenia |
| Primary | #842D49, tekst biały semibold 14–16px, 44px min-height, radius 10px; hover #70243D |
| Fokus | Outline 2px #842D49, offset 2px |
| Wynik przykładu | 36px/44px, semibold, #842D49; na wąskim ekranie 30px/38px |
| Ikony | Obecny zestaw liniowy, 18–20px, dekoracyjne `aria-hidden` |
| Separator | 1px #E7E1DE |

Wymiary w tabeli są w pikselach CSS. Nie odczytuj rozmiarów z powiększonej grafiki. Brak gradientów, neonowych kolorów, emoji i żółtego tła zwykłych pól. Kolor czerwony/ostrzegawczy zarezerwuj dla rzeczywistych błędów i ostrzeżeń.

## 9. Mobile i dostępność

- Próg przejścia na jedną kolumnę: około 920px dostępnego obszaru treści, po odjęciu menu. Użyj istniejącego wzorca responsywności lub container queries.
- Na telefonie: nagłówek → ustawienia i zapis → podgląd przykładu. Nie ukrywaj podstawowych ustawień w akordeonie. Padding zewnętrzny 12–16px, zapis na pełną szerokość.
- Sprawdź 320px, 400px, 800×550 oraz zoom 200%. Brak poziomego przewijania, nazwy opcji i komunikaty nie wychodzą poza kontener. Długi wynik zawija się lub skaluje do ustalonego rozmiaru mobile, bez obcinania kwoty.
- Użyj prawdziwego formularza, label i natywnych selectów lub istniejącego dostępnego komponentu. Zachowaj semantykę wyboru i nawigację klawiaturą.
- Przykładowa kwota poza formularzem konfiguracji; Enter w przykładzie nie może uruchomić zapisu ustawień.
- Nie ogłaszaj wyniku czytnikowi ekranu przy każdym znaku. Jeśli stosujesz live region, użyj komunikatu polite po ustabilizowaniu poprawnego wejścia; błędy i rezultat zapisu przez istniejące wzorce alert/status.
- `?` to `type=button`; otwieranie pomocy nie wysyła formularza i nie zmienia dirty state. Zastosuj wspólny komponent pomocy, bez tworzenia konkurencyjnego mechanizmu.

## 10. Pomoc kontekstowa — proponowany tekst

> **Jak działa podpowiedź zadatku?**  
> Wybierz sposób wyliczania i zaokrąglenia proponowanej kwoty. Podgląd pokazuje przykład dla ustawień z formularza. Kliknij „Zapisz ustawienia”, aby zachować konfigurację. Kwotę zadatku można zmienić podczas sprzedaży.

Weryfikuj treść z faktycznym działaniem. Link kieruj do sprawdzonego rozdziału konfiguracji zadatków. Nie kieruj do ogólnego portfela, bonów, polityki anulacji ani ustawień terminarza tylko dlatego, że zawierają słowo „zadatek”. Nie wymyślaj kotwic. Jeżeli instrukcja nie ma właściwego rozdziału, przygotuj jego uzupełnienie w obrębie dokumentacji, bez zmiany procesu biznesowego.

## 11. Kolejność wdrożenia dla Claude Code

1. Odszukaj widok po tekstach „Ustawienia zadatków” i „TRYB WYLICZANIA ZADATKU”. Znajdź CSS, źródło konfiguracji, zapis, kontrolę uprawnień i konsumenta ustawień w multisprzedaży.
2. Sporządź mapę rzeczywistych trybów, parametrów i reguł zaokrągleń. Ustal zakres działania ustawień oraz parser kwot i precyzję.
3. Przeprojektuj tylko ten widok, ze stylami ograniczonymi do jego korzenia, np. `.estelio-deposit-settings`. Nie nadpisuj globalnych `input`, `select`, `button` i `.card`.
4. Podłącz istniejące opcje i warunkowe pola. Nie przenoś wartości demonstracyjnych do domyślnych ustawień produkcji.
5. Dodaj podgląd oparty na zweryfikowanym wspólnym obliczeniu. Jeśli potrzebna jest ekstrakcja helpera, utrzymaj zgodność multisprzedaży i ogranicz diff do niezbędnego wydzielenia.
6. Obsłuż stany odczytu, draftu, walidacji, zapisu i niepewnego wyniku. Podgląd nie może powodować zapisów.
7. Wykonaj ukierunkowane testy, pokaż screenshot desktop/mobile i raport z faktycznymi wynikami. Dla testów zapisujących użyj izolowanego salonu/środowiska testowego.
8. Przygotuj zmianę do przeglądu zgodnie z zasadami repozytorium. Ta paczka nie stanowi osobnego polecenia wdrożenia na main/produkcję.

## 12. Kryteria odbioru

| Próba | Oczekiwany rezultat |
|---|---|
| Odczyt prawdziwej konfiguracji | Wartości z backendu, nie z makiety |
| Procent 50, przykład 195,00, brak zaokrąglenia | 97,50 zł; brak zapisu konfiguracji przy zmianie przykładu |
| Każdy istniejący tryb i wariant zaokrąglenia | Zachowane opcje, prawidłowe pola, zgodny podgląd albo jawne ograniczenie przykładu |
| Przypadki graniczne zaokrąglenia | Podgląd identyczny z rzeczywistym kalkulatorem dla punktu granicznego oraz wartości tuż przed/po nim |
| Kwoty z groszami i ułamkowy procent, jeśli dozwolony | Ta sama precyzja i kolejność operacji co w sprzedaży |
| Rabat/ilość/wiele pozycji w multisprzedaży | Brak regresji po ewentualnym wydzieleniu helpera; zakres podstawy zadatku zachowany |
| Zmiana wyłącznie przykładu | Brak dirty state, brak API zapisu, Enter nie wysyła ustawień |
| Pusty/błędny przykład | Wynik „—”, ustawienia nadal można zapisać, jeśli są poprawne |
| Błędny parametr konfiguracji | Brak zapisu, komunikat przy polu, brak fałszywego wyniku |
| Zapis udany | Dane zachowane na ekranie, serwer potwierdza, ponowny odczyt zgadza się z zapisem |
| Zapis nieudany/timeout | Brak fałszywego sukcesu, draft pozostaje, bez automatycznego powtarzania |
| Błąd odczytu / nieznany tryb | Nie nadpisuje danych domyślnymi wartościami |
| Rola bez uprawnień / inny salon | Dotychczasowa kontrola dostępu i izolacja danych |
| 320px, 400px, 800×550, desktop, zoom 200% | Czytelny układ, dostępny zapis, brak obcinania pól i kwot |
| Klawiatura / pomoc | Dostępne etykiety i fokus, otwarcie pomocy nie wysyła formularza |
| Inne moduły | Brak zmian wyglądu i reguł działania poza uzgodnionym zakresem |

Nie wymagaj pełnej nowej baterii testów samego CSS. Priorytetem są zgodność obliczeń i zaokrągleń, oddzielenie przykładu od zapisu oraz brak regresji multisprzedaży. Nie oznaczaj jako PASS próby, której nie wykonano.

## 13. Co oddać po implementacji

- Listę zmienionych plików i krótkie uzasadnienie każdej zmiany poza plikiem widoku.
- Mapę trybów i zaokrągleń potwierdzoną z kodu oraz miejsce wspólnego kalkulatora.
- Screenshot desktop i mobile, w tym tryb procentowy i pozostałe rzeczywiście istniejące warianty.
- Wyniki testów zgodności podglądu z multisprzedażą i testów zapisu, z rozróżnieniem wykonane/niewykonane.
- Jawne odstępstwa od makiety, np. inne nazwy jednostek lub dodatkowe pola wymagane przez istniejący tryb.

Efekt końcowy: spokojny, czytelny ekran ustawień z jasnym przykładem działania, bez zmiany reguł pobierania i rozliczania zadatków.


## 14. Paczka implementacyjna — kolejność użycia

1. Otwórz `START.md`, następnie `index.html` w przeglądarce. Obejrzyj `makiety/01-ustawienia-zadatkow.png`.
2. Przeczytaj tę instrukcję oraz `INTEGRACJA_KODU.md` w całości.
3. Znajdź rzeczywisty formularz. W raporcie podaj ścieżki komponentu, API, autoryzacji i kalkulatora. Bez wymyślania nazw.
4. Osadź strukturę `zadatki.fragment.html` we właściwym obszarze istniejącego widoku. Dopasuj do frameworka Estelio, zachowując semantykę i klasy. Nie wstawiaj całego `index.html` do aplikacji.
5. Przenieś `zadatki.css` jako style tego modułu. Zachowaj aktualny font aplikacji. Nie przenoś `body`, `main` ani demonstracyjnej stopki z index.html.
6. `zadatki.js` zawiera kontroler UI z jawnym adapterem. Możesz przenieść jego zachowania do obecnego frameworka; nie montuj dwóch kontrolerów na tych samych elementach.
7. Zastąp adapter demonstracyjny aktualnym odczytem, walidacją, kalkulatorem i zapisem Estelio. Nie dołączaj `demo-model.js` i `demo.js` do produkcji.
8. Porównaj screenshot wdrożenia z makietą przy tej samej dostępnej szerokości treści, osobno w stanie czystym i niezapisanym. Wykonaj testy wymienione wyżej.
9. Oddaj raport z dowodami. Sam fakt otwierania index.html nie oznacza gotowego wdrożenia.

### Wiążące różnice demo / produkcja

- `percent`, `none`, `five`, `ten` to umowne identyfikatory demo. Nie migruj do nich danych produkcji.
- Demo ma jeden POTWIERDZONY WIDOCZNY tryb procentowy. Nie jest dowodem, że to jedyny tryb Estelio. Opcje i parametry muszą pochodzić z inwentaryzacji kodu.
- Demo dopuszcza 0–100%, dwa miejsca po przecinku i dodatnią kwotę przykładu. Te limity nie zmieniają istniejącej walidacji backendu.
- Demo liczy wynik procentowy w groszach, rozstrzygając pół grosza w górę. To jawnie demonstracyjna zasada. Nie uznano jej za zasadę Estelio.
- Dla zaokrągleń 5/10 demo nie oblicza wyniku, ponieważ kierunek nie został potwierdzony. Kafle można wybierać i zapisywać demonstracyjnie. W produkcji podłącz właściwy kalkulator, usuń techniczny komunikat demo.
- W demo zapis jest wyłącznie w pamięci; odświeżenie przywraca 50% i brak zaokrąglenia. Nie ma połączeń sieciowych, danych klientów ani zmian w Estelio.
- Makieta pokazuje „Niezapisane zmiany”. Demo startuje z czystym formularzem i nieaktywnym zapisem. Stan zgodny z makietą uzyskasz po zmianie ustawienia.
- Pomoc jest lokalnym panelem pokazującym treść. W produkcji użyj wspólnego komponentu pomocy Estelio; nie dodawaj fikcyjnego linku do dokumentacji.
- Demo używa stałych identyfikatorów DOM i zakłada jedną instancję na stronie. Jeżeli SPA utrzymuje ukryte kopie widoku, użyj unikalnego prefiksu ID oraz skoreluj label/aria-controls/aria-describedby.
- Porównywanie dirty w demo jest strukturalne. W produkcji porównuj konfigurację po potwierdzonej normalizacji, aby równoważne zapisy `50` / `50,00` nie powodowały fałszywego stanu zmiany.

## 15. Odbiór tej paczki

Wykonano 28 testów czystego modelu/adaptera demonstracyjnego oraz sprawdzenie składni JS. Nie wykonano odbioru w przeglądarce, testów rzeczywistego API ani zgodności z kalkulatorem Estelio. Makieta PNG pochodzi z silnika graficznego, nie z renderowania HTML. Zgodność wizualna 1:1 wymaga porównania po uruchomieniu; obecna paczka nie przedstawia tego jako wykonanego testu.
