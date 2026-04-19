/**
 * sync_statusy.js
 * ---------------------------------------------------------------
 * Synchronizuje kolumny które mogły się zmienić w starym systemie
 * a addytywna migracja ich nie aktualizuje (tylko dodaje nowe wiersze).
 *
 * Aktualnie synchronizuje:
 *   Zadatki.status  — AKTYWNY może być teraz WYKORZYSTANY/ZWRÓCONY/PRZEPADŁ
 *   Sprzedaz.status — może być USUNIĘTY w starym systemie
 *
 * Użycie:
 *   node sync_statusy.js
 *   node sync_statusy.js inny_plik.xlsx
 * ---------------------------------------------------------------
 */

require('dotenv').config();
const xlsx  = require('xlsx');
const mysql = require('mysql2/promise');

const TENANT_ID  = 'boczki-salon-glowny-001';
const EXCEL_FILE = process.argv[2] || 'multiplik.xlsx';

// ─── Znajdź indeks kolumny po dokładnej nazwie (case-insensitive) ──────────

function findCol(headers, ...names) {
    for (const name of names) {
        const n = name.toLowerCase().replace(/\s/g, '');
        const i = headers.findIndex(h => h && String(h).toLowerCase().replace(/\s/g, '') === n);
        if (i >= 0) return i;
    }
    return -1;
}

// ─── Normalizacja daty do YYYY-MM-DD ──────────────────────────────────────

