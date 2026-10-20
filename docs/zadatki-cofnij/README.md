# Zgłoszenie #7 — „Cofnij" w Spisie Zadatków

Ania (recepcja) zgłosiła edycję utraconych zadatków, a 19.10 dopisała, że przycisk **znalazła**,
tylko szukała go w zakładce **Zadatki**: *„będzie to bardziej intuicyjne"*. Obietnica złożona
w odpowiedzi na ticket: przycisk pojawi się w spisie.

## Jak było

Cofanie istniało wyłącznie w profilu klientki → zakładka **Wizyty** → sekcje „📉 Utracone zadatki"
i „↩️ Zwrócone zadatki". W **Spisie Zadatków** — tam, gdzie recepcja patrzy na co dzień — była
tylko kolumna Status i zero akcji.

## Jak jest

Kolumna **Akcja** w Spisie Zadatków, a w niej **Cofnij** — ale tylko przy zadatkach, które da się
przywrócić: `PRZEPADŁ (KARA)` i `ZWRÓCONY`. Przy aktywnych, wykorzystanych i scalonych kolumna
zostaje pusta, żeby nie kusiła.

Po kliknięciu to samo pytanie co w profilu (inne dla przepadłego, inne dla zwróconego — przy
zwrocie pieniądze fizycznie wyszły z salonu), ta sama akcja `manage_deposit` i ten sam zapis
„Przywrócony: …" w celu. Lista odświeża się sama, więc wiersz od razu pokazuje `AKTYWNY`.

Obie drogi korzystają teraz ze wspólnej funkcji `przywrocZadatekRekord` — profil bierze rekord
z `window.cacheZadatkow`, spis z `zadatkiCache`. Dzięki temu nie rozjadą się przy kolejnej zmianie.

**Przy okazji**: status `ZWRÓCONY` dostawał ikonę kłódki jak zadatek wykorzystany, bo warunek
szukał słowa „ZWROT". Teraz przepadły i zwrócony mają strzałkę powrotu ↩️.

## Próba (izolowane środowisko, MariaDB 3307 + serwer 3999)

Dwa zadatki ustawione normalną drogą przez API aplikacji — jeden na `KARA`, drugi na `ZWROT` —
potem przejście recepcji w przeglądarce:

```
naglowki tabeli: Data | Klient | Kwota | Typ / Metoda | Cel / Opis | Status | Akcja
wierszy w spisie: 4
przyciskow Cofnij: 2
przy jakich statusach: ↩️ PRZEPADŁ (KARA) -> COFNIJ ; 🔒 WYKORZYSTANY -> — ;
                       ✅ AKTYWNY -> — ; ↩️ ZWRÓCONY -> COFNIJ

klikam Cofnij przy PRZEPADŁ (KARA)...
wiersze po cofnieciu: Monika Sikora: ✅ AKTYWNY ; Klaudia Szymańska: 🔒 WYKORZYSTANY ;
                      Lena Dąbrowska: ✅ AKTYWNY ; Karolina Mazur: ↩️ ZWRÓCONY

stan w bazie po probie:
   DEP-DEMO-3 | Monika Sikora | AKTYWNY | Przywrócony: Zadatek za wizytę 24.10 (...)
BLEDY JS: brak
```

Zmiana zeszła do bazy, nie tylko do widoku.

| Plik | Co widać |
|---|---|
| `spis-z-przyciskiem.png` | kolumna Akcja: „Cofnij" przy przepadłym i zwróconym, pusto przy pozostałych |
| `po-cofnieciu.png` | po kliknięciu: status `AKTYWNY`, kwota znów na zielono, przycisk znika, komunikat „Zadatek został przywrócony!" |

## Zakres zmiany

`public/index.html`, punktowo: nagłówek tabeli, komórka akcji w wierszu, rozdzielenie funkcji
przywracania, `colspan` 6→7 **wyłącznie w trzech stanach tej jednej tabeli** (ładowanie, błąd,
brak wpisów). Reszta pliku nietknięta — cały diff: 23 linie dodane, 4 zmienione.
