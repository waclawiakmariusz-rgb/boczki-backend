// ═══════════════════════════════════════════════════════════════════════════
//  TERMINARZ — silnik dostępności (czyste funkcje, bez bazy i bez Expressa)
//  Spec: design/terminarz 2.0/Estelio_Terminarz_Specyfikacja_dla_Claude_Code.md
//  rozdz. 8 (reguły R01–R15, kolejność sprawdzeń, przedziały [od, do)).
//
//  Czas: łańcuch 'YYYY-MM-DD HH:MM[:SS]' w czasie lokalnym salonu, w środku
//  liczony jako „naiwne” minuty (bez strefy), więc zmiana czasu letni/zimowy
//  nie przestawia godzin ściennych. Przedziały są domknięte z lewej, otwarte
//  z prawej: koniec 10:00 i początek 10:00 NIE kolidują (R: 8.3).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const RE_DT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/** 'YYYY-MM-DD HH:MM[:SS]' → minuty od epoki (naiwnie, bez strefy). */
function naMin(s) {
  if (typeof s === 'number') return s;
  const m = RE_DT.exec(String(s || ''));
  if (!m) throw new Error('Zły format daty: ' + s);
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) / 60000);
}

/** minuty od epoki → 'YYYY-MM-DD HH:MM:SS' */
function naStr(min) {
  const d = new Date(min * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

/** 'YYYY-MM-DD' z minut */
function dzienZ(min) { return naStr(min).slice(0, 10); }

/** dzień tygodnia 1 (pon) … 7 (ndz) dla 'YYYY-MM-DD' */
function dzienTygodnia(data) {
  const d = new Date(data + 'T00:00:00Z').getUTCDay(); // 0 = ndz
  return d === 0 ? 7 : d;
}

/** [a1,a2) i [b1,b2) nachodzą na siebie? */
function nakladaja(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

/** czy [od,do) mieści się w całości w którymś z przedziałów dostępności */
function miesciSie(od, do_, dostepnosc) {
  return (dostepnosc || []).some(p => p.od <= od && do_ <= p.do);
}

/** Odejmij blokady od listy przedziałów dostępności → nowa lista przedziałów. */
function odejmij(dostepnosc, blokady) {
  let wynik = (dostepnosc || []).map(p => ({ od: p.od, do: p.do })).filter(p => p.do > p.od);
  for (const b of (blokady || [])) {
    const nast = [];
    for (const p of wynik) {
      if (!nakladaja(p.od, p.do, b.od, b.do)) { nast.push(p); continue; }
      if (p.od < b.od) nast.push({ od: p.od, do: b.od });
      if (b.do < p.do) nast.push({ od: b.do, do: p.do });
    }
    wynik = nast;
  }
  return wynik;
}

/**
 * Zajęcia zasobów dla jednej pozycji (usługa + bufory per zasób, R06).
 * poz: { start, czas_min, bufor_przed_min, bufor_po_min, bufor_dotyczy: 'pracownik'|'gabinet'|'oba'|'brak',
 *        pracownik, gabinet_id, urzadzenie_id }
 */
function zajeciaPozycji(poz) {
  const start = naMin(poz.start);
  const koniec = start + Number(poz.czas_min || 0);
  const bp = Number(poz.bufor_przed_min || 0), ba = Number(poz.bufor_po_min || 0);
  const dot = poz.bufor_dotyczy || 'oba';
  const out = [];
  const dodaj = (typ, klucz, bufor) => {
    if (!klucz) return;
    out.push({ typ_zasobu: typ, klucz: String(klucz), od: start, do: koniec, powod: 'usluga' });
    if (bufor && bp > 0) out.push({ typ_zasobu: typ, klucz: String(klucz), od: start - bp, do: start, powod: 'bufor' });
    if (bufor && ba > 0) out.push({ typ_zasobu: typ, klucz: String(klucz), od: koniec, do: koniec + ba, powod: 'bufor' });
  };
  dodaj('pracownik', poz.pracownik, dot === 'pracownik' || dot === 'oba');
  dodaj('gabinet', poz.gabinet_id, dot === 'gabinet' || dot === 'oba');
  dodaj('urzadzenie', poz.urzadzenie_id, dot === 'gabinet' || dot === 'oba'); // sprzęt sprząta się razem z gabinetem
  return out;
}

/** Konflikty między nowymi zajęciami a istniejącymi (ten sam typ i klucz, nachodzące przedziały). */
function konflikty(nowe, istniejace) {
  const wynik = [];
  for (const n of nowe) {
    for (const z of (istniejace || [])) {
      if (z.typ_zasobu !== n.typ_zasobu || String(z.klucz) !== String(n.klucz)) continue;
      const zo = naMin(z.od), zd = naMin(z.do);
      if (nakladaja(n.od, n.do, zo, zd)) wynik.push({ typ_zasobu: n.typ_zasobu, klucz: n.klucz, od: zo, do: zd, zrodlo: z.zrodlo || null, rezerwacja_id: z.rezerwacja_id || null });
    }
  }
  return wynik;
}

/**
 * Sprawdź cały komplet dla wskazanego startu (R01–R06, R08 — oferta, nie gwarancja).
 *
 * wejscie = {
 *   start: 'YYYY-MM-DD HH:MM',
 *   pozycje: [{ klucz, czas_min, bufor_przed_min, bufor_po_min, bufor_dotyczy,
 *               pracownik (wybrany lub null), pracownicyDozwoleni: [imie…],
 *               wymagaGabinetu: bool, gabinetyDozwolone: [id…] (null = wszystkie aktywne),
 *               urzadzeniaDozwolone: [id…] (puste/null = sprzęt niewymagany) }],
 *   gabinety: [id…] (aktywne), urzadzenia: [id…] (aktywne),
 *   dostepnoscPracownikow: { imie: [{od,do}] }   // już po odjęciu nieobecności, w minutach
 *   dostepnoscZasobow: { klucz: [{od,do}] }       // gabinety/urządzenia: godziny salonu minus serwis
 *   zajete: [{ typ_zasobu, klucz, od, do, zrodlo, rezerwacja_id }],   // istniejące zajęcia (strefa dnia)
 *   klientZajety: [{od, do}],                     // inne wizyty tego klienta (R05)
 *   pominRezerwacje: id   // przy zmianie terminu: nie liczyć własnych zajęć
 * }
 * wyjście = { ok, start, koniec, pozycje:[{…, start, koniec, pracownik, gabinet_id, urzadzenie_id, zajecia}], problemy:[{kod, opis, pozycja}], przerwy_min }
 */
function sprawdzKomplet(w) {
  const problemy = [];
  const wyniki = [];
  let kursor = naMin(w.start);
  const start0 = kursor;
  const zajeteOdfiltrowane = (w.zajete || []).filter(z => !(w.pominRezerwacje && String(z.rezerwacja_id) === String(w.pominRezerwacje)));
  const zajeteRobocze = zajeteOdfiltrowane.map(z => ({ ...z, od: naMin(z.od), do: naMin(z.do) }));
  let przerwy = 0;

  w.pozycje.forEach((poz, idx) => {
    const czas = Number(poz.czas_min || 0);
    if (!(czas > 0)) { problemy.push({ kod: 'BRAK_CZASU', opis: `Usługa „${poz.nazwa || poz.klucz}” nie ma ustawionego czasu trwania.`, pozycja: idx }); return; }
    const start = kursor, koniec = kursor + czas;

    // 1) pracownik (R04 kompetencje → grafik → kolizje)
    const kandydaci = poz.pracownik ? [poz.pracownik] : (poz.pracownicyDozwoleni || []);
    if (poz.pracownik && Array.isArray(poz.pracownicyDozwoleni) && poz.pracownicyDozwoleni.length && !poz.pracownicyDozwoleni.includes(poz.pracownik)) {
      problemy.push({ kod: 'KOMPETENCJE', opis: `${poz.pracownik} nie wykonuje usługi „${poz.nazwa || poz.klucz}”.`, pozycja: idx });
      return;
    }
    if (!kandydaci.length) { problemy.push({ kod: 'BRAK_WYKONAWCY', opis: `Brak pracownika z uprawnieniem do „${poz.nazwa || poz.klucz}”.`, pozycja: idx }); return; }

    let wybrany = null, powodOdrzucenia = null;
    for (const imie of kandydaci) {
      const probne = zajeciaPozycji({ ...poz, start: naStr(start), pracownik: imie, gabinet_id: null, urzadzenie_id: null });
      const dost = (w.dostepnoscPracownikow || {})[imie] || [];
      const pozaGrafikiem = probne.find(z => !miesciSie(z.od, z.do, dost));
      if (pozaGrafikiem) { powodOdrzucenia = powodOdrzucenia || { kod: 'GRAFIK', opis: `${imie} nie pracuje w tym czasie (${naStr(pozaGrafikiem.od).slice(11, 16)}–${naStr(pozaGrafikiem.do).slice(11, 16)}).` }; continue; }
      const kol = konflikty(probne, zajeteRobocze);
      if (kol.length) { powodOdrzucenia = powodOdrzucenia || { kod: 'PRACOWNIK_ZAJETY', opis: `${imie} ma w tym czasie inną wizytę (${naStr(kol[0].od).slice(11, 16)}–${naStr(kol[0].do).slice(11, 16)}).`, konflikt: kol[0] }; continue; }
      wybrany = imie; break;
    }
    if (!wybrany) { problemy.push({ ...powodOdrzucenia, pozycja: idx }); return; }

    // 2) gabinet (R02)
    let gabinet = null;
    if (poz.wymagaGabinetu) {
      const pula = (poz.gabinetyDozwolone && poz.gabinetyDozwolone.length) ? poz.gabinetyDozwolone : (w.gabinety || []);
      let pow = null;
      for (const g of pula) {
        const probne = zajeciaPozycji({ ...poz, start: naStr(start), pracownik: null, gabinet_id: g, urzadzenie_id: null });
        const dost = (w.dostepnoscZasobow || {})[String(g)];
        if (dost && probne.find(z => !miesciSie(z.od, z.do, dost))) { pow = pow || { kod: 'GABINET_NIEDOSTEPNY', opis: 'Gabinet jest w tym czasie niedostępny (poza godzinami lub serwis).' }; continue; }
        if (konflikty(probne, zajeteRobocze).length) { pow = pow || { kod: 'GABINET_ZAJETY', opis: 'Wszystkie dopuszczone gabinety są w tym czasie zajęte.' }; continue; }
        gabinet = g; break;
      }
      if (gabinet === null) { problemy.push({ ...(pow || { kod: 'BRAK_GABINETU', opis: 'Usługa wymaga gabinetu, a salon nie ma żadnego aktywnego.' }), pozycja: idx }); return; }
    }

    // 3) urządzenie (R03, R14 — tylko jednostki z puli usługi)
    let urzadzenie = null;
    if (poz.urzadzeniaDozwolone && poz.urzadzeniaDozwolone.length) {
      let pow = null;
      for (const u of poz.urzadzeniaDozwolone) {
        if (w.urzadzenia && !w.urzadzenia.map(String).includes(String(u))) continue; // nieaktywne/zarchiwizowane
        const probne = zajeciaPozycji({ ...poz, start: naStr(start), pracownik: null, gabinet_id: null, urzadzenie_id: u });
        const dost = (w.dostepnoscZasobow || {})[String(u)];
        if (dost && probne.find(z => !miesciSie(z.od, z.do, dost))) { pow = pow || { kod: 'URZADZENIE_NIEDOSTEPNE', opis: 'Urządzenie jest w tym czasie wyłączone (serwis / poza godzinami).' }; continue; }
        if (konflikty(probne, zajeteRobocze).length) { pow = pow || { kod: 'URZADZENIE_ZAJETE', opis: 'Urządzenie jest zajęte w wymaganym czasie. Wybierz inny termin lub zgodne urządzenie.' }; continue; }
        urzadzenie = u; break;
      }
      if (urzadzenie === null) { problemy.push({ ...(pow || { kod: 'BRAK_URZADZENIA', opis: 'Żadne zgodne urządzenie nie jest aktywne.' }), pozycja: idx }); return; }
    }

    const zaj = zajeciaPozycji({ ...poz, start: naStr(start), pracownik: wybrany, gabinet_id: gabinet, urzadzenie_id: urzadzenie });
    // zajęcia własnej rezerwacji też blokują kolejne pozycje (ten sam sprzęt/pracownik w tym samym czasie)
    zaj.forEach(z => zajeteRobocze.push({ ...z, zrodlo: 'nowa' }));
    wyniki.push({ ...poz, start: naStr(start), koniec: naStr(koniec), pracownik: wybrany, gabinet_id: gabinet, urzadzenie_id: urzadzenie, zajecia: zaj });

    // kolejna pozycja: po usłudze + jawna przerwa równa buforowi „po”, jeśli dotyczy pracownika/gabinetu
    const dot = poz.bufor_dotyczy || 'oba';
    const przerwa = (dot !== 'brak') ? Number(poz.bufor_po_min || 0) : 0;
    if (idx < w.pozycje.length - 1) przerwy += przerwa;
    kursor = koniec + (idx < w.pozycje.length - 1 ? przerwa : 0);
  });

  const koniec = wyniki.length ? naMin(wyniki[wyniki.length - 1].koniec) : start0;
  // R05: klient nie nachodzi na własną inną wizytę
  if (!problemy.length && (w.klientZajety || []).some(k => nakladaja(start0, koniec, naMin(k.od), naMin(k.do)))) {
    problemy.push({ kod: 'KLIENT_ZAJETY', opis: 'Klientka ma w tym czasie inną wizytę.', pozycja: null });
  }
  return { ok: problemy.length === 0 && wyniki.length === w.pozycje.length, start: naStr(start0), koniec: naStr(koniec), pozycje: wyniki, problemy, przerwy_min: przerwy };
}

/**
 * Wyszukiwarka terminów (E06, 8.4): przegląda dni i kroki siatki, zwraca pierwsze `limit` kompletów.
 * w = { ...jak sprawdzKomplet bez start, dzienOd:'YYYY-MM-DD', dzienDo:'YYYY-MM-DD', krok_min, limit,
 *       dostepnoscDnia(data) → { dostepnoscPracownikow, dostepnoscZasobow, zajete, klientZajety }, nieWczesniejNiz: 'YYYY-MM-DD HH:MM' }
 */
function szukajTerminy(w) {
  const krok = Number(w.krok_min || 15), limit = Number(w.limit || 10);
  const wyniki = [];
  const d0 = naMin(w.dzienOd + ' 00:00'), d1 = naMin(w.dzienDo + ' 00:00');
  const minStart = w.nieWczesniejNiz ? naMin(w.nieWczesniejNiz) : -Infinity;
  for (let dzien = d0; dzien <= d1 && wyniki.length < limit; dzien += 1440) {
    const data = dzienZ(dzien);
    const dnia = w.dostepnoscDnia(data);
    if (!dnia) continue;
    const pierwsza = w.pozycje[0];
    const kandydaci = pierwsza.pracownik ? [pierwsza.pracownik] : (pierwsza.pracownicyDozwoleni || []);
    const starty = new Set();
    for (const imie of kandydaci) {
      for (const p of (dnia.dostepnoscPracownikow[imie] || [])) {
        const pierwszy = Math.ceil(p.od / krok) * krok;
        for (let s = pierwszy; s < p.do; s += krok) if (s >= minStart) starty.add(s);
      }
    }
    for (const s of [...starty].sort((a, b) => a - b)) {
      const r = sprawdzKomplet({ ...w, ...dnia, start: naStr(s) });
      if (r.ok) { wyniki.push(r); if (wyniki.length >= limit) break; }
    }
  }
  return wyniki;
}

/** Grafik tygodniowy → przedziały dnia (minuty). wzorce: [{dzien_tyg, od:'09:00', do:'17:00', od_daty, do_daty}] */
// Wyjątek datowany = wpis z od_daty = do_daty = ten dzień. Ma PIERWSZEŃSTWO i zastępuje reguły cykliczne tego dnia
// (raport odbioru R05): „zmiana jednej środy nie zmienia innych śród”. Wyjątek „00:00–00:00” oznacza dzień wolny.
const jestWyjatkiem = (g) => !!(g.od_daty && g.do_daty && String(g.od_daty).slice(0, 10) === String(g.do_daty).slice(0, 10));
function przedzialyZGrafiku(wzorce, data) {
  const dt = dzienTygodnia(data), baza = naMin(data + ' 00:00');
  const lista = wzorce || [];
  const wyjatki = lista.filter(g => jestWyjatkiem(g) && String(g.od_daty).slice(0, 10) === data);
  const zrodlo = wyjatki.length ? wyjatki : lista.filter(g => !jestWyjatkiem(g));
  const out = [];
  for (const g of zrodlo) {
    if (!wyjatki.length) {
      if (Number(g.dzien_tyg) !== dt) continue;
      if (g.od_daty && String(g.od_daty).slice(0, 10) > data) continue;
      if (g.do_daty && String(g.do_daty).slice(0, 10) < data) continue;
    }
    const [h1, m1] = String(g.od).split(':').map(Number), [h2, m2] = String(g.do).split(':').map(Number);
    const od = baza + h1 * 60 + m1, do_ = baza + h2 * 60 + m2;
    if (do_ > od) out.push({ od, do: do_ });
  }
  return out.sort((a, b) => a.od - b.od);
}

module.exports = { naMin, naStr, dzienZ, dzienTygodnia, nakladaja, miesciSie, odejmij, zajeciaPozycji, konflikty, sprawdzKomplet, szukajTerminy, przedzialyZGrafiku };
