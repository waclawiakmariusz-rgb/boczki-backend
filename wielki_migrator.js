require('dotenv').config();
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const TENANT_ID = 'boczki-salon-glowny-001'; 
const EXCEL_FILE = 'multiplik.xlsx';

// 1. Brutalne czyszczenie stringów (bez zgadywania)
function cleanString(str) {
    if (!str) return '';
    return str.toString().toLowerCase()
        .replace(/ł/g, 'l')
        .replace(/ą/g, 'a')
        .replace(/ę/g, 'e')
        .replace(/ó/g, 'o')
        .replace(/ś/g, 's')
        .replace(/ź/g, 'z')
        .replace(/ż/g, 'z')
        .replace(/ć/g, 'c')
        .replace(/ń/g, 'n')
        .replace(/[^a-z0-9]/g, '');
}

// 2. Precyzyjny szukacz kolumn
function findColIndex(dbCol, headers, sheetName) {
    let cDb = cleanString(dbCol);

    // Szukanie 1 do 1
    for (let i = 0; i < headers.length; i++) {
        if (!headers[i]) continue;
        let cH = cleanString(headers[i]);
        if (cH === cDb) return i;
        
        // Wycinanie śmieci z AppSheet
        let cStripped = cH.replace(/addedtime|uniqueid|email|file/g, '');
        if (cStripped === cDb) return i;
    }

    // Twarde wymuszenia na podstawie Twoich plików (Koniec z pomyłkami w Sprzedaży!)
    const overrides = {
        'Sprzedaz_data_sprzedazy': 'dataaddedtime',
        'Sprzedaz_id_zewnetrzne': 'id',
        'Sprzedaz_zabieg': 'jakizabieg',
        'Zadatki_data_wplaty': 'data',
        'Zadatki_cel': 'celopis',
        'Zadatki_pracownicy': 'pracownik',
        'Sugestie_matka': 'jesliklientkupilmatka',
        'Sugestie_dziecko': 'zaproponujtodziecko',
        'Klienci_imie_nazwisko': 'imieinazwisko',
        'Klienci_data_rejestracji': 'datarejestracji',
        'Rejestr_Oświadczeń_link_pdf': 'link',
        'Rejestr_RODO_email_kontaktowy': 'emailadres',
        'Rejestr_RODO_link_pdf': 'link',
        'Pracownicy_imie': 'imie',
        'Użytkownicy_imie_login': 'imie',
        'Użytkownicy_haslo_pin': 'pin',
        'Uslugi_wariant': 'podkategoria',
        'Memo_id_oryginalne': 'id',
        'Platnosci_data_platnosci': 'data',
        'Retencja_data_kontaktu': 'datakontaktu',
        'Logi_data_zdarzenia': 'data',
        'Logi_modul': 'produkt',
        'Koszty_data_kosztu': 'data',
        'Wyniki_konsultacja_data_wpisu': 'addedtime',
        'Wyniki_konsultacja_data_konsultacji': 'datedatakonsultacji',
        'Wyniki_konsultacja_zrodlo': 'konsultacjanormalnaczyzreklamy',
        'Wyniki_konsultacja_obszar': 'reklamanacialoczynatwarz',
        'Wyniki_konsultacja_klient': 'imieinazwiskoklientki',
        'Wyniki_konsultacja_telefon': 'numertelefonuklientki',
        'Wyniki_konsultacja_zabiegi_cialo': 'zabiegiwybranedlaklientkinacialo',
        'Wyniki_konsultacja_zabiegi_twarz': 'zabiegiwybranedlaklientkinatwarz',
        'Wyniki_konsultacja_kwota_reklama': 'kwotaktoraklientplacijakoreklama',
        'Wyniki_konsultacja_kwota_pakiet': 'kwotapakietuktoryklientkawybrala',
        'Wyniki_konsultacja_kto_wykonal': 'ktowykonalkonsultacje',
        'Wyniki_konsultacja_uwagi': 'dowolneuwagi',
        'Wyniki_konsultacja_typ_akcji': 'typakcjireklamowej',
        'Wyniki_konsultacja_upsell': 'kwotadobranaupsell',
        'Typy_konsultacji_nazwa': 'nazwa',
        'Raport_Magazyn_data_waznosci': 'data',
        'Raport_Kategorie_pelna_sciezka': 'pelnasciezka',
        'Archiwum_kto_dodal': 'ktododal',
        'Archiwum_data_dodania': 'datamodyfikacji',
        'Archiwum_kto_usunal': 'ktoarchiwizuje',
        'Archiwum_data_archiwizacji': 'dataarchiwizacji',
        'Magazyn_kto_dodal': 'ktododal',
        'Pracownicy_targety_miesiac': 'miesiacwformacieyyyymm',
        'Pracownicy_targety_opis_slowny': 'opisslownytwojnowyludzkiopis',
        'Ustawienia_haslo': 'haslo'
    };

    let key = `${sheetName}_${dbCol}`;
    if (overrides[key]) {
        for (let i = 0; i < headers.length; i++) {
            if (!headers[i]) continue;
            if (cleanString(headers[i]) === overrides[key]) return i;
        }
    }

    // Obsługa miesięcy (Daty urodzin + c_status)
    const months = ['styczen', 'luty', 'marzec', 'kwiecien', 'maj', 'czerwiec', 'lipiec', 'sierpien', 'wrzesien', 'pazdziernik', 'listopad', 'grudzien'];
    let cSheet = cleanString(sheetName);
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

function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return null;
        let y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, '0'), d = String(val.getDate()).padStart(2, '0');
        let h = String(val.getHours()).padStart(2, '0'), min = String(val.getMinutes()).padStart(2, '0'), s = String(val.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }
    let str = val.toString().trim().replace(/,/g, '');
    let mPL = str.match(/^(\d{1,2})[\.\- \/](\d{1,2})(?:[\.\- \/](\d{4}))?(?:\s+(\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?)?$/);
    if (mPL) {
        let p1 = parseInt(mPL[1], 10), p2 = parseInt(mPL[2], 10);
        let y = mPL[3] || '2000';
        let d = p1, m = p2;
        if (p1 > 12) { d = p1; m = p2; }
        else if (p2 > 12) { d = p2; m = p1; }
        
        let h = mPL[4]||'00', min = mPL[5]||'00', sec = mPL[6]||'00';
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${h.padStart(2,'0')}:${min.padStart(2,'0')}:${sec.padStart(2,'0')}`;
    }
    let mISO = str.match(/^(\d{4})[\.\- \/](\d{1,2})[\.\- \/](\d{1,2})(?:\s+(\d{1,2})[:\.](\d{2})(?:[:\.](\d{2}))?)?$/);
    if (mISO) {
        return `${mISO[1]}-${String(mISO[2]).padStart(2, '0')}-${String(mISO[3]).padStart(2, '0')} ${String(mISO[4]||'00').padStart(2,'0')}:${String(mISO[5]||'00').padStart(2,'0')}:${String(mISO[6]||'00').padStart(2,'0')}`;
    }
    return null;
}

async function startMigration() {
    try {
        const db = await mysql.createConnection({
            host: process.env.DB_HOST, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME
        });
        console.log('✅ Połączono z bazą. Ładuję plik Excel...');
        const workbook = xlsx.readFile(EXCEL_FILE, { cellDates: true });
        
        for (const sheetName of workbook.SheetNames) {
            console.log(`⏳ Migracja: [${sheetName}]`);
            
            const [columns] = await db.query(`SHOW COLUMNS FROM \`${sheetName}\``).catch(() => [[]]);
            if (columns.length === 0) continue;
            const dbCols = columns.map(c => c.Field).filter(f => !['id', 'tenant_id', 'utworzono_w'].includes(f));
            
            // Defval: null jest kluczowy dla dziurawych tabel jak "Sprzedaz"
            const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
            if (sheetData.length === 0) continue;

            await db.query(`DELETE FROM \`${sheetName}\``);

            let headers = sheetData[0];
            let startIndex = 1;

            // ZABEZPIECZENIE 1: Arkusze bez nagłówków - skrypt nadaje wirtualne nagłówki

            // Sprzedaz: kolumny 9-12 nie mają nagłówków w Excelu
            if (sheetName === 'Sprzedaz') {
                headers = [...headers]; // kopia żeby nie modyfikować oryginału
                if (!headers[9])  headers[9]  = 'platnosc';
                if (!headers[10]) headers[10] = 'id_klienta';
                if (!headers[11]) headers[11] = 'pracownik_dodajacy';
                if (!headers[12]) headers[12] = 'id_zadatku';
            }

            if (sheetName === 'Pracownicy' && headers[0] === 'Ola') {
                headers = ['imie'];
                startIndex = 0;
            }
            if (sheetName === 'Pracownicy_konsultacja' && headers[0] === 'Ola') {
                headers = ['imie', 'status', 'data']; // 'status' zamiast 'aktywny' - tak samo jak kolumna DB
                startIndex = 0;
            }
            if (sheetName === 'Typy_konsultacji') {
                // Brak nagłówków - kolejność kolumn odpowiada dokładnie kolumnom DB
                headers = ['nazwa', 'obszar', 'cena', 'prog', 'opis', 'status'];
                startIndex = 0;
            }

            const colMap = {};
            for (const dbCol of dbCols) {
                colMap[dbCol] = findColIndex(dbCol, headers, sheetName);
            }

            const insertCols = ['id', 'tenant_id', ...dbCols];
            const placeholders = insertCols.map(() => '?').join(',');
            const query = `INSERT INTO \`${sheetName}\` (${insertCols.map(c => `\`${c}\``).join(',')}) VALUES (${placeholders})`;

            let successCount = 0;

            for (let i = startIndex; i < sheetData.length; i++) {
                const row = sheetData[i];
                if (!row || row.length === 0 || row.every(c => c === null || c === '')) continue;

                // ZABEZPIECZENIE 2: Targety - Skrypt sam przesuwa liczby ze Szczegółów do Wartości
                if (sheetName === 'Pracownicy_targety') {
                    let idxWartosc = colMap['wartosc'];
                    let idxSzczegoly = findColIndex('szczegoly', headers, sheetName);
                    if (idxWartosc !== -1 && idxSzczegoly !== -1) {
                        if (!row[idxWartosc] && row[idxSzczegoly] && !isNaN(parseFloat(row[idxSzczegoly]))) {
                            row[idxWartosc] = row[idxSzczegoly]; 
                        }
                    }
                }

                const vals = [crypto.randomUUID(), TENANT_ID];
                
                for (const dbCol of dbCols) {
                    let val = colMap[dbCol] !== -1 ? row[colMap[dbCol]] : null;
                    
                    if (val === undefined || val === '') val = null;

                    if (val !== null) {
                        if (typeof val === 'string' && val.match(/^-?\d+,\d+$/)) {
                            val = val.replace(',', '.');
                        } else if (dbCol.includes('data') || dbCol.includes('czas')) {
                            let d = parseDate(val);
                            if (d !== null) val = d;
                        }
                    }
                    vals.push(val);
                }

                try {
                    await db.execute(query, vals);
                    successCount++;
                } catch (err) {
                    console.warn(`   ⚠️  Wiersz ${i}: ${err.message.substring(0, 120)}`);
                }
            }
            console.log(`   ✅ Wgrano ${successCount} wierszy.`);
        }
        console.log('\n🎉 OSTATECZNA MIGRACJA ZAKOŃCZONA SUKCESEM!');
        process.exit();
    } catch (error) {
        console.error('❌ Błąd główny:', error.message);
    }
}
startMigration();