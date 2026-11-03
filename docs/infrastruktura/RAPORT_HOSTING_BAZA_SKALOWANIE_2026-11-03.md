# Estelio — hosting, baza danych, stabilność i skalowanie. Raport informacyjny (3.11.2026)

Plik przygotowany jako komplet informacji dla osoby lub asystenta (np. ChatGPT), który ma pomóc właścicielowi
podjąć decyzję o infrastrukturze. Zawiera: czym jest system, jak jest wdrożony, co dokładnie powiedział Hostinger
(odpowiedź z 3.11.2026), historię awarii, pomiary z żywej bazy, fakty z kodu, obawy właściciela i trzy warianty dalszej
drogi z rekomendacją. Bez haseł i kluczy.

---

## 1. Czym jest Estelio i jaka jest skala

- **Estelio** to SaaS dla salonów beauty (sprzedaż, magazyn kosmetyków, klienci, terminarz wizyt, dodatki płatne:
  Klub lojalnościowy z aplikacją PWA dla klientek, Foto przed/po, Link do płatności z regulaminem, Terminarz).
- Jedna aplikacja Node.js (Express) + jedna baza MariaDB. **Wielu najemców (salonów) w jednej bazie**, rozdzielonych
  kolumną `tenant_id` w każdej tabeli. Frontend to w większości jeden duży plik `public/index.html` plus osobne moduły
  (np. `terminarz.js`, aplikacja Klubu `klub.html`).
- **Stan na 3.11.2026:** 9 licencji w tabelie salonów, w praktyce jeden salon pracuje na co dzień intensywnie
  (Boczki na bok, pilot i pierwszy klient) plus salony demo/testowe; sprzedaż zewnętrzna ruszyła 12.06.2026.
  Baza ma 144 tabele i 71 MB danych.
- **Realistyczny horyzont wg właściciela:** „nie przesadzajmy, myślę że nigdy nie dojdziemy do 20 salonów nawet”.
  Celem jest więc stabilność dla kilku–kilkunastu salonów, a nie architektura na setki.

## 2. Jak to jest wdrożone dzisiaj

| Element | Produkcja | Dev |
|---|---|---|
| Domena | estelio.com.pl | dev.estelio.com.pl |
| Gałąź git | `main` | `dev` |
| Proces Node | osobny, **Node 22** | osobny, **Node 18** |
| Baza | **wspólna** (ta sama baza i ten sam użytkownik bazy) | **wspólna** |
| Pliki klientów (uploads) | osobny katalog poza repo | osobny |
| Środowisko testowe lokalne (laptop) | — | izolowana MariaDB 3307 `estelio_test`, salon demo-test (od 10.2026) |

- Hosting: **Hostinger, plan Business Web Hosting**, konto `u393261461`, serwer bazy `srv2146.hstgr.io` (Frankfurt),
  MariaDB 10.5 (Hostinger) — serwer bazy zgłasza wersję z gałęzi 11.x przy połączeniu z laptopa; w obu
  przypadkach to MariaDB współdzielona między wieloma kontami.
- **Wdrożenie** = właściciel robi w panelu Hostingera „Pull” z GitHuba i **restart** procesu Node. Jeden proces,
  brak przełączania bez przerwy. Wcześniej (do 10.2026) testy lokalne również biły w produkcyjną bazę — od
  października jest izolowana baza testowa na laptopie, więc testy nie zużywają już połączeń produkcji.
- Aplikacja przy **każdym starcie** wykonuje migracje schematu „na żywo”: ok. **101 `CREATE TABLE IF NOT EXISTS`**
  i ok. **140 `ALTER TABLE ADD COLUMN`** (idempotentne, bez `await`, „odpal i zapomnij”), a port HTTP otwiera się
  **od razu**, nie czekając na ich koniec.
- Aplikacja ma **11 zadań cyklicznych** w tle (`setInterval`): sesje, Klub (co 60 s), Terminarz (co 60 s), maile
  o wizytach i seria powitalna (co godzinę), przypomnienia, billing, leady, Booksy (odpytywanie skrzynki), admin.
  Działają wewnątrz procesu Node — nie ma osobnego workera.
- Pula połączeń do bazy w `server.js`: `mysql2.createPool`, `connectionLimit: 10`, kolejka bez limitu,
  `enableKeepAlive` z pierwszym sygnałem po 30 s, TLS do bazy włączony (`DB_SSL=on`), strefa czasu ustawiana na
  każdym połączeniu (baza stoi w UTC, nazwane strefy nie są załadowane — ustalono 11.08.2026).
