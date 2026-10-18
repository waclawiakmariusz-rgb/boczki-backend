# Estelio — zakupy w Terminarzu: doprecyzowanie ścieżek płatności dla Claude Code

**Data:** 18.10.2026  
**Podstawa:** `RDZEN_PLATNOSCI_JAK_DZIALA.md` z 18.10.2026, kontrakt źródeł ZK-03 z 16.10.2026 i dokument odbioru ZK-03.1 z 16.10.2026.  
**Cel:** dopasować adapter zakupów do rzeczywistego sposobu zapisu sprzedaży, dopłat, portfela i zwrotów.  
**Zakres:** projekt i polecenia do implementacji. Nie jest to raport z ponownego sprawdzenia aktualnego kodu ani zgoda na aktywację integracji na produkcji.

## 1. Jak stosować ten dokument

Nowy opis potwierdza podstawową architekturę, a nie wymaga jej zastąpienia. Sprzedaż pozostaje właścicielem pieniędzy i dokumentowania zakupu; dodatek jest właścicielem ewidencji jednostek zabiegowych. Informacje o działaniu rdzenia przyjmujemy na podstawie przekazanego opisu. Wskazane niżej wymagania dla dodatku są doprecyzowaniem projektu, nie twierdzeniem, że już działają.

Ten aneks uzupełnia ZK-03.1. W kwestiach płatności, znaczenia `grupa_id` i zakresu zwrotu stosuj poniższe doprecyzowania. Pozostałe wymagania ZK-03.1 pozostają w mocy. Dla każdego punktu najpierw sprawdź aktualny kod i istniejący dowód; nie powtarzaj już wykonanych napraw.

Pracuj w dodatku i na izolowanych danych testowych. Nie zmieniaj przepływu Sprzedaży, rozliczania portfela, raportów finansowych, punktów, prowizji ani magazynu w ramach tego zadania. Nie uruchamiaj migracji wspólnej bazy ani ewidencji zakupów w salonach. Wdrożenie kalendarza z wyłączoną ewidencją jest odrębnym zakresem.

## 2. Ostateczne rozdzielenie pojęć

| Pojęcie | Znaczenie w Estelio | Znaczenie dla Terminarza |
|---|---|---|
| Paragon Estelio | Grupa pozycji jednego zapisu sprzedaży; nie dokument z drukarki fiskalnej | Kontekst do wyszukiwania źródeł, nie pojedyncza pula zabiegów |
| Główna pozycja usługi w `Sprzedaz` | Konkretny sprzedany egzemplarz oferty | Jedno źródło zakupu, po prawidłowej kwalifikacji |
| Skład oferty w dodatku | Zatwierdzona, wersjonowana lista usług i jednostek | Określa, ile praw zawiera jeden egzemplarz |
| Składnik konkretnego zakupu | Np. 5 endermologii albo 4 Meltivio | Osobne saldo, weryfikacja, przydziały i realizacje |
| `grupa_id` | Grupa powielonych pozycji, używana także do operacji na karnetach | Kontekst relacji i operacji grupowych; nie identyfikator jednego zakupu |
| Wiersz „Dopłata” | Część zapłaty za tę samą usługę | Powiązane źródło finansowe, bez własnych jednostek |
| Wpłata / bon kwotowy / reszta zadatku | Środki pieniężne w `Zadatki` | Brak jednostek zabiegowych |
| Podział Mix w `Platnosci` | Rozpisanie metod płatności | Brak kolejnych zakupów i jednostek |
| Zwrot w `Sprzedaz` | Nowy wiersz zwracający określoną kwotę do konkretnej pozycji | Powód sprawdzenia istniejącego zakupu; nie liczba cofniętych zabiegów |
| „Zakończ karnet” w rdzeniu | Ręczna decyzja o zakończeniu bez jednoznacznego powodu | Stan źródła wymagający uwzględnienia; nie potwierdzenie wykonania wszystkich zabiegów |

Klucz źródła: salon + stabilne ID głównej pozycji sprzedaży. Własność klientki: salon + stabilne ID klientki. Nazwa, telefon, kwota, paragon i `grupa_id` nie zastępują tych kluczy.

## 3. Macierz ścieżek przy kasie

W tabeli „zakup” oznacza kandydaturę do ewidencji. Dostępność jednostek wymaga jeszcze poprawnego źródła, zatwierdzonego składu, historii oraz uzgodnienia wizyt.

