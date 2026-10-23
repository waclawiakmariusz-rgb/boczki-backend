# Estelio — Kategorie magazynowe — „lekki nowy”

Data: 23.10.2026. Pakiet projektu i wzorca frontendowego do integracji z istniejącym Estelio.

## 1. Gotowe polecenie

Przeprojektuj widok Magazyn → Kategorie według dołączonych makiet i kodu. Zachowaj obecne źródło danych, identyfikatory kategorii, powiązania z produktami, uprawnienia i reguły operacji. Zmień wyłącznie treść tego widoku i potrzebne lokalne komponenty. Nie przebudowuj menu, logo, magazynu produktów, przyjęcia towaru ani innych modułów. Nie wykonuj migracji danych w ramach zmiany wyglądu.

Najpierw ustal działanie obecnych kontrolek w repozytorium. W szczególności sprawdź turkusową strzałkę widoczną na zrzucie. W tym projekcie „Przenieś” jest propozycją uporządkowania zmiany rodzica, a nie potwierdzoną interpretacją tej ikony. Jeśli strzałka wykonuje inną operację, zachowaj ją pod właściwą tekstową etykietą i opisz odstępstwo. Nie zastępuj istniejącej funkcji nową tylko dlatego, że mockup zawiera inne słowo. Jeśli zmiana rodzica nie istnieje, pozostaw jej capability wyłączone i zgłoś ją jako osobne rozszerzenie.

Zakończ raportem, rzeczywistymi wynikami prób i zrzutami z docelowego środowiska testowego. Ta paczka nie jest zgodą na publikację na produkcji.

## 2. Źródła i granice wiedzy

Przejrzano zrzut `image(20261023-145703).png`. Widoczne są: tytuł „Kategorie Magazynowe”, nazwa kategorii, wybór rodzica z opcją kategorii głównej, dodawanie, hierarchiczna lista oraz trzy ikonowe akcje przy wierszach. Formularz i lista zajmują wąski fragment strony, napisy i cele dotykowe są małe, a rozwinięty select powtarza całe ścieżki.

W przekazanych przewodnikach HTML nie znaleziono opisu rozstrzygającego semantykę ikon tego ekranu. Nie przeglądano kodu ani bazy Estelio. Obrazy i dane demo są ilustracją, nie kopią produkcyjnej struktury kategorii.

Przed zmianą sprawdź i zapisz w raporcie:

- komponent widoku, obsługę pobierania i każdego przycisku;
- identyfikatory, sposób przechowywania rodzica i znaczenie poziomu głównego;
- zakres salonu/magazynu, uprawnienia, nagłówki sesji;
- czy lista jest kompletna, stronicowana czy ładowana gałęziami;
- reguły duplikatów, długości nazwy, sortowania i dopuszczalnej głębokości;
- wpływ zmiany nazwy i rodzica na produkty, raporty, filtry i historię;
- warunki usunięcia kategorii z produktami lub podkategoriami;
- obsługę konkurencyjnych zmian, wersji rekordów i ewentualnej idempotencji;
- faktyczny zakres turkusowej ikony — nie wyciągaj wniosku z samego symbolu.

## 3. Docelowy układ

Makieta `01-kategorie-widok.png` pokazuje tylko treść strony, bez menu i powłoki aplikacji. Istniejące menu zachowaj. Widok ma szerokość maksymalną 1180 px treści, marginesy 32 px w dostępnym obszarze po prawej od nawigacji.

Nagłówek: „Kategorie magazynowe”, pod nim „Uporządkuj produkty w kategorie i podkategorie.”. Po prawej dyskretna pomoc „?”. Użyj istniejącego systemu pomocy kontekstowej, jeśli jest dostępny.

Dwie karty: formularz 34%, lista 66%, odstęp 24 px. **Formularz ma wysokość wynikającą z treści, bez rozciągania do wysokości listy.** Na wygenerowanym rastrze lewa karta jest wydłużona; w kodzie celowo usunięto ten pusty obszar. To jawne doprecyzowanie projektu, a nie wymaganie odwzorowania artefaktu graficznego.

Formularz „Dodaj kategorię”:

1. Etykieta „Nazwa kategorii”, placeholder „np. Materiały jednorazowe”.
2. Etykieta „Umieść w”, przycisk wyboru rodzica, domyślnie „Poziom główny”.
3. Krótki opis zależny od wyboru: „Kategoria pojawi się bezpośrednio na liście.” albo „Nowa kategoria będzie podkategorią wskazanej kategorii.”.
4. Główna akcja „Dodaj kategorię”.