- Sesje użytkowników: w pamięci procesu + tabela `Sesje` (odtwarzane po restarcie).
- Błędy SQL są **maskowane** dla użytkownika komunikatem „Błąd bazy danych. Spróbuj ponownie.”; prawdziwa treść idzie
  tylko do `console.error` (czyli do `stderr.log` na Hostingerze).

## 3. Pomiary z żywej bazy (3.11.2026, godz. 18:39, tylko odczyt)

| Parametr | Wartość |
|---|---|
| `max_connections` (cały serwer bazy) | 2000 |
| `Threads_connected` (cały serwer) | 69 |
| `Max_used_connections` (szczyt od startu serwera) | 2027 (!) |
| `max_user_connections` (nasz użytkownik, jednocześnie) | 75 |
| nasze procesy w `PROCESSLIST` w chwili pomiaru | 6 (5 bezczynnych) |
| `wait_timeout` (zamykanie bezczynnego połączenia) | **20 s** |
| `max_connect_errors` | 5 |
| `Aborted_connects` (cały serwer, od startu) | 114 355 |
| uptime serwera bazy | ok. 17,5 dnia |
| limit połączeń na godzinę dla użytkownika (z rozmowy z supportem 14.10.2026) | **500** |
| limit nowych połączeń na sekundę (z odpowiedzi Hostingera 3.11.2026) | **20** |

Wniosek z `Max_used_connections = 2027 > 2000`: serwer bazy był co najmniej raz w ostatnich 17 dniach
**całkowicie zapełniony przez wszystkich klientów hostingu razem** — to zdarzenie poza naszą kontrolą i bez
powiadomienia.

## 4. Co odpowiedział Hostinger (Kodee, 3.11.2026) — streszczenie wierne

**Baza**
- Baza `u393261461_systemb`: MariaDB 10.5, 71 MB z limitu 3072 MB, wszystkie standardowe uprawnienia.
- Wartości `max_connections_per_hour`, `max_queries_per_hour`, `max_updates_per_hour`, `max_user_connections`
  **nie są widoczne ani zmienialne per konto**; nie ma opcji podniesienia za dopłatą. Udokumentowany jest limit
  **20 nowych połączeń na sekundę**. Zalecenie: pula połączeń, nie nowe połączenie na żądanie.
- **Jeden użytkownik na bazę** — nie da się dodać drugiego użytkownika do tej samej bazy, więc nie da się „podwoić”
  limitu. Plan pozwala na 150 baz (używane 2), każda z własnym użytkownikiem i limitem 3072 MB.
- Połączenie lokalne: `127.0.0.1:3306` (zalecane dla Node; `localhost` może trafić w IPv6 `::1` i dawać błędy);
  socket systemowy `/var/lib/mysql/mysql.sock` istnieje, ale nie jest gwarantowany dla aplikacji Node.
- `wait_timeout = 20 s` to ustawienie serwera, niezmienialne dla konta. Zalecenie: pula, zwalnianie połączeń,
  timeouty po stronie klienta, obsługa ponownego połączenia.
- Liczba kont dzielących serwer bazy nie jest ujawniana. Nie ma w Web Hosting opcji dedykowanej instancji MariaDB —
  do tego VPS.

**Aplikacja Node**
- Model: **jedna aplikacja = jeden długotrwały proces**. Nie ma dwóch instancji tej samej aplikacji ani
  przełączania bez przerwy (zero-downtime). Do tego VPS + reverse proxy + PM2/systemd.
- Limity całego konta: **3 GB RAM, 2 rdzenie CPU, NPROC 120** (wszystkie procesy i wątki konta), Entry Processes 60
  (dotyczy głównie PHP), 50 GB dysku, 600 000 inode. Po przekroczeniu: 503, odrzucanie żądań, ubijanie procesów,
  problemy z restartem. **Limit czasu żądania HTTP: 120 s.**
- Restart: zatrzymanie i ponowne uruchomienie procesu, **bez gwarantowanego czasu**; w trakcie możliwe 502/503.
- Usypianie aplikacji przy braku ruchu: **brak potwierdzonego dokumentu** (ani czasu bezczynności, ani czasu
  wybudzenia). Stałe workery/boty/długie zadania w tle — „Web Hosting nie jest właściwym środowiskiem”, do tego
  VPS lub cron.
