# Blokada powtórzonego adresu e-mail — raport wykonania (17.11.2026)

Plan: `docs/PLAN_UNIKALNY_EMAIL_2026-11-16.md`. Gałąź: `email-unikalny-b` (odbita od `dev` = 882eacf).
Nic nie zostało wypchnięte ani wdrożone. Baza produkcyjna nietknięta — wszystkie próby szły na izolowaną
`estelio_test` (port 3307).

---

## 1. Co jest gotowe

| Paczka | Zakres | Stan |
|---|---|---|
| A | rozdzielenie 5 salonów właściciela na jednym adresie | **nie ruszona** — zapis w bazie produkcyjnej, Twoja decyzja |
| B | blokady we wszystkich punktach wejścia + podgląd na żywo w formularzach | **gotowa** |
| C | indeks `UNIQUE uq_licencje_email` zakładany migracją startową | **gotowa** (na produkcji nie założy się, dopóki trwa A — patrz niżej) |
| D | wyłączenie edycji adresu w portalu klienta Stripe | **nie ruszona** — ustawienie w panelu Stripe, Twoja decyzja |

## 2. Zasada

Jeden adres e-mail = jedna licencja salonu, niezależnie od jej statusu. Brak adresu zapisujemy jako `NULL`,
nigdy jako pusty tekst, więc licencji bez adresu może być wiele. Porównanie idzie po `LOWER(TRIM(email))`,
czyli spacje i wielkość liter nie tworzą obejścia. Aliasy w rodzaju `jan+salon2@gmail.com` to osobne adresy —
świadomie, bo to standardowy sposób na dwa konta w jednej skrzynce.

## 3. Nowy moduł

`routes/email-unikalny.js` — jedyne miejsce z normalizacją, zapytaniem o zajętość i treścią komunikatu dla klienta.
Działa zarówno na puli połączeń, jak i na połączeniu wewnątrz transakcji. Błąd bazy nie jest połykany: zgłasza
wyjątek, a wywołujący odmawia zapisu zamiast przepuścić go bez kontroli.

Komunikat dla klienta jest jeden, nie zdradza nazwy ani identyfikatora salonu, który zajmuje adres:

> Na ten adres e-mail jest już zarejestrowany salon w Estelio. Zaloguj się na istniejące konto albo użyj innego
> adresu. Jeśli to pomyłka, napisz: kontakt@estelio.com.pl

## 4. Gdzie blokada działa

| Droga | Plik | Zachowanie |
|---|---|---|
| Zakup przez Stripe | `routes/stripe.js` | odmowa **przed** zapisem zamówienia i przed utworzeniem sesji Checkout — klient nie dochodzi do karty |
| Stary formularz zamówienia | `routes/admin.js` `/zamowienie` | ta sama kontrola |
| Zakładanie salonu z linku | `routes/rejestracja-zaloz.js` | kontrola wewnątrz transakcji; przy odmowie `rollback`, więc token wraca do stanu `nowy` i klient nie traci linku |
| Tworzenie salonu w panelu | `routes/admin.js` `/admin/create_tenant` | odmowa przed zapisem licencji |
| Edycja salonu w panelu | `routes/admin.js` `/admin/update_tenant` | adres innego salonu odrzucony; **własny adres przechodzi** — to jest ścieżka awaryjna admina do zwolnienia adresu |
| Poprawka adresu zamówienia | `routes/admin.js` `/admin/zamowienie_email` | odmowa zanim cokolwiek pójdzie do Stripe |
| Baza | indeks `uq_licencje_email` | łapie wyścig dwóch rejestracji w tej samej sekundzie |

Powtórka przerwanego zakupu nie jest blokowana. Otwarte zamówienie z tego samego adresu z ostatnich 24 godzin
zostawia tylko wpis w logu, bo klient po nieudanej płatności musi móc spróbować ponownie.

Komunikat przy zakładaniu salonu z linku ma dopisek: *„Jeśli ten adres podałeś przy zakupie, napisz do nas —
poprawimy go w zamówieniu i wyślemy link ponownie. Twój link pozostaje ważny.”* Admin poprawia adres przez
`/admin/zamowienie_email` i wysyła ten sam link.

## 5. Podgląd na żywo w formularzach

Dwa nowe odczyty:

- `GET /api/rejestracja/check-email?email=` — publiczny, z tym samym ogranicznikiem zapytań co sprawdzanie loginu.
  Odpowiada wyłącznie `dostepny` i komunikatem. Nie przyjmuje parametru wykluczającego salon, bo w publicznym
  wariancie dałoby to narzędzie do sprawdzania, do kogo należy adres.
- `GET /api/admin/check-email?email=&pomin=` — tylko za sesją admina, bo to wariant z wykluczeniem salonu.

Formularze pytają o to po opuszczeniu pola: strona zamówienia pisze pod polem na czerwono i wstrzymuje wysyłkę,
rejestracja i panel admina pokazują komunikat w swoim polu błędu. Przycisk nie jest wygaszany — wysyłka jest
zatrzymywana w chwili kliknięcia, żeby nie dało się zostawić martwego przycisku przy chwilowym braku sieci.
Brak odpowiedzi serwera nie blokuje formularza: rozstrzyga wtedy kontrola po stronie serwera przy zapisie.

