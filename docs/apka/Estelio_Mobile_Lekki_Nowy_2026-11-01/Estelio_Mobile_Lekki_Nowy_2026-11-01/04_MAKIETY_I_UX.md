# Makiety mobilne v0.2 — kontrakt dla wykonawcy

Otwórz `makiety/index.html`. Pliki `mobile.css`, `mobile.js` i oryginalne logo są w paczce. Prototyp używa fikcyjnych osób i kwot, nie łączy się z Estelio, nie wykonuje połączeń ani płatności. Stan utrzymuje wyłącznie w pamięci karty; przeładowanie zaczyna demonstrację od nowa.

## Ekrany

| Ekran | Cel i główne zachowanie |
|---|---|
| Start recepcji | Szybka sprzedaż i wyszukanie klientki, sprawy do sprawdzenia, zadania oraz kontekst najbliższej obsługi. Bez Analizy salonu. |
| Start managera | Migawka czterech wskaźników, analiza i zadania zespołu. Wyniki to statyczna próbka o 09:42, sprzed symulowanych operacji. |
| Zadania / telefon | Filtr Wszystkie/Telefony/Do zrobienia, grupowanie po terminie, wynik rozmowy, przesunięcie i dodanie zadania. |
| Kartoteka | Dwie klientki o tym samym nazwisku mają różne ID i maskowane telefony. W makiecie szukamy po nazwie/ID; w produkcie także po znormalizowanym telefonie. |
| Profil | Portfel PLN, dane dokumentów i osobne składniki pakietu. „Umów” rezerwuje Endermologię, nie zmienia Meltivio. |
| Sprzedaż | Usługa, dodanie kosmetyku lub zadatku; podział portfel + nowa wpłata. Walidacja salda i zakaz finansowania nowego zadatku portfelem w tym scenariuszu projektowym. |
| Historia / zwrot | Symulowany zapis sprzedaży oraz zwrot od osobnego wcześniejszego zakupu. Limit i powód obowiązkowe. |
| Podsumowanie dnia | Bazowe wpływy według metod i oddzielne ruchy demonstracyjne. Nie jest to księgowość ani paragon fiskalny. |
| Agenda | Mobilny punkt wejścia do wizyty i holda. Użyte daty/godziny są fikcyjnym scenariuszem na 02.11.2026, nie kalendarzem salonu. |
| Wizyta | Rezerwacja, obecność, wykonanie usługi, rozliczenie. Przejście przybyła → rozpoczęta → wykonana; dopiero potem sprzedaż. |
| Umawianie / zmiana | Wybór kompletnego terminu; 14:00 celowo ma konflikt sprzętu, 14:30/15:30 są alternatywami. Zmiana zachowuje stary termin do potwierdzenia. |
| Rezerwacja do zadatku | Oddzielnie zgoda i wpłata; kontrolki symulacji zdarzenia klientki i wygaśnięcia wyraźnie opisane. |
| Sprawy | Rozwiązanie wymaga wyniku. Samo otwarcie niczego nie kończy. |
| Do sprawdzenia | Wygasający karnet i nieaktywny zadatek prowadzą do pracy z klientką. |
| Analiza | Miesiąc i cel, rozbicie wpływów, jasny komunikat o brakujących kosztach. |
| Więcej | Jawny zakres modułów i przejść. Funkcje R2 nie udają gotowych ekranów. |
| Moja sesja / blokada | Imienny pracownik, urządzenie, zmiana osoby, demonstracyjny PIN. Bez Kreatora dostępów managera. |

## Trasy do oceny

