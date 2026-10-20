// routes/maile-wprowadzajace-tresc.js — TREŚĆ serii powitalnej. Tu i tylko tu zmienia się teksty.
//
// Ten plik nie zawiera żadnej logiki: to siedem wiadomości zapisanych po ludzku. Można go edytować
// bez obawy, że coś przestanie działać — harmonogram, bezpieczniki i wysyłka siedzą obok, w
// routes/maile-wprowadzajace.js, a wygląd w routes/mailer.js (zbudujMailWprowadzajacy).
//
// Budowa jednej wiadomości:
//   etap        — identyfikator techniczny; NIE zmieniać po uruchomieniu serii (po nim system wie,
//                 co już wysłał; zmiana = ktoś dostanie ten sam mail drugi raz)
//   okno        — [od, do) w dniach od założenia salonu; mail wychodzi w tym przedziale
//   temat       — temat wiadomości (to widać na liście w skrzynce)
//   preheader   — druga linijka podglądu w skrzynce, zaraz po temacie
//   naglowek    — pierwsze zdanie w treści, pogrubione
//   wstep       — 2–3 zdania: po co to komu, zanim zacznie czytać kroki
//   sekcje      — [tytuł, treść] — tyle, ile trzeba; to jest mięso wiadomości
//   zrzut       — { plik, podpis } albo null; plik z /pomoc-zrzuty/ (ten sam, co w przewodniku)
//   uwaga       — { tytul, tekst } — ramka „na co uważać"; częsty błąd albo pułapka
//   dzis        — jedna konkretna rzecz do zrobienia dziś
//   cta         — napis na przycisku
//   kotwica     — rozdział przewodnika /pomoc/ (id sekcji), do którego prowadzi przycisk
//   link_wlasny — gdy przycisk ma iść gdzie indziej niż /pomoc/#kotwica
'use strict';

