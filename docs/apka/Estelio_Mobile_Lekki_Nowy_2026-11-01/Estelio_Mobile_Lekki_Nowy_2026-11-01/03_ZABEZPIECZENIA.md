# Zabezpieczenia Estelio Mobile — projekt do weryfikacji

Status: wymagania projektowe, nie potwierdzenie wdrożenia. Wartości czasu i limitów poniżej są propozycją polityki do oceny w M01. OWASP MASVS służy do mapowania kontroli aplikacji; ten dokument nie jest certyfikatem zgodności ani testem penetracyjnym.

## 1. Punkt wyjścia

**Aktualizacja v0.2:** pomoc managera deklaruje już hashowanie PIN-ów bcrypt i ochronę wybranych raportów. Dlatego poniższy audyt historyczny jest listą kontrolną do rewalidacji, a nie opisem obecnych luk. Źródła zawierają rozbieżne limity prób i opisy sesji. M00 ma wskazać aktualne zachowanie z kodu i testów.

Audyt z 26.10.2026, commit `f6dbd327fa359c4ae29ea26134d5ed8a368de537`, wskazał brak kontroli ról w części API (K2), mechanizm uniwersalnego dostępu bez audytu (K1), jawne PIN-y (W1), ryzyka panelu admina (W2), sekretów i historii repozytorium (W3/W4), XSS (W5), brak pełnego logoutu/resetu sesji (S1), tokeny w URL (S2) i tożsamość w logach z żądania (S3). Część kontroli, np. zarządzanie pracownikami, miała już ochronę serwerową. Nie uogólniamy więc „żadnych uprawnień” na całe Estelio.

M00 ma określić dla każdej pozycji: naprawione / częściowo / otwarte / niezweryfikowane, dowód plik:linia i test, commit poprawki. Test pokazujący, że exploit działa, nie jest pozytywnym odbiorem bezpieczeństwa, nawet jeśli test ma PASS.

Nie przenosimy automatycznie rozwiązań naprawczych ze starego raportu. Np. sam hash krótkiego PIN-u nie rozwiązuje małej liczby możliwych kombinacji; a przeniesienie tokenu z localStorage do sessionStorage nie usuwa skutków XSS.

## 2. Tożsamość, salon, rola i urządzenie

- Każdy pracownik ma stabilny `user_id`. Imię, nazwa roli i login salonu nie są identyfikatorem osoby.
- Członkostwo `user_id ↔ tenant_id` ma status i zestaw uprawnień. Manager jednego salonu nie jest managerem wszystkich salonów.
- Sesja wiąże osobę, salon, instalację/urządzenie, tryb osobisty/wspólny, czas, stan unieważnienia i wersję uprawnień.
- Serwer sam ustala aktora z sesji. `tenant_id`, `role`, `user_id`, `kto` z formularza nie nadają praw.
- Wybór salonu jest sprawdzany według członkostw. Zmiana salonu czyści stan poprzedniego salonu i ponownie pobiera kontekst; nie przenosi roboczego formularza ani cache.
- Domyślnie odmowa. Rola daje pakiet uprawnień, a działania wrażliwe mają oddzielne prawa. Nie budujemy niejednoznacznej drabiny „manager może wszystko”.

### Matryca oparta na pomocy — do potwierdzenia kodem

| Operacja | Recepcja | Manager | Admin/Megaadmin salonu |
|---|---|---|---|
| Sprzedaż, portfel, kartoteka, magazyn | tak | tak | tak |
| Zwykła korekta i rzeczywisty zwrot | tak według procedury i praw serwera | tak | tak |
| Awaryjna edycja | nie | nie | tak, w granicach mechanizmu i z audytem |
| Analiza salonu i statystyki zespołu | nie | tak | tak |
| Ranking klientek / własne cele | według modułu; nie utożsamiać z Analizą | tak | tak |
| Obsługa terminarza i rezerwacja techniczna | tak | tak | tak |
| Grafik, kadry, konfiguracja usług i ewidencji | nie; podgląd operacyjny | tak | tak |
| Cennik, rabaty, dodatki | zakresy szczegółowe; bez globalnego zarządzania | tak | tak |
| Kreator dostępów: konta, PIN-y, role | nie | nie | tak |
| Usuwanie/scalanie klientki | przygotowanie wniosku | zatwierdzenie wg procedury | tak |
| Dokumenty i zdjęcia | istniejące prawa modułu, bez automatycznego poszerzania | jw. | jw. |
| Cofnięcie własnej sesji (nowa funkcja mobilna) | tak | tak | tak |
| Zarządzanie sesjami personelu (projekt) | nie | nie domyślnie | tak |

