# Przyjęcie towaru — wynik wdrożenia redesignu (22.10.2026)

**Zasada nadrzędna tego zadania (od właściciela):** zmienia się wyłącznie oprawa graficzna; logika działania pozostaje bez zmian.
Tam, gdzie specyfikacja ChatGPT (`PRZYJECIE_TOWARU_CLAUDE_CODE.md`, `INTEGRACJA_DLA_CLAUDE.md`) proponowała nową logikę
(własny komponent z adapterem, nowa walidacja, stany „odmowa / nieznany wynik", pole daty jako tekst), **wygrała zasada właściciela** —
szczegóły w rozdziale 5.

Punkt odniesienia kodu: `przed-redesign-2026-10-22` = `fca9edd` (main). Prace na gałęzi `dev`. **Bez wdrożenia, bez zapisu w realnym salonie.**

## 1. Mapa: element UI → istniejące pole → zapis

| Element na makiecie | Pole w kodzie (bez zmian) | Co trafia do `action: 'add'` |
|---|---|---|
| Marka | `<select id="n_firma" onchange="zaladujModeleDlaFirmy()">` | składnik `nazwa` („Firma Model") |
| Model | `<select id="n_model" onchange="generujNazwe()" disabled>` | składnik `nazwa` |
| Typ | `<select id="n_typ">` Kremy / Olejek / Suplement(=Witaminy) / Inne | `typ` |
| Liczba sztuk | `<input type="number" id="n_ilosc" required min="1">` | `ilosc` (przez `normNum`) |
| Data ważności | `<input type="date" id="n_waznosc" required>` | `waznosc` (ISO `RRRR-MM-DD`, bez konwersji strefy) |
| Netto / Brutto | `<input type="number" step="0.01" id="n_netto|n_brutto" required min="0.01">` | `netto`, `brutto` (przez `normNum`) |
| *(dawny niebieski pasek „Detal")* | `<input type="radio" name="kategoria" value="Detal" checked hidden tabindex="-1">` | `kategoria: 'Detal'` |
| *(dawny zielony pasek z nazwą)* | `<input type="hidden" id="n_nazwa">`, nadal wypełniane przez `generujNazwe()` | `nazwa` |
| *(stałe)* | — | `pracownik: currentUser`, `min: 2` |
| Przyjmij towar | `<form onsubmit="dodajProdukt(event)">` + jedyny `type="submit"` | handler zapisu — ten sam |
| Anuluj *(nowy)* | `<button type="button" data-anuluj>` | nic nie wysyła |
| Podsumowanie *(nowe)* | `<aside class="egr-summary">`, liczone w `przyjecie-towaru.js` | nic nie wysyła |
| −/+ *(nowe)* | `<button type="button" data-krok="±1">` | zmieniają tylko wartość `n_ilosc` |

Ustalenia z rozpoznania kodu (rozdz. 2 specyfikacji):

1. **„Detal"** — jedyna, zawsze zaznaczona opcja (Profesja wykomentowana od dawna); użytkownik niczego nie wybierał. Odczyt: tylko `dodajProdukt()`.
2. **Firma/Model** — wyłącznie wybór ze słownika (`?action=dictionary`), bez wpisywania nowych wartości w tym formularzu. Zachowane.
3. **Typ, Netto, Brutto** — bez automatycznego uzupełniania i bez przeliczania Netto↔Brutto. Nie dodano.
4. **Reguły** — ilość: całkowita ≥ 1 (natywnie) i `> 0` (JS); ceny: `> 0`; data: wymagana; walidacja JS alertami.
5. **Po sukcesie** — alert „✅ Dodano produkt pomyślnie!", `form.reset()`, lista modeli do stanu wyjściowego, `generujNazwe()`, próba kliknięcia przycisku `onclick*='magazyn'`.
6. **Aktualizacja stanu** — po stronie serwera (`routes/magazyn.js`, `INSERT INTO Magazyn` + log „PRZYJĘCIE TOWARU"). Nietknięte.

## 2. Co zmieniono — plik po pliku

| Plik | Zmiana |
|---|---|
| `public/index.html` — sekcja `#nowy` | nowy znacznik wg fragmentu z paczki, z zachowaniem ID i atrybutów pól (tabela wyżej) |
| `public/index.html` — `dodajProdukt()` | **dwa literały etykiety**: `"⏳ Zapisywanie..."` → `"Przyjmowanie…"`, `"Zapisz"` → `"Przyjmij towar"`. Nic więcej. |
| `public/index.html` — koniec pliku | `<link>` do `/przyjecie-towaru.css` i `<script defer>` do `/przyjecie-towaru.js` (z `?v=__WERSJA_PLIKOW__`) |
| `public/przyjecie-towaru.css` *(nowy)* | wygląd; każdy selektor zaczyna się od `.estelio-goods-receipt` (strażnik w teście); tryb ciemny `body.dark-mode …` |
| `public/przyjecie-towaru.js` *(nowy)* | warstwa prezentacji: −/+, podsumowanie, Anuluj. **Zero `fetch`/POST/walidacji** (strażnik w teście) |
| `tests/przyjecie-towaru-redesign.test.js` *(nowy)* | 15 prób-strażników zasady „tylko oprawa" |

Pełny diff `index.html` poza blokiem sekcji i `<link>`: dokładnie 2 linie (`git diff -U0`).

## 3. Odcisk zachowania — przed i po

Skrypt `wynik/odcisk.js` biegł na starym znaczniku (`odcisk-przed.json`) i na nowym (`odcisk-po.json`), z podmienionym `fetch`
(POST `action:'add'` przechwycony — nic nie trafia do bazy). Porównanie programowe wszystkich pól poza tymi, które z założenia się różnią
(tekst przycisku, widoczność kontrolki Detal, obecność podsumowania):

**IDENTYCZNE.** W tym:

| Co | Przed = Po |
|---|---|
| payload `action:'add'` | `{action, nazwa, typ, ilosc, kategoria:'Detal', pracownik, min:2, waznosc, netto, brutto}` — te same 10 pól, te same wartości |
| dwuklik „Przyjmij towar" | 1 POST (przycisk blokowany synchronicznie) |
| alert po sukcesie | „✅ Dodano produkt pomyślnie!" |
| stan po zapisie | formularz wyzerowany, model `disabled` z 1 opcją, nazwa „Wybierz firmę i model..." |
| pusty submit | zatrzymany natywnie na `n_ilosc`, zero alertów, zero POST |
| walidacja JS | ilość 0 / netto 0 / brak daty / brak modelu → te same alerty, zero POST |
| relacja Marka→Model | zmiana marki czyści model i nazwę |
| atrybuty pól | `type/required/min/step/disabled` identyczne (poza `n_nazwa`: text+readonly → hidden, celowo) |
| pomoc kontekstowa | slot `magazyn.przyjecie` zostaje |

Nawigacja po sukcesie: w obu wersjach próba skończyła na sekcji `nowy` (przycisk szukany po `onclick*='magazyn'`) — zachowanie przeniesione 1:1, patrz rozdz. 6.

## 4. Próby PT-01…PT-12

Dowód: **M** = pomiar w Chrome headless (`wynik/stany.js`, wyniki niżej), **O** = odcisk zachowania (`odcisk.js`), **T** = test jednostkowy, **Z** = zrzut.

| ID | Próba | Wynik | Dowód |
|---|---|---|---|
| PT-01 | Pusty formularz | PASS — bez danych przykładowych, bez kontrolki Detal; podsumowanie „Wybierz produkt / — / Uzupełnij ilość i cenę brutto." | M, Z `stan-01` |
| PT-02 | Zmiana marki/modelu | PASS — model i nazwa czyszczone przy zmianie marki; podsumowanie podąża | O |
| PT-03 | −/+ i wpisanie ilości | PASS — jedna zmiana na klik, 0 POST-ów po klikaniu, „−" nieaktywny przy ≤1 i przy pustym | M |
| PT-04 | 6 × 98,40 → 7 szt. | PASS — 590,40 zł → 688,80 zł bez przeładowania; po „−" znów 590,40 zł | M, Z `stan-02` |
| PT-05 | Pusta/błędna cena | PASS — suma i „brutto za sztukę" = „—", bez starej kwoty; ilość 0 → alert JS jak dotąd | M, O |
| PT-06 | Netto/Brutto, data | PASS — bez przeliczania (jak dotąd), data wymagana (jak dotąd), zapis `2027-12-31` bez przesunięcia | O |
| PT-07 | Zapis bez kontrolki Detal | PASS — payload identyczny z „przed" (`kategoria:'Detal'`) | O |
| PT-08 | Dwuklik / ponowne wejście | PASS — 1 POST przy dwukliku; zdarzenia prezentacji podpinane raz (`data-prezentacja-gotowa`) | O, T |
| PT-09 | Odmowa / nieznany wynik | **NIE ZMIENIANO** — stary kod pokazuje „Dodano" po każdej odpowiedzi HTTP i nie rozróżnia odmowy; zachowane celowo (rozdz. 6) | O |
| PT-10 | Anuluj pusty / wypełniony | PASS — pusty: bez pytania, przejście do Stanu Magazynowego; wypełniony: pytanie „Odrzucić wprowadzone zmiany?…", przy „nie" dane zostają | M |
| PT-11 | 390 px / 800×550 / zoom 200 % | PASS — nic poza kontenerem, brak poziomego przewijania, stopka w pełnej szerokości, pola 52 px | M, Z `stan-05…08` |
| PT-12 | Inne ekrany | PASS — CSS zawężony do `.estelio-goods-receipt` (strażnik), JS działa tylko na `#nowy`; pełny zestaw 859/859 | T |

Pomiary (`stany.js`, Chrome headless, pl-PL):

```
1663x946 pusty            kontener 1283 | form 873x749 | podsum 390x540 | obok:tak równe:tak | poza:nie | scrollX:nie | suma: —
1663x946 referencyjny     kontener 1283 | form 873x749 | podsum 390x557 | obok:tak równe:tak | poza:nie | scrollX:nie | suma: 590,40 zł
1663x946 po „+” (7 szt.)  … suma: 688,80 zł | POST-ów po klikaniu +: 0
w trakcie zapisu          przycisk „Przyjmowanie…” disabled: true | szerokość 278 px (bez skoku)
po zapisie                przycisk „Przyjmij towar” | alert ✅ | POST-ów: 1 | suma po resecie: —
Anuluj przy pustym        pytań: 0 | aktywna sekcja: magazyn
Anuluj przy wypełnionym   pytanie: „Odrzucić wprowadzone zmiany?…” | aktywna: nowy | ilość nadal: 6
1663x946 tryb ciemny      karta rgb(30,41,59) | pole rgb(15,23,42) | h1 rgb(248,250,252)
390x844                   kontener 366 | jedna kolumna | poza:nie | scrollX:nie | submit 326/366 px | pole 52 px
800x550                   kontener 420 | jedna kolumna | poza:nie | scrollX:nie
800x550 @200%             kontener 376 | jedna kolumna | poza:nie | scrollX:nie
BLEDY JS: brak
```

Odbiór wizualny (rozdz. 12.1): obszar roboczy w aplikacji to **1283 px** (menu 280 + odstępy 50/50), nie 1399 jak w makiecie — menu zgodnie
z poleceniem nie było zmieniane, więc karty są proporcjonalnie węższe (873/390 zamiast 929/390). Wysokość karty formularza 749 px (makieta ≈750),
podsumowania 540 px pusty (makieta ≈540). Pola 60 px, przyciski 56 px, tytuł 40 px, kwota w akcencie. Zrzut porównawczy: `wynik/stan-02-desktop-referencyjny.png` obok `MAKIETA_PRZYJECIE_TOWARU.png`.

## 5. Gdzie specyfikacja ChatGPT ustąpiła zasadzie „logika bez zmian"

| Specyfikacja chciała | Zrobiono | Dlaczego |
|---|---|---|
| komponent `EstelioGoodsReceipt.mount` z adapterem, własny parser kwot/dat w groszach | zachowano `dodajProdukt()` i natywne pola `number`/`date` | nowy parser = inna walidacja = inna logika |
| błędy przy polach zamiast alertów | alerty zostały | inne komunikaty i inny przebieg = zmiana zachowania; do osobnej decyzji |
| stany `rejected` / `unknown`, `checkResult`, `operationId` | bez zmian (rozdz. 6, punkt 1) | nowy system transakcji — spec sama mówi „nie dokładaj" |
| data jako tekst `dd.mm.rrrr` + własny przycisk kalendarza | natywne `type="date"` (w pl-PL pokazuje `31.12.2027`), ikona = natywny wskaźnik pickera z własną grafiką | ten sam format zapisu, ta sama obowiązkowość, ikona naprawdę otwiera kalendarz |
| usunąć kontrolkę Detal i przenieść wartość do adaptera | kontrolka ukryta (`hidden`, `tabindex=-1`, nie `required`) | `dodajProdukt()` zostaje co do znaku taki sam — najprostszy dowód „bez zmian" |
| własne okno „Odrzucić zmiany?" zamiast `window.confirm` | `window.confirm` | aplikacja nie ma wspólnego modala potwierdzeń; używa `confirm()` w 66 miejscach — to jest „styl Estelio" |
| spinner w przycisku | tylko etykieta „Przyjmowanie…" | `dodajProdukt()` ustawia `innerText`, co i tak skasowałoby spinner; nie dotykamy handlera |

## 6. Obserwacje poza zakresem — do osobnej decyzji właściciela (NIE naprawiane)

1. **`dodajProdukt()` ogłasza sukces po każdej odpowiedzi HTTP.** `.then(() => alert("✅ Dodano…"))` nie czyta `status` z JSON. Gdy serwer odpowie `{status:'error'}` (np. „Niepoprawna nazwa produktu"), recepcja i tak widzi „Dodano", a formularz się czyści. Istniało przed redesignem.
2. **Przejście do magazynu po sukcesie trafia w pierwszy przycisk z `onclick*='magazyn'`.** W próbie headless ekran został na „Przyjęciu towaru" (przycisk, który się łapie, nie nawiguje). Przeniesione 1:1; nowy „Anuluj" celowo używa dokładnego selektora `pokaz('magazyn'`.
3. **Słownik firm wstawiany przez `innerHTML` bez `escHtml`** w `zaladujFirmyDoFormularzaNowyProdukt()` — nazwa firmy z bazy ląduje w HTML bez ucieczki. Istniało przed redesignem.
4. **Backend przyjmuje ilości ułamkowe („1,5")**, frontend blokuje natywnie (`type=number` bez `step`). Rozjazd istniał wcześniej.

## 7. Co wykonano — rozdzielnie

- **Lokalnie:** zmiany w 5 plikach (rozdz. 2), próby w izolowanym środowisku (MariaDB 3307, serwer 3999, salon `demo-test`, dane fikcyjne), zrzuty w `wynik/`.
- **Testy:** pełny zestaw **859/859 w 46 pakietach** (844 dotychczasowe + 15 nowych strażników).
- **Git:** commit na `dev` (hash w opisie commita). **Push na `main`: NIE** — czeka na decyzję właściciela.
- **Wdrożenie na produkcję: NIE.**

Niezweryfikowane: rzeczywista przeglądarka na telefonie z otwartą klawiaturą (headless emuluje tylko viewport); próba na produkcji (celowo nie).
