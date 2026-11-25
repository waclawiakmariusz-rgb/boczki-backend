# Punkty Klubu: jeden reset 1 stycznia 2028 u wszystkich, potem od nowa — analiza i testy (25.11.2026)

Polecenie właściciela 25.11.2026: *„jest nowa koncepcja co do długości trwania punktów, mają się resetować z dniem 01.01.2028
u wszystkich i od tego dnia mają naliczać się od nowa. zrób najpierw analizę i testy”*. Zastępuje plan z 17.11 (wygasanie w rocznicę
dołączenia, `PLAN_PUNKTY_ROCZNICA_2026-11-17.md`), z którego nic nie zostało zbudowane. **Nic z tego dokumentu nie jest zbudowane**;
są testy charakterystyki, odegranie na bazie izolowanej i projekt zmiany.

## 1. Streszczenie

1. **Dziś kod wyzeruje punkty wszystkim klientkom Boczków 1 stycznia 2027.** Odegrane na żywym serwerze z udawanym zegarem (rozdz. 4).
   Produkcja ma `reset_roczny = 1` i `ostatni_reset_rok = 2026` od 13.07.2026. Na kontach jest 16 946 pkt u 79 osób i przybywa ~9 000 pkt
   miesięcznie. **Coś musi się zmienić przed 31.12.2026.**
2. Nowa zasada da się osiągnąć w dwóch krokach: **(a) bezpiecznik** — jedno pole w ustawieniach Boczków (`ostatni_reset_rok` 2026 → 2027)
   sprawia, że 1.01.2027 nic nie wygasa, a 1.01.2028 reset rusza dokładnie tak, jak chce właściciel (odegrane, rozdz. 4); **(b) właściwa
   zmiana w kodzie** — jawna data następnego resetu zamiast licznika roku, poprawne daty i teksty dla klientek (dziś apka mówi „ważne do
   31 grudnia 2026”), historia bez ucinania, koniec pułapki przełącznika, opcjonalnie 30-dniowe ostrzeżenie.
3. Sam bezpiecznik to zapis w bazie produkcyjnej — tylko na wyraźne „tak”. Jeśli właściwa zmiana wejdzie przed ~20.12.2026, bezpiecznik
   nie jest potrzebny (data 2028-01-01 ustawi się w panelu).
4. Do rozstrzygnięcia: czy po 1.01.2028 reset ma wracać co roku (1.01.2029…), czy to jednorazowy reset; czy wchodzi 30-dniowe ostrzeżenie;
   co dokładnie ma widzieć klientka w apce przez 2027 rok.

## 2. Stan dziś — kod (`routes/lojalnosc.js`, stan `cf0c96b`)

| Co | Gdzie | Zachowanie dziś |
|---|---|---|
| Przebieg resetu | `tickResetRoczny` :1275, wołany z `tickHarmonogramu` co 60 s (pierwszy raz ~5 s po starcie) | `rok = new Date().getFullYear()`; szuka salonów `reset_roczny = 1 AND COALESCE(ostatni_reset_rok,0) < rok` |
| Claim | `UPDATE Lojalnosc_Ustawienia SET ostatni_reset_rok = rok …` :1282 | atomowy — z trzech procesów produkcji wygrywa jeden |
| Co zeruje | :1289–1298 | dla każdej osoby `SUM(zmiana)` z wpisów `created_at < '<rok>-01-01 00:00:00'` o saldzie > 0 → jeden wpis `WYGASNIECIE` = −saldo, `ref_id = WYGAS@<rok>@<id>` (UNIQUE) |
| Co zostaje | j.w. | punkty naliczone po północy 1 stycznia; konta z saldem 0 pomijane |
| Dziennik | :1304 | `KLUB RESET ROCZNY`: „Punkty z <rok−1> wygasły — N kont” |
| Data ważności dla apki | `punkty_do` :2829 | zawsze `<bieżący rok>-12-31` — dziś „ważne do 31.12.2026” |
| Historia w apce | filtr :2795 | od 1 stycznia bieżącego roku — w 2027 schowa wpisy z 2026, choć punkty będą ważne |
| Zapis ustawień | `loj_ustawienia_zapisz` :1717, pułapka :1736 | licznik roku ustawia się tylko przy PIERWSZYM włączeniu; ponowne włączenie zostawia stary → pierwszy przebieg zeruje od ręki |
| Panel | `public/index.html` :8791–8793 | „Punkty kasują się na koniec roku (1 stycznia)” |
| Apka Klubu | `public/klub.html` :1498 zasady, :1505 FAQ | „ważne do <data>”, „1 stycznia naliczają się od nowa” |

