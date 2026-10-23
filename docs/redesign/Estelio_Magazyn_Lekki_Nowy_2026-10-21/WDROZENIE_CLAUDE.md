# Estelio — nowy produkt w magazynie, styl „lekki nowy”

Wersja 1.0, 21.10.2026. Instrukcja dla Claude Code. Zakres: nowa warstwa formularza dodawania/edycji produktu i wybór kategorii, z podłączeniem istniejącej logiki magazynu.

## 1. Polecenie

Wdróż formularz z tej paczki w istniejącym Estelio. Zachowaj układ, typografię, kolory i interakcje dostarczonego HTML/CSS/JS. Podłącz rzeczywiste kategorie oraz istniejące operacje dodawania i edycji produktu. Nie zmieniaj pozostałych ekranów i logiki magazynowej.

To kod frontendu referencyjnego, nie gotowa integracja z backendem Estelio. Pliki demo nie wywołują API. Makiety PNG nie są zrzutami renderowania tego kodu. Odbiór przeglądarkowy wykonaj na docelowym środowisku developerskim.

## 2. Co otrzymujesz

| Plik | Przeznaczenie |
|---|---|
| `index.html` | Przykładowy formularz zgodny z makietą: rękawiczki, 12 szt., minimum 5 |
| `kategorie.html` | Ten sam formularz z otwartym wyborem kategorii |
| `nowy.html` | Pusty formularz: ilość 0, minimum 5, pozostałe pola puste |
| `edycja.html` | Edycja: „Obecna ilość” i „Zapisz zmiany” |
| `formularz.fragment.html` | HTML komponentu do osadzenia w istniejącym widoku |
| `assets/magazyn.css` | Wspólne style ograniczone do `.ei` |
| `js/magazyn.js` | Komponent, kategorie, formularz, walidacja i stany zapisu |
| `js/model.js` | Wyszukiwanie, daty, liczby dziesiętne i różnice pól |
| `js/adapter-estelio.template.js` | Miejsce podłączenia rzeczywistych serwisów aplikacji |
| `js/demo-adapter.js`, `js/demo.js` | Fikcyjne dane i zapis w pamięci; nie wdrażać do produkcji |
| `assets/demo-page.css` | Marginesy samodzielnej strony demo; nie wdrażać do Estelio |
| `makiety/01-formularz.png` | Referencja zamkniętego formularza |
| `makiety/02-kategorie.png` | Referencja otwartego wyboru kategorii |
| `tests/model.test.cjs` | 13 testów logiki i adaptera demonstracyjnego |

Wszystkie podglądy korzystają z tego samego CSS i JS. Nie utrzymuj osobnych kopii komponentu dla dodawania i edycji.

## 3. Zachować dokładnie siedem pól

| Klucz UI | Dodawanie | Edycja | Znaczenie |
|---|---|---|---|
| `name` | Nazwa produktu | Nazwa produktu | Tekst, bez renderowania jako HTML |
| `categoryId` | Kategoria | Kategoria | ID istniejącej kategorii, nie jej nazwa |
| `quantity` | Stan początkowy | Obecna ilość | Stan ilościowy, nie wielkość kolejnej dostawy |
| `unit` | Jednostka | Jednostka | Swobodny tekst, np. szt., ml, g, opak. |
| `minimum` | Minimum magazynowe | Minimum magazynowe | Dotychczasowy próg alarmowy |
| `expiry` | Data ważności | Data ważności | Data opcjonalna, bez czasu i przesunięć strefy |
| `price` | Cena sprzedaży brutto | Cena sprzedaży brutto | Cena detaliczna, nie koszt zakupu |

Nie dodawaj SKU, kodu kreskowego, dostawcy, VAT, zdjęć produktu, partii ani checkboxa sprzedaży detalicznej. Nazwa formularza w trybie dodawania: „Dodaj produkt do magazynu”. W edycji: „Edytuj produkt w magazynie”.

Przyjmowanie dostawy to inna istniejąca operacja. Nie podłączaj jej pod „Dodaj produkt”. Nie wykonuj dodatkowego zwiększenia stanu, jeżeli obecny endpoint utworzenia produktu już zapisuje ilość początkową.

## 4. Rozpoznanie przed zmianą kodu

Znajdź samodzielnie w repozytorium i opisz w `docs/magazyn-lekki-nowy/MAPA.md`:

1. Obecny widok Nowy Produkt / Edycja i jego punkt montowania.
2. Źródło kategorii, ich ID, hierarchię, możliwość wyboru rodzica i stan archiwalny.
3. Endpoint/handler odczytu produktu, dodawania i edycji oraz uprawnienia i kontekst salonu.
4. Reguły pól: wymagane wartości, precyzja ilości, dopuszczalne jednostki, wartości ujemne, długości tekstów i zakresy liczb.
5. Semantykę pustej ceny oraz ceny 0, pustej daty i usunięcia istniejącej daty.
6. Czy edycja przyjmuje PATCH czy cały rekord, oraz jak chroni ilość przed nadpisaniem równoległej dostawy/zużycia.
7. Czy utworzenie już generuje stan lub ruch magazynowy.
8. Sposób obsługi ponowień, konfliktów, nieznanego wyniku operacji i odświeżania listy.

Nie zgaduj nazw endpointów. Nie zmieniaj działania magazynu na podstawie danych demonstracyjnych. Wymagania wpisane w demo są rozsądną walidacją referencyjną; dostosuj je do potwierdzonego kontraktu istniejącego systemu.

## 5. Wygląd do odtworzenia

- Tło `#FDF9F7`, karta biała, tekst `#101828`, pomocniczy `#667085`.
- Akcent `#A54868`, jasny róż `#FCF0F4`, linie `#E7E9EE`, obramowania inputów `#D8DCE3`.
- Karta 22 px radius, delikatny cień, padding 30 px; na telefonie 16 px i radius 18 px.
- Maksymalna szerokość treści 1312 px. Podgląd na 1536 px ma ok. 112 px marginesu z obu stron.
- Nagłówek 36 px desktop, 27 px mobile; sekcje 23 px desktop / 19 px mobile; pola 16 px.
- Pola ok. 56 px wysokości, przyciski 56 px desktop / 50 px mobile.
- Sekcja 1: nazwa w pełnej szerokości, poniżej kategoria w pełnej szerokości.
- Sekcja 2: trzy równorzędne pola — ilość, jednostka, minimum.
- Sekcja 3: data ważności po lewej, cena brutto ze stałym sufiksem „zł” po prawej.
- Cena ma opis „Uzupełnij, jeśli produkt sprzedajesz detalicznie.”
- Footer: Anuluj i akcentowy Dodaj produkt / Zapisz zmiany, wyrównane do prawej.
- Nie kopiuj globalnego resetu `html,body`. Nie zmieniaj menu i logo Estelio. Jeżeli kontener Estelio ma już marginesy, dopasuj jedynie zewnętrzny padding `.ei`, aby nie naliczać go podwójnie.
- Font systemowy w paczce jest lokalny. Jeśli Estelio ma lokalny font marki, stosuj go spójnie bez nowego CDN.

## 6. Kategorie — wymagane zachowanie

1. Zamknięte pole pokazuje pełną ścieżkę wybranej kategorii.
2. Kliknięcie otwiera biały panel zakotwiczony przy polu, bez przyciemniania ekranu.
3. Panel jest wyrównany do lewej krawędzi pola. To celowe doprecyzowanie makiety, na której generator lekko przesunął panel.
4. W panelu: wyszukiwarka, grupy odpowiadające ścieżkom rodziców i pozycje bez powtarzania całej ścieżki.
5. Wyszukiwanie obejmuje nazwę i pełną ścieżkę, ignoruje wielkość liter oraz polskie znaki. „tygodniowa plyny” ma odnaleźć właściwą pozycję.
6. Takie same nazwy w różnych gałęziach pozostają osobnymi opcjami, identyfikowanymi przez ID.
7. Wybrana pozycja: jasny róż i jeden znak zaznaczenia. Nie używaj checkboxów — wybierana jest jedna kategoria.
8. Rodzic, jeśli jest wybieralny w obecnym systemie, musi pozostać wybieralny. Zwróć go jako osobny rekord `selectable: true`. Nagłówek grupy nie zastępuje takiego rekordu.
9. Kategoria nieaktywna nie pojawia się jako nowy wybór. Przy edycji zachowaj istniejące przypisanie, nawet jeśli kategorię zarchiwizowano; backend rozstrzyga dopuszczalność zapisu.
10. Pusta lista lub brak wyników nie tworzy nowej kategorii automatycznie. Pokaż komunikat i zachowaj wpisy.
11. ArrowDown na przycisku otwiera panel; strzałki w wyszukiwarce przesuwają aktywną opcję; Enter wybiera; Escape zamyka bez zmiany; Tab pozwala przejść dalej i zamyka panel.
12. Ctrl/Cmd+Home/End przechodzi do pierwszej/ostatniej opcji. Zwykłe Home/End zachowują działanie edycji tekstu.
13. Kliknięcie poza panelem zamyka go bez zapisu przypadkowej opcji.
14. Panel ma lokalne przewijanie i wysokość dopasowaną do ekranu; przy dolnej krawędzi otwiera się nad polem.
15. Wyszukiwanie i nawigacja nie wysyłają formularza ani nie tworzą ruchów magazynowych.

