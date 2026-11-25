# Eksport widocznych danych do Excela — rozpoznanie i plan (25.11.2026)

Polecenie właściciela (25.11.2026): *„chcę też, żeby była możliwość eksportu wszystkich widocznych danych w poszczególnych widokach,
np. jak jestem w kosmetykach, to mogę sobie zrobić kliknięcie i to, co widzę, co konkretnie sobie filtruję, jest możliwe do eksportu
do pliku Excel; tak samo rzeczy w magazynie i innego rodzaju miejscach, gdzie są jakieś dane … eksporty danych, które w razie potrzeb
chcę pozyskać do np. jakiejś zewnętrznej analizy AI.”*

Stan: ZBUDOWANE 25.11.2026 (rozdz. 7) po „rób wszystko lokalnie” — gałąź `eksport-excel`, lokalnie, czeka na decyzję o pushu.

## 1. Co jest dziś

- **Nie ma eksportu do Excela.** Są dwa eksporty CSV (pełny raport sprzedażowy w Analizie, baza zgód SMS) i eksport PDF
  (Stan magazynowy, Magazyn, Inwentaryzacja). CSV otwiera się w Excelu, ale nie jest „plikiem Excel” i nie zachowuje typów kolumn.
- **Brak biblioteki do XLSX** w projekcie (ani w `package.json`, ani w `public/lib/`). CSP dopuszcza skrypty tylko z własnej domeny
  (`script-src 'self'`), więc biblioteka z CDN odpadłaby bez zmiany CSP — i tak jej nie potrzebujemy (patrz rozdz. 3).
- Widoki z danymi to w panelu **tabele HTML renderowane z tablic w pamięci po zastosowaniu filtrów** (np. Magazyn: `renderMagazyn()`
  rysuje od nowa to, co przechodzi przez `aktualnyFiltrMagazyn` i szukajkę). To ważne: **to, co jest w tabeli na ekranie, jest dokładnie
  tym, co użytkownik „widzi po filtrach”** — eksport może czytać gotową tabelę, bez dublowania logiki filtrów w 30 miejscach.

## 2. Inwentarz widoków z danymi (index.html, 48 tabel)

| Moduł (menu) | Widok / sekcja | Tabela | Kolumny (nagłówki) | Filtry na ekranie |
|---|---|---|---|---|
| Magazyn | Magazyn (`#magazyn`) | `#tabela-body` (nagłówek rysowany dynamicznie: Produkt / Suma / Status, w widoku szczegółowym więcej) | dynamiczne | szukajka, przyciski kategorii, sortowanie |
| Magazyn | Inwentaryzacja (`#inwentaryzacja`) | `#lista-inv` (lista) | — | — |
| Magazyn | Co zamówić (`#co-zamowic`) | `#lista-braki`, `#lista-terminy` | Produkt / Stan / Cena; Produkt / Ważność / Dni / Stan | szukajka |
| Kosmetyki | Stan magazynowy (`#rap_magazyn`), Raport (`#rap_report`) | tabele rysowane w całości przez JS | dynamiczne | kategorie, okres |
| Sprzedaż | Dzisiejsza sprzedaż | `#sales-history-body` | Data / Klient / Co / Kwota / Kto | — |
| Sprzedaż | Historia | `#historia-list` | Data / Klient / Zabieg-Produkt / Sprzedawca / Kwota / Komentarz | szukajka |
| Sprzedaż | Zadatki | `#tabela-zadatki-body` | Data / Klient / Kwota / Typ / Cel / Status | szukajka |
| Sprzedaż | Podsumowanie dnia | `#podsumowanie-lista` | Godzina / Klient / Co / Kwota / Płatność / Sprzedawca | — |
| Klienci | Profil klientki | `#kartoteka-list`, `#tabela-kosmetyki`, `#tabela-utracone`, `#tabela-zwrocone` | Data / Co kupił / … | szukajka historii |
| Klienci | Urodziny | `#bd-list` | Data / Klient / Telefon / SMS / Tel | miesiąc, zgody |
| Klienci | Ranking | `#rnk-lista` (lista) | — | — |
| Klienci / Retencja | Moduł Retencji | `#retencja-lista` | Klient / Ostatni zabieg / Dni po terminie | kategoria, kanał |
| Zadania | Zadania zespołu | `#zd-tbody` | Pri. / Typ / Tytuł / Opis / Przypisane / Wykonanie / Deadline / Status | szukajka, filtry |
| Analiza | Raport miesięczny, Rok, BI, Koszty, Konsultacje… | `#an_rep-daily-table`, `#an_yearly-table-body`, `#an_bi-churn-table`, `#kp_tbody`, `#akon_*` | wg widoku | miesiąc, pracownik, rok |
| Konsultacje | Raportowanie, Admin, Historia | `#kon_results-list`, `#kon_campaigns-list`, `#kon_logs-list` | wg widoku | kto, kampania, status |
| Administracja | Zabiegi (cennik), Dostępy, Logi, Zmiana awaryjna, Baza SMS | `#tabela-zabiegow-body`, `#admin-users-list`, `#logs-list`, `#lista-awaryjna`, `#sms-lista` | wg widoku | szukajki |
| Klub | Członkowie, Odbiory | `#klubadm-czlonkowie` (karty, nie tabela) | — | — |
| Terminarz | kalendarz | brak tabeli | — | — |