- Restart kończy połączenia procesu z bazą; po stronie MariaDB przez chwilę mogą być widoczne sesje zamykane.

**Logi i alerty**
- Logi runtime w panelu Node.js oraz pliki
  `domains/estelio.com.pl/hbuilds/current/nodejs/stdout.log` i `stderr.log` (analogicznie dla dev; starsza ścieżka
  `domains/<domena>/nodejs/`). Po każdym wdrożeniu świeży zestaw, retencja nieokreślona.
- Brak dostępu do logów serwera bazy i historii odrzuconych połączeń (tylko `SHOW PROCESSLIST` na żywo).
- Brak wbudowanych alertów o 5xx czy odrzuconych połączeniach — potrzebny zewnętrzny monitoring.

**VPS / Cloud**
- Nie ma progu typu „przy N klientach”. VPS uzasadniony, gdy potrzeba: >1 procesu aplikacji, zero-downtime,
  PM2/systemd/reverse proxy, WebSocketów, workerów w tle, Dockera, Redis, własnych portów, własnej konfiguracji
  MariaDB, kontroli nad `max_connections`/`wait_timeout`/użytkownikami, dedykowanych zasobów.
- Cloud podnosi limity, ale zachowuje ten sam model jednego procesu i ograniczenia workerów.
- Migracja na VPS jest ręczna: eksport SQL, kopia kodu, instalacja Node/MariaDB/proxy/menedżera procesów, import,
  env, test, zmiana DNS, SSL. Najmniejszy przestój: VPS przygotowany wcześniej, DNS przełączony po testach.
- Na marginesie: Hostinger koryguje błędnie zapisany termin odnowienia planu (bez zmiany ceny i usług).

## 5. Historia problemów z dostępnością (chronologicznie)

| Data | Co się stało | Przyczyna | Skutek / wniosek |
|---|---|---|---|
| 20.04.2026 | Produkcja padła po pushu (biały ekran, wylogowanie) | błąd JS w nowym kodzie + zniszczony plik w repo | wprowadzono gałęzie dev/main, zasadę „push tylko na słowo” |
| 09.05.2026 | Wycofanie wdrożenia (168 commitów) | regresje po dużym merge | zasada tagów punktów powrotu `ostatnia-dobra-RRRR-MM-DD` |
| 11.08.2026 | Dziennik pokazywał godziny o 2 h wcześniej | serwer bazy w UTC, brak nazwanych stref | ustawianie strefy na każdym połączeniu puli |
| **14.10.2026** | **estelio.com.pl przestało wczytywać dane (HTTP 500)** mimo braku zmian na produkcji | lokalne restarty serwera i wielokrotne pełne testy biły w **tę samą bazę i tego samego użytkownika** co produkcja → wyczerpany limit **500 połączeń/h**; support: brak resetu, brak podniesienia, czyści się po godzinie | od tego czasu testy na izolowanej bazie; twarda reguła „nie restartować, nie odpalać pełnego zestawu wielokrotnie” |
| 02.11.2026 | Przypadkowe uruchomienie `require('./server.js')` z produkcyjnym `.env` z laptopa | pomyłka narzędziowa | migracja dodała kolumnę w tabeli bloga na produkcji; reguła: składnię sprawdzać tylko `node --check` |
| **03.11.2026 18:30** | **„Znowu padła baza” — „Błąd bazy danych. Spróbuj ponownie.”** | Pull + restart z nowym kodem (3 nowe tabele, 7 nowych kolumn). Dziennik: 18:30:54 „Błąd terminarza”, 18:35:38 „Sesja wygasła”, potem cisza. Baza i API sprawne przy pomiarze o 18:39 | najbardziej prawdopodobne: **okno kilkunastu sekund po restarcie**, gdy ok. 240 migracji startowych biegnie równolegle z ruchem (port otwarty od razu). Dokładna treść błędu tylko w `stderr.log` na Hostingerze — nie sprawdzona |

Dodatkowo: `Max_used_connections = 2027` przy `max_connections = 2000` oznacza co najmniej jedno zdarzenie
całkowitego zapełnienia współdzielonego serwera bazy w ostatnich 17 dniach, niezależne od nas.

## 6. Obawy właściciela (własnymi słowami, 3.11.2026)

- „nie może to tak działać, że to pada, co jeżeli bym miał 40 salonów w subskrypcji?” — a zaraz potem urealnienie:
  „nie przesadzajmy, myślę że nigdy nie dojdziemy do 20 salonów nawet”.
