# Ticket #24 — daty ważności na liście produktów detalicznych

**Zgłaszająca:** Ola (Manager, Boczki), 4.11.2026, z telefonu. **Ekran:** Kosmetyki → Stan Magazynowy.
**Zamyka też ticket #13** (Gosia, 24.10.2026) — to ten sam ekran i ta sama przyczyna.

## Co było nie tak

Data w nagłówku produktu brała się z **najstarszej dostawy, także już wyprzedanej**. Produkt z ważnym towarem na półce wyglądał na przeterminowany.

Przykład ze zgłoszenia, Apis Dermasoft (zrzut `przed-zrzut-oli-dostawy.png`):

| dostawa | stan | ważność |
|---|---|---|
| przyjęta 2.02.2026 | 0 | 3.02.2026 ← ta data trafiała do nagłówka |
| przyjęta 30.12.2025 | 0 | 29.05.2027 |
| przyjęta 27.01.2026 | 1 szt. | 29.05.2027 |
| przyjęta 21.04.2026 | 10 szt. | 20.01.2028 |

Nagłówek pokazywał **3.02.2026 na czerwono**, choć jedenaście sztuk na półce było ważne do maja 2027 i stycznia 2028.

Winne było jedno miejsce w `public/index.html`: pętla grupująca dostawy liczyła najbliższą ważność bez patrzenia na stan. Wszystko dalej (kolor, sortowanie, chipy statusu, podtytuł) czytało tę jedną wartość.

**Reszta systemu liczyła już poprawnie:** sprzedaż pobiera towar tylko z partii ze stanem dodatnim (`routes/sprzedaz.js`), tak samo ekran „Co zamówić?”. Niespójny był wyłącznie Stan Magazynowy.

**Skala na danych Boczków (11.11.2026):** 133 z 398 partii ma stan zero; 50 produktów miało datę z pustej dostawy, 37 zły kolor, a **11 produktów było fałszywie oznaczonych jako przeterminowane**.

## Co zmieniono

1. **Data produktu liczona wyłącznie z dostaw, które mają towar.** Apis pokazuje teraz 29.05.2027 na zielono.
2. **Produkt wyprzedany w całości** ma w kolumnie Ważność napis **„brak na stanie”** zamiast daty towaru, którego nie ma. Wiersz zostaje widoczny — Ola prosiła o to wprost, a wcześniej Ania w tickecie #4.
3. **Nowy chip „Po terminie”** dla produktów, które mają towar po terminie. Ma pierwszeństwo przed „Mniej”, bo przeterminowany towar na półce jest pilniejszy niż niski stan. Wcześniej takie produkty chowały się pod „Mniej” — to było zgłoszenie #13.
4. **Podtytuł mówi, ile dostaw naprawdę leży na półce:** „4 dostawy (2 na stanie) — ważność: 29.05.2027 – 20.01.2028”.
5. **Gwiazdka „sprzedawana pierwsza”** przeniesiona na najstarszą dostawę **z towarem**, bo właśnie z niej pobiera sprzedaż. Wyprzedane dostawy są opisane jako „(wyprzedana)” i nie straszą już czerwienią.
6. **Sortowanie po ważności** odkłada produkty bez towaru na koniec listy, zamiast stawiać je na początku.

### Przy okazji: chipy w ogóle nie działały

Próba ekranowa wykryła starszy błąd, niezwiązany ze zgłoszeniem: **kliknięcie dowolnego chipa czyściło całą listę**. Przełącznik renderował z lokalnej zmiennej `daneCache`, która jest pustą tablicą od deklaracji — dane magazynu żyją w `window.daneCache`. Naprawione jedną linią, tym samym zapasem, którego używa reszta kodu. Bez tego nowy chip „Po terminie” byłby martwy.

## Czego NIE zmieniono

- Partie i produkty ze stanem zero **nadal są widoczne**. Zmieniło się wyłącznie liczenie daty.
- Baza, API i sposób pobierania towaru przy sprzedaży pozostały nietknięte. Wycofanie zmiany to cofnięcie kodu.
- Tabela na telefonie nadal jest szersza niż ekran i przewija się w poziomie (widać to na `po-04-telefon.png`). To osobna sprawa, nie ruszana przy tym zgłoszeniu.

## Sprawdzenie

| co | wynik |
|---|---|
| testy jednostkowe | 78 zestawów, **1259** testów zielonych (22 nowe w `tests/ticket-24-waznosc-magazynu.test.js`) |
| próba ekranowa na bazie izolowanej | **12 sprawdzeń, wszystkie zielone**, 0 błędów JS, zasiew posprzątany |

Testy uruchamiają prawdziwy kod wycięty z `index.html` na danych odwzorowujących zgłoszenie, a nie porównują sam tekst pliku. Scenariusz próby: `narzedzia/proby/ticket-24-waznosc.json`, zasiew `narzedzia/proby/skrypty/ticket-24-zasiew.js`.

## Zrzuty

| plik | co pokazuje |
|---|---|
| `przed-zrzut-oli-dostawy.png` | stan sprzed naprawy, załącznik ze zgłoszenia Oli |
| `po-01-lista.png` | lista po naprawie: Apis z datą 29.05.2027, produkt wyprzedany z „brak na stanie” |
| `po-02-dostawy-apis.png` | rozwinięte dostawy: dwie opisane jako wyprzedane, gwiazdka przy dostawie z towarem |
| `po-03-chip-po-terminie.png` | nowy chip w działaniu: zostaje tylko towar po terminie |
| `po-04-telefon.png` | widok na szerokości telefonu |

## Co powiedzieć Oli (treść do wysłania przez właściciela)

> Dzień dobry, już poprawione. Data przy produkcie liczy się teraz wyłącznie z dostaw, które faktycznie leżą w gabinecie, więc Apis Dermasoft pokazuje 29.05.2027 zamiast daty wyprzedanej dostawy. Przy produkcie widać też, ile dostaw jest na stanie, a gwiazdka „sprzedawana pierwsza” stoi przy tej, z której naprawdę schodzi towar.
>
> Produkty, które zeszły do zera, zostają na liście, żeby było wiadomo, co domówić. Zamiast daty mają napis „brak na stanie”.
>
> Doszedł też filtr „Po terminie”. Wcześniej produkty z przeterminowanym towarem chowały się pod „Mniej”, więc trudno je było wyłapać.
