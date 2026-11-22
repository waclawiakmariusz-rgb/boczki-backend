# Jeden e-mail = jeden salon. Raport i plan wdrożenia

**Data:** 16–17.11.2026 · **Autor:** Claude (na polecenie właściciela) · **Status:** PLAN — nic nie wdrożone, start każdej paczki na „ruszaj”
**Podstawa:** kod gałęzi `dev` (882eacf) i odczyt bazy produkcyjnej (wyłącznie SELECT/SHOW, 16.11.2026 20:00–20:30)
**Powiązane:** `docs/terminarz-audyt/PLAN_POPRAWY_2026-11-16.md` (wzorzec paczek), pamięć `papillon_spa_subskrypcja_2026-11-16`

---

## 1. Streszczenie dla właściciela

Estelio nie sprawdza, czy podany adres e-mail należy już do innego salonu. Ten sam adres może dziś trafić do bazy **siedmioma
drogami** i żadna z nich tego nie kontroluje. Kolumna `Licencje.email` nie ma indeksu unikalności, choć login i identyfikator
salonu już go mają.

To nie jest ryzyko teoretyczne. **5 listopada problem wystąpił na produkcji:** założenie drugiego salonu (Papillon Spa) na adresie
właściciela sprawiło, że opłata za Papillon przedłużyła licencję **Boczków**, a Boczkom wpisano cudzy identyfikator subskrypcji.
16 listopada anulowanie tej subskrypcji zablokowałoby Boczki — udało się tego uniknąć tylko ręczną podmianą danych w panelu Stripe.

Proponuję cztery paczki, w tej kolejności: **A** uporządkowanie danych (5 salonów właściciela na jednym adresie), **B** blokady
w aplikacji we wszystkich siedmiu punktach, **C** indeks unikalności w bazie, **D** wyłączenie edycji adresu w portalu Stripe.
Łącznie ok. 3–4 godzin pracy. Każda paczka działa samodzielnie i da się wdrożyć osobno.

---

## 2. Dlaczego to robimy — co się wydarzyło

| Kiedy | Co się stało |
|---|---|
| 10.04.2026 | Boczki zakładane na `waclawiak.mariusz@gmail.com` |
| 04–06.2026 | Trzy salony testowe właściciela na **tym samym** adresie (studio-shape, mariusz-shape, padibeauty) |
| 05.11.2026 | Papillon Spa — zakup przez Stripe, **ten sam adres**. Faktura próbna 0 zł wywołuje webhook `invoice.paid` → `UPDATE Licencje … WHERE email = ? LIMIT 1` trafia w **pierwszy** wiersz z tym adresem, czyli **boczki-salon-glowny-001**. Skutek: Boczkom przedłużono ważność do 5.12 i wpisano identyfikator subskrypcji Papillon |
| 16.11.2026 | Właściciel chce anulować subskrypcję Papillon. Webhook `customer.subscription.deleted` działa tak samo → ustawiłby **Boczkom** status `nieaktywny` i odciął logowanie |
| 16.11.2026 20:18 | Obejście: podmiana `metadata.email` subskrypcji w panelu Stripe na adres spoza bazy, dopiero potem anulowanie. Kontrola po fakcie: wszystkie 5 licencji nadal `aktywny` |

Wniosek: dopóki e-mail nie jest unikalny, **każda klientka z dwoma salonami** na jednym adresie jest narażona na to samo —
odnowienie trafiające w zły salon, blokadę niewłaściwego salonu, reset hasła prowadzący do cudzego konta.

---

## 3. Stan obecny — inwentaryzacja

### 3.1 Siedem dróg, którymi e-mail trafia do bazy

