# Ustawienia zadatków — wynik wdrożenia redesignu (26.10.2026)

Zasada właściciela: wyłącznie oprawa; logika i funkcjonalność bez zmian. Gałąź `dev`. Bez main/produkcji. Próby: izolowana MariaDB 3307, salon `demo-test` (zapisy wyłącznie na bazie testowej, stan końcowy przywrócony do 50 % / bez zaokrąglenia / tryb PROCENT).

## 1. Mapa (rozdz. 11 pkt 1–2 specyfikacji) — potwierdzona w kodzie

| Element | Ustalenie |
|---|---|
| Widok | `#sekcja-zadatki-config` w `public/index.html`; wejście z menu `pokaz('sekcja-zadatki-config'); wczytajUstawieniaZadatkow()` (bez zmian) |
| Odczyt | `GET /api/ustawienia/zadatki?tenant_id=` → `config {tryb, procent, zaokraglenie, powyzej_max, fallback_procent}` + `progi[]`; pierwszy odczyt tworzy domyślny rekord (`INSERT IGNORE`) — jak dotąd |
| Zapis | `uz_zapisz()` → `POST /api/ustawienia/zadatki` z tym samym body (5 pól z kontrolek `uz-*`); backend normalizuje (0–100 %, zaokrąglenie ∈ {0,5,10}, enumy) i odpowiada `Zapisano ustawienia zadatków.`; front pokazuje `✓ Zapisano!` |
| Tryby | `PROCENT` (pole `uz-procent`) i `KWOTOWY` (progi `Progi_Zadatki` + `uz-powyzej-max` ∈ {OSTATNI_PROG, PROCENT, PUSTE} + `uz-fallback-procent`); bloki przełącza `uz_przelaczTryb()` / `uz_przelaczPowyzej()` przez `style.display` |
| Progi | `uz_dodajProg()` → `POST …/prog` (walidacja > 0 i zadatek ≤ kwota, front i backend), `uz_usunProg(id)` → `confirm('Usunąć ten próg?')` → `DELETE …/prog/:id`; **zapisują się natychmiast**, niezależnie od „Zapisz ustawienia", po czym cały formularz jest przeładowywany z serwera |
| Zaokrąglenie | `zaokraglij(kwota, krok)`: 0 → 2 miejsca po przecinku, 5/10 → `Math.round(kwota / krok) * krok` (backend) |
| Kalkulator | **wyłącznie po stronie serwera**: `POST /api/ustawienia/zadatki/oblicz {tenant_id, kwota_zabiegu}` na **zapisanej** konfiguracji; multisprzedaż (`index.html` ~21065) woła go z ceną bazową zabiegu (ilość 1, przed rabatem) i zwraca `zadatek_proponowany` + `opis` |
| Uprawnienia | front nie ma osobnej kontroli; backend jak dotąd (sesja + tenant) |
| Moment zastosowania | nowe ustawienia działają od następnego wyliczenia w multisprzedaży (każde wyliczenie czyta konfigurację z bazy); otwarte transakcje nie są przeliczane |

## 2. Zmiany

- `public/index.html`: sekcja `#sekcja-zadatki-config` — nowy znacznik (nagłówek z okruszkiem i slotem pomocy, dwie karty), **te same ID `uz-*`, te same `<option value>`, te same wywołania `uz_*`**; `<select id="uz-zaokraglenie">` zostaje w DOM (wizualnie ukryty) jako źródło prawdy dla `uz_zapisz()`, kafle radio tylko go ustawiają; `uz_renderProgi()` — tylko szablon wiersza (te same dane, ten sam `uz_usunProg(id)`); dwa warunkowe hooki prezentacji `window.ZADATKI_PREZENTACJA.poOdczycie(d)` / `.poZapisie()`.
- `public/zadatki-ustawienia.css` *(nowy)* — `.estelio-deposit-settings`, siatka 1,25fr/1fr → jedna kolumna < 920 px, kafle, tryb ciemny; nadpisania globalnych `label` (uppercase) i `input[type=number]` tylko w tym obszarze.
- `public/zadatki-ustawienia.js` *(nowy)* — kafle → select, podpowiedź „Zadatek wyniesie X % kwoty zabiegu", napis „Niezapisane zmiany / Brak niezapisanych zmian", podgląd przez **istniejący** `/oblicz` (jedyny fetch; zero zapisów).
- `tests/zadatki-ustawienia-redesign.test.js` *(7)*; `narzedzia/proby/zadatki-ustawienia.json` (14 sprawdzeń w panelu prób).

