# Zdjęty widok „Tydzień"

Decyzja właściciela, 21.10.2026:
> „skasuj podgląd tygodniowy, właściwie w chwili obecnej nie rozumiem jego zastosowania,
> zostaw tylko dzienny."

## Co to był za widok i dlaczego nie było go szkoda

Widok „Tydzień" (E02 z projektu Terminarza 2.0) pokazywał **jedną osobę przez siedem dni**:
siatka godzin, nad kolumnami dni tygodnia z godzinami grafiku, u góry lista rozwijana do wyboru
osoby. Nie pokazywał całego zespołu — żeby zobaczyć drugą osobę, trzeba było przełączyć wybór.

W praktyce zachodził na dwa inne widoki:

- **tygodniowy przegląd** daje **Agenda** — lista wizyt na 7 dni, z filtrem osoby, czytelna też
  na telefonie (strzałki ‹ › przeskakują o tydzień),
- **planowanie i umawianie** i tak odbywa się w **widoku Dzień**, gdzie widać cały zespół naraz,
  nieobecności, blokady i zasoby.

Przełącznik widoków został więc: **Dzień · Agenda · Zasoby · Historia**.

## Co dokładnie zniknęło

- pozycja „Tydzień" w przełączniku widoków,
- funkcja `renderTydzien()` w `public/terminarz.js` (~18 linii),
- rozgałęzienia `widok === 'tydzien'` w pobieraniu danych, odświeżaniu po preferencjach
  i w przeskoku strzałkami ‹ › (teraz o tydzień skacze już tylko Agenda),
- rozdział o widoku Tydzień i jego zrzut w przewodniku `/pomoc-terminarz/`.

**Nic nie zniknęło z bazy ani z API.** Akcja `trm_zakres` zostaje — korzysta z niej Agenda.
Stare wejście jest obsłużone: `TRM.widokZmien('tydzien')` przestawia na widok dnia, zamiast
zostawiać pusty ekran (np. gdy ktoś ma otwartą starą kartę przeglądarki).

## Próba w izolowanym środowisku

```
przelacznik widokow: Dzień | Agenda | Zasoby | Historia
po TRM.widokZmien("tydzien") — widok: dzien | siatka dnia na ekranie: true
  widok agenda    podpis: Śr 21.10 – Wt 27.10          elementow w tresci: 6
  widok zasoby    podpis: Środa, 21 października 2026  elementow w tresci: 3
  widok historia  podpis: Historia wizyt               elementow w tresci: 1
  widok dzien     podpis: Środa, 21 października 2026  elementow w tresci: 3

iPhone 390px — pasek widoków: {"szerokosc":312,"poza":0,"przyciskow":4}
BLEDY JS: brak
```

**Przy okazji naprawione:** audyt iPhone'a (`docs/terminarz-iphone/`) pokazywał, że pasek widoków
z pięcioma pozycjami wystawał poza ekran o 16 px i musiał się zawijać do dwóch rzędów. Teraz
mieści się w jednym rzędzie z zapasem.

| Plik | Co widać |
|---|---|
| `widoki-01-przelacznik.png` | nagłówek Terminarza z czterema widokami |
| `widoki-02-agenda.png` | Agenda — tygodniowy przegląd, który zostaje |
| `widoki-03-iphone.png` | ten sam pasek na iPhonie 13, w jednym rzędzie |

## Testy

`tests/terminarz-widoki.test.js` — przełącznik nie oferuje już widoku tygodnia, w module nie
został po nim martwy kod, a stare wejście prowadzi do widoku dnia. Pełny zestaw: 772/772.
