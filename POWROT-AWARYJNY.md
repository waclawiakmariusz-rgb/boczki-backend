# POWRÓT AWARYJNY — jak w minutę cofnąć produkcję do działającej wersji

Ten plik jest w repozytorium, więc masz go na **każdym** laptopie i na serwerze.
Nie trzeba niczego pamiętać — wystarczy skopiować komendy stąd.

---

## 1. NAJSZYBSZY POWRÓT (gdy produkcja się psuje)

Na komputerze, w katalogu projektu:

```bash
git fetch origin
git checkout main
git revert --no-edit ostatnia-dobra..main
git push origin main
```

Potem w panelu Hostingera: **Wdrożenia → Ponowne wdrożenie**.

To cofa wszystko, co weszło po ostatniej potwierdzonej dobrej wersji.
**Nie kasuje historii** — dopisuje commit odwracający zmiany, więc nic nie ginie
i nie trzeba `--force`. Jeśli później okaże się, że to był fałszywy alarm,
odwracasz z powrotem: `git revert --no-edit <hash tego reverta>`.

Jeśli komenda zgłosi konflikt — patrz punkt 5.

---

## 2. Zasada, dzięki której to działa: tag `ostatnia-dobra`

`ostatnia-dobra` to **ruchomy znacznik ostatniej wersji, o której WIESZ, że działa
na produkcji**. Nie „ostatniej wdrożonej" — ostatniej *sprawdzonej oczami*.

**Po każdym wdrożeniu, gdy sprawdzisz w systemie, że jest OK**, przestaw go:

```bash
git tag -f ostatnia-dobra main
git push -f origin ostatnia-dobra
```

To jedyne miejsce, gdzie używamy `-f`, i jest bezpieczne: przesuwa tylko etykietę,
nie rusza kodu ani historii.

Kiedy przestawiać: **dopiero po realnym sprawdzeniu**, nie od razu po deployu.
Wdrożone ≠ działające — dokładnie tak powstał incydent z 3–10 sierpnia (patrz punkt 6).

Dodatkowo, przed każdą większą zmianą warto zostawić tag datowany, np.:

```bash
git tag pre-<co-robisz>-$(date +%F) main
git push origin pre-<co-robisz>-$(date +%F)
```

Istniejące punkty powrotu: `git tag` (m.in. `pre-fix-regres-sync-2026-08-10`
— stan produkcji sprzed naprawy Klubu z 10.08.2026).

---

## 3. Powrót do KONKRETNEJ starej wersji (nie do `ostatnia-dobra`)

```bash
git fetch origin
git log --oneline -20 main          # znajdź hash wersji, która działała
git checkout main
git revert --no-edit <hash>..main
git push origin main
```

Cofnięcie **tylko jednego** felernego commita, bez ruszania późniejszych:

```bash
git revert --no-edit <hash-felernego>
git push origin main
```

---

## 4. NAJPIERW SPRAWDŹ, CO NAPRAWDĘ STOI NA PRODUKCJI

Zanim zaczniesz cokolwiek naprawiać — upewnij się, czy problem jest w kodzie,
czy po prostu serwer ma inną wersję niż Ty. To rozstrzygnęło sprawę 10.08.2026:

```bash
curl -sL -o /tmp/prod.html https://estelio.com.pl/zaloguj
grep -c "klubadm_dataGodz" /tmp/prod.html      # 0 = produkcja NIE ma tej zmiany
```

Zamiast `klubadm_dataGodz` wstaw dowolny charakterystyczny fragment swojej zmiany
(nazwa funkcji, tekst przycisku, `id` diva). **0 trafień = na produkcji tego nie ma.**

Porównanie rozmiaru pliku też dużo mówi:

```bash
curl -sL https://estelio.com.pl/zaloguj | wc -c
wc -c < public/index.html
```

Uwaga: `https://estelio.com.pl/` przekierowuje na `zamow.html` (landing),
a `/index.html` na `/zaloguj`. Panel pobierasz **z `/zaloguj`**.

---

## 5. „Moja zmiana zniknęła" — cichy revert po pracy na dwóch laptopach

Najgroźniejszy scenariusz, bo **nic nie krzyczy**: gdy pliki kopiuje się między
komputerami zamiast robić `git pull`, git widzi zwykły commit, a nie konflikt.
Starsza wersja pliku po prostu nadpisuje nowszą i wchodzi na produkcję.

Diagnoza — trzy komendy:

```bash
git fetch origin
git log --oneline main..origin/main          # czy ktoś (drugi laptop) wyprzedził
git show --numstat <hash>                    # ile linii DODAJE, a ile USUWA
```

**Sygnał alarmowy:** commit, który z `public/index.html` albo `routes/*.js`
**usuwa dużo linii, a dodaje mało** — a w opisie ma „sync", „kopia", „z laptopa".
To nie jest zmiana, to cofnięcie cudzej pracy.

