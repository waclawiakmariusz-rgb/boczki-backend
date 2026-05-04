// scripts/migrate_typy_zabiegow.js
// ─────────────────────────────────────────────────────────────────────────
// Jednorazowa migracja: wypełnia kolumny `typ_zabiegu` w tabelach `Uslugi`
// (cennik) i `Sprzedaz` (historia) na podstawie heurystyk po nazwie.
//
// Schemat bazy musi być już zaktualizowany przez routes/typy_zabiegow.js
// (CREATE TABLE Typy_Zabiegow + ALTER TABLE ADD COLUMN typ_zabiegu).
// To załatwia commit 1/4 — uruchom po jego deployu.
//
// UŻYCIE:
//   node scripts/migrate_typy_zabiegow.js                    # dry-run wszystkie tenanty
//   node scripts/migrate_typy_zabiegow.js --tenant=demo-estelio
//   node scripts/migrate_typy_zabiegow.js --apply --tenant=demo-estelio
//   node scripts/migrate_typy_zabiegow.js --apply            # wszystkie tenanty (UWAGA: backup pierwsze!)
//
// Domyślnie tryb DRY-RUN — tylko raport, ŻADNYCH zapisów do bazy.
// `--apply` przełącza na zapis. Sugerowany workflow: dry-run → backup → apply.
// ─────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const mysql = require('mysql2');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const tenantArg = args.find(a => a.startsWith('--tenant='));
const TENANT_FILTER = tenantArg ? tenantArg.split('=')[1] : null;

// ─── DEFINICJA HEURYSTYK KLASYFIKACJI ────────────────────────────────────
// Kolejność = priorytet. Pierwsza pasująca wygrywa. Zaczynamy od typów
// "specjalnych" (epilacja, paznokcie...) PRZED twarzą — żeby np. "Depilacja
// laserowa twarz" trafiła do epilacji a nie do twarzy (kolizja z 'twarz').
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
      'goracymi kamieniami', 'aromaterapeu', 'kobido' // (Kobido to też mas. twarzy)
    ]
  },
  {
    typ: 'twarz',
    keywords: [
      // Anatomicznie — fragmenty słów twarzy
      'twarz', 'szyja', 'dekolt', 'oko', 'oczy', 'oczu', 'oka',
      'brwi', 'rzęs', 'rzes', 'usta', 'ust ', 'warga', 'broda',
      'podbród', 'podbrod', 'żuchw', 'zuchw', 'czoło', 'czolo', 'policzki',
      // Konkretne grupy zabiegów twarzy
      'oczyszczanie', 'infuzja', 'peeling chemiczny', 'peeling cypryjski',
      'mezoterapia bezigł', 'mezoterapia bezigl', 'mikronakłuwanie', 'mikronakluwanie',
      'stymulator', 'purles', 'pixel rf', 'monako', 'flerage', 'ultradźwięki', 'ultradzwieki',
      'lifting', 'oxybrazja', 'mikrodermabrazja', 'karboksyterapia',
      'maseczka', 'algowa', 'glass skin', 'amber glow', 'retix', 'electri',
      'ami eyes', 'geo-lifting', 'karisma', 'dermasoft',
      'henna', 'laminowan',
      // Kwas — może być twarzy ALE też ciała → tu daję, więc pojedyncze 'kwas' poleci do twarzy
      'kwas'
    ]
  }
  // 'ciało' nie wymaga heurystyki — to default fallback
];

const TYP_DOMYSLNY = 'ciało';

// ─── FUNKCJA KLASYFIKACJI ─────────────────────────────────────────────────
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

// ─── DB POOL ─────────────────────────────────────────────────────────────
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: 'utf8mb4',
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 5
});