Wniosek: **~30 widoków tabelarycznych** o wspólnej budowie (`thead` z `th` + `tbody` z wierszami) i **4–5 widoków „kartowych”**
(Inwentaryzacja, Ranking, Klub → Członkowie, Kosmetyki w widoku kafelków), które trzeba obsłużyć osobno z danych w pamięci.

## 3. Jak zrobić plik Excel bez biblioteki i bez CDN

Plik `.xlsx` to archiwum ZIP z kilkoma plikami XML. Da się go napisać w czystym JS w przeglądarce (ok. 150 linii):
ZIP bez kompresji (metoda „stored”, wymaga tylko CRC-32), arkusz z komórkami tekstowymi „inline” i liczbowymi, plik `styles.xml`
z pogrubionym nagłówkiem. Excel, LibreOffice i Arkusze Google otwierają taki plik normalnie. Zalety: zero zależności, zero zmian w CSP,
nic nie wychodzi na serwer (dane i tak są już na ekranie użytkownika), plik powstaje w ułamku sekundy nawet dla kilku tysięcy wierszy.

Nowy plik: `public/eksport-excel.js` (ładowany jak `rabaty.js`, z `?v=__WERSJA_PLIKOW__`).

## 4. Projekt — jak to będzie działać dla użytkownika

**Jeden przycisk „⬇ Excel” w nagłówku każdego widoku z danymi.** Kliknięcie zapisuje plik `estelio-<widok>-<RRRR-MM-DD>.xlsx`
z tym, co jest na ekranie **po filtrach, szukajce i sortowaniu** (wiersze ukryte filtrem są pomijane; kolumny z przyciskami „Akcja/Akcje”
pomijane; kwoty „1 234,50 zł” trafiają jako liczby, żeby Excel mógł sumować; daty jako tekst w postaci z ekranu). Pierwszy wiersz =
nagłówki kolumn pogrubione; na końcu arkusza wiersz: „Eksport z Estelio, <salon>, <widok>, <data i godzina>, filtry: <co było ustawione>”.
Gdy widok ma kilka tabel (np. Co zamówić: braki + terminy), każda trafia do osobnego arkusza w jednym pliku.

**Paczka A — silnik + widoki tabelaryczne (ok. 1 dzień).** `eksport-excel.js`: generator XLSX, czytanie widocznej tabeli, przycisk
dodawany automatycznie przy wejściu do sekcji, która ma widoczną tabelę z nagłówkiem (bez ręcznego dopisywania przycisku w 30 miejscach
HTML — zgodnie z zasadą „zero masowych podmian w plikach”). Obejmuje: Magazyn, Co zamówić, Sprzedaż (4 widoki), Profil klientki,
Urodziny, Retencja, Zadania, Analiza (tabele), Konsultacje, Administracja (Zabiegi, Dostępy, Logi, Zmiana awaryjna, Baza SMS).

**Paczka B — widoki kartowe (ok. pół dnia).** Osobne eksportery z danych w pamięci, z aktualnym filtrem: Kosmetyki (Stan magazynowy
i Raport — tu kolumny ustalimy razem: nazwa, firma/model, kategoria, stan, cena zakupu/sprzedaży, ważność), Inwentaryzacja, Ranking
klientek, Klub → Członkowie (imię, telefon, saldo, poziom, data dołączenia) i Odbiory.

**Paczka C — Dziennik Zdarzeń (1–2 h).** Każdy eksport zostawia wpis: „Użytkownik X wyeksportował do Excela widok Y (N wierszy,
filtry: …) 25.11.2026 o 14:05.” Dane klientek wychodzą z systemu, więc warto mieć ślad, kto i co pobrał (RODO). Jedna nowa akcja
POST `eksport_log`, rejestracja w `server.js`. Dla ról: eksport dostępny tam, gdzie użytkownik widzi dane (nic ponad to, co i tak widzi).

**Czego nie obejmuje:** Terminarz (kalendarz, nie tabela — osobna rozmowa: eksport wizyt z zakresu dat jako lista), wykresy w Analizie
(eksportujemy tabele pod wykresami), załączniki (zdjęcia, PDF).