1. Recepcja → Zadania → telefon → Nie odebrała. Zadanie ma pozostać aktywne z kolejnym terminem. Wynik „Umówiona” nie tworzy rezerwacji.
2. Profil Anny ID 101 → Sprzedaż → dodaj kosmetyk → 120 zł z portfela. Koszyk 260 zł, nowe środki 140 zł, saldo portfela po zapisie 180 zł. Jeden zapis w historii.
3. Historia → zakup DEMO-S-013 → zwrot 60 zł z powodem. Limit spada ze 180 do 120 zł; brak nadpisania pierwotnego zakupu. Próba 200 zł odrzucona.
4. Profil → Umów Endermologię → 14:00 → konflikt → 14:30 → potwierdzenie. Endermologia: wykorzystano 1, umówiono 2, do umówienia 2; Meltivio bez zmiany: 0/1/3.
5. Wizyta → Zmień termin → sprawdź → potwierdź. Potem przybycie, start, koniec, sprzedaż. Rozliczenie wskazuje zakończony proces zamiast kolejnego pobrania pieniędzy.
6. Rezerwacja do zadatku → Akceptacja regulaminu. Wpłata pozostaje niepotwierdzona. Wygaśnięcie zwalnia termin; potwierdzonej wpłatą rezerwacji nie wygaszamy jako nieopłaconej.
7. Wyłącz aktywne liczniki: profil zachowuje ważność, nie pokazuje fałszywych jednostek. Wyłącz Terminarz: znika jego nawigacja.
8. Wybierz Brak internetu i spróbuj zapisu. Ekran odmawia zapisu; to prezentacja zachowania, nie test realnej sieci.
9. Manager → Moja sesja → blokada → Anna / dowolny demonstracyjny czterocyfrowy PIN. Recepcja nie dostaje nawigacji Analizy.

## Styl i układ

„Lekki nowy”: ciepłe tło, jasne powierzchnie, bordowy akcent i czytelny kontrast; wygląd ciemny zachowuje znaczenie etykiet. Prawdziwe logo Estelio bez przerysowania. Kolor nigdy nie jest jedynym opisem stanu.

Kontener telefonu do 420 px; tablet do 800 px z dwukolumnowym profilem. Nagłówek i nawigacja są częścią makiety, nie pozycjonujemy ich względem okna przeglądarki. W aplikacji natywnej uwzględnić safe areas, klawiaturę, obrót, gest powrotu i skalowanie tekstu.

- Bazowy tekst 14 px w prototypie; pola 16 px; nagłówki 29 px; pomocniczy tekst nie mniejszy niż 11 px. W aplikacji użyć skalowalnych jednostek platformy i sprawdzić duży tekst.
- Odstępy zwykle 8/12/16/24 px; powierzchnie 12–17 px promienia. Nie zwiększać liczby dekoracyjnych kafli.
- Dotyk co najmniej 44 px wysokości; jawne podpisy i focus. Informacje istotne dostępne bez hover. Tooltip nie zastępuje etykiety.
- Maksymalnie pięć głównych zakładek. Rezerwacje, korekty i zwroty mają pokazać skutki przed zatwierdzeniem.
- Pomoc kontekstowa powinna korzystać z wersjonowanej mapy sekcji pomocy, dopasowanej do roli i modułu. Nie wklejać ręcznie pełnego poradnika na każdy ekran; nie pobierać dowolnego HTML do WebView bez kontroli.

## Wymagane stany produkcyjne

Ładowanie, pusta lista, brak wyników filtra, brak prawa, wyłączony dodatek, sesja odebrana, brak internetu, nieustalony wynik zapisu, konflikt wersji, błąd walidacji, błąd uploadu, utrata formularza po zmianie osoby. Po timeout sprawdzamy status wcześniejszej operacji, a nie automatycznie tworzymy następną.

## Granice prototypu

To wybór kluczowych ekranów i interakcji, nie komplet implementacyjny wszystkich modułów. Nie ma prawdziwego backendu, ochrony PIN, plików, terminala, SMS-ów, powiadomień push, trwałych sesji ani obsługi realnego tpay. Stan „konflikt” jest wywoływany kontrolką. Nie dowodzi testów konkurencji ani bezpieczeństwa.

Koszyk ma ograniczony katalog demonstracyjny; jedna nowa rezerwacja i jeden scenariusz pakietu wystarczają do oceny przebiegu. Pełne dodawanie klientki, wielousługowy kreator, anulowanie, rezerwacja techniczna, dokumenty i szczegółowe raporty są opisane w planie i kryteriach odbioru, ale nie mają pełnej implementacji w tej makiecie. Przyciski zaplanowanych rozszerzeń pokazują informację zamiast pozorować zapis.

Przed przeniesieniem ekranów do kodu produkcyjnego M00/M01 ma rozstrzygnąć semantykę rozliczenia wykonania z pakietu i wszystkie rozbieżności źródeł. Makieta nie tworzy nowej reguły pobierania opłaty za już opłaconą jednostkę.