## 7. Osadzenie komponentu

Załaduj tylko `assets/magazyn.css`, `js/model.js`, `js/magazyn.js` oraz własny adapter. Wstaw `formularz.fragment.html` w istniejące miejsce treści. Fragment używa znacznika `main`; jeżeli aplikacja ma już nadrzędny `main`, zamień tylko ten znacznik na `section`, zachowując `.ei` i `data-inventory-root`.

```js
const view = EstelioInventoryForm.mount(container, realAdapter, {
  mode: 'create', // albo 'edit'
  productId: null, // rzeczywiste ID przy edycji
  onSaved(result) {
    // Istniejące odświeżenie listy / przejście do produktu.
    // Nie wykonuj tutaj ponownie zapisu ani zwiększenia stanu.
  }
});
await view.ready;
// Przed opuszczeniem widoku router sprawdza view.hasUnsavedChanges().
// Po zakończeniu pracy widoku:
view.destroy();
```

Usuń z osadzanego fragmentu pasek wariantów `data-demo-nav`, etykietę `data-demo-label` i komunikat noscript, jeśli zapewnia go główna aplikacja. Nie przenoś elementów demo do globalnej nawigacji. Mount przypisuje indywidualne ID ARIA; nie duplikuj identyfikatorów na własną rękę.

## 8. Kontrakt adaptera — bez wymyślonych API

### Odczyt `load({ mode, productId })`

```js
{
  product: {
    name: '', categoryId: '', quantity: '0', unit: '', minimum: '5',
    expiry: null, price: null
  },
  categories: [
    { id: 'REAL-ID', label: 'Higieniczne',
      path: ['Inwentaryzacja tygodniowa'], active: true, selectable: true }
  ],
  version: 'rzeczywista-wersja-lub-inny-kontrakt-ochrony',
  canSave: true,
  rules: { quantityPrecision: 6, allowNegativeStock: false },
  currentCategoryLabel: 'Opcjonalna zachowana ścieżka kategorii archiwalnej'
}
```

ID kategorii przekazuj jako stabilny string. Nie deduplikuj po etykiecie. Nowy produkt ma wartości domyślne pobrane z rzeczywistych reguł Estelio; wartości 0/5 w demo odpowiadają pokazanemu staremu formularzowi. W edycji wczytaj zapisane wartości, nigdy nie podstawiaj 0/5 przy błędzie odczytu.

Opcjonalne reguły `maxName`, `maxUnit` i `quantityPrecision` mapuj z istniejącej walidacji. Precyzja 6 jest ustawieniem demonstracyjnym, nie decyzją o zmianie schematu bazy. `canSave` steruje UI, backend niezależnie sprawdza uprawnienia i salon.

### Zapis `save(operation)`

```js
{
  mode: 'create', productId: null, expectedVersion: sourceVersion,
  operationId: 'unikalny-klucz-tej-operacji',
  values: { /* siedem zwalidowanych pól */ },
  changes: { /* w create: wszystkie; w edit: tylko zmienione */ }
}
```

- Liczby w `values` to kanoniczne ciągi dziesiętne z kropką, np. `12.5`, bez utraty precyzji przez Number. Adapter mapuje je na rzeczywisty format API.
- Pusta cena to `null`, wpisane 0 to `"0"`. Nie zamieniaj ich automatycznie. Jeśli backend dziś przechowuje brak ceny jako 0, opisz to i zachowaj jego kontrakt na granicy adaptera; UI nie ustala nowej logiki sprzedaży.
- Pusta data to `null`; świadome wyczyszczenie istniejącej daty musi być przekazane jako zmiana.
- W edycji używaj `changes`. Zmiana nazwy nie może wysłać starej ilości i nadpisać dostawy wykonanej w międzyczasie.
- Jeżeli obecny endpoint wymaga pełnego rekordu, scal zmiany z aktualnym stanem i egzekwuj konflikt atomowo po stronie serwera. Sam ponowny GET przed PUT nie zapewnia ochrony.
- Zmiana ilości to ustawienie docelowej wartości według obecnego procesu korekty, nie dodanie wpisanej liczby do aktualnego stanu. Zachowaj istniejący rejestr zmian/uprawnienia.
- Stosuj istniejące walidacje jednostek, ilości, minimum, dat i zakresów ceny. Nie dokładaj nowego automatycznego przeliczenia jednostek ani zaokrąglania.