Nie nadajemy managerowi praw właściciela tylko dlatego, że prowadzi salon. Nazwa Megaadmin w poradniku jest też nazwą roli salonowej; administracja platformą Estelio to osobny zakres. M00 ma pokazać ich rzeczywiste odwzorowanie i ewentualne kolizje nazw.

Dostęp do dokumentów wymaga przeglądu minimalizacji pól i celu pracy. Nie odbieramy recepcji wszystkich dokumentów decyzją projektanta ani nie uznajemy każdej zgody za pozwolenie na publikację zdjęć. Oddzielić odczyt, dodawanie, usuwanie, eksport i publikację; zachować warunki zgody. Uprawnienia zatwierdza właściciel produktu po rozpoznaniu istniejących procesów.

Prawo dostępu do modułu nie wystarcza do dostępu do konkretnego obiektu. API sprawdza jednocześnie salon, obiekt, czynność, członkostwo, przypisanie i ewentualny limit kwoty. Nie zwraca pól niedozwolonych z myślą, że UI je ukryje.

## 3. Pierwsze logowanie i aktywacja

### Telefon osobisty lub służbowy jednej osoby

**Obecny model z pomocy:** logowanie salonu, wybór imiennego pracownika, PIN. **Propozycja mobilna:** jednorazowe zarejestrowanie urządzenia przez właściciela/Admina, potem wybór osoby i weryfikacja PIN-u na serwerze. Przy rejestracji wydawane jest ograniczone poświadczenie urządzenia, bez utrwalenia hasła salonu i bez praw właściciela w aplikacji pracownika.

Na telefonie osobistym powiązanie jednej osoby z instalacją pozwala wygodnie odblokowywać ją biometrią, jeżeli platforma i model tokenów to wspierają. Biometria chroni lokalny dostęp do istniejącej sesji; nie zastępuje sprawdzenia roli na serwerze. Zmiana pracownika wymaga nowej identyfikacji.

Czterocyfrowy PIN nie może sam wystarczać do zdalnego logowania z dowolnej niezarejestrowanej instalacji. Limity na konto, urządzenie, salon i źródło ruchu, narastające opóźnienie i kontrolowane odzyskiwanie są wymaganiem projektu. M00 porównuje obecne limity; M01 ustala jeden kontrakt. Utrata uprawnienia urządzenia odcina także PIN-y na nim. Nie wymagamy od całego personelu nowych kont e-mail jako warunku używania aplikacji.

Dla rejestracji urządzeń i kont uprzywilejowanych projektujemy silniejsze uwierzytelnienie, np. MFA/passkey. Wdrożenie i migracja muszą być osobnym zakresem, z drogą odzyskiwania dostępu. Sam skrót PIN-u w bazie nie rozwiązuje ryzyka małej liczby kombinacji.

Jeśli użyjemy OAuth/OIDC: Authorization Code + PKCE przez systemową przeglądarkę, walidacja state/nonce i przekierowania, brak sekretu klienta w aplikacji. To warunek dla wybranego protokołu, nie nakaz budowy własnego dostawcy OAuth.

### Wspólny tablet recepcji

Osobna rejestracja urządzenia przez uprawnioną osobę. Urządzenie ma kontekst salonu, ale nie pełne uprawnienia właściciela. Dopiero uwierzytelniony pracownik otrzymuje sesję swoich działań. Po „Zmień osobę” poprzednia sesja pracownicza jest unieważniona, dane i formularze czyszczone.

Krótki PIN może być rozważony wyłącznie jako ograniczony mechanizm zmiany osoby na wcześniej zatwierdzonym urządzeniu z kontrolą serwera, limitami konta/urządzenia/salonu, blokadą i silnym odnowieniem sesji. PIN nie uprawnia do wejścia z dowolnego telefonu. Nowy model nie może dziedziczyć uprawnień sesji właściciela. Hash PIN-u z unikalną solą i zatwierdzoną biblioteką, ewentualny osobny pepper po stronie serwera; parametry ustalone po pomiarze. Sama wolna funkcja hash nie chroni wystarczająco krótkiego PIN-u po wycieku bazy.

