# Mapa pomocy → projekt mobilny

Stan lektury: 01.11.2026. Źródła poniżej opisują bieżący produkt. Kolumna mobilna jest rekomendacją, nie opisem istniejącej aplikacji.

| Grupa funkcji i źródło | Miejsce w projekcie |
|---|---|
| [Pulpit i zadania](https://www.estelio.com.pl/pomoc/#zadania) | Start recepcji, filtrowane telefony i czynności; manager ma też zespół |
| [Sprzedaż](https://www.estelio.com.pl/pomoc/#sprzedaz), [zadatki](https://www.estelio.com.pl/pomoc/#zadatki), [zwroty](https://www.estelio.com.pl/pomoc/#zwroty) | Koszyk, podział płatności, historia i kontrolowany zwrot; jeden wspólny serwer |
| [Karnety](https://www.estelio.com.pl/pomoc/#karnety) i [kartoteka](https://www.estelio.com.pl/pomoc/#klienci) | Profil z odrębnymi sekcjami pieniędzy, ważności i jednostek |
| [Dokumenty](https://www.estelio.com.pl/pomoc/#dokumenty) i Foto | Kompletność/bezpieczny odczyt; aparat i dodawanie jako rozszerzenie |
| Magazyn, kosmetyki, inwentaryzacja | Więcej → Magazyn; stan do sprzedaży w R1, pełne operacje w R2 |
| Konsultacje, retencja, urodziny, zebrania, Esti | Więcej i kontekstowe zadania; dokładne formularze osobnymi odbiorami |
| [Role](https://estelio.com.pl/pomoc-manager/#role), [dostępy](https://estelio.com.pl/pomoc-manager/#dostepy) | Manager oddzielony od właściciela; role serwerowe |
| [Analiza](https://estelio.com.pl/pomoc-manager/#analiza), BI, koszty, targety | Przegląd managera → Analiza; zaawansowane raporty w R2 |
| Cennik, rabaty, sugestie, dodatki, dziennik, rozliczenia | Role i zakresy zachowane; rozbudowana administracja początkowo WWW |
| Klub, Foto, Link do płatności | Dodatki pracownika, zgodnie z aktywacją salonu; bez aplikacji klientki |
| [Widoki](https://estelio.com.pl/pomoc-terminarz#widoki), [telefon](https://estelio.com.pl/pomoc-terminarz#telefon), historia | Agenda i panel wizyty; szeroka siatka jako osobny odbiór tabletu |
| [Nowa wizyta](https://estelio.com.pl/pomoc-terminarz#nowa-wizyta), konflikty, zmiany | Formularz z dostępnymi terminami i ponowną kontrolą przy zapisie |
| [Trzy osie](https://estelio.com.pl/pomoc-terminarz#trzy-osie), obsługa, odwołanie, rozliczenie | Osobne stany i działania; widoczny skutek przed zatwierdzeniem |
| [Pakiety i zakupy](https://estelio.com.pl/pomoc-terminarz#pakiety-start) do uruchomienia ewidencji | Runtime mobilny respektuje konfigurację; masowe przygotowanie w WWW |
| [Szybka rezerwacja](https://estelio.com.pl/pomoc-terminarz#szybka-rezerwacja) | Oddzielny hold, dane bez kartoteki, ręczne potwierdzenie zadatku |
| [Sprawy](https://estelio.com.pl/pomoc-terminarz#powiadomienia), zmiany, porządki | Dzwonek i wynik sprawy; otwarcie nie jest rozwiązaniem |
| Konfiguracja, usługi, zasoby, grafik, nieobecności, e-mail | Manager; najpierw dostęp do WWW, potem wybrane mobilne czynności |

## Rozbieżności — obowiązkowy załącznik M00

| ID | Rozbieżność / niejasność | Decyzja projektowa do czasu dowodu |
|---|---|---|
| DOK01 | Pomoc managera: konta tylko Admin/Megaadmin; sekcja bezpieczeństwa pracownika mówi o managerze zakładającym konto | Nie nadajemy managerowi Kreatora dostępów; sprawdzić kod i ujednolicić instrukcję |
| DOK02 | Limity prób PIN różnią się w opisach logowania | Serwerowa polityka i testy do ustalenia; bez powielania różnych limitów w aplikacji |
| DOK03 | Bcrypt w aktualnej pomocy vs jawne PIN-y w dawnym audycie | Nie deklarujemy obecnej podatności ani naprawy bez dowodu |
| DOK04 | Wzmianki o wygasaniu sesji/restarcie vs wymaganie revokacji po zmianie PIN/roli | Sprawdzić rzeczywisty cykl wszystkich tokenów, także otwarty formularz |
| DOK05 | Szczegółowy rozdział ewidencji opisuje rezerwację/zużycie jednostek, ogólne „Zasady” mówią, że terminarz nie zużywa karnetu | Warunkowa logika aktywnego dodatku; wymagane testy bez podwójnego zużycia |
| DOK06 | Pakiety codziennie opisują potrącenie za nieobecność, rozdział odwołań odsyła decyzję do kartoteki | Rozdzielić odwołanie, nieobecność, potrącenie i pieniądze; potwierdzić flagę i dokładny trigger |
| DOK07 | Wstęp do trzech osi odkłada stany „do wpłaty”, późniejszy rozdział opisuje już szybki hold | Projekt zawiera hold; stan wdrożenia i zależność od dodatków do sprawdzenia |
| DOK08 | Agenda opisywana jako tydzień oraz ten sam dzień; telefon ma siatkę i dostęp do Agendy | Mobilnie proponujemy Agendę, zakres jawny; nie zmieniamy reguł na podstawie podpisu ilustracji |
| DOK09 | Odwracalne usuwanie/„anonimizacja” do 30 dni i ogólne deklaracje retencji | Odróżnić ukrycie, odzyskiwanie, scalanie i anonimizację; nie powielać jako gwarancji prawnej |
| DOK10 | Ogólne opisy wyniku/łącznie wydano mogą mieszać sprzedaż i portfel; „zaakceptowany link” sugeruje sukces | Potwierdzić formuły API; osobno wpływy, wartość usług, saldo i akceptacja regulaminu |

Dodatkowo sprawdzić, czy starsze skróty managera o przyszłych e-mailach/pakietach są nieaktualne wobec dedykowanej pomocy terminarza. Nie utożsamiać imienia wykonawcy/sprzedawcy z kontem PIN. Sprawdzić, czy rezerwacja „po grafiku” dopuszcza wyłącznie opisany wyjątek; nigdy obejścia zajętego sprzętu.

Nie wbudowujemy z przykładów pomocy uniwersalnych zasad prawnych o zadatkach, zwrotach, karach, zgodach ani retencji. Są potrzebne rzeczywiste zasady salonu i poprawnie opisane mechanizmy systemu.

## Integralność odczytanych źródeł

Strony zapisano lokalnie wyłącznie do analizy; pełnej treści pomocy nie powielamy w ZIP. Skróty SHA-256 identyfikują odczytaną wersję HTML, nie gwarantują daty wdrożenia funkcji.

- recepcja: `01a1a6ebfee9c815bd3dfd99a40cca7cf4d56793e127e0e4302f764f63e57c9b`.

- manager: `835206ce264232ea08cd50d005ba2773d473e82701ce33d26ce48a45cb641dfb`.

- terminarz: `d7c35cd8bc6ba5d9ced044363f77d5e3c53ca5e1d5f6ef1bbd0f5d6665d5a2e2`.
