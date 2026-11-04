# Estelio — analiza uzupełniająca po nocy 3/4.11.2026 (dla ChatGPT, przed startem wariantu A)

Uzupełnia `RAPORT_HOSTING_BAZA_SKALOWANIE_2026-11-03.md` i odnosi się do `ESTELIO_HARTOWANIE_A_ZALECENIA_DLA_CLAUDE_CODE.md`.
Zawiera wyłącznie to, co zdarzyło się i zostało zmierzone 3.11 wieczorem i 4.11 rano. Podział na: fakty potwierdzone,
hipotezy, rzeczy wymagające czynności właściciela. Bez haseł; jedno hasło aplikacji Gmail wyciekło do czatu 3.11 i ma
zostać unieważnione przez właściciela (zapisane jako zadanie).

---

## 1. Najważniejsze odkrycie: zbłąkany proces na laptopie dewelopera (fakt)

- Na laptopie, na którym pracuje Claude Code, od **13.10.2026 15:48** do **4.11.2026 ok. 08:56** działał proces
  `node server.js` uruchomiony **bez** `dotenv_config_path=.env.test`, czyli z produkcyjnym plikiem `.env`
  (ten sam użytkownik bazy, ten sam SMTP, te same zmienne Booksy co produkcja).
- Przez 22 dni proces ten wykonywał przeciwko **produkcyjnej bazie** wszystkie 11 zadań cyklicznych aplikacji
  (Klub co 60 s, Terminarz co 60 s, sprzątanie sesji, maile o wizytach i seria powitalna co godzinę, przypomnienia,
  billing, leady, admin) oraz poller skrzynki Gmail (Booksy) co 3 minuty. Przy każdym starcie laptopa — nie, proces
  żył ciągle od 13.10 (data utworzenia procesu), bez restartów.
- Zadania mają atomowe blokady w bazie, więc wysyłki nie poszły podwójnie, ale **część produkcyjnych wysyłek
  e-mail i naliczeń Klubu wykonał laptop zamiast serwera**. Treść i skutek dla klientek identyczne; różnica jest
  procesowa i bezpieczeństwa (działania produkcyjne spoza środowiska produkcyjnego).
- Proces otwierał nowe połączenie z bazą mniej więcej co minutę (zadania co 60 s przy `wait_timeout = 20 s`), czyli
  **~60 połączeń/h z budżetu 500/h**, przez trzy tygodnie, dzień i noc.
- Został uruchomiony **dzień przed incydentem 14.10** (wyczerpanie limitu 500/h, HTTP 500 na produkcji). Tamta
  diagnoza wskazywała restarty serwera i wielokrotne testy z laptopa; ten proces jest brakującym, stałym składnikiem
  tamtego obciążenia. To korekta wcześniejszego raportu.
- **Zabity 4.11 ~08:56** (`taskkill`). Dowód: znacznik `BooksyMeta.last_run` zatrzymał się na 08:55:05 i nie zmienił
  się przez kolejne minuty; wcześniej aktualizował się co 3 min mimo usunięcia zmiennych Booksy z produkcji i ich
  braku na dev.
- Wniosek procesowy (dopisany do reguł): na początku każdej sesji i przed każdą diagnozą „kto odpytuje bazę”
  listować procesy `node.exe` na laptopie; dozwolone są wyłącznie serwer testowy z `.env.test` (port 3999) i panel
  prób (3998).

**Co to zmienia w HART-00:** pomiary „6 połączeń naszego użytkownika” i część ruchu w `PROCESSLIST` z 3.11 wieczorem
obejmowały laptop. Hipoteza „instancja dev czyta Gmail” była błędna — dev nie ma zmiennych Booksy. Bazowy pomiar
połączeń/h trzeba wykonać **od nowa, po 4.11 08:56**, bo wcześniejsze liczby są zanieczyszczone.

## 2. Booksy (fakt)

- Produkcja: zmienne `BOOKSY_IMAP_USER/PASS/TENANT_ID` usunięte z panelu 3.11, restart 23:23, log startowy
  „[booksy] poller nieaktywny”; `.env` na serwerze wstrzykuje 0 zmiennych („injected env (0)”).