Biometria tabletu potwierdza uprawnionego użytkownika urządzenia, nie tożsamość dowolnej osoby wybranej z listy pracowników. Nie używamy jej do podpisywania cudzych operacji. Tryb kiosk/MDM może ograniczyć ryzyko, lecz nie zakładamy jego dostępności.

## 4. Sesje, blokada i odebranie dostępu

Propozycja: krótki access token (np. 5 minut) i rotowany refresh token. Serwer przechowuje skrót refresh tokenu; wykrycie ponownego użycia starego tokenu unieważnia rodzinę sesji. Rotacja jest atomowa, równoległe odświeżanie obsługiwane deterministycznie. Rodzina tokenów jest związana z kontem i urządzeniem.

Refresh na urządzeniu osobistym: proponowane 14 dni bezczynności, maksymalnie 30 dni od silnego logowania. Sesja pracownika na wspólnym urządzeniu: maksymalnie jedna zmiana (roboczo 8 godzin), bez trwałego refresh tokenu właściciela. To limity startowe do pilotażu, nie wymogi prawne.

Natychmiastowe odebranie dostępu musi działać niezależnie od pięciominutowego TTL: każda chroniona operacja kontroluje aktywność sesji/członkostwa/urządzenia po stronie serwera. Jeśli są cache uprawnień, mają mechanizm invalidacji i test maksymalnego opóźnienia. JWT bez sprawdzania revocation nie spełnia tego wymagania.

- Logout unieważnia sesję na serwerze i usuwa lokalne dane/tokeny. W razie braku sieci lokalnie usuwa dostęp; serwerową revokację realizujemy po odzyskaniu łączności lub przez drugą sesję. Nie obiecujemy zdalnego unieważnienia bez połączenia.
- Zwolnienie pracownika, usunięcie członkostwa, zmiana PIN-u/hasła, reset i zmiana roli obejmują wszystkie odpowiednie sesje, urządzenia i subskrypcje push.
- Konto właściciela nie może zostać przejęte resetem zainicjowanym przez niższą rolę. Odzyskiwanie MFA ma osobną procedurę i ślad; brak sekretnego hasła awaryjnego.
- Blokada wizualna po przejściu w tło od razu; odblokowanie według polityki. Roboczo: 2 minuty bezczynności na wspólnym tablecie, 5 minut na telefonie, ponowne uwierzytelnienie przed eksportem lub operacją o ryzyku wskazanym w polityce; zwykła korekta recepcji nie dostaje automatycznie nowej blokady. Weryfikować z recepcją, żeby nie wywołać obchodzenia zabezpieczeń.

## 5. Urządzenie i dane lokalne

Refresh token wyłącznie w Keychain / rozwiązaniu wykorzystującym Android Keystore; access token w pamięci. Nie w AsyncStorage/localStorage, pliku konfiguracji, adresie URL, logach lub crash report. Obsłużyć błąd secure storage, zmianę biometrii, reinstalację, restore z backupu i utratę urządzenia; nie zakładać, że odinstalowanie jest serwerowym logoutem.

Pierwsza wersja bez trwałego cache bazy klientek, dokumentów, zdjęć i raportów. Wyłączone backupy wrażliwego cache; zaszyfrowane buforowanie dopiero po osobnej decyzji. Dane RAM czyszczone po logout/zmianie osoby/salonu, ekrany zasłonięte w przełączniku aplikacji. Android może blokować przechwytywanie wrażliwych widoków; na iOS nie deklarujemy uniwersalnej blokady wszystkich screenshotów. Ograniczamy ekspozycję i eksport, nie obiecujemy niemożliwego.

Zdalne „Odbierz dostęp” odcina kolejne żądania, ale nie usuwa z pamięci człowieka ani zewnętrznych kopii już obejrzanych danych. Telefon bez internetu może zachować bieżący widok do lokalnej blokady; dlatego projekt minimalizuje zapis i zasłania aplikację w tle.

## 6. API, pliki i zapisy

