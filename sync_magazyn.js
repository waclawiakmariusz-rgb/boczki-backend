/**
 * sync_magazyn.js
 * ---------------------------------------------------------------
 * Synchronizuje pola które zmieniają się w czasie dla istniejących
 * rekordów magazynowych — addytywna migracja ich nie aktualizuje.
 *
 * Magazyn:  ilosc, min, cena_netto, cena_brutto
 * Archiwum: ilosc (dla pewności)
 *
 * Klucz dopasowania: nazwa_produktu + typ + data_waznosci (dzień)
 * — pozwala rozróżnić różne partie tego samego produktu.
 *
 * Użycie:
 *   node sync_magazyn.js
 *   node sync_magazyn.js inny_plik.xlsx
 * ---------------------------------------------------------------
 */

require('dotenv').config();
const xlsx  = require('xlsx');
const mysql = require('mysql2/promise');

const TENANT_ID  = 'boczki-salon-glowny-001';
const EXCEL_FILE = process.argv[2] || 'multiplik.xlsx';

// ─── Helpers ───────────────────────────────────────────────────────────────

function findCol(headers, ...names) {
    for (const name of names) {
        const n = name.toLowerCase().replace(/\s/g, '');
        const i = headers.findIndex(h => h && String(h).toLowerCase().replace(/\s/g, '') === n);
        if (i >= 0) return i;
    }
    return -1;
}

