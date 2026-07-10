# Plan dodatku „Klub" — system lojalnościowy Estelio

*Wersja 1.0, 2026-07-10. Na bazie analizy starej apki Gemini (design/makiety/gemini-apka/) — koncept UX przeniesiony, fundamenty techniczne zbudowane od nowa na stacku Estelio.*

---

## 1. Wizja produktu

**Płatny dodatek Estelio** (`feature_key: lojalnosc`) składający się z dwóch części:

1. **Aplikacja klienta „Klub"** — PWA instalowalna z przeglądarki (ekran główny telefonu), z brandingiem salonu. Klient widzi punkty, nagrody, promocje, swoją kartę QR.
2. **Integracja w panelu Estelio** — kadra widzi punkty w profilu klienta, wydaje nagrody, skanuje karty QR, konfiguruje zasady/nagrody/promocje, ogląda statystyki.

**Kluczowa przewaga nad starą apką:** punkty naliczają się **automatycznie z paragonów** (hook w sprzedaży). Recepcja nie musi niczego klikać — znika problem „niekompletnej kadry", który zabił poprzednie podejście. Ręczne akcje punktowe (opinia Google, polecenie) zostają jako uzupełnienie.

**Model biznesowy:** miesięczna opłata przez istniejący mechanizm dodatków (Features_Catalog → Stripe subscription item, routes/features.js — zero nowej infrastruktury billingowej). Pilot: Boczki z ukrytym wpisem w katalogu (wzorzec platnosc_link).

**Ścieżka do sklepów (Play/App Store):** Faza 6, opcjonalna. PWA pakuje się w Capacitor/TWA bez wyrzucania kodu. Koszty: Google Play 25 USD jednorazowo, Apple 99 USD/rok. Nie blokuje startu.

---

## 2. Architektura

```
┌─ public/klub/            PWA klienta (statyczne pliki, vanilla JS jak reszta Estelio)
│   index.html             apka (login, home, nagrody, QR, profil)
│   sw.js                  service worker (push + offline shell)
│   (manifest dynamiczny — endpoint Node per salon)
│
├─ routes/lojalnosc.js     NOWY router, dwie strefy:
│   /api/klub/*            publiczne API klienta (auth tokenem klienta)
│   akcje loj_* POST       API panelu (dispatcher — REJESTRACJA W server.js!)
│
└─ public/index.html       panel: kafel Klub w profilu klienta, skaner,
                           konfiguracja w Administracji, kafle w Do sprawdzenia
```

- **URL apki:** `estelio.com.pl/klub/<slug>` (slug salonu → tenant_id; nowa kolumna/tabela mapująca). Później ewentualnie subdomena.
- **Manifest per tenant:** endpoint `GET /klub/:slug/manifest.json` generuje nazwę, kolory, ikonę salonu → każdy salon ma „swoją" apkę na ekranie klienta.
- **Wzorce istniejące do użycia:** HMAC tokeny (platnosc_link/foto), makeHasFeature (features.js), zapiszLog, router-w-fabryce (testy), E2E jak platnosc_link.

---

## 3. Autoryzacja klienta (naprawa dziury starej apki)

Stara apka: serwer wysyłał CAŁĄ bazę (telefony+PINy) do przeglądarki, filtrowanie w JS. Nowa:

- **Aktywacja konta:** recepcja generuje z profilu klienta link/QR aktywacyjny z tokenem HMAC (wzorzec Foto). Klient otwiera → ustawia 4-cyfrowy PIN → konto aktywne. (Alternatywa samodzielnej rejestracji — do decyzji, rekomendacja: tylko przez recepcję, bo weryfikuje tożsamość.)
- **Logowanie:** telefon + PIN. PIN hashowany **bcrypt**. Rate limit: 5 prób / 15 min / (IP + telefon).
- **Sesja:** token HMAC (tenant_id, id_klienta, exp) w localStorage, odświeżany. tenant_id ZAWSZE z tokenu, nigdy z requestu (lekcja z audytu bezpieczeństwa).
- Żaden endpoint nie zwraca danych innych klientów.
- **Karta QR klienta (skanowana przy kasie): USUNIĘTA z MVP.** W starej apce QR był rdzeniem, bo punkty przyznawano ręcznie przy kasie. U nas identyfikacja klienta następuje przy nabijaniu paragonu w Estelio, a odbiór nagrody działa po 6-znakowym kodzie odbioru. Karta QR (podpisany token, nie goły telefon) może wrócić później jako gadżet „karty klubowej" — opcja w Fazie 6.
- SMS OTP: opcja na przyszłość, gdy będzie bramka SMS (koszt per SMS — na start PIN wystarcza).