### Wynik zapisu

| Status | Zachowanie |
|---|---|
| `confirmed` + `product`, `productId`, `version` | Pokaż dane kanoniczne i potwierdzenie. Po create blokuj ponowne utworzenie tego samego formularza. |
| `rejected` + `message`, opcjonalne `errors` | Wiadomo, że nie zapisano. Zachowaj wpisy; odblokuj poprawę. Klucze błędów odpowiadają siedmiu polom. |
| `conflict` | Zachowaj wpisy i zablokuj zapis starej wersji. „Wczytaj aktualne dane” wymaga świadomego odrzucenia wpisów. |
| `unknown` lub błąd połączenia po wysłaniu | Nie ponawiaj tworzenia. Wyświetl „Sprawdź wynik zapisu”. |

`resolve({ operationId, mode, productId })` ma **odczytać** wynik tej samej operacji. Zwraca te same statusy; `rejected` tylko wtedy, gdy backend potwierdza brak skutku. Brak wpisu w niewiarygodnym/cache'owanym źródle nie jest dowodem braku zapisu.

Idempotencja w adapterze demo służy demonstracji. UUID po stronie klienta nie zapewnia idempotencji backendu. Podłącz istniejący mechanizm lub zaprojektuj minimalną ochronę tworzenia przed ponowieniem. Nie wdrażaj przycisku sprawdzania, który zawsze zwraca nieznany wynik lub tworzy produkt ponownie.

Jeśli istniejący backend nie obsługuje wersji, nie generuj pozornego numeru w frontendzie. Zachowaj jego istniejący bezpieczny proces korekty/edycji albo wdroż konieczną ochronę po stronie serwera jako osobną, opisaną zmianę. Nie deklaruj ochrony przed utratą danych bez testu integracyjnego.

### Anulowanie `cancel({ mode, productId })`

Wraca do istniejącego widoku magazynu. Nie usuwa produktu i nie resetuje stanów w bazie. Komponent pyta o odrzucenie lokalnych zmian. Podczas zapisu/nieznanego wyniku nie wywołuje cancel. Przed zmianą trasy użyj `hasUnsavedChanges()`; router nie może odmontować formularza z nierozstrzygniętym zapisem bez jasnej obsługi tej sytuacji.

## 9. Stany i UX

- Ładowanie: pola i zapis nieaktywne, czytelny komunikat; nie pokazuj fikcyjnego salda jako aktualnego.
- Błąd odczytu: „Spróbuj ponownie”; brak zapisu do czasu poprawnego odczytu.
- Brak praw: wczytane dane do podglądu, zapis i wybór kategorii zablokowane.
- Walidacja: błędy pod polami, fokus w pierwszym niepoprawnym polu. Enter w pickerze wybiera kategorię, Enter formularza zapisuje.
- Zapis: jedna operacja, przycisk „Zapisywanie…”, blokada kolejnego kliknięcia i edycji pól.
- Sukces: zmiany stają się nową bazą formularza, odświeżenie listy przez istniejący router. Sukcesu API nie cofaj komunikatem „nie zapisano”, jeśli nie udała się nawigacja.
- Anulowanie ze zmianami: Wróć do edycji / Odrzuć zmiany. Escape zamyka potwierdzenie bez odrzucenia.
- Pola i kategorie przyjmują tekst jako tekst, nigdy jako surowy HTML.
- Nie ostrzegaj o niskim stanie inną nierównością niż obecna logika. Podpis minimum jest celowo neutralny; znaczenie `<` / `<=` pozostaje w rdzeniu.
- Wartości na makietach są przykładowe, nie są domyślnymi danymi nowego produktu.

## 10. Responsywność i dostępność

Sprawdź 1536×1024, 1440×900, 1024×768, 800×550, 400×844, 320×568 i zoom 200%.

- Desktop: ilość/jednostka/minimum w jednym rzędzie; data/cena w drugim.
- Do 600 px wszystkie pola pionowo; brak poziomego przewijania całej strony.
- Kategorie mieszczą się w szerokości pola i dostępnym pionowym obszarze. Po otwarciu klawiatury mobilnej panel nadal daje się przewijać i zamknąć.
- Przy krótkim ekranie footer formularza pozostaje osiągalny przewijaniem. Nie wymuszaj sztywnej wysokości 1024 px.
- Zachowaj etykiety pól, fokus, powiązania błędów, role listbox/option/combobox i komunikaty wyników wyszukiwania.
- Testuj picker myszą, dotykiem i samą klawiaturą. Weryfikuj faktyczne odczyty czytnika ekranu, nie tylko obecność atrybutów.
- Ikony są liniowe SVG, bez emoji. Kategorie wybrane mają również znak i tekst, nie sam kolor.

