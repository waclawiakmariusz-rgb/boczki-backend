# Zdjęty przycisk „Przejmij" w centrum powiadomień

Uwaga właściciela, 21.10.2026:
> „nie ma tak, że wiele osób siedzi przed systemem. Zajmuje się nim recepcja,
> nie ma po co przejmować."

## Dlaczego ten przycisk w ogóle powstał — i dlaczego to był błąd

„Przejmij" zakładał salon, w którym kilka osób patrzy w ten sam dzwonek i trzeba się umówić,
która dzwoni do klientki. W rzeczywistości terminarzem zajmuje się **recepcja**, zwykle jedna
osoba przy jednym stanowisku. Przycisk kazał więc wykonać krok, który **niczego nie odblokowywał**:

- zamknięcie sprawy (`trm_sprawa_rozwiaz`) **nigdy** nie wymagało bycia jej właścicielem,
- „Zapisz kontakt" też nie,
- jedyne, co robił, to ustawiał właściciela i zmieniał stan `nowa → w_trakcie`.

Do tego każda karta nosiła napis **„Nikt jeszcze nie przejął"** — zdanie, które w salonie
jednoosobowym brzmi jak wyrzut, a nie jak informacja.

## Co zostało

Na karcie w liście: tylko **„Otwórz wizytę"** (albo „Sprawdź wizyty" przy sprawach grupowych).
W szczegółach sprawy: **Zapisz kontakt · Rozwiąż · Przekaż**.

„Prowadzi: …" pokazuje się nadal, ale **tylko wtedy, gdy sprawa naprawdę została komuś
przekazana** — a nie jako pusta rubryka do wypełnienia.

Po stronie serwera akcja `trm_sprawa_przejmij` **zostaje** (niczego nie usuwałem z API) —
właściciela nadaje teraz „Przekaż", które z niej korzysta.

Przewodnik `/pomoc-terminarz/` poprawiony: cykl życia sprawy ma trzy kroki zamiast czterech,
a scenka „dwie recepcjonistki klikają ten sam dzwonek" zastąpiona scenką z końca zmiany
(przekazanie sprawy osobie, która jutro otwiera salon).

## Próba w izolowanym środowisku

```
spraw do działania: 10 | pilnych (P0): 8
typy: E13, E33, E05, E20, E02

podpis pod nagłówkiem: 10 spraw do działania · 8 pilnych — to liczy dzwonek
przyciski na pierwszej karcie: 1 szt: Otwórz wizytę
czy gdziekolwiek „Przejmij": false
czy „Nikt jeszcze nie przejął": false

przyciski w szczegółach sprawy: ← wróć do listy | Otwórz wizytę | Zapisz kontakt | Rozwiąż | Przekaż
czy gdziekolwiek „Przejmij": false
BLEDY JS: brak
```

| Plik | Co widać |
|---|---|
| `przejmij-01-lista.png` | lista spraw — karty bez „Przejmij" i bez „Nikt jeszcze nie przejął" |
| `przejmij-02-szczegoly.png` | otwarta sprawa: Zapisz kontakt · Rozwiąż · Przekaż |

## Co zostaje otwarte

