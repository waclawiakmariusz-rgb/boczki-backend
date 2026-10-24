# Kreator produktów — podłączenie do Estelio

To kontrakt wzorca UI, nie potwierdzony schemat aplikacji produkcyjnej.

## Pliki i uruchomienie

Osadź `kosmetyki.fragment.html` w obecnym widoku, dołącz `kosmetyki.css`, `model.js`, potem `kosmetyki.js`. Przykład:

```js
const view = EstelioCosmetics.mount(rootElement, adapterEstelio);
view.hasUnsavedChanges(); // do istniejącego strażnika routera
view.destroy();           // przy demontażu widoku
```

Nie kopiuj body/main ani stopki demo. Nie dołączaj `demo-adapter.js` i `demo.js` do produkcji. Jeśli Estelio używa frameworka, przenieś wygląd i zachowania do niego zamiast dublować listenery.

Fragment ma stałe ID i zakłada jedną instancję na stronie. Jeśli aplikacja utrzymuje kopie w DOM, zastosuj unikalny prefiks ID oraz label/aria referencji. `destroy()` ignoruje spóźnione odpowiedzi i usuwa listenery; nie odwołuje już wykonanej operacji serwera.

## Adapter — load

```js
load() => Promise<{
  products: [{id, version, brand, name, priceCents}],
  brands: ["Aliness", "APIS"],
  version,
  canCreate: true,
  canEdit: true,
  canDelete: true
}>
```

W demo brand/name są tekstem, priceCents nieujemną bezpieczną liczbą całkowitą. Wszystko serializowalne do JSON. ID produktów muszą być jednoznaczne w zakresie widoku. Zduplikowane ID/nieprawidłowa cena blokują przyjęcie snapshotu zamiast cicho nadpisać dane.

Nie oznacza to, że Estelio ma cenę w groszach czy osobne rekordy firm. Adapter może mapować istniejące jednostki i pola. Jeżeli istniejąca precyzja jest większa niż dwa miejsca, dostosuj formatter, parser i UI bez utraty precyzji. Nie konwertuj przez niedokładne operacje zmiennoprzecinkowe. Waluta w tej paczce PLN zgodnie ze zrzutem; inne waluty wymagają istniejącego kontraktu walutowego, nie przeliczenia na złotówki.

Prawa edycji nie są włączane domyślnie: wymagane dokładnie boolean true. Backend musi niezależnie je sprawdzać.

`brands` jest w demo listą nazw. Jeśli rzeczywisty system operuje ID firm, przenieś je przez select i draft, a nazwy traktuj jako etykiety. Nie zgaduj ID z podobnej nazwy. Jeżeli dwie firmy mają tę samą nazwę, rozróżnij je za pomocą istniejących danych.

## Walidacja

```js
validate({brand, name, price}, mode /* 'create' | 'edit' */)
  => {valid: boolean, errors: {brand?, name?, price?}}
```

`errors` zawsze obiekt. Walidacja kontrolera synchroniczna, serwer pozostaje autorytetem. Cena na wejściu jest tekstem z pola. Demo przyjmuje0 oraz od0 do9 cyfr całkowitych i maksymalnie2 miejsca po przecinku, bez separatorów tysięcy. To wyłącznie demonstracja, nie nowa polityka Estelio.

Przenieś faktyczny parser/normalizację, zakresy i długości pól. Model.sameDraft używa parsera demo do uznania260 i260,00 za równoważne; podczas integracji dostosuj to do tego samego parsera co zapis.

## Mutacje

```js
createProduct({brand, name, price}, {version, operationId})
updateProduct(id, {brand, name, price}, {version, recordVersion, operationId})
deleteProduct(id, {version, recordVersion, operationId})
```

Odpowiedź każdej metody: aktualny potwierdzony snapshot w formacie load plus `changedId`. UI aktualizuje listę po odpowiedzi serwera. Pełny snapshot jest uproszczeniem podglądu, nie wymaganiem przebudowy API; adapter/kontroler dostosuj do faktycznego formatu.

Nowa firma w demo jest tekstem tworzonego produktu. Nie ma osobnego żądania firmy ani trwałego słownika. Produkcyjny adapter musi zachować rzeczywisty proces. Jeśli wymaga osobnego zapisu firmy, obsłuż jej ładowanie, błąd i potwierdzenie w inline komponencie; nie uruchamiaj produktu na niepotwierdzonym ID.

Nie wysyłaj page, query, stanu modala, count, podglądu ani innych pól prezentacyjnych. Zachowaj niezbędne metadane backendu przez adapter, nie kasuj ich przez zastąpienie całego rekordu trzema polami.

### Błędy