| # | Droga | Plik : linia | Kontrola dziś |
|---|---|---|---|
| 1 | Zakup publiczny (formularz → Stripe Checkout) | `routes/stripe.js:145` `/stripe/create-checkout` → `INSERT INTO Zamowienia` (:200) | tylko format `/^\S+@\S+\.\S+$/` |
| 2 | Starszy formularz zamówienia (admin wysyła token ręcznie) | `routes/admin.js:537` `/zamowienie` → `INSERT INTO Zamowienia` (:548) | tylko format |
| 3 | Założenie salonu z tokenu | `routes/admin.js:709` `/rejestracja/zaloz` → `routes/rejestracja-zaloz.js:75` `INSERT INTO Licencje` | sprawdza **tylko login** |
| 4 | Ręczne założenie salonu przez admina | `routes/admin.js:314` `/admin/create_tenant` (INSERT :331) | **brak**, zapisuje `email \|\| ''` |
| 5 | Edycja salonu w panelu admina | `routes/admin.js:386` `/admin/update_tenant` (UPDATE :391) | **brak** |
| 6 | Poprawka adresu zamówienia przez admina | `routes/admin.js:601` `/admin/zamowienie_email` → `Zamowienia` + `Licencje` + klient Stripe | tylko format |
| 7 | Klient w portalu Stripe („Zaktualizuj dane”) | poza naszym kodem; zmienia adres **tylko w Stripe** | **brak** — powstaje rozjazd Stripe ↔ baza |

Uwaga do drogi 3: adres licencji bierze się **z zamówienia**, a dopiero w drugiej kolejności z formularza
(`routes/admin.js:740`: `emailLicencji = zakup?.email || email`). Blokada przy zakupie (droga 1) zamyka więc też tę drogę,
ale nie dla tokenów wystawianych ręcznie, bez wiersza w `Zamowienia`.

### 3.2 Baza produkcyjna (odczyt 16.11.2026)

| Rzecz | Stan |
|---|---|
| Indeksy `Licencje` | `PRIMARY(login)`, `uq_licencje_id_bazy(id_bazy)` UNIQUE, `idx_licencje_id_bazy(id_bazy)` |
| Kolumna `email` | `varchar(255) NULL`, **bez indeksu**, kolacja `utf8mb4_unicode_ci` |
| Licencji łącznie | 10, w tym 1 z **pustym tekstem** zamiast adresu (`lala-studio-9280`) — przy indeksie UNIQUE drugi taki wpis byłby odrzucony, dlatego paczka C zamienia go na `NULL` |
| Duplikaty adresów | **jedna grupa: 5 salonów właściciela** na `waclawiak.mariusz@gmail.com` (boczki-salon-glowny-001, papillon-spa-b423e98b, studio-shape-9319, mariusz-shape-9369, salon-padibeauty-5147) |
| Usuwanie salonów | w kodzie **nie istnieje** `DELETE FROM Licencje` — salon zostaje w bazie na zawsze |

Dobra wiadomość: kolacja `utf8mb4_unicode_ci` jest nieczuła na wielkość liter, więc indeks UNIQUE sam złapie
`Jan@Firma.pl` i `jan@firma.pl` jako ten sam adres. Normalizacja w kodzie i tak zostaje, dla spójności zapisu.

### 3.3 Trzy skutki dzisiejszego stanu

1. **Odnowienia trafiają w zły salon.** `invoice.paid` przedłuża pierwszy wiersz z danym adresem (`routes/stripe.js:377–385`).
   Salon, który zapłacił, może wygasnąć; inny dostaje darmowy miesiąc.
2. **Blokady trafiają w zły salon.** `invoice.payment_failed` (`routes/stripe.js:446–455`) i `customer.subscription.deleted` (:485) działają tak samo.
   Nieudana płatność jednego salonu wstrzymuje drugi.
3. **Reset hasła prowadzi donikąd albo nie tam.** `routes/auth.js:113` szuka konta po adresie z `LIMIT 1`.

### 3.4 Pułapka wykryta przy analizie (ważna dla paczki C)

W `routes/rejestracja-zaloz.js:82` każdy błąd `ER_DUP_ENTRY`, który nie jest kolizją `id_bazy`, jest zwracany jako
`wynik: 'login_zajety'`. Po dodaniu indeksu UNIQUE na e-mail klient z zajętym adresem zobaczyłby komunikat
**„Ten login jest już zajęty”** — nieprawdziwy i prowadzący w ślepy zaułek. Rozróżnienie błędów musi wejść **razem** z indeksem.

---

## 4. Zasada docelowa