## 11. Kolejność pracy

1. Mapa źródeł i operacji z sekcji 4.
2. Osadzenie scoped CSS i fragmentu w aktualnym kontenerze magazynu; bez zmian globalnych.
3. Rzeczywisty odczyt kategorii i danych edycji.
4. Podłączenie zapisu siedmiu pól i dotychczasowych walidacji.
5. Ochrona przed podwójnym utworzeniem, konfliktem ilości i nieznanym wynikiem.
6. Podłączenie powrotu do listy oraz poprawnego odmontowania komponentu.
7. Odbiór dwóch makiet, mobile i testy integracyjne.

Nie zmieniaj sprzedaży, portfeli, terminarza, liczników zabiegów ani innych modułów. Formularz magazynu musi działać niezależnie od aktywacji terminarza.

## 12. Kryteria odbioru

| ID | Próba | Oczekiwany wynik |
|---|---|---|
| M01 | Formularz z danymi jak na makiecie | Zgodny układ trzech sekcji i siedmiu pól |
| M02 | Otwarty picker | Wyszukiwarka, grupy, zaznaczenie i lokalny scroll |
| M03 | Dwie kategorie o tej samej nazwie | Zachowane odrębne ID i ścieżki |
| M04 | Szukanie „tygodniowa plyny” | Wynik właściwej grupy mimo braku polskich znaków |
| M05 | Wybieralny rodzic / archiwalna kategoria | Zachowane istniejące możliwości, bez samoczynnej zmiany przypisania |
| M06 | Puste wymagane pola / brak wyników | Czytelne błędy; brak wysłania niepoprawnego formularza |
| M07 | `12,5`, `0`, pusta cena | Poprawna normalizacja; null nie zmienia się w zero |
| M08 | Cena z 3 miejscami, tekst w ilości, niepoprawna data | Bez cichego obcięcia lub zaokrąglenia |
| M09 | Nowy produkt z ilością 12 | Powstaje raz i ma stan 12; bez drugiego naliczenia stanu |
| M10 | Edycja nazwy przy równoległej dostawie | Ilość z dostawy nie jest nadpisana |
| M11 | Dwie równoległe korekty ilości | Konflikt lub potwierdzony istniejący mechanizm ochrony |
| M12 | Podwójne kliknięcie / Enter / ponowienie tego samego klucza | Jeden skutek biznesowy |
| M13 | Utrata odpowiedzi po zapisie | Weryfikacja tej samej operacji, brak duplikatu |
| M14 | Wyczyszczenie daty/ceny w edycji | Zmiana zgodna z rzeczywistym kontraktem pola |
| M15 | Anulowanie i odrzucenie zmian | Bez operacji na stanach magazynowych |
| M16 | Brak sesji/praw, inny salon | Backend odmawia; UI nie zgłasza sukcesu |
| M17 | Telefon, niski viewport, zoom 200% | Wszystkie pola, kategorie i zapis osiągalne |
| M18 | Klawiatura | Enter nie zapisuje formularza podczas wyboru kategorii; Escape nie zmienia wyboru |
| M19 | Wielokrotne otwieranie widoku | Brak narastających listenerów i podwójnych zapisów |
| M20 | Pozostałe ekrany Estelio | Bez zmian wyglądu i funkcji; brak globalnych styli demo |

Raport `docs/magazyn-lekki-nowy/WYNIK.md`: lista zmienionych plików i commit, mapowanie API, wyniki M01–M20 z dowodami, dwa zrzuty rzeczywistego renderu odpowiadające makietom, mobile 400 px, lista odstępstw i ograniczeń. Dane wyłącznie demonstracyjne.

Oddziel PASS testów modelu od PASS testów integracyjnych i wizualnych. Nie deklaruj pełnej zgodności 1:1 na podstawie samego przejrzenia CSS.

## 13. Publikacja i cofnięcie

Najpierw realizacja i odbiór na dev. Przekazanie tej paczki nie oznacza polecenia publikacji na main. Stosuj istniejący proces wdrażania projektu. Cofnięcie nowej warstwy wizualnej nie może usuwać poprawnie utworzonych produktów ani odwracać rzeczywistych ruchów magazynowych.
