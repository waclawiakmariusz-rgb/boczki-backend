# Estelio — pomoc kontekstowa „lekki nowy”

Specyfikacja dla Claude Code • 22.10.2026 • zakres: wspólny komponent pomocy i jego treści.

## 1. Polecenie do wykonania

Dodaj do istniejących widoków Estelio dyskretny przycisk „?”, który otwiera krótką pomoc dotyczącą aktualnej strony, zakładki, formularza albo kroku kreatora. Odtwórz komponent z makiet w tej paczce. Treści opracuj z dokumentacji i obecnego kodu. Właściciel nie ma ręcznie pisać podpowiedzi ani przekazywać listy wszystkich ekranów.

**Makiety przedstawiają wyłącznie komponent pomocy. Nie są zleceniem przeprojektowania magazynu, profilu klientki, formularzy, nawigacji ani pozostałych ekranów.** Nie kopiuj do aplikacji tła plansz, numerów makiet ani podpisów specyfikacyjnych. Nie zmieniaj istniejących procesów biznesowych, zapisów, walidacji, uprawnień czy działania dodatków.

Pracuj w obecnej architekturze projektu. Nie wprowadzaj nowego frameworka, chatbota, płatnego API AI ani nowej usługi backendowej wyłącznie na potrzeby tej funkcji. Przygotuj zmianę do przeglądu w zwykłym procesie projektu; ta specyfikacja nie jest poleceniem publikacji na produkcji.

## 2. Co zawiera paczka i jakie są granice wiedzy

- `makiety/01-chmurka-formularza.png`: główny wzorzec, pojedyncza chmurka z wyróżnioną wskazówką.
- `makiety/02-przycisk-lista-mobile.png`: stany przycisku, wariant z listą i wariant o mniejszej szerokości.
- `zrodla/przewodnik-pracownik-2026-06-08.html` i `zrodla/przewodnik-manager-2026-06-08.html`: dostarczone przewodniki źródłowe, zachowane jako materiały historyczne.
- `INDEKS_ZRODEL.csv`: automatycznie wyodrębnione nagłówki, istniejące identyfikatory i powiązane sekcje tych przewodników. To indeks dokumentacji, nie lista aktualnych widoków aplikacji.

Nie wykonano tu inspekcji obecnego repozytorium ani aktualnego systemu produkcyjnego. Nazwy identyfikatorów komponentu poniżej są propozycją, nie stwierdzeniem, że istnieją w kodzie. Obrazy są makietami, nie gotowym HTML ani dowodem działania. W razie niedokładności rasteryzacji obowiązują parametry i reguły tego dokumentu.

## 3. Skąd wziąć treści — automatycznie, ale z dowodami

### 3.1. Najpierw rozpoznaj aplikację

Odczytaj instrukcje repozytorium. Znajdź istniejący mechanizm pomocy, routingu, zakładek, modali, uprawnień, aktywacji dodatków i wspólnych nagłówków. Wyszukaj definicje tras oraz miejsca otwierania formularzy i paneli, nie tylko pozycje w menu. W aplikacji bez routera wykorzystaj stabilne identyfikatory widoków i ich kontrolery.

Przygotuj `POMOC_MAPA_WIDOKOW.csv`: identyfikator kontekstu, ścieżka i symbol w kodzie, widok nadrzędny, tytuł, rola/uprawnienie, wymagany dodatek, element kotwiczący przycisk, źródło dokumentacyjne, docelowy link, status weryfikacji. Obejmij również widoki ukryte za akcją, puste stany, edycję, szczegóły i kroki kreatorów. Pomoc nie musi być przy każdym polu lub wierszu tabeli; ma być dostępna dla każdego sensownego kontekstu pracy.

### 3.2. Źródła i ich rola

| Źródło | Do czego służy | Zasada |
|---|---|---|
| Aktualny kod UI i backendu | Nazwy akcji, dostępność, skutki zapisu, walidacje, uprawnienia | Sprawdź faktyczny przepływ, nie sam napis na przycisku |
| Aktualna dokumentacja w repozytorium | Wyjaśnienie celu i procesu | Powiąż z wersją/commitem aplikacji |
| Dostarczone przewodniki z 08.06.2026 | Teksty objaśnień, przykłady, nagłówki i istniejące kotwice | Materiał bazowy; może opisywać stary przebieg |
| `https://estelio.com.pl/pomoc/` i `https://estelio.com.pl/pomoc-manager/` | Docelowe strony instrukcji, jeśli nadal są używane | Sprawdź aktualną treść i identyfikatory sekcji przed linkowaniem |
| Specyfikacje nowych dodatków w repozytorium | Kontekst funkcji nowszych od przewodników | W pomocy opisuj tylko faktycznie wdrożone i dostępne zachowanie |

