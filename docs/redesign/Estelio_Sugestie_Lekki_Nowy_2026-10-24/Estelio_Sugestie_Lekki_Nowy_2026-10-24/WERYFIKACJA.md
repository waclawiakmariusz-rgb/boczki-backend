# Weryfikacja — 24.10.2026

## Wykonane

- `node --test testy-modelu.cjs` — **36/36 PASS**.
- Zakres: filtrowanie nazw i tekstów, polskie znaki, payload bez stanu UI, wybór katalogowy vs tekst, required/optional, zapis/usuwanie w pamięci, idempotencja demonstracyjna, błędy, konflikty, uprawnienia w adapterze demo.
- `node --check` wszystkich plików JavaScript — poprawna składnia.
- Zgodność fragmentu z index.html, obecność lokalnych zasobów i integralność ZIP.

Test z tekstem HTML w modelu potwierdza jedynie zachowanie tekstu. Nie jest testem XSS w przeglądarce. Renderowanie przez textContent zostało sprawdzone w kodzie.

## Niewykonane

- Odbiór HTML w przeglądarce: próba startu Playwright nie powiodła się, ponieważ brak pliku wykonywalnego Chromium Headless Shell. Nie oznaczamy prób UI jako PASS.
- Pikselowe porównanie HTML z grafiką; screenshoty kodu.
- Testy klawiatury, czytnika ekranu, dotyku, popupu przy dolnej krawędzi, mobile i zoom200%.
- Rzeczywiste API, sesje, salon, idempotencja, współbieżność i wyświetlanie sugestii pracownikom.

## Ręczny odbiór UI

1. Otwórz index.html. Widać trzy reguły i pusty formularz.
2. Wyślij pusty formularz: błędy przy obu wyborach, bez nowej reguły.
3. Wpisz „Endermologia”; wybierz pozycję strzałkami + Enter. Formularz nie zapisuje się podczas wyboru.
4. Wybierz źródło i cel; wskazówkę pozostaw pustą. Dodanie tworzy jeden rekord, czyści formularz, aktualizuje licznik.
5. Wpisz długie nazwy, polskie znaki i znaczniki HTML: tekst pozostaje tekstem, layout zawija.
6. Szukaj po źródle, celu, wskazówce; sprawdź pusty wynik i wyczyszczenie filtra.
7. Usuń: anuluj, potem potwierdź. Sprawdź powrót fokusu i zmianę tylko wskazanego rekordu.
8. Sprawdź scenariusze URL z INTEGRACJA_KODU.md oraz prawa odczytu.
9. Pomoc: kliknięcie otwiera, ESC zamyka, bez zapisu.
10. Sprawdź 320/400px,800×550,desktop,200% i urządzenie dotykowe.

Po integracji wykonaj tabelę S01–S18 w głównym dokumencie. Wyniki demo nie dowodzą zgodności obecnego Estelio ani gotowości produkcyjnej.