Północ liczona jest zegarem procesu Node (na Hostingerze prawdopodobnie UTC → reset o 01:00 czasu polskiego); baza ma czas polski.

## 3. Stan dziś — dane (produkcja, wyłącznie SELECT, 25.11.2026)

- Klub ma tylko salon Boczki (feature `lojalnosc`); ustawienia: 1 pkt za 10 zł, bonus 20, `reset_roczny = 1`, `ostatni_reset_rok = 2026`.
- Konta: 80 (pierwsze 10.07.2026, ostatnie 23.11.2026). Saldo łączne **16 946 pkt** u 79 osób, maksimum 1013.
- Nigdy nie było wygaśnięcia (0 wpisów `WYGASNIECIE`).

| miesiąc 2026 | naliczone | zużyte |
|---|---|---|
| lipiec | 121 | 101 |
| sierpień | 2 790 | 0 |
| wrzesień | 3 920 | 1 215 |
| październik | 6 035 | 736 |
| listopad (do 25.) | 8 707 | 2 575 |

Źródła punktów od startu: sprzedaż 15 209, zadatki 1 745, bonusy 1 560, ręczne 2 704, automaty 350; odebrane nagrody −4 250 (19 odbiorów).
Szacunek: przy obecnym tempie na 31.12.2026 na kontach będzie ok. 25 tys. pkt, a na 31.12.2027 rzędu 100 tys. i więcej. Reset 1.01.2028
skasuje dużo więcej niż skasowałby 1.01.2027 — komunikacja i ostrzeżenie z wyprzedzeniem robią się ważniejsze, nie mniej ważne.

## 4. Odegranie na żywym serwerze (baza izolowana, kod produkcyjny `cf0c96b`, udawany zegar)

Skrypt: `narzedzia/testy-integracyjne/klub-reset-odegranie.js` (zasiew / sprawdz / sprzataj), serwer:
`CZAS_UDAWANY=… node -r ./narzedzia/proby/skrypty/czas-udawany-preload.js -r dotenv/config server.js dotenv_config_path=.env.test`.
Zasiew: 1001 = 350 pkt z 2026 + 40 pkt naliczone 1.01.2027 o 00:30; 1002 = 80 (2026); 1003 = 0 (300 − 300 w 2026); 1004 = 500 (czerwiec 2027).

| scenariusz | licznik w bazie | zegar | wynik |
|---|---|---|---|
| S1 jak produkcja | 2026 | 1.01.2027 10:00 | **reset**: 1001 −350 (zostaje 40), 1002 −80, 1003 pominięta; licznik → 2027; dziennik „Punkty z 2026 wygasły — 2 kont” |
| S2 bezpiecznik | 2027 | 1.01.2027 10:00 | **nic** nie wygasa, licznik bez zmian |
| S3 bezpiecznik | 2027 | 1.01.2028 10:00 | **reset**: 1001 −390, 1002 −80, 1004 −500 (wszystko sprzed 1.01.2028); licznik → 2028; „Punkty z 2027 wygasły — 3 kont” |

Wniosek: mechanizm zerowania działa dokładnie tak, jak w nowej koncepcji — tylko **rok** jest zły. S2+S3 pokazują, że samo przestawienie
licznika na 2027 realizuje „reset 1.01.2028, potem od nowa”. Po S3 reset wróciłby co roku (2029…), bo kod jest roczny.

## 5. Nowa zasada — interpretacja

Przyjęte rozumienie: punkty zbierane od startu Klubu są ważne do 31.12.2027; 1.01.2028 saldo każdej osoby schodzi do zera jednym
wpisem (jak dziś), punkty naliczone 1.01.2028 i później zostają. „U wszystkich” = wszystkie konta Boczków (innych salonów z Klubem nie ma).

**Pytania do właściciela:**
1. Po 1.01.2028: reset **co roku** (1.01.2029 itd., dzisiejszy kod) czy **jednorazowo** i potem bezterminowo / nowa decyzja? Projekt
   poniżej obsługuje oba (data następnego resetu + opcja „co roku”).