Dokumentacja określa zamiar, kod pokazuje obecną realizację. Gdy są sprzeczne, nie uznawaj automatycznie kodu za poprawny biznesowo i nie naprawiaj procesu przy okazji tej funkcji. Zapisz rozbieżność. Opublikuj tylko bezsporną część pomocy; przy kwestiach takich jak płatność, stan, uprawnienia lub usuwanie wstrzymaj sporną instrukcję do rozstrzygnięcia.

**Konkretny przykład wykryty w dostarczonym przewodniku:** sekcja pracownika `#magazyn` opisuje dostawę jako edycję ilości 2 → 14. Nie zakładaj, że jest to aktualna ścieżka, jeśli obecny system ma osobny formularz przyjęcia towaru. Sprawdź jego działanie i dopiero wtedy sformułuj instrukcję. Nagłówek „Dodanie nowego produktu (nowy artykuł w cenniku)” w tej kopii nie ma własnego `id`; samo `#magazyn` prowadzi do szerszego rozdziału.

### 3.3. Opracowanie treści podczas wdrożenia

1. Automatycznie zindeksuj obecne widoki i dokumentację.
2. Zaproponuj dopasowania po identyfikatorach, nazwach i znaczeniu funkcji. Podobieństwo nazw to kandydatura, nie dowód poprawności.
3. Dla każdego kontekstu sprawdź opisane akcje w kodzie oraz źródłach i napisz krótką podpowiedź.
4. Zapisz źródła, status i odniesienie do sprawdzonej wersji. Przykład: ścieżka pliku, funkcja/komponent, nagłówek instrukcji, commit.
5. Automatycznie sprawdź długość tekstu, kompletność wpisu, unikalność kluczy, linki i osierocone konteksty.
6. Przygotuj raport zbiorczy z próbkami. Właścicielowi zadaj tylko konkretne pytania o nierozstrzygnięte reguły, nie proś o opisanie całej aplikacji.

**Generowanie treści następuje w czasie prac Claude Code, a nie przy każdym kliknięciu użytkownika.** Aplikacja odczytuje gotowy, wersjonowany katalog. Nie wysyłaj danych klientek, formularzy, sprzedaży ani zawartości ekranów do usługi AI. Nie pobieraj i nie streszczaj stron pomocy w przeglądarce pracownika na żywo.

## 4. Model katalogu pomocy

Użyj jednego centralnego katalogu, np. `context-help.content.json`, oraz jednego komponentu. Rozdziel konfigurację pozycjonowania, treść i mapę kontekstów. Dostosuj lokalizację plików do istniejącej struktury.

Każdy wpis powinien zawierać:

| Pole | Znaczenie |
|---|---|
| `contextId` | Stabilny klucz, np. `inventory.product.create`; niezależny od napisu i URL z ID klientki |
| `parentContextId` | Jawnie określony kontekst nadrzędny |
| `eyebrow`, `title`, `body` | Krótka etykieta, nagłówek i opis |
| `items` | Opcjonalnie 1–3 krótkie wskazówki, każda z opcjonalną ikoną i warunkiem dostępności |
| `tip` | Opcjonalne jedno zdanie podpowiedzi |
| `article` | Etykieta linku, adres bazowy, kotwica, status sprawdzenia celu |
| `availability` | Powiązanie z istniejącymi capabilities/uprawnieniami i dodatkami |
| `sources` | Referencje do dokumentacji i kodu użyte do napisania tekstu |
| `reviewStatus` | `draft`, `verified`, `needs-resolution` |
| `verifiedAgainst`, `contentVersion` | Sprawdzona wersja aplikacji i wersja wpisu |

Do interfejsu użytkownika nie trafiają techniczne metadane, ścieżki plików ani nazwy trybów weryfikacji. Wpis `verified` oznacza sprawdzenie w procesie tej zmiany, nie samodzielnie zadeklarowaną pewność generatora. Weryfikacja obejmuje również link.

