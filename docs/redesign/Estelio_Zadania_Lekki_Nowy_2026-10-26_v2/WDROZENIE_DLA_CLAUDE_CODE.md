# Estelio — Zadania na Pulpicie, „lekki nowy”

Wersja 2 · 26.10.2026 · projekt do wdrożenia przez Claude Code.

## 1. Cel i zakres

Recepcja po otwarciu Pulpitu widzi wspólną listę aktywnych zadań, rozpoznaje telefony i najpilniejsze terminy. Zamiast siedmiu zakładek: trzy rozłączne rodzaje widoku, niezależny filtr obszaru oraz przypisania. Nie przebudowujemy menu, pozostałych kafli Pulpitu, karty klientki ani modułu Leady.

Pakiet zawiera grafiki, specyfikację oraz zamówiony dodatkowo prototyp HTML/CSS/JS. Uruchomienie i granice prototypu opisuje `README_PODGLAD.md`. Nie stanowi zgody na wdrożenie produkcyjne. Dane na makietach są przykładowe; numery 000 000 101/102 są celowo nieoperacyjne. Nie kopiować danych ze screenshotów źródłowych. Screenshoty nie zostały dołączone do paczki.

Opis stanu istniejącego pochodzi z dostarczonego briefu Claude Code; autor tej specyfikacji nie weryfikował repozytorium ani bazy. Nazwy nowych pól poniżej są nazwami roboczymi, nie stwierdzeniem o aktualnym schemacie.

## 2. Makiety i ich rola

| Plik w makiety/ | Zawartość |
|---|---|
| 01-widget-wszystkie.png | Główny widok, cztery grupy czasu, 5 przykładowych wierszy |
| 02-widget-telefony-wynik.png | Telefony, szczegóły, wynik „Nie odebrała”, kolejny kontakt |
| 03-nowe-zadanie.png | Telefon, 6 podstawowych grup pól |
| 04-widget-mobile-400.png | Rzeczywista szerokość 400 px; bez ramy urządzenia |
| 05-stany-widgetu.png | Pusty, brak moich zadań, błąd, ładowanie — plansza czterech stanów |
| 06-widget-ciemny.png | Ten sam widok główny w trybie ciemnym |

Desktop i plansza stanów: 1536×1024. Mobile: 400×1024 — celowy wyjątek od formatu planszy desktopowej. To statyczne wycinki interfejsu, a nie deklaracja sztywnej wysokości komponentu. Wszystkie grupy i kolejne wiersze mają być dostępne w aplikacji. Na makiecie ograniczamy liczbę wierszy, by pokazać wszystkie typy.

## 3. Rozstrzygnięcia niespójności briefu

1. **Nie redukuj wielokategorii do jednej kategorii w danych.** Wiersz pokazuje pierwszy obszar i „+N”. Kliknięcie „+N” lub tytułu otwiera szczegóły ze wszystkimi obszarami. Nowy formularz nadal pozwala wybrać wiele. Filtr dopasowuje każdy przypisany obszar. Kolejność prezentacji: Klient, Magazyn, Kosmetyk, Sprzedaż, Inne. Nie dodajemy nowego pojęcia „główna kategoria”.
2. **Sześć podstawowych grup formularza:** rodzaj, tytuł, klientka/lead, numer, termin, obszary. Termin to jedna grupa z datą i godziną. Przypisania, priorytet, opis, cykliczność i produkty są w „Więcej”. Nie usuwamy pól. Dla „Do zrobienia” znika numer, a istniejące powiązania klientek są w „Więcej”.
3. **29/14/15 to spójny zestaw demonstracyjny.** Różnica wobec 31 widocznych na późniejszych screenshotach nie jest błędem do naprawienia w danych. W produkcji wszystkie liczniki pochodzą z aktualnych uprawnionych danych.
4. **Brak ukrytych kategorii nie oznacza renderowania całej bazy na raz.** Domyślny zakres to wszystkie aktywne zadania dostępne osobie. Limit wierszy ma jawny licznik i przycisk rozwinięcia. Nigdy nie otwieramy automatycznie najliczniejszego obszaru.
5. Integracja z leadem i wynik rozmowy to nowa logika, nie kosmetyczny redesign. Należy ją wdrożyć i przetestować osobno od warstwy prezentacyjnej.

## 4. Hierarchia i układ

Jedna karta zastępuje obecny zewnętrzny nagłówek „Zadania zespołu” i wewnętrzny baner. Nie powielać wyszukiwarki, liczników ani przycisku dodawania. W obrębie istniejącego miejsca na Pulpicie zachować otaczające moduły.