2. Czy wchodzi stałe 30-dniowe ostrzeżenie w apce i kartotece (grudzień 2027), jak w planie z 17.11?
3. Co klientka widzi w 2027: „Punkty są ważne do 31 grudnia 2027” (rekomendacja) — dziś widzi „do 31 grudnia 2026”, co od 1.01.2027
   zmieniłoby się samo na „do 31 grudnia 2027”, ale do końca 2026 jest nieprawdą względem nowej zasady.
4. Czy bezpiecznik (jedno pole w bazie) wchodzi od razu, czy czekamy na pełną zmianę — zależy od tego, kiedy ma być „ruszaj”.

## 6. Projekt zmiany (na „ruszaj”)

**Paczka A — jawna data resetu zamiast licznika roku (2–3 h).** Kolumna `Lojalnosc_Ustawienia.nastepny_reset DATE NULL` (ALTER
idempotentny). `tickResetRoczny` → `tickReset`: salony z `reset_roczny = 1 AND nastepny_reset <= CURDATE()`; claim = przesunięcie daty
o rok (albo `NULL`, gdy jednorazowo — wg decyzji 1); zerowanie wpisów `created_at < nastepny_reset 00:00` (z zegara bazy, czyli czasu
polskiego — koniec zależności od strefy procesu); `ref_id = WYGAS@<data>@<id>`. Migracja: salonom z `reset_roczny = 1` bez daty wpisać
`<ostatni_reset_rok + 1>-01-01` (Boczki: 2027-01-01) — **i to właśnie panel ma pozwolić zmienić na 2028-01-01** (jedno pole daty
w ustawieniach Klubu, admin). Zapis ustawień nigdy nie wyzerowuje od ręki: włączenie bez daty = pierwszy 1 stycznia w przyszłości.

**Paczka B — co widzi klientka i recepcja (1–2 h).** `punkty_do = nastepny_reset − 1 dzień` (dziś: 31.12.2027); historia w apce od
ostatniego wpisu `WYGASNIECIE` tej osoby, a nie od 1 stycznia; teksty w `klub.html` (zasady, FAQ) i w panelu z datą zamiast
„koniec roku / 1 stycznia”; kartoteka klientki pokazuje tę samą datę.

**Paczka C — ostrzeżenie 30 dni (1–2 h, jeśli decyzja 2 = tak).** Pasek w apce i kafel w kartotece od 2.12.2027; powiadomienia push
30/7/1 dzień przez istniejący silnik automatów (typ `WYGASANIE`, `ROCZNICA` jest zajęta).

**Paczka D — ustawienie i komunikat (15 min + treść).** Właściciel w panelu ustawia 1.01.2028; wpis w Dzienniku; komunikat do klientek
wg decyzji właściciela.

**Bezpiecznik doraźny (jeśli A nie wejdzie przed ~20.12.2026):** `UPDATE Lojalnosc_Ustawienia SET ostatni_reset_rok = 2027 WHERE
tenant_id = 'boczki-salon-glowny-001'` — jeden wiersz, zapis produkcyjny, tylko na „tak”. Skutek: 1.01.2027 nic, 1.01.2028 reset (S2/S3).
Słabość: apka do 31.12.2026 nadal mówi „do 31 grudnia 2026”, a w 2027 ucina historię do 1 stycznia; przełącznika nie wolno ruszać.

**Ryzyka:** trzy procesy produkcji — claim już jest atomowy (S1 nie zdublował); `UNIQUE(tenant, zrodlo, ref_id)` chroni przed dublem;
północ po zegarze procesu vs bazy (paczka A przenosi na bazę); przełącznik w panelu (dziś pułapka, paczka A usuwa); pula ~100 tys. pkt
na koniec 2027 — reset bez ostrzeżenia to realne niezadowolenie klientek.

## 7. Testy wykonane 25.11.2026

- `tests/klub-reset-2028.test.js`: **5 testów charakterystyki** (przejdą dziś, utrwalają obecne zachowanie: reset 1.01.2027 z parametrami
  jak na produkcji, bezczynność 25.11.2026, bezpiecznik licznika 2027/2028, pułapka przełącznika, `punkty_do = 2026-12-31` w apce) +
  **10 `test.todo`** z zachowaniem docelowym do odhaczenia przy wdrożeniu.
