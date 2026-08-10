---
description: Wroc do sprawy przeniesienia narzedzi pracy na dwoch komputerach z dev na main
---

# Wracamy do: narzędzia pracy dwukomputerowej → `main`

User odłożył tę decyzję **10.08.2026** słowami „zostaw na dev, ale wrócimy do tego".
Teraz do niej wraca. Nie pytaj go, o co chodzi — poniżej jest cały kontekst.

## O co chodzi

Na gałęzi `dev` leżą narzędzia zabezpieczające pracę na dwóch komputerach (HP → DELL),
zbudowane po incydencie z 3–10.08.2026. **Nie ma ich na `main`.**

Commity: `1a0881e`, `e82df12`, `28153bf` (plus ewentualne późniejsze).

Pliki:
- `narzedzia/praca-start.js` → `npm run start-pracy`
- `narzedzia/praca-koniec.js` → `npm run koniec-pracy`
- `narzedzia/zabezpiecz.js` → `npm run zabezpiecz` (raz na każdej maszynie)
- `narzedzia/analiza-commitow.js` — wykrywa commity masowo KASUJĄCE kod
- `githooks/pre-push` + `githooks/pre-push.js` — bezpiecznik przy wysyłce
- `PRZENOSINY-NA-DELL.md`, `.gitattributes` (LF dla githooks)
- `package.json` — 3 nowe skróty + `--forceExit` przy `test`

## Dlaczego to w ogóle miałoby iść na `main`

`git clone` ustawia domyślnie `main`. Dopóki narzędzi tam nie ma, po sklonowaniu
projektu na DELL trzeba pamiętać o `git checkout dev`, żeby je w ogóle zobaczyć.
Na `main` byłyby dostępne od razu.

## Co zostało ustalone (nie badaj tego od nowa)

Zweryfikowane 10.08.2026 — push na `main` **nie wpływa na system dla użytkownika**:
- zero zmian w `public/`, `routes/`, `server.js`
- serwer nie importuje `narzedzia/` ani `githooks/`
- pliki `.md` nie są serwowane (express udostępnia tylko `public/`)
- `package-lock.json` i zależności nietknięte — `npm install` nic nowego nie pobierze
- `"start": "node server.js"` bez zmian
- hook działa dopiero po lokalnym `npm run zabezpiecz`; serwer nic nie wysyła do gita

Jedyny efekt: kilkusekundowy restart przy wdrożeniu, jak przy każdym deployu.

## Co zrobić teraz

1. `git fetch origin` i sprawdź, czy `dev` nie wyprzedził `main` **także o rzeczy
   niezwiązane z narzędziami** — jeśli tak, powiedz to userowi, bo wtedy `merge --ff-only`
   wciągnie na produkcję również tamte zmiany. To jest najważniejszy punkt tej komendy.
2. Pokaż `git diff main..dev --stat` — user ma zobaczyć dokładnie, co idzie.
3. **Zapytaj o zgodę na push na `main`** — to bezwzględna reguła (patrz pamięć:
   `feedback_deployment_safety`), obowiązuje nawet gdy user sam wywołał tę komendę.
4. Po zgodzie: `git checkout main && git merge dev --ff-only && git push origin main`.
5. Przypomnij: panel Hostingera → „Ponowne wdrożenie", a po sprawdzeniu produkcji
   przestawienie znacznika `ostatnia-dobra`.

## Powiązane

- `POWROT-AWARYJNY.md` — procedura cofnięcia produkcji (w repo)
- `PRZENOSINY-NA-DELL.md` — przenosiny i praca na dwóch komputerach (w repo)
- pamięć: `migracja_nowy_laptop.md` (incydent + wdrożone zabezpieczenia)