- Produkcja ma jednego prawdziwego, intensywnie pracującego klienta (Boczki), a każdy przestój jest od razu widoczny
  na recepcji i podważa zaufanie. Każde wdrożenie robi właściciel ręcznie w panelu.
- Właściciel nie chce administrować serwerem „na co dzień”; akceptuje VPS, jeśli aktualizacje i kopie są
  zautomatyzowane.
- Bezpieczeństwo jest regułą nadrzędną: produkcja i wspólna baza tylko do odczytu bez wyraźnej zgody; zapisy
  wyłącznie na bazie izolowanej; zero sekretów w repo i w czacie.

## 7. Fakty z kodu istotne dla decyzji

1. **Migracje przy starcie bez czekania** (ok. 240 poleceń DDL) + natychmiastowe `app.listen` → okno błędów po
   każdym restarcie. Naprawa: bramka startowa (żądania czekają na koniec migracji albo dostają 503 „trwa
   aktualizacja”), bez zmian w modułach.
2. **Pula a `wait_timeout = 20 s`**: keepalive TCP po 30 s nie zapobiega zamknięciu bezczynnego połączenia po 20 s;
   w spokojnych godzinach każde żądanie po przerwie otwiera nowe połączenie → zużywa limit 500/h. Naprawa:
   `idleTimeout` krótszy niż 20 s w puli i jedno połączenie utrzymywane „ciepłe” lekkim zapytaniem co ~10–15 s
   (0 nowych połączeń zamiast dziesiątek na godzinę).
3. **Zadania w tle** (11 `setInterval`) żyją tylko dopóki żyje proces; brak dokumentu o usypianiu aplikacji → nie ma
   gwarancji, że zadania cykliczne (maile o wizytach, Klub, Terminarz) wykonają się po dłuższej ciszy. Dotąd nie
   zaobserwowano wstrzymania, ale nie ma na to dowodu w drugą stronę.
4. **Dwie instancje Node na jednym koncie** (prod + dev) dzielą 3 GB RAM / 2 CPU / NPROC 120 / limit 500 połączeń/h.
   Instancja dev konsumuje ten sam budżet co produkcja. Dev ma Node 18, produkcja Node 22, laptop Node 24 — trzy
   różne wersje.
5. **Monitoring**: brak punktu zdrowia z testem bazy i brak zewnętrznego pingowania; o awarii dowiadujemy się od
   recepcji. Darmowy monitoring HTTP (np. co 1–5 min) + e-mail to minimum.
6. **Wartość DB_HOST na Hostingerze** — do sprawdzenia przez właściciela w panelu Node.js (powinna być `127.0.0.1`,
   nie nazwa serwera bazy; lokalny `.env` na laptopie z natury ma nazwę zdalną).
7. Tpay przez API (partia 1 wdrożona 3.11, uśpiona bez klucza w env) w partii 2 doda **webhook** od operatora
   płatności. Tpay ponawia powiadomienia do 24 h i przestaje po 404, więc kilkunastosekundowy przestój przy
   wdrożeniu go nie gubi — ale każdy przestój to opóźnione potwierdzenie wpłaty w salonie.

## 8. Warianty i rekomendacja

| | A. Zostajemy na Web Hosting i hartujemy aplikację | B. VPS Hostinger (np. KVM 2) | C. Plan Cloud |
|---|---|---|---|
| koszt miesięczny | 0 zł dodatkowo | ok. 40–60 zł | więcej niż A, bez zalet B |
| nakład pracy | ~1 dzień | 2–3 dni przygotowań + 1 wieczór migracji | ~0,5 dnia |
| przestój przy wdrożeniu | zostaje (kilkanaście sekund, 502) | **znika** (2 procesy, przełączenie bez przerwy) | zostaje |
| limit 500 połączeń/h i 20/s | zostaje, ale praktycznie omijany | **znika** (własna baza) | zostaje |
| zadania w tle | bez gwarancji | pełna kontrola (PM2/systemd) | bez gwarancji |
| logi i alerty | tylko zewnętrzny ping + pliki logów | pełne (dziennik, alerty, kopie) | jak A |
| administrowanie | Hostinger | my (aktualizacje i kopie automatyczne) | Hostinger |

