# Kategorie magazynowe: zmiana nazwy i przeniesienie (zgłoszenie #8)

Zgłoszenie Ani z 19.10.2026: „Możliwość edycji nazwy kategorii i podkategorii w magazynie". Tło z rozmowy w salonie:

> — może płyny z inwentaryzacji tygodniowej przerzucimy do miesięcznej? z tygodnia na tydzień to tam nic nie schodzi
> — dobry pomysł, skoro to nie jest tak, że co chwilę się kończy
> — ok, to zmienię nazwę kategorii, po prostu… a no właśnie, **nie da się**

## Co było

Drzewo kategorii pozwalało tylko **dodać** i **skasować**. Żeby przenieść „Płyny", trzeba było skasować kategorię i założyć nową — a wtedy produkty zostają ze ścieżką do nieistniejącej kategorii, bo `Raport_Magazyn.kategoria` trzyma **pełną ścieżkę tekstem** („Inwentaryzacja Tygodniowa > Płyny"), nie identyfikator.

Przy okazji wyszły dwie rzeczy, które to utrudniały:

1. **Drzewo było płaskie.** Budowało się po `rodzic_id`, a w prawdziwych danych salonu wszystkie podkategorie mają tam identyfikatory, których w tabeli już nie ma (zostały po starszej wersji). Każda podkategoria rysowała się więc jako osobna gałąź główna.
2. **Kasowanie nie patrzyło na zawartość** — kategorię z podkategoriami i produktami dało się usunąć jednym kliknięciem.

## Co jest teraz

**Akcja `rap_editCategory`** (`routes/raport.js`) — zmiana nazwy, przeniesienie pod inną kategorię albo oba naraz:

- źródłem prawdy jest `pelna_sciezka`; po niej przepisujemy **podkategorie** (sam początek ścieżki) i **produkty** (dokładne trafienie plus wszystko poniżej),
- wszystko w jednej transakcji — albo cała operacja, albo nic,
- `rodzic_id` jest przy okazji naprawiane na identyfikator nowego rodzica,
- odmowy: pusta nazwa, nazwa ze znakiem `>`, zajęta ścieżka, przeniesienie pod samą siebie albo pod własną podkategorię,
- wpis w dzienniku zdarzeń: `„stara ścieżka" → „nowa" (podkategorie: n, produkty: m)`.

**Kasowanie** (`rap_deleteCategory`) sprawdza teraz zawartość i odmawia z wyjaśnieniem: *„Kategoria »Inwentaryzacja Tygodniowa > Higieniczne« zawiera 1 produkt. Przenieś je albo zmień nazwę kategorii zamiast kasować."* Świadome wymuszenie jest możliwe parametrem `force`.

**Interfejs** (Magazyn → Kategorie): drzewo buduje się ze ścieżek, więc wreszcie jest drzewem, a przy każdej pozycji są trzy przyciski — ✏️ zmień nazwę, ↪ przenieś (lista kategorii do wyboru, z pominięciem własnych podkategorii), × usuń. Po operacji odświeża się drzewo i lista produktów.

## Próby

### `tests/raport-kategorie.test.js` (11 prób)

| Grupa | Co sprawdza |
|---|---|
| **R01** zmiana nazwy | przepisanie kategorii, podkategorii i produktów w jednej transakcji (BEGIN/COMMIT); podmiana wyłącznie początku ścieżki; odrzucenie pustej nazwy i nazwy ze znakiem `>` **przed** dotknięciem bazy; zajęta ścieżka |
| **R02** przeniesienie | „Płyny” z tygodniowej do miesięcznej (sytuacja ze zgłoszenia); przeniesienie na poziom główny; zakaz przeniesienia pod siebie i pod własną podkategorię; nieznana kategoria/rodzic |
| **R03** kasowanie | kategoria z zawartością nie znika i wraca wyjaśnienie; pusta kasuje się normalnie; `force` kasuje mimo zawartości |

Pełny przebieg: **636 prób w 30 zestawach.**

### Próba na izolowanej bazie

Odtworzony układ z salonu (razem ze starymi, nieistniejącymi `rodzic_id`) i przejście całej ścieżki:

```
1) PRZENIESIENIE „Płyny" z tygodniowej do miesięcznej
   {"status":"success","sciezka":"Inwentaryzacja miesięczna > Płyny","podkategorie":1,"produkty":3}
   📂 Inwentaryzacja miesięczna > Płyny
   📂 Inwentaryzacja miesięczna > Płyny > Dezynfekcja
   • Płyn micelarny → Inwentaryzacja miesięczna > Płyny
   • Spray do rąk  → Inwentaryzacja miesięczna > Płyny > Dezynfekcja

2) ZMIANA NAZWY „Płyny" → „Płyny i dezynfekcja"  … podkategorie: 1, produkty: 3

3) PRÓBY, KTÓRE MAJĄ SIĘ NIE UDAĆ
   pod własną podkategorię: Nie można przenieść kategorii do jej własnej podkategorii.
   nazwa ze znakiem „>”:    Nazwa nie może być pusta ani zawierać znaku „>".
   nazwa zajęta:            Kategoria „… > Płyny i dezynfekcja" już istnieje.
   kasowanie niepustej:     … zawiera 1 podkategorię i 3 produkty. Przenieś je albo zmień nazwę.

4) KONTROLA: produkty bez kategorii — brak, wszystkie ścieżki zgadzają się ze słownikiem
```

### Przy okazji naprawione

`routes/raport.js` tworzył router na poziomie modułu. Drugie wywołanie fabryki (np. w próbach z inną atrapą bazy) doklejało kolejny handler do tego samego routera, a żądania obsługiwał ten pierwszy — z bazą z poprzedniego użycia. Router powstaje teraz przy każdym wywołaniu.

### Zrzut

`drzewo-kategorii.png` — drzewo z wcięciami i trzema przyciskami przy każdej pozycji.