function normalizeDate(val) {
    if (!val) return '';
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return '';
        return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
    }
    const str = String(val).trim();
    // ISO: 2026-07-30 lub 2026-07-30T22:00:00.000Z
    const mISO = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return `${mISO[1]}-${mISO[2]}-${mISO[3]}`;
    // PL: 30-07-2026 lub 30.07.2026
    const mPL = str.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
    if (mPL) {
        let d = parseInt(mPL[1]), m = parseInt(mPL[2]);
        if (d > 12) { /* d=d, m=m */ } else if (m > 12) { [d, m] = [m, d]; }
        return `${mPL[3]}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    return '';
}

function parseNum(val) {
    if (val === null || val === undefined || val === '') return null;
    const n = parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? null : n;
}

// ─── Synchronizacja jednej tabeli ──────────────────────────────────────────

async function syncTabela(db, sheetName, tableName, fieldsToSync) {
    console.log(`--- ${tableName} ---`);

    const wb = xlsx.readFile(EXCEL_FILE, { cellDates: true });
    if (!wb.SheetNames.includes(sheetName)) {
        console.log(`⏭️  Brak arkusza ${sheetName} w pliku\n`);
        return 0;
    }

    const sheet = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, cellDates: true });
    const headers = sheet[0] || [];

    // Kolumny klucza dopasowania
    const iNazwa  = findCol(headers, 'NazwaProductu', 'NazwaProduktu', 'Nazwa Produktu', 'nazwa_produktu');
    const iTyp    = findCol(headers, 'Typ', 'typ');
    const iData   = findCol(headers, 'DataWażności', 'DataWaznosci', 'Data Ważności', 'data_waznosci');

    // Kolumny do aktualizacji
    const iIlosc       = findCol(headers, 'Ilość', 'Ilosc', 'ilosc');
    const iMin         = findCol(headers, 'Min', 'min');
    const iCenaNetto   = findCol(headers, 'CenaNetto', 'Cena Netto', 'cena_netto');
    const iCenaBrutto  = findCol(headers, 'CenaBrutto', 'Cena Brutto', 'cena_brutto');
    const iKategoria   = findCol(headers, 'Kategoria', 'kategoria');
    const iKtoDodal    = findCol(headers, 'Kto Dodał', 'KtoDodał', 'KtoDodal', 'kto_dodal');
    const iDataDodania = findCol(headers, 'Data dodania', 'DataDodania', 'data_dodania');

    console.log(`Kolumny: nazwa[${iNazwa}] typ[${iTyp}] data_waznosci[${iData}] ilosc[${iIlosc}] min[${iMin}] kategoria[${iKategoria}] kto_dodal[${iKtoDodal}] data_dodania[${iDataDodania}]`);

    if (iNazwa < 0 || iTyp < 0) {
        console.log(`❌ Brak kolumn klucza (nazwa_produktu, typ) — pomijam\n`);
        return 0;
    }

    // Załaduj wszystkie rekordy z bazy
    const [dbRows] = await db.query(
        `SELECT id, nazwa_produktu, typ, DATE_FORMAT(data_waznosci, '%Y-%m-%d') as dzien_waznosci,
                ilosc, min, cena_netto, cena_brutto,
                kategoria, kto_dodal,
                DATE_FORMAT(data_dodania, '%Y-%m-%d') as data_dodania_dzien
         FROM \`${tableName}\` WHERE tenant_id = ?`,
        [TENANT_ID]
    );

    // Zbuduj mapę: nazwa_lower|typ_lower|data → rekord DB
    const dbMap = new Map();
    for (const r of dbRows) {
        const key = `${String(r.nazwa_produktu||'').trim().toLowerCase()}|${String(r.typ||'').trim().toLowerCase()}|${r.dzien_waznosci||''}`;
        if (!dbMap.has(key)) {
            dbMap.set(key, r);
        }
    }

    let updated = 0, same = 0, notFound = 0;

    for (let i = 1; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row || row.every(c => c === null || c === '')) continue;

        const excelNazwa = String(row[iNazwa] || '').trim().toLowerCase();
        const excelTyp   = String(row[iTyp]   || '').trim().toLowerCase();
        const excelData  = iData >= 0 ? normalizeDate(row[iData]) : '';

        if (!excelNazwa || !excelTyp) continue;

        const key = `${excelNazwa}|${excelTyp}|${excelData}`;
        const dbRec = dbMap.get(key);

        if (!dbRec) {
            notFound++;
            continue;
        }

        // Zbierz pola do zaktualizowania
        const updates = [];
        const vals    = [];

        if (iIlosc >= 0) {
            const excelIlosc = parseNum(row[iIlosc]);
            if (excelIlosc !== null && parseFloat(dbRec.ilosc) !== excelIlosc) {
                updates.push('ilosc = ?');
                vals.push(excelIlosc);
            }
        }

        if (iMin >= 0) {
            const excelMin = parseNum(row[iMin]);
            if (excelMin !== null && parseFloat(dbRec.min) !== excelMin) {
                updates.push('min = ?');
                vals.push(excelMin);
            }
        }

        if (iCenaNetto >= 0) {
            const excelCN = parseNum(row[iCenaNetto]);
            if (excelCN !== null && parseFloat(dbRec.cena_netto) !== excelCN) {
                updates.push('cena_netto = ?');
                vals.push(excelCN);
            }
        }

        if (iCenaBrutto >= 0) {
            const excelCB = parseNum(row[iCenaBrutto]);
            if (excelCB !== null && parseFloat(dbRec.cena_brutto) !== excelCB) {
                updates.push('cena_brutto = ?');
                vals.push(excelCB);
            }
        }

        if (iKategoria >= 0) {
            const excelKat = String(row[iKategoria] || '').trim();
            if (excelKat && excelKat !== String(dbRec.kategoria || '').trim()) {
                updates.push('kategoria = ?');
                vals.push(excelKat);
            }
        }

        if (iKtoDodal >= 0) {
            const excelKto = String(row[iKtoDodal] || '').trim();
            if (excelKto && excelKto !== String(dbRec.kto_dodal || '').trim()) {
                updates.push('kto_dodal = ?');
                vals.push(excelKto);
            }
        }

        if (iDataDodania >= 0) {
            const excelDD = normalizeDate(row[iDataDodania]);
            if (excelDD && excelDD !== (dbRec.data_dodania_dzien || '')) {
                updates.push('data_dodania = ?');
                vals.push(excelDD);
            }
        }

        if (updates.length === 0) {
            same++;
            continue;
        }

        vals.push(TENANT_ID, dbRec.id);
        try {
            await db.execute(
                `UPDATE \`${tableName}\` SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`,
                vals
            );
            const zmiany = updates.map((u, idx) => u.replace(' = ?', '') + '=' + vals[idx]).join(', ');
            console.log(`  ✏️  ${row[iNazwa]} | ${excelData} → ${zmiany}`);
            updated++;
        } catch (err) {
            console.warn(`  ⚠️  Błąd UPDATE wiersz ${i}: ${err.message}`);
        }
    }

    if (notFound > 0) {
        console.log(`  ℹ️  Nieznaleziono ${notFound} rekordów (różne klucze lub nowe partie — OK)`);
    }
    console.log(`✅ ${tableName}: ${updated} zaktualizowanych | ${same} bez zmian | ${notFound} nieznalezionych\n`);
    return updated;
}

