# Wróć do ostatniej dobrej wersji — jedna kartka (wdrożenie Terminarza 2.0, 18.10.2026)

**Ostatnia dobra wersja** = to, co pracuje u recepcji od 16.10 rano: commit `b3d774a`, tag `ostatnia-dobra-2026-10-16`.
**Gałąź powrotu** = `wroc-ostatnia-dobra-2026-10-16`: zawartość **identyczna co do bajta** z `b3d774a` (sprawdzone `git diff` = pusto), zbudowana tak, że po wdrożeniu jest zwykłym krokiem naprzód na `main` — bez `reset`, bez force-push, bez przepisywania historii.

## Poziom 1 — problem tylko z kalendarzem (1 minuta, bez restartu)

Administracja → Dodatki → **wyłącz Terminarz** dla salonu. Kalendarz znika z menu, wszystkie jego akcje odmawiają (sprawdzone), reszta Estelio pracuje jak dotąd. Zabezpieczenie PIN-ów zostaje. Rezerwacje w bazie zostają — po ponownym włączeniu wracają.

## Poziom 2 — problem z czymkolwiek innym (5 minut, te same dwa kliknięcia co przy wdrożeniu)

1. **Claude (albo Ty, w katalogu repozytorium na laptopie):**
   ```
   git checkout main && git merge --ff-only wroc-ostatnia-dobra-2026-10-16 && git push origin main
   ```
   Jeśli push zatrzyma lokalny bezpiecznik kasowania linii w `index.html` (to on, nie błąd), dopisz `--no-verify` do `git push` — powrót kasuje linie świadomie.
2. **Panel Hostingera, estelio.com.pl:** Git → **Pull from remote** → sprawdź, że pokazuje commit gałęzi powrotu.
3. **Panel Hostingera:** Node.js → **Restart application** → status Running.
4. Cache → **Purge** (LiteSpeed potrafi trzymać stary `index.html`).
5. Incognito → `estelio.com.pl/zaloguj` → zaloguj PIN-em → Klientki, Sprzedaż, dokument klientki.

Co się dzieje po powrocie:
- kod = dokładnie dzisiejsza produkcja; Terminarz w starym wyglądzie; stary endpoint użytkowników wraca (PIN-ów i tak nie zmieniałeś, więc to stan dzisiejszy, nie nowa ekspozycja);
- **baza nietknięta** — wizyty zapisane nowym kodem stary kod czyta i edytuje (przećwiczone na izolowanej bazie); nowe tabele zakupów stary kod ignoruje;
- **dokumenty nietknięte** — pliki leżą na dysku w `UPLOADS_DIR`, wydanie ich nie rusza;
- sesje: po restarcie wczytywane z tabeli, więc zalogowani zwykle zostają zalogowani; w najgorszym razie jedno przelogowanie.

Czego **nie** robić: nie przywracać bazy z kopii z 17.10 bez analizy (od kopii mogły powstać prawdziwe sprzedaże i wizyty); nie klikać Pull wielokrotnie „na wszelki wypadek”.

## Powrót do nowej wersji po naprawie

`git checkout main && git merge --ff-only dev && git push origin main` → Pull → Restart → Purge. (Albo: naprawa na dev, pełne testy, ten sam krok.)

## Sprawdzenie, która wersja faktycznie działa

Strona `estelio.com.pl/zaloguj` ma w kodzie datę startu i hash, np. `18.10.2026, 19:05 · 7df0c8f`. Produkcja na starym kodzie pokazuje `b3d774a`; po powrocie gałęzią `wroc-…` pokaże hash tej gałęzi (`git log -1 wroc-ostatnia-dobra-2026-10-16`).