| Ścieżka rdzenia | Co widzi dodatek | Oczekiwany wynik |
|---|---|---|
| Pakiet opłacony gotówką, kartą lub przelewem | Jedna główna pozycja usługi | Jeden zakup ze składem oferty |
| Pakiet w całości z Portfela | Jedna główna pozycja z metodą Portfel/Zadatek | Ten sam wynik; bez ponownego obciążenia portfela |
| Portfel nie pokrywa ceny; powstaje dopłata | Główna pozycja + powiązana dopłata | Jeden zakup; kontrola obu źródeł finansowania |
| Pakiet opłacony Mix | Jedna główna pozycja + rozpisanie metod w `Platnosci` | Jeden zakup, niezależnie od liczby metod |
| Mix zawiera Portfel | Jak wyżej; rdzeń dodatkowo rozlicza zadatki | Jeden zakup; brak odczytywania zadatków jako nowych pakietów |
| Dopłata sama opłacona Mix | Główna pozycja + dopłata + splity dopłaty | Nadal jeden zakup |
| Dwa egzemplarze oferty przez powielenie pozycji | Dwie główne pozycje, możliwe wspólne `grupa_id` | Dwa zakupy; każdemu przypisany pełny skład jednego egzemplarza |
| Różne usługi lub warianty na jednym paragonie | Kilka głównych pozycji | Osobne zakupy; nie łączyć ich po numerze paragonu |
| Wpłata, bon albo zadatek jako pozycja na ekranie sprzedaży | Wiersz w `Zadatki`, a nie główna usługa w `Sprzedaz` | Brak zakupu zabiegowego, nawet gdy cel wpłaty brzmi „5 endermologii” |
| Reszta po wykorzystaniu portfela, np. `DEP-REST-…` | Nowy wiersz pieniężny | Brak zakupu zabiegowego i brak nowego prawa |
| Produkt z magazynu | Pozycja produktu | Brak jednostek zabiegowych; FIFO pozostaje w rdzeniu |
| Zwykłe `1×` po zabiegu | Zapis wykonanej usługi przy kasie | Domyślnie brak nowej jednostki na przyszłość |
| Konkretne `1×` kupione na przyszłość | Ta sama forma sprzedaży, ale jawna kwalifikacja w dodatku | Jedna jednostka po potwierdzeniu; inne sprzedaże `1×` bez zmian |
| Zakup obejmujący pakiet, kosmetyk i wpłatę | Różne rodzaje pozycji z tego samego ekranu sprzedaży | Jednostki wyłącznie z zakwalifikowanej pozycji pakietu |

Nie buduj stanu „nieopłacone” na podstawie wartości głównego wiersza. Rdzeń nie ma opisanego stanu szkicu ani należności do dopłacenia później. W szczególności główne 200 zł przy pakiecie za 1700 zł nie oznacza, że sprzedano 200/1700 pakietu. Jednocześnie zapis metody „Przelew” sam nie jest potwierdzeniem z banku — dodatek przyjmuje kontrakt zapisanej sprzedaży, nie tworzy własnego systemu weryfikacji wpłat.

## 4. Powiązanie dopłaty z konkretnym zakupem

### 4.1. Reguła

Opis obecnej ścieżki UI mówi: jeden egzemplarz usługi = główna pozycja + zero albo jedna dopłata. Jeśli rzeczywiste dane historyczne mają więcej dopłat, nie usuwaj ich i nie przypisuj automatycznie. Oznacz przypadek do rozstrzygnięcia, dopóki kod i dane nie potwierdzą jego znaczenia.

Powiązanie przechowuj w dodatku i stosuj tak samo przy podglądzie, imporcie, rezerwacji, przełożeniu, wykonaniu, korekcie i uzgadnianiu okresowym.

### 4.2. Kolejność rozpoznawania

1. Zawęź do tego samego salonu, klientki i paragonu zgodnie z rzeczywistym formatem identyfikatorów.
2. Rozróżnij główne usługi, dopłaty, produkty i zwroty. Uwzględnij wszystkie warianty tej samej usługi, nie tylko identyczny tekst wariantu.
3. Istniejące jawne przypisanie z dodatku ma pierwszeństwo, ale musi przejść ponowną walidację tożsamości i stanu źródeł.
4. Nazwa usługi i `grupa_id` ograniczają kandydatów. Nie dowodzą automatycznie relacji jeden do jednego.
5. Automatyczne powiązanie jest dozwolone tylko wtedy, gdy w ramach potwierdzonego formatu istnieje jedno dopuszczalne przypisanie. Sam fakt, że nazwa lub kwota pasuje, nie wystarcza.
6. Przy kilku możliwościach pokaż listę do wyboru z usługą, wariantem, datą i kwotą. Manager wskazuje relację, a dodatek zapisuje autora, datę i uzasadnienie.
7. W obecnym opisanym modelu jedna dopłata nie może finansować dwóch niezależnych zakupów jednocześnie. Wymuś to również przy dwóch równoległych zapisach. Jeśli istnieje rzeczywisty wyjątek zbiorczego finansowania, przedstaw go osobno, zamiast osłabiać regułę.
8. Nie wyprowadzaj relacji z kolejności wierszy ani zasady „dopłata ma numer o jeden większy”. Nie zakładaj, że wszystkie wiersze paragonu są jednego rodzaju.
9. Czytaj także wcześniej powiązane wiersze, które stały się usunięte albo przestały pasować nazwą. Inaczej usunięcie dopłaty zniknie z kontroli zamiast zostać wykryte.

