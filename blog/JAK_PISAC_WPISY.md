# Blog Estelio — jak dodawać wpisy (instrukcja robocza)

Stan: 2.11.2026. Wpisy 1–3 gotowe (1 opublikowany, 2–3 jako szkice na produkcji). Ten plik jest źródłem prawdy dla kolejnych wpisów: proces, reguły tonu, narzędzia, lista tematów. Pamięć Claude ma tylko skrót i wskazuje tutaj.

## 1. Zasady treści (decyzje właściciela, nie do dyskusji)

1. **Bez AI slopu.** Język ludzki, krótkie zdania, zero „kluczowych rozwiązań”, „w dzisiejszych czasach”, „warto podkreślić”, „podsumowując”, zero wyliczeń korzyści na siłę. Skrypt kontroli słów-wypełniaczy jest w sekcji 4.
2. **Odbiorczynie:** kobiety 20–45, właścicielki salonów beauty, managerki, pracownice recepcji. Forma „Ty”, żeńska („wpisałaś”, „klientka”). Bez protekcjonalności.
3. **Jeden przykład prowadzony przez cały wpis**, z imionami i kwotami, które zgadzają się ze zrzutami. Stały salon: recepcja **Ola** (manager w demo), **Kasia** (nowa recepcjonistka z wpisu 1), klientka **Marta Zielińska** (wpisy 1–2), **Julia Wiśniewska** (wpis 3). Właściciel nie zdecydował, czy osoby mają wracać we wszystkich wpisach; dotąd wracają.
4. **Nagłówki opisowe**, mówiące co się dzieje („Peeling za 220 zł trafia do cennika”), NIE „Krok 1… Krok 7”, NIE „Co może pójść nie tak”, NIE „Pytania i odpowiedzi / FAQ”. Pytania rozpuszczać w zwykłych akapitach („Jeszcze trzy rzeczy, o które pytają…”). Lista „Jeśli coś się nie zgadza” jako zwykła lista punktowa jest OK.
5. **Żadnych automatycznych elementów szablonowych w treści:** bez spisu treści „W tym wpisie” (usunięty z renderera), bez „N min czytania” (usunięte), bez bloków FAQ `<details>`.
6. **Data wpisu = dzień napisania**, nie z góry. Właściciel poprawił 3.11 → 2.11.
7. **Każdy wpis ma zrzuty** z bazy izolowanej (salon `demo-test`), z podpisami. Każdy zrzut musi odpowiadać opisanemu stanowi (te same kwoty, nazwy). Nigdy zrzuty z produkcji ani z danymi prawdziwych klientek.
8. **Opisujemy stan faktyczny systemu**, nie to, co mówi pomoc. Gdy pomoc kłamie, piszemy jak jest i notujemy rozbieżność w `docs/blog-struktura/README.md`. Znalezione błędy zgłaszamy właścicielowi, nie naprawiamy po cichu (wyjątek: właściciel każe naprawić).
9. **Nie linkować /pomoc-manager/** (reguła z 12.10). Linki do pomocy pracownika `/pomoc/#id` są OK (kotwice sprawdzić w `public/estelio_pomoc_f.html`, nie w `Estelio_pomoc.html`).
10. Ramki `tip` / `uwaga` / `manager` można używać, z własnym tytułem w `ramka-tytul` („Wskazówka”, „Uwaga”, „Dla managera: marża”). Ramka managera = perspektywa właścicielki, nie wykład.
11. Długość: 1200–2500 słów zależnie od tematu. Lepiej krócej i konkretnie niż dłużej i wodniście.
12. Na końcu jedno zdanie o następnym wpisie, bez „zapraszam”.

## 2. Format pliku wpisu

Plik `blog/wpisy/<slug>.html` (treść wersjonowana w repo; baza to tylko miejsce publikacji):

```html
<!--WPIS
{
  "slug": "nazwa-w-adresie",
  "title": "Tytuł. Druga część po kropce, jeśli trzeba",
  "excerpt": "Jedno–dwa zdania na kartę listy i do podglądu linku.",
  "category": "Sprzedaż | Magazyn | Klienci | Terminarz | Dodatki | Zarządzanie | Pracownicy",
  "emoji": "💰",
  "okladka": "/img/blog/<slug>/NN-nazwa.jpg",
  "date_published": "RRRR-MM-DD",
  "status": "draft"
}
-->
<p class="lead">…</p>
<h2>…</h2> <p>…</p>
<figure><img src="/img/blog/<slug>/01-….jpg" alt="…"><figcaption><b>Krótki tytuł.</b> Co widać.</figcaption></figure>
<div class="ramka tip"><div class="ramka-tytul">Wskazówka</div><p>…</p></div>
<ol class="steps"><li>…</li></ol>   <!-- kroki formularza -->
<div class="tabela"><table>…</table></div>
```

Status w pliku zawsze `draft`. Publikacja wyłącznie przyciskiem „Publikuj” w panelu admina (właściciel) — nigdy przez plik.

## 3. Proces (kolejność, której się trzymamy)

1. **Zebrać fakty**: rozdziały pomocy (`public/estelio_pomoc_f.html`, `estelio_pomoc_terminarz.html`), kod (`routes/*.js`, `public/index.html` – id sekcji, pola, przyciski), istniejące scenariusze w `narzedzia/proby/*.json` (gotowe selektory).
2. **Scenariusz zrzutów** `narzedzia/proby/blog-NN-<temat>.json` + skrypt sprzątający `narzedzia/proby/skrypty/blog-NN-sprzatanie.js` (uruchamiany jako `przygotuj` i `posprzataj`; odmawia pracy poza `estelio_test:3307`). Scenariusz ma tworzyć własne dane (klientka, produkt, usługa) i po sobie sprzątać, łącznie ze stanami magazynowymi.
   Uruchomienie: `node narzedzia/proba-ekranu.js narzedzia/proby/blog-NN-<temat>.json` (serwer testowy 3999 musi działać; start przez panel prób 3998: `POST /api/srodowisko/start`). Viewport 1440×900.
3. **Obejrzeć każdy zrzut** (Read) zanim trafi do wpisu. Szukać: obcych danych demo (np. „[demo-stat]”), stanu niezgodnego z tekstem, uciętych tabel (przewinąć `scrollIntoView` przed zrzutem).
4. **Konwersja**: `node narzedzia/blog/obrazki.js <katalog-wyniku> <slug> --mapa '{"fragment-nazwy":"NN-nazwa-docelowa", …}'` → `public/img/blog/<slug>/*.jpg` (1440 px, ~100 KB).
5. **Napisać treść** wg sekcji 1–2. Sprawdzić skryptem z sekcji 4: liczba słów, obrazy istnieją, słowa-wypełniacze, kotwice pomocy.
6. **Podgląd na serwerze testowym**: `node narzedzia/blog/wgraj-wpis.js blog/wpisy/<slug>.html` (baza izolowana), potem w bazie testowej `UPDATE blog_posts SET status='published' WHERE slug=…` (tylko test!), zrzut strony: `node narzedzia/zrzut-strony.js http://localhost:3999/blog/<slug> docs/blog-struktura/NN-wpis-XX-gora.jpg --viewport 1280x900` i `--pelna`. Obejrzeć.
   Uwaga: serwer testowy czyta `routes/blog.js` przy starcie — po zmianie renderera trzeba go zrestartować (kill PID na 3999 + `POST /api/srodowisko/start`), inaczej zrzut pokazuje stary wygląd.
7. **Commit na dev**: wpis, obrazy, scenariusz, skrypt sprzątania, dopisek w `docs/blog-struktura/README.md` (co zauważone, jakie pułapki). Push dev. **Na main** — właściciel powiedział 2.11 „jak już to zrobisz to wrzucaj już na main” → ff-merge i push (`--no-verify` bywa potrzebny przez strażnik kasowania; tylko gdy diff sprawdzony).
8. **Produkcja**: `node narzedzia/blog/wgraj-wpis.js blog/wpisy/<slug>.html --produkcja-tak` tworzy/aktualizuje wpis jako szkic w bazie produkcyjnej — WYŁĄCZNIE na słowo właściciela („wgraj szkice”). Właściciel ogląda przez „Podgląd” w `admin-blog.html` i publikuje przyciskiem.
9. **Pamięć**: po każdym wpisie dopisać stan do `projekt_blog_ozywienie.md` (numer, commit, pułapki) i zaktualizować listę tematów poniżej.

## 4. Kontrola jakości tekstu (gotowy skrypt)

```bash
node -e '
const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");
const t=s.replace(/<!--WPIS[\s\S]*?-->/,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
console.log("słów:",t.split(" ").length,"| zrzutów:",(s.match(/<img/g)||[]).length,"| h2:",(s.match(/<h2/g)||[]).length);
const slop=["kluczow","innowacyj","w dzisiejszych","warto podkreślić","podsumowując","nie tylko","ale także","dynamiczn","rewolucj","zoptymalizuj","kompleksow","holistycz","bezproblemow","intuicyjn","płynn","w erze","wyjątkow","niezwykle","niesamowit","idealn","krok po kroku"];
for(const w of slop){const m=t.toLowerCase().match(new RegExp(w,"g"));if(m)console.log("  sprawdź słowo:",w,"×",m.length);}
const brak=[...s.matchAll(/src="([^"]+)"/g)].map(m=>m[1]).filter(o=>!fs.existsSync("public"+o));console.log("brakujące obrazy:",brak.length?brak.join(", "):"żadnych");
const h=fs.readFileSync("public/estelio_pomoc_f.html","utf8");for(const m of s.matchAll(/\/pomoc\/#([a-z-]+)/g))console.log("kotwica",m[1],h.includes("id=\""+m[1]+"\"")?"OK":"BRAK");
' blog/wpisy/<slug>.html
```

## 5. Pułapki techniczne scenariuszy (sprawdzone)

- Widoki magazynu (Stan, Inwentaryzacja) i lista produktów w Sprzedaży pracują na `window.daneCache` z chwili startu — po każdym zapisie wołać `pobierzDane(true)` i odczekać ~1,8 s.
- Cena detalu przy sprzedaży NIE podpowiada się: ustawić `.item-unit-price` i wysłać `input`. Produkt wybiera się po `option.value` zawierającym nazwę; lista pokazuje „(Dostępne: N)”.
- Płatność z portfela: `.item-pay = 'Portfel'` → zielony panel; zaznaczyć checkbox zadatku i wywołać `uzyjZaznaczonychZadatkow()`. System rozbija zadatek na pozycje i dokłada wiersz dopłaty. Lista metod w oknie Mix NIE zawiera Portfela.
- Mix: `.item-pay='Mix'`, po „Zarejestruj wszystkie” otwiera się `#split-payment-modal`; wiersze ustawiać przez `splitMixRows=[{method,amount}…]; renderSplitRows(); przeliczReszteSplit();` i kliknąć `#btn-confirm-split`.
- Zwrot produktu jest w profilu klientki w zakładce **Produkty** (`przelaczTabProfilu('produkty', btn)`), zabiegów w **Wizyty**; przycisk `[onclick^="otworzZwrot"]`, okno `#zwrot-modal-overlay`, pola `#zwrot-kwota`, `#zwrot-metoda`, `#zwrot-przywroc-stan`, `#zwrot-powod`, zapis `#zwrot-zapisz-btn` (confirm → próba odpowiada „tak”).
- Historia sprzedaży nie ma ołówka; edycja dzisiejszej pozycji: `#dzisiejsza-sprzedaz .btn-edit` → `#edit-modal-overlay`, zamknięcie `zamknijPopup()`.
- Profil klientki po sprzedaży może pokazywać stare liczniki („Łącznie wydano”) — kliknąć „Odśwież” w profilu; w scenariuszu 1 nawet to nie pomogło (do sprawdzenia osobno).
- Pulpit demo ma zadania „[demo-stat] …” — nie używać zrzutów Pulpitu bez sprzątania tych danych.
- Przy zmianie sekcji (`pokaz`) próba czyści `window.__proba.posty` — sprawdzenia opierać na DOM, nie na liczbie POST-ów.
- Pliki w repo bywają CRLF; skrypty podmieniające tekst muszą normalizować `\r\n`.

## 6. Struktura bloga (co już jest, żeby nie wymyślać od nowa)

- Jeden renderer `routes/blog.js` → `renderArticle` (kotwice „#” przy h2, pasek Kopiuj link / E-mail / WhatsApp / Drukuj, figure + lightbox, ramki, tabele, steps, „Zobacz też”, og:image z okładki). Bez spisu treści i bez czasu czytania — celowo.
- Lista `public/blog.html`: filtry kategorii (gdy ≥ 4 wpisy), szukajka, miniatura z okładki. Kategorie: Zarządzanie, Pracownicy, Magazyn, Klienci, Sprzedaż, Terminarz, Dodatki (spójność pilnuje `tests/blog.test.js`).
- Panel `public/admin-blog.html`: Publikuj / Cofnij do szkicu (PATCH statusu), Podgląd szkicu, Otwórz, Kopiuj link, pole okładki.
- `/blog/rss.xml`, `/sitemap.xml`, `public/robots.txt`.
- Historia i pułapki: `docs/blog-struktura/README.md`.

## 7. Tematy — zrobione i pozostałe

Zrobione (plik → stan):
1. `od-pustego-konta-do-pierwszej-sprzedazy` — OPUBLIKOWANY na produkcji 2.11.
2. `sprzedaz-od-a-do-z` — szkic na produkcji (id 5).
3. `kosmetyki-i-liczenie` — szkic na produkcji (id 6).

Pozostałe (kolejność proponowana; właściciel może zmienić):
4. **Magazyn rozbudowany** (sekcje `rap_*`: kategorie drzewiaste, produkty z partiami, stany minimalne, „Zadania na dziś” / „Pozostałe braki” z trzema decyzjami Wyrównaj / Nie zamawiam / Usuń, przyjęcie z faktury, raport, archiwum). Scenariusze pomocnicze: `magazyn-produkt.json`, `kategorie-magazyn.json`, `przyjecie-towaru-pelny.json`. Kategoria: Magazyn.
5. **Kartoteka klientki** (profil, RODO i dokumenty, preferencje, notatki, urodziny, portfel i karnety w profilu, ukrycie / anonimizacja / zmarła / flaga ostrzeżenia, dwie klientki o tym samym nazwisku). Scenariusz pomocniczy: `klienci-nowa.json`, `klienci-zadatek.json`. Kategoria: Klienci.
6. **Terminarz od zera** (sześć ustawień: zespół, godziny, usługi jako plan czasu i zasobów, zasoby, grafik, nieobecności; pierwsza wizyta w kreatorze; trzy osie: rezerwacja / obecność / rozliczenie; rozliczenie bez drugiej kasy). Zrzuty gotowe w `public/pomoc-terminarz/trm-*.png` (aktualne), scenariusz `terminarz-nowa-wizyta.json`, zasiew `skrypty/zasiew-dzien.js`. Kategoria: Terminarz.
7. **Terminarz w trudnych sytuacjach** (pakiet kilku zabiegów u dwóch osób, 2× ten sam zabieg bez marginesu, „Umów mimo grafiku”, kolizja gabinetu/urządzenia, zmiana terminu z wersją, nieobecność i potrącenie jednostki, rezerwacja techniczna). Materiał: `docs/terminarz-komplet-pakiet/`, scenariusze `terminarz-zgloszenie-20.json`, `terminarz-zgloszenia-19-21.json`, `komplet-pakiet.json`. Kategoria: Terminarz.
8. **Szybka rezerwacja do wpłaty zadatku + link do płatności** (hold: nieznany numer, sprawdzenie kartoteki, „Do wpłaty do…”, link tpay z regulaminem, akceptacja tworzy profil, wygaśnięcie, wpłata po wygaśnięciu, Sprawy E40–E42). Materiał: `docs/terminarz-szybka-rezerwacja/`, scenariusze `terminarz-szybka-rezerwacja-a/b.json`. Kategoria: Terminarz.
9. **Wewnętrzny system powiadomień** (dzwonek Spraw: priorytety P0/P1/P2, kto widzi, rozwiązanie z wynikiem; Zadania zespołu i telefony z wynikami rozmów; e-maile do klientek: potwierdzenie i przypomnienie wizyty — na produkcji wysyłka WSTRZYMANA (MAILE_WIZYT=proba), napisać ostrożnie; czego system NIE robi: SMS). Scenariusze: `zadania-pulpit.json`, `pomoc-zadania.json`; zrzuty `trm-24/25`. Kategoria: Zarządzanie.
10. **Zgłoszenia (tickety)** (ikona w aplikacji, formularz, załączniki, komentarze, licznik nieprzeczytanych, co dzieje się po stronie Estelio). Kod: `routes/tickety.js`, sekcja `tickety`. Kategoria: Zarządzanie.
11. **Dodatki Moje Estelio+** (Klub lojalnościowy, Foto przed/po, Link do płatności, Terminarz, Ewidencja pakietów; co dają, jak włączyć, ceny z katalogu `Features_Catalog`, co jest UKRYTE/pilot). Zrzut `pom-31-dodatki.png`, `pom-43-klub.png`. Kategoria: Dodatki.
12. **Panel managera** (Pulpit „Na dziś”, Analiza dnia/miesiąca/roku, Analiza pracownika i zabiegu, koszty, cele, Kreator dostępów i role, Dziennik zdarzeń). Zrzuty `pom-20…pom-28`, scenariusz `pulpit-analiza.json`. Kategoria: Zarządzanie.

Możliwe później: pracownicy i rozliczenia (odświeżenie starego wpisu), Klub oczami klientki, przewodnik dla nowego salonu (onboarding).

## 8. Co zgłoszone właścicielowi przy pisaniu (żeby nie zgłaszać drugi raz)

- Cena detalu nie podpowiada się przy sprzedaży (pomoc twierdzi inaczej) — opisane jako stan faktyczny.
- Mix bez Portfela; portfel przez zielony panel — opisane.
- Historia sprzedaży bez ołówka — opisane.
- „−” w Inwentaryzacji nie działał (serwer odrzucał ujemną różnicę) — NAPRAWIONE 2.11 (`04afedb`), na produkcji po Pull+Restart.
- Przyjęcie towaru: produkt ze słownika, nie z ręcznej nazwy (pomoc nieaktualna) — opisane.
- Profil klientki: liczniki nie odświeżały się po sprzedaży w próbie — nie wyjaśnione.
