# Podsumowanie dnia — niedziela 18.10.2026

**Dla kogo:** właściciel (Mariusz) oraz druga maszyna robocza (DELL) — żeby po `git pull` było wiadomo, co się zmieniło i czego nie trzeba robić drugi raz.

**Stan na koniec dnia:** `main` = `dev` = **`8a9b2fa`**, obie gałęzie wypchnięte na GitHub.
Produkcja (estelio.com.pl) i host dev stoją na **`8d0614f`** — czekają na `Pull` + `Restart` w panelu Hostingera.

---

## 1. Jednym zdaniem

Terminarz 2.0 pojechał na `main`, zamknęliśmy przy okazji realną dziurę bezpieczeństwa (dane klientek dało się czytać bez logowania), naprawiliśmy 7 potwierdzonych usterek w liczeniu pakietów, przestawiliśmy dostęp do modułu zakupów z „lista salonów w zmiennej środowiskowej” na **dodatek**, i przepisaliśmy przewodnik `/pomoc-terminarz/` tak, żeby miał prawdziwe zrzuty ekranu w każdym rozdziale.

15 commitów, 79 plików, +8329 / −294 linii.

---

## 2. Co weszło na `main` (chronologicznie)

| Godz. | Commit | Co to jest |
|---|---|---|
| 12:21 | `b6e1c19` | **Naprawa harnessu testów** — przywrócony domyślny kontrakt `mockDb` + jawny wariant `mockDbBezDDL` dla magazynu i test kontraktu pomocnika. To odblokowało merge. |
| 12:44 | `dbdacde` | Próby kandydata na izolowanej bazie (W04–W07): ścieżki recepcji, E05, sesje w dwóch procesach, macierz uśpionych zakupów A/B/C/D, wersja awaryjna z tagu. |
| 12:49 | `7df0c8f` | Raport **GO/NO-GO** wdrożenia Terminarza 2.0 (W01–W07) + paczka dowodów `po11`. |
| 13:07 | `bbef849` | Plan powrotu przez panel Hostingera — gałąź `wroc-ostatnia-dobra-2026-10-16` + jedna kartka `WROC_DO_OSTATNIEJ_DOBREJ.md`. |
| 13:08 | `c0e87b6` | Kandydat = ostatni commit `dev`, bez numerów na sztywno. **Ten commit poszedł na produkcję o 13:24.** |
| 13:44 | `6a64b3e` | **Izolowane środowisko testowe na laptopie** — `start-test.cmd` / `stop-test.cmd` / `odswiez-dane-demo.cmd` (MariaDB 3307 + serwer 3999 na `.env.test`) + instrukcja `PRZEKLIKAJ_LOKALNIE.md`. Bez sekretów w repo. |
| 14:51 | `8cba96d` | **Dziura bezpieczeństwa zamknięta** — strażnik sesji stał *za* routerami i nigdy się nie wykonywał; `GET /api/klienci?...` oddawał dane bez tokenu. Strażnik przeniesiony przed routery, jawna lista ścieżek publicznych, wyłącznik awaryjny `ENFORCE_SESSION_ROUTERY`, `/dbstatus` tylko z tokenem admina. |
| 14:53 | `8d0614f` | Raport gotowości wydania „odczyty tylko z sesją” + smoke kandydata. **To stoi dziś na produkcji i na dev-hoście.** |
| 15:05 | `ad00441` | Opis rozliczania płatności w rdzeniu (paragon, pozycje, portfel, mix, dopłata, zwroty, karnety) — dla recenzenta + wynik kontroli produkcji po wydaniu. |
| 15:38 | `320efab` | Weryfikacja aneksu ścieżek płatności od ChatGPT (18.10) + korekty opisu rdzenia. |
| 16:08 | `d4b45bc` | **ZK-03.1 — 7 potwierdzonych usterek liczenia praw** + zasada salonu Z8 (zabieg po terminie ważności). |
| 16:25 | `2e7a26a` | Komunikat „zabieg z pakietu po terminie” w kreatorze wizyty — serwer, ekran i toast po zapisie. |
| 16:44 | `25db4b5` | **Dostęp do rozliczania pakietów rozdaje DODATEK, nie zmienna środowiskowa.** |
| 17:03 | `8106b4c` | Rozdziały o rozliczaniu pakietów w `/pomoc-terminarz/` z prawdziwymi zrzutami i scenkami. |
| 17:40 | `8a9b2fa` | **Zrzuty w całym przewodniku + pakiety wbudowane w strukturę** (32 rozdziały, 4 części). |