- Dev: zmiennych Booksy nie ma.
- Właściciel: recepcja **nie korzysta** z listy wizyt Booksy → poller nie wraca nigdzie. Hasło aplikacji Google do
  unieważnienia (wyciek do czatu).

## 3. Wdrożenie 3.11 23:23 i restart 23:43 (fakt + niewiadoma)

- Produkcja stoi na `8f667f4` (wdrożone 23:23). Dziennik Zdarzeń: brak błędów po tym restarcie poza wpisami
  „Sesja wygasła” (stara karta w salonie, nieszkodliwe).
- W runtime logach sekwencja startowa z 23:23 pojawia się **dwukrotnie, przeplatana** (dwa razy „Uruchomiono 23:23”,
  dwa razy migracje, dwa razy „Serwer nasłuchuje”), potem pojedynczy start 23:43. Właściciel: „nie wiem, czy
  kliknąłem raz czy dwa, mogłem dwa”.
- **Niewiadoma:** jeden proces uruchamiany podwójnie przez Hostinger czy dwa kliknięcia restartu. Rozstrzygnięcie:
  przy najbliższym restarcie kliknąć raz i policzyć linie „[wersja] Uruchomiono” w runtime logach panelu (plik
  `stdout.log` nie jest dostępny właścicielowi, ale panel pokazuje ten sam strumień). Jeśli dwa procesy → równoległe
  `ALTER TABLE` na tej samej tabeli stają się głównym kandydatem na „Błąd bazy danych” po restarcie 18:30.
- Wcześniejsze zdanie w analizie Tpay (2.11) „Hostinger uruchamia kilka procesów Node” było **założeniem**, nie
  dowodem. Kodee twierdzi: jeden proces.

## 4. Dysk konta (fakt, rozwiązane doraźnie, przyczyna poza aplikacją)

- Panel 4.11 08:55: dysk **84%** (42,24 z 50 GB) przy bazie 27,7 MB danych; inody 12%; CPU 4%; RAM 402/3072 MB;
  procesy 46/120; PHP workers 4/60. Jedyna czerwona lampka: dysk.
- „Odkryj ścieżkę” wskazało kolejno: `/home/u393261461/backups`, `domains`, `domains/estelio.com.pl`,
  `domains/dev.estelio.com.pl`, `domains/dev.estelio.com.pl/hbuilds`.
- Właściciel połączył się SFTP kontem SSH i wyczyścił `backups` → **35%**. Zawartość wg właściciela: codzienne
  archiwa `tar` z „kartami klienta” (pliki dokumentów/zdjęć klientek), każdego dnia pełna kopia, więc rosnące.
- **Ani kod Estelio, ani narzędzia w repo nie tworzą archiwów tar.** Źródło najpewniej zadanie cron w hPanelu
  (Zaawansowane → Zadania Cron) ustawione poza wiedzą Claude Code. Decyzja właściciela 4.11: **na razie zostawić,
  nic z tym nie robić.** Konsekwencja: katalog odrośnie; przy ~1 GB/dzień dysk wróci do 84% w kilkadziesiąt dni.
  Do zaplanowania: rotacja (np. 7 ostatnich kopii) albo kopia przyrostowa — poza zakresem wariantu A, ale
  wymaga decyzji, bo pełny dysk blokuje restart aplikacji.
- Archiwa zawierają dane osobowe → leżą poza `public_html`, co jest poprawne; dostęp tylko kontem SSH.

## 5. Pomiar obciążenia 4.11 10:20 (fakt, pierwszy pomiar bez laptopa w tle)

| element | wynik |
|---|---|
| nawiązanie połączenia z bazą (z laptopa, TLS) | 3 ms |
| proste zapytanie / zapytanie ze złączeniem | 37 ms / 38 ms |
| serwer bazy: połączone / pracujące wątki | 113 / 2 |
| nasz użytkownik bazy w `PROCESSLIST` | **1 połączenie — tylko pomiarowe; aplikacja produkcyjna trzymała 0** |
| strona logowania | 200, 0,93 s (statyczna, z grafiką) |
| API z zapytaniem do bazy (3 próby) | 200, 0,14–0,27 s |
| błędy w Dzienniku, 12 h | 4 × „Sesja wygasła” (stara karta), 0 błędów bazy |
| ruch Boczków, 2 h | 6 wpisów dziennika, 2 osoby |
| liczniki globalne serwera bazy | `Max_used_connections` 2027 (limit 2000), `Slow_queries` 11 927, `Aborted_connects` 115 868 — dotyczą wszystkich klientów hostingu |