// ─── Synchronizacja Raport_Magazyn (klucz: kategoria + nazwa) ─────────────

async function syncRaportMagazyn(db) {
    console.log('--- Raport_Magazyn ---');

    const wb = xlsx.readFile(EXCEL_FILE, { cellDates: true });
    if (!wb.SheetNames.includes('Raport_Magazyn')) {
        console.log('⏭️  Brak arkusza Raport_Magazyn w pliku\n');
        return 0;
    }

    const sheet = xlsx.utils.sheet_to_json(wb.Sheets['Raport_Magazyn'], { header: 1, defval: null, cellDates: true });
    const headers = sheet[0] || [];

    const iKategoria   = findCol(headers, 'Kategoria', 'kategoria');
    const iNazwa       = findCol(headers, 'Nazwa', 'nazwa');
    const iIlosc       = findCol(headers, 'Ilość', 'Ilosc', 'ilosc');
    const iMin         = findCol(headers, 'Min', 'min');
    const iCenaNetto   = findCol(headers, 'Cena netto', 'CenaNetto', 'cena_netto');
    const iCenaBrutto  = findCol(headers, 'Cena Brutto', 'CenaBrutto', 'cena_brutto');
    const iDataZmiany  = findCol(headers, 'Data zmiany', 'DataZmiany', 'data_zmiany');
    const iEdytowal    = findCol(headers, 'Edytował', 'Edytowal', 'edytowal');

    console.log(`Kolumny: kategoria[${iKategoria}] nazwa[${iNazwa}] ilosc[${iIlosc}] min[${iMin}] cena_netto[${iCenaNetto}] cena_brutto[${iCenaBrutto}] data_zmiany[${iDataZmiany}] edytowal[${iEdytowal}]`);

    if (iKategoria < 0 || iNazwa < 0) {
        console.log('❌ Brak kolumn klucza (kategoria, nazwa) — pomijam\n');
        return 0;
    }

    const [dbRows] = await db.query(
        `SELECT id, kategoria, nazwa, ilosc, min, cena_netto, cena_brutto,
                DATE_FORMAT(data_zmiany, '%Y-%m-%dT%H:%i:%s') as data_zmiany_str, edytowal
         FROM Raport_Magazyn WHERE tenant_id = ?`,
        [TENANT_ID]
    );

    // Klucz: kategoria_lower|nazwa_lower
    const dbMap = new Map();
    for (const r of dbRows) {
        const key = `${String(r.kategoria||'').trim().toLowerCase()}|${String(r.nazwa||'').trim().toLowerCase()}`;
        if (!dbMap.has(key)) dbMap.set(key, r);
    }

    function parseExcelDate(val) {
        if (!val) return null;
        if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
        const str = String(val).trim();
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }

    let updated = 0, same = 0, notFound = 0;

    for (let i = 1; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row || row.every(c => c === null || c === '')) continue;

        const excelKat   = String(row[iKategoria] || '').trim().toLowerCase();
        const excelNazwa = String(row[iNazwa]     || '').trim().toLowerCase();

        if (!excelKat || !excelNazwa) continue;

        const key   = `${excelKat}|${excelNazwa}`;
        const dbRec = dbMap.get(key);

        if (!dbRec) { notFound++; continue; }

        const updates = [];
        const vals    = [];

        if (iIlosc >= 0) {
            const v = parseNum(row[iIlosc]);
            if (v !== null && parseFloat(dbRec.ilosc) !== v) { updates.push('ilosc = ?'); vals.push(v); }
        }
        if (iMin >= 0) {
            const v = parseNum(row[iMin]);
            if (v !== null && parseFloat(dbRec.min) !== v) { updates.push('min = ?'); vals.push(v); }
        }
        if (iCenaNetto >= 0) {
            const v = parseNum(row[iCenaNetto]);
            if (v !== null && parseFloat(dbRec.cena_netto) !== v) { updates.push('cena_netto = ?'); vals.push(v); }
        }
        if (iCenaBrutto >= 0) {
            const v = parseNum(row[iCenaBrutto]);
            if (v !== null && parseFloat(dbRec.cena_brutto) !== v) { updates.push('cena_brutto = ?'); vals.push(v); }
        }
        if (iDataZmiany >= 0) {
            const excelDate = parseExcelDate(row[iDataZmiany]);
            if (excelDate) {
                // Porównaj z dokładnością do sekundy
                const excelSec = Math.floor(excelDate.getTime() / 1000);
                const dbDate   = dbRec.data_zmiany_str ? new Date(dbRec.data_zmiany_str + 'Z') : null;
                const dbSec    = dbDate ? Math.floor(dbDate.getTime() / 1000) : -1;
                if (excelSec !== dbSec) { updates.push('data_zmiany = ?'); vals.push(excelDate); }
            }
        }
        if (iEdytowal >= 0) {
            const excelEd = String(row[iEdytowal] || '').trim();
            if (excelEd && excelEd !== String(dbRec.edytowal || '').trim()) {
                updates.push('edytowal = ?'); vals.push(excelEd);
            }
        }

        if (updates.length === 0) { same++; continue; }

        vals.push(TENANT_ID, dbRec.id);
        try {
            await db.execute(
                `UPDATE Raport_Magazyn SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`,
                vals
            );
            const zmiany = updates.map((u, idx) => u.replace(' = ?', '') + '=' + vals[idx]).join(', ');
            console.log(`  ✏️  ${row[iNazwa]} | ${row[iKategoria]} → ${zmiany}`);
            updated++;
        } catch (err) {
            console.warn(`  ⚠️  Błąd UPDATE wiersz ${i}: ${err.message}`);
        }
    }

    if (notFound > 0) {
        console.log(`  ℹ️  Nieznaleziono ${notFound} rekordów (nowe pozycje w Dotyku lub zmieniona kategoria/nazwa)`);
    }
    console.log(`✅ Raport_Magazyn: ${updated} zaktualizowanych | ${same} bez zmian | ${notFound} nieznalezionych\n`);
    return updated;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n📂 Plik źródłowy: ${EXCEL_FILE}`);
    console.log('🔄 TRYB: synchronizacja ilości i cen magazynowych\n');

    const db = await mysql.createConnection({
        host:     process.env.DB_HOST,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });
    console.log('✅ Połączono z bazą\n');

    let total = 0;
    total += await syncTabela(db, 'Magazyn',  'Magazyn',  ['ilosc','min','cena_netto','cena_brutto']);
    total += await syncTabela(db, 'Archiwum', 'Archiwum', ['ilosc']);
    total += await syncRaportMagazyn(db);

    console.log('══════════════════════════════════════');
    console.log(`📊 PODSUMOWANIE: ${total} rekordów zaktualizowanych`);
    console.log('══════════════════════════════════════\n');

    await db.end();
}

main().catch(err => {
    console.error('❌ Błąd główny:', err.message);
    process.exit(1);
});