---

## 3. Bezpieczeństwo — najważniejsza rzecz dnia

Przy przygotowaniu wdrożenia wyszło, że **strażnik sesji w `server.js` był zarejestrowany po routerach**. Efekt: każdy, kto znał `tenant_id`, mógł odczytać dane klientek zwykłym `GET`-em, bez logowania. To był stan **produkcyjny**, nie regresja z dzisiaj.

Co zrobiliśmy:
- `routes/sesja-middleware.js` (nowy plik) — strażnik z **jawną listą ścieżek publicznych** (logowanie, reset hasła, rejestracja, zamówienie, voucher, kontakt, GUS, Stripe, ścieżka foto na telefonie, zgody, `help-kb/global`) i prefiksami `/magda`, `/admin`, `/billing`, `/klub`, `/blog`.
- Strażnik przeniesiony **przed** routery; stary, martwy blok 57 linii usunięty.
- Wyłącznik awaryjny `ENFORCE_SESSION_ROUTERY=false` — gdyby coś na produkcji przestało działać, jedna zmienna w panelu przywraca stare zachowanie bez wycofywania wydania.
- `/dbstatus` wymaga teraz `x-admin-token`.
- 14 nowych testów (`tests/sesja-odczyty.test.js`) pilnuje **kolejności rejestracji w `server.js`** — żeby ten błąd nie wrócił po cichu.
- Kontrola na produkcji po wydaniu: **41/41** (odczyt, bez zapisów).

---

## 4. Rozliczanie pakietów (ZK-03.1)

Naprawione 7 usterek potwierdzonych w recenzji:

| Nr | Co było źle | Skutek dla salonu |
|---|---|---|
| N01 | Kanoniczny zapis zadania gubił zawartość tablic — dwa różne zadania miały ten sam skrót | Druga, inna operacja mogła zostać uznana za powtórzenie pierwszej |
| N02 | Błąd jednego zakupu wywracał całą paczkę | Jedna wadliwa sprzedaż blokowała rejestrację pozostałych |
| N03 | Dopasowanie dopłat po wariancie, nie po kategorii; wspólne `grupa_id` było niejednoznaczne | Dopłata mogła trafić do złego zakupu |
| N04 | Korekta salda liczona na części składowych | Dało się zejść poniżej zera na historii |
| N05 | Decyzje lokalne („niezwiązana”, „historyczna”) trafiały do listy walidacji | Ponowne uruchomienie licznika odrzucało własne decyzje |
| N13 | Wpis na 0 zł traktowany jak zwrócony | Pakiet znikał klientce bez powodu |
| Z8 | Ważność mieszała się z dostępnością | Zabieg po terminie był po prostu niedostępny, bez wyjaśnienia |

**Dwie zasady salonu wprowadzone na Twoją decyzję:**
1. Nieobecność zabiera zabieg z pakietu **tylko** po kliknięciu przez recepcję „nie przyszła” (świadoma decyzja, nie automat).
2. Zabieg z pakietu po terminie ważności **da się umówić**, ale system mówi o tym wprost: plakietka „po terminie”, przycisk zmienia się na „Umów mimo terminu”, żółta ramka z datą ważności i przypomnienie w toaście po zapisie.

23 nowe testy regresyjne (`tests/terminarz-zakupy-zk031.test.js`) — każdy przed poprawką padał.

---

## 5. Dostęp do modułu = dodatek, nie zmienna środowiskowa

Było: lista salonów w `TERMINARZ_ZAKUPY_TENANTS` — żeby ktokolwiek dostał funkcję, trzeba było wejść w panel Hostingera i dopisać go ręcznie.

Jest: wpis `rozliczanie_pakietow` w katalogu dodatków (`Features_Catalog` + `Tenant_Features`), czyli **ten sam mechanizm, co Klub, Foto czy Link do płatności**. Zmienna środowiskowa została wyłącznie jako hamulec awaryjny (gdy jest ustawiona, zawęża dostęp).

Status w katalogu: **`UKRYTY`** — czyli pilot, widoczny tylko dla salonów, którym dodatek nadano ręcznie. Przestawienie na `AKTYWNY` (każdy abonent włącza sam) zostaje do decyzji po Twoim odbiorze.

Schemat v2 rozliczania pakietów został uruchomiony na wspólnej bazie produkcyjnej (51 elementów, wersja `2026-10-17`).

---

## 6. Przewodnik `/pomoc-terminarz/` — przepisany