Lista „Twoje kategorie”:

- licznik wszystkich kategorii z danych, niezależny od rozwinięcia gałęzi;
- wyszukiwarka nazw i ścieżek;
- „Rozwiń wszystko” / „Zwiń wszystko”;
- drzewo: chevron, ikona folderu, nazwa, liczba bezpośrednich dzieci, menu „⋯”;
- przy liściach brak pozornej strzałki rozwijania;
- lista zagnieżdżona, bez tabeli o wielu kolumnach;
- akcje w tekstowym panelu: „Zmień nazwę”, „Przenieś”, „Usuń”, o ile mają potwierdzone odpowiedniki i uprawnienia.

Licznik 12 w demo oznacza wszystkie rekordy, a 3/4/2 przy gałęziach to liczby bezpośrednich podkategorii. Nie są to liczby produktów. Nie zapisuj tych wartości na stałe.

## 4. Parametry wizualne

| Element | Wartość CSS |
| --- | --- |
| Tło obszaru | `#FAF8F5` |
| Karty i pola | `#FFFFFF` |
| Obramowanie | `#E7E1DE`, 1 px |
| Tekst | `#242126` |
| Opisy | `#67616B` |
| Bordowy akcent | `#842D49`, hover `#70243D` |
| Różowe tło zaznaczenia | `#F8EDF1` |
| Destrukcyjne działanie | `#9B2442` |
| Promień kart / dialogów | 18 px |
| Promień pól / przycisków | 12 px |
| Padding kart | 24 px desktop, 20 px mobile, 16 px przy bardzo wąskiej treści |
| H1 | 28/36 px, 700 |
| H2 | 20/28 px, 600 |
| Nazwy i inputy | 16/24 px |
| Etykiety i opis | 14/20 px |
| Pole / główny przycisk | co najmniej 48 px wysokości |
| Wiersz drzewa | min. 52 px, rośnie przy długiej nazwie |
| „⋯” i zamykanie | cel 44 × 44 px |
| Chevron | cel 32 × 44 px desktop; na małej szerokości 24 × 44 px |
| Fokus | obrys 2 px bordowy, offset 3 px |
| Cień kart | `0 6px 24px rgba(36,33,38,.04)` |

Systemowy sans-serif lub obecny bezszeryfowy font Estelio. Bez reklamowej typografii, emoji-folderów, gradientów, globalnego powiększania całej aplikacji i tekstów pisanych wersalikami. CSS ogranicz do `.est-categories`.

## 5. Wybór kategorii nadrzędnej

Makieta `02-wybor-miejsca.png` jest samodzielnym wzorcem tego komponentu. Pokazuje fragment przykładowej listy; kod wyświetla wszystkie dozwolone kategorie z adaptera.

Dialog maks. 580 px, z wyszukiwarką, przewijaną listą i stopką. Nagłówek „Wybierz miejsce kategorii”. Pierwsza opcja „Poziom główny” z objaśnieniem „Bez kategorii nadrzędnej”. Poniżej grupy według głównych kategorii oraz opcje radiowe z wcięciami. Rodzic sam również jest wybieralną opcją.

Kliknięcie opcji zmienia tylko roboczy wybór. „Wybierz miejsce” przenosi wybór do formularza. „Anuluj”, X i Escape zamykają bez zmiany. To samo dotyczy kliknięcia poza dialogiem. Po zamknięciu fokus wraca do przycisku wyboru.

Wyszukiwanie ignoruje wielkość liter i polskie znaki; przeszukuje również pełną ścieżkę. W wynikach zachowuje przodków, aby identyczne nazwy w różnych gałęziach nie były mylące. Aktualny wybór pozostaje wyświetlony w podsumowaniu, nawet jeśli filtr go ukrywa. Brak wyników nie zmienia zaznaczenia. Wyszukiwanie nie zapisuje nic do serwera.

W normalnym widoku grupowanym nie powtarzaj pełnych ścieżek przy każdym wierszu. Podczas wyszukiwania i przy dużej głębokości pełna ścieżka staje się pomocniczą informacją. Nie ucinaj nazwy do samego wielokropka.

## 6. Interakcje i komplet ścieżek

### Dodawanie

