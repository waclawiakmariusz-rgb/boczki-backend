# Zadania na Pulpicie — wynik wdrożenia (26.10.2026)

Pakiet v2 (makiety 01–06, `WDROZENIE_DLA_CLAUDE_CODE.md`, prototyp). Gałąź `dev`. Bez main/produkcji. Próby: izolowana MariaDB 3307, salon `demo-test` (Ola = manager; zapisy wyłącznie na bazie testowej, zadania próbne usunięte po przebiegu). To **nie** jest czysty redesign — instrukcja zamawia nową logikę (rodzaj, numer, adresat rozmowy, wynik rozmowy, lead), więc zmiany obejmują backend. Wszystkie dotychczasowe funkcje i dane zostają.

## 1. Fakty z repozytorium potwierdzone przed wdrożeniem (rozdz. 12 pkt 1)

| Element | Ustalenie |
|---|---|
| Dane widgetu | `ds_loadZadania` → `POST /api/zadania {action:'list'}` (manager) lub `{action:'moje', osoba, rola}` (recepcja/praktykantka/kosmetolog) + szablony (`tylko_szablony`). Bez zmian. |
| Obszary | `ENUM(MAGAZYN,KOSMETYK,KLIENT,SPRZEDAZ,INNE)` + tabela wielokategorii `Zadania_Kategorie`; zachowane, chip pierwszego obszaru + „+N”, filtr dopasowuje każdy przypisany |
| Przypisania | `Zadania_Przypisani` (wielu) + stara kolumna `przypisane_do`; „Tylko moje” = przypisane do mnie **lub** do mojej roli grupowej (recepcja/praktykantka/kosmetolog), nigdy autorstwo |
| Uprawnienia | bez zmian: dodawanie manager/recepcja (`zd_canCreate`, backend `sprawdzCzyMozeZlecicWielu`), „Zrobione” dla odbiorców, menu ⋮ manager / recepcja dla własnych; nowe akcje telefonu dostępne tam, gdzie „Zrobione” lub menu |
| Czas | daty jak dotąd: zapis `YYYY-MM-DD HH:MM:SS` z przeglądarki, grupowanie w przeglądarce; termin z dzisiejszą minioną godziną → „Po terminie” (nowe, zgodnie z instrukcją; wcześniej trafiał do „Na dziś”) |
| Lead | moduł `routes/leady.js` (status `nowy/kontakt/umowiony/klient/odrzucony`, `liczba_polaczen`, `data_ostatniego_kontaktu`) — nie przebudowany; relacja przez jawne `kontakt_id` |

## 2. Zmiany

**Backend `routes/zadania.js`** (migracje idempotentne, jak dotąd):
- kolumny `Zadania.rodzaj ENUM('TELEFON','DO_ZROBIENIA') DEFAULT 'DO_ZROBIENIA'`, `telefon`, `kontakt_typ ENUM('KLIENT','LEAD')`, `kontakt_id`, `kontakt_nazwa`; tabela `Zadania_Historia` (typ WYNIK/TERMIN, wynik, notatka, kolejny termin, status leada przed/po, autor, data z serwera);
- `list/moje/get` zwracają nowe pola + `prob_kontaktu`; instancje cykliczne dziedziczą rodzaj/numer/kontakt z szablonu;
- `add/edit`: `rodzaj` (whitelist), `telefon` (regex `[+\d\s()-]{3,30}`), `kontakt_typ/kontakt_id` — **adresat weryfikowany w bazie tego salonu, nazwa pobierana z bazy, nie z żądania**; numer dotyczy tylko zadania;
- nowe akcje: `przeloz` (termin tylko aktywnego, nie-szablonu + wpis TERMIN), `wynik_rozmowy` (UMOWIONA / NIE_ZAINTERESOWANA kończą zadanie jak „Zrobione”; NIE_ODEBRALA zostawia aktywne i opcjonalnie przekłada termin; lead: status zmienia się tylko z `nowy/kontakt` → `umowiony/odrzucony`, `klient/umówiony/odrzucony` nietknięte; NIE_ODEBRALA = +1 próba; guard `status='AKTYWNE'` → powtórny klik nie dubluje; błąd leada → `status:'error'` z `zadanie_zakonczone:true`, bez fałszywego sukcesu), `historia`, `kontakt_szukaj` (klientki + leady tego salonu, LIKE z escapowaniem `%_`);
- **autor historii i „wykonane_przez” pochodzą z sesji** (`getSession(token).login`), nie z treści żądania.

**Front:** `public/zadania-pulpit.css` (`.estelio-tasks`, `.estelio-task-form`, tokeny z rozdz. 10, tryb ciemny, container queries), `public/zadania-pulpit.js` (nadpisuje `ds_zd_renderTabs/renderList/renderTaskCard/toggleMore/ds_zadanieComplete/updateCollapsedSummary/applyCollapseState` oraz `zd_addOpen/zd_editOpen/zd_save/zd_renderKategorieBadges`; stare definicje w `index.html` zostają z komentarzem), `public/index.html`: znacznik widgetu (te same ID nośne) i formularza (wszystkie dotychczasowe ID i wywołania; nowe: `zd-rodzaj`, `zd-kontakt-*`, `zd-telefon`, szybkie terminy, `zd-wiecej`).

