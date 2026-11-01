# Claude Code — M00: rozpoznanie Estelio pod aplikację pracowniczą v0.2

Jesteś wykonawcą. ChatGPT recenzuje wynik; właściciel produktu podejmuje decyzje zakresowe. Przygotuj rozpoznanie aktualnego repozytorium dla Android/iOS, recepcja + manager. W tej rundzie wykonaj analizę i niezbędne izolowane próby; nie implementuj pełnej aplikacji, nie wdrażaj na main ani produkcję.

## Źródła wejściowe

- https://www.estelio.com.pl/pomoc/
- https://estelio.com.pl/pomoc-manager/
- https://estelio.com.pl/pomoc-terminarz
- Paczka Estelio Mobile v0.2: dokumenty 00–08, makiety i standard redesignu.
- Historyczny `AUDYT_BEZPIECZENSTWA_ESTELIO.md`, jeśli dostępny. Nie odtwarzaj go z przypuszczeń.

Pomoc opisuje produkt, repozytorium dowodzi implementacji, konfiguracja i testy dowodzą uruchomienia. Zawsze rozróżniaj te poziomy. Jeśli brak środowiska lub pliku, wpisz „niezweryfikowane” i dokładnie czego brakuje. Nie wklejaj sekretów, tokenów, PIN-ów ani danych klientek.

## 1. Ustal bazę pracy

Podaj branch, commit, stan zmian i architekturę. Nie nadpisuj pracy użytkownika. Odczytaj AGENTS i instrukcje projektu. Zidentyfikuj działające punkty wejścia, dispatcher, routery, DB, pliki, sesje, testy i deployment. Testy zapisujące dane wyłącznie w izolowanym środowisku na syntetycznych salonach.

## 2. Zbuduj mapę faktycznych funkcji

Dla każdej funkcji: link i sekcja pomocy → UI → handler/API → usługa biznesowa → tabela/plik → uprawnienie serwera → test → status gałęzi/produkcji (ostatnie tylko z dowodem).

Obowiązkowy zakres:

- Sprzedaż wielopozycyjna i kilku sprzedawców; wszystkie aktywne metody, Mix, portfel, zadatek, zwykła korekta, zwrot z limitem i magazynem, awaryjna edycja.
- Dokładne definicje wskaźników: wpływy vs wartość sprzedaży, zadatki, portfel, wiersze Dopłata, ACTIVE/DELETED/MERGED, Ręczne/System, AOV, udział sprzedawców. Jedna próbka danych i uzgodnienie wszystkich raportów.
- Kartoteka po ID, duplikaty, dokumenty i zdjęcia, zgody, notatki/zdrowie/preferencje, usuwanie i zatwierdzenie, ranking recepcji.
- Zadania: Telefon/Do zrobienia, wynik rozmowy, przełożenie, role/przypisanie, cykliczność, relacja z leadem. „Umówiona” w telefonie nie tworzy wizyty.
- Terminarz: rezerwacja/obecność/wykonanie/rozliczenie osobno, wiele usług i wykonawczyń, gabinet/urządzenie/bufory, zmiany i wersje, techniczne blokady, obsługa wizyta → sprzedaż → powiązanie, sprawy.
- Pakiety: mapowanie ofert, wersje składu, rejestracja zakupów, pomijanie dopłat, niezależne liczniki, puste wartości, stany początkowe, stare wizyty, tryby ewidencji, ważność, odwrócenia i wyłączenie dodatku. Sprawdź rzeczywisty stan ZK, nie zakładaj wdrożenia z opisu pomocy.
- Szybka rezerwacja: brak kartoteki, kontrola numeru, wygaśnięcie, link, akceptacja, ręczna wpłata, spóźniona wpłata, retencja danych holda.
- Role Admin/Megaadmin salonu vs administracja platformy. Manager nie dostaje Kreatora dostępów ani awaryjnej edycji. Sesja osoby to co innego niż sprzedawca rozliczeniowy.
- Dodatki, konfiguracja i raporty: rozdziel dostępność w kodzie od włączenia w salonie; SMS/e-mail/push/dzwonek nie są tym samym.

## 3. Rozstrzygnij niezgodności źródeł

Uzupełnij każdą pozycję DOK01–DOK10 z dokumentu 08: rzeczywista reguła, dowód plik:linia, test, proponowana poprawka dokumentacji. Szczególnie: bcrypt vs historyczny audyt; limity PIN; konta managera; ewidencja pakietów vs stare ogólne zaprzeczenia; obsługa nieobecności; hold „do wpłaty”; dzienny/tygodniowy zakres Agendy; semantyka usuwania klientki. Nie wybieraj wygodniejszej wersji bez dowodu.

## 4. Sprawdź bezpieczeństwo

Każdy historyczny punkt audytu oznacz: naprawiony / częściowy / otwarty / niezweryfikowany. Sprawdź wszystkie alternatywne ścieżki, nie tylko nowy router. Wymagane próby: salon A→B; recepcja→Analiza/Kreator; manager→Kreator; podszycie aktora; sesja salonu bez PIN; stary token po zmianie PIN/roli/dezaktywacji; dostęp do dokumentu; dwuklik/timeout/retry; równoczesna ostatnia jednostka i zwrot. PASS musi znaczyć bezpieczny oczekiwany rezultat, a nie udany atak.

Zaproponuj rejestrację urządzenia, przełączanie imiennych osób, bezpieczne tokeny, revokację i odzyskiwanie. Zachowaj potrzebę administratora platformy, z imiennym kontem, MFA i audytem. Nie zastępuj działającego PIN-u obowiązkowymi kontami e-mail bez wykazania potrzeby i planu migracji.

## 5. Oceń wariant techniczny

Porównaj RN/Expo+TypeScript i Capacitor z mobilnym frontendem na podstawie tego repozytorium. Wskaż, co można współdzielić i co wymaga nowego kodu. PWA jako punkt odniesienia; Swift/Kotlin/Flutter tylko jeśli mają konkretną przewagę. Nie wybieraj technologii dlatego, że makiety są w HTML.

Podaj nakład przedziałami dla backendu, sesji, sprzedaży, terminarza, pozostałych ekranów, testów obu platform, pilota i utrzymania. Zależności, ryzyko, koszty usług — osobno. Nie obiecuj akceptacji sklepów.

## Oczekiwane pliki

1. `M00_RAPORT.md` — wnioski, commit, fakty/niepewności, rekomendacja, blokery.
2. `M00_MAPA_FUNKCJI_API.md` — powiązania źródła–kod–test.
3. `M00_ROLE_I_SESJE.md` — matryca endpointów i realny lifecycle sesji.
4. `M00_ROZBIEZNOSCI_POMOCY.md` — DOK01–DOK10 oraz nowe ustalenia.
5. `M00_TESTY_I_DOWODY.md` — polecenia, środowisko, wyniki i skutki w danych; czego nie wykonano.
6. `M00_WARIANTY_I_NAKLAD.md` — porównanie i oszacowanie z założeniami.
7. `M01_PROPOZYCJA_ZAKRESU.md` — następne małe, jednoznaczne zlecenie.

Przekaż komplet w ZIP i krótkie podsumowanie. Jeśli jest kod testów lub zmiana dokumentacji, dołącz diff i spis plików. Brak dostępu do aktualnego repozytorium jest ograniczeniem raportu, nie powodem do udawania wyników. Na końcu zatrzymaj się po przekazaniu wyniku M00 do recenzji.
