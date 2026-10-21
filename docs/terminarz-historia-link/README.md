# Historia wizyt klientki — wejście jednym kliknięciem

Prośba właściciela z 21.10.2026: *„po kliknięciu w dowolną wizytę pojawiają się szczegóły wizyty,
dodaj jeszcze link Historia do historii wizyt tego klienta (jest już taka funkcja, tyle że
z koniecznością wyszukania). W tej historii jakoś trzeba jasno pokazać, jakie zabiegi są zaplanowane,
a jakie już się odbyły, np. z szarym tłem te odbyte. Pokazuj w sortowaniu od najnowszych do najstarszych."*

## Co się zmieniło

**1. Link w szczegółach wizyty.** Obok „Profil klientki ↗" pojawił się **„Historia wizyt ↗"** —
otwiera historię od razu dla tej klientki, bez wpisywania nazwiska. Zakres ustawia się sam:
300 dni wstecz i 90 dni w przód.

**2. Zakres sięga w przód.** Dotąd historia kończyła się „dzisiaj", więc wizyty **zaplanowane**
w ogóle się nie pokazywały — a to one są najczęstszym powodem zaglądania do historii („kiedy ma
następną?"). Teraz domyślny zakres i przyciski skrótów („30 dni", „3 miesiące", „rok") obejmują
także nadchodzące terminy. Limit serwera to 400 dni i zakres mieści się w nim z zapasem.

**3. Odbyte kontra zaplanowane widać na pierwszy rzut oka.**
- wizyta **odbyta** — szare tło i przygaszona data (rzecz zamknięta),
- wizyta **zaplanowana** — jasne tło i akcentowana krawędź (rzecz przed nami),
- odwołana i nieobecność zachowują swoje kolory krawędzi.

Kolor nie jest jedynym nośnikiem: każda wizyta ma **plakietkę słowną** („Odbyła się",
„Zaplanowana", „Odwołana", „Nieobecność"), a nad listą stoi legenda.

**4. Kolejność od najnowszych.** Serwer oddaje dane malejąco po dacie, a widok dodatkowo sortuje
u siebie — kolejność jest częścią umowy z użytkownikiem, więc pilnujemy jej w miejscu wyświetlania.

## Próba (izolowane środowisko)

```
przyciski w panelu wizyty: Historia wizyt ↗ | Profil klientki ↗ | Zmień
widok po kliknięciu:       historia
wybrana klientka:          Julia Wiśniewska (ID 1002)
zakres dat:                2025-12-26 … 2027-01-20
wizyt w historii:          3
   So 24.10   planowana  → Zaplanowana
   Cz 22.10   wykonana   → Odbyła się
   Śr 21.10   odwolana   → Odwołana
kolejność: ["So 24.10","Cz 22.10","Śr 21.10"]      (najnowsze na górze)
BLEDY JS: brak
```

Po drodze wyszły dwie rzeczy, obie złapane próbą, nie przez użytkownika:
- nazwisko przekazywane w atrybucie `onclick` rozbijało wywołanie (cudzysłów w HTML) — dane
  pobierane są teraz z otwartej wizyty, więc apostrof w nazwisku („O'Brien") też nie zaszkodzi,
- pierwszy zakres (365 + 180 dni) przekraczał limit 400 dni i serwer odrzucał zapytanie —
  historia była pusta mimo poprawnego wejścia.

| Plik | Co widać |
|---|---|
| `panel-z-linkiem.png` | szczegóły wizyty z linkiem „Historia wizyt ↗" |
| `historia-klientki.png` | historia: zaplanowana na górze, odbyta na szarym tle, legenda |
| `historia-ciemny.png` | to samo w trybie ciemnym |
