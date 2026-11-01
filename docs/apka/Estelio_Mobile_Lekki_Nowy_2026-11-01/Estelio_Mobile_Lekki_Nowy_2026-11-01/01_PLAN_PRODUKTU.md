# Plan produktu — Estelio Mobile v0.2

## Cel i granice

Aplikacja pracownicza Android/iOS do istniejącego Estelio. Jedna instalacja z interfejsem zależnym od roli, salonu i aktywnych dodatków. Pilot proponowany w jednym salonie, potem stopniowe udostępnianie kolejnym. Nie tworzymy drugiej bazy, drugiej kasy ani odrębnych reguł pakietów.

Telefon managera jest zwykle osobisty lub przypisany jednej osobie. Recepcja może używać telefonu i współdzielonego tabletu. Na tablecie zawsze widoczna aktualna osoba oraz szybka blokada/zmiana pracownika. Nazwy danych i procesy pozostają zgodne z Estelio, układ dostosowujemy do dotyku.

## Zakres docelowy i kolejność

| Obszar | Pierwsze wydanie operacyjne R1 | Rozwinięcie R2 / zaplanowana droga WWW |
|---|---|---|
| Start recepcji | zadania, telefony, sprawy do sprawdzenia, skróty sprzedaży i dnia | szablony cykliczne i rozbudowane filtry |
| Klientki | wyszukiwanie po nazwie/telefonie/ID, profil, dodanie z kontrolą duplikatu, edycja kontaktu, preferencje, historia | ranking, procedury scalania/usuwania z zatwierdzeniem managera |
| Sprzedaż | wiele pozycji, sprzedawcy, usługa/produkt/zadatek, dostępne metody i Mix, portfel, historia, korekta, zwrot, podsumowanie dnia | zaawansowane zestawienia i eksporty |
| Karnety | ważność, przedłużenie/zawieszenie/zakończenie, osobne salda składników przy aktywnej ewidencji | masowe przygotowanie starych zakupów i mapowanie ofert w WWW |
| Terminarz, gdy aktywny | agenda, wizyta wielousługowa, sprawdzenie kompletu, zmiana/odwołanie, obsługa i rozliczenie, sprawy, rezerwacja techniczna, szybki hold do zadatku | pełna siatka zasobów i rozbudowana konfiguracja; na tablecie siatka po osobnym odbiorze |
| Manager | cztery wskaźniki dnia, miesiąc, cel, koszty jako kontekst, zadania zespołu i otwarte sprawy | analizy pracowników/zabiegów/konsultacji, BI, audyt, raport reklamowy, koszty i targety do edycji |
| Magazyn | dostęp do aktualnego stanu potrzebnego przy sprzedaży | mobilne przyjęcie, zużycie, inwentaryzacja i zamówienia |
| Dokumenty | kompletność, bezpieczny odczyt istniejących plików według praw; przekazanie do procesu uzupełnienia | skanowanie/aparat, podpisy i szersza obsługa dokumentów |
| Konsultacje, retencja, urodziny | powiązane zadania i przejście do klientki | pełne formularze i listy do pracy |
| Dodatki | widoczność wg salonu; Terminarz i ewidencja bez własnych zamienników | Foto, płatności online i obsługa Klubu od strony pracownika |
| Administracja | własne sesje, ustawienia osobiste i pomoc | cennik/rabaty/sugestie/dodatki wg roli; Kreator dostępów właściciela w WWW |

R1 jest większe od „demo do odczytu”. Wdrażamy je przyrostowo, ale nie nazywamy recepcji gotową, jeśli nie potrafi zamknąć podstawowej operacji. Nieobecność natywnego modułu ma mieć jawną, bezpieczną drogę „Otwórz w Estelio WWW”, z ponowną kontrolą dostępu i bez tokenu sesji w adresie. Nie budujemy atrapy niedokończonego modułu.

Funkcje Klubu w tej aplikacji mogą dotyczyć wyłącznie obsługi przez personel aktywnego dodatku. Konto klientki, jej punkty, logowanie i ekran kliencki nie są odbiorcą tego projektu.

## Reguły finansowe wymagające wspólnego serwera

1. Jedna operacja może mieć kilka pozycji i kilka metod płatności; techniczne wiersze dopłaty nie stają się dodatkowym pakietem ani dodatkową transakcją.
2. Pieniądze wpłacone na portfel i ich późniejsze wykorzystanie nie mogą dwukrotnie zwiększać wpływów. W widoku pokazujemy osobno wartość koszyka i nowe środki; definicje raportów potwierdza M00.
3. Sprzedawca rozliczeniowy i wykonawca zabiegu nie muszą być zalogowanym operatorem. Udział kilku sprzedawców musi odpowiadać istniejącej regule, bez nowej formuły w telefonie.
4. Korekta błędu, zwrot pieniędzy i awaryjna edycja nie mogą być jednym przyciskiem. Zwrot ma odniesienie do źródła, limit, metodę, powód i decyzję o magazynie.
5. Ceny, rabaty, stany, ważność i uprawnienia sprawdza serwer. Aplikacja może pokazywać podgląd, ale nie zatwierdzać własnego wyliczenia jako źródła prawdy.
6. Estelio nie zastępuje kasy fiskalnej. Ekran zapisanej sprzedaży nie ma udawać fiskalnego paragonu ani potwierdzenia terminala.

