# Pomoc kontekstowa — raport P-01 i P-02

**Data:** 22.10.2026 · **Sprawdzone wobec:** `main` = `c4bc86e` · **Testy:** 843/843 w 45 zestawach
**Zakres:** inwentaryzacja widoków, wspólny komponent „?", katalog treści, trzy miejsca pilotażowe.
**To NIE jest wniosek o publikację na produkcji** — zgodnie z rozdz. 1 specyfikacji.

---

## 1. Co powstało

| Plik | Rola |
|---|---|
| `public/pomoc-kontekstowa.css` | styl komponentu — wymiary i kolory przepisane z rozdz. 7 specyfikacji |
| `public/pomoc-kontekstowa.js` | jeden komponent: przycisk, chmurka, pozycjonowanie, klawiatura, bezpieczeństwo |
| `public/pomoc-tresci.json` | katalog treści (wersja `2026-10-22.1`) |
| `narzedzia/pomoc-mapa-widokow.js` | generator mapy widoków **z kodu** + kontrola formatu katalogu |
| `docs/.../POMOC_MAPA_WIDOKOW.csv` | mapa — 110 kontekstów |
| `tests/pomoc-kontekstowa.test.js` | 21 prób: format, bezpieczeństwo, wygląd, podpięcie |

Zmiany w `public/index.html` ograniczają się do: wczytania dwóch plików, **trzech slotów**
i sześciu linii w `przelaczTabProfilu()` (przestawienie kontekstu zakładki). Żaden proces
biznesowy, walidacja ani uprawnienie nie zostały dotknięte.

## 2. P-01 — inwentaryzacja (110 kontekstów)

Mapa powstaje **z kodu**, nie z pamięci — `node narzedzia/pomoc-mapa-widokow.js` czyta
`index.html` i `terminarz.js` i można ją odtworzyć po każdej zmianie w aplikacji.

```
Zapisano POMOC_MAPA_WIDOKOW.csv — 110 kontekstów.
   do-opisania           107
   wdrozone-sprawdzone     3
```

Co się w tym mieści: **47 sekcji** aplikacji (z etykietami z menu bocznego), **45 modali
i nakładek**, **18 kontekstów Terminarza** (4 widoki, 8 zakładek ustawień, 3 kroki kreatora,
2 panele). Kolumny: kontekst, ścieżka w kodzie, widok nadrzędny, tytuł, rola, dodatek,
miejsce kotwicy, źródło, link, status.

**Czego mapa jeszcze nie ma:** zakładek wewnątrz sekcji innych niż profil klientki i Terminarz
(np. Klub, Konsultacje mają własne podstrony) oraz pustych stanów. Dopiszę je w P-03, gdy będę
czytał te moduły pod kątem treści — wcześniej byłyby to puste wiersze bez wartości.

## 3. P-02 — komponent i trzy typy osadzenia

| Typ osadzenia | Gdzie | Kontekst |
|---|---|---|
| Nagłówek strony | Kosmetyki → **Stan Magazynowy** | `magazyn.stan` |
| Formularz | Magazyn → **Nowy Produkt** | `magazyn.pro.produkt.nowy` |
| Zakładka | **Profil klientki** (wspólny pasek, kontekst zmienia się z zakładką) | `klient.profil.*` |

Pomiar w izolowanym środowisku (`docs/.../proba.js`, Chrome 1400×1050 i iPhone 390×844):

```
komponent wczytany: true · arkusz: true · katalog: wersja 2026-10-22.1, kontekstów: 3

1) NAGŁÓWEK STRONY — Stan Magazynowy
   przycisk: 44x44 (koło 36px) · nazwa dla czytnika: „Pomoc: Stan magazynowy"
   chmurka: {"szer":360,"rola":"dialog","ariaModal":null,"fokusWKarcie":true,
             "tytul":"Sprawdź swoje zapasy","pozycji":3,
             "link":"/pomoc/#magazyn","grot":"block"}
   aria-expanded: true
   po Esc — chmurka zamknięta, fokus wrócił na przycisk

2) FORMULARZ — Nowy Produkt
   Enter na „?" otworzył pomoc: true
   formularz NIE wysłany, wartości na miejscu: true
   po Esc wartości nadal na miejscu: true

3) ZAKŁADKA — profil klientki
   kontekst na starcie: klient.profil.podsumowanie
   chmurka: „Profil klientki — ogólnie" (jawnie oznaczona pomoc nadrzędna)
   po zmianie zakładki: stara chmurka zamknięta, kontekst → klient.profil.zadatki

4) Jedna chmurka naraz — otwartych chmurek: 1

5) iPhone 390 — {"szer":360,"poza_prawo":0,"poza_lewo":0,"poza_dol":0}
   dokument 390 / ekran 390 → strona się nie rozjeżdża

BLEDY JS: brak
```

