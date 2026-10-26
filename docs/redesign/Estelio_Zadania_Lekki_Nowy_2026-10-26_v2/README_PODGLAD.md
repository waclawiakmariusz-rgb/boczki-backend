# Interaktywny podgląd HTML/CSS/JS — wersja 2

## Uruchomienie

1. Rozpakuj cały ZIP do jednego folderu.
2. Otwórz `index.html` w aktualnej przeglądarce (Chrome, Edge lub Firefox).
3. Zachowaj `styles.css` i `app.js` obok pliku HTML. Nie trzeba instalować pakietów, uruchamiać Node ani serwera.

Podgląd działa offline. Wszystkie dane są fikcyjne i istnieją tylko w pamięci karty. Odświeżenie lub „Resetuj demo” przywraca stan początkowy. Nie wpisuj danych rzeczywistych klientek w demonstracji. Daty są liczone względem stałego momentu demonstracyjnego: 26.10.2026, 12:00. Dzięki temu przykład ma zawsze 29 zadań, 14 telefonów, 5 po terminie i 4 na dziś.

## Zawartość kodu

| Plik | Rola |
|---|---|
| `index.html` | Struktura widgetu, filtrów, formularza i okien pomocniczych |
| `styles.css` | Tokeny, responsywność, tryb ciemny i stany komponentów |
| `app.js` | Dane demonstracyjne i działające interakcje, bez API |

Dotychczasowe sześć PNG i szczegółowa instrukcja znajdują się w tej samej paczce. Kod to rozszerzenie zamówione po przekazaniu pierwszej wersji. Początkowe zastrzeżenie „bez kodu” w briefie źródłowym nie dotyczy już tego rozszerzenia.

## Co można przetestować

- Wyszukiwanie, Wszystkie/Telefony/Do zrobienia, filtr obszaru, Tylko moje, czyszczenie filtrów i rozwijanie grup.
- Szczegóły zadania, wielokategorie, przypisania, komentarze i historia prób kontaktu.
- Dodawanie oraz edycję zadania, pola dodatkowe, powiązania, priorytet, termin i zachowanie danych podczas edycji.
- Zakończenie i archiwizację zadania, zmianę terminu oddzwonienia, kopiowanie numeru (z ręcznym zaznaczeniem jako alternatywą).
- Wynik Umówiona/Nie odebrała/Nie zainteresowana oraz zmianę przykładowego statusu leada dla dozwolonych przejść.
- Tryb ciemny/jasny, zwijanie widgetu oraz podgląd stanów pustego, błędu i ładowania.
- Obsługę przy szerokościach mobilnych, formularze w natywnych oknach dialogowych, nawigację klawiaturą.

## Granica podglądu i wdrożenia

To samodzielny prototyp frontendu do oceny i przekazania Claude Code. Nie jest modułem gotowym do wklejenia na produkcję. Nie łączy się z Estelio, nie wysyła wiadomości ani nie wykonuje prawdziwych połączeń. „Zadzwoń” pokazuje informację, ponieważ przykładowe numery zaczynające się od 000 są nieoperacyjne. W integracji trzeba podłączyć zweryfikowany numer do `tel:`.

Lista kontaktów to celowo mały lokalny zestaw przykładowy. Produkty są polem demonstracyjnym, nie rzeczywistą wyszukiwarką magazynu. Powtarzanie jest zapisywane jako ustawienie podglądu; nie ma harmonogramu generowania instancji. „Szablony cykliczne” pokazują jeden przykładowy szablon. Nie ma backendu, autoryzacji, prawdziwego terminarza ani tworzenia wizyt.

W podglądzie „Zrobione” od razu usuwa zadanie z aktywnych i aktualizuje liczniki; trzysekundowy stan przejściowy z głównej specyfikacji jest do wykonania w integracji po potwierdzeniu serwera. Demo nie symuluje opóźnień ani awarii zapisu, a przełącznik stanów dotyczy pobierania listy. Filtr obszaru na mobile pozostaje rozwijaną listą zamiast osobnego panelu pod ikoną; jego działanie i rozmiary są dostosowane do 320/400 px.

## Wskazówki dla Claude Code

1. Przeczytaj `WDROZENIE_DLA_CLAUDE_CODE.md`. Jego reguły uprawnień i zachowania danych obowiązują także przy przenoszeniu kodu demonstracji.
2. Wykorzystaj układ i style komponentu; nie zastępuj całego Pulpitu tym plikiem HTML. Pasek „interaktywny podgląd”, przełącznik stanów i reset nie trafiają do produkcji.
3. Zastąp `seed()` i operacje na tablicy rzeczywistą warstwą danych. Dopiero po udanym zapisie serwera aktualizuj stan; uwzględnij błędy, konflikty i blokadę podwójnego zapisu.
4. Sprawdź uprawnienia po stronie serwera, relację salonu, istniejące nazwy pól i zachowaj wielokategorie oraz przypisania. Demo nie implementuje autoryzacji.
5. Zastąp zegar demonstracyjny datą i strefą salonu. Obsłuż daty bez godziny zgodnie z istniejącą semantyką (demo zapisuje wtedy 23:59).
6. Kontakty, magazyn i szablony podłącz do istniejących wyszukiwarek i funkcji. Nie traktuj etykiet tekstowych jako identyfikatorów rekordów.
7. Historia wyników i zmiana statusu leada wymagają spójnego zapisu backendowego. „Umówiona” nadal nie tworzy wizyty.
8. Zachowaj kodowanie wyświetlanych danych użytkownika (`escapeHTML` lub bezpieczne API DOM); nie wstawiaj nieprzefiltrowanych tytułów/opisów do HTML.

Instrukcja wizualna pozostaje punktem odniesienia dla docelowej integracji; opisane powyżej uproszczenia dotyczą wyłącznie lokalnej demonstracji.

## Weryfikacja wykonana dla tej paczki

Sprawdzono lokalny plik HTML w Chromium: zgodność liczników 29/14/15 oraz grup czasu; filtrowanie po drugiej kategorii bez duplikacji; dodawanie komentarzy i bezpieczne wyświetlanie tekstu zawierającego HTML; wyniki Nie odebrała i Umówiona; tworzenie, edycję i zakończenie zadania; zachowanie wielu obszarów i przypisania po edycji; stany pusty/błąd/ładowanie; przełączenie trybu ciemnego. Brak błędów JavaScript w tych scenariuszach. Przy 400 i 320 px sprawdzono szerokość strony i formularza bez poziomego przewijania.

Nie przeprowadzono testów integracji z Estelio ani audytu zgodności WCAG; prototyp nie jest połączony z systemem.