- **32 rozdziały w 4 częściach** zamiast 25 + dwie doklejone części na końcu.
- Konfiguracja pakietów weszła do części **II (Konfiguracja)** jako rozdziały 09–14; umawianie z pakietu do części **III (Codzienna praca)** jako rozdział 17, zaraz po „Nowej wizycie”.
- **38 zrzutów ekranu z działającego systemu** w 30 z 32 rozdziałów. Bez zrzutu zostały tylko „Co dalej (etapy B–D)” — nie ma czego pokazać — i „Indeks sytuacji”, czyli sama tabela odnośników.
- Stopka wróciła na koniec dokumentu (wcześniej wisiała w środku).
- Przenumerowanie 01–32 wraz ze wszystkimi odnośnikami w treści, w nawigacji i w indeksie; indeks dostał 7 wierszy o pakietach.

Wszystkie zrzuty pochodzą z **fikcyjnego salonu `demo-test`** na izolowanej bazie testowej. Żadnych prawdziwych danych klientek.

---

## 7. Czego dziś **nie** zrobiliśmy (świadomie)

- **PIN-y pracowników zostają bez zmian** — decyzja właściciela, temat zamknięty, nie wracamy do niego.
- Luka Z3-T02b (równoległy zwrot i rozliczenie) — zamknięta decyzją właściciela: jeden lokal, jedna recepcjonistka na zmianie, warunek wyścigu niespełniony. Do wariantu 2 wracamy, gdy pojawi się salon z kilkoma stanowiskami recepcji.
- Punkty recenzji **N06–N12** (koordynacja wyścigów, koordynacja migracji, wykrywanie przerw, postęp kolejki, kontrakt API) — nieruszone.
- 24 scenariusze odbiorcze Z31 — niewykonane.
- Unieważnianie sesji między procesami (produkcja i dev honorują tokeny wczytane przy własnym starcie) — drugie zadanie bezpieczeństwa, otwarte.

---

## 8. Co trzeba zrobić dalej

**Po Twojej stronie:**
1. `Pull` + `Restart` na produkcji i na dev-hoście — przeniesie oba z `8d0614f` na `8a9b2fa` (nowy przewodnik, poprawki pakietów, dodatek zamiast zmiennej).
2. Po pierwszym dniu normalnej pracy recepcji na nowej wersji — powiedz, a założę tag `ostatnia-dobra-2026-10-19`.
3. Przy aktywacji w swoim salonie: włączyć `potracenie_nieobecnosc` i przejść 5 kroków konfiguracji na prawdziwym cenniku.

**Po mojej stronie (jutro):**
4. Użytkowe sytuacje w terminarzu, które masz na liście.
5. Decyzja: `rozliczanie_pakietow` z `UKRYTY` na `AKTYWNY`.
6. N06–N12 i scenariusze Z31.
7. ZK-04 (kreator z saldem pakietu / serie), ZK-05 (wykonanie a rozliczenie sporne), ZK-06 (zamykanie i wznawianie licznika).

---

## 9. Jak wrócić, gdyby coś nie działało

Pełna instrukcja: `docs/terminarz-zakupy/WROC_DO_OSTATNIEJ_DOBREJ.md`.

W skrócie — w panelu Hostingera przestawić gałąź na **`wroc-ostatnia-dobra-2026-10-16`**, potem `Pull`, `Restart`, `Purge cache`. Nie wymaga gita na Twoim komputerze. Tag punktu powrotu sprzed Terminarza 2.0: `przed-terminarz-2026-10-12` → `1af9dbc`.

---

## 10. Dla DELL-a — co zrobić po `git pull`

```
git fetch origin
git checkout dev && git merge origin/dev --ff-only     # 8a9b2fa
git checkout main && git merge origin/main --ff-only   # 8a9b2fa
```

Czego **nie** ma w repo i trzeba mieć lokalnie:
- `.env` i `.env.test` (sekrety — nigdy w gicie),
- katalog `C:\Users\aaell\estelio-srodowisko-testowe\` (przenośna MariaDB 11.8.9 + hasło salonu demo w pliku poza repo),
- katalog `memory/` (pamięć asystenta, zależy od ścieżki projektu),
- `design/` (~26 MB).

Środowisko testowe startuje jednym kliknięciem: `narzedzia/srodowisko-testowe/start-test.cmd` (MariaDB na 3307, serwer na 3999, salon `demo-test`, PIN-y Ola/1111 manager, Anna/2222 kosmetolog — wyłącznie baza testowa).

---

*Raport zamknięty 18.10.2026, 17:40. Stan gałęzi: `main` = `dev` = `8a9b2fa`.*