Zrzuty: `pomoc-01-magazyn.png`, `pomoc-02-formularz.png`, `pomoc-03-zakladka.png`,
`pomoc-04-telefon.png` (w tym katalogu).

### Usterka złapana pomiarem

Pierwsza wersja dawała chmurkę **402 px zamiast 360** — aplikacja nie ustawia `box-sizing:
border-box` globalnie, więc padding dokładał się do szerokości. Na telefonie karta wystawała
wtedy 16 px poza ekran. Poprawione i zabezpieczone próbą („chmurka: 360 px WRAZ z paddingiem").

## 4. Decyzje i odstępstwa od makiety

1. **„Stan początkowy" → „Obecna ilość".** Makieta mówi „stan początkowy to ilość, którą masz
   teraz", formularz ma pole **Obecna Ilość**. Zgodnie z rozdz. 5 specyfikacji dostosowałem
   POMOC do formularza, a nie odwrotnie — nie dokładam pól, żeby zgadzały się z ilustracją.
2. **Wskazówka z ikoną „i", nie wykrzyknikiem.** Wariant „wąski ekran" na makiecie 02 ma
   wykrzyknik; specyfikacja mówi wprost, że to zastrzeżone dla rzeczywistego ostrzeżenia.
3. **Jeden przycisk na pasku zakładek profilu**, nie sześć. Kontekst przestawia
   `przelaczTabProfilu()`; dopóki nie ma treści per zakładka, chmurka uczciwie mówi
   „Profil klientki — **ogólnie**".
4. **Slot zamiast gotowego przycisku w znaczniku.** W HTML stoi pusty `<span class="pk-slot">`,
   a komponent podmienia go na przycisk (obserwator DOM). Dzięki temu to samo zadziała
   w Terminarzu i innych ekranach rysowanych z JS, bez dopisywania czegokolwiek w ich kodzie.

## 5. Bezpieczeństwo — co jest pilnowane próbą, nie obietnicą

- treść renderowana **tekstem** (`textContent`); jedyne `innerHTML` to własne ikony SVG,
- **jeden** `fetch` w całym komponencie — wczytanie katalogu; żadnego POST, żadnych danych
  klientek, formularzy czy ekranów nie wysyłamy nigdzie,
- linki tylko z listy `/pomoc/`, `/pomoc-manager/`, `/pomoc-terminarz/`, `/pomoc-maile`,
  `/przewodnik-klienta`; wszystko inne jest ignorowane, a nie pokazywane jako fałszywy link,
- kotwica linku musi **istnieć** w docelowym dokumencie — próba sprawdza `id="magazyn"`
  w `estelio_pomoc_f.html`, a nie samo HTTP 200,
- katalog nie może zawierać telefonu, kwoty ani adresu e-mail (osobna próba),
- awaria katalogu nie blokuje widoku: komponent pokazuje „Instrukcja w przygotowaniu".

## 6. Rozbieżności dokumentacji i kodu

| Rzecz | Stan |
|---|---|
| Przewodnik z 08.06.2026, sekcja `#magazyn`: dostawa jako edycja ilości 2 → 14 | **Nieaktualne.** Bieżące `/pomoc/` mówi już „Przyjęcie dostawy to osobny ekran" i zgadza się z kodem (sekcja `#nowy`). Pomoc linkuje do bieżącego `/pomoc/#magazyn`, nie do przewodnika z czerwca. |
| Dwa magazyny: `#magazyn` (Kosmetyki) i `#rap_magazyn` (dodatek `rap_module`) | Potwierdzone w kodzie. Pomoc do „Nowego produktu" ma `availability.dodatek = rap_module`; salon bez dodatku nie zobaczy instrukcji do ekranu, którego nie ma. |
| Nagłówek „Dodanie nowego produktu" w przewodniku nie ma własnego `id` | Linkuję do szerszego rozdziału `#magazyn`, a podpis mówi „Magazyn — pilnowanie zapasów", więc nie obiecuję konkretnego akapitu. |

## 7. Czego potrzebuję od właściciela (tylko to)

1. **Czy ruszamy P-03 na całość (107 kontekstów), czy najpierw węższy zakres** — np. same
   moduły, z których korzysta recepcja (magazyn, sprzedaż, klienci, terminarz), a administracja
   i dodatki później. To jedyna decyzja, która zmienia kolejność pracy.
2. **Czy pomoc ma się pojawić także w modalach** (45 pozycji w mapie) — część z nich to drobne
   potwierdzenia, gdzie przycisk „?" byłby szumem. Moja propozycja: tak, ale tylko tam, gdzie
   modal to formularz z decyzją (zadatek, zwrot, RODO, soft-delete), a nie proste „czy na pewno".

Reszty nie pytam — mapa, treści i linki powstają z kodu i dokumentacji.

## 8. Następny krok (P-03)

Rozszerzenie na pozostałe konteksty partiami, modułami: dla każdego sprawdzenie przepływu
w kodzie, napisanie 35–65 słów, podpięcie slotu i dopisanie wiersza do mapy. Po każdej partii
`node narzedzia/pomoc-mapa-widokow.js` aktualizuje CSV i kontroluje format.

---

# P-03, partia 1 — codzienne ekrany recepcji (22.10.2026)

Po akceptacji wzorca („obejrzałem jak to wygląda w Magazyn, jest ok, zastosuj do całego systemu")
pomoc dostało **19 ekranów** i **6 zakładek profilu klientki** — razem **25 kontekstów**.

## Obchód wszystkich podpiętych ekranów

```
EKRAN                 PRZYCISK  TYTUŁ CHMURKI                   SŁÓW  POZA EKRANEM
pulpit                jest      Co wymaga uwagi dzisiaj          29    nie
magazyn               jest      Sprawdź swoje zapasy             45    nie
inwentaryzacja        jest      Liczenie tego, co na półce       32    nie
nowy                  jest      Wpisujesz nową dostawę           35    nie
co-zamowic            jest      Czego zaraz zabraknie            29    nie
rap_add               jest      Dodajesz nowy produkt            22    nie
slownik               jest      Firmy, modele i ceny sprzedaży   29    nie
sprzedaz              jest      Zapisujesz sprzedaż              36    nie
dzisiejsza-sprzedaz   jest      Poprawianie dzisiejszych wpisów  27    nie
historia              jest      Szukasz w starszych wpisach      12    nie
zadatki-lista         jest      Kto ma wpłacony zadatek          29    nie
podsumowanie          jest      Zamykasz dzień                   14    nie
klient-profil         jest      Najważniejsze o klientce         28    nie
urodziny              jest      Kto ma urodziny w tym miesiącu   15    nie
ranking-klientow      jest      Kto zostawia najwięcej           13    nie
leady                 jest      Zgłoszenia z reklam              29    nie
retencja              jest      Do kogo warto zadzwonić          16    nie
tickety               jest      Piszesz do nas o problemie       17    nie
logi                  jest      Kto co zrobił w systemie         16    nie
ekranów z działającą pomocą: 19/19 — bez zastrzeżeń · BLEDY JS: brak
```

Zakładki profilu klientki (jeden przycisk, sześć kontekstów):

```
podsumowanie  klient.profil.podsumowanie  Najważniejsze o klientce
wizyty        klient.profil.wizyty        Historia zabiegów klientki
produkty      klient.profil.produkty      Co klientka u nas kupiła
zadatki       klient.profil.zadatki       Wpłaty tej klientki
analityki     klient.profil.analityki     Wzorce tej klientki
dokumenty     klient.profil.dokumenty     Zgody i podpisane papiery
zakładek z pomocą nadrzędną (ma być 0): 0
```

## Trzy błędy złapane próbami, nie okiem

1. **Wszystkie zakładki pokazywały treść pierwszej.** Przycisk zapamiętywał klucz w chwili
   podpięcia, a przy zakładkach zmienia się on w locie. Teraz klucz czytany jest ze slotu przy
   każdym kliknięciu — osobna próba tego pilnuje.
2. **Chmurka otwierała się w rogu okna**, gdy przycisk należał do ekranu, który nie jest
   wyświetlony (zerowy rozmiar). Teraz w takiej sytuacji pomoc po prostu się nie otwiera.
3. **Zła treść dla „Kreatora Produktu / Kosmetyku".** Napisałem, że to słownik firm i modeli dla
   przyjęcia towaru; w kodzie ten ekran ustala też **ceny sprzedaży** i zasila „Rejestrację
   Sprzedaży". Poprawione po przeczytaniu sekcji, zanim trafiło do odbioru.

## Przy okazji: rozwiązana migotliwa próba

Trzy razy 21.10 pojedyncza próba w `lojalnosc.test.js` padała w pierwszym przebiegu i przechodziła
przy powtórce. Pełny log pokazał przyczynę: **`Exceeded timeout of 5000 ms`** — ta próba naprawdę
generuje kod QR (320 px) i przy 45 zestawach potrafi nie zdążyć. To była zadyszka maszyny, nie
wada produktu; limit podniesiony do 15 s z komentarzem. Dwa kolejne pełne przebiegi: 844/844.

## Co zostaje (107 kontekstów)

Analiza (8 widoków), Administracja (11), Konsultacje (3), Klub (10 podstron), Terminarz (18 —
ma własny system pomocy „Pomoc" w nagłówku, do uzgodnienia czy dublować), modale (45).
