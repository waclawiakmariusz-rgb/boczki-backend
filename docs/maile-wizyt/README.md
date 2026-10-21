# Powiadomienia e-mail dla klientek (potwierdzenie + przypomnienie)

Prośba właściciela z 21.10.2026: *„chciałbym, aby osoba, która jest zapisywana w terminarzu,
otrzymała email — powiadomienie o tym, że jest umówiona, oraz email dzień przed — przypominający.
Emaile mają być w stylistyce tego wprowadzającego mailingu dla nowych salonów."*

Polecenie dopisane po ustaleniach: **„pilnuj tylko, żebyś wysyłał tylko do właściwych osób"**.
Ten dokument opisuje, co to oznacza w kodzie.

## Zgrzyt na starcie: w kartotece nie było adresów

Tabela `Klienci` nie miała pola e-mail. Adresy istniały wyłącznie w **Rejestrze RODO**, w polu
„e-mail kontaktowy" — czyli w rejestrze zgód, do którego recepcja nie zagląda przy zwykłej pracy:

```
Boczki: 421 klientek w kartotece
         125 ma prawdziwy adres (w Rejestrze RODO; reszta wpisów to „nie dotyczy", puste, null)
         362 ma telefon
         180 adresów leży dodatkowo w imporcie z Booksy (niepowiązane z kartami)
```

Dlatego najpierw adres stał się **normalnym polem karty klientki**, a dopiero potem powstała wysyłka.
Bez tego 70% wiadomości nie miałoby dokąd pójść, a literówka w adresie nie miałaby gdzie być poprawiona.

## Co powstało

**1. Adres w kartotece** (`Klienci.email`, `Klienci.bez_maili`)
- pole w formularzu zakładania klientki i w oknie „Edytuj dane",
- adres i stan zgody widoczne w nagłówku profilu obok telefonu,
- wpis niebędący adresem jest odrzucany (`„nie dotyczy"` nie wróci do kartoteki),
- zmiana adresu trafia do notatek klientki i do Dziennika Zdarzeń,
- `bez_maili` = „klientka nie chce wiadomości o wizytach" — ma pierwszeństwo przed wszystkim,
- akcja `klienci_migruj_maile` przenosi adresy z Rejestru RODO do kartoteki: domyślnie **tylko liczy**,
  zapisuje dopiero z `wykonaj: true`, nigdy nie nadpisuje adresu już wpisanego ręcznie.

**2. Dwie wiadomości** (`routes/mailer.js`: `zbudujMailWizyty`, `wyslijMailWizyty`)
- stylistyka serii wprowadzającej: jasne logo Estelio na górze, pod nim nazwa salonu, karta z terminem, szeryfowe tytuły,
- **nadawcą jest salon**, nie Estelio: `„Boczki na bok" <kontakt@estelio.com.pl>`, a odpowiedź
  (Reply-To) leci na adres salonu z licencji — klientka widzi swój salon i ma gdzie odpisać,
- stopka: nazwa, adres i telefon salonu + zdanie o rezygnacji,
- temat: `Potwierdzenie wizyty — piątek, 23 października 2026, godz. 14:00`.

**3. Wysyłka** (`routes/maile-wizyt.js`)
- potwierdzenie: zaraz po zapisaniu wizyty, w tle — żaden problem z pocztą nie opóźni umawiania,
- przypomnienie: przebieg co godzinę sprawdza, czy wybiła godzina ustawiona przez salon
  (domyślnie 18:00) i wysyła na wizyty **jutrzejsze**,
- dziennik wysyłek z adresem i odpowiedzią serwera pocztowego.

**4. Ustawienia salonu** — Terminarz → Ustawienia → **Powiadomienia e-mail** (tylko manager):
przełącznik główny, osobno potwierdzenia i przypomnienia, godzina, wysyłka próbna na wskazany adres,
dziennik ostatnich wysyłek i licznik „do ilu klientek to w ogóle dotrze".

## „Tylko do właściwych osób" — dziesięć bezpieczników

1. Adres **wyłącznie** z karty klientki przypisanej do tej rezerwacji. Nigdy z Rejestru RODO,
   nigdy z importu Booksy, nigdy „po nazwisku" (dwie Anny Nowak = mail pod zły adres).
