// routes/features.js
// Feature flags / dodatki płatne (mikropłatności)
// Akcje:
//   GET  ?action=get_features_catalog  — katalog wszystkich dodatków + flaga enabled per tenant
//   POST action=toggle_feature          — aktywacja/dezaktywacja (RBAC: manager+)
// Helper: makeHasFeature(db) — eksportowany, do użytku w innych route'ach

const express = require('express');
const { makeZapiszLog } = require('./logi');

// Cache features per tenant — 5 minut. Invalidowany przy toggle_feature.
const featureCache = new Map(); // key: `${tenant_id}` → { fetchedAt, set: Set<feature_key> }
const CACHE_TTL_MS = 5 * 60 * 1000;

function invalidateCache(tenant_id) {
  featureCache.delete(tenant_id);
}

module.exports = (db) => {
  const router = express.Router();
  const zapiszLog = makeZapiszLog(db);

  // ROLE które mogą aktywować/dezaktywować dodatki
  const ROLE_MANAGER_PLUS = new Set(['manager', 'admin', 'megaadmin']);

  // Helper: pobierz rolę pracownika (po imieniu) — RBAC backendowy
  function pobierzRole(tenant_id, imie, callback) {
    if (!imie) return callback(null);
    db.query(
      `SELECT rola FROM Użytkownicy WHERE tenant_id = ? AND TRIM(imie_login) = TRIM(?) LIMIT 1`,
      [tenant_id, imie],
      (err, rows) => {
        if (err || !rows.length) return callback(null);
        callback(String(rows[0].rola || '').toLowerCase().trim());
      }
    );
  }

  // ==========================================
  // GET /features
  // ==========================================
  router.get('/features', (req, res) => {
    const tenant_id = req.query.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = req.query.action;

    if (action === 'get_features_catalog') {
      // Pełny katalog + flaga enabled per tenant (LEFT JOIN Tenant_Features)
      db.query(
        `SELECT C.feature_key, C.nazwa, C.opis, C.miesieczna_cena_grosze, C.sortowanie,
                COALESCE(TF.enabled, 0) AS enabled, TF.activated_at, TF.activated_by
           FROM Features_Catalog C
           LEFT JOIN Tenant_Features TF ON TF.tenant_id = ? AND TF.feature_key = C.feature_key
          WHERE C.status = 'AKTYWNY'
          ORDER BY C.sortowanie ASC, C.nazwa ASC`,
        [tenant_id],
        (err, rows) => {
          if (err) return res.json({ status: 'error', message: err.message });
          return res.json({
            status: 'success',
            data: (rows || []).map(r => ({
              key: r.feature_key,
              nazwa: r.nazwa,
              opis: r.opis,
              cena_zl: (Number(r.miesieczna_cena_grosze) || 0) / 100,
              cena_grosze: Number(r.miesieczna_cena_grosze) || 0,
              enabled: r.enabled ? 1 : 0,
              activated_at: r.activated_at,
              activated_by: r.activated_by
            }))
          });
        }
      );

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja GET features: ' + action });
    }
  });

  // ==========================================
  // POST /features
  // ==========================================
  router.post('/features', (req, res) => {
    const d = req.body;
    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    const action = d.action;

    if (action === 'toggle_feature') {
      const feature_key = String(d.feature_key || '').trim();
      const enable = !!d.enable;
      const kto = String(d.user_log || d.pracownik || '').trim();
      if (!feature_key) return res.json({ status: 'error', message: 'Brak feature_key' });

      // RBAC: tylko manager / admin / megaadmin
      pobierzRole(tenant_id, kto, (rola) => {
        if (!rola || !ROLE_MANAGER_PLUS.has(rola)) {
          return res.json({ status: 'error', message: 'Brak uprawnień. Tylko manager/admin może zarządzać dodatkami.' });
        }

        // Pobierz cenę z katalogu (snapshot przy aktywacji)
        db.query(
          `SELECT nazwa, miesieczna_cena_grosze FROM Features_Catalog WHERE feature_key = ? AND status = 'AKTYWNY' LIMIT 1`,
          [feature_key],
          (e1, cRows) => {
            if (e1 || !cRows.length) return res.json({ status: 'error', message: 'Nie znaleziono dodatku w katalogu' });
            const nazwa = cRows[0].nazwa;
            const cenaGrosze = Number(cRows[0].miesieczna_cena_grosze) || 0;

            if (enable) {
              // UPSERT — aktywuj
              db.query(
                `INSERT INTO Tenant_Features (tenant_id, feature_key, enabled, monthly_price_grosze, activated_at, activated_by)
                 VALUES (?, ?, 1, ?, NOW(), ?)
                 ON DUPLICATE KEY UPDATE enabled = 1, monthly_price_grosze = VALUES(monthly_price_grosze),
                   activated_at = NOW(), activated_by = VALUES(activated_by), cancelled_at = NULL`,
                [tenant_id, feature_key, cenaGrosze, kto],
                (e2) => {
                  if (e2) return res.json({ status: 'error', message: e2.message });
                  invalidateCache(tenant_id);
                  zapiszLog(tenant_id, 'DODATEK AKTYWOWANY', kto, `${nazwa} (${feature_key}) — ${(cenaGrosze / 100).toFixed(2)} zł/mc`);
                  return res.json({ status: 'success', action: 'enabled', feature_key, cena_zl: cenaGrosze / 100 });
                }
              );
            } else {
              // Dezaktywuj
              db.query(
                `UPDATE Tenant_Features SET enabled = 0, cancelled_at = NOW() WHERE tenant_id = ? AND feature_key = ?`,
                [tenant_id, feature_key],
                (e2, result) => {
                  if (e2) return res.json({ status: 'error', message: e2.message });
                  invalidateCache(tenant_id);
                  zapiszLog(tenant_id, 'DODATEK WYLĄCZONY', kto, `${nazwa} (${feature_key})`);
                  return res.json({ status: 'success', action: 'disabled', feature_key });
                }
              );
            }
          }
        );
      });

    } else {
      return res.json({ status: 'error', message: 'Nieznana akcja features POST: ' + action });
    }
  });

  return router;
};

// Helper eksportowany do użytku w innych modułach (np. middleware requireFeature)
// Wzorzec użycia: const hasFeature = require('./features').makeHasFeature(db);
//                 if (!await hasFeature(tenant_id, 'sms_marketing')) return res.json(...)
module.exports.makeHasFeature = (db) => {
  return function hasFeature(tenant_id, feature_key, callback) {
    const cached = featureCache.get(tenant_id);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
      return callback(cached.set.has(feature_key));
    }
    db.query(
      `SELECT feature_key FROM Tenant_Features WHERE tenant_id = ? AND enabled = 1`,
      [tenant_id],
      (err, rows) => {
        const set = new Set((rows || []).map(r => r.feature_key));
        featureCache.set(tenant_id, { fetchedAt: Date.now(), set });
        callback(set.has(feature_key));
      }
    );
  };
};

// Helper: lista aktywnych features dla tenant_id (do verify_pin)
module.exports.getActiveFeatures = (db, tenant_id, callback) => {
  db.query(
    `SELECT feature_key FROM Tenant_Features WHERE tenant_id = ? AND enabled = 1`,
    [tenant_id],
    (err, rows) => {
      callback((rows || []).map(r => r.feature_key));
    }
  );
};