Opisuj funkcję bez danych konkretnej osoby. Nie zapisuj w katalogu nazwisk, sald, kwot z realnych transakcji ani innych informacji z otwartego rekordu. Korzystaj ze wspólnego mechanizmu uprawnień; nie twórz drugiej, rozbieżnej logiki ról dla pomocy.

## 5. Treść chmurki

Preferowany jest wariant formularza: etykieta + tytuł + krótki akapit + opcjonalna wskazówka + link. Wariant listy stosuj tam, gdzie kilka działań faktycznie ułatwia orientację.

- Tytuł: 3–7 słów, zwykle do 55 znaków.
- Opis: 1–2 zdania.
- Łącznie docelowo 35–65 słów, maksymalnie 80 (bez etykiety i linku).
- Lista: maksymalnie trzy punkty, każdy jedno krótkie zdanie.
- Jedna wyróżniona wskazówka, tylko jeśli wnosi dodatkową informację.
- Jedno główne przejście do konkretnej instrukcji. Bez kilku konkurencyjnych przycisków.
- Używaj nazw występujących na bieżącym ekranie. Unikaj „pokrycia”, nazw tabel, identyfikatorów technicznych i opisywania niewdrożonych funkcji.
- Nie wklejaj całej sekcji pomocy do chmurki. Jeżeli treść jest za długa, skróć ją, a nie zmniejszaj czcionki.

Tekst bazowy makiety nowego produktu:

> POMOC • NOWY PRODUKT  
> **Dodajesz nowy produkt**  
> Wpisz nazwę i wybierz kategorię. Stan początkowy to ilość, którą masz teraz w salonie.  
> **Wskazówka:** Minimum pomaga zauważyć kończący się zapas.  
> **Link:** Jak dodać produkt? ↗  
> Otwiera instrukcję w nowej karcie.

To tekst projektowy do potwierdzenia z bieżącymi polami formularza. Nie dokładaj pola „minimum” ani „kategoria” do istniejącego formularza wyłącznie po to, by zgadzał się z makietą; w takim przypadku dostosuj pomoc.

## 6. Gdzie umieścić pomoc

| Kontekst | Miejsce przycisku | Co opisuje |
|---|---|---|
| Strona/moduł | Prawy koniec istniejącego nagłówka treści | Aktualny widok |
| Zakładka | W istniejącym nagłówku zakładki albo wspólnym nagłówku z aktualizowanym kontekstem | Wybraną zakładkę |
| Formularz w modalu | Nagłówek formularza, przed przyciskiem zamknięcia, osobny obszar klikalny | Dodawanie albo edycję |
| Panel boczny | Własny nagłówek panelu | Zawartość panelu |
| Kreator | Nagłówek aktualnego kroku | Ten krok, bez instrukcji kolejnych kroków |
| Widok pusty lub brak dostępu | To samo miejsce, o ile nagłówek jest dostępny | Rzeczywiście dostępne możliwości, bez obchodzenia uprawnień |

Zachowaj rozmiar istniejących nagłówków, układ pól, szerokości formularzy i kolejność akcji. Dodaj tylko miejsce na przycisk. Nie dodawaj globalnego pływającego „?” w rogu okna, jeśli komponent danego widoku ma własny nagłówek. Na widoku bez nagłówka wybierz stabilne miejsce w jego obszarze akcji i odnotuj je w mapie.

Rozstrzyganie kontekstu: najwyższy aktywny modal/panel → krok/zakładka w nim → bieżący widok. Tło zasłonięte modalem nie może otwierać drugiej pomocy. Na jednej aktywnej powierzchni jest jeden przycisk kontekstowy, a w całej aplikacji najwyżej jedna otwarta chmurka. Nie dodawaj osobnych „?” do każdego pola.

## 7. Wymiary i styl — wiążące