- Nazwa wymagana; pusty tekst i same spacje: „Wpisz nazwę kategorii.”, fokus na polu, brak mutacji.
- Nie dopisuj nowych limitów ani normalizacji bez potwierdzenia w istniejącym kontrakcie. Demo przycina spacje tylko w swoim adapterze.
- Enter w formularzu uruchamia tę samą operację co przycisk. Podczas zapisu blokada podwójnego wysłania i komunikat „Zapisywanie…”.
- Sukces wyłącznie po serwerze. Odśwież drzewo, rozwiń przodków miejsca dodania, wyczyść nazwę i filtr listy. Zachowaj wybranego rodzica, aby wygodnie dodać kilka podkategorii. Fokus wraca do nazwy.
- Błąd: pozostaw nazwę i rodzica, pokaż komunikat przy formularzu. Nie dodawaj fikcyjnego wiersza.
- Gdy wybrany rodzic zniknie: „Wybierz miejsce ponownie”. Nigdy automatycznie nie zapisuj na poziomie głównym.

### Zmiana nazwy

- Oddzielny mały dialog z obecną ścieżką, nazwą i akcjami „Anuluj” / „Zapisz nazwę”.
- Zmienia się tylko nazwa tego rekordu. ID, dzieci i przypisania produktów pozostają zgodne z dotychczasowym modelem.
- Błąd pozostawia tekst. Escape przed wysłaniem anuluje. Po udanym zapisie odśwież widoczne ścieżki.

### Zmiana rodzica / „Przenieś”

- Aktywuj wyłącznie po potwierdzeniu, że istnieje odpowiednia funkcja backendu.
- Ten sam picker, nagłówek „Przenieś kategorię”, opis pokazuje obecną pełną ścieżkę.
- Wyklucz samą kategorię i wszystkich jej potomków z miejsc docelowych. Poziom główny jest dozwolony, jeśli kontrakt to dopuszcza.
- Nie pozwól zapisać identycznego rodzica; wyjaśnij „To obecne miejsce tej kategorii. Wybierz inne.”.
- Przed zatwierdzeniem widać stary kontekst i podsumowanie nowego wyboru. Przycisk „Przenieś kategorię” jest potwierdzeniem; nie dodawaj drugiego identycznego dialogu.
- Przeniesienie rodzica zachowuje relacje jego dzieci. Nie klonuj gałęzi ani produktów.
- Backend musi sprawdzać cykl i uprawnienia na aktualnych danych. Blokada w UI nie wystarcza przy dwóch równoległych sesjach.
- Po sukcesie rozwiń nową ścieżkę, wyczyść filtr i odśwież listę.

### Usunięcie

- Potwierdzenie zawiera pełną ścieżkę, opis rzeczywistego skutku, „Anuluj” i „Usuń kategorię”. Początkowy fokus na „Anuluj”.
- Tekst skutku musi wynikać z kodu. Nie obiecuj, że produkty lub historia pozostają bez zmian, jeśli tego nie zweryfikowano.
- Demo blokuje usunięcie rodzica z dziećmi. To reguła demo, nie ustalenie o Estelio. W produkcji zachowaj istniejącą politykę dla dzieci i przypisanych produktów.
- Nie usuwaj kaskadowo dzieci, nie przenoś produktów automatycznie i nie dodawaj archiwizacji w ramach redesignu.
- Błąd serwera: lista pozostaje, komunikat w dialogu. Nie obchodź ograniczenia przez inny endpoint.
- Po usunięciu odśwież dane; fokus wraca do dostępnego miejsca listy lub jej nagłówka. „Cofnij” tylko jeśli istnieje faktyczny kontrakt odtworzenia — wzorzec go nie dodaje.

### Szukanie i rozwijanie

- Filtr pokazuje dopasowania wraz z przodkami. Informacja „Dopasowania: N” oznacza dopasowane rekordy, bez doliczania przodków pokazanych wyłącznie dla kontekstu.
- Podczas wyszukiwania wymuś rozwinięcie pasujących gałęzi i wyłącz zwijanie. Po wyczyszczeniu wróć do zapamiętanego stanu rozwinięć.
- Stan rozwinięcia istnieje lokalnie w zamontowanym widoku. Bez zapisu preferencji do serwera.
- Głębokie drzewo: ogranicz wizualne wcięcia od czwartego poziomu i dodaj pełną ścieżkę. Nie zmieniaj rzeczywistej hierarchii.
- Panel działań jest przy odpowiednim wierszu; nie wychodzi poza viewport. Zamknięcie przez Escape, kliknięcie poza, przewinięcie lub utratę fokusu. Akcje to zwykłe przyciski, bez niekompletnego ARIA menu.

## 7. Stany, błędy, konkurencja

