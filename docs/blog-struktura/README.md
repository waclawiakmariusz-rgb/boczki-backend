# Blog Estelio — struktura, czytanie, udostępnianie (2.11.2026)

Prace przygotowawcze przed serią wpisów ze zrzutami. Wszystkie zrzuty w tym katalogu pochodzą ze środowiska izolowanego (localhost:3999, baza `estelio_test`), z wpisu-próbki `blog/wpisy/_przyklad-ukladu.html`.

## Co było nie tak

1. **Lista wpisów nie działała.** `/api/blog/posts` trafiało w trasę `/blog/:slug` (zła kolejność w `routes/blog.js`), więc strona bloga pokazywała trzy zaszyte na sztywno karty. Każdy nowy wpis z panelu byłby niewidoczny.
2. **Dwa renderery artykułu.** Publiczny (w `server.js`) nie miał stylów dla wstępu, ramek ani obrazków; pełniejszy w `routes/blog.js` był nieużywany.
3. Brak: spisu treści, kotwic do sekcji, udostępniania, podglądu linku (og:image), kanału RSS, mapy strony, robots.txt, podglądu szkicu w panelu.

## Co jest teraz

| Element | Gdzie | Uwagi |
|---|---|---|
| Jeden renderer `renderArticle` | `routes/blog.js` | używany przez `/blog/:slug`, podgląd admina i `/api/blog/:slug` |
| Spis treści „W tym wpisie” | automatycznie z `<h2>`, gdy sekcji ≥ 3 | identyfikatory z treści nagłówka, unikalne |
| Kotwice sekcji | „#” przy każdym `<h2>` (widoczny po najechaniu) | klik kopiuje link do sekcji |
| Pasek udostępniania | Kopiuj link · E-mail · WhatsApp · Drukuj | ikony SVG z linii, na telefonie same ikony |
| Zrzuty | `<figure><img><figcaption>` | ramka, cień, klik = powiększenie (lightbox), `Esc` zamyka |
| Ramki | `.ramka.tip` / `.ramka.uwaga` / `.ramka.manager` + `.ramka-tytul` | stara `.highlight-box` nadal działa |
| Kroki, tabela, FAQ | `ol.steps`, `.tabela > table`, `.faq > details` | |
| „Zobacz też” | 3 wpisy: najpierw ta sama kategoria | |
| Podgląd linku | `og:image`, `twitter:card`, `article:*`, JSON-LD | okładka → pierwszy obrazek → logo |
| Okładka | kolumna `okladka` (NULL), pole w panelu | miniatura na liście zamiast emoji |
| Kategorie | + Terminarz, + Dodatki | spójność pilnuje `tests/blog.test.js` |
| Lista | filtry po kategorii (gdy ≥ 4 wpisy), szukajka, uczciwy komunikat błędu | |
| Panel admina | „Zapisz i podejrzyj” (także szkic), „Otwórz”, „Kopiuj link”, podpowiedź klas | podgląd przez `/api/admin/blog/podglad/:id` |
| RSS | `/blog/rss.xml` | ostatnie 20 wpisów |
| Mapa strony | `/sitemap.xml` + `public/robots.txt` | strony stałe + wpisy |

## Narzędzia

- `narzedzia/blog/wgraj-wpis.js <plik>` — wgrywa wpis z `blog/wpisy/*.html` do bazy izolowanej (produkcja tylko z `--produkcja-tak`). Sprawdza, czy obrazki istnieją w `public/`.
- `narzedzia/zrzut-strony.js <url> <plik.jpg> [--viewport WxH] [--pelna] [--js "..."]` — zrzut dowolnej strony publicznej (bez logowania).
- Format pliku wpisu: komentarz `<!--WPIS { … } -->` z metadanymi + treść HTML. Treść wersjonowana w repo, baza jest miejscem publikacji.

## Zrzuty

| Plik | Co pokazuje |
|---|---|
| 01-lista-desktop.jpg | lista z filtrami, szukajką i miniaturą z okładki |
| 02-lista-telefon.jpg | lista na telefonie |
| 03-wpis-desktop-gora.jpg | nagłówek wpisu, pasek udostępniania, spis treści |
| 04-wpis-desktop-calosc.jpg | cały wpis: kroki, zrzuty z podpisami, ramki, tabela, FAQ, „Zobacz też” |
| 05-wpis-telefon.jpg | cały wpis na telefonie |
| 06-wpis-lightbox.jpg | powiększony zrzut po kliknięciu |
| 07-lista-filtr-szukaj.jpg | szukajka bez trafień (szuka w tytule i zajawce) |

## Incydent przy tej pracy

Podczas sprawdzania składni przypadkowo załadowałem `server.js` z produkcyjnym `.env`; proces działał ~2 minuty i migracja startowa dodała pustą kolumnę `okladka` do `blog_posts` na wspólnej bazie. Nic więcej nie zostało zmienione (sprawdzone w `Logi`). Zasada zapisana w pamięci: składnię sprawdza się tylko `node --check`.