function normalizeDate(val) {
    if (!val) return '';
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return '';
        return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
    }
    const str = String(val).trim();
    const mISO = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (mISO) return `${mISO[1]}-${mISO[2]}-${mISO[3]}`;
    const mPL = str.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
    if (mPL) {
        let d = parseInt(mPL[1]), m = parseInt(mPL[2]);
        if (d > 12) [d, m] = [d, m];
        else if (m > 12) [d, m] = [m, d];
        return `${mPL[3]}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    return str.slice(0, 10);
}

// ─── Główna logika ─────────────────────────────────────────────────────────

async function syncStatusy() {
    console.log(`\n📂 Plik źródłowy: ${EXCEL_FILE}`);
    console.log('🔄 TRYB: synchronizacja statusów (UPDATE istniejących rekordów)\n');

    const db = await mysql.createConnection({
        host:     process.env.DB_HOST,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    console.log('✅ Połączono z bazą. Ładuję plik Excel...\n');
    const workbook = xlsx.readFile(EXCEL_FILE, { cellDates: true });

    let totalUpdated = 0;

    // ══════════════════════════════════════════════════════════════════
    // 1. ZADATKI — synchronizacja statusu
    //    Nagłówki Excel: ID | ID_KLIENTA | Data | Klient | Typ | Kwota | Metoda | Cel/Opis | Status | Pracownik
    //    Klucz dopasowania: data_wplaty (dzień) + klient + kwota
    // ══════════════════════════════════════════════════════════════════
    if (workbook.SheetNames.includes('Zadatki')) {
        console.log('--- Zadatki ---');

        const sheetZ = xlsx.utils.sheet_to_json(workbook.Sheets['Zadatki'], { header: 1, defval: null, cellDates: true });
        const headersZ = sheetZ[0] || [];

        const iData   = findCol(headersZ, 'Data', 'data_wplaty', 'data');
        const iKlient = findCol(headersZ, 'Klient', 'klient', 'imie_nazwisko');
        const iKwota  = findCol(headersZ, 'Kwota', 'kwota');
        const iStatus = findCol(headersZ, 'Status', 'status');

        console.log(`Kolumny Excel: data[${iData}]="${headersZ[iData]}" klient[${iKlient}]="${headersZ[iKlient]}" kwota[${iKwota}]="${headersZ[iKwota]}" status[${iStatus}]="${headersZ[iStatus]}"`);

        if (iData < 0 || iKlient < 0 || iKwota < 0 || iStatus < 0) {
            console.log('❌ Nie znaleziono wymaganych kolumn w arkuszu Zadatki — pomijam');
        } else {
            // Załaduj wszystkie zadatki z bazy
            const [dbZadatki] = await db.query(
                `SELECT id, DATE_FORMAT(data_wplaty, '%Y-%m-%d') as dzien, klient, kwota, status FROM Zadatki WHERE tenant_id = ?`,
                [TENANT_ID]
            );

            // Zbuduj mapę: dzień|klient_lower|kwota_fixed → {id, status}
            const dbMap = new Map();
            for (const r of dbZadatki) {
                const key = `${r.dzien}|${String(r.klient||'').trim().toLowerCase()}|${parseFloat(r.kwota).toFixed(2)}`;
                dbMap.set(key, { id: r.id, status: r.status });
            }

            let updated = 0, same = 0, notFound = 0;

            for (let i = 1; i < sheetZ.length; i++) {
                const row = sheetZ[i];
                if (!row || row.every(c => c === null || c === '')) continue;

                const excelData   = normalizeDate(row[iData]);
                const excelKlient = String(row[iKlient] || '').trim().toLowerCase();
                const excelKwota  = (parseFloat(String(row[iKwota] || '0').replace(',', '.')) || 0).toFixed(2);
                const excelStatus = String(row[iStatus] || '').trim();

                if (!excelData || !excelKlient || !excelStatus) continue;

                const key = `${excelData}|${excelKlient}|${excelKwota}`;
                const dbRec = dbMap.get(key);

                if (!dbRec) {
                    notFound++;
                    continue;
                }

                if (dbRec.status !== excelStatus) {
                    try {
                        await db.execute(
                            `UPDATE Zadatki SET status = ? WHERE tenant_id = ? AND id = ?`,
                            [excelStatus, TENANT_ID, dbRec.id]
                        );
                        console.log(`  ✏️  ${row[iKlient]} | ${excelData} | ${excelKwota} zł: "${dbRec.status}" → "${excelStatus}"`);
                        updated++;
                    } catch (err) {
                        console.warn(`  ⚠️  Błąd UPDATE wiersz ${i}: ${err.message}`);
                    }
                } else {
                    same++;
                }
            }

            if (notFound > 0) {
                console.log(`  ℹ️  Nieznaleziono ${notFound} rekordów (to może być normalne dla nowych zadatków dodanych bezpośrednio w Estelio)`);
            }
            console.log(`✅ Zadatki: ${updated} zaktualizowanych | ${same} bez zmian | ${notFound} nieznalezionych\n`);
            totalUpdated += updated;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // 2. SPRZEDAZ — synchronizacja statusu (tylko USUNIĘTY)
    //    Klucz: data_sprzedazy (dzień) + klient + kwota + zabieg
    // ══════════════════════════════════════════════════════════════════
    if (workbook.SheetNames.includes('Sprzedaz')) {
        console.log('--- Sprzedaz ---');

        const sheetS = xlsx.utils.sheet_to_json(workbook.Sheets['Sprzedaz'], { header: 1, defval: null, cellDates: true });
        const headersS = sheetS[0] || [];

        const iData   = findCol(headersS, 'Data', 'data_sprzedazy', 'data', 'dataaddedtime', 'Data(AddedTime)', 'Data(AddedTime)', 'data(addedtime)');
        const iKlient = findCol(headersS, 'Klient', 'klient', 'imie_nazwisko');
        const iKwota  = findCol(headersS, 'Kwota', 'kwota');
        const iZabieg = findCol(headersS, 'Zabieg', 'zabieg', 'jakizabieg');
        const iStatus = findCol(headersS, 'Status', 'status');

        console.log(`Kolumny Excel: data[${iData}]="${headersS[iData]}" klient[${iKlient}]="${headersS[iKlient]}" kwota[${iKwota}]="${headersS[iKwota]}" status[${iStatus}]="${headersS[iStatus]}"`);

        if (iData < 0 || iKlient < 0 || iKwota < 0 || iStatus < 0) {
            console.log('❌ Nie znaleziono wymaganych kolumn w arkuszu Sprzedaz — pomijam');
        } else {
            const [dbSprzedaz] = await db.query(
                `SELECT id, DATE_FORMAT(data_sprzedazy, '%Y-%m-%d') as dzien, klient, kwota, zabieg, status FROM Sprzedaz WHERE tenant_id = ?`,
                [TENANT_ID]
            );

            const dbMap = new Map();
            for (const r of dbSprzedaz) {
                const key = `${r.dzien}|${String(r.klient||'').trim().toLowerCase()}|${parseFloat(r.kwota).toFixed(2)}|${String(r.zabieg||'').trim().toLowerCase()}`;
                dbMap.set(key, { id: r.id, status: r.status });
            }

            let updated = 0, same = 0, notFound = 0;

            for (let i = 1; i < sheetS.length; i++) {
                const row = sheetS[i];
                if (!row || row.every(c => c === null || c === '')) continue;

                const excelStatus = String(row[iStatus] || '').trim();
                if (excelStatus !== 'USUNIĘTY') continue; // synchronizujemy tylko usunięte

                const excelData   = normalizeDate(row[iData]);
                const excelKlient = String(row[iKlient] || '').trim().toLowerCase();
                const excelKwota  = (parseFloat(String(row[iKwota] || '0').replace(',', '.')) || 0).toFixed(2);
                const excelZabieg = iZabieg >= 0 ? String(row[iZabieg] || '').trim().toLowerCase() : '';

                if (!excelData || !excelKlient) continue;

                const key = `${excelData}|${excelKlient}|${excelKwota}|${excelZabieg}`;
                const dbRec = dbMap.get(key);

                if (!dbRec) { notFound++; continue; }

                if (dbRec.status !== 'USUNIĘTY') {
                    try {
                        await db.execute(
                            `UPDATE Sprzedaz SET status = 'USUNIĘTY' WHERE tenant_id = ? AND id = ?`,
                            [TENANT_ID, dbRec.id]
                        );
                        console.log(`  ✏️  ${row[iKlient]} | ${excelData} | ${excelKwota} zł: AKTYWNY → USUNIĘTY`);
                        updated++;
                    } catch (err) {
                        console.warn(`  ⚠️  Błąd UPDATE wiersz ${i}: ${err.message}`);
                    }
                } else {
                    same++;
                }
            }

            if (notFound > 0) {
                console.log(`  ℹ️  Nieznaleziono ${notFound} usuniętych rekordów (mogły być pominięte w migracji addytywnej)`);
            }
            console.log(`✅ Sprzedaz: ${updated} zaktualizowanych | ${same} już USUNIĘTY | ${notFound} nieznalezionych\n`);
            totalUpdated += updated;
        }
    }

    console.log('══════════════════════════════════════');
    console.log(`📊 PODSUMOWANIE: ${totalUpdated} statusów zaktualizowanych`);
    console.log('══════════════════════════════════════\n');

    await db.end();
}

syncStatusy().catch(err => {
    console.error('❌ Błąd główny:', err.message);
    process.exit(1);
});