2. Adres musi wyglądać na adres — wpisy w rodzaju „nie dotyczy" odpadają.
3. `bez_maili` = cisza.
4. Karta usunięta, zanonimizowana albo oznaczona jako zmarła = cisza.
5. Wizyta odwołana, odrzucona, wygasła = brak przypomnienia.
6. Rezerwacja techniczna (bez klientki) = cisza.
7. Każde zapytanie ma `tenant_id` w `WHERE` — wiadomość nie może wyjść „z cudzego salonu".
8. Idempotencja: `UNIQUE(tenant_id, rezerwacja_id, typ)` rezerwowany **przed** wysyłką.
9. Dwa przełączniki naraz: globalny (`MAILE_WIZYT` = off | proba | on, domyślnie **off**)
   i per salon (domyślnie **wyłączony**).
10. Każda próba — udana czy nie — ląduje w dzienniku z powodem.

## Próba (izolowane środowisko, tryb `proba`)

```
zapis adresu w karcie klientki:            success
próba wpisania „nie dotyczy":              error — To nie wygląda na adres e-mail.
ustawienia salonu: {"wlaczone":true,"potwierdzenia":true,"przypomnienia":true,"godzina":18}
pokrycie kartoteki: {"wszystkie":15,"z_adresem":1,"bez_zgody":0}

umówiono Julia Wiśniewska   10:00 → wizyta 126
umówiono Klaudia Szymańska  11:30 → wizyta 127

[maile-wizyt] PRÓBA — wysłałbym „potwierdzenie" do julia.test@example.pl (wizyta 126, 2026-10-24 10:00)
[maile-wizyt] pomijam potwierdzenie dla wizyty 127: brak adresu e-mail w kartotece
```

Czyli: wiadomość powstała dla klientki z adresem, a dla tej bez adresu system **powiedział dlaczego**
zamiast szukać adresu gdzie indziej.

Testy: `tests/maile-wizyt.test.js` (24) — komplet powodów odmowy, oba przełączniki, idempotencja,
błąd SMTP (rezerwacja wycofana), godzina przypomnień, treść obu wiadomości. Pełny zestaw: **739/739**.

| Plik | Co widać |
|---|---|
| `mail-potwierdzenie.png` | potwierdzenie wizyty tak, jak zobaczy je klientka |
| `mail-przypomnienie.png` | przypomnienie dzień wcześniej |
| `ustawienia-salonu.png` | Terminarz → Ustawienia → Powiadomienia e-mail |
| `karta-klientki.png` | adres i zgoda w karcie klientki |

## Zanim cokolwiek wyjdzie do prawdziwej klientki

1. `MAILE_WIZYT=proba` na produkcji → w logu widać, **do kogo** poszłoby, bez wysyłki.
2. Wysyłka próbna z panelu na własny adres — sprawdzenie wyglądu w prawdziwej skrzynce.
3. Dopiero potem `MAILE_WIZYT=on` i przełącznik w salonie.
4. Adresy: uruchomić `klienci_migruj_maile` (najpierw podgląd, potem zapis).

## Czego jeszcze nie ma

Wiadomości o **odwołaniu i przeniesieniu** wizyty — ustaliliśmy, że to drugi etap.

---

## Przewodnik ze zrzutami (21.10.2026)

Na pytanie „czy jest jakaś grafika, makieta, gdzie zobaczę, jak to wygląda i gdzie się klika"
powstała osobna strona: **`/pomoc-maile`** (plik `public/pomoc-maile-wizyt.html`).

Zawiera:

- obie wiadomości tak, jak zobaczy je klientka (zrzuty z prawdziwego szablonu),
- **krok 1**: karta klientki ze zrzutem okna „Edytuj dane" i numerowanymi znacznikami
  (adres, „nie chce wiadomości", zapis),
- **krok 2**: Terminarz → Ustawienia → Powiadomienia e-mail — pięć znaczników: przełącznik główny,
  potwierdzenia i przypomnienia osobno, godzina, adres do próbki, przycisk próbki,
- **krok 3**: dziennik wysyłek i co odpowiedzieć na „nie dostałam żadnej wiadomości",
- tabelę **„kto nie dostanie wiadomości"** z powodami,
- sekcję o dwóch przełącznikach i kolejności uruchamiania.

Strona jest podlinkowana w panelu admina (Pomoc i dokumenty → Dla salonu). Sprawdzone:
`/pomoc-maile` → 200, wszystkie zrzuty → 200.

| Plik | Co widać |
|---|---|
| `przewodnik-krok1.png` | krok 1 przewodnika: znaczniki na polu e-mail, zgodzie i zapisie |
| `przewodnik-krok2.png` | krok 2: pięć znaczników na ustawieniach powiadomień |
