# „Z mojego grafiku zniknęły wizyty i nikt nie wie, kto je skasował"

Sytuacja zgłoszona 19.10.2026: Ola patrzy w niedzielę wieczorem na swoją środę — dziesięć zabiegów, więc rozmraża czynniki. We wtorek w grafiku zostają dwie wizyty i nikt nie pamięta, kto odwołał resztę.

Dane były w bazie od początku (`Term_Historia`, `Term_Sprawy`, anulowane rezerwacje). Brakowało **podania ich osobie, której to dotyczy, zanim poniesie koszt**. Stąd cztery zmiany.

---

## 1. Odwołanie wreszcie dociera do dzwonka

**Było:** sprawa E05 („Odwołano wizytę") powstawała z priorytetem `P2` i bez powiązanego czasu. Licznik przy dzwonku liczy wyłącznie `P0`/`P1` z zakładki „Do działania" — więc wykonawczyni nie dostawała o odwołaniu żadnego sygnału. Dowiadywała się, patrząc w grafik.

**Jest:** nowa reguła `priorytetZnikaniaWizyty(teraz, czas_wizyty)` w `routes/terminarz.js`:

| Do wizyty zostało | Priorytet | Dlaczego |
|---|---|---|
| ≤ 48 godzin | **P0** | trzeba zareagować dziś (dzwonić do klientki, przestawić pracę, odmrożony czynnik) |
| ≤ 7 dni | **P1** | trzeba wiedzieć, ale jest czas |
| dalej | P2 | informacja |

Ta sama reguła obowiązuje przy zmianie wykonawcy (E03) i przy przełożeniu (E02). Wizyta, która już się odbyła, zostaje P0 — odwołanie wpisane po terminie nie może zniknąć po cichu.

## 2. Zbiorcza sprawa „Czyszczenie grafiku" (E33)

Pięć osobnych powiadomień o pięciu odwołaniach to pięć razy ta sama informacja. Od **trzeciego** odwołania tego samego dnia, tej samej osobie, przez tego samego autora, w ciągu **pół godziny**, powstaje jedna sprawa zbiorcza:

> **Czyszczenie grafiku: Anna, 2026-10-21 — 5 wizyt**
> Ola odwołał(a) 5 wizyt z dnia 2026-10-21 w ciągu pół godziny: 09:00 Julia Wiśniewska, 10:00 Patrycja Adamczyk, 10:30 Dominika Lis, 12:00 Ewa Zielińska, 13:30 Karolina Mazur. Sprawdź, czy to było zamierzone.

Pojedyncze sprawy zostają (są dowodem per wizyta), ale dochodzi jeden mocny sygnał. Klucz `E33:<dzień>:<osoba>:<autor>` sprawia, że kolejne odwołania **odświeżają tę samą sprawę**, zamiast mnożyć wpisy. Typ `E33` jest poza katalogiem z aneksu (ten sięga E32) — E19 było już zajęte przez „Rozliczenie wizyty".

## 3. Pasek „co zniknęło" nad grafikiem

Nad siatką dnia pojawia się bursztynowy pasek, gdy w **najbliższych 7 dniach** są zmiany, których ta osoba jeszcze nie widziała:

> ⚠ W najbliższych 7 dniach w Twoim grafiku: **5** wizyt odwołanych · **1** seryjne czyszczenie grafiku. **[Zobacz co zniknęło]**

Przycisk otwiera dzwonek na zakładce „Zmiany w wizytach" i chowa pasek (sprawy zostają oznaczone jako przeczytane). Kosmetolog widzi wyłącznie zmiany dotyczące **jego** grafiku, recepcja i manager — całego salonu.

Akcja: `trm_zmiany_grafiku { dni }` — tylko odczyt, zakres 1–60 dni, liczony od teraz.

## 4. „Co się zmieniło?" — dziennik jednego dnia

W liczniku dnia (recepcja, manager, właściciel) jest link **Co się zmieniło?**. Otwiera panel z odpowiedzią na pytanie „kto to skasował": podsumowanie (ile odwołań, przełożeń, dodanych) i lista zdarzeń — **kto, o której, co i dlaczego**, z numerem wizyty i wykonawcą. Kliknięcie w pozycję otwiera wizytę.

Przełożone wizyty mają już nową datę, więc zapytanie szuka ich także po opisie w historii („stara data → nowa").

Akcja: `trm_zmiany_dnia { data }` — tylko odczyt, tylko role operacyjne.

### Przy okazji: zakładka „Zmiany w wizytach" pokazuje teraz zmiany

Wcześniej wpadało do niej wszystko, co miało numer wizyty — także „Brak wyniku wizyty" czy sprawy o zakupach. Teraz to `E02, E03, E05, E06, E08, E33` (przełożenie, wykonawca, odwołanie, nieobecność klientki, przerwany zabieg, czyszczenie grafiku). Nic nie znika z systemu — pozostałe sprawy są w „Do działania" i „Informacje".

---

## System prób

### Próby jednostkowe — `tests/terminarz-zmiany.test.js` (22 próby)

| Grupa | Co sprawdza |
|---|---|
| **ZM01** priorytet | progi 48 h / 7 dni włącznie z granicami co do minuty; brak czasu nie udaje pilnej sprawy; wizyta, która już minęła, zostaje P0 |
| **ZM02** pasek | rozbicie po rodzajach; przeczytane nie wracają; kosmetolog dostaje tylko swoje; zakres 1–60 dni liczony od teraz; zapytanie pyta o właściwe typy i pomija rozwiązane; zakładka „Zmiany" nie pokazuje spraw o rozliczeniach; **zero zapisów** |
| **ZM03** dziennik dnia | filtr akcji (notatka odpada); autor, godzina, numer `EST-xxxx`, wykonawcy; podsumowanie; szukanie przełożeń po opisie; pusty dzień; kosmetolog bez dostępu; zła data zatrzymana **przed** zapytaniem; **zero zapisów** |
| **ZM04** sprawa zbiorcza | kontrola źródła: próg trzech odwołań, okno 30 minut, klucz dedup, użycie nowej reguły priorytetu w E05/E03, rejestracja akcji w dyspozytorze |

Pełny przebieg po zmianie: **601 prób w 27 zestawach, wszystkie przechodzą.**

### Próba na izolowanej bazie (MariaDB 3307, salon `demo-test`)

Odtworzony scenariusz Oli: sześć wizyt u Anny w środę 21.10, potem pięć odwołań przez Olę w ciągu kilku minut.

```
odwołanie EST-0116 09:00 Julia Wiśniewska → success
odwołanie EST-0117 10:30 Dominika Lis     → success
odwołanie EST-0118 12:00 Ewa Zielińska    → success
odwołanie EST-0119 13:30 Karolina Mazur   → success

PASEK (Ola, manager):     {"nowych":6,"odwolane":5,"serie":1}
PASEK (Anna, kosmetolog): {"nowych":6,"odwolane":5,"serie":1}
  priorytety spraw Anny: E33/P0, E05/P0, E05/P0, E05/P0, E05/P0, E05/P1
  tytuł zbiorczej: Czyszczenie grafiku: Anna, 2026-10-21 — 5 wizyt
DZWONEK Anny: {"otwarte":8,"pilne":6,"nieprzeczytane":8}
PANEL DNIA:   {"wszystkich":11,"odwolan":5,"przelozen":0,"dodanych":6}
```

Ostatnia wizyta (16:30, czyli 51 godzin od „teraz") dostała **P1** zamiast P0 — próg 48 godzin działa.

**Co ta próba wyłapała, a czego atrapa bazy wyłapać nie mogła:**
1. `trm_anuluj` nie ma w swoim zakresie `cfg` — pierwsza wersja odwoływała się do `cfg.terazStr` i każde odwołanie wizyty kończyło się błędem (złapał to też zestaw ZK-03 w pełnym przebiegu). Teraz czas pobierany jest przez `teraz()`.
2. `E19` było już zajęte („Rozliczenie wizyty") — sprawa zbiorcza dostała `E33`.
3. `display:flex` w CSS wygrywał z atrybutem `hidden`, więc po kliknięciu zostawał pusty pasek.

### Zrzuty

| Plik | Co widać |
|---|---|
| `zm-01-pasek-recepcja.png` | pasek nad grafikiem u Oli + link „Co się zmieniło?" w liczniku dnia |
| `zm-02-co-sie-zmienilo.png` | panel dnia: 5 odwołań / 0 przełożeń / 6 dodanych i lista zdarzeń z autorem |
| `zm-04-pasek-kosmetolog.png` | ta sama sytuacja u Anny — „w **Twoim** grafiku", dzwonek 8 |
| `zm-05-dzwonek-zmiany.png` | zakładka „Zmiany w wizytach": zbiorcza sprawa na górze, pod nią odwołania z powodem |
| `zm-06-czyszczenie-grafiku.png` | szczegóły sprawy E33 z listą pięciu wizyt |
| `zm-07-telefon.png` | pasek i lista na ekranie 400 px |