| Element | Parametry |
|---|---|
| Font | Istniejący czytelny font UI Estelio; fallback `system-ui, sans-serif`; bez szeryfów w komponencie |
| Przycisk | Wizualne koło 36 × 36 px wewnątrz pola interakcji 44 × 44 px |
| Znak | `?`, 22 px, kolor #842D49; bez zamiany na `i` dla głównego przycisku |
| Tło przycisku | #F8EDF1; stan hover #F2E1E7 |
| Fokus | Wyraźny obrys 2 px #842D49 z odstępem 3 px |
| Chmurka | Szerokość 360 px wraz z paddingiem, `max-width` równe szerokości dostępnego viewportu minus 24 px |
| Wypełnienie | 20 px, na bardzo wąskim ekranie 16 px |
| Powierzchnia | #FFFFFF, obramowanie 1 px #E7E1DE, promień 16 px |
| Cień | `0 12px 32px rgba(45,30,35,.12), 0 2px 6px rgba(45,30,35,.04)` |
| Tekst główny | 14 px / 21 px, #45434A |
| Tytuł | 17 px / 23 px, semibold, #242126; zostaw miejsce na zamknięcie |
| Etykieta | 11 px / 16 px, #68636A, niewielkie rozstrzelenie liter |
| Wskazówka | Tło #FBF0F3, tekst #842D49, 13 px / 19 px, promień 10 px, padding 12 px |
| Ikony listy | 18 px, ten sam zestaw co w aplikacji; dekoracyjne, nie emoji |
| Odstępy | 8 px etykieta–tytuł, 12 px tytuł–opis, 12 px opis–wskazówka, 16 px przed stopką |
| Link | 14 px / 20 px, semibold, #842D49; podkreślenie przy hover i fokusie |
| Przycisk × | Obszar 44 × 44 px, ikona 18 px; nie nachodzi na tytuł |
| Animacja | 140 ms opacity i przesunięcie do 4 px; brak animacji przy reduced motion |

Wymiary są w pikselach CSS, nie odczytanych z powiększonego PNG. Wskazówka informacyjna ma ikonę `i`; wykrzyknik stosuj tylko dla rzeczywistego ostrzeżenia. Nie kopiuj ewentualnego wykrzyknika z ilustracji wariantów do zwykłej podpowiedzi. Nie stosuj gradientów, pulsowania, przyciemniania całego ekranu ani dużego nagłówka marketingowego.

## 8. Interakcje, warstwy i dostępność

1. Przycisk to natywny `button type="button"`, z nazwą dostępną „Pomoc: [tytuł kontekstu]”, `aria-expanded` i `aria-controls`.
2. Najazd po ok. 350 ms lub fokus pokazuje wyłącznie mały tooltip „Pomoc do tego widoku”. Tooltip znika po otwarciu właściwej pomocy. Dotyk nie wymaga hover.
3. Kliknięcie, Enter lub Spacja otwiera chmurkę. Ponowna aktywacja przycisku ją zamyka. Nie otwieraj chmurki samoczynnie przy wejściu na stronę.
4. Chmurka zawiera link i przycisk, więc nie oznaczaj jej jako `role="tooltip"`. Użyj niemodalnego dialogu (`role="dialog"`, nazwa przez tytuł, bez `aria-modal="true"`) lub równoważnego dostępnego wzorca z projektu.
5. Przy otwarciu przenieś fokus do kontenera z tytułem (`tabindex="-1"`). Tab przechodzi przez zamknięcie i link; poza modalem nie zamykaj fokusu w pułapce.
6. Po ×, Esc i ponownym kliknięciu „?” fokus wraca do przycisku. Po kliknięciu innej kontrolki zamknij pomoc i pozwól działać klikniętej kontrolce — nie wykradaj jej fokusu.
7. Esc zamyka najpierw pomoc; to samo naciśnięcie nie może zamknąć formularza pod spodem. W otwartym modalu pomoc należy do jego warstwy i współpracuje z istniejącym focus trapem. Nie ustawiaj bezrefleksyjnie portalu w `body`, jeżeli trafiłby poza dostępne drzewo modalu.
8. Pozycja preferowana: pod przyciskiem, wyrównanie do prawej krawędzi. Odstęp 8 px, margines viewportu 12 px. Przy braku miejsca odwróć pozycję lub przesuń kartę; grot musi wskazywać rzeczywisty przycisk, a jeśli to niemożliwe — ukryj go.
9. Chmurka nie może być obcięta przez `overflow`, schowana pod modalem ani zasłaniać własnego przycisku zamknięcia. Użyj istniejącego mechanizmu pozycjonowania, jeśli jest dostępny.
10. Scroll i resize przeliczają pozycję. Jeśli kotwica znika z widoku, zamknij pomoc. Zmiana widoku, zakładki, kroku, klientki lub zamknięcie formularza zamyka starą chmurkę.
11. Na 320 px szerokość karty maksymalnie 296 px. Długie słowa i linki zawijaj. Przy niskim ekranie/zoomie dopuszczalny pionowy scroll wewnątrz karty; nigdy poziomy. Uwzględnij widoczną wysokość po otwarciu klawiatury mobilnej.
12. Treść renderuj bez wstrzykiwania HTML ze źródeł. Linki dopuszczaj wyłącznie z ustalonej listy własnych adresów pomocy i sprawdzonych kotwic. Nowa karta z `noopener`; podpis informuje o jej otwarciu.
13. Otwarcie/zamknięcie pomocy nie wysyła formularza, nie zmienia jego dirty state, nie resetuje pól i nie wykonuje mutacji biznesowych.

