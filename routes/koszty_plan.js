// routes/koszty_plan.js
// Planowanie kosztów miesięcznych ze szczegółami
// GET  /api/koszty-plan/kategorie          — lista kategorii tenanta (auto-seed przy pierwszym użyciu)
// POST /api/koszty-plan/kategorie          — dodaj nową kategorię
// PUT  /api/koszty-plan/kategorie/:id      — edytuj nazwę/typ
// DELETE /api/koszty-plan/kategorie/:id   — soft delete
// GET  /api/koszty-plan/:miesiac_rok       — dane miesiąca (kategorie + wartości)
// POST /api/koszty-plan/save               — zapisz miesiąc + aktualizuj Koszty (agregat)
// POST /api/koszty-plan/powiel             — kopiuj miesiąc X → Y

const express      = require('express');
const { randomUUID } = require('crypto');

// 50 predefiniowanych kategorii kosztów
const PREDEF = [
  { lp:  1, nazwa: 'Wynagrodzenia pracowników',                          typ: 'mieszana' },
  { lp:  2, nazwa: 'ZUS Pracowników',                                    typ: 'mieszana' },
  { lp:  3, nazwa: 'Rezerwa na chorobowe',                               typ: 'stała'    },
  { lp:  4, nazwa: 'Rezerwa na urlopy',                                  typ: 'stała'    },
  { lp:  5, nazwa: 'ZUS Twój',                                           typ: 'stała'    },
  { lp:  6, nazwa: 'Czynsz',                                             typ: 'stała'    },
  { lp:  7, nazwa: 'Media',                                              typ: 'stała'    },
  { lp:  8, nazwa: 'Prąd',                                               typ: 'stała'    },
  { lp:  9, nazwa: 'Ogrzewanie',                                         typ: 'stała'    },
  { lp: 10, nazwa: 'Ubezpieczenie',                                      typ: 'stała'    },
  { lp: 11, nazwa: 'Sprzątanie',                                         typ: 'stała'    },
  { lp: 12, nazwa: 'Podatek dochodowy PIT-5',                            typ: 'stała'    },
  { lp: 13, nazwa: 'Zdrowotna',                                          typ: 'stała'    },
  { lp: 14, nazwa: 'Podatek VAT',                                        typ: 'stała'    },
  { lp: 15, nazwa: 'Szkolenia, Konferencje',                             typ: 'stała'    },
  { lp: 16, nazwa: 'Edukacja inna np. książki, prasa',                   typ: 'stała'    },
  { lp: 17, nazwa: 'Ochrona',                                            typ: 'stała'    },
  { lp: 18, nazwa: 'Monitoring',                                         typ: 'stała'    },
  { lp: 19, nazwa: 'Terminal',                                           typ: 'mieszana' },
  { lp: 20, nazwa: 'Prowizje od transakcji online',                      typ: 'zmienna'  },
  { lp: 21, nazwa: 'Kasa Fiskalna',                                      typ: 'stała'    },
  { lp: 22, nazwa: 'Komputer, Tablet',                                   typ: 'stała'    },
  { lp: 23, nazwa: 'Serwer',                                             typ: 'stała'    },
  { lp: 24, nazwa: 'Domena',                                             typ: 'stała'    },
  { lp: 25, nazwa: 'www wykonanie i aktualizowanie',                     typ: 'stała'    },
  { lp: 26, nazwa: 'Zakupy dekoracyjne i sezonowe',                      typ: 'stała'    },
  { lp: 27, nazwa: 'Zakupy biurowe',                                     typ: 'stała'    },
  { lp: 28, nazwa: 'Zakupy kosmetyczne',                                 typ: 'stała'    },
  { lp: 29, nazwa: 'Zakupy techniczne',                                  typ: 'stała'    },
  { lp: 30, nazwa: 'Zakupy BHP',                                         typ: 'stała'    },
  { lp: 31, nazwa: 'Zakupy zw. z obsługą klienta',                      typ: 'stała'    },
  { lp: 32, nazwa: 'Drukarnia/Aplikacja do dokumentów online',           typ: 'stała'    },
  { lp: 33, nazwa: 'Internet',                                           typ: 'stała'    },
  { lp: 34, nazwa: 'Telefon komórkowy',                                  typ: 'stała'    },
  { lp: 35, nazwa: 'Wypożyczenie sprzętu',                               typ: 'stała'    },
  { lp: 36, nazwa: 'Wypożyczenie sprzętów innych',                       typ: 'stała'    },
  { lp: 37, nazwa: 'Opłata za konto, przelewy',                         typ: 'stała'    },
  { lp: 38, nazwa: 'Amortyzacja sprzętu kosm',                          typ: 'stała'    },
  { lp: 39, nazwa: 'Obsługa księgowa',                                   typ: 'mieszana' },
  { lp: 40, nazwa: 'Obsługa prawna',                                     typ: 'stała'    },
  { lp: 41, nazwa: 'Usługi zewnętrzne np. wirtualna asystentka, hydraulik', typ: 'stała' },
  { lp: 42, nazwa: 'Licencje/Subwencje',                                typ: 'stała'    },
  { lp: 43, nazwa: 'Aplikacja Booksy/Versum + smsy',                    typ: 'mieszana' },
  { lp: 44, nazwa: 'Promowanie typu Booksy/Versum',                     typ: 'mieszana' },
  { lp: 45, nazwa: 'Kredyty',                                            typ: 'mieszana' },
  { lp: 46, nazwa: 'Leasingi',                                           typ: 'stała'    },
  { lp: 47, nazwa: 'Reklama INNA',                                       typ: 'stała'    },
  { lp: 48, nazwa: 'Reklama FB/IG',                                      typ: 'stała'    },
  { lp: 49, nazwa: 'Rezerwa inwestycyjna',                               typ: 'stała'    },
  { lp: 50, nazwa: 'Kosmetyki do odsprzedaży',                          typ: 'stała'    },
];