---

## 4. Model danych (nowe tabele, wszystkie z tenant_id)

| Tabela | Rola | Kluczowe pola |
|---|---|---|
| `Lojalnosc_Konta` | konto klubowe klienta | id_klienta (FK Klienci, UNIQUE per tenant), pin_hash, status, zgoda_regulamin_at, zgoda_marketing_at, ostatnie_logowanie |
| `Lojalnosc_Punkty` | **ledger append-only** | zmiana (±), powod, zrodlo ENUM(SPRZEDAZ, ZWROT, NAGRODA, BONUS_URODZINY, RECZNE, KOREKTA), ref_id, pracownik, created_at. **UNIQUE(tenant_id, zrodlo, ref_id)** = idempotencja. Saldo = SUM. Nigdy nie edytujemy wpisów — tylko kompensujące (wzorzec Zwrotów). |
| `Lojalnosc_Nagrody` | katalog nagród per salon | nazwa, opis, koszt_pkt, ilosc_dostepna, img, status, sortowanie |
| `Lojalnosc_Odbiory` | flow odbioru nagrody | nagroda_id, koszt_pkt_snapshot, status ENUM(OCZEKUJE/WYDANE/ODRZUCONE/ANULOWANE), kod_odbioru (6 znaków), wydal, rozstrzygnieto_at |
| `Lojalnosc_Ustawienia` | konfiguracja per salon | pkt_za_10zl, data_startu_naliczania, bonus_urodziny_pkt, regulamin (HTML/URL), nazwa_klubu, kolor_motywu, logo_url |
| `Lojalnosc_Promocje` | banery i promocja dnia | tytuł, opis, img, treść HTML, data_od/do, typ (BANER/DNIA), przycisk_biore, status |
| `Lojalnosc_Zgloszenia` | klient kliknął BIORĘ | promocja_id, id_klienta, status NOWE/OBSLUZONE → kafel w „Do sprawdzenia" |
| `Lojalnosc_Push` | subskrypcje Web Push | endpoint, p256dh, auth, id_klienta |

Saldo dostępne = SUM(ledger) − suma OCZEKUJĄCYCH odbiorów (rezerwacja przy zgłoszeniu, wpis ujemny w ledger dopiero przy WYDANE).

---

## 5. Silnik punktów (serce systemu)

