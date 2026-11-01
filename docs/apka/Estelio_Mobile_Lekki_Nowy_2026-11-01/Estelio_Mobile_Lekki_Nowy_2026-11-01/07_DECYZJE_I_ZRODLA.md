# Decyzje i źródła — v0.2, 01.11.2026

## Co jest ustalone, a co proponowane

Zlecenie użytkownika: Android/iOS dla recepcji i managera, makiety, założenia, zabezpieczenia, praca recenzent ChatGPT / wykonawca Claude Code. Projekt aktualizujemy według trzech wskazanych stron pomocy.

Propozycje tego pakietu: jedna aplikacja; ekran startowy wg roli; mobilna Agenda jako pierwszy widok terminarza; R1 z operacjami recepcji; brak zapisów offline; rejestracja urządzenia przed PIN-em; RN/Expo i Capacitor do rozstrzygnięcia po M00. Nie są jeszcze wdrożone ani automatycznie zatwierdzone.

| Decyzja | Rekomendacja | Kiedy |
|---|---|---|
| Odbiorca i pilot | pracownicy salonów Estelio; początek w jednym salonie | M01 |
| Dwa produkty czy jeden | jedna aplikacja, dwa układy startowe | M01 |
| Telefon/tablet | wspólny tablet recepcji + osobisty telefon managera | M01 / urządzenia pilota |
| Pierwsza wersja | pełny podstawowy przebieg operacyjny, przyrostami M03–M06 | po M00 |
| Technologia | porównać RN/Expo z Capacitor na rzeczywistym kodzie | M00–M01 |
| PIN i dostęp | zachować znajomy proces, dołożyć zaufane urządzenie i kontrolę serwera | M02 |
| Wrażliwe dane | macierz pola/czynności, bez ślepego kopiowania pełnych profili | M01 |
| Administrator platformy | zachować funkcję, oddzielić od roli salonowej i audytować | M02 |
| Sklepy | jedna aplikacja dla istniejących kont salonów | M08 |
| Budżet i termin | przedziały po rozpoznaniu API i bezpieczeństwa | M00 |

## Aktualne źródła produktu

- [Pomoc pracownika](https://www.estelio.com.pl/pomoc/) — codzienne operacje i dodatki.
- [Pomoc managera](https://estelio.com.pl/pomoc-manager/) — role, zarządzanie i analiza.
- [Pomoc terminarza](https://estelio.com.pl/pomoc-terminarz) — szczegółowy przebieg wizyt, ewidencja pakietów, hold i sprawy.

Treść pobrana bezpośrednio 01.11.2026. Wyszukiwarka nie indeksowała stron poprawnie; użyto rzeczywistych odpowiedzi HTTP. Mapa źródeł i skróty kontrolne są w dokumencie 08. Opis funkcji w pomocy nie dowodzi jej aktywacji u każdego klienta. Rozbieżności wymagają kodu i testów.

## Pozostałe materiały projektu

Przewodniki z 08.06.2026 są historyczne. Preferencje marki i standard redesignu służą formie przekazania; wcześniejsze hasło reklamowe „Estelio nie jest kalendarzem” nie usuwa obecnie udokumentowanego opcjonalnego Terminarza.

[AUDYT_BEZPIECZENSTWA_ESTELIO.md](https://chatgpt.com/library?file_id=libfile_cc2d9a983d248191878a7f862fd4b3d5&account_id=personal): 26.10.2026, commit f6dbd327fa359c4ae29ea26134d5ed8a368de537. Lista do ponownego sprawdzenia, nie diagnoza aktualnego środowiska. Nie powielamy szczegółów podatności w publicznych makietach.

## Oficjalne odniesienia techniczne

- [OWASP MASVS](https://mas.owasp.org/MASVS/) — zakres kontroli mobilnych, bez deklaracji certyfikacji.
- [React Native — Security](https://reactnative.dev/docs/security) — ochrona danych i sekretów na urządzeniu.
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) — bezpieczny magazyn małych wartości i ograniczenia platform.
- [Capacitor](https://capacitorjs.com/docs) — wariant mobilnego frontendu webowego.
- [RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) — przeglądarka systemowa i PKCE, jeśli wybierzemy OAuth.
- [Apple App Review](https://developer.apple.com/app-store/review/guidelines/) i [Unlisted](https://developer.apple.com/support/unlisted-app-distribution/) — warianty dystrybucji i wymagania.
- [Managed Google Play](https://support.google.com/work/android/answer/9563481?hl=en) — prywatna dystrybucja w zarządzanych organizacjach.

Ceny, wersje SDK, zasady sklepów i płatności sprawdzamy ponownie przed publikacją. Ocena dopasowania, etapy i wymagania w tej paczce są pracą projektową, nie deklaracją dostawców.