## 6. Migracja (paczka C)

Przy starcie serwera, w konwencji istniejącej migracji `uq_licencje_id_bazy`:

1. `UPDATE Licencje SET email = NULL WHERE TRIM(email) = ''`
2. zliczenie powtórzonych adresów
3. `ALTER TABLE Licencje ADD UNIQUE INDEX uq_licencje_email (email)` **tylko gdy powtórzeń jest zero**

Przy powtórzeniach indeks nie powstaje, a w logu ląduje ostrzeżenie z listą adresów i odsyłaczem do planu.
Start serwera nigdy nie pada przez dane. Oznacza to, że **na produkcji indeks nie powstanie, dopóki nie zrobisz
paczki A** — blokady w kodzie działają niezależnie od niego.

Kolacja kolumny to `utf8mb4_unicode_ci`, więc indeks sam z siebie nie rozróżnia wielkości liter. Sprawdzone.

## 7. Testy

| Rodzaj | Wynik |
|---|---|
| `npm test` | **1294 zielonych** w 83 plikach (przed zmianą 1279) |
| `tests/email-unikalny.test.js` (nowy) | 11 testów modułu: normalizacja, format, zajętość, wykluczenie własnego salonu, błąd bazy, rozpoznanie duplikatu z indeksu |
| `tests/rejestracja-zaloz.test.js` | 4 nowe przypadki: adres zajęty, wyścig na indeksie, licencja bez adresu, błąd bazy przy kontroli |
| `narzedzia/testy-integracyjne/email-unikalny.js` (nowy) | **27 z 27** na żywym serwerze i izolowanej bazie |

Próba integracyjna odmawia startu, jeśli nie wskazuje bazy testowej na porcie 3307.

Sprawdziła między innymi, że: zajęty adres nie tworzy zamówienia ani nie dociera do Stripe; token po odmowie
wraca do stanu `nowy` i nie powstaje „pół-salon”; pusty adres zapisuje się jako `NULL`; edycja salonu na jego
własny adres przechodzi; wariant z wykluczeniem salonu jest niedostępny bez tokenu admina; a bezpośredni
`INSERT` drugiej licencji z tym samym adresem — także zapisanym wielkimi literami — odbija się od indeksu.

## 8. Zrzuty ekranu (izolowane, port 3999)

Katalog `proby-wyniki/` (poza repozytorium):

- `email-unikalny-zamow-test-2026-11-17-15-32` — strona zamówienia: komunikat pod polem, zatrzymana wysyłka,
  powrót do zwykłej podpowiedzi po wpisaniu wolnego adresu, widok na telefonie
- `email-unikalny-rejestracja-test-2026-11-17-15-32` — rejestracja z linku: kreator nie przechodzi do kroku 2
- `email-unikalny-admin-test-2026-11-17-15-33` — panel admina: okno edycji salonu i kreator nowego salonu

Scenariusze prób dla dwóch stron publicznych leżą w `narzedzia/proby/`. Scenariusz panelu admina został
**celowo poza repozytorium**, bo zawiera hasło administratora.

## 9. Co jeszcze warto wiedzieć

1. **Narzędzie prób** `narzedzia/proba-ekranu.js` dostało dwie opcje scenariusza: `strona` (inny adres niż
   `/index.html`) i `bezLogowania` (strony publiczne nie mają sesji salonu). Ten plik **nie jest w commicie** —
   masz w nim własne niezacommitowane zmiany z pracy nad filmami, więc zostawiam go tak, jak był, do Twojej decyzji.
2. **Znalezisko poboczne, nie ruszone:** zapis w oknie edycji salonu nie wysyła pola `status`, a serwer przyjmuje
   `d.status || 'aktywny'`. Edycja dowolnego salonu ustawia go więc z powrotem na „aktywny”, nawet jeśli był
   zablokowany. To zachowanie sprzed dzisiejszej zmiany.
3. **Nadal otwarte z pamięci:** webhooki Stripe dopasowują salon po adresie z `LIMIT 1`. Po paczce A i C adres
   będzie jednoznaczny, ale dopasowanie po `stripe_subscription_id` zostaje jako osobne zadanie.
4. **Do wyczyszczenia na produkcji:** Boczki mają w bazie identyfikator subskrypcji Papillon. Odłożone przez Ciebie.

## 10. Czego potrzebuję od Ciebie

1. Zgoda na `push na dev` (albo najpierw kopia runtime logu, jeśli trwa obserwacja).
2. Decyzja w sprawie paczki A: czy rozdzielam 5 adresów aliasami `+papillon`, `+studio-shape`, `+mariusz-shape`,
   `+padibeauty`, zostawiając Boczkom adres główny. To zapis w bazie produkcyjnej — bez Twojego „tak” nie ruszam.
3. Paczka D: wyłączenie edycji adresu w portalu klienta Stripe. Pięć minut w panelu, po Twojej stronie.
