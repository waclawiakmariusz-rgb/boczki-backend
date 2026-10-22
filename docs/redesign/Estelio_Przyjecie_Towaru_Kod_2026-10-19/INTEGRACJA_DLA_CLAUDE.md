# Polecenia dla Claude Code — wdrożenie kodu widoku Przyjęcie towaru

## 1. Zacznij od tych plików

Otwórz `index.html` lokalnie i `MAKIETA_PRZYJECIE_TOWARU.png`. Wykorzystaj dostarczony HTML i CSS jako konkretny wzorzec. Nie projektuj kolejnego układu. `PRZYJECIE_TOWARU_CLAUDE_CODE.md` jest szczegółową specyfikacją wizualną.

**Ważne rozróżnienie:** poprzedni brief zakazuje zastępowania produktu osobną aplikacją demo. Ta paczka dostarcza podgląd jako materiał wdrożeniowy; do Estelio wchodzi komponent podłączony do istniejących danych. Nie wdrażaj `demo.js`, `demo-shell.css`, panelu prób ani demonstracyjnego menu.

## 2. Zmiana w istniejącym widoku

1. Zlokalizuj prawdziwy widok przyjęcia, handler zapisu, źródło produktów i zasady cen, ilości oraz daty. Zapisz mapowanie w raporcie.
2. W istniejący obszar treści przenieś `przyjecie-towaru.fragment.html`. Jeśli aplikacja używa szablonów lub komponentów, przepisz ten fragment do obecnego formatu z zachowaniem struktury i klas.
3. Dołącz `przyjecie-towaru.css` wyłącznie dla tego ekranu. Selektory są ograniczone do `.estelio-goods-receipt`.
4. Zachowaj obecną nawigację, logo i szerokość menu. Nie wstawiaj bocznego menu z `index.html`.
5. Wykorzystaj `przyjecie-towaru.js` albo przenieś jego interakcje do obecnego cyklu życia aplikacji. Nie podpinaj równolegle nowego i starego handlera zapisu.
6. Usuń dawną kontrolkę „Detal” i odczyt stanu tej kontrolki. Tę samą wartość biznesową przekaż przez adapter tego widoku; nie narzucaj jej wszystkim zapisom w backendzie.

## 3. Kontrakt komponentu

Po umieszczeniu fragmentu i wczytaniu JS:

```js
const receiptView = EstelioGoodsReceipt.mount(
  document.querySelector('[data-goods-receipt]'),
  adapterEstelio,
  {
    receiptKind: 'Detal', // Zmapuj na prawdziwą dotychczasową wartość w adapterze.
    expiryRequired: false, // Dostosuj do obecnej reguły; tu to ustawienie demonstracyjne.
    allowZeroPrice: true  // Dostosuj do obecnej reguły; nie zmieniaj zasad przy redesignie.
  }
);
await receiptView.ready;
```

Nie podawaj `initialValues` w produkcji, chyba że odtwarzasz rzeczywisty szkic lub istniejący stan. Przykładowa marka, data, liczba i ceny są wyłącznie w `demo.js`.

`receiptView.reset(values)` ustawia nowy czysty formularz; bez argumentów czyści pola. Zwraca `false` podczas zapisu lub przy nierozstrzygniętym wyniku. `isDirty()` zwraca informację o zmianach. `getState()` zwraca tryb, wartości, `hasBlockingOperation` i identyfikator trwającej operacji. `destroy()` odpina zdarzenia; zwraca `false`, jeśli operacja wymaga rozstrzygnięcia. Router gospodarza ma respektować ten wynik, zamiast usuwać widok w trakcie zapisu.

Powtórne `mount` na tym samym kontenerze usuwa poprzednie listenery. Przy nierozstrzygniętej operacji odmawia ponownego montowania. Nie można na tej podstawie gwarantować idempotencji serwera — zapewnia ją istniejący backend, jeżeli taki mechanizm ma.

## 4. Adapter danych — zachowaj identyfikatory

`adapterEstelio.loadCatalog()` zwraca Promise z obiektem:

```js
{
  brands: [{ id: 'identyfikator-marki', name: 'Nazwa marki' }],
  types: [{ id: 'identyfikator-typu', name: 'Nazwa typu' }],
  products: [{
    id: 'identyfikator-produktu',
    brandId: 'identyfikator-marki',
    name: 'Nazwa modelu',
    typeId: 'identyfikator-typu',
    netCents: 8000,
    grossCents: 9840
  }]
}
```

Identyfikatory w kontrakcie komponentu są ciągami znaków. Zachowaj stabilne ID ze źródła; nie przypisuj ich na podstawie nazw lub indeksów. Ceny katalogowe w groszach są opcjonalne. Każda nazwa trafia do `textContent`, a nie do wstrzykiwanego HTML.

W tym wzorcu użyto natywnych list. Jeśli obecny produkt pozwala wyszukiwać lub dodawać marki/modele, zachowaj ten komponent i podłącz go do tych samych pól oraz danych. Nie wolno usuwać istniejącej ścieżki tylko dlatego, że podgląd zawiera krótką listę.

Jeśli typ jest wyliczany i nieedytowalny w istniejącym kontrakcie, zachowaj tę regułę w adaptacji. Jeśli dotychczas ceny się przeliczały, przenieś istniejący algorytm; ten kod celowo nie wymyśla nowego VAT. Bazowe reguły wzorca to całe dodatnie sztuki, dwie cyfry po przecinku i opcjonalna data. Gdy rzeczywisty kontrakt jest inny, dopasuj parser, krok, walidację i testy; `adapter.validate` służy do dodatkowych ograniczeń, nie omijania bazowego parsera.

