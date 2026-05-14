// routes/features.js
// Feature flags / dodatki płatne (mikropłatności)
// Akcje:
//   GET  ?action=get_features_catalog  — katalog wszystkich dodatków + flaga enabled per tenant
//   POST action=toggle_feature          — aktywacja/dezaktywacja (RBAC: manager+)
// Helper: makeHasFeature(db) — eksportowany, do użytku w innych route'ach

const express = require('express');
const { makeZapiszLog } = require('./logi');

// Stripe SDK — opcjonalne. Gdy brak env (lub salon bez subscription_id) → fallback do trybu DB-only.
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch (e) {
  console.warn('[features] Stripe SDK niedostępny:', e.message);
}

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

        // Pobierz: 1) cenę z katalogu (snapshot) + stripe_price_id; 2) sub_id salonu z Licencje
        db.query(
          `SELECT nazwa, miesieczna_cena_grosze, stripe_price_id FROM Features_Catalog WHERE feature_key = ? AND status = 'AKTYWNY' LIMIT 1`,
          [feature_key],
          (e1, cRows) => {
            if (e1 || !cRows.length) return res.json({ status: 'error', message: 'Nie znaleziono dodatku w katalogu' });
            const nazwa = cRows[0].nazwa;
            const cenaGrosze = Number(cRows[0].miesieczna_cena_grosze) || 0;
            const stripePriceId = cRows[0].stripe_price_id || null;

            db.query(
              `SELECT stripe_customer_id, stripe_subscription_id FROM Licencje WHERE id_bazy = ? LIMIT 1`,
              [tenant_id],
              (eL, lRows) => {
                const subscriptionId = (lRows && lRows[0] && lRows[0].stripe_subscription_id) || null;
                const stripeManaged = !!(stripe && subscriptionId && stripePriceId);

                // Pobierz istniejący item_id (jeśli już aktywowany kiedyś)
                db.query(
                  `SELECT stripe_item_id FROM Tenant_Features WHERE tenant_id = ? AND feature_key = ? LIMIT 1`,
                  [tenant_id, feature_key],
                  (eI, iRows) => {
                    const existingItemId = (iRows && iRows[0] && iRows[0].stripe_item_id) || null;

                    const finishEnable = (newItemId) => {
                      db.query(
                        `INSERT INTO Tenant_Features (tenant_id, feature_key, enabled, monthly_price_grosze, stripe_item_id, activated_at, activated_by)
                         VALUES (?, ?, 1, ?, ?, NOW(), ?)
                         ON DUPLICATE KEY UPDATE enabled = 1, monthly_price_grosze = VALUES(monthly_price_grosze),
                           stripe_item_id = VALUES(stripe_item_id),
                           activated_at = NOW(), activated_by = VALUES(activated_by), cancelled_at = NULL`,
                        [tenant_id, feature_key, cenaGrosze, newItemId, kto],
                        (e2) => {
                          if (e2) return res.json({ status: 'error', message: e2.message });
                          invalidateCache(tenant_id);
                          zapiszLog(tenant_id, 'DODATEK AKTYWOWANY', kto,
                            `${nazwa} (${feature_key}) — ${(cenaGrosze / 100).toFixed(2)} zł/mc${newItemId ? ' [Stripe item: ' + newItemId + ']' : ' [tryb DB-only]'}`);
                          return res.json({ status: 'success', action: 'enabled', feature_key, cena_zl: cenaGrosze / 100, stripe_managed: !!newItemId });
                        }
                      );
                    };

                    const finishDisable = () => {
                      db.query(
                        `UPDATE Tenant_Features SET enabled = 0, stripe_item_id = NULL, cancelled_at = NOW() WHERE tenant_id = ? AND feature_key = ?`,
                        [tenant_id, feature_key],
                        (e2) => {
                          if (e2) return res.json({ status: 'error', message: e2.message });
                          invalidateCache(tenant_id);
                          zapiszLog(tenant_id, 'DODATEK WYLĄCZONY', kto, `${nazwa} (${feature_key})`);
                          return res.json({ status: 'success', action: 'disabled', feature_key });
                        }
                      );
                    };

                    if (enable) {
                      // AKTYWACJA
                      if (!stripeManaged) {
                        // Salon bez Stripe Subscription (np. testowy/migracyjny) — tylko DB
                        return finishEnable(null);
                      }
                      // Stripe — dodaj Subscription Item
                      stripe.subscriptionItems.create({
                        subscription: subscriptionId,
                        price: stripePriceId,
                        quantity: 1,
                      }).then(item => {
                        console.log(`[features] Stripe item created: ${item.id} for ${tenant_id}/${feature_key}`);
                        finishEnable(item.id);
                      }).catch(err => {
                        console.error(`[features] Stripe error (enable ${feature_key}):`, err.message);
                        return res.json({ status: 'error', message: 'Błąd Stripe: ' + err.message });
                      });
                    } else {
                      // DEZAKTYWACJA
                      if (!stripeManaged || !existingItemId) {
                        // Brak Stripe item lub salon bez Stripe — tylko DB
                        return finishDisable();
                      }
                      stripe.subscriptionItems.del(existingItemId).then(() => {
                        console.log(`[features] Stripe item deleted: ${existingItemId} for ${tenant_id}/${feature_key}`);
                        finishDisable();
                      }).catch(err => {
                        // Jeśli item już nie istnieje (np. usunięty z Stripe dashboard) — kontynuuj dezaktywację w bazie
                        if (err.code === 'resource_missing') {
                          console.warn(`[features] Stripe item ${existingItemId} już nie istnieje — usuwam z bazy.`);
                          return finishDisable();
                        }
                        console.error(`[features] Stripe error (disable ${feature_key}):`, err.message);
                        return res.json({ status: 'error', message: 'Błąd Stripe: ' + err.message });
                      });
                    }
                  }
                );
              }
            );
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
