// routes/analityka.js
// Analityka: get_months, get_daily_summary, get_costs_list, get_stats, get_yearly_summary,
//            get_treatment_analysis, get_bi_data, get_monthly_details, save_monthly_cost

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');

module.exports = (db) => {

  const parseDate = (raw) => {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    let str = String(raw);
    let d = new Date(str.substring(0, 10));
    return isNaN(d.getTime()) ? null : d;
  };

  const parseAmount = (raw) => {
    if (typeof raw === 'number') return raw;
    if (!raw) return 0;
    let str = String(raw).replace(',', '.').replace(/[^0-9.-]/g, '');
    let val = parseFloat(str);
    return isNaN(val) ? 0 : val;
  };

  const classifyPayment = (p) => {
    let s = String(p).toLowerCase();
    if (s.includes('blik')) return 'Blik';
    if (s.includes('gotówka') || s.includes('gotowka')) return 'Gotówka';
    if (s.includes('karta') || s.includes('terminal')) return 'Karta';
    if (s.includes('przelew') || s.includes('tpay')) return 'Przelew';
    if (s.includes('tubapay') || s.includes('tuba')) return 'TubaPay';
    if (s.includes('mediraty') || s.includes('raty')) return 'MediRaty';
    return 'Inne';
  };

  // Promise-owy wrapper (analityka jest read-only — na błędzie degradujemy do []).
  const qA = (sql, params) => new Promise((resolve) => db.query(sql, params, (e, r) => resolve(e ? [] : (r || []))));

  // Helper: pobierz koszty danego miesiąca
  function pobierzKoszt(tenant_id, miesiac, callback) {
    db.query(
      `SELECT kwota FROM Koszty WHERE tenant_id = ? AND DATE_FORMAT(data_kosztu, '%Y-%m') = ? LIMIT 1`,
      [tenant_id, miesiac],
      (err, rows) => {
        if (err || !rows.length) return callback(0);
        callback(parseAmount(rows[0].kwota));
      }
    );
  }

  // ==========================================
  // GET /analityka
  // ==========================================
  router.get('/analityka', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'get_months' || action === 'an_get_months') {
      db.query(
        `SELECT DATE_FORMAT(data_sprzedazy, '%Y-%m') as m FROM Sprzedaz WHERE tenant_id = ? AND data_sprzedazy IS NOT NULL GROUP BY m ORDER BY m DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', months: [] });
          return res.json({ status: 'success', months: (rows || []).map(r => r.m) });
        }
      );

    } else if (action === 'get_daily_summary' || action === 'an_get_daily_summary') {
      const dateStr = req.query.date;
      pobierzTransakcjeZDnia(tenant_id, dateStr, (wynik) => res.json(wynik));

    } else if (action === 'get_costs_list' || action === 'an_get_costs_list') {
      db.query(
        `SELECT DATE_FORMAT(data_kosztu, '%Y-%m') as month, kwota as amount FROM Koszty WHERE tenant_id = ? ORDER BY data_kosztu DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', data: [] });
          return res.json({ status: 'success', data: (rows || []).map(r => ({ month: r.month, amount: r.amount })) });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET analityka: ' + action });
    }
  });

  // ==========================================
  // Funkcja pomocnicza: pobierz transakcje z dnia
  // ==========================================
  function pobierzTransakcjeZDnia(tenant_id, dataStr, callback) {
    const wynik = [];

    const getBaseId = (fullId) => {
      if (!fullId) return '';
      const str = String(fullId);
      if (str.startsWith('DEP') && str.includes('-SPLIT-')) return str.split('-SPLIT-')[0];
      if (str.startsWith('DEP')) return str;
      return str.length >= 15 ? str.substring(0, 15) : str;
    };

    // Magazyn → Set nazw produktów typu Witaminy (= Suplementy). Używamy do rozpoznania
    // starszych sprzedaży zapisanych jako "Kosmetyk: X" gdzie X jest suplementem.
    db.query(
      `SELECT DISTINCT LOWER(TRIM(nazwa_produktu)) AS nazwa FROM Magazyn WHERE tenant_id = ? AND TRIM(typ) = 'Witaminy'`,
      [tenant_id],
      (errSup, supRows) => {
        const suplementSet = new Set((supRows || []).map(r => r.nazwa));

    // Zadatki
    db.query(
      `SELECT id, data_wplaty, klient, metoda, kwota, pracownicy, status FROM Zadatki WHERE tenant_id = ? AND DATE(data_wplaty) = ? AND COALESCE(status, '') != 'USUNIĘTY'`,
      [tenant_id, dataStr],
      (err1, zadatki) => {
        (zadatki || []).forEach(row => {
          wynik.push({
            typ_rekordu: 'zadatek',
            timestamp: new Date(row.data_wplaty).getTime(),
            baseId: row.id,
            godzina: String(row.data_wplaty).slice(11, 16),
            klient: row.klient,
            zabieg: '+ Wpłata Zadatku (' + row.metoda + ')',
            sprzedawca: row.pracownicy || '-',
            kwota: row.kwota,
            platnosc: row.metoda
          });
        });

        // Sprzedaż — dodajemy szczegoly (liczba sztuk dla kosmetyków) i kategoria_produktu
        // (rozróżnienie Kosmetyk vs Suplement na froncie dla chipów w Podsumowaniu Dziennym).
        db.query(
          `SELECT id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, szczegoly, kategoria_produktu, status FROM Sprzedaz WHERE tenant_id = ? AND DATE(data_sprzedazy) = ? AND COALESCE(status, '') != 'USUNIĘTY'`,
          [tenant_id, dataStr],
          (err2, sprzedaz) => {
            (sprzedaz || []).forEach(row => {
              const platnosc = String(row.platnosc || '').toLowerCase();
              if (platnosc.includes('portfel')) return;
              // Wykryj kategorię produktu — najpierw z kolumny (nowe wpisy), potem z prefixu,
              // a dla starszych "Kosmetyk: X" sprawdzamy czy X jest w suplementSet.
              let katProd = row.kategoria_produktu || null;
              if (!katProd) {
                const zL = String(row.zabieg || '').toLowerCase();
                if (zL.startsWith('suplement:')) katProd = 'Suplement';
                else if (zL.startsWith('kosmetyk:')) {
                  const cleanProd = String(row.zabieg).replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim().toLowerCase();
                  katProd = suplementSet.has(cleanProd) ? 'Suplement' : 'Kosmetyk';
                }
              }
              wynik.push({
                typ_rekordu: 'sprzedaz',
                timestamp: new Date(row.data_sprzedazy).getTime(),
                baseId: getBaseId(row.id),
                godzina: String(row.data_sprzedazy).slice(11, 16),
                klient: row.klient,
                zabieg: row.zabieg,
                sprzedawca: row.sprzedawca,
                kwota: row.kwota,
                platnosc: row.platnosc,
                szczegoly: row.szczegoly || '',
                kategoria_produktu: katProd
              });
            });

            // Płatności mix
            db.query(
              `SELECT id, data_platnosci, klient, metoda_platnosci, kwota, status FROM Platnosci WHERE tenant_id = ? AND DATE(data_platnosci) = ? AND COALESCE(status, '') != 'USUNIĘTY'`,
              [tenant_id, dataStr],
              (err3, platnosci) => {
                (platnosci || []).forEach(row => {
                  const metoda = String(row.metoda_platnosci || '').toLowerCase();
                  if (metoda.includes('portfel')) return;
                  wynik.push({
                    typ_rekordu: 'platnosc_mix',
                    timestamp: new Date(row.data_platnosci).getTime(),
                    baseId: getBaseId(row.id),
                    godzina: String(row.data_platnosci).slice(11, 16),
                    klient: row.klient,
                    zabieg: '↳ Dopłata Mix (' + row.metoda_platnosci + ')',
                    sprzedawca: '-',
                    kwota: row.kwota,
                    platnosc: row.metoda_platnosci
                  });
                });

                wynik.sort((a, b) => {
                  if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
                  if (a.baseId < b.baseId) return -1; if (a.baseId > b.baseId) return 1;
                  const getW = (r) => {
                    if (r.typ_rekordu === 'platnosc_mix') return 3;
                    if (String(r.platnosc || '').toLowerCase() === 'mix') return 2;
                    return 1;
                  };
                  return getW(a) - getW(b);
                });

                callback(wynik);
              }
            );
          }
        );
      }
    );
      } // koniec callback (errSup, supRows)
    );    // koniec db.query Magazyn (suplementSet) dla pobierzTransakcjeZDnia
  }

  // ==========================================
  // POST /analityka
  // ==========================================
  router.post('/analityka', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'get_months' || action === 'an_get_months') {
      db.query(
        `SELECT DATE_FORMAT(data_sprzedazy, '%Y-%m') as m FROM Sprzedaz WHERE tenant_id = ? AND data_sprzedazy IS NOT NULL GROUP BY m ORDER BY m DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', months: [] });
          return res.json({ status: 'success', months: (rows || []).map(r => r.m) });
        }
      );

    } else if (action === 'get_daily_summary' || action === 'an_get_daily_summary') {
      pobierzTransakcjeZDnia(tenant_id, d.date, (wynik) => res.json(wynik));

    } else if (action === 'save_monthly_cost' || action === 'an_save_monthly_cost') {
      const targetMonth = d.month;
      const amount = parseAmount(d.amount);
      db.query(
        `SELECT id FROM Koszty WHERE tenant_id = ? AND DATE_FORMAT(data_kosztu, '%Y-%m') = ? LIMIT 1`,
        [tenant_id, targetMonth],
        (err, rows) => {
          if (rows && rows.length > 0) {
            db.query(`UPDATE Koszty SET kwota = ? WHERE tenant_id = ? AND id = ?`, [amount, tenant_id, rows[0].id], (err2) => {
              if (err2) return res.json({ status: 'error', message: err2.message });
              return res.json({ status: 'success', message: 'Zaktualizowano koszt dla: ' + targetMonth });
            });
          } else {
            const id = randomUUID();
            db.query(
              `INSERT INTO Koszty (id, tenant_id, data_kosztu, kwota, opis) VALUES (?, ?, ?, ?, 'Koszt Miesięczny')`,
              [id, tenant_id, targetMonth + '-01', amount],
              (err2) => {
                if (err2) return res.json({ status: 'error', message: err2.message });
                return res.json({ status: 'success', message: 'Dodano koszt dla: ' + targetMonth });
              }
            );
          }
        }
      );

    } else if (action === 'get_costs_list' || action === 'an_get_costs_list') {
      db.query(
        `SELECT DATE_FORMAT(data_kosztu, '%Y-%m') as month, kwota as amount FROM Koszty WHERE tenant_id = ? ORDER BY data_kosztu DESC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'success', data: [] });
          return res.json({ status: 'success', data: (rows || []).map(r => ({ month: r.month, amount: r.amount })) });
        }
      );

    } else if (action === 'get_stats' || action === 'an_get_stats') {
      const selectedMonth = d.month;

      // Najpierw nazwy produktów typu Witaminy (= Suplementy) z Magazyn — żeby
      // rozpoznać starsze sprzedaże zapisane jako "Kosmetyk: X" gdzie X to Suplement.
      db.query(
        `SELECT DISTINCT LOWER(TRIM(nazwa_produktu)) AS nazwa FROM Magazyn WHERE tenant_id = ? AND TRIM(typ) = 'Witaminy'`,
        [tenant_id],
        (errSup, supRows) => {
      const suplementSet = new Set((supRows || []).map(r => r.nazwa));

      // Sprzedaż główna
      db.query(
        `SELECT id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, szczegoly FROM Sprzedaz WHERE tenant_id = ? AND DATE_FORMAT(data_sprzedazy, '%Y-%m') = ? AND COALESCE(status, 'AKTYWNY') = 'AKTYWNY'`,
        [tenant_id, selectedMonth],
        (err1, sprzedaz) => {
          db.query(
            `SELECT data_wplaty, klient, kwota, metoda, pracownicy, status, typ, cel FROM Zadatki WHERE tenant_id = ? AND DATE_FORMAT(data_wplaty, '%Y-%m') = ? AND COALESCE(status, 'AKTYWNY') NOT IN ('USUNIĘTY', 'SCALONY')`,
            [tenant_id, selectedMonth],
            (err2, zadatki) => {
              let stats = {
                totalRevenue: 0, count: 0,
                categorySplit: { Zabiegi: 0, Kosmetyki: 0 },
                rankingPracownikow: [], employeeDetails: {}, debugLog: []
              };
              let empTemp = {};

              // Helper: wyciąga liczbę sztuk z `szczegoly` (np. "5 szt." -> 5, "1,5 szt." -> 1.5)
              const parsujIloscSzt = (szczegoly) => {
                const m = String(szczegoly || '').match(/(\d+(?:[.,]\d+)?)\s*szt/i);
                return m ? parseFloat(m[1].replace(',', '.')) : 1;
              };

              // debugLog jest rozdzielany znakiem '|' (parser an_renderDebugLog w index.html
              // robi line.split('|')). Wolne pola tekstowe (nazwa zabiegu, cel zadatku) MOGĄ
              // zawierać '|' (np. "Żelazko 1x | Zadatek..."), co przesuwa wszystkie kolejne
              // kolumny i psuje parsowanie kwoty → panel zaniżał sumę zadatków. Wycinamy '|'.
              const noPipe = (s) => String(s == null ? '' : s).replace(/\|/g, '/');

              const initEmp = (person) => ({
                name: person, total: 0, zabiegi: 0, kosmetyki: 0, qty_kosmetyki: 0,
                // Suplementy — podzbiór kosmetyków (rozróżnienie 2026-06-07 po typ='Witaminy'
                // w Magazyn). Liczby kosmetyki/qty_kosmetyki ZAWIERAJĄ też suplementy
                // (back-compat ze starymi raportami). suplementy/qty_suplementow to OSOBNY
                // licznik tylko dla suplementów.
                suplementy: 0, qty_suplementow: 0,
                transakcje: 0, top: {}, transactionsList: [], virtualReceipts: {},
                _topReceipts: new Set(),       // dedup Top 5 po (baseId, zabieg)
                wykonaneZabiegi: new Set()     // dla worstTreatments: klucz "kategoria||wariant"
              });

              const processRow = (amount, zabieg, klient, sprzedawca, platnosc, dateObj, id, szczegoly) => {
                const platL = String(platnosc || '').toLowerCase();
                // Korekty (ręczne / system) — pomijamy całkowicie
                if (platL.includes('ręczne') || platL.includes('reczne') || platL.includes('system')) return;
                // Portfel: pomijamy w sumach finansowych (zadatek już zaliczony przy wpłacie),
                // ALE liczymy do Top 5 / wykonaneZabiegi / qty_kosmetyki (faktyczna sprzedaż fizyczna).
                const isPortfel = (platL === 'portfel');
                // isKosmetyk obejmuje też suplementy (back-compat z istniejącą logiką
                // total/zabiegi/Top 5 — "Detal" to wspólna grupa).
                const zabiegLow = zabieg.toLowerCase();
                let isSuplement = zabiegLow.includes('suplement');
                const isKosmetyk = isSuplement || zabiegLow.includes('kosmetyk') || zabiegLow.includes('krem');
                if (isKosmetyk && !isSuplement && suplementSet.size > 0) {
                  // Stara sprzedaż "Kosmetyk: X" — sprawdź czy X to suplement (typ=Witaminy w Magazyn)
                  const cleanProd = String(zabieg).replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim().toLowerCase();
                  if (suplementSet.has(cleanProd)) isSuplement = true;
                }
                if (amount === 0 && !isKosmetyk && !isPortfel) return;

                // baseId — multi-sale ma format "<base>-<n>"; single-sale = całe id
                const idStr = String(id || '');
                const baseId = idStr.includes('-') ? idStr.split('-').slice(0, -1).join('-') || idStr : idStr;
                const ilosc = isKosmetyk ? parsujIloscSzt(szczegoly) : 1;

                if (!isPortfel) {
                  stats.totalRevenue += amount; stats.count++;
                  if (isKosmetyk) stats.categorySplit['Kosmetyki'] += amount;
                  else stats.categorySplit['Zabiegi'] += amount;
                }

                const rawSellers = String(sprzedawca || '').trim();
                if (!rawSellers) return;
                const sellers = rawSellers.split(',').map(s => s.trim()).filter(Boolean);
                const count = sellers.length;
                if (count === 0) return;
                const splitAmount = amount / count;

                sellers.forEach(person => {
                  if (!empTemp[person]) empTemp[person] = initEmp(person);
                  const e = empTemp[person];

                  // REGUŁA 1 (Magda): kosmetyki NIE liczą do total/zabiegi/transakcje
                  // pracownika — Magda traktuje je osobno (zakładka "Kosmetyki" + helpery
                  // sprzedazBezKosmetykow). Kwota i ilość kosmetyków pozostają w
                  // dedykowanych KPI (e.kosmetyki, e.qty_kosmetyki, e.top).
                  if (!isPortfel && !isKosmetyk) {
                    e.total += splitAmount;
                    e.transakcje += (1 / count);
                    e.zabiegi += splitAmount;

                    if (dateObj) {
                      const day = `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                      e.transactionsList.push({ service: zabieg, val: splitAmount, date: day });
                      const receiptKey = `${day}_${klient.toUpperCase()}`;
                      if (!e.virtualReceipts[receiptKey]) e.virtualReceipts[receiptKey] = { client: klient, date: day, total: 0, items: [] };
                      e.virtualReceipts[receiptKey].total += splitAmount;
                      e.virtualReceipts[receiptKey].items.push(zabieg.replace(/(?:\s|-)*dopłata$/i, '').trim());
                    }
                  }

                  // Wartość kosmetyków per pracownik — osobne KPI (nie wlicza się do total)
                  if (!isPortfel && isKosmetyk) {
                    e.kosmetyki += splitAmount;
                    if (isSuplement) e.suplementy += splitAmount;
                  }

                  // qty_kosmetyki — fizyczna ilość sprzedanych sztuk, niezależnie od metody
                  if (isKosmetyk) {
                    e.qty_kosmetyki += (ilosc / count);
                    if (isSuplement) e.qty_suplementow += (ilosc / count);
                  }

                  // Top 5 — uwzględnia Portfel; dedup po (baseId, zabieg) eliminuje
                  // podwójne liczenie tego samego zabiegu rozbitego na pozycje multi-sale
                  const topKey = `${baseId}|${zabieg}`;
                  if (!e._topReceipts.has(topKey)) {
                    e._topReceipts.add(topKey);
                    // Klucz dla emp.top: gdy isSuplement (rozpoznane przez Magazyn lookup),
                    // a zabieg ma stary prefix "Kosmetyk: X" — podmień na "Suplement: X" aby
                    // front prawidłowo filtrował listy per kategoria.
                    const zabiegTop = (isSuplement && /^kosmetyk\s*[:-]?\s*/i.test(zabieg))
                      ? zabieg.replace(/^kosmetyk\s*[:-]?\s*/i, 'Suplement: ')
                      : zabieg;
                    if (!e.top[zabiegTop]) e.top[zabiegTop] = 0;
                    e.top[zabiegTop] += isKosmetyk ? ilosc : 1;
                  }

                  // wykonaneZabiegi — dla worstTreatments (tylko zabiegi, nie kosmetyki).
                  // Klucz "kategoria||wariant" pasuje do struktury tabeli Uslugi.
                  if (!isKosmetyk) {
                    const wariant = String(szczegoly || '').trim();
                    e.wykonaneZabiegi.add(`${zabieg}||${wariant}`);
                  }

                  // Debug log per pracownik per dzień — diagnostyka rozbieżności z Magdą
                  if (dateObj) {
                    const dataStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
                    let liczone, kategoria;
                    if (isKosmetyk) {
                      liczone = '→ KOSMETYK (osobno, nie do total)';
                      kategoria = 'KOSMETYK';
                    } else if (isPortfel) {
                      liczone = '→ ✗ pomijane (Portfel)';
                      kategoria = 'PORTFEL';
                    } else {
                      liczone = `→ ✓ +${splitAmount.toFixed(2)} do total`;
                      kategoria = 'SPRZEDAŻ';
                    }
                    stats.debugLog.push(
                      `${dataStr} | ${person.padEnd(12)} | ${kategoria.padEnd(10)} | ${noPipe(zabieg).substring(0, 40).padEnd(40)} | ${splitAmount.toFixed(2).padStart(8)} zł (z ${amount}/${count}os) | ${noPipe(platnosc).padEnd(8)} | ${liczone}`
                    );
                  }
                });
              };

              (sprzedaz || []).forEach(row => {
                processRow(
                  parseAmount(row.kwota),
                  String(row.zabieg || '').trim(),
                  String(row.klient || '').trim(),
                  row.sprzedawca,
                  row.platnosc,
                  new Date(row.data_sprzedazy),
                  row.id,
                  row.szczegoly
                );
              });

              (zadatki || []).forEach(row => {
                const status = String(row.status || '').toUpperCase();
                const typ = String(row.typ || '').toUpperCase();
                const metoda = String(row.metoda || '').toLowerCase();
                // Liczymy też WYKORZYSTANE zadatki (jak Zebranie/odp_getReportData): wykorzystany
                // zadatek to realna gotówka/karta, a zabieg za niego jest zapisany jako Portfel (pomijany
                // wszędzie). Pominięcie go = utrata realnego przychodu. Wykluczamy tylko USUNIĘTY/SCALONY.
                if (status === 'USUNIĘTY' || status === 'SCALONY' || typ !== 'WPŁATA') return;
                if (metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                const amount = parseAmount(row.kwota);
                if (amount === 0) return;

                const sellers = String(row.pracownicy || '').split(',').map(s => s.trim()).filter(Boolean);
                const count = sellers.length;
                if (count === 0) return;

                // REGUŁA 2: zadatki gdzie liczba pracowników >= 4 są pomijane
                // per pracownik. Tak duża liczba osób na jednym zadatku zwykle
                // oznacza wpis grupowy (konsultacja reklamowa / Booksy reception /
                // wpłata online) — nie zaliczany indywidualnie pracownikom.
                // W typowym salonie (1-2 osoby na transakcję) reguła nigdy się
                // nie aktywuje. Próg jest celowo wysoki (4) żeby nie kolidował
                // z normalnymi wpisami zespołowymi (3 osoby).
                // Potwierdzone na danych Boczki: 02.03, 09.03, 02.04 — Magda
                // pomijała wszystkie zadatki z 4+ osobami.
                const dateObjZ = row.data_wplaty ? new Date(row.data_wplaty) : null;
                const dataStrZ = dateObjZ
                  ? `${dateObjZ.getFullYear()}-${String(dateObjZ.getMonth()+1).padStart(2,'0')}-${String(dateObjZ.getDate()).padStart(2,'0')}`
                  : '????-??-??';

                stats.totalRevenue += amount; stats.count++;
                stats.categorySplit['Zabiegi'] += amount;
                const splitAmount = amount / count;
                sellers.forEach(person => {
                  if (!empTemp[person]) empTemp[person] = initEmp(person);
                  const e = empTemp[person];
                  e.total += splitAmount; e.transakcje += (1 / count); e.zabiegi += splitAmount;
                  // Wpłata zadatku NIE liczy się do Top 5 zabiegów (to nie jest zabieg).
                  // Pozostaje w transactionsList dla pełnej historii pracownika.
                  e.transactionsList.push({ service: 'Zadatek: ' + String(row.cel || ''), val: splitAmount, date: '' });

                  // Debug log dla zadatku
                  stats.debugLog.push(
                    `${dataStrZ} | ${person.padEnd(12)} | ZADATEK    | ${noPipe(row.cel || row.klient).substring(0, 40).padEnd(40)} | ${splitAmount.toFixed(2).padStart(8)} zł (z ${amount}/${count}os) | ${noPipe(row.metoda).padEnd(8)} | → ✓ +${splitAmount.toFixed(2)} do total`
                  );
                });
              });

              // Pobierz pełną listę zabiegów z tabeli Uslugi — dla worstTreatments
              db.query(
                `SELECT kategoria, wariant FROM Uslugi WHERE tenant_id = ?`,
                [tenant_id],
                (errU, uslugi) => {
                  const wszystkieUslugi = (uslugi || [])
                    .map(u => ({
                      kategoria: String(u.kategoria || '').trim(),
                      wariant: String(u.wariant || '').trim()
                    }))
                    .filter(u => u.kategoria);

                  for (let person in empTemp) {
                    const e = empTemp[person];
                    // worstTreatments — pozycje z Uslugi NIE wykonane przez tego pracownika
                    const zeroSales = [];
                    wszystkieUslugi.forEach(u => {
                      const klucz = `${u.kategoria}||${u.wariant}`;
                      if (!e.wykonaneZabiegi.has(klucz)) {
                        zeroSales.push(u.wariant ? `${u.kategoria} — ${u.wariant}` : u.kategoria);
                      }
                    });
                    e.worstTreatments = zeroSales;

                    // bestReceipt (Złoty paragon) — bez zmian, działa OK
                    const receiptsArr = Object.values(e.virtualReceipts).sort((a, b) => b.total - a.total);
                    if (receiptsArr.length > 0) {
                      const best = receiptsArr[0];
                      const uniqueItems = [...new Set(best.items)];
                      e.bestReceipt = { client: best.client, date: best.date, val: best.total, services: uniqueItems.join(' + ') };
                    }

                    // Cleanup pól pomocniczych — nie wysyłamy ich do frontendu
                    delete e.virtualReceipts;
                    delete e._topReceipts;
                    delete e.wykonaneZabiegi;
                  }

                  // Podsumowanie miesięczne per pracownik na końcu logu
                  // (sortowanie aktualnie chronologiczne — sumy zostaną na końcu)
                  stats.debugLog.push('────────── SUMY MIESIĘCZNE ──────────');
                  for (let person in empTemp) {
                    const e = empTemp[person];
                    stats.debugLog.push(
                      `ZZZ-SUM | ${person.padEnd(12)} | total=${e.total.toFixed(2)} zł | zabiegi=${e.zabiegi.toFixed(2)} | kosmetyki=${e.kosmetyki.toFixed(2)} (${e.qty_kosmetyki.toFixed(0)} szt.) | transakcji=${e.transakcje.toFixed(1)}`
                    );
                  }

                  stats.employeeDetails = empTemp;
                  stats.rankingPracownikow = Object.values(empTemp).sort((a, b) => b.total - a.total);
                  return res.json({ status: 'success', data: stats });
                }
              );
            }
          );
        }
      );
        } // koniec callback (errSup, supRows)
      );    // koniec db.query Magazyn (suplementSet) dla get_stats


    } else if (action === 'get_monthly_details' || action === 'an_get_monthly_details') {
      const targetMonth = d.month;
      const compareMonth = d.compareMonth;
      const ALL_SERVICES = ['Endermologia Infinity', 'Arosha', 'Bon podarunkowy', 'Ceremonia Purles', 'Depilacja woskiem', 'Endermologia Alliance', 'Inny - brak na liscie', 'Karboksyterapia', 'Kriolipoliza', 'Lipoliza iniekcyjna', 'Masaż', 'Meltivio', 'Mezoterapia Igłowa', 'Mezoterapia mikroigłowa', 'Modelowanie Ust', 'Peeling Cypryjski', 'Presoterapia', 'Storz', 'Stymulatory Tkankowe', 'Thermogenique', 'Żelazko', 'Oprawa Oka', 'Oczyszczanie wodorowe', 'Alma SpaDeep', 'Adipologie', 'Infuzja tlenowa', 'Zaffiro twarz', 'Zaffiro dłonie', 'Zaffiro ciało', 'Masaż Kobido', 'Peeling chemiczny', 'Koktajl Monako', 'Rytuał Flerage z endermologią twarzy', 'Vagheggi ciało', 'Vagheggi twarz', 'Mezoterapia igłowa stymulatorem', 'Ultradźwięki', 'Pielęgnacja', 'Pixel RF', 'Doplata', 'Dodatki do zabiegów'];

      pobierzKoszt(tenant_id, targetMonth, (costs) => {
        let report = {
          total: 0, costs, profit: 0,
          payments: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, TubaPay: 0, Inne: 0 },
          daily: {}, topTreatments: {}, worstTreatments: [], topEmployees: {},
          chartValues: [], daysLabels: [], compareTotal: 0,
          cosmeticsCount: 0, suplementCount: 0, // 2026-06-08 — Suplementy rozdzielone od Kosmetykow
          debugLog: [],
          _mediRatyClients: new Set(),
          _tubaPayClients: new Set()
        };

        const months = compareMonth ? [targetMonth, compareMonth] : [targetMonth];

        // Porównanie „month-to-date": gdy oglądamy bieżący (trwający) miesiąc,
        // ucinamy miesiąc porównawczy do tego samego dnia (np. 11 czerwca → maj 1–11),
        // żeby nie zestawiać niepełnego miesiąca z pełnym. Dla zamkniętych miesięcy
        // (oglądamy przeszły miesiąc) compareCutoffDay = null → pełne porównanie.
        let compareCutoffDay = null;
        if (compareMonth) {
          const now = new Date();
          const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          if (targetMonth === currentMonthStr) {
            const [cy, cm] = compareMonth.split('-').map(Number);
            const daysInCompare = new Date(cy, cm, 0).getDate(); // dni w miesiącu porównania
            compareCutoffDay = Math.min(now.getDate(), daysInCompare);
          }
        }
        report.compareCutoffDay = compareCutoffDay;

        // Magazyn lookup — Set produktów typu Witaminy (= Suplementy). Pozwala
        // rozpoznać stare sprzedaze "Kosmetyk: X" gdzie X to suplement.
        db.query(
          `SELECT DISTINCT LOWER(TRIM(nazwa_produktu)) AS nazwa FROM Magazyn WHERE tenant_id = ? AND TRIM(typ) = 'Witaminy'`,
          [tenant_id],
          (errSup, supRows) => {
            const suplementSet = new Set((supRows || []).map(r => r.nazwa));

        db.query(
          `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, status, kategoria_produktu FROM Sprzedaz WHERE tenant_id = ? AND DATE_FORMAT(data_sprzedazy, '%Y-%m') IN (?) AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY')`,
          [tenant_id, months],
          (err1, sprzedaz) => {
            (sprzedaz || []).forEach(row => {
              const dateObj = new Date(row.data_sprzedazy);
              const m = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
              const platnosc = String(row.platnosc || '').toLowerCase();
              const zabieg = String(row.zabieg || 'Inne').trim();
              const zL = zabieg.toLowerCase();
              let isSuplement = zL.includes('suplement') || String(row.kategoria_produktu || '').toLowerCase() === 'suplement';
              const isKosmetyk = isSuplement || zL.includes('kosmetyk') || zL.includes('krem');
              if (isKosmetyk && !isSuplement && suplementSet.size > 0) {
                const cleanProd = zabieg.replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim().toLowerCase();
                if (suplementSet.has(cleanProd)) isSuplement = true;
              }

              if (m === targetMonth) {
                if (isKosmetyk) {
                  if (isSuplement) report.suplementCount++;
                  else report.cosmeticsCount++;
                }
                else { if (!report.topTreatments[zabieg]) report.topTreatments[zabieg] = 0; report.topTreatments[zabieg]++; }

                // Top Pracownicy — liczone jak utarg pracownika (Analiza/Pracownik):
                // bierze TAKŻE wpisy 'mix' ze Sprzedaży, wyklucza portfel/ręczne/system.
                if (!platnosc.includes('portfel') && !platnosc.includes('ręczne') && !platnosc.includes('reczne') && !platnosc.includes('system')) {
                  const empAmt = parseAmount(row.kwota);
                  if (empAmt > 0) {
                    const empRaw = String(row.sprzedawca || '');
                    if (empRaw) {
                      const empSellers = empRaw.split(',').map(s => s.trim()).filter(Boolean);
                      if (empSellers.length > 0) {
                        const splitVal = empAmt / empSellers.length;
                        empSellers.forEach(s => { if (!report.topEmployees[s]) report.topEmployees[s] = 0; report.topEmployees[s] += splitVal; });
                      }
                    }
                  }
                }
              }

              if (platnosc === 'mix' || platnosc.includes('portfel') || platnosc.includes('ręczne') || platnosc.includes('reczne') || platnosc.includes('system')) return;
              const amount = parseAmount(row.kwota);
              if (amount === 0) return;

              if (m === targetMonth) {
                const day = String(dateObj.getDate()).padStart(2, '0');
                const method = classifyPayment(row.platnosc);
                report.total += amount; report.payments[method] += amount;
                if (method === 'MediRaty' && row.klient) report._mediRatyClients.add(String(row.klient).trim().toLowerCase());
                if (method === 'TubaPay' && row.klient) report._tubaPayClients.add(String(row.klient).trim().toLowerCase());
                if (!report.daily[day]) report.daily[day] = { total: 0, count: 0, methods: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, TubaPay: 0, Inne: 0 } };
                report.daily[day].total += amount; report.daily[day].count++; report.daily[day].methods[method] += amount;
              }
              if (compareMonth && m === compareMonth && (!compareCutoffDay || dateObj.getDate() <= compareCutoffDay)) report.compareTotal += amount;
            });

            // Platnosci mix
            db.query(
              `SELECT data_platnosci, klient, metoda_platnosci, kwota, status FROM Platnosci WHERE tenant_id = ? AND DATE_FORMAT(data_platnosci, '%Y-%m') IN (?) AND COALESCE(status, '') != 'USUNIĘTY'`,
              [tenant_id, months],
              (err2, platnosci) => {
                (platnosci || []).forEach(row => {
                  const dateObj = new Date(row.data_platnosci);
                  const m = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                  const metoda = String(row.metoda_platnosci || '').toLowerCase();
                  if (metoda.includes('portfel')) return;
                  const amount = parseAmount(row.kwota);
                  if (m === targetMonth) {
                    const method = classifyPayment(metoda);
                    const day = String(dateObj.getDate()).padStart(2, '0');
                    report.total += amount; report.payments[method] += amount;
                    if (method === 'MediRaty' && row.klient) report._mediRatyClients.add(String(row.klient).trim().toLowerCase());
                    if (method === 'TubaPay' && row.klient) report._tubaPayClients.add(String(row.klient).trim().toLowerCase());
                    if (!report.daily[day]) report.daily[day] = { total: 0, count: 0, methods: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, TubaPay: 0, Inne: 0 } };
                    report.daily[day].total += amount; report.daily[day].count++; report.daily[day].methods[method] += amount;
                  }
                  if (compareMonth && m === compareMonth && (!compareCutoffDay || dateObj.getDate() <= compareCutoffDay)) report.compareTotal += amount;
                });

                // Zadatki
                db.query(
                  `SELECT data_wplaty, kwota, metoda, pracownicy, status, typ FROM Zadatki WHERE tenant_id = ? AND DATE_FORMAT(data_wplaty, '%Y-%m') IN (?) AND typ = 'WPŁATA'`,
                  [tenant_id, months],
                  (err3, zadatki) => {
                    (zadatki || []).forEach(row => {
                      const status = String(row.status || '').toUpperCase();
                      if (status === 'USUNIĘTY' || status === 'SCALONY') return;
                      const typ = String(row.typ || '').toUpperCase();
                      if (typ !== 'WPŁATA') return;
                      const metoda = String(row.metoda || '').toLowerCase();
                      if (metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                      const dateObj = new Date(row.data_wplaty);
                      const m = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                      const amount = parseAmount(row.kwota);
                      // Zadatek opłacony Mixem ma realne kwoty w tabeli Platnosci (splity) — tam są
                      // już policzone. Pomijamy go w utargu (inaczej liczy się 2×, jak wiersz mix
                      // w Sprzedazy na linii ~611), ale niżej zachowujemy przypisanie do pracownika,
                      // bo splity Platnosci nie mają pola pracownika.
                      const isMixZadatek = metoda === 'mix';
                      if (m === targetMonth) {
                        if (!isMixZadatek) {
                          const method = classifyPayment(metoda);
                          const day = String(dateObj.getDate()).padStart(2, '0');
                          report.total += amount; report.payments[method] += amount;
                          if (!report.daily[day]) report.daily[day] = { total: 0, count: 0, methods: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, TubaPay: 0, Inne: 0 } };
                          report.daily[day].total += amount; report.daily[day].count++; report.daily[day].methods[method] += amount;
                        }

                        // Top Pracownicy — Zadatki też liczą się do utargu pracownika (jak Analiza/Pracownik)
                        if (amount > 0) {
                          const empRaw = String(row.pracownicy || '');
                          if (empRaw) {
                            const empSellers = empRaw.split(',').map(s => s.trim()).filter(Boolean);
                            if (empSellers.length > 0) {
                              const splitVal = amount / empSellers.length;
                              empSellers.forEach(s => { if (!report.topEmployees[s]) report.topEmployees[s] = 0; report.topEmployees[s] += splitVal; });
                            }
                          }
                        }
                      }
                      if (compareMonth && m === compareMonth && !isMixZadatek && (!compareCutoffDay || dateObj.getDate() <= compareCutoffDay)) report.compareTotal += amount;
                    });

                    report.profit = report.total - report.costs;
                    let worstList = [];
                    ALL_SERVICES.forEach(service => {
                      let cnt = 0;
                      for (const [sn, sc] of Object.entries(report.topTreatments)) { if (sn === service || sn.includes(service)) cnt += sc; }
                      worstList.push({ name: service, count: cnt });
                    });
                    worstList.sort((a, b) => a.count - b.count);
                    report.worstTreatments = worstList.slice(0, 10);
                    const sortedDays = Object.keys(report.daily).sort();
                    sortedDays.forEach(day => { report.daysLabels.push(day); report.chartValues.push(report.daily[day].total); });
                    report.topTreatments = Object.entries(report.topTreatments).sort((a, b) => b[1] - a[1]).slice(0, 6);
                    report.topEmployees = Object.entries(report.topEmployees).sort((a, b) => b[1] - a[1]).slice(0, 4);
                    report.mediRatyCount = report._mediRatyClients.size;
                    report.tubaPayCount = report._tubaPayClients.size;
                    delete report._mediRatyClients;
                    delete report._tubaPayClients;

                    return res.json({ status: 'success', data: report });
                  }
                );
              }
            );
          }
        );
        } // koniec callback (errSup, supRows)
      );    // koniec db.query Magazyn (suplementSet) dla get_monthly_details
      });

    } else if (action === 'get_yearly_summary' || action === 'an_get_yearly_summary') {
      const selectedYear = String(d.year);
      let summary = { months: {}, totalRevenue: 0, totalCosts: 0, totalProfit: 0 };
      for (let i = 1; i <= 12; i++) { const m = String(i).padStart(2, '0'); summary.months[m] = { rev: 0, cost: 0, profit: 0 }; }

      db.query(
        `SELECT DATE_FORMAT(data_sprzedazy, '%m') as m, SUM(kwota) as total FROM Sprzedaz WHERE tenant_id = ? AND YEAR(data_sprzedazy) = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY') AND platnosc NOT LIKE '%portfel%' AND platnosc NOT LIKE '%ręczne%' GROUP BY m`,
        [tenant_id, selectedYear],
        (err1, sRows) => {
          (sRows || []).forEach(r => { summary.months[r.m].rev += parseFloat(r.total) || 0; summary.totalRevenue += parseFloat(r.total) || 0; });

          db.query(
            `SELECT DATE_FORMAT(data_wplaty, '%m') as m, SUM(kwota) as total FROM Zadatki WHERE tenant_id = ? AND YEAR(data_wplaty) = ? AND typ = 'WPŁATA' AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY') AND metoda NOT LIKE '%ręczne%' GROUP BY m`,
            [tenant_id, selectedYear],
            (err2, zRows) => {
              (zRows || []).forEach(r => { summary.months[r.m].rev += parseFloat(r.total) || 0; summary.totalRevenue += parseFloat(r.total) || 0; });

              db.query(
                `SELECT DATE_FORMAT(data_kosztu, '%m') as m, SUM(kwota) as total FROM Koszty WHERE tenant_id = ? AND YEAR(data_kosztu) = ? GROUP BY m`,
                [tenant_id, selectedYear],
                (err3, cRows) => {
                  (cRows || []).forEach(r => { summary.months[r.m].cost += parseFloat(r.total) || 0; summary.totalCosts += parseFloat(r.total) || 0; });
                  for (let m in summary.months) { summary.months[m].profit = summary.months[m].rev - summary.months[m].cost; }
                  summary.totalProfit = summary.totalRevenue - summary.totalCosts;
                  return res.json({ status: 'success', data: summary });
                }
              );
            }
          );
        }
      );

    } else if (action === 'get_full_audit' || action === 'an_get_full_audit') {
      // Pełny audyt miesiąca/roku: KPI (przychód/koszty/zysk/marża), rozbicie usług,
      // typów zabiegów, kosmetyków, suplementów z % udziałem w OBROCIE, rozkład godzin
      // i dni tygodnia, metody płatności, oraz miesiąc-po-miesiącu (tryb roczny).
      // „Przychód/utarg" liczony spójnie z Podsumowaniem miesiąca (mix przez Platnosci,
      // pomijany w Sprzedazy/Zadatkach — inwariant finansowy d4bfcad).
      const tryb = String(d.tryb || 'miesiac');
      const okres = String(d.okres || '').trim();
      const rok = tryb === 'rok';
      if (rok ? !/^\d{4}$/.test(okres) : !/^\d{4}-\d{2}$/.test(okres)) {
        return res.json({ status: 'error', message: 'Nieprawidłowy okres.' });
      }
      const whS = rok ? `YEAR(data_sprzedazy) = ?` : `DATE_FORMAT(data_sprzedazy, '%Y-%m') = ?`;
      const whP = rok ? `YEAR(data_platnosci) = ?` : `DATE_FORMAT(data_platnosci, '%Y-%m') = ?`;
      const whZ = rok ? `YEAR(data_wplaty) = ?` : `DATE_FORMAT(data_wplaty, '%Y-%m') = ?`;
      const whK = rok ? `YEAR(data_kosztu) = ?` : `DATE_FORMAT(data_kosztu, '%Y-%m') = ?`;

      (async () => {
        try {
          const supRows = await qA(`SELECT DISTINCT LOWER(TRIM(nazwa_produktu)) AS nazwa FROM Magazyn WHERE tenant_id = ? AND TRIM(typ) = 'Witaminy'`, [tenant_id]);
          const suplementSet = new Set(supRows.map(r => r.nazwa));

          const sprzedaz = await qA(
            `SELECT data_sprzedazy, zabieg, kwota, platnosc, status, kategoria_produktu, typ_zabiegu, szczegoly
               FROM Sprzedaz WHERE tenant_id = ? AND ${whS} AND COALESCE(status,'') NOT IN ('USUNIĘTY','SCALONY')`,
            [tenant_id, okres]);
          const platnosci = await qA(
            `SELECT data_platnosci, metoda_platnosci, kwota FROM Platnosci
              WHERE tenant_id = ? AND ${whP} AND COALESCE(status,'') != 'USUNIĘTY'`,
            [tenant_id, okres]);
          const zadatki = await qA(
            `SELECT data_wplaty, kwota, metoda, status, typ FROM Zadatki
              WHERE tenant_id = ? AND ${whZ} AND typ = 'WPŁATA'`,
            [tenant_id, okres]);
          const kosztRows = await qA(`SELECT COALESCE(SUM(kwota),0) AS suma FROM Koszty WHERE tenant_id = ? AND ${whK}`, [tenant_id, okres]);
          const koszty = parseAmount((kosztRows[0] || {}).suma);

          const parsujSzt = (s) => { const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*szt/i); return m ? (parseFloat(m[1].replace(',', '.')) || 1) : 1; };
          // „Adipologie dopłata" to nie osobny zabieg, tylko dopłata do „Adipologie"
          // (zabieg rozbity na zadatek + dopłatę). Scalamy obrót do zabiegu bazowego,
          // ale dopłaty NIE liczymy jako osobnego wykonania (liczba). Sam „Dopłata" bez
          // nazwy zabiegu przed spójką zostaje osobną pozycją.
          const bazaZabiegu = (nazwa) => {
            const s = String(nazwa || '').trim();
            const m = s.match(/^(.+?)[\s\-–—:]+dop[łl]at\w*/i);
            return (m && m[1].trim()) ? { baza: m[1].trim(), doplata: true } : { baza: s, doplata: false };
          };
          const czyExcl = (p) => { const s = String(p || '').toLowerCase(); return s.includes('ręczne') || s.includes('reczne') || s.includes('system'); };
          const czyExclCash = (p) => { const s = String(p || '').toLowerCase(); return s === 'mix' || s.includes('portfel') || s.includes('ręczne') || s.includes('reczne') || s.includes('system'); };

          const uslugi = {}, typy = {}, kosmetyki = {}, suplementy = {}, godziny = {}, dni = {};
          const platMet = { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, TubaPay: 0, Inne: 0 };
          const perMonth = {};
          for (let i = 1; i <= 12; i++) perMonth[String(i).padStart(2, '0')] = { rev: 0, cost: 0 };
          let utarg = 0, obrotUslugi = 0, obrotProdukty = 0, liczbaTx = 0;

          sprzedaz.forEach(row => {
            const dt = new Date(row.data_sprzedazy);
            const amount = parseAmount(row.kwota);
            const zabieg = String(row.zabieg || 'Inne').trim();
            const zL = zabieg.toLowerCase();
            let isSup = zL.includes('suplement') || String(row.kategoria_produktu || '').toLowerCase() === 'suplement';
            const isKosm = isSup || zL.includes('kosmetyk') || zL.includes('krem');
            if (isKosm && !isSup && suplementSet.size > 0) {
              const clean = zabieg.replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim().toLowerCase();
              if (suplementSet.has(clean)) isSup = true;
            }
            const czysta = zabieg.replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim() || zabieg;

            // OBRÓT (co sprzedaliśmy) — pomija tylko techniczne (ręczne/system)
            if (!czyExcl(row.platnosc) && amount > 0) {
              const g = dt.getHours(), dz = dt.getDay();
              if (!godziny[g]) godziny[g] = { liczba: 0, obrot: 0 };
              godziny[g].liczba++; godziny[g].obrot += amount;
              if (!dni[dz]) dni[dz] = { liczba: 0, obrot: 0 };
              dni[dz].liczba++; dni[dz].obrot += amount;
              if (isKosm) {
                const bucket = isSup ? suplementy : kosmetyki;
                if (!bucket[czysta]) bucket[czysta] = { szt: 0, obrot: 0 };
                bucket[czysta].szt += parsujSzt(row.szczegoly); bucket[czysta].obrot += amount;
                obrotProdukty += amount;
              } else {
                const bz = bazaZabiegu(zabieg);
                if (!uslugi[bz.baza]) uslugi[bz.baza] = { liczba: 0, obrot: 0 };
                if (!bz.doplata) uslugi[bz.baza].liczba++;
                uslugi[bz.baza].obrot += amount;
                obrotUslugi += amount;
                const typ = String(row.typ_zabiegu || '').trim() || '— bez typu —';
                if (!typy[typ]) typy[typ] = { liczba: 0, obrot: 0 };
                if (!bz.doplata) typy[typ].liczba++;
                typy[typ].obrot += amount;
              }
            }

            // UTARG (wpływy) — jak Podsumowanie miesiąca: pomija mix/portfel/ręczne/system
            if (!czyExclCash(row.platnosc) && amount > 0) {
              platMet[classifyPayment(row.platnosc)] += amount; utarg += amount; liczbaTx++;
              perMonth[String(dt.getMonth() + 1).padStart(2, '0')].rev += amount;
            }
          });

          platnosci.forEach(row => {
            const met = String(row.metoda_platnosci || '').toLowerCase();
            if (met.includes('portfel')) return;
            const amount = parseAmount(row.kwota);
            if (amount <= 0) return;
            const dt = new Date(row.data_platnosci);
            platMet[classifyPayment(met)] += amount; utarg += amount; liczbaTx++;
            perMonth[String(dt.getMonth() + 1).padStart(2, '0')].rev += amount;
          });

          zadatki.forEach(row => {
            const status = String(row.status || '').toUpperCase();
            if (status === 'USUNIĘTY' || status === 'SCALONY') return;
            const met = String(row.metoda || '').toLowerCase();
            if (met === 'mix' || met.includes('ręczne') || met.includes('reczne') || met.includes('system')) return;
            const amount = parseAmount(row.kwota);
            if (amount <= 0) return;
            const dt = new Date(row.data_wplaty);
            platMet[classifyPayment(met)] += amount; utarg += amount; liczbaTx++;
            perMonth[String(dt.getMonth() + 1).padStart(2, '0')].rev += amount;
          });

          if (rok) {
            const kmc = await qA(`SELECT DATE_FORMAT(data_kosztu,'%m') AS m, SUM(kwota) AS total FROM Koszty WHERE tenant_id = ? AND YEAR(data_kosztu) = ? GROUP BY m`, [tenant_id, okres]);
            kmc.forEach(r => { if (perMonth[r.m]) perMonth[r.m].cost = parseAmount(r.total); });
          }

          const zaokr = (x) => Math.round((Number(x) || 0) * 100) / 100;
          const obrotItems = obrotUslugi + obrotProdukty;
          const pct = (x, base) => base > 0 ? Math.round((x / base) * 1000) / 10 : 0;

          const uslugiArr = Object.entries(uslugi).map(([nazwa, v]) => ({ nazwa, liczba: v.liczba, obrot: zaokr(v.obrot), srednia: v.liczba ? zaokr(v.obrot / v.liczba) : 0, udzial: pct(v.obrot, obrotItems) })).sort((a, b) => b.obrot - a.obrot);
          const typyArr = Object.entries(typy).map(([nazwa, v]) => ({ nazwa, liczba: v.liczba, obrot: zaokr(v.obrot), udzial: pct(v.obrot, obrotItems) })).sort((a, b) => b.obrot - a.obrot);
          const kosmArr = Object.entries(kosmetyki).map(([nazwa, v]) => ({ nazwa, szt: zaokr(v.szt), obrot: zaokr(v.obrot), udzial: pct(v.obrot, obrotItems) })).sort((a, b) => b.obrot - a.obrot);
          const supArr = Object.entries(suplementy).map(([nazwa, v]) => ({ nazwa, szt: zaokr(v.szt), obrot: zaokr(v.obrot), udzial: pct(v.obrot, obrotItems) })).sort((a, b) => b.obrot - a.obrot);
          const godzArr = []; for (let h = 0; h < 24; h++) { const g = godziny[h] || { liczba: 0, obrot: 0 }; godzArr.push({ godzina: h, liczba: g.liczba, obrot: zaokr(g.obrot) }); }
          const DNI = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
          const dniArr = [1, 2, 3, 4, 5, 6, 0].map(idx => { const g = dni[idx] || { liczba: 0, obrot: 0 }; return { dzien: DNI[idx], liczba: g.liczba, obrot: zaokr(g.obrot) }; });
          const platArr = Object.entries(platMet).filter(([, v]) => v > 0).map(([metoda, kwota]) => ({ metoda, kwota: zaokr(kwota), udzial: pct(kwota, utarg) })).sort((a, b) => b.kwota - a.kwota);

          let miesiaceArr = null;
          if (rok) {
            const NAZWY = ['', 'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
            miesiaceArr = Object.keys(perMonth).sort().map(m => {
              const rev = zaokr(perMonth[m].rev), cost = zaokr(perMonth[m].cost), zysk = zaokr(rev - cost);
              return { miesiac: NAZWY[parseInt(m, 10)], rev, cost, zysk, marza: rev > 0 ? Math.round((zysk / rev) * 1000) / 10 : 0 };
            });
          }

          const zysk = zaokr(utarg - koszty);
          return res.json({
            status: 'success', data: {
              tryb, okres,
              kpi: {
                przychod: zaokr(utarg), koszty: zaokr(koszty), zysk,
                marza: utarg > 0 ? Math.round((zysk / utarg) * 1000) / 10 : 0,
                transakcje: liczbaTx, sredniParagon: liczbaTx > 0 ? zaokr(utarg / liczbaTx) : 0,
                obrotUslugi: zaokr(obrotUslugi), obrotProdukty: zaokr(obrotProdukty)
              },
              uslugi: uslugiArr, typy: typyArr, kosmetyki: kosmArr, suplementy: supArr,
              godziny: godzArr, dni: dniArr, platnosci: platArr, miesiace: miesiaceArr
            }
          });
        } catch (e) {
          return res.json({ status: 'error', message: e.message });
        }
      })();

    } else if (action === 'get_treatment_analysis' || action === 'an_get_treatment_analysis') {
      const selectedYear = String(d.year || new Date().getFullYear());
      const selectedMonth = d.month;
      const selectedTreatment = d.treatment;

      let prevMonth = '';
      if (selectedMonth) {
        const parts = selectedMonth.split('-');
        const sY = parseInt(parts[0]), sM = parseInt(parts[1]);
        const prevD = new Date(sY, sM - 2, 1);
        prevMonth = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
      }

      // Pobierz najpierw nazwy produktów typu Witaminy (= Suplementy) z Magazyn.
      // Stare sprzedaże zapisywały wszystko jako "Kosmetyk: X" — żeby też je
      // rozpoznać jako suplementy, robimy lookup po LOWER(TRIM(nazwa)).
      db.query(
        `SELECT DISTINCT LOWER(TRIM(nazwa_produktu)) AS nazwa FROM Magazyn WHERE tenant_id = ? AND TRIM(typ) = 'Witaminy'`,
        [tenant_id],
        (errSup, supRows) => {
          const suplementSet = new Set((supRows || []).map(r => r.nazwa));

      db.query(
        `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, szczegoly FROM Sprzedaz WHERE tenant_id = ? AND YEAR(data_sprzedazy) = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY')`,
        [tenant_id, selectedYear],
        (err, sprzedaz) => {
          let result = {
            availableTreatments: [], yearlyTrendRev: { '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0, '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0 },
            dayOfWeek: [0, 0, 0, 0, 0, 0, 0], totalYearlyRevenue: 0, treatmentCountYear: 0, uniqueClientsCount: 0,
            monthRev: 0, monthCount: 0, monthTotalRev: 0, prevMonthRev: 0, topSellersArr: [],
            cosmeticsMonthRev: 0, cosmeticsMonthCount: 0, cosmeticsYearRev: 0, cosmeticsMonthTop20: [], cosmeticsTop20: [],
            // Suplementy — rozróżnione od kosmetyków po prefixie zabieg "Suplement:" lub
            // po typie='Witaminy' w Magazyn (dla starszych wpisów "Kosmetyk: X").
            suplementsMonthRev: 0, suplementsMonthCount: 0, suplementsYearRev: 0, suplementsMonthTop20: [], suplementsTop20: []
          };

          let allTreatmentsSet = new Set(), clientsSet = new Set(), topSellersMap = {};
          let cosmeticsYearMap = {}, cosmeticsMonthMap = {};
          let suplementsYearMap = {}, suplementsMonthMap = {};
          const normalizeName = (name) => String(name || 'Inne').trim().replace(/(?:\s|-)*dopłata$/i, '').trim();

          (sprzedaz || []).forEach(row => {
            const platnosc = String(row.platnosc || '').toLowerCase();
            if (platnosc.includes('ręczne') || platnosc.includes('reczne') || platnosc.includes('system')) return;
            const dateObj = new Date(row.data_sprzedazy);
            const y = String(dateObj.getFullYear());
            const mNum = String(dateObj.getMonth() + 1).padStart(2, '0');
            const mFull = y + '-' + mNum;
            const amount = parseAmount(row.kwota);
            const rawZabieg = String(row.zabieg || 'Inne').trim();
            const zabieg = normalizeName(rawZabieg);
            const klient = String(row.klient || 'Nieznany').trim();
            // Wykryj suplement: po prefixie zabieg LUB po typ='Witaminy' w Magazyn
            // (kluczowe dla starszych sprzedaży zapisanych jako "Kosmetyk: X").
            const zabiegLow = zabieg.toLowerCase();
            let isSuplement = zabiegLow.includes('suplement');
            const isKosmetyk = isSuplement || zabiegLow.includes('kosmetyk') || zabiegLow.includes('krem');
            if (isKosmetyk && !isSuplement && suplementSet.size > 0) {
              const cleanProd = rawZabieg.replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim().toLowerCase();
              if (suplementSet.has(cleanProd)) isSuplement = true;
            }

            if (amount === 0 && !isKosmetyk) return;
            if (mFull === selectedMonth && !platnosc.includes('portfel') && platnosc !== 'mix') result.monthTotalRev += amount;

            if (isKosmetyk) {
              // Czysta nazwa produktu — strip prefix zarówno dla Kosmetyk: jak i Suplement:
              const cleanName = rawZabieg.replace(/^(kosmetyk|suplement)\s*[:-]?\s*/i, '').trim() || rawZabieg;
              if (isSuplement) {
                if (y === selectedYear) {
                  result.suplementsYearRev += amount;
                  if (!suplementsYearMap[cleanName]) suplementsYearMap[cleanName] = { count: 0, rev: 0 };
                  suplementsYearMap[cleanName].count++; suplementsYearMap[cleanName].rev += amount;
                }
                if (mFull === selectedMonth) {
                  result.suplementsMonthRev += amount; result.suplementsMonthCount++;
                  if (!suplementsMonthMap[cleanName]) suplementsMonthMap[cleanName] = { count: 0, rev: 0 };
                  suplementsMonthMap[cleanName].count++; suplementsMonthMap[cleanName].rev += amount;
                }
              } else {
                if (y === selectedYear) {
                  result.cosmeticsYearRev += amount;
                  if (!cosmeticsYearMap[cleanName]) cosmeticsYearMap[cleanName] = { count: 0, rev: 0 };
                  cosmeticsYearMap[cleanName].count++; cosmeticsYearMap[cleanName].rev += amount;
                }
                if (mFull === selectedMonth) {
                  result.cosmeticsMonthRev += amount; result.cosmeticsMonthCount++;
                  if (!cosmeticsMonthMap[cleanName]) cosmeticsMonthMap[cleanName] = { count: 0, rev: 0 };
                  cosmeticsMonthMap[cleanName].count++; cosmeticsMonthMap[cleanName].rev += amount;
                }
              }
              return;
            }

            if (y === selectedYear && zabieg && !zabieg.includes('↳')) allTreatmentsSet.add(zabieg);

            if (zabieg === selectedTreatment) {
              if (y === selectedYear) {
                result.yearlyTrendRev[mNum] += amount; result.totalYearlyRevenue += amount; result.treatmentCountYear++;
                clientsSet.add(klient.toLowerCase());
                const jsDay = dateObj.getDay(); const normalDay = jsDay === 0 ? 6 : jsDay - 1; result.dayOfWeek[normalDay]++;
                const sellers = String(row.sprzedawca || '').split(',').map(s => s.trim()).filter(Boolean);
                const count = sellers.length;
                if (count > 0) { const splitAmount = amount / count; sellers.forEach(person => { if (!topSellersMap[person]) topSellersMap[person] = 0; topSellersMap[person] += splitAmount; }); }
              }
              if (mFull === selectedMonth) { result.monthRev += amount; result.monthCount++; }
              else if (mFull === prevMonth) result.prevMonthRev += amount;
            }
          });

          result.availableTreatments = Array.from(allTreatmentsSet).sort();
          result.uniqueClientsCount = clientsSet.size;
          result.topSellersArr = Object.entries(topSellersMap).sort((a, b) => b[1] - a[1]);
          const cosmYearArr = Object.entries(cosmeticsYearMap).map(([name, obj]) => ({ name, count: obj.count, rev: obj.rev })).sort((a, b) => b.rev - a.rev || b.count - a.count);
          result.cosmeticsTop20 = cosmYearArr.slice(0, 20);
          const cosmMonthArr = Object.entries(cosmeticsMonthMap).map(([name, obj]) => ({ name, count: obj.count, rev: obj.rev })).sort((a, b) => b.rev - a.rev || b.count - a.count);
          result.cosmeticsMonthTop20 = cosmMonthArr.slice(0, 20);
          // Suplementy — Top 20 rok i miesiąc (analogicznie do kosmetyków)
          const supYearArr = Object.entries(suplementsYearMap).map(([name, obj]) => ({ name, count: obj.count, rev: obj.rev })).sort((a, b) => b.rev - a.rev || b.count - a.count);
          result.suplementsTop20 = supYearArr.slice(0, 20);
          const supMonthArr = Object.entries(suplementsMonthMap).map(([name, obj]) => ({ name, count: obj.count, rev: obj.rev })).sort((a, b) => b.rev - a.rev || b.count - a.count);
          result.suplementsMonthTop20 = supMonthArr.slice(0, 20);
          return res.json({ status: 'success', data: result });
        }
      );
        } // koniec callback (errSup, supRows)
      );    // koniec db.query Magazyn (suplementSet)

    } else if (action === 'get_bi_data' || action === 'an_get_bi_data') {
      const currentYear = new Date().getFullYear();
      const nowTime = new Date().getTime();
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      let bi = { retention: { newClients: 0, returningClients: 0, newRevenue: 0, returningRevenue: 0 }, aov: { labels: [], values: [] }, crossSell: [], sleepingVips: [] };
      let clientsMap = {}, monthlyAovMap = {}, dailyBaskets = {};

      db.query(
        `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc FROM Sprzedaz WHERE tenant_id = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY')`,
        [tenant_id],
        (err, sprzedaz) => {
          if (err) return res.json({ status: 'success', data: bi });

          (sprzedaz || []).forEach(row => {
            const platnosc = String(row.platnosc || '').toLowerCase();
            if (platnosc.includes('ręczne') || platnosc.includes('reczne') || platnosc.includes('system')) return;
            const dateObj = new Date(row.data_sprzedazy);
            const yyyy = String(dateObj.getFullYear());
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const yyyy_mm = yyyy + '-' + mm;
            const dayStr = row.data_sprzedazy ? String(row.data_sprzedazy).slice(0, 10) : '';
            const amount = parseAmount(row.kwota);
            const zabieg = String(row.zabieg || 'Inne').trim().replace(/(?:\s|-)*dopłata$/i, '');
            const klient = String(row.klient || '').trim().toUpperCase();
            if (amount === 0 || !klient || klient === 'NIEZNANY' || klient === 'BRAK') return;
            if (zabieg.includes('↳') || zabieg.includes('Część Mix') || zabieg.includes('Rozliczenie Mix')) return;

            if (!clientsMap[klient]) clientsMap[klient] = { firstVisit: dateObj.getTime(), lastVisit: dateObj.getTime(), totalSpent: 0, visitDays: new Set() };
            const c = clientsMap[klient];
            if (dateObj.getTime() < c.firstVisit) c.firstVisit = dateObj.getTime();
            if (dateObj.getTime() > c.lastVisit) c.lastVisit = dateObj.getTime();
            c.totalSpent += amount; c.visitDays.add(dayStr);

            const basketKey = dayStr + '_' + klient;
            if (!dailyBaskets[basketKey]) dailyBaskets[basketKey] = [];
            dailyBaskets[basketKey].push(zabieg);

            if (!platnosc.includes('portfel')) {
              if (!monthlyAovMap[yyyy_mm]) monthlyAovMap[yyyy_mm] = { rev: 0, receipts: new Set() };
              monthlyAovMap[yyyy_mm].rev += amount; monthlyAovMap[yyyy_mm].receipts.add(basketKey);
            }
          });

          for (const klient in clientsMap) {
            const c = clientsMap[klient];
            const firstVisitYear = new Date(c.firstVisit).getFullYear();
            const isNewThisYear = (firstVisitYear === currentYear);
            if (isNewThisYear) { bi.retention.newClients++; bi.retention.newRevenue += c.totalSpent; }
            else { bi.retention.returningClients++; bi.retention.returningRevenue += c.totalSpent; }
            if (c.visitDays.size >= 2 && c.totalSpent >= 500 && (nowTime - c.lastVisit) > ninetyDaysMs) {
              const lastD = new Date(c.lastVisit).toLocaleDateString('pl-PL');
              bi.sleepingVips.push({ name: klient, spent: c.totalSpent, visits: c.visitDays.size, lastDate: lastD });
            }
          }
          bi.sleepingVips.sort((a, b) => b.spent - a.spent); bi.sleepingVips = bi.sleepingVips.slice(0, 15);

          let pairCounts = {};
          for (const key in dailyBaskets) {
            const basket = [...new Set(dailyBaskets[key])];
            if (basket.length > 1) {
              basket.sort();
              for (let i = 0; i < basket.length; i++) for (let j = i + 1; j < basket.length; j++) {
                const pairName = basket[i] + ' + ' + basket[j];
                pairCounts[pairName] = (pairCounts[pairName] || 0) + 1;
              }
            }
          }
          bi.crossSell = Object.entries(pairCounts).map(([pair, count]) => ({ pair, count })).sort((a, b) => b.count - a.count).slice(0, 10);

          let sortedMonths = Object.keys(monthlyAovMap).sort();
          if (sortedMonths.length > 12) sortedMonths = sortedMonths.slice(-12);
          sortedMonths.forEach(m => {
            const mData = monthlyAovMap[m];
            const avg = mData.receipts.size > 0 ? (mData.rev / mData.receipts.size) : 0;
            bi.aov.labels.push(m); bi.aov.values.push(avg);
          });

          return res.json({ status: 'success', data: bi });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja analityka POST: ' + action });
    }
  });

  return router;
};