1. Jeden adres e-mail należy do **jednej** licencji, niezależnie od jej statusu (`aktywny`, `nieaktywny`, `opóźniony`).
   Uzasadnienie: webhooki Stripe, reset hasła i panel rozliczeniowy szukają po adresie, a salony nigdy nie znikają z bazy.
2. Brak adresu zapisujemy jako `NULL`, nigdy jako pusty tekst. (Dziś `create_tenant` zapisuje `''`; przy indeksie UNIQUE dwa
   puste teksty by się zderzyły, podczas gdy wiele `NULL` jest dozwolonych.)
3. Aliasy (`imie+salon@gmail.com`) i kropki w Gmailu traktujemy jako **różne** adresy. To świadoma decyzja: nie udajemy,
   że znamy reguły każdego dostawcy poczty, a właścicielowi daje to prostą drogę do rozdzielenia własnych salonów.
4. Jeden wspólny pomocnik `normalizujEmail()` (trim → małe litery → `''` na `null` → kontrola formatu) używany we wszystkich
   siedmiu punktach. Jeden komunikat dla klienta:
   > „Na ten adres e-mail jest już zarejestrowany salon w Estelio. Zaloguj się na istniejące konto albo użyj innego adresu.
   > Jeśli to pomyłka, napisz: kontakt@estelio.com.pl”
5. **Ścieżka awaryjna (zasada „tryb ekspert”):** skoro salony nigdy nie są usuwane, adres zajęty przez stary salon musi dać się
   zwolnić. Robi to admin, zmieniając adres tamtego salonu w panelu (droga 5). Ta droga **nie może** być zablokowana przed sobą samą —
   kontrola wyklucza edytowany salon z porównania.

---

## 5. Plan wdrożenia

### Paczka A — uporządkowanie danych (warunek konieczny dla paczki C)

| | |
|---|---|
| Cel | zero duplikatów w `Licencje` przed założeniem indeksu |
| Zakres | 5 salonów właściciela na jednym adresie |
| Czas | 15 min po decyzji |
| Ryzyko | zmiana adresu zmienia odbiorcę powiadomień i faktur dla tych salonów |

1. Rozdzielić adresy. Propozycja: Boczki zostają na adresie głównym (to salon produkcyjny), pozostałe cztery dostają aliasy
   `waclawiak.mariusz+papillon@gmail.com`, `+studio-shape`, `+mariusz-shape`, `+padibeauty`. Poczta trafia do tej samej skrzynki.
2. Zapis przez panel admina (`/admin/update_tenant`) albo jednym `UPDATE`. **Zapis w bazie produkcyjnej — tylko na polecenie.**
3. Kontrola: `SELECT LOWER(TRIM(email)), COUNT(*) FROM Licencje GROUP BY 1 HAVING COUNT(*) > 1` → zero wierszy.
4. Osobno, już odłożone przez właściciela („sprzątaniem zajmiemy się innym razem”): usunięcie z Boczków i Papillon
   identyfikatora subskrypcji `sub_1UYMm9…`.

### Paczka B — blokady w aplikacji (działają bez indeksu, mogą wejść przed paczką C)

| | |
|---|---|
| Cel | żaden interfejs nie przyjmuje adresu należącego do innej licencji |
| Czas | 2–3 h z testami |
| Ryzyko | fałszywe odrzucenie zakupu — ograniczone przez wykluczenie własnego salonu przy edycji i przez dopuszczenie powtórnego zakupu |

1. **Pomocnik.** `normalizujEmail(wartosc)` + `emailZajety(db, email, pomijanyTenantId)` w jednym module (np. `routes/_email.js`),
   używane przez wszystkie punkty. Jedno miejsce na komunikat.
2. **Droga 1 — zakup (`routes/stripe.js:145`).** Kontrola **przed** `INSERT INTO Zamowienia` i przed utworzeniem sesji Checkout,
   żeby klient nie dotarł do formularza karty. Dodatkowo: otwarte zamówienie (`status IN ('nowe','wyslano_link')`) z tym samym
   adresem z ostatnich 24 h → tylko ostrzeżenie w logu, **bez blokady** (powtórka po przerwanym zakupie musi działać).