Interpretacja: przy małym ruchu produkcja nie utrzymuje żadnego połączenia (baza zamyka po 20 s), więc każde
żądanie po przerwie otwiera nowe. To jest dokładnie profil, w którym pula z krótszym `idleTimeout` i ciepłe
połączenie mają sens — ale ile dają, pokaże dopiero pomiar po zmianie (HART-03, cel roboczy < 250 nowych
połączeń/h wg zaleceń).

## 6. Pytanie o automatyczne wdrażanie dev (niewiadoma, blokuje push)

- Katalog `hbuilds` instancji dev ma datę modyfikacji „13 godzin temu” (≈ 20:00 3.11). Nikt nie wdrażał dev ręcznie.
  Claude Code wypchnął na gałąź `dev` dwa commity dokumentacji ok. 20:07 i 20:21.
- Hipoteza: Hostinger **automatycznie wdraża dev po każdym pushu na gałąź `dev`** (restart dev + migracje na
  produkcyjnej bazie przy każdym pushu). Dokładnie przed tym ostrzegał dokument zaleceń.
- Rozstrzygnięcie: zakładka **Wdrożenia** instancji dev — lista ostatnich wdrożeń z godzinami i trybem
  (automatyczne / ręczne). **Do czasu odpowiedzi: zero pushów na `dev`.** Gałąź `hartowanie-a` może być wypychana,
  bo nie jest podpięta do żadnej instancji (do potwierdzenia na tej samej zakładce).
- Jeśli hipoteza się potwierdzi: wyłączyć automat w panelu dev albo zatrzymać/odseparować dev (HART-01). Na stronie
  „Wykorzystanie zasobów” dev jest przycisk „Zatrzymaj uruchomione procesy” — prawdopodobny Stop, którego Kodee nie ma
  w swoich narzędziach (Kodee odmówił zatrzymania: „tylko Restart”).

## 7. Stan pozostałych ustaleń

- Właściciel zdecydował: dev na Hostingerze **wyłączyć** (nie usuwać) — czeka na wykonanie w panelu; po odkryciu, że
  poller był na laptopie, przestało być pilne, zostaje w HART-01.
- Produkcja: wartość `DB_HOST` w panelu nadal niepodana (potrzebna sama wartość).
- Logi z 3.11 18:30 (`[DB ERROR] …`) nie zostały zabezpieczone przed restartem 23:23; przyczyna pierwszego
  „Błąd bazy danych” pozostaje **niepotwierdzona**. Hipotezy do tabeli HART-00: (a) migracje równolegle z ruchem po
  restarcie, (b) dwa procesy po restarcie wykonujące `ALTER` równolegle, (c) niezwiązane: odrzucenie połączenia przez
  przeciążony serwer bazy (globalne liczniki), (d) laptop w tle dokładał połączeń — teraz wykluczony na przyszłość.
- Wariant A: właściciel ma potwierdzić start. ChatGPT dał zielone światło z ustaleniami (dev wyłączony, gałąź
  `hartowanie-a`, logi poza Git, DB_HOST sama wartość, testy integracyjne tylko na izolowanej bazie).

## 8. Czego ChatGPT może dopilnować w kolejnej rundzie

1. Czy pomiar bazowy połączeń/h (HART-00) ma być liczony od 4.11 08:56, z pominięciem wszystkiego wcześniej.
2. Czy daily `tar` kopii klientek (poza aplikacją) ma dostać rotację teraz, czy czekać; przy obecnym tempie to
   kilkadziesiąt dni do powrotu problemu dysku.
3. Czy próbę „jeden restart = ile linii Uruchomiono” zrobić przed HART-02, bo wynik zmienia projekt bramki
   (dwa procesy wymagają blokady migracji w bazie, np. `GET_LOCK`, nie tylko kolejności w jednym procesie).
4. Czy gałąź `hartowanie-a` wolno wypychać przed potwierdzeniem, że Hostinger nie wdraża jej automatycznie.