- HTTPS z poprawną walidacją certyfikatu; bez trybu ignorowania błędów TLS w release. Pinning: ocena zagrożeń i rotacji certyfikatów; jeśli przyjęty, zestaw zapasowy i test odnowienia. Nie traktować go jako zamiennika autoryzacji.
- Brak bezpośredniego dostępu aplikacji do MySQL, sekretów SMTP, Stripe, APNs/FCM czy panelu admina. CORS ogranicza przeglądarki; nie chroni przed klientem natywnym lub curl.
- Walidacja schematów i limitów wejścia, parametry SQL, dozwolone pola edycji. Odczyty list stronicowane i ograniczone, a uprawnienia i monitoring chronią przed wykradaniem; paginacja sama nie jest zaporą.
- Dokumenty wymagają sesji oraz prawa do konkretnego pliku. Nigdy długowieczny token sesji w URL. Jeśli konieczny podpisany link: krótki, związany z jednym plikiem i prawem, logi redagowane; prawdziwa jednorazowość wymaga serwerowego stanu zużycia, nie tylko HMAC.
- Deep link/push nie może otworzyć danych z innego salonu. Otwarcie powiadomienia po cofnięciu roli kończy się odmową i wyczyszczeniem widoku.
- Krytyczne zapisy atomowe i idempotentne. Równoległa realizacja ostatniego zabiegu z pakietu nie może dać ujemnego salda. Niezależne liczniki usług, autoryzowane odwrócenia i audyt.
- Logi nie zawierają tokenów, haseł, PIN-ów, dokumentacji ani pełnego payloadu klientki. Aktor z sesji, oddzielnie pracownik przypisany do wykonania usługi. Te dwie osoby mogą być różne.

## 7. Administrator platformy pozostaje, z kontrolowanym dostępem

Potrzeba właściciela Estelio do obsługi wszystkich salonów pozostaje. Oddzielamy ją od aplikacji salonowej i od konta managera. Konto imienne administratora + MFA, brak domyślnych haseł w kodzie i wspólnego uniwersalnego sekretu jako zwykłego logowania salonu.

Wejście wsparcia: wskazanie salonu i powodu, zakres minimalny, roboczo maks. 30 minut, domyślnie odczyt; rozszerzenie zapisu/eksportu wymaga osobnego prawa i świeżego uwierzytelnienia. Audit zawiera rzeczywistego administratora, salon, zakres, początek/koniec i wykonane działania. Nie podszywamy logów pod recepcję. To, jakie informacje o wsparciu widzi salon, trzeba ustalić jawnie w polityce produktu i dostępu; dziennik bezpieczeństwa nie może znikać.

Awaryjny dostęp: udokumentowany, ograniczony czasem, z alertem i późniejszym przeglądem. Bez niewidocznej stałej furtki. Ten projekt nie usuwa samodzielnie obecnych mechanizmów produkcyjnych; Claude najpierw raportuje, potem dostaje osobne zlecenie migracji.

## 8. Środowiska, kopie i dostawcy

Dev/test mają osobne bazy, sekrety, konta usług i tenantów syntetycznych. Nie klonujemy klientek Boczki do publicznego demo. Raport M00 podaje stan konfiguracji tylko jako potwierdzony albo nieweryfikowalny, nigdy wartości sekretów.

Kopie obejmują bazę i dokumenty, są szyfrowane, odseparowane od konta aplikacji i okresowo odtwarzane. Proponowany cel biznesowy do zatwierdzenia: RPO ≤ 1 godzina dla transakcji, RTO ≤ 4 godziny. Należy policzyć koszt i potwierdzić możliwości hostingu. To nowy cel do negocjacji, nie opis istniejących kopii; dobowa kopia nie spełnia RPO 1 h.

Zasady retencji oddzielnie dla sesji, logów, dokumentów, danych klientek i kopii. Ocena prywatności uwzględnia dane wrażliwe, BYOD, dostawców push i monitoringu oraz usuwanie kont; zakres i podstawy prawne potwierdza osoba odpowiedzialna za ochronę danych. Nie dokładamy SDK reklamowych, śledzenia lokalizacji, kontaktów czy mikrofonu bez konkretnej potrzeby produktu.

Proces incydentu: odcięcie sesji/urządzenia lub funkcji → zachowanie dowodów → ograniczenie skutków i rotacja właściwych sekretów → ocena zakresu danych → kontakt i decyzje o wymaganych zgłoszeniach → odtworzenie i przegląd przyczyn. Role odpowiedzialnych osób i kanał alarmowy mają być ustalone przed pilotem.

## 9. Minimalna matryca testów odbiorowych