3. **Droga 2 — stary formularz (`routes/admin.js:537`).** Ta sama kontrola.
4. **Droga 3 — zakładanie salonu (`routes/rejestracja-zaloz.js`).** Druga linia obrony **wewnątrz transakcji**, tuż przed
   `INSERT INTO Licencje`: jeśli adres zajęty → `rollback` i nowy wynik `email_zajety`. Token wraca do stanu `nowy`, więc klient
   nie traci linku. `routes/admin.js:709` tłumaczy ten wynik na komunikat z punktu 4.4 plus zdanie: „napisz do nas, poprawimy adres”.
   Admin poprawia przez `/admin/zamowienie_email` i wysyła ten sam link ponownie.
5. **Rozróżnienie błędów duplikatu** (`routes/rejestracja-zaloz.js:82`): sprawdzać nazwę indeksu w treści błędu —
   `uq_licencje_email` → `email_zajety`, `PRIMARY`/login → `login_zajety`. Bez tego paczka C da fałszywy komunikat (p. 3.4).
6. **Drogi 4 i 5 — panel admina.** Kontrola z wykluczeniem własnego `id_bazy` (edycja salonu na jego własny adres musi przejść),
   `email || ''` → `normalizujEmail()`. Błąd wraca do `public/admin.html` i pokazuje się **przy polu**, nie jako samo `alert`.
7. **Droga 6 — poprawka adresu zamówienia (`routes/admin.js:601`).** Kontrola przed zapisem; gdy odrzucona, **nie** zmieniać
   klienta w Stripe (dziś zmiana leci do Stripe nawet przy problemach z bazą).
8. **Sprawdzanie na żywo.** Nowy `GET /api/rejestracja/check-email?email=` na wzór istniejącego `/rejestracja/check-login`
   (`routes/admin.js:685`), z tym samym ogranicznikiem zapytań. Odpowiedź tylko `dostepny: true/false` — **nigdy** nazwa salonu,
   który zajmuje adres (ochrona przed wyliczaniem klientów).
9. **Front.** `public/rejestracja.html:583` ma gotowy wzorzec dla loginu — to samo dla adresu w formularzu zakupu
   i w modalu admina: sprawdzenie po opuszczeniu pola, blokada przycisku przy adresie zajętym.

### Paczka C — indeks unikalności w bazie (dopiero po A i B)

| | |
|---|---|
| Cel | ostatnia linia obrony, niezależna od kodu |
| Czas | 30 min |
| Ryzyko | przy duplikatach `ALTER` się nie powiedzie — dlatego migracja sama sprawdza i odmawia zamiast przerywać start |

1. Migracja startowa, w konwencji istniejących `[migration] … OK`:
   `UPDATE Licencje SET email = NULL WHERE TRIM(email) = ''` → zliczenie duplikatów → jeśli 0, to
   `ALTER TABLE Licencje ADD UNIQUE INDEX uq_licencje_email (email)`; jeśli >0, **nie dodawać**, wypisać ostrzeżenie z listą
   adresów. Start serwera nigdy nie może paść przez dane.
2. Uruchomienie najpierw na bazie izolowanej `estelio_test`, potem produkcja.
3. Kolacja kolumny to `utf8mb4_unicode_ci`, więc indeks jest nieczuły na wielkość liter — bez dodatkowej pracy.
4. Powiązanie z otwartą decyzją z incydentu 3.11: czy migracje mają kończyć się przed `app.listen`.

### Paczka D — Stripe (bez kodu)

1. Dashboard Stripe → Settings → Customer portal → Customer information: **wyłączyć** klientom edycję adresu e-mail.
   Zmiana adresu przechodzi wtedy wyłącznie przez admina, który pilnuje spójności bazy i Stripe. Czas: 5 minut.
2. Gdyby edycja miała zostać włączona: obsłużyć webhook `customer.updated` z tą samą kontrolą (odrzucić zmianę i powiadomić
   admina, gdy adres zajęty). To już praca programistyczna, ok. 1 h.

### Poza planem, ale powiązane

