/**
 * migracja_maj.js
 * ---------------------------------------------------------------
 * TRYB ADDYTYWNY — nie kasuje istniejących danych.
 * Wgrywa TYLKO nowe wiersze których jeszcze nie ma w bazie.
 *
 * Użycie:
 *   node migracja_maj.js
 *   node migracja_maj.js inny_plik.xlsx
 * ---------------------------------------------------------------
 */

require('dotenv').config();
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const TENANT_ID  = 'boczki-salon-glowny-001';
const EXCEL_FILE = process.argv[2] || 'multiplik.xlsx';

// ─── 1. Normalizacja stringów (identyczna jak w wielki_migrator.js) ────────

function cleanString(str) {
    if (!str) return '';
    return str.toString().toLowerCase()
        .replace(/ł/g, 'l').replace(/ą/g, 'a').replace(/ę/g, 'e').replace(/ó/g, 'o')
        .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z').replace(/ć/g, 'c')
        .replace(/ń/g, 'n').replace(/[^a-z0-9]/g, '');
}

// ─── 2. Mapowanie kolumn Excel → DB (identyczne jak w wielki_migrator.js) ──

function findColIndex(dbCol, headers, sheetName) {
    const cDb = cleanString(dbCol);

    for (let i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        const cH = cleanString(headers[i]);
        if (cH === cDb) return i;
        const cStripped = cH.replace(/addedtime|uniqueid|email|file/g, '');
        if (cStripped === cDb) return i;
    }

    const overrides = {
        'Sprzedaz_data_sprzedazy':               'dataaddedtime',
        'Sprzedaz_id_zewnetrzne':                'id',
        'Sprzedaz_zabieg':                       'jakizabieg',
        'Zadatki_data_wplaty':                   'data',
        'Zadatki_cel':                           'celopis',
        'Zadatki_pracownicy':                    'pracownik',
        'Sugestie_matka':                        'jesliklientkupilmatka',
        'Sugestie_dziecko':                      'zaproponujtodziecko',
        'Klienci_imie_nazwisko':                 'imieinazwisko',
        'Klienci_data_rejestracji':              'datarejestracji',
        'Rejestr_Oświadczeń_link_pdf':           'link',
        'Rejestr_RODO_email_kontaktowy':         'emailadres',
        'Rejestr_RODO_link_pdf':                 'link',
        'Pracownicy_imie':                       'imie',
        'Użytkownicy_imie_login':                'imie',
        'Użytkownicy_haslo_pin':                 'pin',
        'Uslugi_wariant':                        'podkategoria',
        'Memo_id_oryginalne':                    'id',
        'Platnosci_data_platnosci':              'data',
        'Retencja_data_kontaktu':                'datakontaktu',
        'Logi_data_zdarzenia':                   'data',
        'Logi_modul':                            'produkt',
        'Koszty_data_kosztu':                    'data',
        'Wyniki_konsultacja_data_wpisu':         'addedtime',
        'Wyniki_konsultacja_data_konsultacji':   'datedatakonsultacji',
        'Wyniki_konsultacja_zrodlo':             'konsultacjanormalnaczyzreklamy',
        'Wyniki_konsultacja_obszar':             'reklamanacialoczynatwarz',
        'Wyniki_konsultacja_klient':             'imieinazwiskoklientki',
        'Wyniki_konsultacja_telefon':            'numertelefonuklientki',
        'Wyniki_konsultacja_zabiegi_cialo':      'zabiegiwybranedlaklientkinacialo',
        'Wyniki_konsultacja_zabiegi_twarz':      'zabiegiwybranedlaklientkinatwarz',
        'Wyniki_konsultacja_kwota_reklama':      'kwotaktoraklientplacijakoreklama',
        'Wyniki_konsultacja_kwota_pakiet':       'kwotapakietuktoryklientkawybrala',
        'Wyniki_konsultacja_kto_wykonal':        'ktowykonalkonsultacje',
        'Wyniki_konsultacja_uwagi':              'dowolneuwagi',
        'Wyniki_konsultacja_typ_akcji':          'typakcjireklamowej',
        'Wyniki_konsultacja_upsell':             'kwotadobranaupsell',
        'Typy_konsultacji_nazwa':                'nazwa',
        'Raport_Magazyn_data_waznosci':          'data',
        'Raport_Kategorie_pelna_sciezka':        'pelnasciezka',
        'Archiwum_kto_dodal':                    'ktododal',
        'Archiwum_data_dodania':                 'datamodyfikacji',
        'Archiwum_kto_usunal':                   'ktoarchiwizuje',
        'Archiwum_data_archiwizacji':            'dataarchiwizacji',
        'Magazyn_kto_dodal':                     'ktododal',
        'Pracownicy_targety_miesiac':            'miesiacwformacieyyyymm',
        'Pracownicy_targety_opis_slowny':        'opisslownytwojnowyludzkiopis',
        'Ustawienia_haslo':                      'haslo',
    };

    const key = `${sheetName}_${dbCol}`;
    if (overrides[key]) {
        for (let i = 0; i < headers.length; i++) {
            if (!headers[i]) continue;
            if (cleanString(headers[i]) === overrides[key]) return i;
        }
    }

    const months = ['styczen','luty','marzec','kwiecien','maj','czerwiec',
                    'lipiec','sierpien','wrzesien','pazdziernik','listopad','grudzien'];
    const cSheet = cleanString(sheetName);
    if (months.includes(cSheet)) {
        if (dbCol === 'data_urodzin') {
            for (let i = 0; i < headers.length; i++) {
                if (headers[i] && cleanString(headers[i]).includes('urodzin')) return i;
            }
        }
        if (dbCol === 'c_status') {
            for (let i = 0; i < headers.length; i++) {
                if (headers[i] && cleanString(headers[i]) === 'c') return i;
            }
        }
    }

    return -1;
}

