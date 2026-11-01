# Architektura i dystrybucja — decyzja po M00

## Co wiemy

Audyt z 26.10.2026 opisuje Node.js/Express, MySQL/MariaDB, statyczny frontend HTML/JS, mieszany model API (`POST /api` z `action` oraz routery modułów). To stan raportowany dla commita `f6dbd327fa359c4ae29ea26134d5ed8a368de537`, nie inspekcja obecnego repozytorium. Pomoc WWW odczytana 01.11.2026 jest bieżącą bazą funkcjonalną. Jej deklaracje techniczne sprawdzamy w M00; mają pierwszeństwo nad czerwcowymi przewodnikami jako opis produktu.

## Porównanie opcji

| Opcja | Co zachowujemy | Główna praca | Ocena dla Estelio |
|---|---|---|---|
| Responsywne WWW/PWA | najwięcej obecnego kodu webowego | mobilny UX, bezpieczeństwo, ograniczenia platform | szybki punkt odniesienia/pilot, nie tożsamy z aplikacją w obu sklepach |
| Capacitor + nowy mobilny frontend | narzędzia HTML/CSS/JS i backend; możliwy wspólny UI web/mobile | mobilny interfejs, mosty natywne, bezpieczne sesje i WebView | poważny kandydat budżetowy; opakowanie obecnego dużego ekranu nie rozwiąże UX |
| React Native + Expo + TypeScript | backend, reguły serwera, część typów i czystych funkcji | nowy UI i projekt mobilny; praca nad dwoma systemami i wydaniami | wstępnie preferowane, jeśli osobna aplikacja ma być rozwijana przez lata |
| Flutter | backend przez API | nowy frontend w Dart i kompetencje utrzymania | możliwe, brak wykazanej przewagi w obecnym projekcie |
| Swift + Kotlin | backend przez API | dwa frontendowe projekty i osobne testy | rozważyć tylko przy udokumentowanych wymaganiach natywnych |

Rekomendacja jest warunkowa. „Jeden kod” nie oznacza jednego testu lub identycznego zachowania na iOS i Androidzie. Makieta HTML nie jest kodem React Native i nie przenosi się do niego 1:1. Expo ułatwia część procesu, lecz nie przejmuje odpowiedzialności za konta, certyfikaty, uprawnienia i bezpieczeństwo backendu.

### Próba rozstrzygająca

Po M00 wybrać kandydatów RN/Expo i Capacitor; jeśli koszt/kompetencje pozostają niejasne, wykonać mały prototyp tego samego przepływu na sztucznym API: logowanie, długa lista klientek, formularz, blokada, powrót z tła. Porównać na realnych urządzeniach płynność, klawiaturę, dostępność, pracę na tablecie, zabezpieczenie tokenów i koszt utrzymania. Nie budować dwóch pełnych aplikacji.

## Docelowe warstwy

1. UI aplikacji — prezentacja, lokalny stan formularza, komunikaty i obsługa systemu.
2. Wersjonowany kontrakt mobilnego API — walidacja, paginacja, kontrola sesji, uprawnień i modułów.
3. Wspólne usługi biznesowe Estelio — sprzedaż, zadatki, pakiety, zadania; używane także przez WWW.
4. Baza i dokumenty — te same dane salonu, wydzielone środowiska testowe.

Nowe API nie naprawi starych ścieżek, jeśli nadal pozwalają ominąć reguły. Audyt obejmuje dispatcher, routery, pobieranie plików i wszystkie alternatywne wywołania danej operacji. Docelowo istnieje wspólne sprawdzanie uprawnień, a starszy frontend korzysta z niego bez regresji.

## Kontrakt API do opracowania

Poniższe nazwy są propozycją kontraktu, nie istniejącymi endpointami:

| Operacja | Wymaganie |
|---|---|
| `GET /mobile/v1/me` | stabilne user_id, aktywny salon, dozwolone moduły i uprawnienia, wersja zasad |
| `GET /mobile/v1/clients` | wyszukiwanie po nazwie/telefonie na serwerze, paginacja, ograniczone pola; bez pełnego dumpu bazy |
| `GET /mobile/v1/clients/:id` | identyfikator i salon sprawdzane razem; osobne zakresy danych |
| `GET/PATCH /mobile/v1/tasks/:id` | kontrola przypisania i wersji rekordu; 409 przy zmianie przez drugą osobę |
| `POST /mobile/v1/sales` | idempotency key, transakcja w bazie, walidacja cen/rabatów/uprawnień na serwerze |
| `GET /mobile/v1/operations/:key` | wynik niepewnego zapisu wyłącznie dla uprawnionego aktora i salonu |
| `GET /mobile/v1/reports/summary` | kwoty z istniejących definicji raportu; zakres dat i strefa salonu |
| `GET/DELETE /mobile/v1/sessions/:id` | kontrola właściciela sesji lub prawa do zarządzania personelem |

Pola kwotowe w groszach lub typie dziesiętnym z ustaloną skalą, nigdy suma finansowa z niedokładnych floatów. Terminy w UTC plus strefa salonu do wyświetlania i reguł czasu; domyślnie Europe/Warsaw, uwzględnić zmianę czasu. Nazwy endpointów i model zostaną dostosowane do M00.

## Zapis i utrata sieci

Pierwsza wersja: operacje biznesowe wymagają internetu; brak automatycznej kolejki sprzedaży czy realizacji pakietów offline. Przy utracie połączenia blokujemy zapis i chronimy dane; formularz może pozostać w pamięci bieżącej, po blokadzie/zmianie użytkownika jest czyszczony. Nie udajemy aktualnych sald offline.

Timeout po wysłaniu zapisu oznacza „wynik nieustalony”, nie „nie zapisano”. Aplikacja sprawdza status operacji po tym samym kluczu, a ponowienie nie tworzy drugiej sprzedaży. Ta sama reguła dotyczy komunikacji web/mobile. Klucz jest związany z salonem, operacją, aktorem i skrótem treści; ponowienie z inną treścią jest odrzucane. Okno przechowywania wyników musi obejmować realne próby ponowień i być zdefiniowane przed wydaniem.

## Powiadomienia i integracje

Push do pracowników: APNs/FCM, bez imienia klientki, zabiegu, salda i treści notatki w payloadzie. Komunikat np. „Masz nowe zadanie w Estelio”. Po otwarciu ponowna kontrola konta, salonu i roli. Push jest wskazówką do odświeżenia danych, nie dowodem uprawnienia ani gwarantowanym kanałem dostarczenia. Rezygnacja z powiadomień nie blokuje aplikacji.

APNs/FCM i ewentualny pośrednik Expo, monitoring oraz e-mail uwierzytelniający wymagają inwentarza danych i odbiorców. Klucze usług i certyfikaty wyłącznie po stronie serwera/bezpiecznego CI. Aplikacja nie zawiera sekretu pozwalającego wysyłać push lub zarządzać salonami.

## Instalowanie i sklepy

Rekomendowany punkt wyjścia dla SaaS obsługującego wiele niezależnych salonów: jedna aplikacja Estelio w App Store i Google Play, dostęp do danych wyłącznie po aktywacji konta pracownika przez salon. Publiczna możliwość instalacji nie oznacza publicznego dostępu do danych.

iOS: alternatywą jest dystrybucja unlisted, dostępna po linku i wymagająca zgody Apple. Taki link sam w sobie nie chroni danych. Rozwiązania firmowe/custom apps mają sens przy organizacjach z odpowiednim zarządzaniem urządzeniami; nie zakładamy ich u każdego małego salonu. Android: prywatne aplikacje Managed Google Play wymagają odpowiedniego modelu organizacyjnego. Nie przyjmujemy, że pracownicy będą instalowali APK z wiadomości.

Apple wymaga użyteczności wykraczającej poza przepakowaną witrynę (4.2). Capacitor nie jest z tego powodu automatycznie wykluczony; liczy się gotowy produkt. Nie obiecujemy akceptacji sklepu na podstawie frameworka.

