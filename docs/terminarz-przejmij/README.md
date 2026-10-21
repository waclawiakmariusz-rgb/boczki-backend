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