Desktop: karta 100% dostępnej szerokości, padding 28 px, radius 18 px. Na planszy ma x=48, szerokość 1440 px. Nagłówek: ikona celu 46 px, tytuł 20/28 semibold, podsumowanie 13/19; po prawej szablony, nowe zadanie, zwijanie. Niżej separator i pasek filtrów. Odstępy 8/12/16/24/28 px. Wiersze min. 94 px, wysokość automatyczna przy długich tekstach. Ikona rodzaju 40 px, tytuł 15/22 semibold, metadane 12–13/18–19. Akcje w osobnej kolumnie, nigdy nałożone na tytuł.

„Zrobione” jest akcją wykonania wiersza; burgundowe pełne wypełnienie zostawiamy dla „Nowe zadanie” oraz zapisu. „Zadzwoń” jest osobną, wyraźną akcją z numerem. Brak emoji i gradientów; ikony liniowe 18–20 px. Zastąpić techniczne symbole użyte na makietach ikonami używanego w projekcie zestawu, bez instalowania nowego zestawu wyłącznie dla tego widgetu.

Tytuł wiersza jest przyciskiem otwierającym szczegóły. Komentarze, obszary i przypisania są dostępne tam; licznik komentarzy jest osobnym linkiem otwierającym sekcję komentarzy. Wiersz z leadem ma dodatkową linię metadanych; wysokość może wzrosnąć. Nie zmniejszać tekstu poniżej 12 px, aby mieścić dłuższe dane.

W widoku produkcyjnym początkowo maksymalnie 4 wiersze na każdą grupę, w spójnym porządku. „Pokaż pozostałe N” rozwija następne wyniki w tej grupie, bez znikania już widocznych. Po rozwinięciu dostępne „Zwiń listę”. Na planszach liczby widocznych wierszy są mniejsze wyłącznie dla zilustrowania wariantów. Żadna grupa nie znika z powodu wyboru obszaru domyślnego.

## 5. Liczniki, filtry i czas

- Wszystkie, Telefony, Do zrobienia: pojedynczy wybór. Każde zadanie należy dokładnie do jednego rodzaju. Wszystkie = Telefony + Do zrobienia.
- Liczymy unikatowe ID zadań, nigdy wiersze złączenia kategorii/osób. Szablony cykliczne nie wchodzą do liczby aktywnych instancji.
- Nagłówek na makietach pokazuje globalny zakres zadań dostępnych osobie; pod nim opis aktualnego widoku. Przy ograniczeniach dodatkowych wyświetlić jawnie np. „Moje · Klient · 3 z 29 zadań”.
- Liczniki segmentów stosują wyszukiwanie, obszar i „Tylko moje”, ale nie wybór rodzaju. Dzięki temu nadal się sumują. Liczniki grup czasu stosują wszystkie aktualne filtry.
- Filtry łączą się przez AND. Obszar ma opcje Wszystkie, Klient, Magazyn, Kosmetyk, Sprzedaż, Inne. Zadanie z dwiema kategoriami pojawia się raz.
- „Tylko moje” oznacza przypisanie do bieżącej osoby, nie autorstwo. Nieprzypisane zadanie nie należy do „moich”; nadal widać je w zespole. Nie używać autora jako zastępczego przypisania.
- Nowe otwarcie Pulpitu: Wszystkie, Tylko moje wyłączone, wszystkie obszary, puste wyszukiwanie. W trakcie pracy zachować filtry przy otwarciu/zamknięciu szczegółów. Zapewnić „Wyczyść filtry”.
- Wyszukiwanie obejmuje tytuł i uprawnione dane powiązanego kontaktu/numer. Opóźnienie ok. 250 ms; odpowiedź starego zapytania nie zastępuje nowszej.
- Grupowanie jest rozłączne: Po terminie, Na dziś, Zaplanowane, Bez terminu. Najpierw ocena przeterminowania, potem daty dnia. Termin z dzisiaj, którego godzina minęła, trafia do Po terminie.
- Wszystkie daty liczyć w skonfigurowanej strefie salonu; potwierdzić jej źródło w repo. Nie uzależniać od przypadkowej strefy urządzenia. Zadanie z samą datą staje się przeterminowane po zakończeniu tego dnia, jeśli taki model wspiera obecny backend; nie zmieniać semantyki po cichu.
- W grupach sortowanie po terminie rosnąco, przy remisie priorytet malejąco, potem stabilne ID. Bez terminu: priorytet i data utworzenia. Priorytet ma etykietę, nie sam kolor.

