# Estelio — Zadania na Pulpicie: brief do makiet „lekki nowy”

Data: 26.10.2026. Autor briefu: Claude Code (na podstawie kodu Estelio, danych produkcyjnych salonu-matki i zgłoszenia recepcji #15). Adresat: ChatGPT — przygotowanie makiet i instrukcji wdrożeniowej zgodnie z `ESTELIO_STANDARD_REDESIGNU.md` (ten sam standard co pakiety Rabaty/Sugestie/Zadatki).

## 0. Czego oczekujemy

Paczka `Estelio_Zadania_Lekki_Nowy_RRRR-MM-DD.zip` zawierająca:
1. **Makiety** (PNG, 1536×1024, bez menu/logo/przeglądarki): (a) widget Zadań na Pulpicie — widok domyślny; (b) ten sam widget z włączonym filtrem „Telefony” i rozwiniętym zadaniem-telefonem; (c) formularz nowego zadania; (d) wariant telefonu (400 px szer.) widgetu; opcjonalnie (e) stan pusty i (f) tryb ciemny.
2. **Instrukcję MD dla Claude Code**: układ, typografia, kolory, odstępy, zachowania, stany, kryteria odbioru.
3. `START.md` i `PROMPT_MAKIETY.txt`.

**Nie zamawiamy kodu.** Kod powstanie po stronie Estelio na podstawie instrukcji. Nie zmieniamy pozostałych kafli Pulpitu, menu, modułu Leady ani procesów.

## 1. Kontekst biznesowy

Estelio to system dla salonów beauty. **Zadania** to lista rzeczy do zrobienia dla recepcji i managera (telefony do klientek i leadów, drobne prace, sprawy magazynowe). Widget Zadań stoi na Pulpicie — pierwszym ekranie po zalogowaniu; osobny moduł „Zadania” w menu ma pełną tabelę.

Zgłoszenie recepcji (#15, pilność wysoka, cytat): *„Jest za dużo zakładek z zadaniami na pulpicie i może to wprowadzać w błąd lub zwiększać ryzyko przeoczenia czegoś, najlepiej zrobić z tego po prostu dwie kategorie — «telefony do zadzwonienia» oraz «inne»”.*

Decyzja właściciela: **nie kasujemy funkcjonalności** (kategorie zostają — są potrzebne managerowi i przyszłym automatom), tylko projektujemy lepszy model prezentacji i dodajemy pojęcie „telefon”.

## 2. Stan obecny — fakty z kodu i danych (nie zgadywać)

Zrzut: `zrodla/01-pulpit-zadania-obecnie-ciemny.png` (tryb ciemny, salon Boczki, 24.10.2026). Jest wyłącznie kontekstem.

- Nagłówek widgetu: „Masz 29 aktywnych zadań” + podtytuł „Wszystko pod kontrolą”, ikona-cel po lewej, po prawej ikona zwijania; obok wyszukiwarka zadań.
- **7 zakładek z licznikami:** Klient (3) · Magazyn (0) · Kosmetyk (2) · Sprzedaż (11) · Inne (23) · Moje (4) · Cykliczne (1). Pięć pierwszych to **kategorie** (`ENUM: MAGAZYN, KOSMETYK, KLIENT, SPRZEDAZ, INNE`), „Moje” = zadania **utworzone** przez zalogowaną osobę (nie „przypisane do mnie”), „Cykliczne” = szablony zadań powtarzalnych.
- Widget otwiera się na zakładce z **największym licznikiem** — pozostałe kategorie są schowane.
- Zadanie może mieć **kilka kategorii** naraz (osobna tabela), więc liczniki się dublują: 29 zadań → suma badge’y 43.
- Lista jest grupowana czasem: „❗ Do pilnego działania” (po terminie) · „🕘 Na dziś” · „📅 Zaplanowane” · „🗒 Bez terminu”; po 4 pozycje na grupę ze stronicowaniem.
- Wiersz zadania: kropka statusu/priorytetu, tytuł, znaczniki kategorii, termin (czerwony „po terminie!”), licznik komentarzy; akcje: **„✓ Zrobione”** i menu „⋮” (edycja/archiwizacja wg uprawnień — recepcja tylko dla własnych zadań).
- Formularz zadania (modal) ma dziś pola: tytuł, opis, priorytet (Normalny/Ważny/Pilny), termin (data+godzina), kategorie (wiele, dodawane z listy rozwijanej jako „badge”), przypisane osoby (wiele), powiązane klientki (wyszukiwarka po nazwisku/telefonie/ID), powiązane produkty magazynu, powtarzanie (cykliczne: co ile, dzień), komentarze.
- Dane salonu-matki (jedyny salon używający zadań, 99 zadań, 32 aktywne): **25 z 32 aktywnych jest w „Inne”**; w tytułach dominują telefony: „lead 261”, „LEAD 109”, „zadzwonić do Pani …”, „… — zadzwonić pod koniec października”; leady wpisywane ręcznie, raz do „Sprzedaż”, raz do „Inne”. Powiązań z produktami magazynu: 0.
- Estelio ma osobny moduł **Leady** (import z arkusza, pola: telefon, e-mail, kampania, status: nowy/kontakt/umówiony/klient/odrzucony) — dziś **nie tworzy** zadań; recepcja przepisuje leady do zadań ręcznie.

## 3. Diagnoza (dlaczego recepcja gubi zadania)

1. Zakładki **dzielą** listę zamiast ją filtrować — nie ma widoku „wszystko na dziś”.
2. Kategorie to „temat”, a recepcja myśli **czynnością** („zadzwonić” vs „zrobić”) i **czasem**.
3. Wielokategoria dubluje liczby — badge’e nic nie mówią.
4. „Moje” znaczy „utworzone przeze mnie” — sprzeczne z intuicją.
5. Telefon jest zwykłym tekstem — bez numeru, bez „zadzwoń”, bez powiązania z leadem.

## 4. Docelowy model (do zaprojektowania)

Trzy niezależne osie zamiast jednej:

| Oś | Wartości | Rola w UI |
|---|---|---|
| **Rodzaj czynności** (nowe) | 📞 Telefon · ✅ Do zrobienia | główny przełącznik nad listą: **Wszystkie · Telefony · Do zrobienia**; telefon pokazuje numer i ma akcje „Zadzwoń”, „Oddzwonić później”, „Zapisz wynik rozmowy” |
| **Obszar** (dzisiejsze kategorie) | Klient · Magazyn · Kosmetyk · Sprzedaż · Inne | **jeden** znacznik na zadaniu (kolorowy chip), filtr w rozwijanej liście „Obszar”, nie zakładki; raporty managera |
| **Czas** (bez zmian) | Po terminie · Na dziś · Zaplanowane · Bez terminu | grupowanie listy — pozostaje |

Dodatkowo: przełącznik **„Tylko moje”** = przypisane do mnie (poprawione znaczenie); „Cykliczne” przenosimy z zakładki do małego linku/ikony w nagłówku („Szablony cykliczne (1)”) albo do menu „⋮” widgetu — do zaprojektowania.

**Domyślny widok: Wszystkie**, nic nie jest schowane. Liczniki sumują się do liczby zadań.

### 4.1 Widget na Pulpicie — zawartość makiety (a)

- Nagłówek: „Masz 29 aktywnych zadań” + podsumowanie w jednym zdaniu: „14 telefonów · 5 po terminie · 4 na dziś” (muted). Po prawej: wyszukiwarka, link „Szablony cykliczne (1)”, przycisk „+ Nowe zadanie” (burgund), ikona zwijania.
- Pasek przełączników (segmenty, jeden wybór): **Wszystkie 29 · 📞 Telefony 14 · ✅ Do zrobienia 15**. Obok: pigułka „Tylko moje” (toggle) i rozwijany filtr „Obszar: wszystkie ▾” (Klient/Magazyn/Kosmetyk/Sprzedaż/Inne).
- Lista grupowana czasem (etykiety jak dziś, bez emoji w nowym stylu — ikony liniowe).
- Wiersz **telefonu**: ikona słuchawki w kółku, tytuł („Zadzwonić do Pani M. Opalińskiej — potwierdzić termin”), pod tytułem: numer telefonu jako przycisk „📞 512 … 889” (na desktopie kopiuje/`tel:`), chip obszaru („Klient”), termin, licznik komentarzy. Akcje po prawej: „Zrobione” (główna), „Oddzwonić później ▾” (dziś +2 h / jutro 10:00 / wybierz), „⋮”.
- Wiersz **do zrobienia**: ikona „check” w kółku, tytuł („Rolka do nagrania po dzisiejszym zabiegu”), chip obszaru („Inne”), termin; akcje: „Zrobione”, „⋮”.
- Zadanie z leada: dodatkowy mały znacznik „Lead · kampania Jesień” i numer.

### 4.2 Makieta (b): filtr „Telefony” + rozwinięty telefon

Ten sam widget z aktywnym segmentem „Telefony 14”; jedno zadanie rozwinięte: notatka („Pytała o cenę lipolizy, oddzwonić po 16”), ostatni komentarz, panel „Wynik rozmowy”: trzy przyciski — „Umówiona” · „Nie odebrała” · „Nie zainteresowana” + pole notatki + „Zapisz i zamknij”. Dla zadania z leada: wynik rozmowy aktualizuje status leada (informacja na makiecie jako podpis, nie nowy ekran).

### 4.3 Makieta (c): formularz nowego zadania

Kolejność pól (od góry): **Rodzaj** — dwa kafle „📞 Telefon” / „✅ Do zrobienia” (jeden wybór, jak kafle zaokrąglenia w pakiecie Zadatki) → Tytuł → (dla telefonu) Klientka/lead: wyszukiwarka + numer telefonu (automatycznie z karty, edytowalny) → Termin (data + godzina; szybkie: „Dziś 16:00”, „Jutro 10:00”, „Za tydzień”) → Obszar (jeden chip z pięciu, domyślnie „Klient” dla telefonu, „Inne” dla reszty) → Przypisz do (osoby) → Priorytet → Opis/notatka → sekcja zwijana „Więcej”: powtarzanie cykliczne, powiązane produkty magazynu. Stopka: „Anuluj” + „Zapisz zadanie”.

### 4.4 Makieta (d): telefon 400 px

Segmenty w jednym rzędzie (skrót: „Wszystkie · Telefony · Zrobić”), filtr obszaru schowany pod ikoną, wiersze w układzie pionowym, akcja „Zrobione” pełnej szerokości lub jako swipe (do zaproponowania), numer telefonu jako duży przycisk „Zadzwoń”.

## 5. Zasady projektowe („lekki nowy”)

- Paleta: tło #FAF8F5, karty białe, obramowania #E7E1DE (pola #D9D4D8), burgund #842D49 (hover #70243D), róż #F8EDF1, tekst #242126, muted #67616B, błąd #A52540. Kolory obszarów: pięć stonowanych pastelowych chipów (do zaproponowania), czerwień tylko dla „po terminie”.
- Karty 18 px radius, cień 0 4px 18px rgba(45,30,35,.04), bez gradientów i emoji (ikony liniowe 18–20 px), bez żółtych/zielonych wypełnień.
- Typografia: tytuł widgetu 20/28 semibold, etykiety 14/20 medium bez uppercase, hint 13/19, wiersz zadania 15/22.
- Min. wysokość kontrolek 44 px, fokus 2 px burgund.
- Tryb ciemny: podać tokeny (jak w pakiecie Zadatki).
- Stany: pusty („Brak aktywnych zadań” + „+ Nowe zadanie”), ładowanie, błąd pobrania, zadanie po terminie, zadanie zrobione (znika z animacją / zostaje przekreślone 3 s — do decyzji projektanta).
- Dostępność: segmenty jako radio, przyciski z etykietami, kontrast ≥ 4,5:1, klawiatura.

## 6. Ograniczenia i to, czego NIE projektować

- Nie usuwać kategorii/obszarów, komentarzy, powiązań z klientką/produktem, zadań cyklicznych, przypisań — mają zostać dostępne (mogą być schowane głębiej).
- Nie projektować modułu Leady ani karty klientki — tylko znacznik/odnośnik na zadaniu.
- Nie dodawać nowych pojęć poza „rodzaj czynności” i „wynik rozmowy”.
- Nie zakładać, że numer telefonu zawsze istnieje — pokazać stan „brak numeru — dodaj”.
- „Moje” = przypisane do mnie; pokazać, co widzi osoba bez przypisanych zadań.
- Dane na makietach fikcyjne (nazwiska, numery) — nie używać prawdziwych z zrzutu.

## 7. Kryteria odbioru makiet

1. Z makiety (a) da się odczytać w 5 s: ile zadań, ile telefonów, co jest po terminie.
2. Żadne zadanie nie jest schowane w widoku domyślnym.
3. Telefon ma numer i akcję w zasięgu jednego kliknięcia.
4. Formularz ma ≤ 6 pól widocznych bez rozwijania „Więcej”.
5. Wersja 400 px nie wymaga poziomego przewijania.
6. Instrukcja MD mapuje każdy element makiety na istniejące pola/funkcje z rozdz. 2 i nazywa jawnie to, co jest nowe (rodzaj, wynik rozmowy, zadanie z leada).

## 8. Pytania otwarte (do odpowiedzi w instrukcji lub pozostawienia właścicielowi)

- Czy „Cykliczne” jako link w nagłówku wystarczy, czy potrzebna osobna zakładka w module Zadania?
- Czy wynik rozmowy ma 3 stałe opcje, czy listę konfigurowalną?
- Czy telefon „Nie odebrała” ma automatycznie proponować „Oddzwonić jutro”?
