# Pomoc i dokumenty w panelu admina

Prośba z 19.10.2026: *„zrób też w adminie coś jak dokumenty, gdzie będą wszystkie pomoce oraz np. taki plik: Estelio — Przewodnik wprowadzania nowego klienta"*.

Dotąd każdy przewodnik żył pod własnym adresem i trzeba było je pamiętać — a przewodnik wdrożeniowy w ogóle leżał na pulpicie, dostępny tylko z jednego komputera i tylko przez `file:///`.

## Co powstało

**Nowa zakładka „📚 Pomoc i dokumenty"** (panel admina → Wsparcie) z czterema grupami:

1. **Wdrożenie nowego klienta** — przewodnik wdrożeniowy plus 12 skrótów prosto do sekcji (Mapa procesu, Zanim zaprosisz, Klient kupuje sam, Kreator rejestracji, Ty zakładasz, 14 dni za darmo, Vouchery, Zgłoszenia i statusy, Rozliczenia, Cykl subskrypcji, Problemy, Test ścieżki).
2. **Dla salonu — można wysyłać klientom**: `/pomoc/`, `/pomoc-manager/`, `/pomoc-terminarz/`, Klub dla recepcji.
3. **Dla nas — praca w Estelio**: wdrożenie klienta, przewodnik administratora, dokumentacja prawna, opis zabezpieczeń.
4. **Dokumenty prawne i szablony**: regulamin, polityka prywatności, cookies, umowa powierzenia (DPA), klauzula RODO dla klientek, procedura RODO i incydenty.

Każda pozycja ma tytuł, adres i jedno zdanie o tym, do czego służy — żeby nie trzeba było zgadywać po nazwie pliku.

**Przewodnik wdrożeniowy trafił do systemu**: `public/przewodnik-wdrozenie-klienta.html`, dostępny pod ładnym adresem **`/przewodnik-klienta`** (działają kotwice, np. `/przewodnik-klienta#sciezka-a`). Plik nie ciągnie żadnych skryptów z zewnątrz — tylko czcionki Google, które polityka bezpieczeństwa (CSP) już dopuszcza.

## Jak sprawdzone

Panel otwarty w headless Chrome, zalogowany hasłem ze środowiska testowego:

```
pozycji na liście: 14
skrótów do sekcji przewodnika: 12
200  /przewodnik-klienta      200  /pomoc/            200  /pomoc-manager/
200  /pomoc-terminarz/        200  /klub_pomoc.html   200  /admin-guide.html
200  /dokumentacja.html       200  /regulamin.html    200  /polityka-prywatnosci.html
200  /polityka-cookies.html   200  /umowa-powierzenia.html
200  /klauzula-rodo-dla-salonu.html  200  /procedura-rodo.html
200  /dokument-zabezpieczen-dla-prawnika_2026-06-08.html
błędy JS: brak
```

Każdy adres z listy odpowiada — żaden link nie prowadzi w pustkę. Dodatkowo otwarte `/przewodnik-klienta#sciezka-a` ląduje dokładnie na sekcji „Ścieżka A: klient kupuje sam".

## Uwaga o dostępie

Pliki leżą w `public/`, czyli są dostępne pod swoim adresem dla każdego, kto go zna — tak jak dotąd `admin-guide.html`. Przewodnik wdrożeniowy nie zawiera haseł ani danych klientów, ale opisuje nasz proces sprzedaży. Jeśli ma być dostępny tylko po zalogowaniu do panelu, trzeba go przenieść za strażnika sesji admina — to osobna decyzja.

## Zrzuty

| Plik | Co widać |
|---|---|
| `zakladka-pomoc.png` | zakładka w panelu: skróty do sekcji przewodnika i grupa „Dla salonu" |
| `zakladka-pomoc-dokumenty.png` | grupy „Dla nas" i „Dokumenty prawne i szablony" |
| `przewodnik-sciezka-a.png` | `/przewodnik-klienta#sciezka-a` — wejście prosto w sekcję |