Sprawdzenie, co dokładnie przepadło:

```bash
git diff <dobry-hash> <podejrzany-hash> -- public/index.html | grep "^-" | head -40
```

Naprawa punktowa (gdy felerny commit wniósł też coś potrzebnego — jak `eba4e8c`,
który obok regresu dodał `scripts/*.js`): zamiast rewertować całość, przywróć
same popsute pliki:

```bash
git checkout <dobry-hash> -- public/index.html routes/lojalnosc.js server.js tests/lojalnosc.test.js
```

Potem **koniecznie** sprawdź, że nic nie zginęło (patrz punkt 7).

**Profilaktyka:** `git pull` przed pracą, `git push` po. Nigdy nie kopiuj plików
projektu między laptopami — od tego jest git. `public/index.html` (~34 tys. linii
z polskimi znakami) nigdy nie edytuj równolegle na dwóch maszynach.

---

## 6. Co się stało 3–10 sierpnia 2026 (przykład na żywo)

- **3.08, godz. ~17:46–20:00** — trzy commity Klubu: godziny przy zgłoszeniach
  (`4ce56f7`), pasek Klubu na Pulpicie (`9a4bb15`), poprawione nazewnictwo (`5b8a318`).
- **3.08, godz. 20:34** — commit `eba4e8c` „Sync z HP" prosto na `main`.
  Nadpisał 4 pliki starszymi wersjami z drugiego laptopa:
  `index.html` (−54 linie), `routes/lojalnosc.js` (−36), `server.js` (−1),
  `tests/lojalnosc.test.js` (−43). **Wszystkie trzy commity powyżej przepadły.**
- **4.08, godz. 09:39** — deploy wdrożył regres na produkcję. Bez żadnego błędu.
- **10.08** — zgłoszenie: „miały być godziny, a są same daty".
  Diagnoza: `curl` + `grep` (punkt 4) → produkcja nie ma `klubadm_dataGodz`;
  `git fetch` → `origin/main` wyprzedza lokalne o jeden commit-regres.
- Naprawa: przywrócenie 4 plików ze stanu `5b8a318` (commit `23d2caa`),
  z zachowaniem `scripts/*.js` i `.gitignore` z `eba4e8c`.

**Najdotkliwszy skutek:** przez tydzień recepcja nie miała na Pulpicie paska
z informacją, że w Klubie coś czeka na obsługę — klientki mogły czekać na
aktywację, o której nikt nie wiedział.

**Lekcja:** deploy „Zakończone" na zielono mówi tylko, że wdrożył *jakiś* kod.
Nie mówi, że ten kod ma Twoje zmiany.

---

## 7. Checklist przed każdym pushem na `main`

```bash
node --check server.js
node --check routes/<zmieniony-plik>.js
npx jest --runInBand --forceExit          # bez --forceExit potrafi wisieć
```

Po zmianach w `public/index.html` dodatkowo:

```bash
node -e "const s=require('fs').readFileSync('public/index.html','utf8'); \
console.log('BOM:', s.charCodeAt(0)===0xFEFF, '| krzaki U+FFFD:', (s.match(/�/g)||[]).length)"
```

Musi być `BOM: false` i `krzaki: 0` — inaczej polskie znaki są rozwalone.

Znane, **zastane** błędy testów: 14 sztuk w `magazyn`, `voucher`, `dokumenty`
(stan na 10.08.2026, wynik 331/345). Jeśli widzisz dokładnie te 14 — jest OK.
Każdy inny czerwony test = STOP, nie pushuj.

Nigdy nie wstawiaj literalnego `</script>` wewnątrz template literal w JS —
parser HTML utnie skrypt i cała aplikacja przestanie się ładować (awaria 15.05.2026).
Zawsze `<\/script>`.

---

## 8. Kolejność wdrożenia

```bash
git checkout dev && git push origin dev        # najpierw dev
git checkout main && git merge dev --ff-only   # tylko ff-only, nigdy cherry-pick
git push origin main
```

Potem panel Hostingera → **Ponowne wdrożenie** → sprawdź w systemie, że działa
→ dopiero wtedy przestaw `ostatnia-dobra` (punkt 2).

Baza danych: kopia jest potrzebna **tylko** gdy zmiana rusza schemat lub dane
(`CREATE TABLE`, `ALTER`, `INSERT`, `UPDATE`, `DELETE`, `DROP`, skrypt migracyjny).
Szybkie sprawdzenie, czy Twoja zmiana coś takiego robi:

```bash
git diff main dev -- routes/ server.js | grep -iE "^[+-].*(CREATE TABLE|ALTER|INSERT|UPDATE|DELETE|DROP)"
```

Pusto = same odczyty = kopia bazy zbędna, `revert` w pełni Cię ratuje.
Coś wyszło = zrób kopię bazy PRZED wdrożeniem, bo `git revert` cofa kod, **nie dane**.