## 5. Testy i odbiór

- Jednostkowe: generator XLSX (poprawny ZIP i XML — rozpakowanie i sprawdzenie zawartości w teście), parser komórek (kwoty, liczby,
  tekst, puste, znaki `<&>` w nazwach), pomijanie wierszy ukrytych i kolumn akcji, nazwy plików.
- Próba ekranowa na bazie izolowanej: Magazyn z filtrem → plik → otwarcie pliku w teście i porównanie z tym, co było w tabeli;
  Kosmetyki, Historia sprzedaży z szukajką, Zadania; zrzuty przycisku w widokach jasnym/ciemnym/telefon.
- Ręczne otwarcie kilku plików w Excelu przez właściciela (odbiór).

## 6. Pytania do właściciela (przed „ruszaj”)

1. Przycisk automatyczny w każdym widoku z tabelą (proponuję) czy tylko w wybranych, wskazanych widokach?
2. Czy eksport ma zostawiać wpis w Dzienniku Zdarzeń (proponuję: tak) i czy ma być dostępny dla każdej roli, która widzi dane,
   czy tylko dla admina/managera?
3. Kosmetyki: które kolumny mają trafić do pliku (proponuję wszystkie, które są w kartotece produktu, łącznie z ceną zakupu)?
4. Jeden plik z wieloma arkuszami przy kilku tabelach w widoku (proponuję) czy osobne pliki?
5. Kolejność: najpierw paczka A (większość widoków), potem B, potem C — czy inaczej?

## 7. ZBUDOWANE 25.11.2026 (gałąź `eksport-excel`, lokalnie; nic nie wypchnięte)

Polecenie właściciela (25.11, po planie): *„rób wszystko lokalnie … TAK o to mi chodzi … tak, chcę mieć możliwość eksportów, może to
zrobić manager, megaadmin, recepcja, za każdym razem musi być to rejestrowane w dzienniku zdarzeń”.* Założenie (do potwierdzenia):
**admin też może** — bez tego właściciel nie mógłby eksportować.

**Paczka A — silnik + widoki tabelaryczne:** nowy plik `public/eksport-excel.js` (ładowany w `index.html` jak inne skrypty panelu).
- Generator `.xlsx` bez biblioteki i bez CDN: ZIP „stored” (CRC-32) + XML arkuszy z komórkami tekstowymi „inline” i liczbowymi;
  nagłówek pogrubiony i zamrożony, kwoty z groszami w formacie `#,##0.00`, szerokości kolumn z treści, stopka kursywą.
  Plik otwarty niezależnie: kontener ZIP przez .NET (System.IO.Compression) i parser XML — wpisy „stored”, XML poprawny, komórki tekstowe i liczbowe zgodne; w testach własny czytnik ZIP sprawdza CRC i treść.
- Przycisk „⬇ Excel” pojawia się sam w nagłówku aktywnej sekcji (obok „Eksport PDF”, gdy nagłówek ma grupę przycisków), tylko gdy
  sekcja ma widoczną tabelę z wierszami (sprawdzenie co 1,5 s, wyłącznie w aktywnej sekcji) i tylko dla ról admin/megaadmin/manager/recepcja
  (rola z localStorage; praktykantka nie widzi przycisku). Zero zmian w HTML poszczególnych widoków.
- Czytanie „tego, co widać”: wiersze ukryte filtrem/szukajką pomijane; wiersze-komunikaty („Brak danych”, colspan) pomijane; kolumny
  „Akcja/Opcje” oraz kolumny z samymi przyciskami (≥80% komórek) pomijane; pola formularzy w komórkach → wartości (checkbox TAK/NIE,
  select → tekst opcji); komórki wieloliniowe łączone „ · ”; nagłówki z `textContent` (bez CSS WIELKIE LITERY), bez strzałek sortowania.
- Kwoty jako liczby: „1 234,50 zł” → 1234.5, „+80 pkt” → 80, „12,5%” → 12.5; numery (telefony „601 200 301”, EAN, PIN, kody,
  kolumny Telefon/Nr/PIN/Kod/ID) zostają tekstem; daty i godziny tekstem w postaci z ekranu.
- Kilka tabel w widoku: ten sam zestaw kolumn → jeden arkusz z kolumną „Grupa” (nagłówek nad tabelą), różne kolumny → osobne arkusze.
- Opis filtrów do stopki i Dziennika: wartości widocznych pól (placeholder/etykieta: wartość), wybrane opcje (poza „Wszystkie”),
  zaznaczone checkboxy, aktywne przyciski filtrów. Nazwa pliku `estelio-<widok>-<RRRR-MM-DD>.xlsx`.