## 6. Telefon i wynik rozmowy

### Numer i powiązania

Telefon ma wybrany kontakt do tej rozmowy: klientkę albo lead, lub sam ręcznie wpisany numer. Istniejące dodatkowe powiązania z klientkami nie są kasowane. Przy kilku powiązanych osobach nie wybierać odbiorcy arbitralnie. Użytkownik wskazuje adresata rozmowy.

Numer z karty uzupełnia formularz, a jego ręczna zmiana dotyczy tylko zadania; nie aktualizuje automatycznie kart klientki/leada. Brak numeru nie uniemożliwia zachowania zadania — pokaż „Brak numeru — dodaj” oraz informację w formularzu. Nie twórz pustego linku tel. Wybranie numeru nie oznacza udanej rozmowy.

„Zadzwoń” otwiera tel: z numerem znormalizowanym na potrzeby wybierania. Numer pozostaje czytelny w lokalnym formacie. „Kopiuj numer” jest w menu wiersza; brak aplikacji telefonicznej na desktopie nie powoduje automatycznego zakończenia zadania. Nie zmieniać znaczenia tego samego przycisku losowo między kopiowaniem i dzwonieniem.

### Oddzwonić później

Menu: „Dziś za 2 godziny”, „Jutro o 10:00”, „Wybierz termin”. Pierwsza opcja pokazuje wyliczoną datę/godzinę; jeśli wypada jutro, użyj „Za 2 godziny” z datą. Wybór zmienia termin tego zadania, zachowuje aktywność i zapisuje zmianę w historii. Nie zmienia całego szablonu cyklicznego. Akcja nie nadaje wyniku rozmowy.

### Zapisz wynik rozmowy

W szczegółach widoczny panel wyniku (jak plansza 02). Opcja „Zapisz wynik rozmowy” dostępna również w menu wiersza, aby była łatwa do odkrycia. Trzy stałe opcje w pierwszej wersji; nie budować konfiguratora wyników.

| Wynik | Zadanie | Lead powiązany |
|---|---|---|
| Umówiona | Zakończone po zapisie | Proponowana zmiana nowy/kontakt → umówiony |
| Nie odebrała | Nadal aktywne; zapisz wskazany kolejny termin | Bez zmiany statusu; zapisz próbę kontaktu |
| Nie zainteresowana | Zakończone po zapisie | Proponowana zmiana nowy/kontakt → odrzucony |

Wynik „Umówiona” nie tworzy wizyty ani nie rezerwuje terminu. Nie zmieniać już istniejącego statusu „klient”, „umówiony” lub „odrzucony” bez jawnego rozstrzygnięcia użytkownika; pokaż aktualny status i dopuszczoną akcję zgodną z uprawnieniami. Dla klientki wynik nie zmienia statusu jej karty.

„Nie odebrała” proponuje Jutro 10:00, ale nic nie zapisuje bez zatwierdzenia. Użytkownik może wybrać inny termin lub zachować dotychczasowy. Podpis przed zapisem mówi, co stanie się z zadaniem i leadem. „Zapisz i zamknij” zamyka panel szczegółów, a nie zawsze zadanie. Rozważyć pomocniczy opis „Zadanie pozostanie aktywne” jak na makiecie.

Notatka opcjonalna, wynik wymagany przy zapisie wyniku. Historia przechowuje autora i czas z serwera. Powtórzony klik nie tworzy duplikatu. Zapis zadania i powiązanego statusu leada musi być spójny; przy błędzie nie pokazuj pełnego sukcesu. Backend sprawdza uprawnienia do obu obiektów i wspólny salon. Powiązania z leadem nie wyprowadzać automatycznie z tekstu „Lead 104”.

Zwykłe „Zrobione” zachowuje dotychczasowe znaczenie; nie wnioskuje wyniku rozmowy ani nie zmienia statusu leada.

## 7. Formularz i zachowanie istniejących danych

Domyślnie nowy formularz otwiera „Do zrobienia”; w widoku Telefony może otwierać „Telefon”. Plansza 03 pokazuje wariant telefonu. Tytuł wymagany, biały tekst placeholdera nie zastępuje etykiety. Numer opcjonalny, podany numer walidowany. Kontakt opcjonalny, ale jeżeli wybrano lead/klientkę, zachować identyfikator powiązania. Nazwa nie jest kluczem.

