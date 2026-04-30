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
    if (s.includes('mediraty') || s.includes('raty')) return 'MediRaty';
    return 'Inne';
  };

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

        // Sprzedaż
        db.query(
          `SELECT id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, status FROM Sprzedaz WHERE tenant_id = ? AND DATE(data_sprzedazy) = ? AND COALESCE(status, '') != 'USUNIĘTY'`,
          [tenant_id, dataStr],
          (err2, sprzedaz) => {
            (sprzedaz || []).forEach(row => {
              const platnosc = String(row.platnosc || '').toLowerCase();
              if (platnosc.includes('portfel')) return;
              wynik.push({
                typ_rekordu: 'sprzedaz',
                timestamp: new Date(row.data_sprzedazy).getTime(),
                baseId: getBaseId(row.id),
                godzina: String(row.data_sprzedazy).slice(11, 16),
                klient: row.klient,
                zabieg: row.zabieg,
                sprzedawca: row.sprzedawca,
                kwota: row.kwota,
                platnosc: row.platnosc
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
      // Sprzedaż główna
      db.query(
        `SELECT id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, szczegoly FROM Sprzedaz WHERE tenant_id = ? AND DATE_FORMAT(data_sprzedazy, '%Y-%m') = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY')`,
        [tenant_id, selectedMonth],
        (err1, sprzedaz) => {
          db.query(
            `SELECT data_wplaty, klient, kwota, metoda, pracownicy, status, typ, cel FROM Zadatki WHERE tenant_id = ? AND DATE_FORMAT(data_wplaty, '%Y-%m') = ?`,
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

              const initEmp = (person) => ({
                name: person, total: 0, zabiegi: 0, kosmetyki: 0, qty_kosmetyki: 0,
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
                const isKosmetyk = zabieg.toLowerCase().includes('kosmetyk') || zabieg.toLowerCase().includes('krem');
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

                  // Sumy finansowe — pomijamy dla Portfel
                  if (!isPortfel) {
                    e.total += splitAmount; e.transakcje += (1 / count);
                    if (isKosmetyk) e.kosmetyki += splitAmount;
                    else e.zabiegi += splitAmount;

                    if (dateObj) {
                      const day = `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                      e.transactionsList.push({ service: zabieg, val: splitAmount, date: day });
                      const receiptKey = `${day}_${klient.toUpperCase()}`;
                      if (!e.virtualReceipts[receiptKey]) e.virtualReceipts[receiptKey] = { client: klient, date: day, total: 0, items: [] };
                      e.virtualReceipts[receiptKey].total += splitAmount;
                      e.virtualReceipts[receiptKey].items.push(zabieg.replace(/(?:\s|-)*dopłata$/i, '').trim());
                    }
                  }

                  // qty_kosmetyki — fizyczna ilość sprzedanych sztuk, niezależnie od metody
                  if (isKosmetyk) {
                    e.qty_kosmetyki += (ilosc / count);
                  }

                  // Top 5 — uwzględnia Portfel; dedup po (baseId, zabieg) eliminuje
                  // podwójne liczenie tego samego zabiegu rozbitego na pozycje multi-sale
                  const topKey = `${baseId}|${zabieg}`;
                  if (!e._topReceipts.has(topKey)) {
                    e._topReceipts.add(topKey);
                    if (!e.top[zabieg]) e.top[zabieg] = 0;
                    e.top[zabieg] += isKosmetyk ? ilosc : 1;
                  }

                  // wykonaneZabiegi — dla worstTreatments (tylko zabiegi, nie kosmetyki).
                  // Klucz "kategoria||wariant" pasuje do struktury tabeli Uslugi.
                  if (!isKosmetyk) {
                    const wariant = String(szczegoly || '').trim();
                    e.wykonaneZabiegi.add(`${zabieg}||${wariant}`);
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
                if (status === 'USUNIĘTY' || status === 'SCALONY' || typ !== 'WPŁATA') return;
                if (metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                const amount = parseAmount(row.kwota);
                if (amount === 0) return;
                stats.totalRevenue += amount; stats.count++;
                stats.categorySplit['Zabiegi'] += amount;
                const sellers = String(row.pracownicy || '').split(',').map(s => s.trim()).filter(Boolean);
                const count = sellers.length;
                if (count > 0) {
                  const splitAmount = amount / count;
                  sellers.forEach(person => {
                    if (!empTemp[person]) empTemp[person] = initEmp(person);
                    const e = empTemp[person];
                    e.total += splitAmount; e.transakcje += (1 / count); e.zabiegi += splitAmount;
                    if (!e.top['Wpłata Zadatku']) e.top['Wpłata Zadatku'] = 0; e.top['Wpłata Zadatku'] += (1 / count);
                    e.transactionsList.push({ service: 'Zadatek: ' + String(row.cel || ''), val: splitAmount, date: '' });
                  });
                }
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

                  stats.employeeDetails = empTemp;
                  stats.rankingPracownikow = Object.values(empTemp).sort((a, b) => b.total - a.total);
                  return res.json({ status: 'success', data: stats });
                }
              );
            }
          );
        }
      );

    } else if (action === 'get_monthly_details' || action === 'an_get_monthly_details') {
      const targetMonth = d.month;
      const compareMonth = d.compareMonth;
      const ALL_SERVICES = ['Endermologia Infinity', 'Arosha', 'Bon podarunkowy', 'Ceremonia Purles', 'Depilacja woskiem', 'Endermologia Alliance', 'Inny - brak na liscie', 'Karboksyterapia', 'Kriolipoliza', 'Lipoliza iniekcyjna', 'Masaż', 'Meltivio', 'Mezoterapia Igłowa', 'Mezoterapia mikroigłowa', 'Modelowanie Ust', 'Peeling Cypryjski', 'Presoterapia', 'Storz', 'Stymulatory Tkankowe', 'Thermogenique', 'Żelazko', 'Oprawa Oka', 'Oczyszczanie wodorowe', 'Alma SpaDeep', 'Adipologie', 'Infuzja tlenowa', 'Zaffiro twarz', 'Zaffiro dłonie', 'Zaffiro ciało', 'Masaż Kobido', 'Peeling chemiczny', 'Koktajl Monako', 'Rytuał Flerage z endermologią twarzy', 'Vagheggi ciało', 'Vagheggi twarz', 'Mezoterapia igłowa stymulatorem', 'Ultradźwięki', 'Pielęgnacja', 'Pixel RF', 'Doplata', 'Dodatki do zabiegów'];

      pobierzKoszt(tenant_id, targetMonth, (costs) => {
        let report = {
          total: 0, costs, profit: 0,
          payments: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, Inne: 0 },
          daily: {}, topTreatments: {}, worstTreatments: [], topEmployees: {},
          chartValues: [], daysLabels: [], compareTotal: 0, cosmeticsCount: 0, debugLog: [],
          _mediRatyClients: new Set()
        };

        const months = compareMonth ? [targetMonth, compareMonth] : [targetMonth];

        db.query(
          `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, status FROM Sprzedaz WHERE tenant_id = ? AND DATE_FORMAT(data_sprzedazy, '%Y-%m') IN (?) AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY')`,
          [tenant_id, months],
          (err1, sprzedaz) => {
            (sprzedaz || []).forEach(row => {
              const dateObj = new Date(row.data_sprzedazy);
              const m = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
              const platnosc = String(row.platnosc || '').toLowerCase();
              const zabieg = String(row.zabieg || 'Inne').trim();
              const isKosmetyk = zabieg.toLowerCase().includes('kosmetyk') || zabieg.toLowerCase().includes('krem');

              if (m === targetMonth) {
                if (isKosmetyk) report.cosmeticsCount++;
                else { if (!report.topTreatments[zabieg]) report.topTreatments[zabieg] = 0; report.topTreatments[zabieg]++; }
              }

              if (platnosc === 'mix' || platnosc.includes('portfel') || platnosc.includes('ręczne') || platnosc.includes('reczne') || platnosc.includes('system')) return;
              const amount = parseAmount(row.kwota);
              if (amount === 0) return;

              if (m === targetMonth) {
                const day = String(dateObj.getDate()).padStart(2, '0');
                const method = classifyPayment(row.platnosc);
                report.total += amount; report.payments[method] += amount;
                if (method === 'MediRaty' && row.klient) report._mediRatyClients.add(String(row.klient).trim().toLowerCase());
                if (!report.daily[day]) report.daily[day] = { total: 0, count: 0, methods: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, Inne: 0 } };
                report.daily[day].total += amount; report.daily[day].count++; report.daily[day].methods[method] += amount;
                const rawSellers = String(row.sprzedawca || '');
                if (rawSellers) {
                  const sellers = rawSellers.split(',').map(s => s.trim()).filter(Boolean);
                  const count = sellers.length;
                  if (count > 0) {
                    const splitVal = amount / count;
                    sellers.forEach(s => { if (!report.topEmployees[s]) report.topEmployees[s] = 0; report.topEmployees[s] += splitVal; });
                  }
                }
              }
              if (compareMonth && m === compareMonth) report.compareTotal += amount;
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
                    if (!report.daily[day]) report.daily[day] = { total: 0, count: 0, methods: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, Inne: 0 } };
                    report.daily[day].total += amount; report.daily[day].count++; report.daily[day].methods[method] += amount;
                  }
                  if (compareMonth && m === compareMonth) report.compareTotal += amount;
                });

                // Zadatki
                db.query(
                  `SELECT data_wplaty, kwota, metoda, pracownicy, status, typ FROM Zadatki WHERE tenant_id = ? AND DATE_FORMAT(data_wplaty, '%Y-%m') IN (?) AND typ = 'WPŁATA'`,
                  [tenant_id, months],
                  (err3, zadatki) => {
                    (zadatki || []).forEach(row => {
                      const status = String(row.status || '').toUpperCase();
                      if (status === 'USUNIĘTY') return;
                      const metoda = String(row.metoda || '').toLowerCase();
                      if (metoda.includes('ręczne') || metoda.includes('reczne') || metoda.includes('system')) return;
                      const dateObj = new Date(row.data_wplaty);
                      const m = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                      const amount = parseAmount(row.kwota);
                      if (m === targetMonth) {
                        const method = classifyPayment(metoda);
                        const day = String(dateObj.getDate()).padStart(2, '0');
                        report.total += amount; report.payments[method] += amount;
                        if (!report.daily[day]) report.daily[day] = { total: 0, count: 0, methods: { Gotówka: 0, Karta: 0, Blik: 0, Przelew: 0, MediRaty: 0, Inne: 0 } };
                        report.daily[day].total += amount; report.daily[day].count++; report.daily[day].methods[method] += amount;
                      }
                      if (compareMonth && m === compareMonth) report.compareTotal += amount;
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
                    delete report._mediRatyClients;

                    return res.json({ status: 'success', data: report });
                  }
                );
              }
            );
          }
        );
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

      db.query(
        `SELECT data_sprzedazy, klient, zabieg, sprzedawca, kwota, platnosc, szczegoly FROM Sprzedaz WHERE tenant_id = ? AND YEAR(data_sprzedazy) = ? AND COALESCE(status, '') NOT IN ('USUNIĘTY', 'SCALONY')`,
        [tenant_id, selectedYear],
        (err, sprzedaz) => {
          let result = {
            availableTreatments: [], yearlyTrendRev: { '01': 0, '02': 0, '03': 0, '04': 0, '05': 0, '06': 0, '07': 0, '08': 0, '09': 0, '10': 0, '11': 0, '12': 0 },
            dayOfWeek: [0, 0, 0, 0, 0, 0, 0], totalYearlyRevenue: 0, treatmentCountYear: 0, uniqueClientsCount: 0,
            monthRev: 0, monthCount: 0, monthTotalRev: 0, prevMonthRev: 0, topSellersArr: [],
            cosmeticsMonthRev: 0, cosmeticsMonthCount: 0, cosmeticsYearRev: 0, cosmeticsMonthTop20: [], cosmeticsTop20: []
          };

          let allTreatmentsSet = new Set(), clientsSet = new Set(), topSellersMap = {}, cosmeticsYearMap = {}, cosmeticsMonthMap = {};
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
            const isKosmetyk = zabieg.toLowerCase().includes('kosmetyk') || zabieg.toLowerCase().includes('krem');

            if (amount === 0 && !isKosmetyk) return;
            if (mFull === selectedMonth && !platnosc.includes('portfel') && platnosc !== 'mix') result.monthTotalRev += amount;

            if (isKosmetyk) {
              const cleanCosm = rawZabieg.replace(/^kosmetyk\s*[:-]?\s*/i, '').trim() || rawZabieg;
              if (y === selectedYear) {
                result.cosmeticsYearRev += amount;
                if (!cosmeticsYearMap[cleanCosm]) cosmeticsYearMap[cleanCosm] = { count: 0, rev: 0 };
                cosmeticsYearMap[cleanCosm].count++; cosmeticsYearMap[cleanCosm].rev += amount;
              }
              if (mFull === selectedMonth) {
                result.cosmeticsMonthRev += amount; result.cosmeticsMonthCount++;
                if (!cosmeticsMonthMap[cleanCosm]) cosmeticsMonthMap[cleanCosm] = { count: 0, rev: 0 };
                cosmeticsMonthMap[cleanCosm].count++; cosmeticsMonthMap[cleanCosm].rev += amount;
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
          return res.json({ status: 'success', data: result });
        }
      );

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