const SERIA = [
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'start',
    okno: [1, 4],
    temat: 'Pierwszy dzień z Estelio — zacznijmy od trzech rzeczy',
    preheader: 'PIN-y zamiast wspólnego hasła, pulpit zamiast zeszytu i jedna rzecz, którą warto zrobić dziś.',
    naglowek: 'Zacznijmy od trzech rzeczy, nie od wszystkiego naraz',
    wstep: 'Salon jest założony i system czeka pusty — to normalne i celowe. Estelio nie zgaduje, ile trwa u Ciebie zabieg ani kto pracuje we wtorki. Pierwsze trzy rzeczy zajmą kwadrans i sprawią, że reszta zacznie mieć sens.',
    sekcje: [
      ['Login salonu wpisujesz raz, potem pracują PIN-y',
       'Login i hasło to dane <strong>salonu</strong> — wpisuje się je raz na danym komputerze czy tablecie. Potem każda osoba wchodzi swoim 4-cyfrowym PIN-em, wybierając siebie z listy. To nie jest formalność: PIN jest podpisem pod operacją. W historii sprzedaży, przy każdej zmianie karnetu i w dzienniku zdarzeń widnieje konkretne imię. Dlatego nie warto pracować na wspólnym koncie „recepcja" — gdy coś się nie zgadza, nie da się odtworzyć, kto co kliknął.'],
      ['Rola decyduje, co ktoś widzi w menu',
       'Są trzy role. <strong>Recepcja</strong> ma sprzedaż, klientki i zadatki. <strong>Kosmetolog</strong> widzi swoje wizyty i sprzedaż, ale nie ogląda wyników finansowych salonu. <strong>Manager</strong> dostaje dodatkowo Analizę i Administrację. Rolę nadajesz w Administracja → Dostępy i możesz ją zmienić w każdej chwili — nikt nie traci przez to historii swojej pracy.'],
      ['Pulpit odpowiada na pytanie „co dziś?"',
       'Po zalogowaniu widzisz cztery liczby: utarg dnia, liczbę transakcji, liczbę klientek i średnią wartość transakcji. Pod spodem zadania zespołu (z terminami i priorytetem), a niżej skróty do rzeczy, które robi się najczęściej. Jeśli ktoś z zespołu pyta „co mam dziś zrobić", odpowiedź jest na tym ekranie, nie w głowie managera.'],
      ['Dane, których system nie wymyśli za Ciebie',
       'Cennik, zespół i — jeśli będziesz chciała umawiać wizyty — godziny otwarcia. Cennik wpisuje się raz w Administracja → Zabiegi i od tej chwili ta sama pozycja trafia na paragon, do terminarza i do analizy. Jedna lista, nie trzy.'],
    ],
    zrzut: { plik: 'pom-03-pulpit.png', podpis: 'Pulpit po zalogowaniu: liczby dnia, zadania zespołu i szybkie przejścia do najczęstszych akcji.' },
    uwaga: {
      tytul: 'Najczęstszy błąd pierwszego dnia',
      tekst: 'Jedna osoba zakłada konto, podaje PIN koleżankom i wszyscy pracują „jako manager". Po tygodniu nie wiadomo, kto wystawił paragon na złą klientkę. Dodanie drugiej osoby zajmuje 30 sekund — Administracja → Dostępy → Dodaj.',
    },
    dzis: 'Dodaj do systemu jedną osobę z zespołu i nadaj jej rolę.',
    cta: 'Zobacz rozdział o logowaniu',
    kotwica: 'logowanie',
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'sprzedaz',
    okno: [3, 8],
    temat: 'Pierwsza sprzedaż — i dlaczego warto wpisywać wszystko',
    preheader: 'Cztery informacje na paragon, rozliczenie zmiany w jednym ekranie i co zrobić z pomyłką.',
    naglowek: 'Najczęstsza rzecz, którą będziecie robić',
    wstep: 'Rejestracja sprzedaży to serce Estelio — z niej biorą się liczby w analizie, stany magazynu, salda karnetów i punkty w Klubie. Jeden wpis zasila wszystko naraz, więc im mniej dziur, tym więcej system potrafi Ci powiedzieć.',
    sekcje: [
      ['Cztery informacje, resztę system liczy sam',
       'Kto sprzedał, komu, co i jaką metodą zapłacono. Kwota podpowiada się z cennika, więc nie trzeba jej pamiętać ani liczyć w głowie. Jeden paragon może mieć kilka pozycji — zabieg, kosmetyk i zadatek obok siebie, tak jak w rzeczywistości.'],
      ['Trzy rodzaje pozycji',
       '<strong>Zabieg</strong> — to, co wykonałyście w gabinecie. <strong>Detal</strong> — kosmetyk albo suplement z magazynu; po zapisaniu sztuka schodzi ze stanu automatycznie, nie trzeba tego robić drugi raz. <strong>Zadatek</strong> — pieniądze wpłacone z góry, które trafiają do portfela klientki i czekają na rozliczenie.'],
      ['Płatność mieszana jest normalna',
       'Klientka płaci część kartą, część gotówką albo dopłaca do karnetu — wybierasz „Mix" i rozbijasz kwotę. W podsumowaniu dnia i w analizie te części trafiają do właściwych kategorii, więc utarg zgadza się z terminalem i kasetką.'],
      ['Zamknięcie zmiany: dwa ekrany',
       '<strong>Dzisiejsza sprzedaż</strong> to lista dzisiejszych paragonów — po niej przechodzi się wzrokiem przed wyjściem. <strong>Podsumowanie</strong> pokazuje utarg rozbity na gotówkę, kartę, BLIK i przelew. To są liczby, które porównujesz z terminalem; jeśli się nie zgadzają, różnicę widać od razu, a nie po miesiącu.'],
      ['Pomyłka to nie katastrofa',
       'Źle wpisany paragon poprawia się w Historii sprzedaży. Zwrot nie kasuje pierwotnego wpisu — powstaje nowy, ujemny, z dzisiejszą datą, dzięki czemu raporty z zamkniętych dni zostają nietknięte. Każda poprawka zapisuje się w dzienniku zdarzeń z nazwiskiem i godziną.'],
    ],
    zrzut: { plik: 'pom-04-sprzedaz-formularz.png', podpis: 'Wypełniony formularz: sprzedawca, klientka, pakiet z cennika, metoda płatności i kwota wyliczona automatycznie.' },
    uwaga: {
      tytul: 'Na co uważać',
      tekst: 'Sprzedaż bez wskazanej klientki wchodzi do utargu, ale nie trafia do jej kartoteki — nie zobaczysz jej potem w historii wizyt, karnet się nie naliczy, punkty w Klubie też nie. Jeśli klientka jest nowa, dodaj ją jednym kliknięciem z poziomu paragonu.',
    },
    dzis: 'Wpisz jedną prawdziwą sprzedaż i zamknij dzień Podsumowaniem.',
    cta: 'Zobacz rozdział o sprzedaży',
    kotwica: 'sprzedaz',
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'klienci',
    okno: [6, 11],
    temat: 'Kartoteka klientek — pamięć salonu, nie zeszyt',
    preheader: 'Profil, notatki, zgody RODO i podpowiedzi sprzedażowe, które widzi też nowa osoba na zmianie.',
    naglowek: 'Żeby nikt nie musiał pamiętać wszystkiego',
    wstep: 'Kartoteka jest po to, żeby wiedza o klientce nie siedziała w głowie jednej osoby. Nowa dziewczyna na zmianie ma otworzyć profil i w pięć sekund wiedzieć to, co koleżanka pamięta od dwóch lat.',
    sekcje: [
      ['Co widać w profilu',
       'Historia wizyt i zakupów, suma wydatków, liczba wizyt, dostępne środki w portfelu, karnety z datami ważności, dokumenty i zgody. Obok — podpowiedź, co tej konkretnej klientce zaproponować, zbudowana z tego, co już u Was kupowała.'],
      ['Notatka jest dla całego zespołu',
       '„Skóra wrażliwa — niższa moc na pierwszym zabiegu", „woli popołudnia", „przyprowadziła koleżankę z polecenia". Notatka wyświetla się na samej górze profilu, więc trudno ją przeoczyć. To najtańsza rzecz, jaką można zrobić dla jakości obsługi.'],
      ['Ostrzeżenie to osobne narzędzie',
       'Gdy klientka dwa razy nie przyszła bez odwołania, ustawiasz ostrzeżenie — pokaże się przy jej nazwisku i przy umawianiu wizyty. Dzięki temu recepcja wie, żeby poprosić o zadatek, i nie musi pytać managera.'],
      ['Zgody RODO przy kliencie, nie w segregatorze',
       'Widać, co zostało podpisane, kiedy i przez kogo przyjęte: zgoda na wizerunek, na kontakt telefoniczny, na newsletter. Przy kontroli albo przy pytaniu klientki „czy ja się na to zgadzałam" masz odpowiedź w profilu, a nie w szufladzie.'],
      ['Usuwanie klientki ma cztery różne znaczenia',
       'Duplikat kartoteki, prośba o usunięcie danych (RODO), osoba zmarła i osoba problematyczna to cztery różne sytuacje i system traktuje je osobno. Nic nie znika nieodwracalnie przez przypadek — historia sprzedaży zostaje, bo to dokument finansowy.'],
    ],
    zrzut: { plik: 'pom-36-klient-profil.png', podpis: 'Profil klientki: notatka recepcji, środki w portfelu, liczba wizyt, suma wydatków, zbliżające się urodziny i podpowiedź sprzedażowa.' },
    uwaga: {
      tytul: 'Dwie klientki o tym samym nazwisku',
      tekst: 'Zanim dodasz nową kartotekę, wpisz w wyszukiwarkę trzy pierwsze litery nazwiska. Dwie „Anny Nowak" to dwie historie zabiegów, dwa karnety i dwa portfele — a scalanie kartotek po fakcie jest zawsze trudniejsze niż jedno sprawdzenie.',
    },
    dzis: 'Dopisz notatkę przy trzech klientkach, które znasz najlepiej.',
    cta: 'Zobacz rozdział o kartotece',
    kotwica: 'klienci',
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'zadatki',
    okno: [10, 15],
    temat: 'Zadatki i karnety — koniec sporów o to, ile zostało',
    preheader: 'Portfel klientki, pakiety z datą ważności i odpowiedź na „ja pamiętam, że miałam jeszcze trzy".',
    naglowek: 'Pieniądze i zabiegi opłacone z góry',
    wstep: 'To miejsce, w którym salony tracą najwięcej nerwów i pieniędzy. Zadatek to wpłata przed zabiegiem, karnet to pakiet opłacony z góry. Estelio pilnuje obu, ale tylko wtedy, gdy wpiszecie je w momencie przyjęcia pieniędzy, a nie „później, jak będzie chwila".',
    sekcje: [
      ['Portfel klientki',
       'Zadatek wpłacony przy rezerwacji trafia do portfela. Przy rozliczeniu wizyty wybierasz płatność „Portfel" i kwota schodzi automatycznie — nie trzeba niczego odejmować ręcznie ani szukać karteczki. W profilu zawsze widać, ile środków zostało.'],
      ['Karnet ma datę ważności i to jest umowa',
       'Pakiet („Endermologia 10x", „Oczyszczanie 4x") ma w cenniku własną pozycję i okres ważności. Data liczy się od sprzedaży i jest widoczna przy karnecie — zarówno dla Was, jak i przy rozmowie z klientką. To ucina dyskusje typu „przecież kupiłam w zeszłym roku".'],
      ['Lista wygasających karnetów',
       'W kartotece jest zakładka „Wygasające karnety". Telefon tydzień przed terminem to rozmowa o umówieniu wizyty. Telefon tydzień po terminie to rozmowa o reklamacji. Ta jedna lista zamienia drugą rozmowę w pierwszą.'],
      ['Bon podarunkowy to też zadatek',
       'Kupon dla mamy na święta wpisujesz jako zadatek oznaczony jako bon. Gdy obdarowana przyjdzie, rozliczasz wizytę z portfela — bez liczenia na kartce, kto komu co podarował.'],
      ['Jeśli używacie Terminarza, liczenie robi się samo',
       'Z dodatkiem „Rozliczanie pakietów" system przy umawianiu pokazuje, ile zabiegów klientka wykorzystała, ile ma już umówionych i ile zostało do umówienia. Po potwierdzeniu wykonania odejmuje dokładnie jeden — nie dwa, nie zero.'],
    ],
    zrzut: { plik: 'pom-07-zadatki.png', podpis: 'Spis zadatków: kto wpłacił, ile, na co i czy środki są jeszcze dostępne.' },
    uwaga: {
      tytul: 'Zadatek wpisany „później" to zadatek stracony',
      tekst: 'Najczęstszy scenariusz: klientka wpłaca 200 zł gotówką, recepcja chowa je do kasetki i obiecuje wpisać po zmianie. Dzień się kończy, wpisu nie ma, a za trzy tygodnie nikt nie pamięta. Wpisanie zajmuje 15 sekund przy klientce.',
    },
    dzis: 'Sprawdź w kartotece, czy któryś karnet wygasa w tym miesiącu.',
    cta: 'Zobacz rozdział o zadatkach',
    kotwica: 'zadatki',
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'magazyn',
    okno: [14, 19],
    temat: 'Magazyn — żeby krem nie skończył się w środę',
    preheader: 'Detal kontra profesja, minimum przy produkcie, daty ważności i raport „co zamówić".',
    naglowek: 'Zapas, który pilnuje się sam',
    wstep: 'Magazyn w Estelio dzieli się na dwie rzeczy: <strong>detal</strong> — to, co sprzedajecie klientkom, i <strong>profesję</strong> — to, czego zużywacie w gabinecie. Ten podział nie jest kosmetyczny: detal schodzi ze stanu przy sprzedaży, profesja przy inwentaryzacji.',
    sekcje: [
      ['Minimum to cała magia',
       'Przy każdym produkcie ustawiasz, ile sztuk to już za mało. Gdy stan spadnie poniżej, produkt trafia do raportu „Co zamówić?". Nie trzeba o tym pamiętać ani chodzić z kartką po zapleczu — wystarczy raz w tygodniu otworzyć jeden ekran.'],
      ['Daty ważności działają w drugą stronę',
       'Produkt, któremu zostały mniej niż dwa miesiące, też trafia do raportu — jako rzecz do zużycia priorytetowo, nie do zamówienia. To jest realna oszczędność: preparat wyrzucony po terminie to pieniądze wyrzucone dosłownie.'],
      ['Sprzedaż detalu zdejmuje sztukę automatycznie',
       'Przy paragonie wybierasz DETAL i produkt z listy — system pokazuje, ile jest dostępnych, i po zapisaniu zmniejsza stan. Żadnego drugiego wpisu „do magazynu".'],
      ['Inwentaryzacja to porównanie, nie przepisywanie',
       'Robisz spis z natury i wpisujesz, ile faktycznie leży na półce. System pokazuje różnicę wobec swojego stanu i zapisuje, kto i kiedy liczył. Przy profesji to jedyny sposób, żeby stan był prawdziwy.'],
      ['Podpowiedzi sprzedażowe',
       'Do zabiegu można przypisać produkt i argument („po mezoterapii skóra wymaga ochrony SPF przez dwa tygodnie"). Podpowiedź wyświetli się w profilu klientki przy rozliczeniu — recepcja nie musi pamiętać, co do czego pasuje.'],
    ],
    zrzut: { plik: 'pom-14-co-zamowic.png', podpis: 'Raport „Co zamówić?": stany krytyczne i produkty z kończącą się datą ważności, w jednym miejscu.' },
    uwaga: {
      tytul: 'Dwa takie same opakowania to dwa wpisy',
      tekst: 'Jeśli kupujesz ten sam preparat w dwóch partiach z różnymi datami ważności, wprowadź je jako dwie dostawy. System zużywa je w kolejności dat — najpierw to, co się szybciej przeterminuje. Jeden zbiorczy wpis tę informację gubi.',
    },
    dzis: 'Wpisz pięć produktów z półki i ustaw im minimum.',
    cta: 'Zobacz rozdział o magazynie',
    kotwica: 'magazyn',
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'terminarz',
    okno: [18, 24],
    temat: 'Terminarz — kalendarz, który zna Wasz cennik i sprzęt',
    preheader: 'Grafik zespołu, gabinety i urządzenia, umawianie bez konfliktów i rozliczenie w zwykłej Sprzedaży.',
    naglowek: 'Wizyty w tym samym systemie, bez przepisywania danych',
    wstep: 'Terminarz to bezpłatny dodatek Estelio+. Nie jest osobnym programem obok: wizyta wskazuje klientkę z Waszej kartoteki, usługę z Waszego cennika i osobę z Waszego zespołu, a po zabiegu przechodzi do zwykłej Sprzedaży. Konfiguracja zajmuje kwadrans i robi się ją raz.',
    sekcje: [
      ['Co odróżnia go od zwykłego kalendarza',
       'Estelio wie, że endermologia trwa 60 minut, potrzebuje gabinetu i konkretnego urządzenia, a wykonują ją dwie osoby z zespołu. Przy umawianiu sprawdza cały komplet naraz. Wolna kosmetolożka przy zajętym aparacie to nie jest wolny termin — i system to powie, zanim klientka odłoży słuchawkę.'],
      ['Jedna wizyta, trzy niezależne informacje',
       'Rezerwacja (czy termin stoi), obecność (czy klientka przyszła) i wykonanie (czy zabieg się odbył) to trzy osobne rzeczy. Dzięki temu „klientka przyszła, ale zabieg przerwano" albo „zabieg wykonany, jeszcze nierozliczony" to normalne, czytelne stany, a nie improwizacja z kolorami w zeszycie.'],
      ['Odwołanie i nieobecność to nie to samo',
       'Odwołanie zwalnia termin i nie zużywa jednostki karnetu. Nieobecność potwierdza człowiek — dopiero wtedy, i tylko jeśli salon tak ustawił, zabieg z pakietu przepada. System niczego nie zgaduje i nie karze klientki automatycznie.'],
      ['Przekładanie bez utraty śladu',
       'Stary termin trzyma się do chwili, aż nowy zostanie poprawnie zatwierdzony. W historii wizyty zostaje, kto i kiedy przełożył oraz z jakiego powodu. Przy sporze z klientką to jest cała rozmowa.'],
      ['Dzwonek zbiera to, co wymaga działania',
       'Wizyta bez wpisanego wyniku, przełożony termin do potwierdzenia, przerwany zabieg — trafiają do centrum spraw przy dzwonku, z priorytetem i właścicielem. Nic nie wisi „gdzieś w pamięci recepcji".'],
    ],
    // Ten zrzut należy do przewodnika Terminarza, nie do głównego — stąd pełna ścieżka.
    // Bez niej adres wskazywał na /pomoc-zrzuty/trm-09-widok-dzien.png, gdzie nic nie leży (404).
    zrzut: { plik: '/pomoc-terminarz/trm-09-widok-dzien.png', podpis: 'Widok dnia: kolumna na każdą osobę, liczniki u góry i kolory stanów na kartach wizyt.' },
    uwaga: {
      tytul: 'Pusty kalendarz to nie błąd',
      tekst: 'Dopóki nie wpiszecie czasu trwania zabiegów i grafiku zespołu, terminarz nie pokaże żadnych wolnych godzin — bo ich nie zna. To jest celowe: lepszy pusty kalendarz niż taki, który obiecuje termin, którego nie ma.',
    },
    dzis: 'Włącz dodatek i wpisz godziny otwarcia salonu.',
    cta: 'Otwórz przewodnik Terminarza',
    kotwica: 'terminarz',
    link_wlasny: '/pomoc-terminarz/',
  },

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    etap: 'liczby',
    okno: [23, 30],
    temat: 'Liczby salonu — zysk, a nie tylko obrót',
    preheader: 'Analiza dnia, miesiąca i roku, koszty, cele dla zespołu i audyt, który pokazuje, co naprawdę zarabia.',
    naglowek: 'Trzy tygodnie danych to już obraz, nie przypadek',
    wstep: 'Macie za sobą kilka tygodni wpisów, więc Analiza zaczyna mówić coś sensownego. To moduł wyłącznie dla Ciebie i managera — recepcja ani kosmetolog go nie widzą, więc można tam patrzeć spokojnie.',
    sekcje: [
      ['Cztery poziomy tej samej prawdy',
       '<strong>Dzień</strong> — utarg i rozbicie na metody płatności, do zamknięcia kasy. <strong>Miesiąc</strong> — przychód, wykres dzień po dniu, najlepsze zabiegi i osoby. <strong>Rok</strong> — sezonowość: który miesiąc jest mocny, a który trzeba ratować promocją. <strong>Pracownik</strong> — wynik jednej osoby, bez ręcznych zestawień.'],
      ['Bez kosztów zysk jest fikcją',
       'Czynsz, media, wynagrodzenia, preparaty, leasing sprzętu — wpisujesz raz w miesiącu w Analiza → Koszty. Dopiero wtedy liczba „zarabiasz X" znaczy cokolwiek. Bez tego to obrót, czyli połowa historii.'],
      ['Audyt pełny: co naprawdę zarabia',
       'Rozkłada obrót na usługi i produkty, pokazuje udział każdej pozycji i ile z niej zostaje w salonie. Zwykle to właśnie tutaj widać, że najpopularniejszy zabieg nie jest tym najbardziej opłacalnym.'],
      ['Cele, które liczą się same',
       'Wpisujesz cel miesięczny dla osoby, a realizację system wylicza z paragonów. Pracownik widzi swój wynik bez pytania o niego, a Ty nie prowadzisz arkusza obok.'],
      ['Zebranie w jednym ekranie',
       'Widok „Zebranie" zbiera liczby, o których i tak rozmawiacie na odprawie. Zamiast przepisywać je wieczorem do notatek, otwierasz jeden ekran przy zespole.'],
    ],
    zrzut: { plik: 'pom-21-analiza-miesiac.png', podpis: 'Podsumowanie miesiąca: przychód, podział na metody płatności, sprzedaż dzień po dniu i ranking pracowników.' },
    uwaga: {
      tytul: 'Liczby są tak dobre, jak wpisy',
      tekst: 'Jeśli część sprzedaży idzie „na boku kartki", analiza pokaże salon mniejszy niż jest naprawdę — i na tej podstawie podejmiesz złą decyzję o promocji albo o zatrudnieniu. To jedyny moduł, który nie wybacza dziur w danych.',
    },
    dzis: 'Wpisz koszty stałe za ostatni miesiąc: czynsz, media, wynagrodzenia.',
    cta: 'Zobacz rozdział o analizie',
    kotwica: 'analiza',
  },
];

module.exports = { SERIA };