### 4.3. Dwa egzemplarze nie są jednym zakupem

Dwa główne wiersze tej samej oferty ze wspólną grupą dają dwa zakupy. Nie deduplikuj ich do jednego. Nie mnoż też składu każdego wiersza dodatkowo przez liczbę wierszy w grupie.

Jeśli obydwa egzemplarze mają dopłaty, a zapisane pola nie rozróżniają przypisania, wymagane jest jawne rozstrzygnięcie. Ten sam problem może wystąpić dla 5× i 10× na jednym paragonie, ponieważ dopłaty mają pusty wariant. Decyzja musi być trwała; późniejsze kontrole nie wracają do zgadywania.

## 5. Zwroty: kwota i jednostki to dwie różne decyzje

### 5.1. Zakres finansowy zakupu

Do kontroli finansowego zakresu zwrotu zaliczaj główny wiersz oraz jednoznacznie powiązane dopłaty. Zwroty zbieraj po ich rzeczywistym `zwrot_do_id` do każdego z tych wierszy, z uwzględnieniem aktualnego statusu zwrotu. Do tego zestawu nie dodawaj ponownie `Zadatki` ani `Platnosci`.

Porównuj kwoty dokładnie w groszach. Zachowaj identyfikatory i stan źródeł; sama globalna suma bez powiązań nie wystarczy do wykrywania zmiany przypisania albo usunięcia wiersza.

**Scenka: pakiet 10× za 1700 zł.** Główne `A-1`: 200 zł Portfel. Dopłata `A-2`: 1500 zł Karta.

| Zdarzenie | Znaczenie finansowe | Reakcja jednostek |
|---|---|---|
| Sprzedaż `A-1` + `A-2` | Jeden zakup za 1700 zł | Skład 10 jednostek; bez proporcji 200/1700 |
| Zwrot 200 zł do `A-1` | Cały główny wiersz, ale tylko część kwoty zakupu | Do wyjaśnienia; nie oznaczaj automatycznie całego pakietu jako całkowicie zwróconego |
| Zwrot 100 zł do `A-2` | Częściowy zwrot dotyczący tego samego zakupu | Do wyjaśnienia; nie odejmuj 100/1700 × 10 zabiegów |
| Zwroty łącznie 1700 zł do prawidłowo powiązanych wierszy | Pełny zwrot pieniężny znanego zakupu | Wstrzymanie używania tego źródła do nowych rozliczeń i uzgodnienie; zachowanie historii wykonania |
| Zakwalifikowana oferta 0 zł | Brak dodatniej ceny | Nie uznawaj za zwróconą przez warunek `0 >= 0`; potrzebna zwykła kwalifikacja i weryfikacja |

Jeżeli przypisanie dopłaty jest niejednoznaczne, nie wyliczaj pozornie pewnego „zwrotu całego zakupu”. Pokaż „Nieustalone powiązanie dopłaty”.

### 5.2. Co robić po wykryciu zwrotu

1. Oznacz konkretny zakup jako wymagający wyjaśnienia. Nowe rezerwowanie i zużywanie z tego źródła zostaje wstrzymane do decyzji; inne prawidłowe zakupy klientki działają dalej.
2. Zachowaj umówione wizyty i dotychczasowe ruchy. Nie odwołuj wizyt ani nie usuwaj wykonania automatycznie. Pokaż listę powiązanych pozycji wymagających rozstrzygnięcia.
3. Manager określa skutek dla każdego składnika: brak zmiany praw (np. uzgodniony zwrot części ceny), wycofanie określonej liczby wolnych jednostek albo wycofanie pozostałych niewykorzystanych praw. Każda decyzja ma uzasadnienie i podsumowanie skutków.
4. Zapis decyzji dotyczy konkretnego odczytanego zestawu źródeł i zwrotów. Ponowienie nie tworzy drugiego wycofania; kolejny zwrot wymaga nowego sprawdzenia, zamiast korzystać ze starej zgody.
5. Jeśli wycofanie obejmuje jednostki zarezerwowane, najpierw pokaż plan: przełożyć rozliczenie na inny właściwy zakup, zwolnić przydział z zachowaniem wizyty do wyjaśnienia lub odwołać wskazaną wizytę. Zapisz wybraną spójną operację w dodatku. Nie dopuszczaj ujemnego salda przez zwykły formularz.
6. Gdy zabieg fizycznie wykonano, ale źródło jest sporne, zachowaj fakt wykonania i pokaż „Rozliczenie do wyjaśnienia”. Nie oznaczaj fałszywie, że zabieg się nie odbył, ani nie pobieraj jednostki ze spornego źródła bez rozstrzygnięcia.
7. Cofnięcie lub usunięcie zwrotu w rdzeniu, jeśli dana ścieżka istnieje, także wymaga uzgodnienia. Nie dopisuj automatycznie nowych praw do zakupu, w którym manager wykonał już korektę.
8. Wstrzymanie źródła nie może uniemożliwiać odwołania wizyty i zwolnienia istniejącego R. Dopuść tę ścieżkę po kontroli uprawnień i aktualnego przydziału, bez przyznawania nowych praw. Podobnie korekta błędnego wykonania zachowuje historię odwrócenia; odzyskana jednostka w spornym lub wygasłym zakupie nie staje się automatycznie dostępna do umawiania.