const q = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// ─── GŁÓWNA LOGIKA ────────────────────────────────────────────────────────
async function migracjaTenanta(tenant_id) {
  const raport = {
    tenant_id,
    uslugi: { total: 0, zaklasyfikowane: 0, perTyp: {} },
    sprzedaz: { total: 0, zaklasyfikowane: 0, perTyp: {} }
  };

  // ── ETAP 1: Uslugi (cennik) ─────────────────────────────────────────
  const uslugi = await q(
    `SELECT id, kategoria, COALESCE(wariant, '') AS wariant
     FROM Uslugi
     WHERE tenant_id = ? AND (typ_zabiegu IS NULL OR typ_zabiegu = '')`,
    [tenant_id]
  );
  raport.uslugi.total = uslugi.length;

  for (const u of uslugi) {
    const typ = klasyfikuj(u.kategoria, u.wariant);
    raport.uslugi.perTyp[typ] = (raport.uslugi.perTyp[typ] || 0) + 1;
    raport.uslugi.zaklasyfikowane++;
    if (APPLY) {
      await q(`UPDATE Uslugi SET typ_zabiegu = ? WHERE id = ?`, [typ, u.id]);
    }
  }

  // ── ETAP 2: Sprzedaz (historia) ────────────────────────────────────
  // Dla każdego rekordu Sprzedaz bez typ_zabiegu próbujemy:
  //   1) Lookup w Uslugi po (kategoria=zabieg, wariant=szczegoly) — multi-sale
  //   2) Lookup w Uslugi po pełnej nazwie złożonej — single-sale
  //   3) Fallback: klasyfikuj po nazwie (heurystyki)
  // Pomijamy kosmetyki (zabieg startujący od "Kosmetyk:") — typ_zabiegu NULL.
  const sprzedaz = await q(
    `SELECT id, zabieg, COALESCE(szczegoly, '') AS szczegoly
     FROM Sprzedaz
     WHERE tenant_id = ?
       AND (typ_zabiegu IS NULL OR typ_zabiegu = '')
       AND zabieg NOT LIKE 'Kosmetyk:%'
       AND COALESCE(status, '') != 'USUNIĘTY'`,
    [tenant_id]
  );
  raport.sprzedaz.total = sprzedaz.length;

  // Cache lookup z Uslugi — żeby uniknąć N zapytań
  const uslugiAll = await q(
    `SELECT TRIM(kategoria) AS kategoria, TRIM(COALESCE(wariant, '')) AS wariant, typ_zabiegu
     FROM Uslugi WHERE tenant_id = ?`,
    [tenant_id]
  );
  // Index: "kategoria|wariant" → typ
  const uslugiIdx = {};
  for (const u of uslugiAll) {
    if (!u.typ_zabiegu) continue;
    uslugiIdx[`${u.kategoria}|${u.wariant}`] = u.typ_zabiegu;
    // Plus indeks po samej kategorii (fallback)
    if (!uslugiIdx[`${u.kategoria}|`]) uslugiIdx[`${u.kategoria}|`] = u.typ_zabiegu;
  }

  for (const s of sprzedaz) {
    const zabieg = String(s.zabieg || '').trim();
    const szcz   = String(s.szczegoly || '').trim();
    let typ = null;

    // 1) multi-sale match
    typ = uslugiIdx[`${zabieg}|${szcz}`] || null;
    // 2) sama kategoria
    if (!typ) typ = uslugiIdx[`${zabieg}|`] || null;
    // 3) heurystyka po nazwie
    if (!typ) typ = klasyfikuj(zabieg, szcz);

    raport.sprzedaz.perTyp[typ] = (raport.sprzedaz.perTyp[typ] || 0) + 1;
    raport.sprzedaz.zaklasyfikowane++;
    if (APPLY) {
      await q(`UPDATE Sprzedaz SET typ_zabiegu = ? WHERE id = ?`, [typ, s.id]);
    }
  }

  return raport;
}