## 9. Linki do konkretnych akapitów

Nie twórz kotwic na podstawie domysłu. `INDEKS_ZRODEL.csv` rozróżnia własne `id` nagłówka i kotwicę nadrzędnej sekcji. Kotwica lokalnego HTML nie jest dowodem, że działa pod publicznym adresem strony.

Dla każdej pomocy sprawdź właściwy dokument dla roli oraz to, czy cel prowadzi do odpowiedniego zagadnienia. Jeśli potrzebny nagłówek nie ma `id`, a dokument pomocy jest utrzymywany w repozytorium, dodaj mu stabilną kotwicę, zachowując stare odnośniki. Nazwa nowej kotwicy jest propozycją do momentu jej rzeczywistego dodania. Link uruchamiaj dopiero, gdy pasująca wersja instrukcji jest dostępna.

Jeśli publikowana pomoc jest poza repozytorium, przygotuj mapę zmian nagłówków/odnośników dla jej właściciela. Tymczasowo można prowadzić do zweryfikowanego szerszego rozdziału, ale podpis musi mówić „Pomoc: magazyn”, a nie obiecywać konkretnego akapitu. Zgłoś to jako niepełne pokrycie dokładnymi linkami.

Jeżeli nie istnieje bezpieczny i poprawny cel, nie pokazuj fałszywego linku. To stan wyjątkowy wymagający uzupełnienia przed pełnym odbiorem funkcji, nie docelowy sposób działania.

## 10. Braki i sprzeczności

- Brak wpisu dla szczegółowego kontekstu: można użyć zweryfikowanej pomocy nadrzędnej, ale tytuł musi jawnie określać jej ogólny zakres. Rejestruj takie miejsca w raporcie pokrycia.
- Brak jakiejkolwiek zweryfikowanej pomocy: krótki komunikat „Instrukcja do tego widoku jest w przygotowaniu” oraz zweryfikowane przejście do spisu pomocy, jeśli istnieje. Bez zgadywania skutków działania przycisków. Docelowo brak takich luk dla wdrażanego zakresu.
- Brak uprawnienia lub wyłączony dodatek: usuń niedostępne wskazówki; tekst i link nie mogą sugerować obejścia ograniczeń. Dla opcjonalnego terminarza nie pokazuj instrukcji umawiania, jeśli salon go nie ma.
- Awaria pliku pomocy: aplikacja biznesowa działa dalej, błąd komponentu nie blokuje widoku. Katalog lokalny minimalizuje tę zależność.
- Brak sieci: krótka pomoc z dołączonego katalogu działa, o ile aplikacja jest dostępna. Nie obiecuj dostępności pełnej instrukcji offline, jeśli system jej nie zapewnia.
- Sprzeczność dokumentacji i kodu: opisz rozbieżność w raporcie wraz z dowodami; nie zmieniaj logiki sprzedaży lub magazynu w zadaniu dotyczącym pomocy.

## 11. Kolejność prac dla Claude Code

### P-01 — inwentaryzacja i treści

Zbuduj mapę widoków, katalog źródeł i listę rozbieżności. Wygeneruj krótkie treści i linki dla znalezionych kontekstów. Nie oczekuj od właściciela ręcznej listy podstron. Podaj liczbę widoków z pełną pomocą, z pomocą nadrzędną i nierozstrzygniętych. Raportuj też brakujące dokumenty nowych funkcji.

### P-02 — wspólny komponent i pilotaż

Zaimplementuj komponent lokalnie w istniejącej architekturze. Podepnij trzy reprezentatywne miejsca: listę magazynu, formularz dodawania produktu oraz wybraną zakładkę profilu klientki. To test trzech typów osadzenia, nie redesign tych modułów. Korzystaj z dostępnych w środowisku testowym danych przykładowych.

### P-03 — rozszerzenie na wszystkie konteksty

