// scripts/migrate_typy_lib.js
// Wspólna biblioteka dla migracji typów zabiegów — używana przez:
//   - scripts/migrate_typy_zabiegow.js  (CLI)
//   - routes/admin.js (endpoint POST /api/admin/typy-zabiegow/migracja)
//
// Eksportuje:
//   klasyfikuj(...teksty) → string nazwa typu
//   migracjaTenanta(db, tenant_id, { apply }) → Promise<raport>
//
// Heurystyki ustalone z user'em 2026-05-04. Kolejność = priorytet.

const TYPY_HEURYSTYKI = [
  {
    typ: 'epilacja laserowa',
    keywords: ['laser', 'epilacja', 'depilacja']
  },
  {
    typ: 'medycyna estetyczna',
    keywords: [
      'botox', 'botoks', 'kwas hialur', 'wypełniacz', 'wypelniacz',
      'wolumetria', 'nucleofill', 'profhilo', 'ejal40', 'ejal 40',
      'xela rederm', 'xela', 'jalupro', 'sisthaema', 'phormae',
      'osocze', 'prp', 'mezoterapia igłowa', 'mezoterapia igl',
      'lipoliza', 'wolumetryczne', 'rekonstrukcja ust', 'redermalizacja'
    ]
  },
  {
    typ: 'stylizacja paznokci',
    keywords: [
      'manicure', 'pedicure', 'hybryda', 'hybrydowy', 'żelow', 'zelow',
      'akryl', 'tipsy', 'french', 'paznokc', 'frezark', 'zdobien'
    ]
  },
  {
    typ: 'podologia',
    keywords: [
      'podolog', 'wkrętk', 'wkretk', 'wrastając', 'wrastajac',
      'odcisk', 'modzele', 'pęknięt pięt', 'pekniet piet',
      'grzybic', 'klamr', 'tamponad'
    ]
  },
  {
    typ: 'masaże',
    keywords: [
      'masaż', 'masaz', 'lomi lomi', 'lomi-lomi', 'shiatsu',
      'drenaż limfatyczn', 'drenaz limfatyczn', 'gorącymi kamieniami',
      'goracymi kamieniami', 'aromaterapeu', 'kobido'
    ]
  },
  {
    typ: 'twarz',
    keywords: [
      'twarz', 'szyja', 'dekolt', 'oko', 'oczy', 'oczu', 'oka',
      'brwi', 'rzęs', 'rzes', 'usta', 'ust ', 'warga', 'broda',
      'podbród', 'podbrod', 'żuchw', 'zuchw', 'czoło', 'czolo', 'policzki',
      'oczyszczanie', 'infuzja', 'peeling chemiczny', 'peeling cypryjski',
      'mezoterapia bezigł', 'mezoterapia bezigl', 'mikronakłuwanie', 'mikronakluwanie',
      'stymulator', 'purles', 'pixel rf', 'monako', 'flerage', 'ultradźwięki', 'ultradzwieki',
      'lifting', 'oxybrazja', 'mikrodermabrazja', 'karboksyterapia',
      'maseczka', 'algowa', 'glass skin', 'amber glow', 'retix', 'electri',
      'ami eyes', 'geo-lifting', 'karisma', 'dermasoft',
      'henna', 'laminowan',
      'kwas'
    ]
  }
];

const TYP_DOMYSLNY = 'ciało';

function klasyfikuj(...teksty) {
  const haystack = teksty
    .filter(Boolean)
    .map(t => String(t).toLowerCase())
    .join(' | ');
  for (const heur of TYPY_HEURYSTYKI) {
    for (const kw of heur.keywords) {
      if (haystack.includes(kw)) return heur.typ;
    }
  }
  return TYP_DOMYSLNY;
}

// Wrapper db.query → Promise (bo db jest mysql2 callback-style)
function q(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

async function migracjaTenanta(db, tenant_id, { apply = false } = {}) {
  const raport = {
    tenant_id,
    apply,
    uslugi: { total: 0, perTyp: {} },
    sprzedaz: { total: 0, perTyp: {} }
  };

  // ── ETAP 1: Uslugi (cennik) ─────────────────────────────────────────
  const uslugi = await q(db,
    `SELECT id, kategoria, COALESCE(wariant, '') AS wariant
     FROM Uslugi
     WHERE tenant_id = ? AND (typ_zabiegu IS NULL OR typ_zabiegu = '')`,
    [tenant_id]
  );
  raport.uslugi.total = uslugi.length;

  for (const u of uslugi) {
    const typ = klasyfikuj(u.kategoria, u.wariant);
    raport.uslugi.perTyp[typ] = (raport.uslugi.perTyp[typ] || 0) + 1;
    if (apply) {
      await q(db, `UPDATE Uslugi SET typ_zabiegu = ? WHERE id = ?`, [typ, u.id]);
    }
  }

  // ── ETAP 2: Sprzedaz (historia, snapshot) ──────────────────────────
  const sprzedaz = await q(db,
    `SELECT id, zabieg, COALESCE(szczegoly, '') AS szczegoly
     FROM Sprzedaz
     WHERE tenant_id = ?
       AND (typ_zabiegu IS NULL OR typ_zabiegu = '')
       AND zabieg NOT LIKE 'Kosmetyk:%'
       AND COALESCE(status, '') != 'USUNIĘTY'`,
    [tenant_id]
  );
  raport.sprzedaz.total = sprzedaz.length;

  // Cache lookup z Uslugi (po apply mają już typ_zabiegu)
  const uslugiAll = await q(db,
    `SELECT TRIM(kategoria) AS kategoria, TRIM(COALESCE(wariant, '')) AS wariant, typ_zabiegu
     FROM Uslugi WHERE tenant_id = ?`,
    [tenant_id]
  );
  const uslugiIdx = {};
  for (const u of uslugiAll) {
    if (!u.typ_zabiegu) continue;
    uslugiIdx[`${u.kategoria}|${u.wariant}`] = u.typ_zabiegu;
    if (!uslugiIdx[`${u.kategoria}|`]) uslugiIdx[`${u.kategoria}|`] = u.typ_zabiegu;
  }

  for (const s of sprzedaz) {
    const zabieg = String(s.zabieg || '').trim();
    const szcz   = String(s.szczegoly || '').trim();
    let typ = null;
    typ = uslugiIdx[`${zabieg}|${szcz}`] || null;
    if (!typ) typ = uslugiIdx[`${zabieg}|`] || null;
    if (!typ) typ = klasyfikuj(zabieg, szcz);

    raport.sprzedaz.perTyp[typ] = (raport.sprzedaz.perTyp[typ] || 0) + 1;
    if (apply) {
      await q(db, `UPDATE Sprzedaz SET typ_zabiegu = ? WHERE id = ?`, [typ, s.id]);
    }
  }

  return raport;
}

async function listaTenantow(db) {
  const rows = await q(db,
    `SELECT DISTINCT tenant_id FROM Uslugi WHERE tenant_id IS NOT NULL AND tenant_id != '' ORDER BY tenant_id`
  );
  return rows.map(r => r.tenant_id);
}

module.exports = {
  klasyfikuj,
  migracjaTenanta,
  listaTenantow,
  TYP_DOMYSLNY,
  TYPY_HEURYSTYKI
};
