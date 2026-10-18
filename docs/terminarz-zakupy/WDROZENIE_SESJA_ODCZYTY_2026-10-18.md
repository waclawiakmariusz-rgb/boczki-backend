# Wydanie „odczyty tylko z sesją” — raport gotowości (GO / NO-GO)

**Data:** 18.10.2026 · **Zakres:** jedna luka bezpieczeństwa, osobne wydanie · **Paczka dowodów:** `docs/terminarz-zakupy/po12/`
**Werdykt:** **GO** dla kandydata z §1, pod warunkiem kontroli po wdrożeniu z §6. Nic nie scalono ani nie wdrożono bez słowa właściciela.

## 1. Co i dlaczego

**Luka (stan produkcji od miesięcy, niezależny od Terminarza):** strażnik sesji dla tras `/api` był zarejestrowany w `server.js` **po** routerach, więc Express nigdy go nie uruchamiał dla tras routerów. Każdy odczyt typu `GET /api/klienci?action=get_clients&tenant_id=<salon>` (klientki, historia sprzedaży, portfele, pracownicy, zgody RODO, baza SMS, logi, sesje zdjęciowe, członkowie Klubu, dokumenty dodatkowe, analityka) odpowiadał bez żadnego tokenu — wystarczyła nazwa salonu, widoczna w adresach. Zapisy przez dispatcher POST były chronione osobno (`ENFORCE_SESSION_POST`), dlatego luka dotyczyła odczytów i zapisów w routerach. Potwierdzone 17–18.10 na izolowanej bazie na kodzie `b3d774a` i `c0e87b6`.

**Naprawa (commit `8cba96d` na `dev`, kod produktu = 3 pliki):**
- `routes/sesja-middleware.js` (nowy): strażnik z **jawną** listą ścieżek publicznych (zdjęcia z telefonu, zgoda/płatność z linku, sklep, rejestracja, reset hasła, blog) i gałęzi z własnym uwierzytelnieniem (`/magda`, `/admin`, `/billing`, `/klub`); żądanie z `tenant_id` bez tokenu → 403, wygasły → 401, token innego salonu → 403; blokada **domyślnie włączona**, niezależnie od starej flagi trybu miękkiego.
- `server.js`: strażnik rejestrowany **przed** routerami; stary martwy blok usunięty; wyłącznik awaryjny na panel Hostingera **`ENFORCE_SESSION_ROUTERY=false`** (tylko log, zachowanie sprzed wydania, bez dotykania ochrony zapisów); `GET /dbstatus` (ujawniał host i nazwę bazy) odpowiada tylko z tokenem admina.
- Zero zmian w routerach, frontendzie, bazie. Zalogowana aplikacja już wysyła token przy odczytach (wrapper `fetch` w `index.html`), więc dla recepcji nic się nie zmienia.

## 2. Testy

| Co | Wynik |
|---|---|
| `tests/sesja-odczyty.test.js` — kolejność w `server.js` (oblewa na starym kodzie), zachowanie strażnika na prawdziwym Express (supertest), jawna lista publiczna, wyłącznik, `/dbstatus` | 14 / 14 |
| pełna bateria (24 zestawy, atrapy, bez bazy) | **544 / 544** |

## 3. Próby na kandydacie (izolowana baza, salon fikcyjny, `po12/`)

| Próba | Wynik | Plik |
|---|---|---|
| 13 prywatnych odczytów bez tokenu → 403 bez danych (w tym przez dispatcher GET); `/dbstatus` → 404 | PASS | `wynik-kandydat-sesja-odczyty.json` |
| 19 wywołań stron publicznych (foto, zgoda, Klub, sklep, GUS, voucher, rejestracja, reset, blog, pomoc, magda, billing, admin) nie są blokowane strażnikiem; 8 stron publicznych ładuje się | PASS | j.w. |
| zalogowany: własny token → dane (także przez dispatcher GET z przekierowaniem); obcy salon → 403; wygasły → 401; 5 odczytów Pulpitu/Analizy → 200; trasa z salonem w ścieżce bez podwójnej blokady | PASS (51 / 51 razem) | j.w. |
| ścieżki recepcji i E05 z wdrożenia Terminarza (W04/W05) powtórzone na tym kandydacie | 25 / 26 (1 = w `.env.test` lista zakupów zawiera salon demo, nie regresja) | `wynik-kandydat-sciezki-po-strazniku.json` |
| smoke w przeglądarce (zalogowana aplikacja, widoki Pulpit/Analiza/BI, CSP, wyjątki JS, zasoby sieciowe) | **19 / 19 OK** (pierwszy przebieg tuż po skryptach prób trafił w limit 120 żądań/min — 429, nie 401/403; powtórzony po minucie czysto) | `smoke-kandydat-localhost.txt` |

## 4. Czego nie zmieniono (świadomie)

- Trasy z salonem w ścieżce (`/api/dokumenty/:salon/:plik`, `/api/foto/plik/...`, `/api/typy-zabiegow`, `/api/help-kb`) sprawdzają dostęp same — bez zmian.
- Przepływ zdjęć z telefonu nadal zwraca imiona pracowników/klientek posiadaczowi ważnego tokenu QR/urządzenia — to projekt tej funkcji, zapisany w inwentarzu do wiedzy.
- Sesje między serwerami (prod/dev) — osobne, następne zadanie.

## 5. Powrót

1. **Bez kodu, z panelu, 1 minuta:** Node.js → Environment Variables → dodać `ENFORCE_SESSION_ROUTERY=false` (bez apostrofów) → Restart. Strażnik tylko loguje, zachowanie dokładnie sprzed wydania. Ochrona zapisów zostaje.
2. **Kodowo:** gałąź powrotu do `c0e87b6` (aktualna produkcja) przygotuję po scaleniu, tak jak przy Terminarzu; w praktyce punkt 1 wystarcza.
Baza i pliki nietknięte przez to wydanie.

## 6. Okno i kontrola po wdrożeniu

```
# Właściciel, panel: Environment Variables — NIE dodawać ENFORCE_SESSION_ROUTERY (domyślnie włączone); sprawdzić, że jest ADMIN_TOKEN
# Claude: git checkout main && git merge --ff-only <SHA kandydata> && git push origin main
# Właściciel: Git → Pull from remote (hash = kandydat) → Node.js → Restart → Cache → Purge
# Claude, wyłącznie odczyt, salon demo, oczekiwane są ODMOWY (nic nie wraca przy poprawnym działaniu):
node narzedzia/testy-integracyjne/kandydat-sesja-odczyty.js --prod-odczyt https://estelio.com.pl
#   + smoke-prod.js jak 18.10 (login, widoki, CSP, JS) + hash wersji na /zaloguj
# Właściciel: incognito, PIN, Klientki, Sprzedaż, dokument, Terminarz — jak przy poprzednim oknie
```
Kryterium przerwania: zalogowana recepcja dostaje „Brak dostępu” przy zwykłych odczytach, albo strona publiczna (zdjęcia z telefonu, zgoda z linku, Klub, sklep) przestaje działać → punkt 5.1.

## 7. Stan git

| Co | Wartość |
|---|---|
| produkcja | `c0e87b6` (wdrożone 18.10 13:24) |
| kandydat | `8cba96d` + commit tego raportu na `dev` (docs); fast-forward z `main` możliwy |
| push / wdrożenie / migracja / aktywacja | push na `dev` TAK; `main` NIE (czeka na „ruszaj”); wdrożenie NIE; migracji i aktywacji ten temat nie dotyczy |