// ─── 3. Parsowanie dat ──────────────────────────────────────────────────────

function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return null;
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        const h = String(val.getHours()).padStart(2, '0');
        const min = String(val.getMinutes()).padStart(2, '0');
        const s = String(val.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }
    const str = val.toString().trim().replace(/,/g, '');
    const mPL = str.match(/^(\d{1,2})[\.\- \/](\d{1,2})(?:[\.\- \/](\d{4}))?(?:\s+(\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?)?$/);
    if (mPL) {
        let p1 = parseInt(mPL[1], 10), p2 = parseInt(mPL[2], 10);
        const y = mPL[3] || '2000';
        let d = p1, m = p2;
        if (p1 > 12) { d = p1; m = p2; }
        else if (p2 > 12) { d = p2; m = p1; }
        const h = mPL[4] || '00', min = mPL[5] || '00', sec = mPL[6] || '00';
        return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} ${h.padStart(2,'0')}:${min.padStart(2,'0')}:${sec.padStart(2,'0')}`;
    }
    const mISO = str.match(/^(\d{4})[\.\- \/](\d{1,2})[\.\- \/](\d{1,2})(?:\s+(\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?)?$/);
    if (mISO) {
        return `${mISO[1]}-${String(mISO[2]).padStart(2,'0')}-${String(mISO[3]).padStart(2,'0')} ${String(mISO[4]||'00').padStart(2,'0')}:${String(mISO[5]||'00').padStart(2,'0')}:${String(mISO[6]||'00').padStart(2,'0')}`;
    }
    return null;
}

// ─── 4. Normalizacja wartości do porównania kluczy ─────────────────────────
// Musi dać ten sam wynik dla wartości z Excel i z MySQL.

function normalizeKey(val) {
    if (val === null || val === undefined) return '';
    // MySQL DATETIME zwraca obiekt Date — formatujemy tak samo jak parseDate
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return '';
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        const h = String(val.getHours()).padStart(2, '0');
        const min = String(val.getMinutes()).padStart(2, '0');
        const s = String(val.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }
    const str = String(val).trim();
    // MySQL DECIMAL zwraca "249.00" — normalizuj do "249" lub "249.5"
    if (/^-?\d+\.\d+$/.test(str)) {
        const n = parseFloat(str);
        return Number.isInteger(n) ? String(n) : String(n);
    }
    return str;
}

// ─── 4. Klucze deduplicacji per tabela ────────────────────────────────────
// Kolumny DB które RAZEM jednoznacznie identyfikują rekord biznesowy.
// Nowe wiersze z Excel są wgrywane tylko jeśli tej kombinacji NIE MA w bazie.

const DEDUP_KEYS = {
    'Sprzedaz':              ['data_sprzedazy', 'klient', 'kwota', 'zabieg'],
    'Klienci':               ['id_klienta'],
    'Zadatki':               ['data_wplaty', 'klient', 'kwota'],
    'Platnosci':             ['data_platnosci', 'klient', 'kwota'],
    'Logi':                  ['data_zdarzenia', 'pracownik', 'akcja', 'modul'],
    'Raport_Logi':           ['data', 'akcja', 'produkt'],
    'Uslugi':                ['kategoria', 'wariant'],
    'Ustawienia':            ['login'],
    'Użytkownicy':           ['imie_login'],
    'Pracownicy':            ['imie'],
    'Pracownicy_konsultacja':['imie'],
    'Pracownicy_targety':    ['pracownik', 'miesiac', 'typ_targetu'],
    'Typy_konsultacji':      ['nazwa', 'obszar'],
    'Sugestie':              ['matka', 'dziecko'],
    'Memo':                  ['id_klienta', 'klient'],
    'Retencja':              ['id_klienta', 'data_kontaktu'],
    'Rejestr_RODO':          ['klient', 'data_podpisu'],
    'Rejestr_Oświadczeń':    ['klient', 'data_podpisu'],
    'Wyniki_konsultacja':    ['klient', 'data_konsultacji', 'data_wpisu'],
    'Archiwum':              ['nazwa_produktu', 'typ', 'data_waznosci'],
    'Magazyn':               ['nazwa_produktu', 'typ'],
    'Slownik':               ['firma', 'model'],
    'Rabaty':                ['nazwa'],
    'Rabaty1':               ['nazwa'],
    'Koszty':                ['data_kosztu', 'kwota', 'opis'],
    'Raport_Magazyn':        ['kategoria', 'nazwa'],
    'Raport_Kategorie':      ['pelna_sciezka'],
    'Raport_Ustawienia':     ['imie', 'nazwisko'],
    // Miesiące – wspólny klucz
    '_miesiace':             ['imie', 'nazwisko', 'nr_telefonu'],
};

const MONTHS_SET = new Set(['styczen','luty','marzec','kwiecien','maj','czerwiec',
                             'lipiec','sierpien','wrzesien','pazdziernik','listopad','grudzien']);

function getDedupKeys(sheetName) {
    if (DEDUP_KEYS[sheetName]) return DEDUP_KEYS[sheetName];
    if (MONTHS_SET.has(cleanString(sheetName))) return DEDUP_KEYS['_miesiace'];
    return null; // tabela bez skonfigurowanego klucza → pomijamy
}

// ─── 5. Główna logika migracji ─────────────────────────────────────────────

async function startIncrementalMigration() {
    console.log(`\n📂 Plik źródłowy: ${EXCEL_FILE}`);
    console.log('🔄 TRYB: addytywny (dodaje tylko nowe rekordy)\n');

    const db = await mysql.createConnection({
        host:     process.env.DB_HOST,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    console.log('✅ Połączono z bazą. Ładuję plik Excel...\n');
    const workbook = xlsx.readFile(EXCEL_FILE, { cellDates: true });

    let totalAdded   = 0;
    let totalSkipped = 0;

    for (const sheetName of workbook.SheetNames) {

        // Sprawdź czy tabela istnieje w bazie
        const [columns] = await db.query(`SHOW COLUMNS FROM \`${sheetName}\``).catch(() => [[]]);
        if (columns.length === 0) {
            console.log(`⏭️  [${sheetName}] brak tabeli w bazie — pomijam`);
            continue;
        }

        const dedupCols = getDedupKeys(sheetName);
        if (!dedupCols) {
            console.log(`⚠️  [${sheetName}] brak konfiguracji klucza — pomijam`);
            continue;
        }

        // Kolumny DB do wgrania (bez id/tenant_id/utworzono_w)
        const dbCols = columns.map(c => c.Field)
            .filter(f => !['id', 'tenant_id', 'utworzono_w'].includes(f));

        // Wczytaj arkusz Excel
        const sheetData = xlsx.utils.sheet_to_json(
            workbook.Sheets[sheetName], { header: 1, defval: null }
        );
        if (sheetData.length === 0) continue;

        // Nagłówki + specjalne przypadki bez nagłówków
        let headers   = [...(sheetData[0] || [])];
        let startIndex = 1;

        if (sheetName === 'Sprzedaz') {
            if (!headers[9])  headers[9]  = 'platnosc';
            if (!headers[10]) headers[10] = 'id_klienta';
            if (!headers[11]) headers[11] = 'pracownik_dodajacy';
            if (!headers[12]) headers[12] = 'id_zadatku';
        }
        if (sheetName === 'Pracownicy' && headers[0] === 'Ola') {
            headers = ['imie']; startIndex = 0;
        }
        if (sheetName === 'Pracownicy_konsultacja' && headers[0] === 'Ola') {
            headers = ['imie', 'status', 'data']; startIndex = 0;
        }
        if (sheetName === 'Typy_konsultacji') {
            headers = ['nazwa', 'obszar', 'cena', 'prog', 'opis', 'status']; startIndex = 0;
        }

        // Mapa kolumn Excel → DB
        const colMap = {};
        for (const dbCol of dbCols) {
            colMap[dbCol] = findColIndex(dbCol, headers, sheetName);
        }

        // ── Załaduj istniejące klucze z bazy ──────────────────────────────
        const validDedupCols = dedupCols.filter(c => dbCols.includes(c));
        const existingKeys = new Set();

        if (validDedupCols.length > 0) {
            const selectCols = validDedupCols.map(c => `\`${c}\``).join(', ');
            const [existingRows] = await db.query(
                `SELECT ${selectCols} FROM \`${sheetName}\` WHERE tenant_id = ?`,
                [TENANT_ID]
            );
            for (const row of existingRows) {
                const key = validDedupCols.map(c => normalizeKey(row[c])).join('|||');
                existingKeys.add(key);
            }
        }

        // ── INSERT query ───────────────────────────────────────────────────
        const insertCols = ['id', 'tenant_id', ...dbCols];
        const placeholders = insertCols.map(() => '?').join(', ');
        const query = `INSERT INTO \`${sheetName}\` (${insertCols.map(c => `\`${c}\``).join(', ')}) VALUES (${placeholders})`;

        let addedCount   = 0;
        let skippedCount = 0;

        for (let i = startIndex; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || row.length === 0 || row.every(c => c === null || c === '')) continue;

            // Zabezpieczenie Targety
            if (sheetName === 'Pracownicy_targety') {
                const idxW = colMap['wartosc'];
                const idxS = findColIndex('szczegoly', headers, sheetName);
                if (idxW !== -1 && idxS !== -1 && !row[idxW] && row[idxS] && !isNaN(parseFloat(row[idxS]))) {
                    row[idxW] = row[idxS];
                }
            }

            // Zbuduj wartości do INSERT
            const vals = [crypto.randomUUID(), TENANT_ID];
            const processedRow = {};

            for (const dbCol of dbCols) {
                let val = colMap[dbCol] !== -1 ? row[colMap[dbCol]] : null;
                if (val === undefined || val === '') val = null;
                if (val !== null) {
                    if (typeof val === 'string' && val.match(/^-?\d+,\d+$/)) {
                        val = val.replace(',', '.');
                    } else if (dbCol.includes('data') || dbCol.includes('czas')) {
                        const d = parseDate(val);
                        if (d !== null) val = d;
                    }
                }
                vals.push(val);
                processedRow[dbCol] = val;
            }

            // ── Sprawdź czy rekord już istnieje ───────────────────────────
            if (existingKeys.size > 0) {
                const rowKey = validDedupCols
                    .map(c => normalizeKey(processedRow[c]))
                    .join('|||');

                if (existingKeys.has(rowKey)) {
                    skippedCount++;
                    continue; // już istnieje → pomiń
                }
            }

            // ── Wstaw nowy rekord ─────────────────────────────────────────
            try {
                await db.execute(query, vals);
                existingKeys.add( // dodaj do setu żeby uniknąć duplikatów w obrębie pliku
                    validDedupCols.map(c => normalizeKey(processedRow[c])).join('|||')
                );
                addedCount++;
            } catch (err) {
                console.warn(`   ⚠️  Wiersz ${i}: ${err.message.substring(0, 120)}`);
            }
        }

        totalAdded   += addedCount;
        totalSkipped += skippedCount;

        if (addedCount > 0 || skippedCount > 0) {
            console.log(`✅ [${sheetName}] +${addedCount} nowych | ${skippedCount} już istnieje`);
        } else {
            console.log(`➖ [${sheetName}] brak zmian`);
        }
    }

    console.log('\n══════════════════════════════════════');
    console.log(`📊 PODSUMOWANIE:`);
    console.log(`   Nowych rekordów dodanych:  ${totalAdded}`);
    console.log(`   Pominięto (już istnieje):  ${totalSkipped}`);
    console.log('══════════════════════════════════════');
    console.log('🎉 Migracja addytywna zakończona!\n');

    await db.end();
}

startIncrementalMigration().catch(err => {
    console.error('❌ Błąd główny:', err.message);
    process.exit(1);
});