module.exports = (db) => {
  const router = express.Router();

  function q(sql, params) {
    return new Promise((resolve, reject) =>
      db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
    );
  }

  // Inicjalizuj 50 predefiniowanych kategorii dla nowego tenanta
  async function ensureSeed(tenant_id) {
    const [{ cnt }] = await q(
      `SELECT COUNT(*) as cnt FROM Koszty_Kategorie WHERE tenant_id = ?`,
      [tenant_id]
    );
    if (cnt > 0) return;
    const now = new Date().toISOString().slice(0, 10);
    const vals = PREDEF.map(k => [randomUUID(), tenant_id, k.lp, k.nazwa, k.typ, 1, 1, now]);
    await q(
      `INSERT INTO Koszty_Kategorie (id, tenant_id, lp, nazwa, typ, aktywna, predefiniowana, data_dodania) VALUES ?`,
      [vals]
    );
  }

  // Aktualizuj agregat w tabeli Koszty po zapisaniu szczegółów
  async function syncAgregat(tenant_id, miesiac_rok) {
    const [{ total }] = await q(
      `SELECT COALESCE(SUM(czesc_stala + czesc_zmienna), 0) as total
       FROM Koszty_Szczegoly WHERE tenant_id = ? AND miesiac_rok = ?`,
      [tenant_id, miesiac_rok]
    );
    const kwota = parseFloat(total) || 0;
    const existing = await q(
      `SELECT id FROM Koszty WHERE tenant_id = ? AND DATE_FORMAT(data_kosztu,'%Y-%m') = ?`,
      [tenant_id, miesiac_rok]
    );
    if (existing.length > 0) {
      await q(`UPDATE Koszty SET kwota = ? WHERE id = ?`, [kwota, existing[0].id]);
    } else {
      await q(
        `INSERT INTO Koszty (id, tenant_id, data_kosztu, kwota, opis) VALUES (?,?,?,?,'Planowane koszty')`,
        [randomUUID(), tenant_id, miesiac_rok + '-01', kwota]
      );
    }
    return kwota;
  }

  // ── GET /api/koszty-plan/lista — lista miesięcy z sumami ────
  router.get('/koszty-plan/lista', async (req, res) => {
    const { tenant_id } = req.query;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    try {
      // Najwcześniejszy miesiąc z wpisem w Koszty lub Koszty_Szczegoly
      const [earliest] = await q(
        `SELECT DATE_FORMAT(MIN(data_kosztu), '%Y-%m') as min_m FROM Koszty WHERE tenant_id = ?`,
        [tenant_id]
      );
      const now   = new Date();
      const endY  = now.getFullYear();
      const endM  = now.getMonth() + 1;

      let startY, startM;
      if (earliest.min_m) {
        [startY, startM] = earliest.min_m.split('-').map(Number);
      } else {
        // Brak historii — pokaż ostatnie 12 miesięcy
        const d = new Date(now);
        d.setMonth(d.getMonth() - 11);
        startY = d.getFullYear();
        startM = d.getMonth() + 1;
      }

      // Pobierz sumy ze szczegółów (per miesiąc)
      const sumy = await q(
        `SELECT miesiac_rok,
                SUM(czesc_stala)   as suma_stala,
                SUM(czesc_zmienna) as suma_zmienna,
                SUM(czesc_stala + czesc_zmienna) as suma_razem
         FROM Koszty_Szczegoly WHERE tenant_id = ?
         GROUP BY miesiac_rok`,
        [tenant_id]
      );
      const mapaSum = {};
      sumy.forEach(s => { mapaSum[s.miesiac_rok] = s; });

      // Wygeneruj pełny zakres miesięcy
      const miesiac_lista = [];
      let y = startY, m = startM;
      while (y < endY || (y === endY && m <= endM)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const s = mapaSum[key];
        miesiac_lista.push({
          miesiac_rok:   key,
          suma_stala:    s ? parseFloat(s.suma_stala)   : null,
          suma_zmienna:  s ? parseFloat(s.suma_zmienna) : null,
          suma_razem:    s ? parseFloat(s.suma_razem)   : null,
          ma_dane:       !!s,
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }

      return res.json({ status: 'ok', data: miesiac_lista.reverse() }); // najnowsze pierwsze
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── GET /api/koszty-plan/kategorie ──────────────────────────
  router.get('/koszty-plan/kategorie', async (req, res) => {
    const { tenant_id } = req.query;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    try {
      await ensureSeed(tenant_id);
      const rows = await q(
        `SELECT id, lp, nazwa, typ, predefiniowana, data_dodania
         FROM Koszty_Kategorie WHERE tenant_id = ? AND aktywna = 1 ORDER BY lp`,
        [tenant_id]
      );
      return res.json({ status: 'ok', data: rows });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── POST /api/koszty-plan/kategorie — dodaj nową ────────────
  router.post('/koszty-plan/kategorie', async (req, res) => {
    const { tenant_id, nazwa, typ } = req.body;
    if (!tenant_id || !nazwa || !typ)
      return res.json({ status: 'error', message: 'Brak danych' });
    try {
      const [{ max_lp }] = await q(
        `SELECT COALESCE(MAX(lp), 50) as max_lp FROM Koszty_Kategorie WHERE tenant_id = ?`,
        [tenant_id]
      );
      const lp  = max_lp + 1;
      const now = new Date().toISOString().slice(0, 10);
      const id  = randomUUID();
      await q(
        `INSERT INTO Koszty_Kategorie (id, tenant_id, lp, nazwa, typ, aktywna, predefiniowana, data_dodania) VALUES (?,?,?,?,?,1,0,?)`,
        [id, tenant_id, lp, nazwa, typ, now]
      );
      return res.json({ status: 'ok', id, lp, nazwa, typ });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── PUT /api/koszty-plan/kategorie/:id — edytuj ─────────────
  router.put('/koszty-plan/kategorie/:id', async (req, res) => {
    const { tenant_id, nazwa, typ } = req.body;
    const { id } = req.params;
    if (!tenant_id || !nazwa || !typ)
      return res.json({ status: 'error', message: 'Brak danych' });
    try {
      await q(
        `UPDATE Koszty_Kategorie SET nazwa = ?, typ = ? WHERE id = ? AND tenant_id = ?`,
        [nazwa, typ, id, tenant_id]
      );
      return res.json({ status: 'ok' });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── DELETE /api/koszty-plan/kategorie/:id — soft delete ─────
  router.delete('/koszty-plan/kategorie/:id', async (req, res) => {
    const { tenant_id } = req.query;
    const { id } = req.params;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    try {
      await q(
        `UPDATE Koszty_Kategorie SET aktywna = 0 WHERE id = ? AND tenant_id = ?`,
        [id, tenant_id]
      );
      return res.json({ status: 'ok' });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── GET /api/koszty-plan/:miesiac_rok — dane miesiąca ───────
  router.get('/koszty-plan/:miesiac_rok', async (req, res) => {
    const { tenant_id } = req.query;
    const { miesiac_rok } = req.params;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    if (!/^\d{4}-\d{2}$/.test(miesiac_rok))
      return res.json({ status: 'error', message: 'Nieprawidłowy format miesiąca' });
    try {
      await ensureSeed(tenant_id);
      // Kategorie aktywne i dodane do końca wybranego miesiąca
      const kategorie = await q(
        `SELECT id, lp, nazwa, typ FROM Koszty_Kategorie
         WHERE tenant_id = ? AND aktywna = 1 AND data_dodania <= ?
         ORDER BY lp`,
        [tenant_id, miesiac_rok + '-28']
      );
      // Istniejące wartości dla tego miesiąca
      const szczegoly = await q(
        `SELECT kategoria_id, czesc_stala, czesc_zmienna FROM Koszty_Szczegoly
         WHERE tenant_id = ? AND miesiac_rok = ?`,
        [tenant_id, miesiac_rok]
      );
      const mapa = {};
      szczegoly.forEach(s => { mapa[s.kategoria_id] = s; });

      const rows = kategorie.map(k => ({
        id:           k.id,
        lp:           k.lp,
        nazwa:        k.nazwa,
        typ:          k.typ,
        czesc_stala:  mapa[k.id] ? parseFloat(mapa[k.id].czesc_stala)   : 0,
        czesc_zmienna: mapa[k.id] ? parseFloat(mapa[k.id].czesc_zmienna) : 0,
      }));

      return res.json({ status: 'ok', data: rows, miesiac_rok });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── POST /api/koszty-plan/save — zapisz miesiąc ─────────────
  router.post('/koszty-plan/save', async (req, res) => {
    const { tenant_id, miesiac_rok, rows } = req.body;
    if (!tenant_id || !miesiac_rok || !Array.isArray(rows))
      return res.json({ status: 'error', message: 'Brak danych' });
    try {
      for (const row of rows) {
        const stala    = parseFloat(row.czesc_stala)    || 0;
        const zmienna  = parseFloat(row.czesc_zmienna)  || 0;
        const istniejacy = await q(
          `SELECT id FROM Koszty_Szczegoly
           WHERE tenant_id = ? AND miesiac_rok = ? AND kategoria_id = ?`,
          [tenant_id, miesiac_rok, row.id]
        );
        if (istniejacy.length > 0) {
          await q(
            `UPDATE Koszty_Szczegoly SET czesc_stala = ?, czesc_zmienna = ?
             WHERE tenant_id = ? AND miesiac_rok = ? AND kategoria_id = ?`,
            [stala, zmienna, tenant_id, miesiac_rok, row.id]
          );
        } else {
          await q(
            `INSERT INTO Koszty_Szczegoly (id, tenant_id, miesiac_rok, kategoria_id, czesc_stala, czesc_zmienna)
             VALUES (?,?,?,?,?,?)`,
            [randomUUID(), tenant_id, miesiac_rok, row.id, stala, zmienna]
          );
        }
      }
      const kwota = await syncAgregat(tenant_id, miesiac_rok);
      return res.json({ status: 'ok', kwota });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  // ── POST /api/koszty-plan/powiel — kopiuj miesiąc X → Y ─────
  router.post('/koszty-plan/powiel', async (req, res) => {
    const { tenant_id, z_miesiaca, na_miesiac } = req.body;
    if (!tenant_id || !z_miesiaca || !na_miesiac)
      return res.json({ status: 'error', message: 'Brak danych' });
    try {
      const zrodlo = await q(
        `SELECT kategoria_id, czesc_stala, czesc_zmienna FROM Koszty_Szczegoly
         WHERE tenant_id = ? AND miesiac_rok = ?`,
        [tenant_id, z_miesiaca]
      );
      if (!zrodlo.length)
        return res.json({ status: 'error', message: 'Brak zapisanych danych dla wybranego miesiąca.' });

      // Wyczyść docelowy miesiąc
      await q(
        `DELETE FROM Koszty_Szczegoly WHERE tenant_id = ? AND miesiac_rok = ?`,
        [tenant_id, na_miesiac]
      );

      // Kopiuj tylko kategorie aktywne w docelowym miesiącu
      for (const row of zrodlo) {
        const aktywna = await q(
          `SELECT id FROM Koszty_Kategorie
           WHERE id = ? AND tenant_id = ? AND aktywna = 1 AND data_dodania <= ?`,
          [row.kategoria_id, tenant_id, na_miesiac + '-28']
        );
        if (!aktywna.length) continue;
        await q(
          `INSERT INTO Koszty_Szczegoly (id, tenant_id, miesiac_rok, kategoria_id, czesc_stala, czesc_zmienna)
           VALUES (?,?,?,?,?,?)`,
          [randomUUID(), tenant_id, na_miesiac, row.kategoria_id, row.czesc_stala, row.czesc_zmienna]
        );
      }

      const kwota = await syncAgregat(tenant_id, na_miesiac);
      return res.json({ status: 'ok', kwota });
    } catch(e) { return res.json({ status: 'error', message: e.message }); }
  });

  return router;
};