| Kod / parametr | Działanie |
|---|---|
| fields: {brand,name,price} | Błędy przy polach, zachowany draft |
| CONFLICT | Blokada kolejnych zmian do uzyskania aktualnego stanu |
| UNCERTAIN | Nie wiadomo, czy operacja się wykonała; brak automatycznego ponawiania |
| FORBIDDEN | Odczyt aktualnych uprawnień, brak obejścia |
| NOT_FOUND | Rekord zniknął, odczyt katalogu |
| IN_USE | Produkt powiązany; pozostaje na liście, bez obejścia blokady |
| inny | Ogólny błąd, formularz pozostaje |

Błąd transportu po wysłaniu żądania mapuj na UNCERTAIN, jeśli nie ma pewności, że nic nie zapisano. Nie wyświetlaj surowego SQL, tokenów ani wrażliwego komunikatu serwera.

Dialog pozostaje po błędzie. Przy blokadzie użytkownik może świadomie odrzucić lokalny formularz i zamknąć dialog, a następnie wczytać katalog. Docelowy system może użyć lepszego istniejącego procesu porównania konfliktu i zachowania draftu. Nie zamieniaj porzucenia draftu na cofnięcie operacji serwera.

Jeśli zapis potwierdzony, a dodatkowy odczyt listy zawiedzie, nie przedstawiaj tego jako pewnego niepowodzenia zapisu. Zachowaj potwierdzone ID i informację o powodzeniu; ponawiaj odczyt, nie tworzenie.

### Wersje i idempotencja

`version`, `recordVersion`, `operationId` to jawne punkty podłączenia istniejących mechanizmów. Nie są dowodem, że backend już je ma. Demo weryfikuje wersję całej listy i przechowuje wyniki operacji w pamięci. Nie implementuje bazy ani transakcji.

Przy tym samym operationId i identycznym żądaniu demo nie powtarza zmiany; zwraca aktualny snapshot. Inna treść z tym samym kluczem jest błędem. W produkcji użyj istniejącej idempotencji. Jeśli jej brak, nie obiecuj dokładnie jednego wykonania i nie dodawaj automatycznych retries. Ewentualną zmianę backendu rozpatrz osobno.

Nie zastępuj ID produktu nazwą. Edycja i usunięcie dwóch identycznie nazwanych produktów muszą pozostać rozróżnialne.

## Paginacja i dane

Podgląd ładuje13 produktów i filtruje/stronicuje lokalnie po6. Produkcja powinna użyć dotychczasowego sposobu pobierania. Przy API stronicowanym dostosuj kontroler do total/query/page i ignorowania starych odpowiedzi. Nie wyciągaj total z aktualnej strony. Nie twórz pozornej globalnej wyszukiwarki filtrującej tylko wczytane rekordy.

Sortowanie katalogu w demo zachowuje kolejność źródłową. Nie zmieniaj kolejności produkcyjnych rekordów przypadkową normalizacją. Lista firm sortowana lokalnie w demo nie definiuje porządku firm w Estelio.

## Scenariusze podglądu

| Adres | Stan |
|---|---|
| index.html | Pusty formularz,13 przykładowych produktów |
| index.html?stan=pusto | Pusty katalog |
| index.html?stan=blad-odczytu | Pierwszy odczyt błędny, ponowienie udane |
| index.html?stan=blad-zapisu | Mutacje zwracają błąd |
| index.html?stan=timeout | Niepewny wynik zapisu |
| index.html?stan=tylko-odczyt | Bez dodawania, edycji i usuwania |
| index.html?stan=powiazany | Usunięcie blokowane przez przykładowe powiązanie |

Dla stanu głównej makiety wybierz Bruno Vassari i wpisz Illuminating Eye Contour oraz260,00. W demo taki produkt już istnieje; to przykład do porównania wyglądu, nie polecenie dublowania danych. Politykę duplikatów należy zaczerpnąć z backendu.

Druga grafika przedstawia trzy oddzielne stany, nie trzy modale otwarte jednocześnie. Wybór nowej firmy jest stanem inline. Edycję Illuminating Eye Contour otworzysz po wpisaniu „Eye” w wyszukiwarkę.

## Ochrona danych i stylów

Treści firm i produktów wstawiane przez textContent. SVG są stałymi elementami fragmentu. Nigdy nie wkładaj danych z API do innerHTML. Nazwa w filtrze nie powinna trafiać do logów z danymi sesji.

Wszystkie style scoped, bez globalnych zmian. Nie dołączaj pliku demo jako komponentu aplikacji. Zapis demonstracyjny jest pamięciowy i resetuje się po przeładowaniu; nie używa localStorage ani usług sieciowych.