| Sytuacja | Wymagane zachowanie |
| --- | --- |
| Ładowanie | Komunikat, bez fikcyjnego zera przed odczytem |
| Pusta lista | „Nie ma jeszcze kategorii”, zaproszenie do formularza tylko przy prawie dodawania |
| Brak dopasowania | Osobny komunikat, bez udawania pustej bazy |
| Błąd odczytu | Retry, blokada mutacji; poprzednie dane mogą pozostać wyłącznie z informacją o błędzie |
| Uszkodzona hierarchia | Błąd danych; nie naprawiać automatycznie brakującego rodzica ani usuwać cyklu |
| Zapis trwa | Jeden zapis w obrębie widoku, wyraźny status, brak ponownego Enter/dwukliku |
| Zapis potwierdzony, odświeżenie nieudane | Potwierdzenie operacji oraz osobna informacja o błędzie odczytu; nie oznaczać starej listy jako aktualnej |
| Niepewny wynik sieciowy | Ponowny odczyt, bez automatycznego powtórzenia mutacji |
| Rodzic/rekord usunięty w innej sesji | Odczyt aktualnego stanu i ponowny wybór; bez milczącego ustawienia null |
| Konflikt wersji | Zachowaj robocze dane, pokaż aktualną strukturę; użyj istniejącego kontraktu wersji, jeśli jest |
| Brak uprawnień | Kontrolki zgodne z uprawnieniami i niezależna kontrola backendu |
| Powtarzające się nazwy | Ścieżka i ID odróżniają rekordy; reguła duplikatów według backendu |

## 8. Responsywność i dostępność

Przy szerokości treści co najmniej 960 px są dwie kolumny. Poniżej jedna: formularz przed drzewem. Wymiary odnoszą się do przestrzeni pozostałej po menu Estelio. Przy 320–400 px akcje pozostają dostępne, nazwy zawijają się, a dekoracyjne foldery w drzewie mogą zniknąć. Inputy mają co najmniej 16 px fontu.

Dialog szerokości `min(580px, 100% - 32px)` dla pickera, 460 px dla pozostałych. Wysokość maksymalnie ekran minus 32 px. Lista opcji przewija się; przy małej wysokości może przewijać się również dialog. Stopka jest po liście w normalnym przepływie — musi być osiągalna klawiaturą i dotykiem.

Użyj semantycznego formularza, labeli, list zagnieżdżonych, radio i prawdziwych buttonów. Nie dodawaj `role=tree` bez kompletnej obsługi jego klawiatury. Każdy chevron ma aria-expanded i nazwę gałęzi. Pomoc, menu, dialog i wybór działają dotykiem; hover nie jest wymagany.

Dialogi natywne `<dialog>` zapewniają odcięcie tła i fokus. Jeśli Estelio ma własny komponent, użyj go z równoważnym zachowaniem. Po zamknięciu przywracaj fokus. Podczas zapisu nie pozwól wysłać go ponownie ani zamknąć dialogu w sposób sugerujący anulowanie wykonanego żądania.

Wzorzec pomocy ma dialog, aby działał samodzielnie. W produkcji podłącz istniejącą chmurkę pomocy „lekki nowy”, bez budowania drugiego systemu pomocy. Link szczegółowy tylko do sprawdzonej sekcji; nie ma wymyślonego adresu w demo.

## 9. Integracja plików i adaptera

`index.html` to podgląd do otwarcia po rozpakowaniu ZIP-a. Nie wymaga serwera. `demo.js` i `demo-adapter.js` są wyłącznie demonstracyjne, bez zapisu do Estelio ani localStorage.

W produkcji osadź `kategorie.fragment.html`, załaduj lokalnie `kategorie.css`, potem `kategorie-model.js` i `kategorie.js`. Nie wstawiaj drugiego body ani stylów powłoki z index.html do aplikacji. Możesz przenieść wzorzec do obecnego frameworka, zachowując wynik użytkowy.

```js
const view = EstelioCategories.mount(container, {
  adapter: existingCategoryAdapter,
  permissions: verifiedCategoryPermissions,
  removalDescription: verifiedRemovalDescription,
  helpUrl: verifiedHelpSection
});
await view.ready;
// Przy odmontowaniu widoku: view.destroy();
```

Powyższe nazwy oznaczają warstwę integracji, nie istniejące API. Domyślnie wszystkie prawa mutacji są false. Adapter i opis skutku usunięcia są obowiązkowe, jeśli włączasz daną akcję.