**Testy:** `tests/zadania-telefony.test.js` (9), `tests/zadania-pulpit-redesign.test.js` (6), `narzedzia/proby/zadania-pulpit.json` (20 sprawdzeń w panelu prób). Pełny zestaw: patrz sekcja 5.

## 3. Kryteria odbioru (rozdz. 12)

| Kryterium | Wynik | Dowód |
|---|---|---|
| Po otwarciu „Wszystkie”, bez automatycznej zakładki | PASS | I: Z01 (segment Wszystkie `aria-checked`, brak `.ds-zd-tab`) |
| Wszystkie = Telefony + Do zrobienia; liczniki unikatowych zadań | PASS | I: Z02; T: jeden wiersz na zadanie przy wielu obszarach |
| Wielokategoria nie dubluje; filtr po drugim obszarze | PASS (konstrukcyjnie) | `kategorie(z)` + filtr `indexOf`; chip „+N” |
| „Tylko moje” = przypisanie, nie autorstwo | PASS | I: Z18; T: `jestMoje` bez `utworzone_przez` |
| Liczba zadań / telefonów / zaległych bez otwierania filtrów | PASS | nagłówek „1 telefon · 3 po terminie · 0 na dziś”, segmenty z licznikami, „Pokaż pozostałe N” |
| Telefon bez numeru ma „Dodaj”; numer nie kończy zadania | PASS | `et-call-brak` → edycja; `tel:` tylko gdy numer; brak akcji po kliknięciu |
| Nie odebrała → aktywne, lead nie odrzucony | PASS | I: Z13–Z15 (1 próba kontaktu, historia); T: `UPDATE Leady SET status` nie wykonany |
| Umówiona nie tworzy wizyty; podwójny zapis bez duplikatu | PASS | I: Z16–Z17 (podpis „nie tworzy wizyty”, wiersz przekreślony 3 s, znika); T: guard `AKTYWNE` |
| Zwykłe „Zrobione” nie zmienia leada | PASS | `complete` bez zmian |
| Awaria zapisu nie usuwa zadania / notatki | PASS (konstrukcyjnie) | przycisk odblokowany, panel zostaje, powiadomienie błędu |
| 6 grup formularza, reszta w „Więcej”; edycja nie gubi relacji | PASS | I: Z03–Z08; `zd_editOpen` otwiera „Więcej”, gdy są wartości; payload z wszystkimi dotychczasowymi polami |
| 400 / 320 px bez poziomego przewijania | PASS | I: `poza: []`, `poziomyScroll: false` (800, 400, 320) |
| Stany: pusty, brak moich, brak wyników, błąd, ładowanie, po terminie | PASS | `pusty()` ×3, skeleton w HTML, błąd z `ds_loadZadania`, grupa „Po terminie” czerwona |
| Backend blokuje cudzy salon / niedozwoloną zmianę leada | PASS | T: klientka z innego salonu → błąd; `UPDATE Leady … WHERE tenant_id = ? AND status = ?` |
| Komentarze, kategorie, przypisania, cykliczność, klientki, produkty zachowane | PASS | formularz (ID), szczegóły, „Szablony cykliczne (N)” |
| Klawiatura / czytnik / kontrast / 200 % | częściowo | radio-segmenty `role=radio`, `aria-expanded`, etykiety; pełny audyt WCAG **niewykonany** |

## 4. Odstępstwa i decyzje

- „Zrobione” nadal pyta `confirm` (jak dotąd) — ochrona przed przypadkowym kliknięciem; makieta nie ma pytania.
- Menu wiersza: „Edytuj / Archiwizuj / Usuń” wg dotychczasowych uprawnień; „Zapisz wynik rozmowy / Kopiuj numer” dla telefonów.
- Szablony cykliczne: link w nagłówku rozwija listę w widgecie (edycja z menu dla managera); pełne zarządzanie nadal w module Zadania.
- Stare funkcje widgetu zostają w `index.html` jako nieaktywne (nadpisane) — do usunięcia przy najbliższym porządkowaniu pliku.
- Kafle obszarów w formularzu renderowane bez emoji (nadpisany `zd_renderKategorieBadges`); tabela modułu Zadania (menu) bez zmian wyglądu.
- Migracja: żadne istniejące zadanie nie zostało oznaczone jako Telefon (rodzaj domyślny DO_ZROBIENIA). Lista kandydatów dla Boczków (tytuł z „lead/zadzwonić/telefon”) — 25 aktywnych w „Inne” wg analizy z 26.10 — do decyzji właściciela, oznaczyć można przez edycję zadania.

## 5. Wyniki

- Jednostkowe: nowe 15/15; pełny zestaw repozytorium **963/963** (58 plików).
- Panel prób `zadania-pulpit`: 21/21 PASS, 0 błędów JS; zrzuty w `wynik/` (01 widget, 02 formularz, 03 filtr Telefony, 04 wynik „Nie odebrała”, 05 szczegóły i historia, 06 ciemny, 07 telefon 400 px).