- Odegranie S1/S2/S3 na bazie izolowanej (rozdz. 4), baza posprzątana (0 wpisów próbnych, reset wyłączony dla demo-test).
- Pełny zestaw `npm test` po dopisaniu testów: wynik w sekcji 9.
- Produkcja: wyłącznie odczyt (rozdz. 3). Żadnych zmian w kodzie aplikacji, w danych ani w ustawieniach.

## 8. Decyzje do podjęcia

1. Co roku od 2028 czy jednorazowo 1.01.2028. 2. Ostrzeżenie 30 dni: tak/nie. 3. Treść dla klientek w 2027 („ważne do 31 grudnia 2027”).
4. Bezpiecznik teraz czy pełna zmiana przed 20.12. 5. Czy nowe salony dostają tę samą zasadę domyślnie (dziś reset domyślnie wyłączony).

## 9. Wynik pełnego zestawu testów

Pełny zestaw po dopisaniu testów (25.11.2026): Test Suites: 92 passed, 92 total · Tests: 10 todo, 1429 passed, 1439 total — bez regresji; 10 pozycji „todo” to zachowanie docelowe, nie błędy.

## 10. ZBUDOWANE 25.11.2026 — data resetu ustawiana przez salon (gałąź `klub-data-resetu`)

Polecenie właściciela (25.11.2026, po pytaniu o datę per salon): *„zróbmy taką datę samodzielnie ustawianą dla każdego z klubu,
jeżeli będzie w lutym to niech przechodzi na dzień później. ważne że musi to być zapisane i widoczne że ‚użytkownik x zmienił datę
resetu na xxxx rok' żeby nie było wątpliwości kto napsuł.”*

**Co się zmieniło (paczka A z rozdz. 6, bez ostrzeżenia 30-dniowego — nie było w poleceniu):**

- `Lojalnosc_Ustawienia` dostaje trzy kolumny (idempotentne `ALTER` przy starcie): `nastepny_reset DATE NULL`,
  `reset_zmienil VARCHAR(100)`, `reset_zmieniono DATETIME NULL`.
- **Panel → Klub → Ustawienia:** zamiast przełącznika „Punkty kasują się na koniec roku (1 stycznia)” jest pole **Data resetu punktów**
  (puste = punkty nie wygasają). Pod polem zdanie: „Najbliższy reset: 1 stycznia 2028. Ostatnia zmiana: Ola, 25.11.2026 10:30.”
- **Zapis (`loj_ustawienia_zapisz`)**: data musi być w przyszłości (dziś i wstecz = błąd, nic nie zapisane — koniec pułapki
  „włączyłem i wyzerowało od ręki”); **29 lutego → 1 marca** (także w roku nieprzestępnym); każda ZMIANA daty = wpis w Dzienniku Zdarzeń
  z akcją `KLUB DATA RESETU`: *„Użytkownik Ola zmienił datę resetu punktów Klubu na 1 stycznia 2028 (25.11.2026 o 10:30; poprzednio:
  reset wyłączony). W tym dniu wszystkie wcześniejsze punkty wygasną i zaczną naliczać się od nowa.”* Zapis bez zmiany daty nie pisze
  do Dziennika i nie podmienia autora. Wyczyszczenie pola = „Użytkownik X wyłączył reset punktów Klubu (…)”. Stare wywołanie bez pola
  daty (sam `reset_roczny`) działa jak dawniej.
- **Tick co 60 s (`tickResetRoczny`)**: reset, gdy `nastepny_reset <= CURDATE()` **po zegarze bazy** (sesja w czasie polskim), nie po
  roku procesu; atomowy claim = podmiana daty tylko gdy w bazie jest wciąż ta sama (jedna z trzech instancji wygrywa); wygasają punkty
  `created_at < '<data> 00:00:00'`, ref `WYGAS@<RRRR-MM-DD>@<id>`; **data przesuwa się sama o rok** (założenie: reset co roku — do
  potwierdzenia, patrz niżej); wpis `KLUB RESET PUNKTÓW`: „Punkty sprzed 1 stycznia 2028 wygasły — 3 kont. Następny reset: 1 stycznia 2029.”
