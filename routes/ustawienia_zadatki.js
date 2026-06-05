// routes/ustawienia_zadatki.js
// Ustawienia zadatków per salon:
//   - Tryb PROCENT (zadatek = X% kwoty zabiegu)
//   - Tryb KWOTOWY (progi: "do X zł → zadatek Y zł")
//   - Zaokrąglenie wyliczonej kwoty (0/5/10 zł)
//   - Fallback gdy zabieg powyżej najwyższego progu (OSTATNI_PROG / PROCENT / PUSTE)
//
// Endpointy:
//   GET  /api/ustawienia/zadatki?tenant_id=X
//   POST /api/ustawienia/zadatki                — zapis configu
//   POST /api/ustawienia/zadatki/prog           — dodaj próg
//   DELETE /api/ustawienia/zadatki/prog/:id?tenant_id=X
//   POST /api/ustawienia/zadatki/oblicz         — propozycja zadatku dla kwoty zabiegu

const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  // ─── Idempotentne migracje ───────────────────────────────────
  db.query(`
    CREATE TABLE IF NOT EXISTS Ustawienia_Zadatki (
      tenant_id         VARCHAR(64) PRIMARY KEY,
      tryb              ENUM('PROCENT', 'KWOTOWY') NOT NULL DEFAULT 'PROCENT',
      procent           DECIMAL(5,2) NOT NULL DEFAULT 50.00,
      zaokraglenie      INT NOT NULL DEFAULT 0,
      powyzej_max       ENUM('OSTATNI_PROG', 'PROCENT', 'PUSTE') NOT NULL DEFAULT 'PROCENT',
      fallback_procent  DECIMAL(5,2) NOT NULL DEFAULT 50.00,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, err => { if (err) console.error('[ustawienia_zadatki] CREATE TABLE Ustawienia_Zadatki:', err.message); });

  db.query(`
    CREATE TABLE IF NOT EXISTS Progi_Zadatki (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id         VARCHAR(64) NOT NULL,
      do_kwoty          DECIMAL(10,2) NOT NULL,
      zadatek_kwota     DECIMAL(10,2) NOT NULL,
      kolejnosc         INT NOT NULL DEFAULT 0,
      INDEX idx_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `, err => { if (err) console.error('[ustawienia_zadatki] CREATE TABLE Progi_Zadatki:', err.message); });

  // ─── Helper: zaokrąglenie wyliczonej kwoty ───────────────────
  function zaokraglij(kwota, krok) {
    const k = parseInt(krok) || 0;
    if (k <= 0) return Math.round(kwota * 100) / 100; // surowe, 2 miejsca
    return Math.round(kwota / k) * k;
  }

  // ─── Helper: pobierz/utwórz config dla tenanta ───────────────
  function pobierzConfig(tenant_id, cb) {
    db.query(
      `SELECT * FROM Ustawienia_Zadatki WHERE tenant_id = ? LIMIT 1`,
      [tenant_id],
      (err, rows) => {
        if (err) return cb(err);
        if (rows && rows.length) return cb(null, rows[0]);
        // Pierwsze użycie tenanta — utwórz domyślny config i zwróć
        const def = {
          tenant_id, tryb: 'PROCENT', procent: 50, zaokraglenie: 0,
          powyzej_max: 'PROCENT', fallback_procent: 50,
        };
        db.query(
          `INSERT IGNORE INTO Ustawienia_Zadatki (tenant_id) VALUES (?)`,
          [tenant_id],
          (e) => {
            if (e) console.error('[ustawienia_zadatki] insert default:', e.message);
            return cb(null, def);
          }
        );
      }
    );
  }

  // ─── GET /api/ustawienia/zadatki ─────────────────────────────
  // Zwraca aktualne ustawienia + listę progów.
  router.get('/ustawienia/zadatki', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });

    pobierzConfig(tenant_id, (err, config) => {
      if (err) return res.json({ status: 'error', message: err.message });
      db.query(
        `SELECT id, do_kwoty, zadatek_kwota, kolejnosc FROM Progi_Zadatki
         WHERE tenant_id = ? ORDER BY do_kwoty ASC`,
        [tenant_id],
        (err2, progi) => {
          if (err2) return res.json({ status: 'error', message: err2.message });
          return res.json({
            status: 'success',
            config: {
              tryb: config.tryb,
              procent: parseFloat(config.procent),
              zaokraglenie: parseInt(config.zaokraglenie),
              powyzej_max: config.powyzej_max,
              fallback_procent: parseFloat(config.fallback_procent),
            },
            progi: (progi || []).map(p => ({
              id: p.id,
              do_kwoty: parseFloat(p.do_kwoty),
              zadatek_kwota: parseFloat(p.zadatek_kwota),
              kolejnosc: p.kolejnosc,
            })),
          });
        }
      );
    });
  });

  // ─── POST /api/ustawienia/zadatki ────────────────────────────
  // Zapis configu. Body: { tenant_id, tryb, procent, zaokraglenie, powyzej_max, fallback_procent }
  router.post('/ustawienia/zadatki', (req, res) => {
    const { tenant_id, tryb, procent, zaokraglenie, powyzej_max, fallback_procent } = req.body || {};
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });

    const trybOk = ['PROCENT', 'KWOTOWY'].includes(tryb) ? tryb : 'PROCENT';
    const procentOk = Math.max(0, Math.min(100, parseFloat(procent) || 0));
    const zaokrOk = [0, 5, 10].includes(parseInt(zaokraglenie)) ? parseInt(zaokraglenie) : 0;
    const powOk = ['OSTATNI_PROG', 'PROCENT', 'PUSTE'].includes(powyzej_max) ? powyzej_max : 'PROCENT';
    const fbOk = Math.max(0, Math.min(100, parseFloat(fallback_procent) || 0));

    db.query(
      `INSERT INTO Ustawienia_Zadatki (tenant_id, tryb, procent, zaokraglenie, powyzej_max, fallback_procent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE tryb=VALUES(tryb), procent=VALUES(procent), zaokraglenie=VALUES(zaokraglenie),
         powyzej_max=VALUES(powyzej_max), fallback_procent=VALUES(fallback_procent)`,
      [tenant_id, trybOk, procentOk, zaokrOk, powOk, fbOk],
      (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', message: 'Zapisano ustawienia zadatków.' });
      }
    );
  });

  // ─── POST /api/ustawienia/zadatki/prog ───────────────────────
  // Dodaj próg. Body: { tenant_id, do_kwoty, zadatek_kwota }
  router.post('/ustawienia/zadatki/prog', (req, res) => {
    const { tenant_id, do_kwoty, zadatek_kwota } = req.body || {};
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const dk = parseFloat(do_kwoty);
    const zk = parseFloat(zadatek_kwota);
    if (!(dk > 0) || !(zk > 0)) return res.json({ status: 'error', message: 'Kwoty muszą być większe od 0.' });
    if (zk > dk) return res.json({ status: 'error', message: 'Zadatek nie może być większy niż kwota zabiegu.' });

    db.query(
      `INSERT INTO Progi_Zadatki (tenant_id, do_kwoty, zadatek_kwota, kolejnosc) VALUES (?, ?, ?, 0)`,
      [tenant_id, dk, zk],
      (err, result) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', id: result.insertId });
      }
    );
  });

  // ─── DELETE /api/ustawienia/zadatki/prog/:id ─────────────────
  router.delete('/ustawienia/zadatki/prog/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const tenant_id = req.query.tenant_id;
    if (!id || !tenant_id) return res.json({ status: 'error', message: 'Brak id lub tenant_id' });
    db.query(
      `DELETE FROM Progi_Zadatki WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, tenant_id],
      (err, result) => {
        if (err) return res.json({ status: 'error', message: err.message });
        return res.json({ status: 'success', usunieto: result.affectedRows });
      }
    );
  });

  // ─── POST /api/ustawienia/zadatki/oblicz ─────────────────────
  // Body: { tenant_id, kwota_zabiegu }
  // Zwraca: { status, zadatek_proponowany, opis, edytowalne }
  router.post('/ustawienia/zadatki/oblicz', (req, res) => {
    const { tenant_id, kwota_zabiegu } = req.body || {};
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const kwota = parseFloat(kwota_zabiegu);
    if (!(kwota > 0)) return res.json({ status: 'error', message: 'Kwota zabiegu musi być większa od 0.' });

    pobierzConfig(tenant_id, (err, config) => {
      if (err) return res.json({ status: 'error', message: err.message });

      // Tryb PROCENT — najprościej
      if (config.tryb === 'PROCENT') {
        const proc = parseFloat(config.procent) || 50;
        const surowa = kwota * proc / 100;
        const zadatek = zaokraglij(surowa, config.zaokraglenie);
        return res.json({
          status: 'success',
          zadatek_proponowany: zadatek,
          opis: `${proc}% z ${kwota.toFixed(2)} zł${parseInt(config.zaokraglenie) > 0 ? ` (zaokr. do ${config.zaokraglenie} zł)` : ''}`,
          tryb: 'PROCENT',
        });
      }

      // Tryb KWOTOWY — szukamy progu
      db.query(
        `SELECT do_kwoty, zadatek_kwota FROM Progi_Zadatki WHERE tenant_id = ? ORDER BY do_kwoty ASC`,
        [tenant_id],
        (e, progi) => {
          if (e) return res.json({ status: 'error', message: e.message });
          progi = progi || [];

          // Znajdź pierwszy próg gdzie kwota_zabiegu <= do_kwoty
          const pasujacy = progi.find(p => kwota <= parseFloat(p.do_kwoty));
          if (pasujacy) {
            const zadatek = zaokraglij(parseFloat(pasujacy.zadatek_kwota), config.zaokraglenie);
            return res.json({
              status: 'success',
              zadatek_proponowany: zadatek,
              opis: `Próg: do ${parseFloat(pasujacy.do_kwoty).toFixed(2)} zł → ${zadatek.toFixed(2)} zł`,
              tryb: 'KWOTOWY',
            });
          }

          // Kwota powyżej wszystkich progów — fallback
          if (config.powyzej_max === 'OSTATNI_PROG' && progi.length > 0) {
            const ostatni = progi[progi.length - 1];
            const zadatek = zaokraglij(parseFloat(ostatni.zadatek_kwota), config.zaokraglenie);
            return res.json({
              status: 'success',
              zadatek_proponowany: zadatek,
              opis: `Kwota powyżej max progu — użyto ostatniego (${parseFloat(ostatni.do_kwoty).toFixed(2)} zł → ${zadatek.toFixed(2)} zł)`,
              tryb: 'KWOTOWY_FALLBACK',
            });
          }
          if (config.powyzej_max === 'PROCENT') {
            const fb = parseFloat(config.fallback_procent) || 50;
            const zadatek = zaokraglij(kwota * fb / 100, config.zaokraglenie);
            return res.json({
              status: 'success',
              zadatek_proponowany: zadatek,
              opis: `Kwota powyżej max progu — fallback ${fb}% z ${kwota.toFixed(2)} zł`,
              tryb: 'KWOTOWY_FALLBACK',
            });
          }
          // PUSTE — recepcja wpisze ręcznie
          return res.json({
            status: 'success',
            zadatek_proponowany: 0,
            opis: 'Brak progu dla tej kwoty — wpisz ręcznie',
            tryb: 'KWOTOWY_FALLBACK',
          });
        }
      );
    });
  });

  return router;
};