Nie utożsamiaj technicznego statusu `wycofane` źródła z ruchem wycofania jednostek W. Etykieta źródła blokuje korzystanie; ruch W wymaga określonej liczby i podstawy. W UI preferuj „Zwrot do wyjaśnienia” przed rozstrzygnięciem.

## 6. Pakiety łączone i licznik profilu klientki

Jeden egzemplarz `5 × endermologia + 4 × Meltivio` ma jednego rodzica i dwa niezależne składniki. Powielenie tego egzemplarza tworzy kolejnego rodzica, również z dwoma składnikami.

Przykład dla jednego zakupu, po sprawdzeniu zerowej historii:

| Stan | Endermologia: kupiono / wykonano / umówiono / dostępne | Meltivio: kupiono / wykonano / umówiono / dostępne |
|---|---|---|
| Przed umówieniem | 5 / 0 / 0 / 5 | 4 / 0 / 0 / 4 |
| Umówiono 3 A oraz 2 B | 5 / 0 / 3 / 2 | 4 / 0 / 2 / 2 |
| Potwierdzono jedną z umówionych A | 5 / 1 / 2 / 2 | 4 / 0 / 2 / 2 |
| Odwołano jedną z pozostałych umówionych A bez potrącenia | 5 / 1 / 1 / 3 | 4 / 0 / 2 / 2 |

Rezerwacja zmniejsza dostępność do dalszego umawiania. Wykonanie zamienia rezerwację w zużycie; nie odejmuje tej samej jednostki drugi raz. Sam upływ godziny nie wykonuje żadnego ruchu zużycia.

To saldo pokazuj w dodatku i — gdy dodatek jest aktywny — w jego sekcji na profilu klientki. Nie zmieniaj kwoty ani liczby pozycji w historii sprzedaży. „Zdjęcie ze stanu” oznacza zapis wykorzystania składnika w dodatku, nie zmianę oryginalnego zakupu finansowego.

Po zużyciu 5 endermologii nie zamykaj 4 Meltivio, całego rodzica ani grupy w rdzeniu. Wyczerpanie wszystkich składników może dać status „Wykorzystany” wewnątrz dodatku; nie wywołuje automatycznie `close_karnet`.

W licznikach pozostaje wcześniejszy model: G — przyznane, W — wycofane, U — wykorzystane, F — potrącone, R — zarezerwowane; L = G − W − U − F, B = L − R. Ruchy odwracające wchodzą do sum ze znakiem. Dostępność biznesowa wymaga dodatkowo ważnego źródła, właściwego terminu i gotowości ewidencji — samo dodatnie B nie oznacza „można umówić”.

## 7. Ręczne działania na karnetach w rdzeniu

| Zdarzenie | Wymagane zachowanie dodatku |
|---|---|
| Przedłużenie ważności | Odczytaj nową datę; zachowaj G/U/W/F/R. Sprawdź wpływ na terminy. Przedłużenie nie odnawia wykorzystanej puli. |
| Skrócenie lub zmiana daty | Sprawdź przyszłe rezerwacje; pokaż wizyty poza ważnością. Nie odwołuj ich automatycznie. |
| Zawieszenie | Odczytaj rzeczywisty zapis i semantykę `suspend_karnet`; nie wymyślaj nieistniejącej kolumny. Do wyjaśnienia skutku nie otwieraj nowych przydziałów z tego źródła. |
| Ręczne „Zakończ” | Zachowaj dotychczasowe wykonanie i saldo. Wstrzymaj dalsze korzystanie, wymagaj uzgodnienia powodu i jednostek. Nie ustawiaj U=G. |
| „Cofnij zakończenie” | Ponownie sprawdź ważność, historię, zwroty i decyzje dodatku. Nie resetuj wykorzystania i nie nadaj ponownie G. |
| Operacja obejmuje całą `grupa_id` | Sprawdź każdy główny zakup objęty operacją oddzielnie, z jego składnikami i przydziałami. Grupa nadal nie ma wspólnej puli. |

