# Mail powitalny bez grafiki — przyczyna i naprawa

20.10.2026, 08:49 — pierwszy mail serii poszedł do Ambasady Urody (pierwszy klient z reklamy).
W skrzynce wyglądał tak, jakby nie miał ani logo, ani zrzutu ekranu: w ich miejscu ikonki
uszkodzonego obrazka i sam tekst opisu.

## To nie była poczta ani ustawienia skrzynki

Pliki na serwerze są zdrowe i odpowiadają poprawnie:

```
200  /img/estelio-logo.png            | image/png |  17 KB | PNG? true
200  /pomoc-zrzuty/pom-03-pulpit.png  | image/png | 200 KB | PNG? true
```

Blokował je **nasz własny nagłówek**, wysyłany dotąd do wszystkiego (`server.js:72`):

```
Cross-Origin-Resource-Policy: same-origin
```

Ten nagłówek mówi przeglądarce: *„tę treść wolno wczytać wyłącznie stronie z tej samej domeny"*.
Klient pocztowy jest inną domeną — więc grafika nie pokaże się w **żadnej** skrzynce, nie tylko
w naszej. Dotyczyło to wszystkich maili z logo: powitalnych, serii wprowadzającej, przypomnień.

## Naprawa

Nagłówki wyjechały z `server.js` do `routes/naglowki-bezpieczenstwa.js` (żeby dały się objąć
testami). Dwa katalogi z grafiką marketingową dostają `cross-origin`:

```js
const GRAFIKA_DO_MAILI = /^\/(img|pomoc-zrzuty)\//i;
res.setHeader('Cross-Origin-Resource-Policy',
  GRAFIKA_DO_MAILI.test(req.path) ? 'cross-origin' : 'same-origin');
```

To materiały i tak publiczne — logo i zrzuty z przewodnika `/pomoc/`, dostępne pod stałym adresem
dla każdego, kto zna link. **Zdjęcia klientek (`/uploads`) zostają przy `same-origin`** — tego nie
ruszamy, tak samo jak stron i API.

## Dowód

Ten sam mail, ta sama grafika, lokalny serwer, raz ze starym nagłówkiem, raz z nowym; strona
otwarta z `file://`, czyli z innej domeny — dokładnie jak w kliencie pocztowym.

```
tryb stary -> Cross-Origin-Resource-Policy: same-origin    → grafika nie wczytana
tryb nowy  -> Cross-Origin-Resource-Policy: cross-origin   → logo i zrzut widoczne
```

| Plik | Co widać |
|---|---|
| `mail-przed-naprawa.png` | to, co zobaczyła klientka: ikonka zamiast logo, niebieski opis zamiast zrzutu |
| `mail-po-naprawie.png` | ten sam mail po poprawce: logo Estelio i zrzut Pulpitu |

Testy: `tests/naglowki-bezpieczenstwa.test.js` (7) — grafika do maili otwarta, zdjęcia klientek,
strony i API zamknięte, CSP i pozostałe nagłówki nietknięte, otwarcie nie łapie podobnych nazw
katalogów (`/imgur/`, `/pomoc-zrzuty-prywatne/`).

## Uwaga na przyszłość

Wysłany już mail do Ambasady Urody zostaje bez grafiki — nagłówek działa w chwili wczytywania
obrazka, ale klient pocztowy często zapamiętuje pierwszy wynik. Po wdrożeniu poprawki kolejne
maile serii będą miały grafikę; ewentualne powtórzenie pierwszego to decyzja właściciela.

---

## Audyt pozostałych maili (20.10.2026, po pytaniu „dlaczego to nie wyszło wcześniej")

Przeszedłem **każdy obrazek i każdy link w każdym mailu**, jaki system wysyła. Wyszedł drugi błąd,
niezależny od nagłówka:

```
404  /pomoc-zrzuty/trm-09-widok-dzien.png   ← mail „terminarz" (6. w serii)
```

Zrzut istnieje, ale w katalogu przewodnika Terminarza (`/pomoc-terminarz/`), a szablon sklejał
adres na sztywno z `/pomoc-zrzuty/`. Ten mail przyszedłby z dziurą zamiast obrazka **nawet po
naprawie nagłówka**. Poprawione: `zrzut.plik` może być podany pełną ścieżką, a katalog
`/pomoc-terminarz` dołączył do otwartych dla skrzynek.

Pozostałe adresy — bez zastrzeżeń:

```
OBRAZKI (8 unikalnych)   wszystkie 200 image/png, wszystkie w katalogach otwartych po wdrożeniu
LINKI (8 unikalnych)     /pomoc/#logowanie #sprzedaz #klienci #zadatki #magazyn #analiza,
                         /pomoc-terminarz/ — wszystkie 200; stopka → estelio.com.pl (301 na /zamow.html)
ZRZUTY 7/7              każdy przypisany plik istnieje na dysku
```

Maile spoza serii (powitalny, reset hasła, ostrzeżenia o płatności, przypomnienia) nie zawierają
**żadnej grafiki** — mają ciemny nagłówek z emoji, więc ta wada ich nie dotyczyła.

### Sprawdzenie końcowe: czy obrazki naprawdę się wczytują

Wszystkie siedem maili otwarte w przeglądarce **z innej domeny** (`file://`), z nowymi nagłówkami:

```
1. start      obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
2. sprzedaz   obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
3. klienci    obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
4. zadatki    obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
5. magazyn    obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
6. terminarz  obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
7. liczby     obrazkow: 2  wczytane: 2  NIEWCZYTANE: 0
```

## Dlaczego nie wykryły tego testy i wdrożenia

1. **Nagłówki HTTP nie były objęte żadnym testem** — blok siedział wklejony w `server.js`.
2. **Podgląd maila w panelu dawał fałszywe „OK"** — panel stoi na estelio.com.pl, czyli na tej
   samej domenie, więc obrazki wczytują się tam zawsze, niezależnie od nagłówka.
3. **Wysyłka próbna poszła na Gmaila**, a Gmail pobiera grafikę własnym serwerem pośredniczącym —
   reguła `same-origin` dotyczy przeglądarki, więc akurat tam problem był niewidoczny.

## Zabezpieczenie na przyszłość

`tests/maile-grafika.test.js` (20 testów) buduje **każdy** mail serii i sprawdza offline:
każdy obrazek ma plik na dysku i leży w katalogu otwartym dla skrzynek, każdy ma sensowny `alt`,
każdy link prowadzi na naszą domenę. Sprawdziłem, że testy padają na obu dzisiejszych błędach:

```
PRÓBA 1 (stary adres zrzutu):   BRAK PLIKU: .../pomoc-zrzuty/trm-09-widok-dzien.png  → 2 failed
PRÓBA 2 (stary nagłówek):       KATALOG ZAMKNIETY DLA POCZTY: .../pomoc-terminarz/... → 1 failed
po przywróceniu poprawek:       20 passed
```

Pełny zestaw: **702/702**.
