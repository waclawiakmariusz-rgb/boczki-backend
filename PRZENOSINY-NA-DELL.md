# Przenosiny HP → DELL i praca na dwóch komputerach

Dwie rzeczy w jednym miejscu: **jak przenieść projekt na nowy laptop** (część A)
i **jak pracować na dwóch naraz, żeby nic nie ginęło** (część B).

Zasada, z której bierze się wszystko poniżej:

> **Nigdy nie kopiuj plików projektu z laptopa na laptop** — ani pendrive'em, ani
> chmurą, ani mailem. Od przenoszenia zmian jest git. Kopiowanie plików to dokładnie
> to, co 3 sierpnia 2026 skasowało trzy dni pracy nad Klubem (patrz `POWROT-AWARYJNY.md`).
>
> Wyjątek: trzy rzeczy z części A punkt 3, które celowo są poza gitem.

---

# CZĘŚĆ A — Uruchomienie projektu na DELL

## 1. Programy

- **Node.js** — ta sama wersja główna co na HP (sprawdź na HP: `node -v`)
- **Git**
- **VS Code** + **Claude Code**

## 2. Pobranie projektu — TA SAMA ŚCIEŻKA CO NA HP

To nie jest kosmetyka. Pamięć Claude o Twoim projekcie jest przypięta do **ścieżki
katalogu**. Inna lokalizacja = Claude zaczyna od zera i nie wie nic o Estelio.

Na HP projekt leży w:

```
C:\Users\aaell\Desktop\aplikacje boczki na bok\system magazynowy\boczki-backend
```

Na DELL musi leżeć tak samo. Jeśli konto użytkownika na DELL ma inną nazwę niż
`aaell`, powiedz o tym Claude **przed** przenosinami — trzeba wtedy przenieść też
katalog pamięci pod nową nazwę.

```bash
git clone https://github.com/waclawiakmariusz-rgb/boczki-backend.git
cd boczki-backend
git checkout dev      # WAZNE: klon ustawia main (produkcja), a pracujesz na dev
npm install
```

`main` to gałąź, którą wdraża Hostinger — czyli produkcja. Codzienna praca idzie
na `dev`, a na `main` trafia dopiero to, co sprawdzone. Jeśli po klonie zostaniesz
na `main`, każda Twoja zmiana będzie o krok od produkcji.

## 3. Trzy rzeczy, których git NIE przenosi

Muszą trafić na DELL ręcznie — to jedyny dozwolony przypadek kopiowania.

| co | skąd na HP | po co |
|---|---|---|
| **`.env`** (4 KB) | katalog projektu | hasła do bazy, klucze Stripe, VAPID — **bez tego nic nie ruszy** |
| **`design/`** (26 MB) | katalog projektu | makiety, zrzuty, PDF-y, dumpy SQL — do pracy nad wyglądem |
| **pamięć Claude** (60+ plików) | `C:\Users\aaell\.claude\projects\C--Users-aaell-Desktop-aplikacje-boczki-na-bok-system-magazynowy-boczki-backend\memory\` | wszystko, co Claude wie o Estelio: hasła, decyzje, historia |

`.env` przenieś **bezpiecznie** — to hasła produkcyjne. Nie mailem, nie na Slacku.
Pendrive albo menedżer haseł.

Skrypty serwisowe (`scripts/*.js`) **są już w gicie** — przeniosą się same.

## 4. Włączenie zabezpieczeń

```bash
npm run zabezpiecz
```

Raz na każdym komputerze. Ustawia bezpiecznik przy wysyłce i zakaz cichego scalania
(ustawienia gita siedzą w katalogu `.git`, który nie jedzie przez repozytorium —
dlatego trzeba to zrobić lokalnie, na obu maszynach).

## 5. Sprawdzenie, czy działa

```bash
npm test          # ma być 331/345 (14 zastanych błędów: magazyn, voucher, dokumenty)
npm start         # system ma wstać
npm run start-pracy
```

---

# CZĘŚĆ B — Codzienna praca na dwóch komputerach

## Rytuał: dwie komendy

**Siadasz do pracy** — na którymkolwiek laptopie:

```bash
npm run start-pracy
```

Ściąga najnowszą wersję i mówi, na czym stoisz. Ostrzeże, jeśli:
- masz tu niezapisane zmiany,
- drugi komputer wysłał coś nowego,
- któraś z przychodzących zmian **kasuje** dużo kodu (sytuacja z 3 sierpnia),
- na produkcji stoi coś jeszcze niepotwierdzonego.

**Kończysz pracę** — zawsze, nawet przy krótkiej przerwie, jeśli potem siądziesz
do drugiego laptopa:

```bash
npm run koniec-pracy
```

Sprawdza, czy nic nie zostaje tylko tutaj, i wysyła gotowe zmiany na GitHub.
Jeśli coś nie jest zapisane — powie dokładnie, co zrobić. **Nie commituje za Ciebie**,
bo opis zmiany musi napisać człowiek.

## Zasady

1. **Zaczynasz od `start-pracy`, kończysz na `koniec-pracy`.** To całość nawyku.
2. **Nie kopiuj plików między laptopami.**
3. **`public/index.html` — nigdy równolegle na dwóch maszynach.** ~34 tys. linii
   z polskimi znakami; scalanie takiego pliku potrafi rozwalić kodowanie.
4. **Jeden laptop „główny" dla pamięci Claude.** Pamięć nie jedzie przez git,
   więc na drugim komputerze Claude nie wie o tym, co ustaliliście na pierwszym.
   Kopiuj katalog `memory\` co jakiś czas w tę stronę, w którą pracujesz częściej.
5. **`.env` zmieniony na jednym = przenieś na drugi.** Git go nie ruszy.

## Gdy coś pójdzie nie tak

- **„Moja zmiana zniknęła"** → `POWROT-AWARYJNY.md`, punkt 5
- **Produkcja się psuje** → `POWROT-AWARYJNY.md`, punkt 1 (jedna komenda)
- **`start-pracy` mówi, że historia się rozjechała** → nie scalaj na siłę, zawołaj Claude

---

## Co się dzieje, gdy zabezpieczenie zadziała

Bezpiecznik przy wysyłce zatrzyma `git push` i pokaże mniej więcej to:

```
##  STOP - TA WYSYLKA KASUJE DUZO KODU
  eba4e8c  Sync z HP: modul lojalnosciowy...
          public/index.html: USUWA 54 linii, dodaje 10
```

Wtedy: sprawdź, czy naprawdę chcesz skasować ten kod. Jeśli tak (np. świadomie
usuwasz starą funkcję) — wyślij `git push --no-verify`. Jeśli nie wiesz —
**nie wysyłaj** i zawołaj Claude.

Bezpiecznik pilnuje tylko `public/*.html`, `routes/*.js` i `server.js` — plików,
w których masowe kasowanie prawie zawsze oznacza pomyłkę.