**Wariant A — co konkretnie (wszystko w `server.js`, bez zmian logiki modułów):**
1. bramka startowa: port otwarty dopiero po migracjach (lub 503 z komunikatem „trwa aktualizacja” przez te sekundy);
2. pula dopasowana do 20 s + ciepłe połączenie co ~10–15 s → ochrona limitu 500/h;
3. punkt `/api/zdrowie` z testem bazy + darmowy monitoring zewnętrzny z e-mailem do właściciela;
4. `DB_HOST=127.0.0.1` na Hostingerze (po sprawdzeniu), dev na Node 22;
5. wdrożenia poza godzinami pracy salonów.

**Rekomendacja:** A od razu (ten tydzień) — usuwa dzisiejszą klasę błędu i powtórkę z października. B przed
uruchomieniem płatności Tpay na żywo lub gdy pracujących salonów będzie więcej niż kilka, bo wtedy każdy przestój
przy wdrożeniu dotyka wielu recepcji naraz. Przy horyzoncie „poniżej 20 salonów” zasoby planu (3 GB / 2 CPU) nie są
problemem — problemem jest **model jednego procesu i współdzielona baza bez limitów pod kontrolą**. C odradzamy.

## 9. Pytania otwarte

- Jaka jest wartość `DB_HOST` w panelu Node.js produkcji? (`127.0.0.1` czy nazwa serwera)
- Co dokładnie jest w `stderr.log` produkcji z 3.11 ok. 18:30–18:36 (linie `[DB ERROR] …`)? To potwierdzi lub obali
  diagnozę „okno migracji”.
- Czy instancja dev.estelio.com.pl jest w ogóle potrzebna na Hostingerze (testy są na laptopie na izolowanej
  bazie)? Jej wyłączenie zwalnia RAM/NPROC i limit połączeń dla produkcji.
- Czy właściciel akceptuje, że po przejściu na VPS odpowiedzialność za kopie zapasowe i aktualizacje systemu
  przechodzi na nas (zautomatyzowane, ale do nadzoru)?

## 10. Słownik

- **Tenant / `tenant_id`** — identyfikator salonu w każdej tabeli wspólnej bazy.
- **Migracja startowa** — polecenie `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN` wykonywane przy starcie
  aplikacji, żeby baza miała kolumny, których używa kod.
- **Pula połączeń** — zestaw otwartych połączeń do bazy wielokrotnego użytku (u nas do 10 na proces).
- **wait_timeout** — po ilu sekundach bezczynności serwer bazy sam zamyka połączenie (u nas 20 s).
- **Zero-downtime** — wdrożenie bez przerwy w dostępie (drugi proces przejmuje ruch, zanim pierwszy zgaśnie).

---

## 11. Odpowiedź Hostingera o VPS (Kodee, 3.11.2026 wieczór) — streszczenie wierne

**Plany KVM i ceny (netto, katalogowe / pierwszy okres promocyjny):**

| Plan | vCPU | RAM | NVMe | Transfer | mies. | rok | 1. rok promo |
|---|---|---|---|---|---|---|---|
| KVM 1 | 1 | 4 GB | 50 GB | 4 TB | 74,99 zł | 671,88 zł | 311,88 zł |
| **KVM 2** (rekomendowany) | 2 | 8 GB | 100 GB | 8 TB | 91,99 zł | 875,88 zł | 443,88 zł |
| KVM 4 | 4 | 16 GB | 200 GB | 16 TB | 153,99 zł | 1547,88 zł | 671,88 zł |

- **Root i MariaDB:** pełny root; własne `max_connections`, `max_user_connections`, `wait_timeout`, dowolna liczba
  użytkowników bazy. **Limit 500 połączeń/h znika.** Sugestia Hostingera: `max_connections` 200–300, pula Node 20–40.
- **Dwa procesy i wdrożenia bez przerwy:** tak — Nginx + PM2 w trybie cluster (`pm2 start -i 2`, `pm2 reload`),
  pod warunkiem obsługi SIGTERM, punktu zdrowia, zwalniania połączeń przy zamykaniu i migracji zgodnych wstecz.
  KVM 2 ma 2 vCPU, więc dwa procesy pracują naprawdę równolegle.
- **Kopie:** automatyczne backupy VPS w cenie (domyślnie tygodniowe, opcja dzienne; maks. 4 kopie, przy dziennych
  2 dzienne + 2 tygodniowe); snapshot ręczny, 1 sztuka, wygasa po 1 dniu. Przywrócenie nadpisuje cały VPS i jest
  nieodwracalne. Brak osobnej zarządzanej kopii samej bazy — własny `mysqldump` codziennie + kopie poza VPS.