- **Hook w routes/sprzedaz.js** (add_sale, add_multi_sale): po udanym zapisie, jeśli tenant ma feature `lojalnosc` (makeHasFeature, cache 5 min) i paragon ma id_klienta → wpis do ledger: `floor(kwota_paragonu / 10 zł) × pkt_za_10zl`. Nie blokuje sprzedaży przy błędzie (fire-and-forget z logiem błędu).
- **Idempotencja:** ref_id = id sprzedaży, UNIQUE — retry nie zdubluje punktów.
- **Zwroty** (ujemny wpis z zwrot_do_id) → automatyczny ujemny wpis punktów. **delete_sale** (soft delete) → wpis kompensujący.
- **Punkty liczone z tabeli Sprzedaz (pozycje), NIE z Platnosci** — splity MIX nas nie dotyczą, brak ryzyka podwójnego liczenia.
- **Zadatki:** punkty tylko przy realnej sprzedaży/rozliczeniu, NIE przy wpłacie zadatku (spójne z inwariantami finansowymi; unika podwójnego naliczenia zadatek→zabieg).
- **Ręczne akcje** (Zasady ze starej apki): konfigurowalne przyciski (np. „Opinia Google +50") w profilu klienta w panelu; pełny log kto/kiedy; RBAC.
- **Bonus urodzinowy:** naliczany przy logowaniu klienta w miesiącu urodzin (bez crona na start; idempotencja: ref_id = `URODZINY_2026`).

---

## 6. Aplikacja klienta — ekrany (UX ze starej apki, poprawiony)

1. **Aktywacja/logowanie** — link QR od recepcji → ustaw PIN; potem telefon+PIN.
2. **Home** — pigułka punktów (animacja przy zmianie), banery promocji, promocja dnia (wyróżniona, przycisk BIORĘ → zgłoszenie do recepcji), polecane nagrody.
3. **Katalog nagród** — koszt w pkt, dostępność, „Odbierz" → **6-znakowy kod odbioru** + status OCZEKUJE (klient podaje kod w recepcji).
4. **Profil** — historia punktów, regulamin/zgody, włącz powiadomienia, instalacja PWA, wylogowanie.

Design: estetyka Estelio (róż/krem, jak ekrany Foto), max-width 480, bottom-tabs — layout starej apki był dobry, zostaje.

---

## 7. Integracja w panelu Estelio

- **Profil klienta:** kafel „Klub" — saldo, historia, ręczne akcje, wydanie nagrody po kodzie odbioru, przycisk „Aktywuj konto klubu" (generuje jednorazowy QR/link aktywacyjny — to jedyny QR w MVP).
- **Do sprawdzenia / Pulpit:** oczekujące odbiory nagród + zgłoszenia BIORĘ.
- **Administracja (RBAC manager+):** ustawienia punktacji, katalog nagród, edytor promocji, regulamin, branding.
- **Statystyki:** przyznane/wydane punkty per miesiąc, top klienci, popularność nagród (wzorce wykresów z analityki).

---

## 8. Powiadomienia push (prawdziwe, nie polling co 15 s)

- **Web Push API + VAPID** (npm `web-push`), klucze w env Hostinger (format bez apostrofów!).
- Zgoda na push = zgoda marketingowa, zapisywana z datą i wersją w Lojalnosc_Konta.
- Wysyłka: publikacja promocji (przycisk PUSH w panelu), bonus urodzinowy, wydanie nagrody.
- **iOS:** Web Push działa od iOS 16.4 tylko dla PWA zainstalowanej na ekranie głównym — komunikat w apce zachęcający do instalacji.

---

## 9. Bezpieczeństwo i RODO

- bcrypt PIN-ów, HMAC sesje, rate limiting, tenant_id z tokenu, brak endpointów masowych.
- Regulamin programu per salon + rejestrowana zgoda (data, wersja) — analogia do Rejestr_Oświadczeń.
- Soft-delete klienta w Estelio → automatyczna blokada konta klubu.
- Aktualizacja dokumentu zabezpieczeń dla prawnika (nowy rozdział).
- **Osobne zadanie pilne:** zweryfikować i WYŁĄCZYĆ stare deploye Apps Script z gemini-apki (linki w plikach makiety) — żywa ekspozycja bazy telefonów+PIN-ów.

---

## 10. Fazy wdrożenia

**Faza 0 — decyzje i fundament.** ✅ ZREALIZOWANE 2026-07-10 (dev, niezacommitowane). Wpis `lojalnosc` w Features_Catalog (UKRYTY) + pilot Boczki, tabele `Lojalnosc_Punkty` (ledger, UNIQUE tenant+zrodlo+ref_id) i `Lojalnosc_Ustawienia` (pkt_za_10zl default 1, nazwa_klubu) — pozostałe tabele powstaną z Fazami 2+, żeby nie zamrażać schematu na zapas. Przyjęte rekomendacje: punkty tylko ze sprzedaży (nie z wpłat zadatków), naliczanie od dnia startu, cena TBD (pilot za 0 zł).

**Faza 1 — silnik punktów (BEZ apki klienta).** ✅ ZREALIZOWANE 2026-07-10 (dev, niezacommitowane). `routes/lojalnosc.js` (makeLojalnosc — hook fire-and-forget przez setImmediate, NIGDY nie blokuje sprzedaży) + wpięcia w `routes/sprzedaz.js`: add_sale, add_multi_sale (per pozycja, typ Zadatek pomijany), add_zwrot (kompensacja z sufitem, sprzedaż sprzed startu Klubu bez kompensacji), delete_sale (cofnięcie całości), edit_sale/emergency_edit_sale (dociągnięcie do nowej kwoty). Panel: kafel „Klub" w Podsumowaniu profilu klienta (saldo, historia 5 wpisów, ręczne ±punkty z limitem 1000 i wymaganym powodem), dark-mode. RBAC: ustawienia tylko manager+. Akcje: GET loj_klient/loj_ustawienia, POST loj_punkty_reczne/loj_ustawienia_zapisz (zarejestrowane w server.js). Testy: tests/lojalnosc.test.js — 36 testów (matematyka, idempotencja ER_DUP_ENTRY, zwroty częściowe + sufit, usunięcie, edycja, RBAC, walidacje), suite bez regresji.

**Faza 2 — PWA klienta (rdzeń).** ✅ ZREALIZOWANE 2026-07-10 (dev, niezacommitowane). Tabela `Lojalnosc_Konta` (telefon znormalizowany do 9 cyfr, pin_hash bcrypt, zgoda_regulamin_at). Publiczne API `/api/klub/*` (bez tenant_id w body — HMAC only): `info` (dane do ekranu aktywacji), `aktywuj` (token typ 'akt' 7 dni + PIN 4-6 cyfr + zgoda; ponowna aktywacja = reset PIN), `login` (telefon+PIN, bcrypt.compare, jednakowy komunikat błędu — brak enumeracji numerów, >1 dopasowanie = odmowa), `me` (saldo+historia+ustawienia, sesja 'ses' 90 dni z auto-odświeżeniem <30 dni, respektuje soft-delete klienta). Rate limiting (login 20/15min). Panel: akcja `loj_aktywacja_token` (QR+link z profilu klienta). PWA: `public/klub.html` (aktywacja/login/główny, estetyka foto.html — Cormorant+DM Sans, #b87080), `klub-manifest.json`, `klub-sw.js` (minimalny — push w Fazie 4), `klub-icon.svg` (PNG ikona = TODO Faza 5). **PILOT ADMIN-ONLY (decyzja usera 2026-07-10): kafel Klub w panelu widoczny tylko dla roli admin/megaadmin (UI) + backendowy RBAC admin na loj_punkty_reczne / loj_ustawienia_zapisz / loj_aktywacja_token.** Testy: 56 w tests/lojalnosc.test.js.

**Faza 3 — nagrody.** Katalog w panelu + w apce, flow Odbierz → 6-znakowy kod → wydanie w recepcji (wpisanie kodu w profilu klienta), rezerwacja punktów.

**Faza 4 — promocje + push.** Banery, promocja dnia z BIORĘ, zgłoszenia w Do sprawdzenia, VAPID push z panelu.

**Faza 5 — produktyzacja.** Branding per salon, statystyki, odkrycie w katalogu dodatków z ceną, materiał na blog/zamow, wdrożenie u pierwszych salonów.

**Faza 6 (opcja) — sklepy + gadżety.** Capacitor (App Store) / TWA (Google Play), push natywny na tym samym backendzie, konta deweloperskie. Ewentualnie karta QR klienta + skaner w panelu (efekt „karty klubowej"), jeśli salony będą o to prosić.

Każda faza: dev → testy → **pytanie o zgodę przed pushem** (protokół deploymentu) → pilot Boczki.

---

## 11. Decyzje — ROZSTRZYGNIĘTE 2026-07-10

1. **Boczki gratis** (jak Foto). Cena dla pozostałych salonów: do ustalenia przed Fazą 5 (katalog i tak UKRYTY).
2. **Punkty od zadatków: NIE** — tylko realna sprzedaż (wpłata zadatku nie punktuje, punkty przy realizacji).
3. **Naliczanie od dnia startu** — bez backfillu historii.
4. **Aktywacja kont wyłącznie przez recepcję** (jednorazowy QR/link z profilu klienta w panelu).
5. **Nazwa: „Klub"**, konfigurowalna per salon (Lojalnosc_Ustawienia.nazwa_klubu).

---

## 12. Notatki techniczne dla implementacji

- Nowe akcje POST → dopisać do listy `<modul>Actions` w server.js (inaczej „Nieznana akcja POST").
- Router w fabryce `module.exports = (db) => {...}` (wymóg testów), CREATE TABLE zużywa pierwszy db.query w mockach.
- Obrazki nagród/promocji: istniejąca infrastruktura uploads (UPLOADS_DIR — sprawdzić env przy problemach).
- Role porównywać przez .toLowerCase().
- E2E na wzór platnosc_link; jednostkowe na mockDb.
- Deploy: merge dev→main wyłącznie --ff-only; env vars Hostinger bez apostrofów.
