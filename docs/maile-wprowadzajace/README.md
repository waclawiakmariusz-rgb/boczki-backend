# Seria powitalna dla nowego salonu — maile edukacyjne po założeniu konta

**Stan:** gotowa, **wyłączona** (`MAILE_WPROWADZAJACE=off`). Nic nie wychodzi do klientów, dopóki właściciel nie przestawi zmiennej.
**Podglądy:** `docs/maile-wprowadzajace/podglad/` — HTML (otwórz w przeglądarce) i PNG (do szybkiego obejrzenia).

---

## 1. Po co to jest

Nowy salon dostaje dziś jeden mail powitalny i zostaje sam z całym systemem. Seria rozkłada naukę na trzy tygodnie: jeden mail = jedna funkcja = jedna rzecz do zrobienia tego dnia. Każdy prowadzi do właściwego rozdziału przewodnika `/pomoc/`, który ma teraz prawdziwe zrzuty ekranu — mail nie musi tłumaczyć wszystkiego sam.

## 2. Harmonogram

Dzień liczony od **założenia salonu** (nie od zakupu). Okno jest domknięte z obu stron — jeśli serwer nie działał w danym dniu, mail wyjdzie w kolejnym, byle w oknie.

To jest stan wyjściowy z kodu. **Liczba wiadomości nie jest ustalona na stałe** — w panelu dopisujesz ósmą, dziewiątą i kolejne, ustawiasz im własny termin, a dowolną możesz wyłączyć bez kasowania. Kolejność na liście wynika z terminu, nie z tego, gdzie wiadomość powstała.

| # | Etap | Dzień | Temat | Zrzut w mailu | Prowadzi do |
|---|---|---|---|---|---|
| 1 | `start` | 1–3 | Pierwszy dzień z Estelio — zacznijmy od trzech rzeczy | pulpit | `/pomoc/#logowanie` |
| 2 | `sprzedaz` | 3–7 | Pierwsza sprzedaż — i dlaczego warto wpisywać wszystko | formularz sprzedaży | `/pomoc/#sprzedaz` |
| 3 | `klienci` | 6–10 | Kartoteka klientek — pamięć salonu, nie zeszyt | profil klientki | `/pomoc/#klienci` |
| 4 | `zadatki` | 10–14 | Zadatki i karnety — koniec sporów o to, ile zostało | spis zadatków | `/pomoc/#zadatki` |
| 5 | `magazyn` | 14–18 | Magazyn — żeby krem nie skończył się w środę | raport „co zamówić" | `/pomoc/#magazyn` |
| 6 | `terminarz` | 18–23 | Terminarz — kalendarz, który zna Wasz cennik i sprzęt | widok dnia | `/pomoc-terminarz/` |
| 7 | `liczby` | 23–29 | Liczby salonu — zysk, a nie tylko obrót | analiza miesiąca | `/pomoc/#analiza` |

Tematy są bez emoji — w skrzynce firmowej wyglądają poważniej i rzadziej trafiają do zakładki „Oferty".

Każdy mail ma tę samą budowę: wstęp (po co to komu) → **zrzut ekranu z działającego systemu** → 4–5 sekcji merytorycznych → ramka **„Na co uważać"** z częstym błędem → **„Jedna rzecz na dziś"** → przycisk do rozdziału przewodnika → stopka z rezygnacją. Objętość: 1500–1900 znaków treści, czyli 2–3 minuty czytania.

## 3. Bezpieczeństwo

Te same zasady co w `routes/przypomnienia.js` (sprawdzone w praktyce od 10.10):

- moduł **tylko czyta** `Licencje` i pisze do dwóch własnych tabel: `Maile_wprowadzajace_wyslane`, `Maile_wprowadzajace_stop`. Nie dotyka rejestracji, logowania ani danych salonu;
- **zero tras HTTP** — nie da się go wywołać z zewnątrz;
- błąd startu nie kładzie serwera (`try/catch` w `server.js`), błąd pojedynczej wysyłki nie przerywa reszty;
- **idempotencja**: rezerwacja w tabeli (`UNIQUE(tenant_id, etap)`) **przed** wysyłką — dev i prod na wspólnej bazie nie wyślą tego samego dwa razy. Gdy SMTP padnie, wpis jest kasowany i próba wraca następnego dnia;
- **CUTOFF = 2026-10-18** — seria dotyczy wyłącznie salonów założonych od tego dnia. Nikt, kto pracuje od maja, nie dostanie „pierwszych kroków";
- **BCC do właściciela** — widzisz dokładnie to, co dostają klientki;
- **rezygnacja**: wpis do `Maile_wprowadzajace_stop (tenant_id)` wyłącza całą serię dla salonu. Każdy mail mówi: „Odpisz jednym słowem »stop«".