Dopasowywanie webhooków po `stripe_subscription_id` / `stripe_customer_id` zamiast po adresie (pamięć
`todo_tenant_id_email_renewal`, pkt 2). Po paczce C adres staje się jednoznaczny i dzisiejsze zapytania przestają trafiać
w cudzy salon, ale dopasowanie po identyfikatorze jest i tak właściwsze — zostaje jako osobne zadanie.

---

## 6. Ryzyka i jak je ograniczam

| Ryzyko | Ograniczenie |
|---|---|
| Blokada uderzy w prawdziwego klienta, który po prostu powtarza przerwany zakup | otwarte zamówienie z tym samym adresem nie blokuje; blokuje dopiero **istniejąca licencja** |
| Edycja salonu na jego własny adres zostanie odrzucona | kontrola wyklucza edytowany `id_bazy` |
| Klient utknie z zajętym adresem i bez wyjścia | token wraca do stanu `nowy`, komunikat kieruje do kontaktu, admin ma ścieżkę poprawki adresu |
| Indeks nie powstanie przez duplikaty i coś pęknie po cichu | migracja sprawdza przed `ALTER` i głośno ostrzega, zamiast przerywać start |
| Klient zobaczy „login zajęty” zamiast „adres zajęty” | rozróżnienie błędów duplikatu wchodzi razem z indeksem (p. 5.B.5) |
| Ktoś użyje `check-email` do sprawdzania, czy salon jest klientem | ogranicznik zapytań i odpowiedź bez nazwy salonu |

---

## 7. Testy i odbiór

**Jednostkowe** (jest, `npm test`, dziś 83 pliki):
- `normalizujEmail`: spacje, wielkie litery, pusty tekst → `null`, zły format.
- `emailZajety`: adres wolny, zajęty przez inny salon, zajęty przez **ten sam** salon przy edycji.
- `zalozSalon` → `email_zajety` z `rollback` i tokenem wracającym do `nowy` (wzorzec: `tests/rejestracja-zaloz.test.js`).
- rozróżnienie `ER_DUP_ENTRY`: indeks loginu → `login_zajety`, indeks e-maila → `email_zajety`.
- `check-email`: wolny / zajęty / zły format, brak nazwy salonu w odpowiedzi.

**Próby ekranowe** (`narzedzia/proba-ekranu.js`, baza izolowana):
- zakup na adres istniejącej licencji → komunikat przy polu, brak przejścia do Stripe, brak wiersza w `Zamowienia`;
- zakup na nowy adres → przebieg bez zmian;
- panel admina: edycja salonu na adres cudzy → błąd przy polu; na własny → zapis przechodzi.

**Odbiór na produkcji po wdrożeniu:**
`SHOW INDEX FROM Licencje` zawiera `uq_licencje_email`; zapytanie o duplikaty zwraca zero wierszy; jedno kontrolne zamówienie
testowe na nowy adres przechodzi do końca.

---

## 8. Decyzje do podjęcia przez właściciela

1. **Adresy dla czterech salonów testowych** — aliasy z `+` czy osobne skrzynki?
2. **Czy nieaktywny salon też blokuje adres?** Rekomendacja: tak. Reset hasła i webhooki działają niezależnie od statusu.
3. **Czy wyłączyć edycję adresu w portalu Stripe?** Rekomendacja: tak — pięć minut, zero kodu, zamyka siódmą drogę.
4. **Czy migrację indeksu uruchamiać przed `app.listen`?** Łączy się z otwartą decyzją z incydentu 3.11.

---

## 9. Kolejność i czas

| Paczka | Zakres | Czas | Zależność |
|---|---|---|---|
| A | rozdzielenie 5 adresów właściciela | 15 min | decyzja 8.1 |
| B | blokady w 7 punktach + `check-email` + front | 2–3 h | — |
| C | `uq_licencje_email` migracją startową | 30 min | A i B |
| D | wyłączenie edycji adresu w Stripe | 5 min | — |

Wdrożenie jak zwykle: gałąź robocza → `npm test` zielone → scalenie do `dev` → push na `dev`. **Na `main` wyłącznie po
wyraźnym poleceniu „push na main”**, a przed pushem kopia runtime logu, jeśli trwa obserwacja.