**Paczka B — widoki bez zwykłej tabeli** (eksportery dedykowane w tym samym pliku, rejestr `widoki[id sekcji]`):
- Kosmetyki → Stan magazynowy (`rap_magazyn`): kategorie są zwinięte, więc dane z pamięci widoku po szukajce, kolumny Kategoria, Nazwa,
  Ilość, Jednostka, Minimum, Status (jak na ekranie), Data modyfikacji, Ważność.
- Magazyn → Inwentaryzacja: karty → Kategoria, Produkt, Ilość (suma partii). Klienci → Ranking: karty → Pozycja, Klientka, Telefon,
  Transakcje, Suma. Klub → Członkowie: z pamięci widoku po szukajce i sortowaniu; Klub → Do obsłużenia: wnioski, odbiory nagród,
  zgłoszenia do promocji jako trzy arkusze (dokładnie to, co widać: nowe + ostatnio obsłużone). W `index.html` trzy jednolinijkowe
  dopiski zapamiętujące listy strony „Do obsłużenia”.

**Paczka C — Dziennik Zdarzeń:** nowa akcja POST `eksport_log` w `routes/logi.js` (zarejestrowana w `server.js`): sprawdza rolę
w bazie (admin/megaadmin/manager/recepcja), zapisuje wpis `EKSPORT DANYCH`: *„Użytkownik Ola wyeksportował do Excela widok
„Stan Magazynowy” (25.11.2026 o 12:05): 8 wierszy; kolumny: Produkt, Il., Ważność, Cena; filtry: Detal; plik: estelio-stan-magazynowy-2026-11-25.xlsx.”*
Panel prosi o ten wpis PRZED zapisaniem pliku — bez potwierdzenia (odmowa roli, błąd bazy, brak sieci) plik nie powstaje, a użytkownik
widzi komunikat. Przy okazji: router w `routes/logi.js` tworzony w fabryce (był na poziomie modułu).

**Testy:** `tests/eksport-excel.test.js` (20: generator XLSX sprawdzany własnym czytnikiem ZIP, wartości komórek, czytanie tabel
na atrapie DOM, grupowanie arkuszy, opis filtrów, widoki dedykowane), `tests/eksport-log.test.js` (10: role, zdanie w Dzienniku,
przycinanie, błędy). Pełny zestaw: patrz raport z sesji.

**Próba ekranowa** `narzedzia/proby/eksport-excel.json` (serwer 3999, demo-test, Ola = manager): 0 FAIL, 9 zrzutów —
`proby-wyniki/eksport-excel-test-2026-11-25-11-07/`: Magazyn 13 → filtr „Detal” → 8 wierszy → eksport → „✅ Zapisano (8 wierszy)”;
Kosmetyki (11 produktów, szukajka „Płyn” → 3); Inwentaryzacja 13 kart; Klub → Członkowie (0 członków → bez przycisku); Historia
sprzedaży 20 wierszy; praktykantka bez przycisku; Dziennik ze zdaniem o eksporcie; tryb ciemny; telefon. Baza izolowana posprzątana.

**Poza zakresem (jak w planie):** Terminarz, wykresy Analizy, załączniki; Klub → inne podstrony (Nagrody, Promocje…) działają przez
zwykłe czytanie tabel, jeśli jakąś mają.

**Poprawka po odbiorze (25.11, ok. 12:20):** właściciel otworzył przykładowy plik w Excelu — otworzył się bez naprawy, ale komórka
Produkt z Magazynu była jednym tekstem „DETAL · Witamina D3+K2 · Suplementy | Ola | dostawa 1.09.2026” („źle to wygląda, powinno być
w osobnych kolumnach, a nie |”). Od teraz komórka z kilkoma informacjami (linie, „ | ”, „ · ”) rozbija się na osobne kolumny; w znanych
widokach kolumny mają nazwy (Magazyn → Produkt: Kategoria, Produkt, Typ, Przyjął(a), Dostawa; przy kilku dostawach „Dostawy”;
podpowiedź „↓ sprzedaż pobiera…” pomijana), w pozostałych: „Nagłówek”, „Nagłówek (2)”, … (np. Historia: „Zabieg / Produkt”, „Zabieg / Produkt (2)”).
Mapa nazw: `ROZBICIA` w `public/eksport-excel.js` — łatwo dopisać kolejne widoki. Próba powtórzona: 0 FAIL
(`proby-wyniki/eksport-excel-test-2026-11-25-11-23/`), testy 21/10. Przykładowe pliki: `narzedzia/proby/skrypty/eksport-excel-przyklady.js`
→ `proby-wyniki/przyklady-eksportu/`.