## 4. Jak uruchomić

Zmienna w panelu Hostingera (bez apostrofów):

```
MAILE_WPROWADZAJACE=proba
```

- `off` — **domyślnie**, nic się nie dzieje;
- `proba` — do logu leci `PRÓBA — wysłałbym „etap" do adres (salon, N dni po starcie)`, nic nie wychodzi. Zostaw na dzień–dwa i sprawdź, czy lista adresatów wygląda sensownie;
- `on` — wysyłka.

Przebieg uruchamia się 5 minut po starcie serwera, potem raz na dobę.

## 5. Panel w adminie — czytanie i poprawianie treści

**Panel admina → zakładka „✉️ Maile powitalne"**. Zrzuty: `podglad/panel-01-lista.png`, `panel-02-edytor.png`, `panel-03-podglad.png`.

Co tam jest:

- **Lista wiadomości** — temat, kiedy wychodzi, ile ma sekcji, czy treść jest domyślna, zmieniona czy dopisana w panelu, i do ilu salonów już poszła;
- **➕ Nowa wiadomość** — dopisujesz kolejny mail edukacyjny: podajesz temat, system nadaje identyfikator i proponuje termin po ostatniej wiadomości, resztę wypełniasz jak zwykle;
- **Termin i wyłącznik przy każdej wiadomości** — „wysyłka od dnia / do dnia" oraz pole „wyłączona", które zatrzymuje jedną wiadomość bez kasowania jej treści;
- **Podtytuł w nagłówku maila** — domyślnie „Pierwsze kroki w systemie", możesz wpisać własny (np. przy mailach spoza serii startowej);
- **Edytor** — temat, druga linijka podglądu w skrzynce, nagłówek, wstęp, sekcje (dodawanie i usuwanie), ramka „na co uważać", „jedna rzecz na dziś", napis na przycisku, plik zrzutu i podpis;
- **Podgląd na żywo** — dokładnie ten HTML, który pójdzie do klientki, budowany z niezapisanej jeszcze wersji z edytora;
- **Wysyłka próbna** pod dowolny adres — nie zapisuje się w historii wysyłek, więc nie zablokuje prawdziwej wiadomości dla salonu;
- **Przywróć domyślną** — przy wiadomości z kodu cofa Twoje zmiany; przy wiadomości dopisanej w panelu kasuje ją na dobre (pyta o potwierdzenie).

Czego w panelu celowo **nie ma**: przełącznika wysyłki i harmonogramu. Tryb siedzi w zmiennej środowiskowej na serwerze, okna dni w kodzie — żeby jedno kliknięcie w przeglądarce nie uruchomiło wysyłki do klientów.

Pod spodem: treść domyślna leży w pliku, panel zapisuje nadpisania do tabeli `Maile_wprowadzajace_tresc` (jeden wiersz = jedna wiadomość). Brak wiersza = obowiązuje treść z kodu. Pole `etap` i okno dni zawsze pochodzą z pliku — panel zmienia wyłącznie teksty.

Endpointy (wszystkie za hasłem admina): `GET /api/admin/maile_wprow`, `POST …_zapisz`, `…_reset`, `…_podglad`, `…_test`.

## 6. Dziennik wysyłek — dowód nadania

Zrzut: `podglad/panel-06-dziennik.png`. Pod listą wiadomości w panelu jest tabela z **każdą próbą wysyłki**:

| Kolumna | Co zawiera |
|---|---|
| Kiedy | data i godzina co do minuty |
| Salon | nazwa salonu + identyfikator, pod spodem przycisk „Wyślij ponownie" |
| Adres | dokładny adres, na który poszła wiadomość |
| Wiadomość | temat, który klient zobaczył w skrzynce |
| Rodzaj | `automat` (seria), `wysłane ponownie` (Ty, ręcznie), `próbka` (test pod dowolny adres) |
| Potwierdzenie | „✓ przyjęty przez serwer" z odpowiedzią operatora i numerem wiadomości, albo „✕ błąd" z powodem |

Wyszukiwarka u góry filtruje po nazwie salonu, adresie e-mail i identyfikatorze.