| Metoda | Kontrakt wzorca |
| --- | --- |
| `list()` | Promise pełnej tablicy `{id: string, name: string, parentId: string|null, permissions?: {rename,move,remove}}` |
| `create({name,parentId})` | Promise potwierdzonego zapisu |
| `rename({id,name})` | Promise potwierdzonej zmiany nazwy |
| `move({id,parentId})` | Promise potwierdzonej zmiany rodzica |
| `remove({id})` | Promise potwierdzonej obecnej operacji usuwania |
| `permissions` | `{create,rename,move,remove}` — wyłącznie jawne true włącza funkcję |
| `removalDescription` | Zweryfikowane objaśnienie rzeczywistego skutku, wymagane dla remove |
| `helpUrl` | Zweryfikowany http/https URL pomocy; pusty ukrywa link |

Adapter mapuje istniejące identyfikatory na stabilne stringi w UI i z powrotem do typu oczekiwanego przez backend. null oznacza poziom główny tylko w kontrakcie wzorca — w bazie zachowaj obecną reprezentację. Nie używaj nazwy lub pozycji na liście jako ID.

Jeśli API ładuje gałęzie leniwie lub stronicuje, dostosuj model do tego kontraktu zamiast udawać kompletną listę. Nie licz wszystkich dzieci na podstawie niepełnego wyniku. Wzorzec nie jest mechanizmem wirtualizacji tysięcy wierszy.

Opcjonalne kody błędów adaptera: DUPLICATE, LINKED, HAS_CHILDREN, CYCLE, NOT_FOUND, FORBIDDEN, STALE. Mapuj rzeczywiste odpowiedzi, nie wymyślaj ich po samym HTTP statusie. Wygasłą sesję obsłuż istniejącym mechanizmem Estelio. Sukces fetch nie oznacza udanego zapisu — sprawdź odpowiedź.

Nie dodawaj nowych ograniczeń biznesowych tylko dlatego, że demo ma regułę unikalności nazw wśród rodzeństwa lub blokuje rodziców z dziećmi. Backend pozostaje źródłem prawdy. Nazwy renderuj jako tekst; wzorzec nie wstrzykuje ich przez innerHTML.

## 10. Scenariusze demo

Otwórz index.html z parametrem `?stan=pusty`, `?stan=blad-listy`, `?stan=blad-zapisu`, `?stan=blokada`, `?stan=podglad` lub `?stan=glebokie`. Bez parametru: 12 przykładowych kategorii. Odświeżenie resetuje dane.

## 11. Odbiór w Estelio

| ID | Próba | Oczekiwany wynik |
| --- | --- | --- |
| KAT01 | Desktop 1440/1280, tablet 800×550 | Czytelne karty, akcje przy wierszu, menu w ekranie |
| KAT02 | 400/320 px i zoom 200% | Brak przewijania całej strony poziomo; wszystkie akcje dostępne |
| KAT03 | Kategoria główna i podkategoria | Poprawne miejsce i istniejący kontrakt zapisu |
| KAT04 | Pusta nazwa, Enter, dwuklik | Jeden zapis lub błąd pola bez mutacji |
| KAT05 | Ta sama nazwa w różnych gałęziach | Czytelna ścieżka; zasady duplikatów zgodne z produkcją |
| KAT06 | Picker: filtr, zaznaczenie, anuluj | Roboczy wybór niezapisany bez potwierdzenia |
| KAT07 | Przenieś do siebie/potomka | Blokada UI i backendu; brak cyklu |
| KAT08 | Przeniesienie rodzica | Zachowane ID, dzieci i produkty zgodnie z obecną funkcją |
| KAT09 | Zmiana nazwy | Ścieżki zaktualizowane, bez utraty powiązań |
| KAT10 | Usuń: anuluj, liść, rodzic, produkty | Istniejące reguły backendu; dokładny opis skutku |
| KAT11 | Błąd API/utrata łączności | Zachowane dane formularza, brak pozornego sukcesu |
| KAT12 | Rodzic zmieniony/usunięty w innej sesji | Ponowna walidacja, bez milczącego przeklasyfikowania |
| KAT13 | Pusta/błędna lista, brak dopasowania | Rozróżnione stany i działające retry |
| KAT14 | Klawiatura, dotyk, czytnik | Fokus, dialogi, rozwijanie, radio i menu dostępne |
| KAT15 | Role i inny salon | Obecne ograniczenia dostępu zachowane |
| KAT16 | Regresja magazynu i sąsiednich stron | Produkty nadal przypisane prawidłowo; CSS nie wycieka |

Raport końcowy: pliki zmienione, mapowanie starych ikon, kontrakty i reguły potwierdzone w kodzie, wyniki KAT01–KAT16 jako PASS/FAIL/NIE WYKONANO, zrzuty desktop/mobile/dialogu, różnice względem projektu. Nie oznaczaj odbioru produkcyjnego na podstawie testów demo.
