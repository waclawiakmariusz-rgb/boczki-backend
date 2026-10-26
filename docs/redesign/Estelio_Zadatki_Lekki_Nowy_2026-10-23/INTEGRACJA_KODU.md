# Kontrakt podłączenia — ustawienia zadatków

To opis interfejsu dostarczonego kontrolera, nie istniejącego API Estelio.

## Uruchomienie

Załaduj CSS i `zadatki.js`, osadź fragment. Następnie:

```js
const view = EstelioDeposit.mount(rootElement, adapterEstelio);
// Przy opuszczeniu widoku SPA:
view.hasUnsavedChanges(); // podłącz do istniejącego ostrzegania przed utratą zmian
view.destroy();           // usuwa listenery, timer, ignoruje opóźnione odpowiedzi
```

`rootElement` musi zawierać dokładnie jedną instancję fragmentu. `index.html` uruchamia ten sam kontroler z adapterem demonstracyjnym.

## Adapter — wymagane cztery metody

### `load(): Promise<{config, catalog, revision, canEdit}>`

Odczyt autoryzowanej konfiguracji aktualnego salonu. `canEdit` musi być dokładnie `true`, aby UI udostępniło zapis. Backend niezależnie sprawdza uprawnienia. `revision` jest opaque wartością istniejącego mechanizmu współbieżności — nie wymyślaj kolumny w bazie dla redesignu.

Przykładowy, NIE produkcyjny model DTO:

```json
{
  "config": {"mode":"percent", "parameters":{"percentage":"50"}, "rounding":"none"},
  "catalog": {
    "modes":[{"id":"percent","label":"Procent kwoty zabiegu","fields":[{"key":"percentage","label":"Wysokość zadatku","suffix":"%","hint":"Procent kwoty zabiegu."}]}],
    "roundings":[{"id":"none","label":"Bez zaokrąglenia"},{"id":"five","label":"Do 5 zł"},{"id":"ten","label":"Do 10 zł"}]
  },
  "revision":1,
  "canEdit":true
}
```

Wartości config są serializowalne do JSON. `parameters` jest obiektem, także dla trybów bez parametrów. Identyfikatory `fields[].key` są zaufanymi stałymi kodu i używają tylko liter, cyfr, `_`, `-`. Nie pochodzą z dowolnego tekstu użytkownika. Elementy katalogu wymagają unikalnych ID. Waluta demo PLN: przy innych walutach trzeba podłączyć istniejącą walutę/formater do sufiksu pola i kalkulatora; nie zamieniaj pieniędzy automatycznie.

Obecny renderer parametrów obsługuje pola tekstowe z inputmode=decimal i sufiksem. Jeżeli istniejący tryb ma checkbox, listę, wiele powiązanych pól albo inną strukturę, dostosuj renderer do tych rzeczywistych pól. Nie usuwaj trybu ani parametrów, żeby zmieścić się w DTO demo. Kontroler zachowuje parameters przy zmianie trybu; adapter mapuje je zgodnie z faktycznym kontraktem.

### `validate(config): {valid: boolean, errors: Record<string,string>}`

Synchroniczna walidacja formularza, bez efektów ubocznych. Klucze błędów odpowiadają `fields[].key`, `mode` lub `rounding`. Zwracaj zawsze obiekt `errors`, również pusty. Walidacja serwera nadal obowiązuje. Obsłuż serwerowe błędy pól w docelowym adapterze/kontrolerze zgodnie z istniejącym wzorcem Estelio.

### `preview(config, exampleText): Promise<Preview>`

Wyłącznie odczyt/czyste obliczenie. Wywołanie nie tworzy sprzedaży, wpłat ani nie zapisuje konfiguracji. exampleText jest tekstem z inputu: parser powinien obsługiwać przecinek zgodnie z aplikacją.

```js
// Wynik:
{ available:true, amountText:'97,50 zł', formula:'195,00 zł × 50% = 97,50 zł',
  summary:[['Procent zadatku','50%'],['Zaokrąglenie','Brak']], note:'' }
// Niepoprawne dane / przykład nieobsługiwany:
{ available:false, note:'Wpisz poprawną kwotę przykładu.' }
```

Kontroler opóźnia wywołanie o 220 ms i ignoruje spóźnione odpowiedzi po kolejnej zmianie. Wszystkie teksty są wstawiane przez textContent. Zweryfikuj walidację kwoty po stronie adaptera; kontroler nie zgaduje reguł. Podsumowanie dopasuj do rzeczywistego trybu. Nie podawaj starego wyniku jako aktualnego podczas oczekiwania.

### `save(config, {revision}): Promise<{config, revision}>`

Wyślij tylko istniejące pola konfiguracji salonu, z dotychczasową autoryzacją. Kwota przykładu nie jest argumentem tej metody. Zwróć konfigurację potwierdzoną i znormalizowaną przez serwer. Błędy:

- zwykły błąd: kontroler zostawia draft, udostępnia ponowienie;
- `error.code = 'CONFLICT'`: nie nadpisuj nowszej konfiguracji;
- `error.code = 'UNCERTAIN'`: nie wiadomo, czy zapis dotarł; nie wysyłaj automatycznie ponownie.

Dwa ostatnie przypadki blokują kolejne zapisy do ponownego odczytu. Ponowny odczyt w demo wymaga potwierdzenia zastąpienia draftu. W produkcji użyj istniejącego estetycznego dialogu Estelio; zachowaj możliwość skopiowania/poprawienia draftu według dotychczasowego procesu. Timeout transportowy mapuj na UNCERTAIN, nie na pewne niepowodzenie. Dołącz obsługę wygaśnięcia sesji zgodną z Estelio.

## Scenariusze lokalne

Otwórz index.html; dopisz do adresu:

| Parametr | Zachowanie |
|---|---|
| `?stan=blad-odczytu` | Pierwszy odczyt błędny, ponowienie udane |
| `?stan=blad-zapisu` | Zapis odrzucany, draft zostaje |
| `?stan=timeout` | Niepewny wynik zapisu, wymagany odczyt |
| `?stan=tylko-odczyt` | Konfiguracja widoczna bez możliwości zapisu |
| `?stan=nieznany-tryb` | Odczyt blokuje nieznaną konfigurację zamiast ustawić domyślną |

Zmiana przykładu nie zmienia dirty. Enter w przykładzie nie wysyła formularza. ESC zamyka pomoc. Przed wdrożeniem przetestuj klawiaturę, czytnik ekranu, małe szerokości i routing SPA. Demo nie jest podłączone do sesji ani salonów.