- **Salon sprzed zmiany** (przełącznik włączony, bez daty — stan Boczków): pierwszy tick po wdrożeniu dopisuje datę
  `1 stycznia po liczniku roku, nie wcześniej niż 1 stycznia przyszłego roku` → Boczki dostają **2027-01-01** (to samo, co zrobiłby stary
  kod). **Właściciel musi w panelu wpisać 2028-01-01** — wtedy powstaje wpis w Dzienniku z jego nazwiskiem.
- **Apka klientki (`/klub/me`)**: `punkty_do` = dzień przed resetem (przy 1.01.2028 → „ważne do 31 grudnia 2027”), nowe pole `reset_od`;
  historia nie ucina się już 1 stycznia, tylko od ostatniego wpisu wygaśnięcia (sam wpis nie trafia do apki). `klub.html`: zasady i FAQ
  mówią o dniu resetu salonu, nie o „1 stycznia”. Pomoc (`estelio_pomoc_f.html`, `estelio_pomoc_manager.html`, `klub_pomoc.html`) opisuje nową zasadę.

**Testy:** `tests/klub-data-resetu.test.js` (nowy, zastępuje `klub-reset-2028.test.js`): 24 testy — pomocnicy dat (29.02→1.03,
odrzucanie śmieci, +1 rok, dzień przed, polski zapis, data domyślna dla salonu sprzed zmiany), zapis daty (Dziennik ze zdaniem,
29 lutego, przeszłość odrzucona, jutro wolno, śmieci, brak zmiany = brak wpisu, wyłączenie, RBAC), odczyt ustawień (data + autor),
tick (bez parametru roku, pełny reset 1.01.2028, marzec, przegrany claim), apka (ważne do, historia bez ucięcia, po resecie, bez resetu,
salon sprzed zmiany). `tests/lojalnosc.test.js`: dwa testy ticka dostosowane do daty. **Pełny zestaw: 92 zestawy, 1448 testów, 0 porażek.**

**Próba ekranowa** `narzedzia/proby/klub-data-resetu.json` (serwer 3999, demo-test, Ola): 0 FAIL, 0 błędów JS, 7 zrzutów —
`proby-wyniki/klub-data-resetu-test-2026-11-25-09-30/` (pole daty przed i po zapisie z opisem „kto zmienił”, 29.02→1.03, błąd daty
z przeszłości, trzy wpisy w Dzienniku w jasnym i ciemnym trybie, telefon). Odrzucona data z przeszłości nie zostawiła wpisu.

**Odegranie z udawanym zegarem** (`narzedzia/testy-integracyjne/klub-reset-odegranie.js zasiew 2028-01-01`, serwer z `CZAS_UDAWANY`):
- 1.01.2027 → nic nie wygasło, data dalej 2028-01-01, Dziennik pusty.
- 1.01.2028 → 1001: −390 (350 z 2026 + 40 z 2027), 1002: −80, 1004: −500, 1003 (saldo 0) pominięty; **25 pkt naliczone 1.01.2028 00:30
  zostają** (saldo 25); data → 2029-01-01; Dziennik: „Punkty sprzed 1 stycznia 2028 wygasły — 3 kont. Następny reset: 1 stycznia 2029.”
- Drugi start serwera tego samego dnia → bez dubli (ten sam wynik).
- Stan Boczków sprzed zmiany (przełącznik + licznik 2026, bez daty) z prawdziwym zegarem → tick dopisał **2027-01-01**, nic nie wygasło.
- Baza izolowana posprzątana (0 wpisów punktów demo-test, reset wyłączony), serwer 3999 zatrzymany.

**Do decyzji właściciela (nie blokuje wdrożenia):** 1) po resecie data przesuwa się o rok — jeśli reset ma być jednorazowy, trzeba
to powiedzieć (wtedy po resecie pole się czyści); 2) ostrzeżenie 30 dni przed resetem w apce — nie zbudowane; 3) nowe salony: reset
domyślnie wyłączony (puste pole) — bez zmian.

**Po wdrożeniu na produkcję:** wejść w Klub → Ustawienia → wpisać 2028-01-01 → Zapisz. Do tego czasu Boczki mają datę 2027-01-01
(jak dotąd), więc **termin pozostaje: przed 1.01.2027**.
