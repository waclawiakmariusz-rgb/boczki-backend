// routes/leady.js
// Leady (potencjalni klienci) z importem z Google Sheets / publicznych arkuszy CSV.
// Mapowanie kolumn per import → deduplikacja po telefon/email → Auto-cron co 1h.

const express = require('express');
const { randomUUID } = require('crypto');
const csv = require('csv-parser');
const { Readable } = require('stream');

module.exports = (db) => {
  const router = express.Router();

  const ALLOWED_STATUSY = ['nowy', 'kontakt', 'umowiony', 'klient', 'odrzucony'];
  const ALLOWED_DEDUP   = ['telefon', 'email', 'telefon_lub_email'];

  // ─── MIGRACJE ────────────────────────────────────────────────
  db.query(`CREATE TABLE IF NOT EXISTS Leady (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    import_id VARCHAR(36),
    imie VARCHAR(100),
    nazwisko VARCHAR(100),
    telefon VARCHAR(50),
    email VARCHAR(150),
    notatka TEXT,
    kampania VARCHAR(150),
    zabieg VARCHAR(255),
    wartosc_sprzedazy DECIMAL(10,2) NULL,
    data_wizyty DATETIME NULL,
    dane_raw MEDIUMTEXT,
    zrodlo VARCHAR(150),
    status ENUM('nowy','kontakt','umowiony','klient','odrzucony') DEFAULT 'nowy',
    przypisane_do VARCHAR(100),
    data_zgloszenia DATETIME NULL,
    data_dodania DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_ostatniego_kontaktu DATETIME NULL,
    id_klienta_konwersja VARCHAR(50) NULL,
    INDEX idx_lead_tenant_status (tenant_id, status),
    INDEX idx_lead_tenant_telefon (tenant_id, telefon),
    INDEX idx_lead_tenant_email (tenant_id, email),
    INDEX idx_lead_tenant_kampania (tenant_id, kampania)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, (e) => { if (e) console.error('[Leady migrate]', e.message); });

  // Migracje dla istniejących baz — idempotentne ALTER (ignore "Duplicate column")
  const safeAlter = (sql, label) => db.query(sql, (e) => {
    if (e && !/Duplicate column|Duplicate key/i.test(e.message)) console.error('[Leady migrate ' + label + ']', e.message);
  });
  safeAlter('ALTER TABLE Leady ADD COLUMN kampania VARCHAR(150) NULL', 'kampania');
  safeAlter('ALTER TABLE Leady ADD COLUMN zabieg VARCHAR(255) NULL', 'zabieg');
  safeAlter('ALTER TABLE Leady ADD COLUMN wartosc_sprzedazy DECIMAL(10,2) NULL', 'wartosc');
  safeAlter('ALTER TABLE Leady ADD COLUMN data_wizyty DATETIME NULL', 'data_wizyty');
  safeAlter('ALTER TABLE Leady ADD COLUMN dane_raw MEDIUMTEXT NULL', 'dane_raw');
  // Pola workflow recepcji — edytowalne w karcie leada (mogą być też zaczytane z arkusza jako stan początkowy)
  safeAlter('ALTER TABLE Leady ADD COLUMN liczba_polaczen INT DEFAULT 0', 'liczba_polaczen');
  safeAlter('ALTER TABLE Leady ADD COLUMN wyslany_sms TINYINT(1) DEFAULT 0', 'wyslany_sms');
  safeAlter('ALTER TABLE Leady ADD COLUMN zadatek_kwota DECIMAL(10,2) NULL', 'zadatek_kwota');
  safeAlter('ALTER TABLE Leady ADD INDEX idx_lead_tenant_kampania (tenant_id, kampania)', 'idx_kampania');

  // Cleanup placeholder values w istniejących leadach (z importów przed naprawą placeholder'ów)
  setTimeout(() => {
    const placeholdersList = ['---','--','-','—','–','N/A','n/a','brak','none','null','nieaktualne'];
    const inClause = placeholdersList.map(() => '?').join(',');
    db.query(`UPDATE Leady SET nazwisko = '' WHERE nazwisko IN (${inClause})`, placeholdersList,
      (e) => { if (e) console.error('[Leady cleanup nazwisko]', e.message); });
    db.query(`UPDATE Leady SET email = '' WHERE email IN (${inClause}) OR email LIKE 'nie ma%'`, placeholdersList,
      (e) => { if (e) console.error('[Leady cleanup email]', e.message); });
  }, 1500);

  db.query(`CREATE TABLE IF NOT EXISTS Lead_Importy (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    nazwa VARCHAR(150) NOT NULL,
    url TEXT NOT NULL,
    mapowanie TEXT,
    klucz_dedup ENUM('telefon','email','telefon_lub_email') DEFAULT 'telefon',
    aktywny TINYINT DEFAULT 1,
    data_dodania DATETIME DEFAULT CURRENT_TIMESTAMP,
    ostatnia_synchronizacja DATETIME NULL,
    ostatni_status TEXT,
    INDEX idx_imp_tenant (tenant_id, aktywny)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, (e) => { if (e) console.error('[Lead_Importy migrate]', e.message); });

  db.query(`CREATE TABLE IF NOT EXISTS Lead_Komentarze (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    lead_id VARCHAR(36) NOT NULL,
    autor VARCHAR(100),
    tresc TEXT,
    data_utworzenia DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_lead (tenant_id, lead_id, data_utworzenia)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, (e) => { if (e) console.error('[Lead_Komentarze migrate]', e.message); });

  // ─── HELPERY ─────────────────────────────────────────────────

  // Konwertuj URL Google Sheets na endpoint export CSV (działa dla "Każdy z linkiem")
  // gidOverride (opcjonalny string/number) ma priorytet nad GID-em z URL.
  function googleSheetsToCsvUrl(url, gidOverride) {
    const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) return url; // nie Google Sheets — zostaw tak jak jest (może być direct CSV)
    const id = m[1];
    let gid;
    if (gidOverride !== null && gidOverride !== undefined && String(gidOverride).trim() !== '') {
      gid = String(gidOverride).replace(/[^\d]/g, '') || '0';
    } else {
      const gidMatch = url.match(/[#&?]gid=(\d+)/);
      gid = gidMatch ? gidMatch[1] : '0';
    }
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  }

  function wyciagnijGid(url) {
    const m = url.match(/[#&?]gid=(\d+)/);
    return m ? m[1] : '0';
  }

  function parseCSV(text) {
    return new Promise((resolve, reject) => {
      const rows = [];
      let headers = null;
      Readable.from([text]).pipe(csv())
        .on('headers', h => { headers = h; })
        .on('data', row => rows.push(row))
        .on('end', () => resolve({ headers: headers || [], rows }))
        .on('error', reject);
    });
  }

  async function pobierzCSV(url, gidOverride) {
    const csvUrl = googleSheetsToCsvUrl(url, gidOverride);
    const res = await fetch(csvUrl, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      throw new Error('Arkusz prawdopodobnie nie jest publiczny — udostępnij "Każdy z linkiem".');
    }
    const text = await res.text();
    const result = await parseCSV(text);
    result.csv_url_used = csvUrl;
    return result;
  }

  function parseDataZgloszenia(s) {
    if (!s) return null;
    const t = String(s).trim();
    if (!t) return null;
    // Spróbuj parse formatu ISO/EN/PL
    let d = new Date(t);
    if (isNaN(d.getTime())) {
      // Spróbuj DD.MM.YYYY / DD-MM-YYYY
      const m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
      if (m) d = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
    }
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  // Czy wartość to placeholder oznaczający "puste" (różne agencje używają różnych)
  // np. "---", "—", "n/a", "brak", "nie ma w formularzu", "—" itd.
  function isPlaceholder(v) {
    if (v === null || v === undefined) return true;
    const t = String(v).trim().toLowerCase();
    if (t === '') return true;
    if (['---','--','-','—','–','n/a','brak','nie ma','nie ma w formularzu','nieaktualne','none','null'].includes(t)) return true;
    // "nie ma..." cokolwiek
    if (t.startsWith('nie ma ')) return true;
    return false;
  }

  // Parser kwoty — akceptuje "1234,56", "1234.56", "1 234,56 zł", "1234"
  function parseKwota(s) {
    if (!s) return null;
    const t = String(s).replace(/[^\d.,-]/g, '').replace(/\s/g, '');
    if (!t) return null;
    const norm = t.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(norm);
    return isNaN(n) ? null : n;
  }

  // Parser bool — "tak"/"yes"/"true"/"1"/"x"/"✓" → true; "nie"/"no"/"0"/puste → false
  function parseBool(s) {
    if (!s) return false;
    const t = String(s).toLowerCase().trim();
    return ['tak','yes','true','1','x','✓','✔','t','y'].includes(t);
  }

  // Parser int — "3 połączenia" → 3
  function parseLiczba(s) {
    if (!s) return 0;
    const m = String(s).match(/-?\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  function mapujWiersz(row, mapowanie) {
    // get(): pobiera wartość, normalizuje placeholder ("---", "—", "nie ma w formularzu", itd.) na pusty string
    const get = key => {
      const raw = mapowanie[key] ? String(row[mapowanie[key]] || '').trim() : '';
      return isPlaceholder(raw) ? '' : raw;
    };

    let imie = get('imie').slice(0, 100);
    let nazwisko = get('nazwisko').slice(0, 100);
    // Heurystyka: jeśli "Imię" zawiera spację a "Nazwisko" jest puste — rozdziel
    // (np. agencja zapisuje "Anna Nowak" w jednej kolumnie)
    if (imie && !nazwisko && imie.includes(' ')) {
      const parts = imie.split(/\s+/);
      imie = parts[0].slice(0, 100);
      nazwisko = parts.slice(1).join(' ').slice(0, 100);
    }
    // Jeśli user zmapował tę samą kolumnę do obu — usuń duplikat
    if (imie && nazwisko && mapowanie.imie && mapowanie.imie === mapowanie.nazwisko) {
      nazwisko = '';
    }

    // Zadatek z arkusza może być kwotą ("100") lub bool'em ("tak"/"nie") — spróbuj kwotę najpierw
    const zadatekRaw = get('zadatek_kwota');
    let zadatekKwota = parseKwota(zadatekRaw);
    if (zadatekKwota === null && zadatekRaw && parseBool(zadatekRaw)) {
      zadatekKwota = 0; // wpłacony, kwota nieznana — recepcja uzupełni
    }

    // Telefon — wyczyść z prefixu typu "Polska+48..." → "+48..."
    const telefonRaw = get('telefon').replace(/[^\d+]/g, '').slice(0, 50);

    return {
      imie,
      nazwisko,
      telefon: telefonRaw,
      email: get('email').toLowerCase().slice(0, 150),
      notatka: get('notatka').slice(0, 5000),
      kampania: get('kampania').slice(0, 150),
      zabieg: get('zabieg').slice(0, 255),
      wartosc_sprzedazy: parseKwota(get('wartosc_sprzedazy')),
      data_wizyty: parseDataZgloszenia(get('data_wizyty')),
      data_zgloszenia: parseDataZgloszenia(get('data_zgloszenia')),
      liczba_polaczen: parseLiczba(get('liczba_polaczen')),
      wyslany_sms: parseBool(get('wyslany_sms')) ? 1 : 0,
      zadatek_kwota: zadatekKwota,
    };
  }

  // Sync: pobierz CSV, deduplikuj, dodaj brakujące
  async function syncImport(tenant_id, imp) {
    const mapowanie = (() => {
      try { return imp.mapowanie ? (typeof imp.mapowanie === 'string' ? JSON.parse(imp.mapowanie) : imp.mapowanie) : {}; }
      catch { return {}; }
    })();
    const klucz = imp.klucz_dedup || 'telefon';

    let result;
    try {
      // imp.url już zawiera GID (zapisany w import_zapisz z gidOverride albo z hash URL'a)
      result = await pobierzCSV(imp.url);
    } catch (err) {
      const msg = 'BLAD: ' + err.message;
      await new Promise(r => db.query('UPDATE Lead_Importy SET ostatnia_synchronizacja = NOW(), ostatni_status = ? WHERE id = ?', [msg.slice(0, 500), imp.id], () => r()));
      return { dodano: 0, error: err.message };
    }

    // Pobierz istniejące klucze dla deduplikacji
    const istniejace = await new Promise((resolve, reject) => {
      db.query('SELECT telefon, email FROM Leady WHERE tenant_id = ?', [tenant_id], (e, r) => e ? reject(e) : resolve(r || []));
    });
    const istnTel   = new Set(istniejace.map(r => String(r.telefon || '').trim()).filter(Boolean));
    const istnEmail = new Set(istniejace.map(r => String(r.email || '').toLowerCase().trim()).filter(Boolean));

    let dodano = 0;
    for (const row of result.rows) {
      const lead = mapujWiersz(row, mapowanie);
      if (!lead.telefon && !lead.email && !lead.imie) continue; // pusty wiersz
      // Deduplikacja
      const tel = lead.telefon;
      const eml = lead.email;
      if (klucz === 'telefon' && tel && istnTel.has(tel)) continue;
      if (klucz === 'email' && eml && istnEmail.has(eml)) continue;
      if (klucz === 'telefon_lub_email' && ((tel && istnTel.has(tel)) || (eml && istnEmail.has(eml)))) continue;

      const id = randomUUID();
      // Surowy wiersz do dane_raw — żeby nic nie zgubić niezależnie od mapowania
      const daneRaw = JSON.stringify(row).slice(0, 60000); // MEDIUMTEXT limit ~16MB; cap defensywnie
      await new Promise((resolve) => {
        db.query(
          `INSERT INTO Leady (id, tenant_id, import_id, imie, nazwisko, telefon, email, notatka,
                              kampania, zabieg, wartosc_sprzedazy, data_wizyty, dane_raw,
                              liczba_polaczen, wyslany_sms, zadatek_kwota,
                              zrodlo, data_zgloszenia, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nowy')`,
          [id, tenant_id, imp.id, lead.imie, lead.nazwisko, lead.telefon, lead.email, lead.notatka,
           lead.kampania, lead.zabieg, lead.wartosc_sprzedazy, lead.data_wizyty, daneRaw,
           lead.liczba_polaczen, lead.wyslany_sms, lead.zadatek_kwota,
           imp.nazwa, lead.data_zgloszenia],
          () => resolve()
        );
      });
      if (tel) istnTel.add(tel);
      if (eml) istnEmail.add(eml);
      dodano++;
    }

    const msg = `OK: dodano ${dodano} z ${result.rows.length} wierszy`;
    await new Promise(r => db.query('UPDATE Lead_Importy SET ostatnia_synchronizacja = NOW(), ostatni_status = ? WHERE id = ?', [msg, imp.id], () => r()));
    return { dodano, total: result.rows.length };
  }

  // ─── ROUTES ──────────────────────────────────────────────────
  router.post('/leady', async (req, res) => {
    const d = req.body || {};
    const tenant_id = d.tenant_id;
    const action = d.action;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id' });
    if (!action) return res.json({ status: 'error', message: 'Brak action' });

    if (action === 'list') {
      const status = d.status;
      const params = [tenant_id];
      let sql = `SELECT id, imie, nazwisko, telefon, email, notatka, zrodlo, status, przypisane_do,
                        kampania, zabieg, wartosc_sprzedazy, data_wizyty,
                        liczba_polaczen, wyslany_sms, zadatek_kwota,
                        data_zgloszenia, data_dodania, data_ostatniego_kontaktu, id_klienta_konwersja
                 FROM Leady WHERE tenant_id = ?`;
      if (status && ALLOWED_STATUSY.includes(status)) { sql += ' AND status = ?'; params.push(status); }
      sql += ' ORDER BY data_dodania DESC LIMIT 5000';
      db.query(sql, params, (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success', data: rows || [] });
      });

    } else if (action === 'get') {
      const id = d.id;
      db.query('SELECT * FROM Leady WHERE tenant_id = ? AND id = ? LIMIT 1', [tenant_id, id], (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        if (!rows.length) return res.json({ status: 'error', message: 'Nie znaleziono' });
        const lead = rows[0];
        db.query('SELECT id, autor, tresc, data_utworzenia FROM Lead_Komentarze WHERE tenant_id = ? AND lead_id = ? ORDER BY data_utworzenia ASC', [tenant_id, id], (e2, kRows) => {
          lead.komentarze = e2 ? [] : (kRows || []);
          res.json({ status: 'success', data: lead });
        });
      });

    } else if (action === 'update_status') {
      const id = d.id;
      const status = d.status;
      if (!ALLOWED_STATUSY.includes(status)) return res.json({ status: 'error', message: 'Niepoprawny status' });
      db.query('UPDATE Leady SET status = ?, data_ostatniego_kontaktu = NOW() WHERE tenant_id = ? AND id = ?',
        [status, tenant_id, id], (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          res.json({ status: 'success' });
        });

    } else if (action === 'update_pole') {
      const id = d.id;
      // Pola tekstowe (string)
      const polaTxt = ['imie', 'nazwisko', 'telefon', 'email', 'notatka', 'przypisane_do', 'kampania', 'zabieg'];
      // Pola liczbowe
      const polaInt = ['liczba_polaczen', 'wyslany_sms'];
      const polaDec = ['zadatek_kwota', 'wartosc_sprzedazy'];
      const updates = [], params = [];
      for (const p of polaTxt) {
        if (d[p] !== undefined) { updates.push(`${p} = ?`); params.push(String(d[p] || '').slice(0, 5000)); }
      }
      for (const p of polaInt) {
        if (d[p] !== undefined) { updates.push(`${p} = ?`); params.push(parseInt(d[p], 10) || 0); }
      }
      for (const p of polaDec) {
        if (d[p] !== undefined) {
          const v = d[p];
          updates.push(`${p} = ?`);
          params.push((v === null || v === '') ? null : (parseFloat(v) || 0));
        }
      }
      if (!updates.length) return res.json({ status: 'error', message: 'Brak pól do aktualizacji' });
      params.push(tenant_id, id);
      db.query(`UPDATE Leady SET ${updates.join(', ')} WHERE tenant_id = ? AND id = ?`, params, (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success' });
      });

    } else if (action === 'delete') {
      const id = d.id;
      db.query('DELETE FROM Leady WHERE tenant_id = ? AND id = ?', [tenant_id, id], (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        db.query('DELETE FROM Lead_Komentarze WHERE tenant_id = ? AND lead_id = ?', [tenant_id, id]);
        res.json({ status: 'success' });
      });

    } else if (action === 'add_komentarz') {
      const lead_id = d.lead_id;
      const autor = String(d.autor || '').slice(0, 100);
      const tresc = String(d.tresc || '').slice(0, 5000);
      if (!tresc) return res.json({ status: 'error', message: 'Pusty komentarz' });
      const id = randomUUID();
      db.query('INSERT INTO Lead_Komentarze (id, tenant_id, lead_id, autor, tresc) VALUES (?, ?, ?, ?, ?)',
        [id, tenant_id, lead_id, autor, tresc], (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          db.query('UPDATE Leady SET data_ostatniego_kontaktu = NOW() WHERE tenant_id = ? AND id = ?', [tenant_id, lead_id]);
          res.json({ status: 'success', id });
        });

    } else if (action === 'import_lista') {
      db.query(`SELECT id, nazwa, url, mapowanie, klucz_dedup, aktywny, data_dodania, ostatnia_synchronizacja, ostatni_status
                FROM Lead_Importy WHERE tenant_id = ? ORDER BY data_dodania DESC`, [tenant_id], (err, rows) => {
        if (err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success', data: rows || [] });
      });

    } else if (action === 'import_preview') {
      const url = String(d.url || '').trim();
      const gidOverride = d.gid !== undefined ? String(d.gid).trim() : null;
      if (!url) return res.json({ status: 'error', message: 'Brak url' });
      try {
        const result = await pobierzCSV(url, gidOverride);
        const gidUsed = (gidOverride && gidOverride !== '') ? gidOverride.replace(/[^\d]/g, '') : wyciagnijGid(url);
        return res.json({
          status: 'success',
          headers: result.headers,
          preview: result.rows.slice(0, 5),
          rows_count: result.rows.length,
          gid_used: gidUsed,
          csv_url_used: result.csv_url_used
        });
      } catch (err) {
        return res.json({ status: 'error', message: 'Nie udało się pobrać arkusza: ' + err.message });
      }

    } else if (action === 'import_zapisz') {
      const id = randomUUID();
      const nazwa = String(d.nazwa || 'Bez nazwy').slice(0, 150);
      const urlRaw = String(d.url || '');
      const gidOverride = d.gid !== undefined ? String(d.gid).trim() : null;
      // Zapisujemy URL bezpośrednio jako CSV-export endpoint — eliminuje to ryzyko
      // że ktoś (cron/sync) zinterpretuje URL inaczej niż preview (np. weźmie pierwszy
      // arkusz zamiast wybranego). Po zapisie URL = gotowy do fetch'a.
      const url = googleSheetsToCsvUrl(urlRaw, gidOverride);
      const mapowanie = JSON.stringify(d.mapowanie || {});
      const klucz_dedup = ALLOWED_DEDUP.includes(d.klucz_dedup) ? d.klucz_dedup : 'telefon';
      db.query('INSERT INTO Lead_Importy (id, tenant_id, nazwa, url, mapowanie, klucz_dedup, aktywny) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [id, tenant_id, nazwa, url, mapowanie, klucz_dedup], async (err) => {
          if (err) return res.json({ status: 'error', message: err.message });
          // Od razu odpalamy sync żeby user widział wynik
          try {
            const r = await syncImport(tenant_id, { id, url, mapowanie, klucz_dedup, nazwa });
            res.json({ status: 'success', id, dodano: r.dodano, total: r.total, error: r.error });
          } catch (e) {
            res.json({ status: 'success', id, dodano: 0, error: e.message });
          }
        });

    } else if (action === 'sync') {
      const import_id = d.import_id;
      db.query('SELECT * FROM Lead_Importy WHERE tenant_id = ? AND id = ? LIMIT 1', [tenant_id, import_id], async (err, rows) => {
        if (err || !rows.length) return res.json({ status: 'error', message: 'Import nie znaleziony' });
        try {
          const r = await syncImport(tenant_id, rows[0]);
          res.json({ status: 'success', dodano: r.dodano, total: r.total, error: r.error });
        } catch (e) {
          res.json({ status: 'error', message: e.message });
        }
      });

    } else if (action === 'import_delete') {
      const id = d.id;
      db.query('DELETE FROM Lead_Importy WHERE tenant_id = ? AND id = ?', [tenant_id, id], (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success' });
      });

    } else if (action === 'import_toggle') {
      const id = d.id;
      const aktywny = d.aktywny ? 1 : 0;
      db.query('UPDATE Lead_Importy SET aktywny = ? WHERE tenant_id = ? AND id = ?', [aktywny, tenant_id, id], (err) => {
        if (err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success' });
      });

    } else if (action === 'wyczysc_wszystkie') {
      // Wyczyść wszystkie leady, komentarze i źródła importu dla tenanta.
      // Używane gdy user chce zacząć od zera (np. zaimportował zły arkusz).
      db.query('DELETE FROM Lead_Komentarze WHERE tenant_id = ?', [tenant_id], (e1) => {
        if (e1) return res.json({ status: 'error', message: 'Komentarze: ' + e1.message });
        db.query('DELETE FROM Leady WHERE tenant_id = ?', [tenant_id], (e2, r2) => {
          if (e2) return res.json({ status: 'error', message: 'Leady: ' + e2.message });
          db.query('DELETE FROM Lead_Importy WHERE tenant_id = ?', [tenant_id], (e3, r3) => {
            if (e3) return res.json({ status: 'error', message: 'Importy: ' + e3.message });
            res.json({
              status: 'success',
              usunieto_leadow: r2.affectedRows || 0,
              usunieto_zrodel: r3.affectedRows || 0
            });
          });
        });
      });

    } else {
      res.json({ status: 'error', message: 'Nieznana akcja: ' + action });
    }
  });

  // ─── CRON: auto-sync co 1h ───────────────────────────────────
  // 2026-05-07: WYŁĄCZONY — moduł Leady został zawieszony (zmień LEADY_CRON_ENABLED
  // na true jeśli wraca w pełni). Endpoint API dalej działa, ale bez automatycznych
  // synchronizacji nie hamerujemy arkuszy/agencji w tle.
  const LEADY_CRON_ENABLED = false;
  if (LEADY_CRON_ENABLED) {
    const SYNC_INTERVAL_MS = 60 * 60 * 1000;
    setInterval(() => {
      db.query('SELECT id, tenant_id, url, mapowanie, klucz_dedup, nazwa FROM Lead_Importy WHERE aktywny = 1', [], async (err, rows) => {
        if (err) return console.error('[Leady cron]', err.message);
        for (const r of rows || []) {
          try {
            const result = await syncImport(r.tenant_id, r);
            if (result.dodano > 0 || result.error) {
              console.log(`[Leady cron] tenant=${r.tenant_id} import=${r.id} dodano=${result.dodano}${result.error ? ' err:' + result.error : ''}`);
            }
          } catch (e) {
            console.error(`[Leady cron] tenant=${r.tenant_id} import=${r.id} ERROR:`, e.message);
          }
        }
      });
    }, SYNC_INTERVAL_MS);
  }

  return router;
};