| ID | Próba | Oczekiwany rezultat |
|---|---|---|
| SEC01 | pracownik salonu A żąda klientki/pliku/raportu B | odmowa bez ujawnienia danych |
| SEC02 | recepcja wywołuje Analizę, Kreator dostępów lub awaryjną edycję | odmowa także przez stare `POST /api` i routery |
| SEC03 | sesja samego salonu bez identyfikacji osoby | brak dostępu do danych pracowniczych/klientek |
| SEC04 | body podaje inną rolę, pracownika, salon lub limit | brak eskalacji; aktor w logu z sesji |
| SEC05 | zwolnienie/zmiana roli/hasła; ponowienie starego tokenu | odmowa przy następnym chronionym żądaniu |
| SEC06 | refresh wykorzystany drugi raz, dwa równoległe refresh | deterministyczny wynik; brak niekontrolowanej nowej sesji |
| SEC07 | logout, reinstalacja, odzyskanie backupu, zmiana biometrii | brak nieuprawnionego powrotu do konta |
| SEC08 | na tablecie po managerze loguje się recepcja | brak danych i uprawnień managera; nowy aktor w logu |
| SEC09 | zapis dwa razy / timeout / retry | dokładnie jedna operacja biznesowa |
| SEC10 | dwa urządzenia realizują ostatnią jednostkę pakietu | jedna realizacja; drugie otrzymuje konflikt |
| SEC11 | przejście w tło, push, logi, crash, cache i backup | brak treści wrażliwych poza dopuszczonym zakresem |
| SEC12 | błędne TLS, złośliwy deep link, plik, HTML w nazwie | bezpieczna odmowa / tekst; brak wykonania skryptu |
| SEC13 | administrator wchodzi do salonu | MFA, ograniczenie czasu/zakresu, nieusuwalny dla niego ślad audytu |
| SEC14 | stara wersja aplikacji, wyłączony moduł, zablokowany salon | czytelna odmowa i brak alternatywnego obejścia |
| SEC15 | przywrócenie kopii w izolowanym środowisku | kompletna baza i dokumenty; zmierzony RPO/RTO |

Testy obejmują odpowiedź oraz skutki uboczne w bazie i plikach. Sam status 403 nie wystarcza, jeśli zapis już nastąpił. Dla operacji o najwyższym ryzyku niezależny przegląd bezpieczeństwa przed szerszym wdrożeniem; recenzja ChatGPT opiera się na dostarczonych dowodach i go nie zastępuje.

## 10. Zagrożenia charakterystyczne dla obecnych funkcji

| Ryzyko | Kontrola projektowa | Dowód odbioru |
|---|---|---|
| Podwójna wpłata po ponowieniu „Zadatek wpłynął” | jeden klucz biznesowy powiązany z rezerwacją i wpłatą, atomowy zapis | jedno saldo i jeden wpis, także przy dwóch telefonach |
| Zajęcie wygasłego holda po spóźnionej wpłacie | serwer ponownie sprawdza stan; wpłata rozwiązywana osobno | nowa rezerwacja innej osoby pozostaje bez zmian |
| Rozliczenie tej samej wykonanej usługi drugi raz | jawne powiązanie źródła i idempotencja sprzedaży | powrót do istniejącego rozliczenia |
| Zużycie innego składnika pakietu | walidacja typu usługi i konkretnego uprawnienia | Endermologia nie odejmuje Meltivio |
| Wyłączony dodatek z aktywnym ekranem | walidacja capability przy każdym zapisie | odmowa bez zmiany salda, historia pozostaje |
| Kopiowanie pliku lub podpisanego adresu | prawo do pliku i salonu, krótka ważność, brak eksportu domyślnie | obce konto oraz wycofana sesja nie otwierają pliku |
| Zmiana PIN-u/roli podczas otwartego formularza | serwerowe unieważnienie i kontrola tuż przed zapisem | brak zapisu starym uprawnieniem |
| Równoczesny zwrot ostatniej dostępnej kwoty | blokada/wersja źródła, walidacja pozostałego limitu | brak nadmiernego zwrotu lub podwójnego przyjęcia magazynowego |

Szczegóły medyczne i notatki nie trafiają do ogólnych powiadomień ani do preferencji obsługi. Procedur „zapomnienia”, okresów retencji i zgód z poradnika nie kopiujemy jako gotowej porady prawnej: odwracalne ukrycie profilu i nieodwracalna anonimizacja muszą być nazwane i zaprojektowane osobno.