**Rozmowa z salonem wygląda wtedy tak:** wpisujesz nazwę salonu, widzisz wiersz „2026-10-22 11:35 · Ambasada Urody · k.lasocka@o2.pl · Pierwsza sprzedaż… · automat · ✓ przyjęty przez serwer" i mówisz: sprawdźcie pocztę z 22.10 z godziny 11:35, temat taki a taki.

**Ponowna wysyłka** (przycisk przy salonie) wysyła tę samą wiadomość jeszcze raz pod adres salonu. Pierwsza wysyłka **zostaje w dzienniku jako dowód**, a ponowienie dopisuje się osobnym wierszem z rodzajem „wysłane ponownie" i adnotacją, że zrobił to admin. Nie rusza tabeli idempotencji, więc automat nie potraktuje tego jak „jeszcze nie wysłano".

**Czego dziennik nie wie:** co stało się z wiadomością po stronie odbiorcy. „Przyjęty przez serwer" znaczy, że poczta Estelio oddała wiadomość operatorowi i dostała potwierdzenie — czy trafiła do skrzynki, do spamu, czy została zablokowana, tego nie widzimy. Ale data, godzina i numer wiadomości wystarczą, żeby odbiorca odnalazł ją u siebie albo żeby jego dostawca sprawdził, co z nią zrobił.

Tabela: `Maile_wprowadzajace_log` (osobna od tabeli idempotencji — tam jeden wiersz na salon i wiadomość, tutaj każda próba).

## 7. Zmiana treści w kodzie

Cała treść domyślna siedzi w **jednym pliku bez żadnej logiki**: `routes/maile-wprowadzajace-tresc.js`. Można go edytować bez ryzyka, że coś przestanie działać — harmonogram i bezpieczniki są obok (`maile-wprowadzajace.js`), a wygląd w `mailer.js`.

Jedna wiadomość to pola:

| Pole | Co to jest |
|---|---|
| `temat` | temat wiadomości — to widać na liście w skrzynce |
| `preheader` | druga linijka podglądu, zaraz po temacie |
| `naglowek` | pierwsze, pogrubione zdanie w treści |
| `wstep` | 2–3 zdania: po co to komu |
| `sekcje` | `[tytuł, treść]` — tyle, ile trzeba; to jest mięso wiadomości |
| `zrzut` | `{ plik, podpis }` — plik z `/pomoc-zrzuty/`, ten sam co w przewodniku |
| `uwaga` | ramka „na co uważać" — częsty błąd albo pułapka |
| `dzis` | jedna konkretna rzecz do zrobienia tego dnia |
| `cta` + `kotwica` | napis na przycisku i rozdział `/pomoc/`, do którego prowadzi |
| `podtytul` | napis pod logo; domyślnie „Pierwsze kroki w systemie" |
| `okno` | `[od, do)` w dniach od założenia salonu |
| `wylaczona` | `true` = wiadomość zostaje w liście, ale nie wychodzi |

W mailu **nie ma licznika „N z M"** — liczba wiadomości należy do właściciela i może rosnąć, a klientka nie ma powodu oglądać numeracji.

**Jedyne pole, którego nie zmieniamy po uruchomieniu serii:** `etap`. Po nim system pamięta, co już wysłał — zmiana oznacza, że ktoś dostanie tę samą wiadomość drugi raz.

Do czytania i komentowania bez wchodzenia w kod: **`docs/maile-wprowadzajace/TRESCI.md`** (plik generowany z treści — nie edytuj go, bo przy kolejnym przeglądzie się nadpisze).

## 8. Wymóg przed włączeniem

Maile pokazują zrzuty ekranu spod `/pomoc-zrzuty/`. Pliki są w repozytorium od commita z 18.10, ale **na serwerze pojawią się dopiero po `Pull` + `Restart`**. Dopóki tego nie zrobisz, obrazki w wiadomościach będą puste. Kolejność: najpierw wdrożenie, potem `proba`, potem `on`.

## 9. Co jeszcze warto rozważyć (nie zrobione)

- **Rezygnacja jednym kliknięciem** zamiast odpisywania „stop" — wymaga publicznej trasy z tokenem HMAC, jak przy zgodach.
- **Reakcja na zachowanie**: pominąć mail o magazynie, gdy salon już wpisał 20 produktów. Dziś seria leci po kalendarzu, nie po postępach.
- **Mail ósmy po 6 tygodniach**: „co się zmieniło w Estelio" — ale to już newsletter, nie onboarding.