Jeśli po potwierdzeniu „Zakończ” w rdzeniu manager wycofał pozostałe prawa w dodatku, ponowne otwarcie w rdzeniu nie odwraca tego ruchu automatycznie. Potrzebna jest jawna korekta odnosząca się do konkretnego wcześniejszego wycofania.

## 8. Zmiany źródeł i zakres ich kontroli

Dotychczasowy kontrakt ZK-03 zalicza zmianę kwoty, daty sprzedaży i `grupa_id` do „opisowych”. Po doprecyzowaniu przepływu nie wolno pozostawić takiej klasyfikacji bez sprawdzenia wpływu.

| Zmiana | Interpretacja |
|---|---|
| Nazwa prezentacyjna klientki przy tym samym ID | Bez przenoszenia praw; odświeżenie opisu |
| ID klientki lub salon źródła | Zmiana własności / niedopuszczalne powiązanie; brak automatycznego transferu |
| Usługa, wariant, skład lub zmiana rodzaju usługa→produkt | Sprawdzenie mapowania i praw; nie przeliczaj starego zakupu najnowszą ofertą |
| Data sprzedaży | Może zmienić wybór wersji lub relację do punktu odcięcia historii; nie zmieniaj wersji składu automatycznie |
| `grupa_id` | Może zmienić zestaw dopłat i zakres działań na karnetach; sprawdź zachowanie dotychczasowych powiązań |
| Kwota główna albo dopłaty | Brak przeliczenia jednostek; sprawdź spójność powiązań i zwrotów. Zmiana samej ceny bez wpływu na te warunki nie musi blokować zakupu. |
| Metoda płatności / podział Mix | Brak nowego G; nie buduj drugiego rozliczania utargu. Kontroluj zmianę tylko w zakresie mającym wpływ na tożsamość lub stan zakupu. |
| Nowy zwrot lub zmiana skuteczności istniejącego zwrotu | Aktualizacja oceny źródła i wymagane rozstrzygnięcie; bez automatycznej proporcji jednostek |
| Usunięcie głównego wiersza | Zachowaj historię dodatku, zablokuj nowe korzystanie, sprawa do wyjaśnienia |
| Usunięcie / zmiana przypisanej dopłaty | Ten sam zakup do sprawdzenia; nie gub usuniętego wiersza przez filtr AKTYWNY |
| `rozliczone` przez księgową | Nie jest statusem wykonania zabiegów i nie jest licznikiem jednostek |

Migawka obejmuje utrwalone źródła finansowania, istotne pola i skuteczne zwroty do tych źródeł. Sprawdzaj stan absolutny również przy pierwszym imporcie, nie tylko różnicę względem wcześniejszego hasha. Wiersz już zwrócony, zakończony albo usunięty nie staje się prawidłowy dlatego, że właśnie utworzono jego pierwszą migawkę.

Hash jest narzędziem wykrywania różnic aktualnego stanu. Nie nazywaj go pełnym dziennikiem zmian rdzenia; zmiana i przywrócenie tych samych wartości między kontrolami mogą pozostać niewidoczne.

## 9. Docelowa ścieżka obsługi w Terminarzu

1. **Wybór klientki.** Najpierw pokazuj jej faktyczne, gotowe składniki zakupów. Dla każdego: nazwa usługi, „dostępne do umówienia”, „umówione”, ważność i identyfikacja konkretnego zakupu. Przy kilku zakupach podpowiedź może preferować najwcześniejszą ważność, ale musi respektować zgodność usługi i termin wizyty.
2. **Zakup wymaga przygotowania.** Pokaż powód i akcję odpowiednią do uprawnień: skład, dopłata, historia, istniejące wizyty lub zwrot. Nie udawaj „0 zabiegów”, gdy stan jest nieznany.
3. **Historia.** Osobno dla każdego składnika ustal wykonanie sprzed punktu odcięcia. Puste to nieznane. Nawet dzisiejsza data sprzedaży nie dowodzi zerowego wykorzystania: recepcja mogła sprzedać pakiet po pierwszym zabiegu.
4. **Już umówione wizyty.** Przydziel jednostki konkretnym pozycjom. Wykonanie już ujęte w historii nie może zostać ponownie odjęte przy powiązaniu starej wizyty.
5. **Zapis nowej wizyty.** Sprawdź dostępność pracownika/zasobów oraz jednostek i źródła. Rezerwacja jednostek i wizyta mają jeden spójny wynik. Ponowienie nie rezerwuje kolejnej sztuki.
6. **Seria.** Pokaż liczbę terminów i zapotrzebowanie per składnik. Przy niedoborze nie twórz po cichu brakujących praw; pokaż, które terminy mieszczą się w puli, i zastosuj uzgodniony jawny sposób zapisu serii.
7. **Wykonanie.** Potwierdzaj pozycje faktycznie wykonane. W wizycie z A i B wykonanie A nie zużywa B. „Przerwana” i nieobecność nie są automatycznie wykonaniem. Ewentualne potrącenie jest odrębną decyzją.
8. **Odwołanie / przełożenie.** Odwołanie bez potrącenia zwalnia R. Przełożenie zachowuje ten sam przydział przy ponownej kontroli źródła i ważności nowego terminu; nie tworzy nowego G ani U.
9. **Brak pakietu.** Stosuj istniejącą politykę salonu dotyczącą wizyt bez zakupu. Jeżeli dopuszcza usługę jednorazową, oznacz ją jednoznacznie i rozlicz w istniejącej Sprzedaży. Jeśli wymaga zakupu, odmów umówienia z puli i podaj przyczynę. Nie obchodź ograniczenia pustym źródłem.
10. **Zwykła sprzedaż `1×` po wykonaniu.** Może dokumentować tę wizytę, ale nie tworzy następnego zabiegu do wykorzystania. Powiązanie dokumentacyjne, jeśli jest obsługiwane, nie jest nowym przyznaniem jednostki. Terminarz sam nie uruchamia ponownej sprzedaży.
11. **Wpłata bez sprzedaży.** Komunikat: „Środki w portfelu: … zł. Nie ma jeszcze przypisanego zakupu zabiegów”. Kwotę pokazuj wyłącznie, jeśli ta informacja i uprawnienie są już przewidziane w produkcie; nie jest potrzebna do obliczenia salda jednostek.