Obszary: multi-select z pięcioma opcjami i znacznikami. Nowy Telefon proponuje Klient, Do zrobienia proponuje Inne. Wybranie leada może zaproponować Sprzedaż, nie nadpisuje jednak świadomego wyboru użytkownika. Przełączenie rodzaju nie kasuje opisów, komentarzy, kategorii, osób ani relacji. Ukryte wartości pozostają zachowane; przed zapisem pokazać, które powiązania zostaną utrzymane.

„Więcej” rozwija pola w kolejności: przypisane osoby (wiele), priorytet Normalny/Ważny/Pilny, opis, dodatkowe klientki, produkty magazynu (wiele), powtarzanie. Link sekcji sygnalizuje liczbę ustawionych osób i aktywną cykliczność. Edycja zadania otwiera sekcję, jeżeli ma wartości, których ukrycie groziłoby przeoczeniem. Komentarze pozostają w szczegółach istniejącego zadania; po utworzeniu można je dodawać jak dotychczas.

Szybkie terminy: Dziś 16:00, Jutro 10:00, Za tydzień. Dziś 16:00 niedostępne z wyjaśnieniem, jeśli godzina minęła. Za tydzień oznacza 7 dni kalendarzowych z zachowaniem wybranej godziny; gdy brak godziny — 10:00. Datę/godzinę można wyczyścić, uzyskując Bez terminu. Nie ustawiać terminu bez wiedzy użytkownika.

Anuluj/Escape: przy zmianach zapytanie o odrzucenie. Zapis: blokada duplikacji, spinner w przycisku, wartości zachowane przy błędzie. Błąd pola pod etykietą, fokus na pierwszym błędzie. Modal ma przewijane wnętrze i dostępną stopkę; nie wymaga 1024 px wysokości ekranu.

## 8. Mapowanie na dotychczasowe funkcje

| Element | Pochodzenie według briefu | Zmiana |
|---|---|---|
| Tytuł, opis, priorytet, termin | Istniejące pola | Nowy układ, bez utraty wartości |
| Obszary | MAGAZYN, KOSMETYK, KLIENT, SPRZEDAZ, INNE i tabela wielokategorii | Zachować relację; chip +N i filtr |
| Przypisane osoby | Istniejąca relacja wielu osób | Źródło „Tylko moje” |
| Autor | Istniejące utworzone przez | Nie używać do „Tylko moje”; pozostaje w szczegółach |
| Zrobione, edycja, archiwizacja | Istniejące akcje | Zachować autoryzację; edycja/archiwizacja w menu |
| Komentarze | Istniejące | Licznik i dostęp w szczegółach, niczego nie kasować |
| Klientki, produkty | Istniejące relacje | Zachować wielokrotność; dodatkowe w „Więcej” |
| Cykliczność | Istniejące szablony | Link „Szablony cykliczne (N)”; mobile menu widgetu |
| Rodzaj czynności | Nowe | Roboczo TELEFON / DO_ZROBIENIA |
| Kontakt do rozmowy i numer | Nowe dla zadania | Jawny adresat, numer zadania, brak automatycznej edycji karty |
| Relacja lead–zadanie | Nowe | Jawne ID; link do istniejącego modułu bez jego przebudowy |
| Wynik/próby kontaktu | Nowe | Historia wyniku, notatki, czasu, autora i kolejnego terminu |

Przed wdrożeniem Claude Code ma potwierdzić konkretne nazwy plików, endpointów i relacji w repozytorium. Nie tworzyć alternatywnego systemu komentarzy lub przypisań, jeżeli można rozszerzyć istniejący.

Migracja: nie rozpoznawać telefonów wyłącznie po tytule i nie tworzyć relacji leadów po cyfrach. Stare rekordy mają bezpiecznie zachowane dane oraz domyślny rodzaj Do zrobienia do momentu jawnej klasyfikacji. Przed uruchomieniem przygotować listę kandydatów do oznaczenia jako Telefon do przeglądu właściciela; nie dodawać trzeciej kategorii „Nieznane”. Liczniki muszą uczciwie odzwierciedlać zatwierdzoną klasyfikację, nie przykładowe 14 telefonów z grafiki.

## 9. Responsywność

