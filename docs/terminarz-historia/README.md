# Historia wizyt w Terminarzu — dwa spojrzenia na te same dane

Prośba właściciela z 19.10.2026: móc zobaczyć w jednym miejscu historię konkretnej klientki (co, kiedy, u kogo) oraz — w drugą stronę — co w wybranym okresie robiła konkretna osoba z zespołu.

**Gdzie:** Terminarz → przełącznik widoków → **Historia** (obok Dzień, Tydzień, Agenda, Zasoby).

---

## 1. Co pokazuje

### Zakładka „Klientka"
Wyszukujesz po nazwisku, telefonie albo ID. Nad listą pięć liczb: ile wizyt, ile wykonanych, ile odwołanych, ile nieobecności i łączna wartość wykonanych zabiegów. Pod nimi dwie listy: najczęstsze zabiegi i osoby, u których klientka bywa. Niżej oś czasu od najnowszej wizyty: data, godziny, każdy zabieg osobno z **osobą, która go wykonała**, stan, znacznik „z pakietu" i cena. Przy odwołaniu widać powód i czy odwołał salon czy klientka; przy nieobecności — adnotację. Kliknięcie w kartę otwiera pełne szczegóły wizyty.

### Zakładka „Pracownik"
Wybierasz osobę i zakres. Nad listą: ile zabiegów wykonała, ile obsłużyła klientek, ile czasu spędziła przy pracy, ile wizyt odwołano, ile było nieobecności i jaka była wartość wykonanych zabiegów. Obok lista „co robi najczęściej". Niżej dni od najnowszego, w każdym pozycje: godzina, klientka, zabieg, stan, cena, a przy zastępstwach dopisek.

Zakres dat wybierasz sam (pola od–do) albo skrótem: 30 dni, 3 miesiące, rok. Domyślnie ostatnie 90 dni.

## 2. Uprawnienia

| Rola | Co widzi |
|---|---|
| Recepcja, manager, właściciel | obie zakładki, wszystkie osoby i klientki, z cenami |
| Kosmetolog | wyłącznie **własną** historię, bez cen; zakładka „Klientka" w ogóle się nie pojawia |

Serwer nie ufa temu, co przyjdzie z przeglądarki: przy roli specjalisty parametr wyboru osoby jest ignorowany i zawsze podstawiana jest osoba zalogowana.

## 3. Jak to działa pod spodem

Dwie nowe akcje **wyłącznie do odczytu** w `routes/terminarz.js`:

- `trm_historia_klientki` — `{ id_klienta | klient_nazwa, od, do }`
- `trm_historia_pracownika` — `{ osoba, od, do }`

Obie czytają `Term_Rezerwacje` złączone z `Term_Pozycje`, liczą podsumowania po stronie serwera i nic nie zapisują. Zakres jest obowiązkowy i ograniczony do 400 dni, żeby jedno kliknięcie nie ciągnęło całej historii salonu.

**Uwaga nazewnicza:** parametrem wyboru osoby jest `osoba`, nie `pracownik` — to drugie pole niesie w każdym żądaniu tożsamość wywołującego (`api()` wysyła `pracownik: kto()`), więc nazwanie parametru tak samo podmieniało zalogowaną osobę. Wyłapała to próba `H03`; przy dodawaniu kolejnych akcji warto o tym pamiętać.

## 4. System prób

### Próby jednostkowe — `tests/terminarz-historia.test.js` (13 prób)
Kontrakt routera na atrapie bazy (supertest + express), bez MariaDB:

| Grupa | Co sprawdza |
|---|---|
| **H01** historia klientki | składanie spłaszczonych wierszy z JOIN w wizyty z pozycjami; wykonawca faktyczny wygrywa nad planowanym (zastępstwo); podsumowanie liczy tylko wykonane (odwołana nie wchodzi do wartości); brak wizyt daje pustą listę, nie błąd |
| **H02** historia pracownika | grupowanie po dniach, najnowszy pierwszy; nieobecność nie liczy się jako wykonana, a jej czas i wartość nie wchodzą do sumy; oznaczenie zastępstwa i pozycji z pakietu |
| **H03** uprawnienia i granice | specjalista nie dostaje cudzej klientki; specjalista dostaje własną historię bez cen, a podany w żądaniu inny pracownik jest ignorowany; zakres ponad 400 dni odrzucony; brak klientki to czytelny błąd; zła data zatrzymuje żądanie **przed** zapytaniem do bazy |
| **H04** brak skutków ubocznych | obie akcje wykonują wyłącznie SELECT-y (żadnego INSERT/UPDATE/DELETE) |

Pełny przebieg po zmianie: **580 prób w 26 zestawach, wszystkie przechodzą.**

### Próba na izolowanej bazie
`narzedzia/srodowisko-testowe/start-test.cmd` (MariaDB 3307, salon `demo-test`), skrypt w scratchpadzie: wywołanie obu akcji przez prawdziwy serwer i zrzuty obu zakładek plus wersji na telefon.

**To ona wyłapała błąd, którego atrapa bazy wyłapać nie mogła:** zapytanie sięgało po kolumnę `r.numer`, której w `Term_Rezerwacje` nie ma (numer wizyty jest wyliczany z identyfikatora). Atrapa zwracała to, co jej kazano, więc testy jednostkowe przechodziły. **Wniosek na przyszłość: każda nowa akcja z własnym SQL-em musi przejść przez izolowaną bazę, zanim trafi na produkcję.**

### Co nie zostało sprawdzone
Wersja dla kosmetologa jest potwierdzona **na poziomie API** (zwraca własną historię, ceny puste, podana cudza osoba zignorowana), ale bez zrzutu ekranu — przy kolejnym uruchomieniu środowiska warto go dorobić.

## 5. Zrzuty

- `hist-02-klientka.png` — historia Marty Kowalskiej, cztery wizyty, jedna odwołana z powodem
- `hist-03-pracownik.png` — historia Anny: liczby, „co robi najczęściej", dni z klientkami
- `hist-04-telefon.png` — ten sam widok na ekranie 400 px