Przykład stanu początkowego: 10 kupionych, 3 wykonane wcześniej i 6 przyszłych wizyt → 1 dostępny. Po wykonaniu jednej z tych 6 wizyt → 4 wykonane, 5 umówionych, nadal 1 dostępny.

## 10. Granica spójności z równoległą Sprzedażą

Nowy opis potwierdza, że zwrot jest niezależnym INSERT-em, a rdzeń nie korzysta z blokady salonu dodatku. Nie usuwa to problemu N06: zwrot może powstać po kontroli źródła, a przed zatwierdzeniem rezerwacji lub wykonania. Jedna recepcja ogranicza częstotliwość konfliktów organizacyjnie, ale nie jest gwarancją techniczną — pozostają inne karty, manager i ponowienia żądań.

W §11 pkt 6 nowego opisu wspomniano „decyzję właściciela”, lecz nie przytoczono jej treści. Jeśli istnieje już wyraźna, zapisana decyzja o dopuszczalnym opóźnieniu uzgadniania, przytocz ją z zakresem i zastosuj; nie pytaj właściciela ponownie o tę samą decyzję. Samo to zdanie nie określa czasu, gwarancji ani zgody na aktywację dowolnego wariantu.

W raporcie nazwij rozwiązanie zgodnie z jego rzeczywistą właściwością:

- **Spójność transakcyjna:** tylko jeśli rzeczywiste ścieżki obu zapisów mają udowodnioną koordynację i testy obu kolejności.
- **Wykrywanie i późniejsze uzgadnianie:** jeśli zwrot może wyprzedzić reakcję dodatku. Wskaż zakres pomiaru pełnego cyklu, zachowanie podczas awarii i dla wykonanej już usługi. Tick co 5 minut nie dowodzi maksymalnego czasu wykrycia.

Nie dopisuj zależności Sprzedaży od tabel, licencji ani blokad `trm:*`. Jeśli potrzebna jest minimalna zmiana rdzenia, wydziel ją jako osobny kontrakt z uzasadnieniem i wpływem na rdzeń bez dodatku. Pozostałe prace ZK-03.1 mogą być wykonywane niezależnie od rozstrzygnięcia N06. Uśpiona integracja nie wymaga udawania, że problem jest już rozwiązany.

## 11. Korekty dokumentacji i kwestie do sprawdzenia w kodzie

To zadania dla Claude mającego dostęp do repozytorium, a nie nowa lista pytań do właściciela.

