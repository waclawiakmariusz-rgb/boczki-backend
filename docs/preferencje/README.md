# Preferencje klientki — „jednym rzutem oka”

Prośba właściciela z 19.10.2026: recepcja ma od razu wiedzieć, że klientka pije kawę z mlekiem, woli ciepło i nie lubi rozmowy przy zabiegu — bez czytania ściany tekstu i bez wchodzenia w zakładki.

## Dlaczego osobna rzecz, a nie notatka

W systemie były już trzy miejsca na „coś o klientce” i żadne nie nadawało się do tego zadania:

| Co | Gdzie | Po co |
|---|---|---|
| **Memo** (`Memo`) | profil klientki | wolny tekst, wszystko naraz — nikt tego nie czyta w biegu |
| **Ostrzeżenie** (`Klienci.ostrzezenie`) | czerwona plakietka | problem, nie preferencja |
| **Notatka wizyty** (`Term_Rezerwacje.notatka`) | karta w terminarzu | dotyczy jednej wizyty |

Preferencje są czwartą kategorią: **krótkie, stałe, powtarzalne przy każdej wizycie** i dające się policzyć.

## Model

```
Preferencje_Slownik(tenant_id, klucz, nazwa, ikona, typ, opcje_json, dla_zabiegu, aktywna, kolejnosc)
Klienci_Preferencje(tenant_id, id_klienta, klucz, wartosc, kto, kiedy)
```

- **Słownik jest per salon.** Przy pierwszym wejściu zakłada się lista startowa (9 pozycji: napój, temperatura, rozmowa, muzyka, pora wizyty, ulubiona osoba, kontakt, dojazd, inne). Manager dopisuje własne i chowa nieużywane.
- **Jedna wartość na rodzaj i klientkę** (UNIQUE) — „kawa z mlekiem” zastępuje „herbatę”, nie dokłada się obok.
- **`dla_zabiegu`** decyduje, czy pozycję widzi osoba wykonująca zabieg. Temperatura, cisza i uwagi — tak. Napój i kanał kontaktu — nie, to sprawa recepcji.

## Uprawnienia

| Rola | Widzi | Zmienia |
|---|---|---|
| Recepcja, manager, właściciel | wszystkie preferencje | tak |
| Kosmetolog | tylko oznaczone „przy zabiegu”, przy **swoich** wizytach | nie |
| Manager, właściciel | — | dodatkowo układa listę preferencji salonu |

## Gdzie to widać

1. **Profil klientki** — chipsy pod nazwiskiem, przycisk „✎ Zmień” otwiera edytor (lista rozwijana na każdy rodzaj).
2. **Terminarz → Agenda i „Mój dzień”** — chipsy w wierszu wizyty, obok notatki.
3. **Terminarz → szczegóły wizyty** — karta „Preferencje klientki” z edycją dla recepcji.
4. **Terminarz → siatka dnia/tygodnia/zasobów** — mały znak przy karcie (najedź, żeby zobaczyć treść).

## RODO

Preferencje to komfort obsługi. **Alergie, choroby i leki nie są tu zapisywane** — ich miejsce jest w konsultacji i dokumentach klientki. Mówi o tym podpowiedź pod edytorem (w profilu i w terminarzu) oraz przewodnik.

## API (akcje dyspozytora)

| Akcja | Kto | Co robi |
|---|---|---|
| `pref_slownik` | każdy zalogowany | lista rodzajów preferencji (zakłada startową przy pierwszym wejściu) |
| `pref_klientki` | każdy zalogowany | preferencje jednej klientki (specjalista — tylko „przy zabiegu”) |
| `pref_wielu` | każdy zalogowany | preferencje wielu klientek jednym zapytaniem (cały dzień w kalendarzu) |
| `pref_zapisz` | recepcja, manager | zapis wartości; pusta wartość = skasowanie |
| `pref_slownik_zapisz` | manager, właściciel | dodanie/edycja/ukrycie pozycji słownika |

## System prób

### `tests/preferencje.test.js` (14 prób)

| Grupa | Co sprawdza |
|---|---|
| **P01** słownik | zakładanie listy startowej dokładnie raz; zawartość listy startowej i oznaczenia „przy zabiegu”; pozycja wyłączona niewidoczna dla recepcji, widoczna dla managera |
| **P02** odczyt | kolejność chipsów ze słownika, pomijanie pozycji wyłączonych; kosmetolog dostaje wyłącznie „przy zabiegu” i bez prawa edycji; cały dzień pobierany jednym zapytaniem |
| **P03** zapis | wybór z listy zapisuje się przez `ON DUPLICATE KEY`; wartość spoza listy odrzucona, pole tekstowe swobodne; pusta wartość kasuje; kosmetolog nie zapisze nic; klientka spoza kartoteki odrzucona |
| **P04** słownik salonu | manager dodaje własną pozycję; recepcja nie; lista wyboru bez opcji odrzucona; klucz oczyszczany ze znaków specjalnych |

Pełny przebieg po zmianie: **625 prób w 29 zestawach, wszystkie przechodzą.**

### Próba na izolowanej bazie (MariaDB 3307, salon `demo-test`)

```
słownik startowy: ☕Napój · 🌡️Temperatura · 💬Rozmowa · 🎵Muzyka · ⏰Pora wizyty
                  · 👤Ulubiona osoba · 📱Kontakt · 🚗Dojazd · ✏️Inne
klientka 1002 (recepcja):     ☕ Kawa z mlekiem · 🌡️ Woli ciepło · 💬 Woli ciszę · 📱 SMS | edycja: true
ta sama klientka (kosmetolog): 🌡️ Woli ciepło · 💬 Woli ciszę                        | edycja: false
chipsów w agendzie: 9 | błędy JS: brak
```

**Co ta próba wyłapała:** przerysowanie widoku po doczytaniu preferencji wołało `przywrocScroll()` spoza swojego zakresu (błąd w konsoli przy każdym odświeżeniu) i preferencje nie dociągały się w widokach Tydzień/Agenda, bo te pobierają dane inną ścieżką (`trm_zakres`). Obie rzeczy poprawione.

### Zrzuty

| Plik | Co widać |
|---|---|
| `pref-01-profil.png` | chipsy pod nazwiskiem w profilu klientki |
| `pref-02-edytor.png` | edytor preferencji (listy rozwijane na każdy rodzaj) |
| `pref-04-agenda.png` | agenda dnia: chipsy i notatka przy każdej wizycie |
| `pref-06-kosmetolog.png` | „Mój dzień” kosmetologa — tylko preferencje „przy zabiegu” |
