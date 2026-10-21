# Podsumowanie dnia — wtorek 21.10.2026

**Dla kogo:** właściciel (Mariusz) oraz druga maszyna robocza (DELL) — żeby po `git pull` było
wiadomo, co się zmieniło, czego nie trzeba robić drugi raz i gdzie leżą dowody.

**Stan na koniec dnia:**
- `main` = `dev` = **`96d8b50`**, obie gałęzie wypchnięte na GitHub.
- **Produkcja** (estelio.com.pl) stoi na **`3403686`** (wdrożenie 20:16) — **czeka na `Pull` + `Restart`** w hPanelu.
- 23 commity, 103 pliki, **+5207 / −137** linii. Testy: **822** w 44 zestawach, wszystkie przechodzą.

---

## 1. Jednym zdaniem

Dzień zgłoszeń od właściciela: dorobiliśmy kasowanie wizyty wpisanej przez pomyłkę i trzeci tryb
Historii („kto chodzi na ten zabieg"), naprawiliśmy dwie rzeczy, które **mówiły klientkom
nieprawdę** (mail obiecujący kanały kontaktu, które nie działają) i dwie, które **mówiły nieprawdę
recepcji** (13 z 14 spraw jako „pilne", obcięte etykiety przycisków), a na koniec telefon dostał
prawdziwą siatkę z kafelkami zamiast listy zastępczej.

---

## 2. Co weszło na `main` (chronologicznie)

| Godz. | Commit | Co to jest |
|---|---|---|
| 09:18 | `8778da1` | Fałszywy alarm w smoke teście (401 z wejścia bez sesji) — poprawka harnessu |
| 10:42 | `9a15d8f` | **Zgłoszenie #10:** koniec cichego gubienia wybranego wykonawcy |
| 10:57 | `de8d5ee` | **#12a:** każdy zabieg ma swój kolor + legenda kategorii |
| 11:06 | `5e5fac0` | **#12b:** system sam rozpoznaje pierwszą wizytę na dany zabieg |
| 11:14 | `5662cbd` | **#11:** kafelek-szkic widoczny od razu i przeciągalny |
| 12:22 | `a85b0fe` | Audyt iPhone'a — 12 widoków, dwa rozmiary (patrz sprostowanie w pkt 6!) |
| 14:04 | `d10e999` | **Maile do klientek:** potwierdzenie przy zapisie + przypomnienie dzień przed |
| 14:55 | `3a2fbe7` | Przewodnik `/pomoc-maile` ze zrzutami: gdzie się klika, kto NIE dostanie wiadomości |
| 15:03 | `ba8076d` | Jasne logo Estelio w nagłówku maili o wizytach |
| 15:29 | `29e96f1` | Link „Historia wizyt" w szczegółach wizyty + rozróżnienie odbyte/zaplanowane |
| 15:38 | `61926b5` | **Pętla zapytań** w zakładce powiadomień e-mail: 349 → 2 |
| 16:10 | `89e5d43` | **Skasowanie wizyty wpisanej przez pomyłkę** — osobny stan od odwołania, ze śladem |
| 16:22 | `3df16e5` | **Mail do klientki bez fałszywych obietnic** (patrz pkt 3) |
| 16:33 | `499386a` | Historia klientki: pięć stanów, pięć naprawdę różnych kolorów |
| 16:42 | `5682e97` | Zdjęty widok **„Tydzień"** — zostają Dzień, Agenda, Zasoby, Historia |
| 16:50 | `b976d4e` | **Znacznik `?v=` liczy się sam** z wersji wdrożenia (koniec ręcznego podbijania) |
| 17:02 | `be6003a` | Historia bez kafelka „wartość wykonanych" — u klientki i u pracownika |
| 17:32 | `1084477` | Zdjęty przycisk **„Przejmij"** — terminarzem zajmuje się recepcja |
| 17:53 | `cb44893` | **Reguła pilności naprawiona** (patrz pkt 4) |
| 18:21 | `b4f86bc` | **Historia → Zabieg**: chipsy zabiegów, lista unikalnych klientek z telefonem |
| 18:32 | `79f04c4` | **Masowe domknięcie zaległości** — najpierw podgląd, potem zapis |
| 19:42 | `3403686` | „Więcej działań": przyciski przestały się ucinać, akapit usunięty |
| 20:08 | `96d8b50` | **Siatka z kafelkami na telefonie** zamiast listy zastępczej |

---

## 3. Dwie rzeczy, które mówiły klientkom nieprawdę

Właściciel zarezerwował wizytę sam sobie i przeczytał maila uważnie. Znalazł dwa zdania:

1. **„Nie możesz przyjść? Odpisz na tę wiadomość."** — wiadomość wychodzi z naszej skrzynki
   technicznej, więc odpowiedź trafia do nas albo na adres właściciela z licencji. **Nie do
   recepcji**, która ma za chwilę zwolnić termin.
2. **„Nie chcesz takich powiadomień? Odpisz jednym słowem »stop«."** — **nieprawda.** Nic
   w systemie nie czyta poczty przychodzącej (jedyny IMAP to `routes/booksy.js`, do innego
   zadania). Rezygnację zaznacza salon w karcie klientki (`Klienci.bez_maili`).

Teraz: „Skontaktuj się bezpośrednio z salonem: telefonicznie … albo mailowo …" (dane
z **Ustawienia → Profil salonu**), jawne zdanie „ta wiadomość jest wysyłana automatycznie",
a rezygnacja przez recepcję. Gdy salon nie uzupełnił kontaktu — nie wymyślamy drogi, której nie ma.

**Do zrobienia przez właściciela:** uzupełnić telefon w Profilu salonu dla każdego salonu, który
włączy powiadomienia. Druga sprawa do decyzji: seria wprowadzająca dla salonów ma to samo zdanie
o „stop", ale tam odpowiedź leci na `kontakt@estelio.com.pl`, czyli do Ciebie — działa, o ile
reagujesz ręcznie.

---

## 4. Dwie rzeczy, które mówiły nieprawdę recepcji

**Pilność.** W dzwonku 13 z 14 spraw miało czerwoną plakietkę „Pilne teraz", każda z powodem
„bo wizyta już się odbyła". Przyczyna: dwie reguły liczyły czas **bez kierunku** —
`minut <= 48*60` jest prawdą dla **każdej** wizyty z przeszłości (różnica ujemna), a przebieg
eskalacji podnosił do P0 wszystko z `powiazany_czas <= NOW()+120min`.

Teraz **P0 = trzeba zdążyć**: termin w przyszłości, termin który minął w ostatniej dobie, albo
zaległość finansowa (E13/E19) po dobie bez reakcji — maksymalnie przez tydzień. Potem sprawa
schodzi do P1 i zostaje jako rzecz do nadrobienia. Nic się nie zamyka samo, każda zmiana
priorytetu ma wpis w dzienniku sprawy.

**Etykiety przycisków.** W „Więcej działań" przyciski stały w rzędzie bez zawijania i ucinały się
w połowie słowa („Przełóż całą w", „Nieobecna (po"). Obcięta etykieta przy przycisku, który
**odwołuje** albo **kasuje** wizytę, to proszenie się o pomyłkę.

---

## 5. Co dostała recepcja nowego

- **Skasowanie wizyty wpisanej przez pomyłkę** (`trm_usun`) — osobny stan od odwołania: wypada ze
  statystyk odwołań, nie zakłada sprawy, ale zostawia ślad (kto, kiedy, dlaczego) w historii
  klientki i w Dzienniku Zdarzeń. Nie wolno skasować wizyty rozliczonej, wykonanej ani w trakcie.
- **Historia → Zabieg** — chipsy zabiegów (wielokrotny wybór) → lista **unikalnych klientek**
  z telefonem na pierwszym planie, liczbą wizyt, ostatnią i najbliższą umówioną. Kafelek
  „z telefonem" ostrzega, do ilu osób w ogóle da się zadzwonić.
- **Masowe domknięcie zaległości** — podgląd („zniknie 6 spraw, w tym…"), dopiero potem zapis.
  Nie rusza spraw pilnych ani takich z nieobsłużonymi wizytami; wszystko da się wznowić.
- **Siatka z kafelkami na telefonie**, przewinięta do pierwszej wizyty dnia.

---

## 6. Sprostowanie: moja wcześniejsza decyzja była błędna

W audycie iPhone'a (rano, `a85b0fe`) zapisałem: *„widok Dzień na telefonie to lista, nie siatka —
i tak zostaje: siatka z pięcioma kolumnami na 390 px byłaby nieczytelna"*. **Nieprawda.** Siatka od
początku umiała przewijać się w poziomie. Wieczorem cofnięte, sprostowanie dopisane w
`docs/terminarz-iphone/README.md`.

Przy okazji wyszły trzy rzeczy, których nie było widać pod listą zastępczą:
`kolumnaGodzin()` wstawiała inline `position:relative` (godziny **nie** były przyklejone),
kafelek miał `touch-action: pan-y` (blokował przesuwanie palcem), dymek wystawał 20 px poza ekran.

---

## 7. Pułapki warte zapamiętania (metody, nie kod)

1. **`scroll-behavior: smooth` na `.main-content`** — przypisanie `scrollTop` **animuje**
   przewijanie. Odczyt zaraz po przypisaniu zwraca starą wartość, a kolejny render odtwarza
   pozycję złapaną w połowie animacji. Używać `scrollTo({ behavior: 'auto' })`.
2. **Pomiar zamiast oka przy ucięciach:** `scrollWidth` kontra rzeczywista szerokość przycisku.
   Ucięty napis widać wtedy liczbą, zanim ktoś przyśle zrzut.
3. **Ręczne `?v=` przy plikach** to mina — przez trzy dni zmian nikt go nie podbił. Teraz liczy
   się sam z wersji wdrożenia; `tests/wersja-plikow.test.js` pilnuje, żeby nie wrócił ręczny.
4. **Kolory stanów sprawdzać liczbowo** (odcień, nasycenie), nie wzrokowo — pięć „różnych" reguł
   dawało pięć identycznych białych kwadracików.
5. **Przed zaufaniem strażnikowi: przywrócić błąd i zobaczyć, że próba pada.** Robione dziś przy
   kolorach (3/11), znaczniku wersji (2/5), regule pilności (2/35) i zawijaniu przycisków (1/5).

---

## 8. Co zostaje otwarte

| Rzecz | Stan |
|---|---|
| **Pull + Restart na produkcji** | stoi `3403686`, na main jest `96d8b50` — po restarcie Pulpit ma pokazać `96d8b50` |
| **Telefon w Profilu salonu** | bez niego mail do klientki nie poda żadnej drogi kontaktu |
| **„Błąd bazy danych"** | zgłoszony ok. 17:00, **nieustalony** — baza odpowiadała w 0,13 s, zapytania logowania przechodziły. Gdy wróci: zanotować godzinę, mam godziny wszystkich wdrożeń |
| **Migotliwa próba** | 3× dziś pojedyncza próba padła w PIERWSZYM przebiegu i przeszła przy powtórce (raz `lojalnosc.test.js`, okolice `loj_aktywacja_token`). Przy następnym wystąpieniu zapisać pełny log |
| **Mail przy odwołaniu/przełożeniu wizyty** | świadomie etap drugi, nie zaczęty |
| **Seria wprowadzająca a „stop"** | do decyzji (pkt 3) |
| **Tag `ostatnia-dobra-2026-10-21`** | do założenia po spokojnym dniu pracy recepcji |

---

## 9. Jak wrócić do pracy na DELL-u

```bash
git pull                      # main = dev = 96d8b50
npm install                   # gdyby doszły zależności (dziś nie doszły)
npx jest                      # ma być 822/822 w 44 zestawach
```

Izolowane środowisko (MariaDB 3307 + serwer 3999 na `.env.test`, salon `demo-test`):
`narzedzia/srodowisko-testowe/start-test.cmd` i `stop-test.cmd`, odświeżenie danych demo:
`narzedzia/srodowisko-testowe/odswiez-dane-demo.cmd`.
Poza gitem zostają: `.env`, `.env.test`, hasło salonu demo, katalog `design/`.

**Dowody z dzisiaj** (każdy katalog ma README z pomiarami, zrzutami i skryptem próby):
`terminarz-usuwanie`, `terminarz-kolory-historii`, `terminarz-widoki`, `terminarz-historia-bez-kwot`,
`terminarz-przejmij` (także reguła pilności i domykanie zaległości), `terminarz-historia-zabiegu`,
`terminarz-akcje`, `terminarz-siatka-telefon`, `maile-wizyt`.