1. **Popraw scenkę §10 opisu rdzenia.** W pierwszym przykładzie `P-2` jest dopłatą. W wariancie z dwoma egzemplarzami `P-1` i `P-2` nazwano wierszami głównymi, a `P-3` i `P-4` dopłatami; później zwrot do `P-2` znów opisano jako zwrot dopłaty. Rozdziel przykłady na osobne paragony. Zwrot ma wskazywać rzeczywistą dopłatę w danym zestawie danych. Nie poprawiaj tylko etykiety, pozostawiając sprzeczną relację.
2. **Pokaż rzeczywisty zapis dwóch powielonych ofert przy częściowym Portfelu.** Odtwórz go przez normalną ścieżkę UI/handlerów na izolowanej bazie. Wykaż, czy saldo portfela wyczerpuje się przy pierwszej pozycji, jak obsługiwane są dalsze i czy każda dostaje dopłatę. Opis nie rozstrzyga tych szczegółów; nie buduj fikstury wyłącznie na domyśle.
3. **Sprawdź semantykę zawieszenia.** Wymień zmieniane pola, zakres grupy i sposób wznowienia. Dopiero do tego podłącz ocenę dostępności jednostek.
4. **Potwierdź formaty identyfikatorów.** Ekstrakcja bazy paragonu ma rozróżniać pozycje sprzedaży i wiersze SPLIT; samo `LIKE '<baza>-%'` musi prawidłowo obsługiwać dopuszczalne znaki i granice identyfikatora. Nie zmieniaj schematu ID rdzenia dla potrzeb dodatku.
5. **Zweryfikuj korekty/soft delete zwrotów i dopłat.** Wskaż faktycznie dozwolone ścieżki; niewystępujących nie opisuj jako wdrożonych funkcji.
6. **Uzupełnij kontrakt źródeł.** `grupa_id` nie służy wyłącznie parowaniu dopłaty. Również rozróżnij wpłatę do `Zadatki` od głównej pozycji `Sprzedaz` opłaconej metodą Zadatek/Portfel. Ta sama nazwa w języku użytkownika nie oznacza tego samego rodzaju rekordu.

Opis zasad raportowania przychodu w nowym pliku nie jest w tym aneksie oceną księgową ani poleceniem przebudowy raportów. Dodatek nie potrzebuje liczyć przychodu, aby liczyć zabiegi. Jeżeli pomocniczy widok pokazuje podział metod, musi korzystać z istniejącego kontraktu rdzenia, bez dodawania wartości `mix` drugi raz.

## 12. Wpływ na dotychczasowe polecenia

| Dotychczasowy punkt | Co pozostaje / co doprecyzować |
|---|---|
| ZK-03.1 N01, N02 | Idempotencja i atomowość zakupu ze wszystkimi składnikami pozostają bez zmian. |
| N03 — dopłaty | Uzupełnij o powielone egzemplarze ze wspólną grupą, odrębne warianty i zakaz przypadkowego współdzielenia dopłaty. |
| N04, N05 | Historia i przypisanie wizyty do konkretnego zakupu pozostają bez zmian. Nowy opis potwierdza, że rdzeń nie ma potrzebnych liczników. |
| N06 — zwroty | „Pełny zwrot” oceniaj w całym prawidłowo powiązanym zakupie, nie wyłącznie wobec kwoty głównego wiersza. Każdy istotny zwrot wymaga oceny; żaden nie daje automatycznej proporcji zabiegów. Problem równoległości nadal wymaga rozstrzygnięcia. |
| N07, N08, N09 | Migracja, przerwa dodatku i postęp uzgadniania pozostają potrzebne; zwroty i sprzedaż mogą powstawać, gdy dodatek nie działa. |
| N10, N12 | Użyj zrozumiałych stanów: „Dostępne do umówienia”, „Umówione”, „Wykonane”, „Do sprawdzenia”, „Zwrot do wyjaśnienia”. Nie wymagaj od recepcji znajomości struktur bazy. |
| N11 — `1×` | Potwierdzona potrzeba indywidualnego wyjątku dla zabiegu kupionego na przyszłość, bez otwierania wszystkich dawnych sprzedaży. |
| Wcześniejsze hipotetyczne formaty | Nie buduj rat, należności, voucherów usługowych, fiskalizacji ani konwersji portfela. Nie implementuj hipotetycznego formatu „pięć technicznych wierszy to jeden pakiet”, jeśli nie występuje w kodzie i danych. |

## 13. Scenariusze odbioru po doprecyzowaniu

Identyfikatory RP są dodatkowymi przypadkami lub doprecyzowaniem istniejących Z31. Jeżeli istniejący test dowodzi dokładnie tego wyniku, wskaż go zamiast tworzyć duplikat. Próby przepływu pieniędzy służą wytworzeniu realistycznych źródeł na izolowanej bazie — nie zmianie modułu Sprzedaż.