## Pakiety i terminarz

Saldo PLN nie jest liczbą zabiegów. W pakiecie łączonym każdy rodzaj usługi ma własny licznik. Umówienie rezerwuje uprawnienie, wykonanie zużywa, odwołanie zwalnia rezerwację. Nie wolno odgadywać liczby z nazwy, ceny, skrótu „5x” ani daty ważności. Niepotwierdzony stan nie oznacza zera wykorzystanych.

Ewidencja ma tryby nieuruchomiona/przygotowanie/aktywna/wstrzymana; aplikacja respektuje stan i kontrolę zakupów zwróconą przez API. W przygotowaniu nic nie odejmuje; we wstrzymaniu nie zakłada nowych rezerwacji pakietowych. Wyłączenie dodatku nie kasuje historii. Przebieg przerwanych usług, potrąceń i korekt musi wynikać z serwera i rozstrzygnięcia rozbieżności pomocy.

Szybka rezerwacja jest czasowym zajęciem terminu, nie pełną wpłatą. Osobne zdarzenia: utrzymanie terminu, akceptacja regulaminu, potwierdzenie otrzymania zadatku, wygaśnięcie. Opóźniona wpłata nie przywraca automatycznie zajętego już slotu. Dokładny termin ważności i dozwolone akcje pobieramy z serwera.

Wizyta ma osobno rezerwację, obecność/wykonanie każdej usługi i rozliczenie. Wykonana usługa nie tworzy automatycznie nowej sprzedaży. Przejście do sprzedaży i powiązanie z istniejącym zapisem muszą być odporne na powrót z tła i ponowienie.

## Etapy pracy ChatGPT ↔ Claude Code

| Etap | Wynik wykonawcy | Odbiór recenzenta |
|---|---|---|
| M00 — rozpoznanie | commit/branch, mapa kodu/API, rzeczywiste role, rozbieżności, szacunek wariantów | dowody zamiast założeń; wybór technologii i granic R1 |
| M01 — kontrakty | macierz uprawnień, schematy API, przepływy i scenariusze danych | zgodność z operacjami salonu, brak drugiej logiki finansowej |
| M02 — fundament | sesje, izolacja salonów, rejestracja urządzenia, unieważnienie, audyt | negatywne próby uprawnień i przełączania osób |
| M03 — pierwszy przebieg | profil → koszyk → Mix/portfel → jeden zapis → historia → zwrot | rozliczenia i idempotencja, także dwa urządzenia |
| M04 — praca zmiany | zadania/telefony, karnety, dokumenty, podsumowanie dnia | zgodność web/mobile i kontrola dostępu |
| M05 — terminarz | komplet wizyty, pakiety, obsługa, rozliczenie, hold i sprawy | konflikty, stany, przerwy sieci, dodatki wyłączone |
| M06 — manager | wyniki, cele i zespół; rozwinięcia R2 priorytetami | zgodność raportów z WWW na tych samych danych |
| M07 — pilot | wersje testowe obu platform, instrukcja, telemetria bez danych klientek | rzeczywiste urządzenia, wydajność, dostępność, cofnięcie wdrożenia |
| M08 — dystrybucja | materiały sklepów, podpisane buildy, aktualizacja i obsługa incydentu | gotowość wydania, konto demonstracyjne, plan utrzymania |

Każdy etap: zlecenie z zakresem → wykonanie → raport i diff → recenzja → konkretne poprawki → ponowny odbiór tylko zmienionych/ryzykownych obszarów. Nie łączymy M00 z poleceniem wdrożenia na main. Status recenzji: przyjęte / do poprawy / brak dowodu.

## Koszt i harmonogram

Nie podajemy dziś pozornego terminu całej aplikacji. Claude ma oszacować osobno: backend i bezpieczeństwo, mobilny UI, integrację modułów, testy, konta/buildy, pilot oraz utrzymanie. Dla każdego: zakres, założenia, przedział nakładu, zależności i ryzyko. Największe niewiadome to gotowość API finansów i ewidencji, nie wygląd przycisków.

Proponowany pilot: recepcja na jednym współdzielonym tablecie oraz manager na iOS i Androidzie, z osobnymi kontami. Mierzyć domknięcie scenariuszy, pomyłki wyboru klientki, utracone formularze, czas najczęstszych działań i rozbieżności raportów. Warunek startu: brak otwartych krytycznych błędów autoryzacji oraz brak podwójnych zapisów finansowych/jednostek. Rozszerzenie dopiero po zamknięciu pełnego dnia pracy i sprawdzeniu odtworzenia kopii.
