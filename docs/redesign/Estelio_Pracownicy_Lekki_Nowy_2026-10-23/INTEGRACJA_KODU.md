# Integracja HTML / CSS / JS — Claude Code

## Pliki i uruchomienie

| Plik | Rola |
| --- | --- |
| `index.html` | Samodzielny podgląd; otwórz po rozpakowaniu całego ZIP-a |
| `pracownicy.fragment.html` | Komponent do osadzenia w istniejącym obszarze treści |
| `pracownicy.css` | Style ograniczone do `.est-employees` |
| `pracownicy.js` | Renderowanie i obsługa formularza, listy, dialogu i pomocy |
| `demo.js` | Wyłącznie fikcyjny adapter w pamięci; NIE wdrażać do produktu |
| `PRACOWNICY_WDROZENIE_DLA_CLAUDE.md` | Specyfikacja, zakres i odbiór |
| `testy-podgladu.cjs` | Próby interakcji w Playwright, bez łączenia z Estelio |
| `WERYFIKACJA.md` | Rzeczywiste wyniki testów i ograniczenia |

Podgląd nie pobiera fontów ani bibliotek z CDN, nie wykonuje żądań do backendu i nie zapisuje w localStorage. Po przeładowaniu dane demonstracyjne wracają do stanu początkowego. Nie ma npm install ani procesu budowania wymaganego do otwarcia index.html. Testy wymagają Node, Playwright i przeglądarki Chromium.

## Montowanie komponentu

1. Osadź fragment we właściwej stronie Estelio; zachowaj zewnętrzny layout aplikacji.
2. Dołącz CSS i skrypt komponentu zgodnie z obecnym systemem zasobów/CSP. Jeśli aplikacja ma komponenty frameworka, przepisz wzorzec w jej konwencji, zachowując wygląd i kontrakty.
3. Przekaż jawnie adapter istniejących funkcji. Komponent nie zna adresów API, schematu bazy ani sesji. Nie dodawaj wymyślonych endpointów.
4. Wywołaj `EstelioEmployees.mount(element, options)` raz. Zwrócony obiekt ma `ready` (Promise), `refresh()` oraz `destroy()`. Przy zmianie trasy wywołaj destroy przed usunięciem kontenera. Trwające żądanie adaptera nie zostaje automatycznie cofnięte przez destroy.

### Opcje

| Opcja | Kontrakt |
| --- | --- |
| `adapter.list()` | Promise pełnej listy `[{id, name, canRemove?}]`; identyfikator string/number, unikalny; nazwa string |
| `adapter.create({name})` | Promise rozstrzygnięty dopiero po potwierdzonym zapisie; odrzucenie przy błędzie |
| `adapter.remove({id})` | Promise rozstrzygnięty dopiero po potwierdzonej dotychczasowej operacji usunięcia |
| `canAdd` | Boolean z rzeczywistych uprawnień; domyślnie true w wzorcu — w integracji podaj jawnie |
| `canRemove` | Boolean z rzeczywistych uprawnień; w integracji podaj jawnie |
| `row.canRemove` | Opcjonalne ograniczenie akcji dla konkretnego rekordu |
| `removeImpact` | Wymagany niepusty tekst, gdy usuwanie włączone. Wyjaśnia rzeczywisty, zweryfikowany skutek operacji |
| `helpUrl` | Zweryfikowany URL sekcji pomocy (http/https). Pusty oznacza brak linku; samo objaśnienie nadal działa |
| `maxNameLength` | Dodatnia liczba całkowita tylko jeżeli istniejący kontrakt ustala limit |

Wzorzec oczekuje pełnej listy, bo taki ekran pokazuje makieta. Jeśli produkcja używa paginacji, dostosuj renderowanie i licznik do jej aktualnego kontraktu; nie pobieraj wszystkich rekordów tylko dla zgodności ze wzorcem. Nie zmieniaj kolejności zwróconej przez backend.

Przykład struktury integracji (nazwy adaptera są projektowe, nie są stwierdzeniem o istniejącym API):

