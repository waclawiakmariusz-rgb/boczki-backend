# Weryfikacja pakietu v0.2

01.11.2026. Dotyczy makiet i dokumentacji, nie aplikacji produkcyjnej.

## Wykonano

- Pobrano rzeczywistą treść trzech wskazanych stron pomocy; mapa odwołań i rozbieżności w dokumencie 08. Nie wykonywano testów funkcji na serwerze Estelio.
- Sprawdzono składnię JavaScript (`node --check`).
- Uruchomiono lokalne makiety w Chromium przez Playwright: 132 kombinacje roli, ekranu i szerokości 320/390/736/1024 px. Sprawdzono zarówno szerokość dokumentu, jak i zawartość wewnątrz ekranu. Wszystkie mieszczą się bez poziomego przepełnienia.
- Dodatkowo 21 asercji scenariuszy i błędów: koszyk 260 zł / portfel 120 zł / nowe środki 140 zł, saldo po zapisie, limit i powód zwrotu, konflikt zasobu, rezerwacja właściwego składnika pakietu, zachowanie starego terminu do zatwierdzenia, cykl wizyty i rozliczenie, zgoda bez wpłaty, wygaśnięcie holda, ponowienie kontaktu, zamknięcie sprawy z wynikiem, offline, wyłączone dodatki i zmiana managera na recepcję. Brak błędów JavaScript.
- Obejrzano render startu, sprzedaży, analizy, profilu ciemnego oraz tabletu. Poprawiono przepełnienie najmniejszego ekranu i niedostępny glif nawigacji.
- Pierwsza próba testu holda zatrzymała się na zamkniętym panelu demonstracji. Test poprawiono, aby otwierał panel tak jak użytkownik; końcowy przebieg zakończył się powodzeniem.
- Przygotowano samodzielny podgląd w rozmowie z tym samym kodem i osadzonym logo. Samodzielnie uruchomiono też ten podgląd: działa render, zmiana roli, nawigacja i potwierdzenie holda tworzące profil z portfelem 100 zł; bez błędów JavaScript.

## Ograniczenia

Prototyp nie ma serwera. „Brak połączenia”, konflikt, PIN i zapis to symulacje lokalne. Nie testowano API, prawdziwych uprawnień, MySQL, wysyłek, szyfrowania, podpisanych buildów ani realnych urządzeń iOS/Android. Wyniki nie są certyfikacją bezpieczeństwa ani dowodem poprawnego działania produkcji. Część ekranów R2 jest jedynie wskazana jako planowany zakres.

Raporty managera są statyczną próbką, historia demonstracyjnych operacji zmienia się w pamięci. Maskowane numery nie służą do wykonywania połączeń. Przeładowanie resetuje całość.

## Kompletność przekazania

ZIP zawiera 16 plików: 12 dokumentów Markdown i 4 pliki makiet (HTML, CSS, JS, oryginalne logo). Sprawdzono integralność archiwum i zgodność jego zawartości z finalnym katalogiem. Osobny plik M00 jest identyczny z dokumentem 05 w paczce. Pełne źródła pomocy, narzędzia testowe i robocze zrzuty nie są dołączone.