- **Monitoring:** panel pokazuje CPU/RAM/dysk/ruch/uptime (wykresy do 6 mies.), ale **brak alertów e-mail** o 5xx,
  padnięciu procesu czy bazie. Zalecenie: zewnętrzny monitoring HTTP co 1 min na `/health`, alert po 2 nieudanych,
  progi RAM/dysk 80/90%. PM2 wznawia proces po awarii, ale nie zastępuje monitoringu.
- **Self-managed:** Hostinger utrzymuje sprzęt, sieć, platformę i panel; po naszej stronie system (Ubuntu),
  MariaDB, Node, Nginx, PM2, npm, firewall, kopie, bezpieczeństwo aplikacji. `unattended-upgrades` dla aktualizacji
  systemu. **Nie ma zarządzanego KVM.**
- **Firewall/DDoS:** firewall w panelu + Anti-DDoS; 3306 tylko dla 127.0.0.1, publicznie 22/80/443; SSH na klucze,
  bez hasła roota, fail2ban.
- **Migracja:** ręczna (brak automatu z Web Hosting). Przenosi się kod, pliki użytkowników, env, bazę (`mysqldump
  --single-transaction`), Nginx, SSL (Let's Encrypt), cron, PM2. **Domena i poczta kontakt@ zostają na obecnym
  planie** — zmienia się tylko rekord A; MX bez zmian.
- **Równolegle:** można trzymać Web Hosting i VPS jednocześnie, testować VPS na tymczasowej subdomenie i przełączyć
  DNS po testach; w tym czasie płaci się za oba.
- **Lokalizacja:** Niemcy = **Düsseldorf** (nie Frankfurt); **Polski nie ma**. Baza będzie na tym samym VPS co
  aplikacja, więc odległość do obecnego serwera bazy nie ma znaczenia po migracji.
- **Awaria VPS:** konsola w przeglądarce, restart/stop/start z panelu, tryb awaryjny, reset SSH/firewalla; brak
  gwarantowanego czasu reakcji supportu na konfigurację (to po naszej stronie); po awarii procesu sami robimy
  `pm2 restart` / `systemctl restart`.
- **SMTP:** `smtp.hostinger.com` 465 SSL lub 587 STARTTLS działa z VPS; **limit ok. 5 wiadomości/min z VPS**, skrzynka
  do 1000/dobę, 100 odbiorców/wiadomość. Dla maili transakcyjnych kilku–kilkunastu salonów wystarczy; dla kampanii nie.

**Ocena (Claude, 3.11.2026):** odpowiedź potwierdza, że VPS KVM 2 usuwa dokładnie te trzy ograniczenia, które
powodowały awarie i blokują spokojne wdrożenia: limit połączeń/h, jeden proces bez zero-downtime, brak kontroli
nad bazą. Koszt realny: ok. 444 zł za pierwszy rok, potem ok. 876 zł/rok netto (73 zł/mies.) — przy abonamencie
od salonu rzędu 49–79 zł/mies. zwraca się przy drugim płacącym salonie. Cena, którą się płaci, to
**administrowanie**: kopie poza VPS (bo wbudowane to 4 sztuki i nieodwracalne przywracanie całego serwera),
aktualizacje, firewall, monitoring. To da się zautomatyzować w dniu migracji (unattended-upgrades, cron z
`mysqldump` + wysyłka kopii na zewnątrz, fail2ban, PM2 startup, monitoring HTTP z alertem), ale ktoś musi raz na
jakiś czas spojrzeć, czy to żyje. Limit 5 maili/min z VPS wymaga kolejki wysyłki w aplikacji (dziś maile o wizytach
wysyłają się partiami co godzinę — do sprawdzenia, ile naraz).

**Plan migracji, jeśli decyzja = VPS:** (1) wariant A na Web Hosting i tak najpierw (bramka startowa, pula,
`/api/zdrowie`) — to samo jest potrzebne na VPS pod PM2 reload; (2) KVM 2 Düsseldorf, Ubuntu LTS, Node 22, MariaDB,
Nginx, PM2 cluster ×2, Let's Encrypt; (3) import bazy i test na subdomenie (np. `nowy.estelio.com.pl`) z pełną
próbą ekranową; (4) przełączenie rekordu A wieczorem po pracy salonów, instancja Web Hosting zostaje przez 2 tygodnie
jako awaryjna; (5) wyłączenie dev.estelio.com.pl na Hostingerze (testy są na laptopie), ewentualnie dev jako drugi
proces PM2 na VPS z osobną bazą.