Po poprawnym działaniu wspólnego komponentu podepnij pozostałe zmapowane miejsca, role i warianty dodatków. Użyj wspólnych nagłówków tam, gdzie to możliwe. Nie rozpoznawaj kontekstu przez przypadkowe szukanie widocznego tekstu w DOM. Powiązanie ma być jawne i stabilne.

### P-04 — sprawdzenie i raport

Wykonaj testy z poniższej listy. Zaktualizuj mapę pokrycia, dołącz zrzuty samej pomocy i zrzuty integracyjne służące ocenie jej położenia. Raport końcowy ma podawać zmienione pliki, wersję, wyniki faktycznie wykonanych prób oraz nierozstrzygnięte luki. Nie oznaczaj jako PASS prób, których nie wykonano.

Te etapy opisują kolejność pracy, nie wymagają zatrzymywania po każdym pliku. Kontynuuj samodzielnie tam, gdzie źródła dają jednoznaczną odpowiedź. Zgłaszaj tylko blokery wymagające decyzji biznesowej lub brakujące dostępy.

## 12. Kryteria odbioru

| Próba | Oczekiwany wynik |
|---|---|
| Strona → zakładka → formularz → krok | Pomoc zawsze dotyczy aktualnego kontekstu; stara się zamyka |
| Pomoc w otwartym formularzu | Esc zamyka pomoc, formularz i wpisane wartości pozostają |
| Kliknięcie × formularza przy otwartej pomocy | Formularz zachowuje swoje istniejące reguły zamykania i ostrzeżenia o niezapisanych danych |
| Formularz z niewysłanymi zmianami → pełna instrukcja | Instrukcja otwiera się w nowej karcie, wartości nie znikają |
| Enter/Spacja na „?” w formularzu | Otwiera pomoc bez wysłania formularza |
| Klawiatura i czytnik ekranu | Zrozumiała nazwa przycisku i dialogu, widoczny fokus, dostęp do linku i zamknięcia |
| Dwa miejsca pomocy | Otwarta tylko jedna chmurka; tło modalu nieaktywne |
| Krawędzie, scroll, resize | Karta w dostępnym obszarze, nieobcięta, poprawna kotwica |
| 320/400 px, 800×550, desktop, zoom 200% | Czytelność, dostępne zamknięcie i link, brak poziomego przewijania |
| Długi tekst lub tytuł | Zawijanie, brak kolizji z ×, brak zmniejszania czcionek |
| Manager/pracownik i różne dodatki | Wskazówki i dokument docelowy zgodne z możliwościami roli i salonu |
| Linki | Strona istnieje; konkretne `id` istnieje i prowadzi do właściwego tematu, nie tylko HTTP 200 |
| Brak treści/brak sieci/błąd katalogu | Brak awarii formularza lub modułu, uczciwy stan zastępczy |
| Regresja procesów | Otwarcie pomocy nie zmienia danych, zapisu, walidacji ani działania sprzedaży i magazynu |
| Zakres diffu | Zmiany ograniczone do komponentu, treści, kotwic instrukcji i miejsc podpięcia |
| Pokrycie | Każdy zinwentaryzowany dostępny kontekst ma zweryfikowaną pomoc; wyjątki wymienione jawnie |

## 13. Utrzymanie po wdrożeniu

Przechowuj mapę i treści w repozytorium. Dodanie/zmiana widoku powinna wymagać przypisania `contextId` i sprawdzenia właściwej pomocy. Test automatyczny wykrywa brak wpisu, nieprawidłowy format, zbyt długi tekst, brak kotwicy i nieużywane klucze. Test nie dowodzi poprawności biznesowej opisu.

Jeśli zmienia się kod lub rozdział będący źródłem tekstu, oznacz powiązany wpis do ponownego przeglądu w raporcie prac. Nie ukrywaj automatycznie istniejącej poprawnej pomocy wyłącznie dlatego, że zmienił się hash całego pliku. Pomoc aktualizuje Claude przy zmianie funkcji — właściciel nie ma prowadzić osobnego ręcznego CMS-a.

## 14. Oczekiwany wynik

Jeden lekki komponent zgodny z makietami, centralny katalog krótkich treści, jawna mapa podłączeń do ekranów i sprawdzone linki do właściwych fragmentów instrukcji. Pozostały wygląd i działanie Estelio zachowane. Raport ma odróżniać pełne pokrycie od tymczasowej pomocy ogólnej i nierozstrzygniętych tematów.