function formatRaport(r) {
  const lines = [];
  lines.push(`\n═══ TENANT: ${r.tenant_id} ═══`);
  lines.push(`\n📋 Uslugi (cennik): ${r.uslugi.total} rekordów do zaktualizowania`);
  if (r.uslugi.total > 0) {
    Object.entries(r.uslugi.perTyp)
      .sort((a, b) => b[1] - a[1])
      .forEach(([typ, n]) => lines.push(`   • ${typ.padEnd(25)} ${n}`));
  }
  lines.push(`\n💰 Sprzedaz (historia): ${r.sprzedaz.total} rekordów do zaktualizowania`);
  if (r.sprzedaz.total > 0) {
    Object.entries(r.sprzedaz.perTyp)
      .sort((a, b) => b[1] - a[1])
      .forEach(([typ, n]) => lines.push(`   • ${typ.padEnd(25)} ${n}`));
  }
  return lines.join('\n');
}

(async () => {
  try {
    console.log(`\n${APPLY ? '⚙️  TRYB: APPLY (zapis do bazy)' : '🔍 TRYB: DRY-RUN (tylko raport)'}`);
    if (TENANT_FILTER) console.log(`🎯 Filtr tenant: ${TENANT_FILTER}`);

    // Lista tenantów
    let tenanty;
    if (TENANT_FILTER) {
      tenanty = [{ tenant_id: TENANT_FILTER }];
    } else {
      tenanty = await q(`SELECT DISTINCT tenant_id FROM Uslugi WHERE tenant_id IS NOT NULL AND tenant_id != ''`);
    }

    if (!tenanty.length) {
      console.log('\nBrak tenantów do migracji.');
      db.end();
      return;
    }

    console.log(`\n${tenanty.length} tenant(ów) do przetworzenia...\n`);

    const wszystkieRaporty = [];
    for (const t of tenanty) {
      try {
        const r = await migracjaTenanta(t.tenant_id);
        wszystkieRaporty.push(r);
        console.log(formatRaport(r));
      } catch (e) {
        console.error(`\n✗ Błąd dla tenant=${t.tenant_id}:`, e.message);
      }
    }

    // ─── PODSUMOWANIE ─────────────────────────────────────────────────
    console.log('\n\n═══════ PODSUMOWANIE ═══════');
    const sumUslugi = wszystkieRaporty.reduce((acc, r) => {
      Object.entries(r.uslugi.perTyp).forEach(([typ, n]) => {
        acc[typ] = (acc[typ] || 0) + n;
      });
      return acc;
    }, {});
    const sumSprzedaz = wszystkieRaporty.reduce((acc, r) => {
      Object.entries(r.sprzedaz.perTyp).forEach(([typ, n]) => {
        acc[typ] = (acc[typ] || 0) + n;
      });
      return acc;
    }, {});
    const totalUslugi = Object.values(sumUslugi).reduce((a, b) => a + b, 0);
    const totalSprzedaz = Object.values(sumSprzedaz).reduce((a, b) => a + b, 0);
    console.log(`\nUslugi razem: ${totalUslugi}`);
    Object.entries(sumUslugi)
      .sort((a, b) => b[1] - a[1])
      .forEach(([typ, n]) => console.log(`  • ${typ.padEnd(25)} ${n}  (${(n / totalUslugi * 100).toFixed(1)}%)`));
    console.log(`\nSprzedaz razem: ${totalSprzedaz}`);
    Object.entries(sumSprzedaz)
      .sort((a, b) => b[1] - a[1])
      .forEach(([typ, n]) => console.log(`  • ${typ.padEnd(25)} ${n}  (${(n / totalSprzedaz * 100).toFixed(1)}%)`));

    if (!APPLY) {
      console.log('\n\n⚠️  To był DRY-RUN — żadne zmiany nie zostały zapisane.');
      console.log('Aby zastosować zmiany, uruchom z flagą --apply (po backupie SQL).');
    } else {
      console.log('\n\n✅ Zmiany zapisane w bazie.');
    }
  } catch (e) {
    console.error('\n✗ Błąd główny:', e.message);
    process.exit(1);
  } finally {
    db.end();
  }
})();