## 3. Podgląd — jak rozwiązano zależność z rozdz. 5

Spec zabrania pisania drugiego algorytmu; prawdziwy kalkulator jest tylko na serwerze i liczy z **zapisanej** konfiguracji. Dlatego podgląd (a) woła ten sam `/oblicz`, (b) podsumowanie i kwota opisują ustawienia zapisane w Estelio, (c) gdy formularz ma niezapisane zmiany, mówi o tym wprost („…podgląd liczy według ustawień zapisanych w Estelio. Zapisz, aby zobaczyć nowe."), (d) po zapisie przelicza się od razu. Kwota przykładu jest stanem lokalnym, nie wpływa na stan „niezapisane", Enter w niej nie zapisuje.

## 4. Kryteria odbioru (rozdz. 12)

| Próba | Wynik | Dowód |
|---|---|---|
| Odczyt prawdziwej konfiguracji | PASS | I: Z01 — wartości z backendu, kafel = select, stan czysty |
| 50 % / 195,00 / brak zaokr. → 97,50 zł | PASS | I: Z03 (serwer: `50% z 195.00 zł`) |
| Każdy tryb i zaokrąglenie | PASS | I: Z05 kafel „Do 5 zł" → select `5`; Z10 KWOTOWY; Z12 fallback PROCENT; 30 % + do 5 zł → 60,00 zł (Z09); próg 200→50 dla 195 → 50,00 zł (zrzut 04) |
| Przypadki graniczne zaokrąglenia | bez zmian | liczy serwer — ta sama funkcja co w multisprzedaży |
| Zmiana wyłącznie przykładu | PASS | brak wpływu na stan stopki, Enter zablokowany |
| Pusty/błędny przykład | PASS | I: Z07 „—" + wskazówka, zapis nadal możliwy |
| Błędny parametr konfiguracji | bez zmian | backend normalizuje (jak dotąd); front nie dodaje nowych reguł |
| Zapis udany | PASS | I: Z08 `✓ Zapisano!`, Z14 przywrócenie |
| Zapis nieudany / błąd odczytu / nieznana opcja | bez zmian | komunikaty `uz_msg` z serwera jak dotąd; stany „draft/blokada" z paczki wymagałyby zmiany logiki — nie wdrożono |
| Rola / inny salon | bez zmian | backend |
| 320 / 400 / 800×550 / zoom 200 % | PASS | I: `poza: []`, bez poziomego scrolla (po poprawce ukrywania selecta) |
| Klawiatura / pomoc | PASS | kafle = natywne radio w `<label>`, select ma `tabindex=-1`; pomoc = istniejący `pk-slot` |
| Inne moduły | PASS | T: CSS zawężony; pełny zestaw 925 testów — 924 PASS, 1 porażka `tests/lojalnosc.test.js` (SMS, niezwiązana; patrz niżej) |

## 5. Gdzie spec ustąpiła zasadzie „logika bez zmian"

Kontroler z paczki (`zadatki.js`, adapter `load/validate/preview/save`, przycisk zapisu nieaktywny bez zmian, blokada po `CONFLICT/UNCERTAIN`, `beforeunload`) **nie został użyty** — zastąpiłby `wczytajUstawieniaZadatkow`/`uz_zapisz`. Zostały: istniejące funkcje, `confirm` przy progu, komunikaty `uz_msg`, przycisk zapisu zawsze aktywny (napis w stopce informuje o stanie). Etykieta trybu skrócona do „Procent kwoty zabiegu" (wartość `PROCENT` bez zmian).

## 6. Obserwacje poza zakresem (nie ruszane)

- Dodanie/usunięcie progu przeładowuje konfigurację z serwera, więc **niezapisana zmiana trybu/procentu znika** (np. przełączenie na KWOTOWY bez zapisu + „Dodaj próg" → formularz wraca do zapisanego PROCENT). Istniało; scenariusz zapisuje tryb przed dodaniem progu. Nowa podpowiedź pod formularzem progu mówi, że próg zapisuje się od razu.
- Backend przy braku progu i `PUSTE` zwraca `zadatek_proponowany: 0` — podgląd pokazuje „—" z opisem serwera, nie „0,00 zł".
- `tests/lojalnosc.test.js › loj_wniosek_wyslij … SMS` padł raz w pełnym przebiegu; ten sam plik uruchomiony osobno: 196/196 — porażka czasowa, niezwiązana (plik nietknięty).
