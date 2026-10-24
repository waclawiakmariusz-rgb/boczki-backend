# Sugestie — kontrakt kontrolera UI

Opis dotyczy dostarczonego wzorca, nie istniejących endpointów Estelio.

## Pliki

- `sugestie.fragment.html`: sam moduł, bez sidebaru, body, head i skryptów.
- `sugestie.css`: style tylko `.estelio-suggestions`.
- `model.js`: funkcje prezentacyjne — filtrowanie, przygotowanie DTO, stan formularza.
- `sugestie.js`: kontroler UI.
- `demo-adapter.js`, `demo.js`: wyłącznie demonstracja; NIE kopiować do produkcji.

Załaduj model przed kontrolerem. Zastąp uruchomienie z demo własnym adapterem:

```js
const view = EstelioSuggestions.mount(root, adapterEstelio);
view.hasUnsavedChanges(); // dla strażnika istniejącego routera
view.destroy();           // przy demontażu widoku
```

Nie mieszaj kontrolera z drugim systemem eventów tego samego formularza. W istniejącym frameworku przepisz te zachowania na komponenty, utrzymując wygląd i kontrakt.

Jedna instancja fragmentu na stronie. Jeśli router trzyma ukryte kopie, nadaj unikalne ID wszystkim elementom i ich aria-/label odniesieniom. `destroy()` usuwa listenery i blokuje wykorzystanie spóźnionej odpowiedzi; nie cofa już wysłanej mutacji serwera.

## Adapter

### `load()`

Zwraca Promise z serializowalnym do JSON snapshotem:

```json
{
  "rules":[{"id":"r1","version":1,"source":{"id":"storz","label":"Storz"},"target":{"id":"lpg","label":"Endermologia LPG"},"note":"Wskazówka"}],
  "catalog":[{"id":"storz","label":"Storz"},{"id":"lpg","label":"Endermologia LPG"}],
  "version":1,
  "canCreate":true,
  "canDelete":true,
  "allowFreeText":true
}
```

Identyfikatory są umowne, nie dowodzą schematu Estelio. Mapuj na dotychczasowy kontrakt. Jeżeli backend używa nazw, nie wprowadzaj ID ani migracji na siłę. `id` reguły musi umożliwiać jednoznaczne usunięcie według obecnego mechanizmu. Zachowaj identyfikację i izolację salonu poza stanem swobodnie wybieranym w UI.

`allowFreeText` nie jest nowym ustawieniem salonu. To odwzorowanie istniejącego sposobu obsługi tych pól. `true` pozwala na wpis spoza listy bez tworzenia oferty; `false` wymaga wybranej pozycji. Nie zmieniaj tego arbitralnie po wdrożeniu.

`catalog` w demo jest wspólny, mały i kompletny. Jeśli oba pola mają inne źródła, rozdziel je w adapterze i kontrolerze. Jeśli katalog jest zdalny lub duży, użyj istniejącego wyszukiwania i paginatora, odwołuj poprzednie żądania albo ignoruj spóźnione odpowiedzi. Nie pobieraj listy całej organizacji zamiast salonu.

`version` oznacza istniejący token współbieżności. Jeżeli go brak, nie dodawaj fikcyjnej wersji lub nowej kolumny z powodu redesignu; obsłuż odczyt aktualnego stanu i dotychczasowe zabezpieczenia. `rule.version` można wykorzystać przy mapowaniu do istniejącego warunku usuwania.

### `validate(draft)`

Synchroniczne `{valid: boolean, errors: {source?, target?, note?}}`. Zawsze zwraca `errors`, także puste. Walidacja bez zapisu. Dokładne ograniczenia zgodne z backendem. Puste wartości wymaganych dwóch pól są błędem w demo; argumentacja opcjonalna. Walidacja produkcyjna może być bogatsza, ale musi wynikać z istniejących zasad.

### `createRule(payload, {version, operationId})`

Payload zawiera wyłącznie:

```json
{"source":{"id":null,"label":"Nazwa A"},"target":{"id":null,"label":"Nazwa B"},"note":"Opcjonalna wskazówka"}
```

Nie wysyłaj query wyszukiwarki ani treści podglądu. Demo przycina zewnętrzne białe znaki — potwierdź normalizację w istniejącym API. Backend pozostaje autorytetem walidacji i uprawnień.

### `deleteRule(id, {version, operationId})`

