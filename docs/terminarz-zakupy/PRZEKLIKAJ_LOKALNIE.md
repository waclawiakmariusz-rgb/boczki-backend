# Przeklikaj wszystko bezpiecznie — izolowane środowisko testowe na laptopie

**Zasada numer jeden: to środowisko nie ma żadnego połączenia z produkcją ani ze wspólną bazą.** Baza stoi na Twoim laptopie (MariaDB 11.8.9, ta sama wersja co u Hostingera), salon jest fikcyjny, klientki są fikcyjne. Możesz klikać, zapisywać, psuć, kasować. Nic z tego nie trafia do Estelio, z którego korzysta recepcja.

## Jak poznasz, że jesteś w środowisku testowym

- adres w przeglądarce zaczyna się od `http://localhost:3999` (produkcja to `https://estelio.com.pl`),
- logujesz się jako salon **demo-test** (na produkcji nie ma takiego salonu),
- klientki nazywają się „Zestaw A (zwykły pakiet)”, „Zestaw B (pakiet łączony)” itd.,
- na stronie logowania w kodzie jest hash wersji (ten sam mechanizm co na produkcji) — jeśli masz wątpliwości, spójrz na adres.

Jeśli którykolwiek z tych punktów się nie zgadza, **zatrzymaj się**. Nie klikaj dalej.

## Uruchomienie i zatrzymanie

| Co | Plik (katalog repozytorium) |
|---|---|
| Start bazy + serwera + przeglądarki | `narzedzia\srodowisko-testowe\start-test.cmd` (dwuklik) |
| Zatrzymanie | `narzedzia\srodowisko-testowe\stop-test.cmd` |
| Świeże dane salonu demo (gdy coś pomieszasz) | `narzedzia\srodowisko-testowe\odswiez-dane-demo.cmd` (przy działającej bazie) |

Baza i hasła leżą **poza repozytorium**: `C:\Users\aaell\estelio-srodowisko-testowe\`. Hasło salonu demo-test jest w pliku `haslo-salonu-demo-test.txt` w tym katalogu. PIN-y: **Ola 1111** (manager), **Anna 2222** (kosmetolog). Konfiguracja serwera: `.env.test` w repozytorium (git go ignoruje). W `.env.test` lista `TERMINARZ_ZAKUPY_TENANTS` zawiera `demo-test`, dlatego tu zakładka zakupów jest widoczna, a na produkcji nie.

Okna „MariaDB 3307” i „serwer 3999” zostają otwarte, dopóki środowisko działa. Zamknięcie ich = zatrzymanie.

## Co jest w salonie demo-test (po odświeżeniu danych)

| Klientka | Co ma | Do czego służy |
|---|---|---|
| Zestaw A | pakiet 10 × endermologia | zwykły pakiet, stan początkowy, uruchomienie |
| Zestaw B | pakiet łączony 5 × endermologia + 4 × Meltivio, dwa egzemplarze | dwa niezależne liczniki, częściowe sprawdzenie |
| Zestaw C | dwa zakupy tego samego zabiegu o różnej ważności | wybór źródła |
| Zestaw D | stary pakiet i 7 wizyt już w kalendarzu, w tym przeszła | niedobór: 5 praw, 7 wizyt |
| Zestaw E | pakiet opłacony częściowo z portfela, częściowo dopłatą | rozbita sprzedaż = jeden pakiet |
| dwie klientki o tej samej nazwie, jedna z kosmetykiem, jedna z samym portfelem | pominięcia i izolacja po ID |

## Lista do przeklikania — zakupy (Terminarz → Ustawienia → Pakiety i zakupy)

Kolejność zakładek to kolejność pracy. Przy każdym kroku napisane, co powinieneś zobaczyć.

1. **Skład ofert.** Oferty z cennika z pigułkami „Zatwierdzona” / „Bez mapowania”. Kliknij „Edytuj skład” przy pakiecie łączonym: dwa wiersze, 5 i 4. Zapisz bez zmian: wersja nie rośnie. Zmień liczbę, zapisz: powstaje wersja 2, istniejące zakupy zostają przy wersji 1. Oferta „1x” ma rodzaj „Nie ewidencjonuj”.
2. **Przygotowanie zakupów.** Podgląd nic nie zapisuje. Zobaczysz grupy: gotowe, pominięte z powodem (kosmetyk, dopłata, zwrot), do rozstrzygnięcia. Dopłata Zestawu E jest pominięta, a jej kanoniczna sprzedaż ma dopisek o powiązaniu. Zaznacz wszystkie gotowe, „Zarejestruj”: wynik per pozycja. Kliknij „Zarejestruj” drugi raz: nic nie przybywa.
3. **Sprawdź stan pakietów.** Każdy składnik ma własne pola. Puste pole to „nie wiem”, nie zero. Przy Zestawie B potwierdź tylko endermologię (wpisz 2 wykorzystane, 0, 0): pakiet dostaje „Częściowo sprawdzony”, Meltivio nadal „Do sprawdzenia”. Wpisz więcej wykorzystanych niż kupionych: odmowa, bez przycinania.
4. **Istniejące wizyty.** Zestaw D: 5 praw, 7 wizyt, komunikat o niedoborze. Spróbuj uruchomić bez decyzji dla dwóch wizyt: odmowa. Rozstrzygnij dwie jako „wymaga zakupu / wyjaśnienia”, uruchom: „Umówione 5, Do umówienia 0”, żadna wizyta nie znika. Dopisz w kalendarzu nową wizytę tej klientce i wróć: stary plan odrzucony jako nieaktualny.
5. **Gotowość ewidencji.** Tryb „przygotowanie” → „aktywna”. W przygotowaniu wybory są planem, w aktywnej powstają rezerwacje. Po aktywacji Zestaw A: Kupiono 10, Wykorzystano 3, Umówione 6, Do umówienia 1 (jeśli wcześniej wpisałeś 3 wykorzystane i powiązałeś 6 wizyt).

## Lista do przeklikania — bezpieczeństwo (to samo środowisko)

- Wyloguj się, wejdź z samym hasłem salonu bez PIN-u: ekrany wymagające osoby nie działają.
- Zaloguj się jako Anna (kosmetolog): Administracja → zarządzanie kontami jest zablokowane, lista użytkowników nie pokazuje PIN-ów nawet managerowi (widać tylko „PIN ustawiony”).
- Zmień PIN Anny jako Ola, spróbuj starego PIN-u Anny: nie działa; przywróć.
- W przeglądarce zmień ręcznie adres na inny salon: odmowa, bez danych.
- Wyłącz dodatek Terminarz w Administracji → Dodatki: kalendarz znika, reszta działa; włącz z powrotem: rezerwacje są na miejscu.

## Kiedy coś pójdzie nie tak

To jest środowisko do psucia. Uruchom `odswiez-dane-demo.cmd` i zacznij od nowa. Jeśli serwer nie wstaje, w oknie „serwer 3999” jest powód. Jeśli baza nie wstaje, sprawdź, czy poprzednie okno „MariaDB 3307” nie zostało otwarte.

Czego to środowisko **nie** robi: nie wysyła maili ani SMS-ów (brak konfiguracji), nie łączy się ze Stripe, nie ma zdjęć klientek. Reset hasła „wysyła” mail w próżnię i pokazuje jawny błąd wysyłki, to zamierzone.