Przy okazji wyszło, że **8 z 10 spraw ma status „Pilne teraz"**, a wszystkie z powodu
„bo wizyta już się odbyła". Sprawy E13 („Brak wyniku wizyty") i E19 („Potwierdź rozliczenie")
powstają z priorytetem P1 i powiązanym czasem w przeszłości, więc przebieg eskalacji
(`powiazany_czas <= NOW() + 120 min`) podnosi je do **P0 w ciągu minuty**. Efekt: „pilne"
znaczy w praktyce „zaległe" i przestaje cokolwiek wyróżniać.

To osobny temat, czeka na decyzję — razem ze sposobem na masowe domknięcie starych spraw.

## Testy

`tests/terminarz-powiadomienia.test.js` (8 prób): brak przycisku i jego obsługi, brak napisu
o nieprzejętej sprawie, zachowane „Prowadzi: …", zachowane Zapisz kontakt / Rozwiąż / Przekaż,
serwer nadal nie wymaga właściciela do zamknięcia sprawy, przewodnik bez „Przejmij".
Pełny zestaw: 790/790.

---

# Reguła pilności (ta sama rozmowa, decyzja „1")

Po zdjęciu „Przejmij" zostało pytanie, dlaczego **13 z 14 spraw** miało plakietkę „Pilne teraz",
wszystkie z powodem *„bo wizyta już się odbyła"*. Czerwony kolor przestał cokolwiek wyróżniać.

## Co było nie tak

Dwie reguły liczyły czas **bez kierunku**:

1. `priorytetZnikaniaWizyty()` — P0, gdy do terminu zostało mniej niż 48 h. Dla wizyty **z przeszłości**
   różnica wychodziła ujemna, więc warunek „mniej niż 48 h" był spełniony **na zawsze**.
2. Przebieg eskalacji — P1 → P0, gdy `powiazany_czas <= NOW() + 120 min`. Termin sprzed trzech
   tygodni też spełnia ten warunek, więc każda zaległość stawała się pilna w ciągu minuty.

## Jak jest teraz

**„Pilne teraz" (P0) znaczy: trzeba zdążyć, zanim coś się wydarzy.**

| Sytuacja | Priorytet |
|---|---|
| wizyta w najbliższych 48 h (odwołana, przełożona, zmieniony wykonawca) | **P0 — Pilne teraz** |
| powiązany termin w ciągu 2 h | **P0** |
| termin minął mniej niż dobę temu | **P0** (dziś jeszcze da się to domknąć) |
| **termin minął ponad dobę temu** | **P1 — Wymaga działania** |
| „brak wyniku wizyty" / „potwierdź rozliczenie", doba bez żadnej reakcji | **P0** (tu chodzi o pieniądze) |
| te same sprawy po tygodniu | **P1 — zaległość do nadrobienia** |

Nic się nie zamyka samo i nic nie znika z dzwonka — „Do działania" to nadal P0 **i** P1.
Zmienia się tylko to, co krzyczy. Każda zmiana priorytetu zostawia wpis w dzienniku sprawy
(`eskalacja` albo `wygaszenie`), więc widać, dlaczego sprawa zmieniła kolor.

Progi: `ZALEGLOSC_H = 24`, `ZALEGLOSC_DNI = 7` w `routes/terminarz.js`.

## Pułapka, którą złapał dopiero pomiar

Pierwsza wersja wygaszania patrzyła na **wiek sprawy** (`utworzono`). W próbie nie zadziałała:
sprawy w środowisku testowym były świeże, choć dotyczyły wizyt sprzed tygodnia. Liczy się
**moment, którego sprawa dotyczy**, nie data jej wpisania — poprawione i opisane próbą niżej.

Druga pułapka: reguły (2) i (3) mogłyby przerzucać tę samą sprawę w tę i z powrotem co minutę.
Dlatego podniesienie następuje tylko raz (`eskalowano_o IS NULL`), a wygaszanie omija okno
doba–tydzień dla E13/E19.

## Próba na izolowanej bazie

Trzy sytuacje ustawione ręcznie na „Pilne teraz", potem jeden przebieg reguły:

```
PRZED przebiegiem (wszystkie ustawione na „Pilne teraz"):
   E05  P0  Odwołano wizytę — Julia Wiśniewska    termin: 2026-10-19 17:46  (dwa dni temu)
   E05  P0  Odwołano wizytę — Julia Wiśniewska    termin: 2026-10-22 13:00  (jutro)
   E13  P0  Brak wyniku wizyty — Beata Pawlak     termin: 2026-10-13 17:46  (tydzień temu)

   zmiana po ~25 s

PO przebiegu:
   E05  P1  Odwołano wizytę — Julia Wiśniewska    termin: 2026-10-19 17:46   ← przestało krzyczeć
   E05  P0  Odwołano wizytę — Julia Wiśniewska    termin: 2026-10-22 13:00   ← nadal pilne (jutro!)
   E13  P1  Brak wyniku wizyty — Beata Pawlak     termin: 2026-10-21 17:30   ← zaległość do nadrobienia

wpisy w dzienniku spraw:
   sprawa 26 · wygaszenie · Obniżono priorytet do P1 — termin minął ponad dobę temu…
   sprawa 16 · wygaszenie · Obniżono priorytet do P1 — termin minął ponad dobę temu…
```

Kontrola z drugiej strony: odwołanie wizyty **na jutro** utworzyło sprawę od razu jako **P0** —
reguła nie wycisza tego, co naprawdę pilne.

W panelu widać to w powodach przy plakietkach: „pilne, bo **termin minął w ostatniej dobie**",
„pilne, bo **minęła doba bez reakcji**" — zamiast dawnego „bo wizyta już się odbyła".

| Plik | Co widać |
|---|---|
| `pilnosc-01-panel.png` | dzwonek z nowymi powodami i mieszanką „Pilne teraz" / „Wymaga działania" |
| `proba-pilnosc.js` | próba na izolowanej bazie (trzy sytuacje + przebieg reguły) |

## Czego NIE zrobiłem

Masowego domykania starych spraw (punkt 2 z rozmowy) — czeka na decyzję. Po tej zmianie
zaległości przestają udawać alarm, ale nadal są na liście i nadal trzeba je kiedyś domknąć.

---

# Masowe domykanie zaległości (punkt „2" z tej samej rozmowy)

Po naprawieniu reguły pilności zaległości przestały udawać alarm, ale nadal wiszą na liście
i trzeba je kiedyś domknąć. Klikanie po jednej przy kilkunastu sprawach to zajęcie na kwadrans.

## Jak to działa

W zakładce „Do działania" (gdy są co najmniej trzy sprawy bez pilnego terminu) pojawia się
**„Domknij zaległości…"**. Otwiera się karta z wyborem progu — **tydzień / dwa tygodnie /
miesiąc / trzy miesiące** — i **podglądem**:

```
Zniknie z listy: 6 spraw.
Zmiana terminu: 1 · Odwołanie wizyty: 4 · Brak wyniku wizyty: 1
np. Zmieniono termin — Zestaw A (2026-09-26), Odwołano wizytę — Patrycja Adamczyk (2026-09-26)…
```

Dopiero przycisk **„Domknij 6"** coś zapisuje.

## Czego to NIE rusza

- **spraw pilnych (P0)** — bierze wyłącznie P1,
- **świeżych spraw** — tylko takie, których moment minął wcześniej niż wybrany próg,
- **spraw z nieobsłużonymi wizytami** (E02/E18/E33 z listą „dotkniętych" terminów). Tam zamknięcie
  znaczyłoby „udawajmy, że kolizji nie ma", więc wracają jako **pominięte**, z podaną liczbą wizyt
  do rozstrzygnięcia. To ta sama zasada, co przy zamykaniu pojedynczej sprawy.

Każda domknięta sprawa dostaje wpis w swoim dzienniku („Domknięcie zbiorcze: …"), a cała operacja
jeden wpis w **Dzienniku Zdarzeń**. Nic nie znika — domkniętą sprawę widać w zakładce „Informacje"
i da się ją **wznowić**.

Jedno wywołanie obejmuje maksymalnie 300 spraw.

## Próba w izolowanym środowisku

```
otwarte sprawy przed: P0: 10 | P1: 8 | P2: 1

PODGLĄD (bez `wykonaj`): {"podglad":true,"do_zamkniecia":6,"pominietych":0,"wg_typu":{"E13":1,"E02":1,"E05":4}}
   czy podgląd cokolwiek zamknął: nie — jak ma być

WYKONANIE:
   success · Domknięto 6 spraw. | zamknięte: 6 | pominięte: 0
   otwarte sprawy po: P0: 10 | P1: 2 | P2: 1
   dziennik sprawy: Ola · rozwiazano · Domknięcie zbiorcze: Domknięte zbiorczo jako zaległość…
   Dziennik Zdarzeń: TERMINARZ: ZBIORCZE DOMKNIĘCIE SPRAW — 6 spraw starszych niż 7 dni

wznowienie domkniętej sprawy: success — Brak wyniku wizyty — Patrycja Adamczyk
BLEDY JS: brak
```

Liczby zgadzają się co do sztuki: **P1 spadło z 8 na 2**, pilne (P0: 10) **nietknięte**.

| Plik | Co widać |
|---|---|
| `domkniecie-01-podglad.png` | karta podglądu z rozbiciem na typy i przyciskiem „Domknij 6" |
| `proba-domkniecie.js` | próba: podgląd bez zapisu, wykonanie, dziennik, wznowienie |

## Testy

6 dodatkowych prób w `tests/terminarz-powiadomienia.test.js`: podgląd nic nie zapisuje,
wykonanie zostawia ślad w dzienniku każdej sprawy i w Dzienniku Zdarzeń, sprawa z nieobsłużonymi
wizytami zostaje (z powodem), zapytanie bierze tylko P1 ze starym terminem, próg trzymany
w granicach 1–365 dni, specjalistka nie domyka hurtem. Pełny zestaw: **811/811**.