- Powyżej 1200 px: układ z plansz desktopowych. Przy długich tytułach zwiększyć wysokość; akcje nie wypychają metadanych poza kartę.
- 768–1199 px: nagłówek i pasek filtrów w dwóch rzędach; wyszukiwanie może zajmować osobny rząd; akcje poniżej metadanych. Bez poziomego przewijania.
- Poniżej 768 px: układ pionowy jak plansza 04. Padding 16 px wewnątrz karty, odstęp do krawędzi 8–16 px. Segmenty w jednym rzędzie, na 400 px: Wszystkie/Telefony/Zrobić z licznikami. Przy 320 px skrócić etykietę „Wszystkie” do „Wszystko”, nie ukrywać liczb.
- Filtr obszaru w panelu otwieranym ikoną „Filtry”; aktywny filtr ma badge i tekst nad listą. Szablony i zwijanie w menu widgetu, przycisk nowe zadanie zawsze widoczny.
- Numer ma duży przycisk Zadzwoń; Zrobione pełnej szerokości. Nie stosować swipe jako jedynego sposobu wykonania. Menu i oddzwanianie mają obszary trafienia min. 44×44 px, również gdy tekst wizualnie wygląda jak link.
- Szczegóły i wynik rozmowy układają się pionowo. Formularz na mobile zajmuje całą dostępną szerokość; stopka nie zasłania pól ani klawiatury.

## 10. Tokeny wizualne

| Token | Jasny | Ciemny |
|---|---|---|
| Tło | #FAF8F5 | #19171C |
| Karta/pole | #FFFFFF | #242127 |
| Obramowanie | #E7E1DE | #49414B |
| Obramowanie pola | #D9D4D8 | #746A78 |
| Tekst | #242126 | #F5F0F3 |
| Muted | #67616B | #BEB5C1 |
| Akcent | #842D49 | #F0AEC6 |
| Hover akcentu | #70243D | #F6C6D8 |
| Akcent tło | #F8EDF1 | #412B36 |
| Tekst na pełnym akcencie | #FFFFFF | #242126 |
| Po terminie/błąd | #A52540 | #FFADB9 |

Obszary jasne (tło/tekst): Klient #F8EDF1/#78334D; Magazyn #EAF0F5/#435C72; Kosmetyk #F3ECE5/#72543C; Sprzedaż #EEEAF5/#655077; Inne #F0EEF1/#62586B. W ciemnym zastosować wspólną neutralną powierzchnię #412B36 i jasną etykietę #F0AEC6 — nazwa, nie kolor, niesie znaczenie. Brak zielonych/żółtych wypełnień.

Font aplikacji/system sans; makiety używają DejaVu Sans jako technicznego zastępstwa. Nie wdrażać nowego fontu wyłącznie z powodu PNG. Tytuł 20/28 semibold; tekst zadania 15/22; etykiety 14/20 medium; hint 13/19; metadane min. 12/18. Radius karty 18, wiersza 12, kontrolki 10, chipu 7. Cień w jasnym opcjonalnie 0 4px 18px rgba(45,30,35,.04); ciemny bez mocnego cienia.

## 11. Stany, uprawnienia i dostępność

- Pusto globalnie: „Brak aktywnych zadań”, „Wszystkie zadania są zrobione”, nowe zadanie jeśli uprawnienia pozwalają.
- Pusto dla Moje: „Nie masz przypisanych zadań” i „Pokaż zadania zespołu” wyłączające toggle. Liczba zespołu tylko w granicach uprawnień.
- Brak wyników filtrów: „Brak zadań dla tych filtrów” i „Wyczyść filtry”. Nie sugerować, że salon nie ma zadań.
- Loading: neutralny skeleton, bez chwilowego komunikatu „0 zadań”, aria-busy. Bez migania i bez intensywnej animacji.
- Błąd pobierania: tekst oraz Spróbuj ponownie. Przy odświeżeniu zachować ostatni widok z oznaczeniem nieaktualności; nie udawać aktualnych liczników.
- Zakończenie: po sukcesie serwera wiersz zostaje przekreślony przez 3 s, następnie znika; fokus przenosi się przewidywalnie na następny wiersz lub nagłówek grupy. Aktualizacja liczników od razu po potwierdzeniu. Bez pozornego „Cofnij”, jeśli backend nie obsługuje przywrócenia.
- Błąd zapisu/konflikt: pozostawić dane i wiersz, wyświetlić komunikat, umożliwić ponowienie lub odświeżenie. Nie giną notatki.
- Archiwizacja oddzielna od Zrobione, w menu i z potwierdzeniem. Brak uprawnienia do edycji/archiwizacji nie powinien zabierać uprawnionej akcji wykonania. Dokładną macierz zachować z backendu, nie wyprowadzać wyłącznie z widoczności przycisków.
- Osoba nie ma prawa do powiązanego leada: nie ujawniać jego danych ani pozwalać na aktualizację przez zadanie. Przycisk nowego zadania i szablonów również respektuje uprawnienia.
- Segmenty oraz rodzaj: grupa radio, strzałki zmieniają wybór. Tylko moje: switch z nazwą. Obszary: dostępny wielokrotny wybór w formularzu, pojedynczy filtr na liście.
- Wszystkie akcje mają nazwy dostępne, także menu wiersza, zwijanie, filtr, telefon. Ikony dekoracyjne ukryte przed czytnikiem. Liczniki i stan zakończenia ogłaszane spokojnie, bez utraty fokusu.
- Fokus 2 px akcentu z odsunięciem 2 px. W modalu poprawny focus trap i powrót do otwierającego przycisku. Escape zamyka najbliższy panel z zachowaniem ochrony niezapisanych zmian.
- Kontrast tekstu min. 4,5:1, ważnych granic kontrolek/stanu fokusu 3:1. Pastelowe obramowania na makietach są dekoracyjne; w implementacji istotne granice pól i elementów bez innego wyróżnienia należy wzmocnić. Test klawiaturą, powiększenie 200%, reduced motion; nie traktować PNG jako dowodu zgodności WCAG.

