# Co zmieniła lektura pomocy

Wersja 0.2 · 01.11.2026. Źródła i rozbieżności: dokument 08.

| W poprzednim planie | W obecnym projekcie |
|---|---|
| Klientki, zadania i wyniki jako MVP; kasa i terminarz później | Pierwsza użyteczna wersja recepcyjna ma zamykać obsługę klientki: kartoteka, sprzedaż, portfel, historia i podsumowanie dnia. Dla salonu z terminarzem także pełny podstawowy przebieg wizyty. |
| Ogólny ekran listy zadań | Jedna lista z telefonami i czynnościami, odraczanie kontaktu, wynik rozmowy i powiązanie z klientką. |
| Zbyt szerokie prawa managera do kont | Kreator dostępów pozostaje u Admin/Megaadmin salonu. Manager zarządza pracą i analizą. |
| Recepcja bez korekt i zwrotów | Projekt zachowuje udokumentowane operacje recepcji; ograniczenia muszą wynikać z faktycznej polityki i serwera. Zwykła korekta, rzeczywisty zwrot i awaryjna edycja są osobnymi operacjami. |
| Jedna nieprecyzyjna nazwa „pakiet” | Saldo pieniężne, ważność karnetu i jednostki poszczególnych usług to odrębne dane. |
| Liczniki pakietów jako ogólny przyszły pomysł | Pomoc terminarza opisuje już przygotowanie i aktywację ewidencji. Projekt respektuje tryb modułu, mapowanie i stan każdego składnika. Stan wdrożenia sprawdza M00. |
| Nowe indywidualne logowanie jako domyślny wymóg | Zachowujemy znajomy wybór pracownika i PIN na zarejestrowanym urządzeniu; bezpieczeństwo wzmacniamy po stronie serwera. Nowe konta e-mail dla całego zespołu nie są założeniem. |
| Uniwersalny panel urządzeń managera | Każdy zarządza własnymi sesjami; nadawanie i odbieranie dostępu innym pozostaje przy uprawnieniach właściciela. |
| Ogólne „opłacona wizyta” | Rezerwacja, obecność/usługa i rozliczenie pokazane osobno. Akceptacja regulaminu nie jest potwierdzeniem wpłaty. |
| Audyt historyczny dominował nad opisem produktu | Aktualna pomoc jest bazą funkcjonalną; audyt jest listą punktów do ponownego sprawdzenia, nie diagnozą bieżącej produkcji. |

## Decyzja produktowa

Jedna aplikacja Estelio, dwa układy startowe, wspólne dane i reguły serwera. Recepcja potrzebuje sprawnego działania przy ladzie i telefonie; manager szybkiego rozpoznania wyniku i spraw wymagających decyzji. Nie kopiujemy wszystkich tabel WWW na mały ekran.

Makiety przedstawiają kierunek mobilny „lekki nowy”. Agenda jest pierwszym widokiem mobilnym w projekcie; to wybór UX, a nie twierdzenie, że obecny terminarz automatycznie zastępuje siatkę listą.
