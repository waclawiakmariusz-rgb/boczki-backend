# Weryfikacja — 23.10.2026

## Wykonano

- Obejrzano źródłowy zrzut kategorii i obie wygenerowane makiety.
- Testy `node testy-modelu.cjs`: **20/20 PASS**. Obejmują poprawność drzewa, ścieżki, wyszukiwanie, przodków, cykle, brak rodzica, powtórzone ID, operacje adaptera demo, głębokie drzewo i pustą listę.
- Kontrola składni wszystkich dostarczonych plików JS przez `node --check`.
- Kontrola odwołań HTML do plików, zgodności fragmentu z podglądem i integralności ZIP-a.

## Ograniczenia

Testy 20/20 dotyczą modelu i adaptera demonstracyjnego. Nie dowodzą działania aktualnego backendu Estelio ani obsługi dwóch sesji. Polityka duplikatów i usuwania w demo jest przykładowa.

Nie wykonano testów interakcji DOM i odbioru wizualnego HTML w przeglądarce. W tej sesji brakowało działającego Chromium, a wcześniejsza próba jego instalacji zakończyła się błędem pobrania. Nie wygenerowano zrzutów z działającego HTML. Makiety PNG są projektami graficznymi, nie dowodem wyglądu wdrożonego kodu.

Nie przeglądano repozytorium, API ani danych produkcyjnych. Integracja, zgodność starej turkusowej akcji, uprawnienia, semantyka usuwania, podpięcie pomocy oraz próby KAT01–KAT16 pozostają do wykonania przez Claude.

## Jawne różnice między rastrem a kodem

- Formularz w kodzie ma kompaktową wysokość; na makiecie widoku głównego generator rozciągnął kartę. Wiążąca jest kompaktowa wysokość opisana w instrukcji.
- Systemowy font może inaczej łamać wiersze niż raster. Parametry CSS w instrukcji są wiążące; nie deklarujemy zgodności pikselowej 1:1.
- Picker grafiki pokazuje fragment przykładowych opcji. Działający picker wyświetla całą dostarczoną listę i przewijanie.
- Pomoc standalone wykorzystuje dialog. Docelowo Claude powinien użyć istniejącego systemu chmurek Estelio.