Usuwa tylko wybrany rekord zgodnie z dotychczasowym kontraktem. Wysyłanie nazwy zabiegu zamiast ID reguły jest niedopuszczalne, chyba że taki jest zweryfikowany jednoznaczny kontrakt starego systemu.

### Odpowiedzi mutacji

Obie metody zwracają `{rules, version, changedId}` z aktualną potwierdzoną listą reguł. Kontroler nie modyfikuje listy optymistycznie. Możesz dostosować kontroler do realnego formatu odpowiedzi, zamiast przebudowywać API.

Jeżeli mutacja jest potwierdzona, lecz ponowny odczyt listy zawiedzie, NIE raportuj jej jako pewnego braku zapisu. Zachowaj potwierdzone ID i status; zaproponuj ponowny odczyt, nie ponowne utworzenie. Kontroler bazowy traktuje niepoprawny snapshot jako `UNCERTAIN` i blokuje następne mutacje do odczytu; docelowy adapter może przekazać bardziej precyzyjny wynik.

### Błędy

| code / pola | Reakcja UI |
|---|---|
| `fields: {source,target,note}` | Błędy pod polami, draft zostaje |
| `CONFLICT` | Blokada mutacji, ponowny odczyt |
| `UNCERTAIN` | Niepewny wynik; ponowny odczyt, bez automatycznego ponowienia |
| `FORBIDDEN` | Brak prawa do mutacji, odczyt aktualnych uprawnień |
| `NOT_FOUND` | Usuwany rekord zniknął, odśwież listę |
| inny błąd | Błąd operacji, zachowane dane i możliwość ręcznej próby |

Błąd transportu po wysłaniu żądania mapuj na UNCERTAIN, jeśli nie można potwierdzić braku zapisu. Nie wyświetlaj surowych błędów serwera, tokenów, SQL czy danych innych salonów.

### Idempotencja i współbieżność

Kontroler generuje `operationId`, a demonstracyjny adapter używa go, aby ponowienie tej samej operacji nie duplikowało rekordów. Nie zakładaj, że produkcyjne API już obsługuje ten klucz. Zachowaj istniejący mechanizm, a jeśli go brak, nie wprowadzaj automatycznych retries i nie deklaruj gwarancji „dokładnie raz”. Po timeout ustal stan przez realny odczyt; nie zgaduj po samych nazwach, bo duplikaty mogą istnieć legalnie. Ewentualne rozszerzenie backendu opisz jako osobną zmianę wymagającą przeglądu.

Dla sukcesu i powtórzenia idempotentnego zwracaj aktualny snapshot listy, nie dawną całą listę zapamiętaną w cache. Demo przechowuje wyniki operacji w pamięci i przy powtórzeniu zwraca aktualny snapshot listy; nie symuluje wszystkich przypadków wieloosobowych. Testy demo nie są dowodem odporności produkcji na współbieżność.

## Gotowe scenariusze demo

Otwórz index.html i dopisz parametr:

| Parametr | Stan |
|---|---|
| bez parametru | Pusty formularz, trzy przykładowe reguły |
| `?stan=pusto` | Brak reguł |
| `?stan=blad-odczytu` | Pierwszy odczyt błędny, ponowienie udane |
| `?stan=blad-zapisu` | Dodanie/usunięcie odrzucane |
| `?stan=timeout` | Niepewny wynik mutacji |
| `?stan=tylko-odczyt` | Lista bez prawa do zmian |
| `?stan=tylko-katalog` | Wymagany wybór pozycji z listy |

Stan głównej makiety: wpisz/wybierz Storz i Endermologia LPG; wpisz „Porozmawiaj z klientką o kolejnych możliwościach.”. Nie klikaj dodania, jeśli chcesz tylko porównać wypełniony formularz. W demo taka para już jest na liście; polityka duplikatów w produkcji musi pozostać dotychczasowa.

## Teksty i zakresy

Podgląd renderuje wartości przez textContent. innerHTML w kontrolerze używany jest wyłącznie dla stałych, zapisanych w kodzie SVG. Zachowaj to rozróżnienie. Ikony można zastąpić ikonami Estelio.

Kod demo nie odmienia nazw. Długie wartości zawijają się. Limity długości dołącz zgodnie z realnym kontraktem, bez zgadywania. Ten komponent nie przechowuje informacji o klientkach ani nie ocenia przydatności zabiegów.