Pierwsza wersja jest aplikacją towarzyszącą istniejącemu kontu salonu, bez projektowania zakupów abonamentu Estelio w aplikacji. Warunki konkretnego modelu B2B, linków i płatności w sklepach trzeba sprawdzić przy publikacji; nie zakładamy automatycznego zwolnienia z zasad płatności.

### Lista przed publikacją

- Konta wydawcy i prawo do marki należą do właściciela Estelio; uprawnienia wykonawcy delegowane, odzyskiwanie i 2FA udokumentowane.
- Identyfikatory pakietów, podpisy, środowiska i certyfikaty push; klucze poza repozytorium i czatem.
- TestFlight / zamknięty tor testowy Google Play, testy na rzeczywistych urządzeniach; wymagania testowania konta Play sprawdzone przy publikacji.
- Wersje OS/SDK dobrane do urządzeń salonów i aktualnych wymagań sklepów; nie deklarujemy dziś numerów docelowych.
- Opisy, ikony, zrzuty z danymi syntetycznymi, formularze prywatności/App Privacy/Data Safety zgodne z rzeczywistym przepływem danych.
- Konto demonstracyjne recenzenta sklepu odizolowane od klientów, instrukcja dostępu bez używania konta megaadmina.
- Ścieżka usuwania konta i zakończenia zatrudnienia zgodna z modelem pracowniczym i zasadami sklepów; usunięcie logowania nie kasuje automatycznie wymaganej historii operacji salonu.
- Pomoc, kontakt, monitoring bez danych klientek, lista znanych ograniczeń i instrukcja odzyskania dostępu.

## Wydania i utrzymanie

API zachowuje zgodność co najmniej z ustalonym oknem aktywnych wersji aplikacji; starsza aplikacja nie otrzymuje nowych uprawnień. Migracje typu expand/contract, feature flags per salon, możliwość wyłączenia danej funkcji mobilnej. Wycofanie aplikacji ze sklepu nie usuwa jej z telefonów. W razie luki serwer musi umieć odmówić niebezpiecznej operacji/starej wersji z czytelną instrukcją aktualizacji. Automatyczne aktualizacje JS/OTA, jeśli użyte, wymagają podpisów, ograniczeń zakresu i planu wycofania; nie omijają zasad sklepu.

Źródła technologiczne i dystrybucyjne: `07_DECYZJE_I_ZRODLA.md`.

## Uzupełnienie v0.2 — kontrakty funkcji opisanych w pomocy

Mobilne API musi dodatkowo udostępnić: capabilities i aktywne dodatki; portfel i historię wpłat; koszyk, podział płatności, korekty i zwroty; karnety i niezależne komponenty zakupów; sprawdzenie dostępności całego ciągu usług; wersjonowanie wizyty; rezerwację i zwolnienie jednostek; przebieg obsługi; powiązanie zapisu sprzedaży; czasowe rezerwacje i potwierdzenie zadatku; sprawy, właścicieli i historię działań. To zakres do sprawdzenia, nie lista rzekomo istniejących endpointów.

Nowa mobilna warstwa ma korzystać z istniejących domen. Przekierowanie do WWW nie może przekazywać długowiecznego tokenu w URL. Jeśli potrzebne jest SSO, zaprojektować krótki jednorazowy kod wymiany z walidacją odbiorcy i celu; alternatywnie normalne logowanie w systemowej przeglądarce. Nigdy automatyczna powtórka finansowego POST przy powrocie do aplikacji.

SMS do klientek, e-maile terminarza, dzwonek spraw i push do pracowników to cztery różne mechanizmy. Pomoc opisuje ręczne potwierdzanie wpłat tpay; aplikacja nie może dopisać webhooka, którego nie ma. Nowa automatyzacja wpłat wymaga osobnego zlecenia, podpisów komunikatów i uzgodnienia księgowania. Integracja Booksy przez wiadomości nie oznacza synchronizacji terminarza.

Po lekturze pomocy nadal porównujemy RN/Expo i Capacitor. Duży działający frontend zwiększa potencjał ponownego użycia w Capacitor, ale nie rozstrzyga jakości mobilnego UX. Test rozstrzygający powinien obejmować także koszyk Mix i kreator wizyty, nie tylko listę klientek.
