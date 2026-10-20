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