## 5. Adapter zapisu — istniejący handler

Komponent wywołuje **raz**:

```js
adapterEstelio.save(payload, { operationId })
```

| Pole `payload` | Znaczenie i mapowanie |
|---|---|
| `kind` | Stały rodzaj tego widoku. Zmapuj na wcześniejszą wartość zaznaczonego „Detal”. |
| `brandId` | Marka/Firma — etykieta UI nie wymusza zmiany nazwy pola API. |
| `productId` | Wybrany model należący do marki. |
| `typeId` | Dotychczasowy typ. |
| `quantity` | Dodatnia całkowita liczba sztuk w tym wzorcu. |
| `expiryDate` | Data kalendarzowa `YYYY-MM-DD` albo `null`. Nie przepuszczaj przez konwersję UTC. |
| `netCents` | Cena netto jednej sztuki, całkowita liczba groszy. |
| `grossCents` | Cena brutto jednej sztuki, całkowita liczba groszy. |

To **lokalny kontrakt widoku**, a nie twierdzenie o schemacie Estelio. Zbuduj mapowanie do istniejącego żądania. Nie twórz zgadywanego endpointu. Zachowaj dotychczasowe uwierzytelnienie, sesję, salon, uprawnienia, aktualizację stanów i historii. Nie wysyłaj `operationId` jako domniemanego zabezpieczenia, jeśli serwer go nie obsługuje.

Adapter zwraca jeden z wyników:

```js
{ status: 'confirmed', receiptId: 'id-z-serwera', message: 'Przyjęto 6 szt. Firming Pack.' }
{ status: 'rejected', message: 'Konkretna przyczyna odmowy.', fieldErrors: { quantity: 'Komunikat pola' } }
{ status: 'unknown' }
```

- `confirmed`: tylko po jednoznacznym potwierdzeniu faktycznego zapisu.
- `rejected`: tylko gdy wiadomo, że operacja nie została wykonana i nie może już zostać wykonana przez nadal działające żądanie.
- `unknown`: utrata odpowiedzi, timeout, niejednoznaczny błąd lub wyjątek. Komponent blokuje ponowne wysłanie i nie kasuje danych.

Opcjonalnie `adapterEstelio.checkResult({ operationId, payload })` ma **sprawdzić** istniejący wynik i zwrócić jeden z powyższych stanów. Nie może sam tworzyć nowego przyjęcia. Zwykły brak znalezionego rekordu nie wystarcza do `rejected`, jeśli pierwsze żądanie może jeszcze się zakończyć. Bez mechanizmu sprawdzania pozostaw instrukcję sprawdzenia magazynu i użyj istniejącego procesu wyjaśnienia wyniku. Nie dokładaj w ramach redesignu nowego systemu transakcji.

## 6. Pozostałe callbacki

- `adapterEstelio.validate(payload)` — synchronicznie zwraca obiekt dodatkowych błędów o kluczach `brandId`, `productId`, `typeId`, `quantity`, `expiryDate`, `net`, `gross`, ewentualnie `_form`. Brak błędów: `{}`.
- `adapterEstelio.onSuccess(result, {payload, operationId})` — używa istniejącego odświeżenia magazynu i uzgodnionego resetu lub powrotu. Błąd tej funkcji nie zmienia zapisu potwierdzonego w nieudany i nie odblokowuje jego ponowienia bez zmiany danych.
- `adapterEstelio.onCancel()` — istniejący powrót do magazynu. Uruchamiany od razu przy czystym formularzu albo po potwierdzeniu odrzucenia zmian.

W demonstracji `onSuccess` i `onCancel` czyszczą formularz. Nie jest to nakaz zmiany istniejącej nawigacji Estelio.

## 7. Odbiór przed uznaniem wdrożenia za gotowe

1. Porównaj realnie uruchomiony ekran z makietą przy obszarze treści ok. 1399 px (referencyjny viewport 1663×946 z menu 264 px). Nie zmieniaj menu aplikacji, żeby uzyskać wynik.
2. Sprawdź 390 px, 800×550, powiększenie 200%, długą nazwę, pusty formularz, błędy i potwierdzenie anulowania. Żadne pole ani akcja nie może wypaść poza dostępny obszar.
3. Sprawdź 6×98,40, zmianę na 7, pustą i błędną cenę, zmianę marki, datę przestępną i cenę z kropką.
4. Porównaj semantykę starego i nowego żądania, zwłaszcza rodzaj Detal, ceny i datę. Użyj danych fikcyjnych w izolowanym środowisku testowym.
5. Sprawdź dwuklik, Enter w trakcie zapisu, wyjście/powrót, odmowę i nieznany wynik. Jedna akcja ma dać najwyżej jeden zapis.
6. Potwierdź brak zmian w innych ekranach. CSS podglądu i przykładowe dane nie mogą znaleźć się w produkcie.
7. Oddaj `PRZYJECIE_TOWARU_WYNIK.md` z mapą prawdziwego adaptera, wynikami prób, zrzutem porównawczym oraz informacją, co pozostaje niezweryfikowane.

Nie oznaczaj tej paczki jako gotowego wdrożenia 1:1: jej odbiór przeglądarkowy nie został wykonany z powodu awarii środowiska podglądu. Kod i makieta są kompletnym materiałem do jego przeprowadzenia. To polecenie dotyczy implementacji i weryfikacji w gałęzi roboczej; nie uruchamia wdrożenia na main ani zapisów w realnym salonie.