```js
const view = EstelioEmployees.mount(container, {
  adapter: existingEmployeesAdapter,
  canAdd: permissions.canAddEmployees,
  canRemove: permissions.canRemoveEmployees,
  removeImpact: verifiedRemovalDescription,
  helpUrl: verifiedEmployeesHelpUrl,
  maxNameLength: existingNameLimit
});
await view.ready;
// Przy odmontowaniu strony: view.destroy();
```

Z mapowania adaptera zachowaj identyfikatory, kontrolę salonu i autoryzację. Nie zastępuj identyfikatora nazwą. W starszym modelu bez ID wykorzystaj istniejący bezpieczny kontrakt zamiast tworzyć nową identyfikację po stronie UI.

## Błędy i zapis

Komponent rozpoznaje opcjonalne `error.code`: `DUPLICATE`, `FORBIDDEN`, `LINKED`, `NOT_FOUND`, `UNKNOWN_RESULT`. To normalizacja na granicy adaptera, nie wymaganie zmiany odpowiedzi backendu. Nie uznawaj każdej odpowiedzi 404 za brak pracownika; mapuj tylko rzeczywiście rozpoznany błąd domenowy. Wygasłą sesję obsłuż istniejącym mechanizmem aplikacji.

Adapter musi sprawdzać status odpowiedzi HTTP — samo zakończenie fetch nie jest sukcesem operacji. Nie przekazuj surowych treści wyjątków jako HTML. Dane nazw renderowane są przez textContent.

W prototypie mutacje w jednym zamontowanym widoku są serializowane. Blokada przycisku nie zastępuje transakcji, autoryzacji ani obsługi konkurencji backendu. Przy niepewnym wyniku komponent odświeża listę, bez automatycznego ponawiania zapisu. Zachowaj istniejącą idempotencję, jeśli jest; nie dodawaj nowego systemu idempotencji w redesignie.

W `demo.js` duplikat jest rozpoznawany bez uwzględniania wielkości liter, a nazwa jest przycinana. To wyłącznie zachowanie przykładowego adaptera. Produkcyjny adapter ma zachować aktualne reguły Estelio.

Po potwierdzonej mutacji z nieudanym ponownym pobraniem widać komunikat powodzenia operacji oraz osobny błąd odświeżenia. Stare dane nie mogą być przedstawiane jako świeżo zweryfikowane. Jeśli wymagana jest dodatkowa blokada działań przy utracie łączności, użyj istniejącej polityki aplikacji.

## Scenariusze podglądu

Dodaj parametr do adresu `index.html`:

- `?stan=pusty` — pusta lista;
- `?stan=blad-listy` — błąd pobierania (retry pozostaje celowo błędny w tym scenariuszu);
- `?stan=blad-zapisu` — zapis odrzucany;
- `?stan=blokada` — usuwanie blokowane przez symulowane powiązania;
- `?stan=podglad` — brak uprawnień do mutacji;
- `?stan=dluga-nazwa` — sprawdzenie zawijania.

Bez parametru: lista 8 fikcyjnych osób i działające operacje w pamięci strony.

## Granice gotowości

To wzorzec frontendowy do integracji, nie gotowa zmiana produkcyjna. Faktyczną semantykę usuwania, aktualne limity nazw, reguły duplikatów, uprawnienia i link pomocy należy odczytać z repozytorium. W demo nie ma linku „Więcej w pomocy”, ponieważ nie zweryfikowano konkretnej kotwicy.

Makieta wyznacza styl, a HTML/CSS pokazują mierzalną realizację. W obrazie generowanym fonty i skala mogą różnić się od systemowego renderowania. Odbieraj zgodność z parametrami dokumentu i zrzutami podglądu, a nie piksel po pikselu z rastrem. Kod nie zmienia innych modułów; style body w index.html należą tylko do demonstracji i nie są częścią fragmentu.

## Warunek zakończenia prac Claude

Uruchom istniejące, właściwe testy integracji z prawdziwym kontraktem i próby P01–P14. Potwierdź zgodność listy ze Sprzedażą i wpływ usuwania na historyczne dane. Nie przenoś danych demonstracyjnych ani demo.js do produkcji. Przekaż raport i zrzuty z docelowego środowiska testowego. Wyniki testów dołączone do tej paczki dotyczą tylko podglądu.
