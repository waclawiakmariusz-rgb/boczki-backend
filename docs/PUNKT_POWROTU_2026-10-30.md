# Punkt powrotu — 30.10.2026, przed pracami nad zgłoszeniami #19, #20, #21

**Po co ten dokument.** Zaraz zaczynamy zmiany w Terminarzu, które dotykają umawiania wizyt. Tu jest zapisane,
co dokładnie działa w tej chwili, czym to potwierdzono i jak wrócić, gdyby coś poszło nie tak.

---

## 1. Stan w jednym zdaniu

`main` = `dev` = **produkcja** = **dev-host** = **`179d134`**. Wszystko zsynchronizowane, nic nie czeka na wdrożenie.

| Gdzie | Wersja | Potwierdzenie |
|---|---|---|
| `main` | `179d134` | pełny zestaw testów 999/999 |
| `dev` | `179d134` | ta sama gałąź, bez rozjazdu |
| estelio.com.pl | `179d134` | hash na stronie logowania, 30.10 |
| dev.estelio.com.pl | `179d134` | hash na stronie logowania, 30.10 |
| Tag powrotu | `ostatnia-dobra-2026-10-30` | założony na `179d134` |

Ruchomy tag `ostatnia-dobra` nadal wskazuje `c4bc86e` (22.10). Przestawienie go wymaga `push -f`,
więc zostaje nietknięty do wyraźnej decyzji właściciela.

---

## 2. Co zostało sprawdzone na produkcji (tylko odczyt, żadnych zapisów)

| Sprawdzenie | Wynik |
|---|---|
| `/zaloguj`, `/pomoc/`, `/pomoc-terminarz/`, `/pomoc-manager/`, biblioteka wykresów | wszystkie 200 |
| Przewodnik Terminarza | 37 rozdziałów, treść po odchudzeniu (rozgraniczenie blokad obecne, zdublowana tabela pilności usunięta, zdanie o klientkach jeden raz) |
| Baza wspólna | 141 tabel, schemat Terminarza `2026-10-17` |
| Dane | 261 rezerwacji, 3999 pozycji sprzedaży, 642 klientki, 21 zgłoszeń |

Smoke `narzedzia/smoke-prod.js` **nie był uruchomiony** — wymaga hasła salonu demo, którego nie trzymamy w repo.
Uruchomienie: `PROFIL_LOGIN=demo PROFIL_HASLO=… node narzedzia/smoke-prod.js`.

---

## 3. Co weszło od poprzedniego punktu powrotu (`ostatnia-dobra-2026-10-21`)

- Zadania na Pulpicie, telefony i wyniki rozmów; zgłoszenia #15 i #17.
- Statystyki zespołu w Analizie (nowa akcja `statystyki`, panel w widoku Zadań).
- Zgłoszenie #14: wybór zabiegu z listy w Sugestiach.
- Naprawa apostrofu w Inwentaryzacji („Purles 108 Godess' Cream”).
- Przewodnik Terminarza: 33 → 37 rozdziałów, 25 zrzutów, koniec dublowania treści.
- Zdjęty kafelek „Dziś w lokalu” (Booksy) z Pulpitu.

**Żadna z tych zmian nie ruszała schematu bazy ani danych.** Ostatnia zmiana schematu to `2026-10-17`.

---

## 4. Bezpieczeństwo danych w nadchodzących pracach

Zgłoszenia #19, #20 i #21 dotyczą wyłącznie zachowania aplikacji, nie kształtu danych. Przyjęte zasady:

1. **Zero migracji.** Żadnych `ALTER TABLE`, żadnych nowych kolumn. Jeśli okaże się, że któraś zmiana
   ich wymaga, wstrzymuję się i pytam, zanim cokolwiek dopiszę.
2. **Produkcja i baza wspólna wyłącznie do odczytu.** Wszystkie próby zapisujące idą na bazę izolowaną
   (`.env.test`, MariaDB na 3307, baza `estelio_test`, fikcyjny salon `demo-test`).
3. **Dane demonstracyjne sprzątane po próbie.** Zasiew dnia i blokady testowe usuwane tym samym skryptem,
   który je tworzy.
4. **#20 nie osłabia ochrony przed kolizjami.** Ostrzeżenie zamiast blokady dotyczy wyłącznie sytuacji
   „osoba nie pracuje w tym czasie”, i tylko gdy wykonawczyni została wskazana ręcznie. Zajęty pracownik,
   zajęty gabinet, zajęte urządzenie i zajęta klientka zostają twardą odmową. Automatyczny dobór wykonawcy
   nigdy nie sięgnie poza czyjś grafik.
5. **Każda zmiana z testem strażnikiem** i próbą na izolowanej bazie ze zrzutami, przed zgłoszeniem „gotowe”.

---

## 5. Jak wrócić, gdyby coś nie działało

**Wariant pierwszy, przez panel Hostingera (bez konsoli).** Właściciel wdraża przyciskami, więc powrót
polega na cofnięciu `main` do tego punktu i ponownym `Pull` + `Restart`:

```
git checkout main
git revert --no-edit ostatnia-dobra-2026-10-30..main
git push origin main
```

Potem w panelu: **Git → Pull from remote**, **Node.js → Restart**, **Cache → Purge**.
`revert` jest bezpieczniejszy od `reset`, bo nie przepisuje historii i nie wymaga `push -f`.

**Wariant drugi, sprawdzenie bez wdrażania.** Dowolny commit da się obejrzeć lokalnie:

```
git checkout ostatnia-dobra-2026-10-30
npm test
```

**Czego powrót nie dotyczy.** Dane w bazie wspólnej zostają takie, jakie są. Żadna z planowanych zmian
nie przepisuje wierszy, więc cofnięcie kodu nie wymaga odtwarzania kopii bazy.

---

## 6. Otwarte sprawy, niezwiązane z tym punktem

- Raport audytu bezpieczeństwa i test izolacji salonów nadal poza repozytorium, czekają na decyzję.
- Dwa zrzuty w przewodniku Terminarza wymagają zalogowania PIN-em kosmetologa: „Mój dzień” i notatka u kosmetologa.
- Zgłoszenia #13 i #18 czekają na odpowiedź i na decyzję, kiedy je robić.