## 12. Kolejność wdrożenia i odbiór

1. Sprawdzić repo, macierz uprawnień i sposób liczenia czasu. Oddzielić potwierdzone fakty od założeń briefu.
2. Wdrożyć wspólny widok, filtry, wielokategorie, Tylko moje i nowy układ bez utraty funkcji.
3. Dodać rodzaj, numer i świadomie wybrany kontakt. Przygotować bezpieczną klasyfikację istniejących zadań.
4. Dodać historię wyników i powiązanie z leadem. Bez tej logiki nie pokazywać martwych przycisków sugerujących gotową integrację.
5. Sprawdzić syntetyczne dane oraz zgodność wizualną w środowisku testowym. Przed publikacją przedstawić zakres zmian i wyniki weryfikacji.

Kryteria odbioru:

- Po otwarciu widoczne Wszystkie; brak automatycznej zakładki Inne/Sprzedaż.
- 29 = 14 + 15; grupy czasu 5 + 4 + 12 + 8 = 29 w danych demonstracyjnych. Dla telefonów 3 + 2 + 6 + 3 = 14. Nie sumować „14 telefonów” i „5 po terminie” — to przecinające się osie.
- Wielokategoria i wielu przypisanych nie dublują wierszy ani liczników; filtrowanie po drugiej kategorii działa.
- Własne autorstwo bez przypisania nie kwalifikuje do Tylko moje; cudze autorstwo z przypisaniem kwalifikuje.
- Odczyt liczby zadań, telefonów i zaległych jest możliwy bez otwierania filtrów; pełna lista jest osiągalna przez jawne rozwinięcie.
- Telefon bez numeru ma Dodaj; kliknięcie numeru nigdy samo nie kończy zadania.
- Nie odebrała zachowuje aktywność i nie oznacza leada jako odrzuconego. Umówiona nie tworzy automatycznie wizyty. Podwójny zapis nie dubluje historii.
- Zwykłe Zrobione nie zmienia statusu leada. Awaria zapisu nie usuwa zadania z listy i nie gubi notatki.
- Sześć podstawowych grup formularza, wszystkie dotychczasowe pola nadal osiągalne; edycja nie usuwa schowanych relacji.
- Widok 400 i 320 px bez poziomego przewijania; duże treści i nazwy nie nakładają się na akcje.
- Stany pusty, brak moich, brak wyników, błąd, ładowanie i po terminie mają właściwe komunikaty.
- Klawiatura, czytnik, kontrast, 200% zoom i oba motywy sprawdzone w działającej aplikacji.
- Backend blokuje odczyt/modyfikacje cudzego salonu oraz niedozwoloną zmianę leada; testy na danych syntetycznych.
- Zachowane komentarze, wszystkie kategorie, przypisania, cykliczność, klientki i produkty; menu/Pulpit poza zadaniami bez redesignu.

Otwarte pytania z briefu rozstrzygnięte: szablony jako link w nagłówku wystarczą dla widgetu (istniejący pełny moduł pozostaje); wyniki na razie trzy stałe; Nie odebrała proponuje kolejny kontakt, ale bez automatycznego zapisu. To decyzje projektowe, które można skorygować przed implementacją.
