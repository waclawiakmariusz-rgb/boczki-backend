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