| ID | Przypadek | Oczekiwany wynik |
|---|---|---|
| RP-01 | Ten sam pakiet: Gotówka / Karta / Przelew / Portfel / Mix | Taki sam skład jednostek, dokładnie jeden zakup dla każdego odrębnego źródła |
| RP-02 | Wpłata z opisem pakietu, bon, scalanie wpłat i `DEP-REST` | Zero nowych jednostek z samych rekordów pieniężnych |
| RP-03 | 1700 zł = 200 główny + 1500 dopłata | Jeden zakup 10×, kontrola obu wierszy, bez ponownego obciążenia portfela |
| RP-04 | Mix obejmuje Portfel; osobno dopłata z Mix | Brak dodatkowego G od splitów lub dopłaty; brak ponownego finansowego zapisu |
| RP-05 | Dwa egzemplarze 5A+4B ze wspólną grupą | Dwa zakupy, łącznie 10 A i 8 B; brak dodatkowego mnożnika grupy |
| RP-06 | Dwa powielone pakiety z częściowym Portfelem | Źródła utworzone rzeczywistą ścieżką rdzenia; właściwe powiązania albo jawna niejednoznaczność |
| RP-07 | 5× i 10× tej samej usługi na jednym paragonie | Dopłata nie trafia automatycznie do obu; jawny wybór trwa po odświeżeniu i przełożeniu |
| RP-08 | Dwóch managerów wskazuje tę samą dopłatę różnym zakupom | Co najwyżej jedno dopuszczalne powiązanie; drugi zapis odrzucony bez częściowych zmian |
| RP-09 | Zwrot całych 200 zł tylko z głównej części zakupu 1700 zł | Częściowy zwrot zakupu do wyjaśnienia, bez automatycznego wyzerowania puli |
| RP-10 | Zwrot 100 zł do dopłaty, kolejne zwroty oraz pełny zwrot zakupu | Właściwe źródło problemu; bez proporcji zł→jednostki; decyzja managera dotyczy aktualnego zestawu zwrotów |
| RP-11 | Zwrot / zakończenie istnieją przed pierwszym importem; osobno oferta 0 zł | Brak automatycznego udostępnienia problematycznego źródła; 0 zł nie jest samo w sobie pełnym zwrotem |
| RP-12 | Wycofanie jednostek przy przyszłych wizytach i wykonanej A w pakiecie A+B | Plan dla dotkniętych przydziałów, zachowane wykonanie; B nie jest automatycznie zużyte |
| RP-13 | G10, historia3, R6; następnie wykonanie jednej umówionej | B1, następnie U4/R5/B1; brak podwójnego odjęcia |
| RP-14 | Sprzedaż `1×` po wykonaniu; inna `1×` kupiona na przyszłość | Pierwsza bez nowych praw, druga kwalifikowana indywidualnie dokładnie raz |
| RP-15 | Przedłużenie / zawieszenie / zakończenie / ponowne otwarcie całej grupy | Każdy zakup sprawdzony osobno; brak automatycznego U=G lub odnowienia G |
| RP-16 | Zmiana daty, grupy, wariantu, klientki i usunięcie dopłaty | Rozpoznany rzeczywisty wpływ; brak utraty wcześniej powiązanego źródła lub cichego transferu |
| RP-17 | Zwrot pomiędzy sprawdzeniem a COMMIT-em | Test rzeczywistych writerów zgodny z N06; jawny wynik i granice gwarancji, nie fikcyjny PASS |
| RP-18 | Dodatek wyłączony / brak v2; następnie kontrolowane wznowienie po nowych sprzedażach i zwrotach | Rdzeń działa samodzielnie; brak zapisów jednostek w przerwie; po powrocie uzgodnienie bez ponownego G |

W próbach pozytywnych sprawdź także brak dodatkowych zapisów finansowych, prowizji, punktów i ruchów magazynowych wywołanych samą operacją Terminarza. Osobno sprawdź ponowienie importu oraz dwa salony z podobnymi identyfikatorami — izolacja i idempotencja są częścią istniejących wymagań, nie nowym zakresem.

## 14. Kolejność wykonania i wynik dla właściciela

1. Uporządkuj przykłady i kontrakt źródeł na podstawie kodu rdzenia; odtwórz rzeczywiste źródła przez istniejące ścieżki.
2. Zestaw aktualny stan N01–N12 z tym aneksem: już spełnione z dowodem / wymaga korekty / nierozstrzygnięte.
3. Popraw w dodatku relacje dopłat, zakres oceny zwrotu i reakcje na zmiany źródła. Nie przebudowuj Sprzedaży.
4. Zachowaj kolejność wcześniejszych etapów: poprawność danych ZK-03.1, następnie umawianie ZK-04, wykonanie ZK-05 i kontrolowane wznowienie ZK-06. Ekrany rozwijaj tylko w zakresie potrzebnym do tych ścieżek.
5. Uruchom związane regresje. Zamiast nowej pełnej baterii bez powodu wykorzystaj istniejące dowody i dodaj testy konkretnych różnic. Dla równoległości i zapisu wielu składników wymagany jest rzeczywisty silnik bazy.
6. Oddaj w `docs/terminarz-zakupy/` uaktualniony kontrakt źródeł oraz `ZAKUPY_SCIEZKI_PLATNOSCI_WYNIK.md`: commit, zmienione pliki, mapa wymagań do dowodów, RP-01–18 i odnośniki do pokrywających je Z31, otwarte kwestie, ograniczenia gwarancji oraz brak zmian finansowych rdzenia.

Nie twórz drugiego równoległego systemu rozliczeń. Wynikiem ma być ewidencja, która rozumie istniejące zakupy Estelio, pokazuje posiadane zabiegi przy umawianiu i rozlicza wykonanie właściwego składnika dokładnie raz.
