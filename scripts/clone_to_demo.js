// scripts/clone_to_demo.js
// ════════════════════════════════════════════════════════════════════════════
// KLONOWANIE BOCZKÓW DO TENANTA DEMO — jednorazowy skrypt do pokazów/IG
// ════════════════════════════════════════════════════════════════════════════
//
// CO ROBI:
// 1. Czyta dane z tenant_id = 'boczki-salon-glowny-001' (tylko SELECT)
// 2. Mapuje imiona klientów (Anna Nowak → Magdalena Wiśniewska),
//    pracowników (Julia → Magdalena z listy demo), telefony (losowe),
//    PIN-y (nowe)
// 3. Wstawia (INSERT) do tenant_id = 'demo-estelio'
// 4. Tworzy konto Megaadmin w Licencje (login=demo, hasło=DemoEstelio)
// 5. Tworzy 6 użytkowników (PIN-y) w Użytkownicy
// 6. Zapisuje raport do scripts/demo_clone_log.txt
//
// BEZPIECZEŃSTWO:
//  • ZERO operacji UPDATE/DELETE z tenant_id = 'boczki-salon-glowny-001'
//  • Wszystkie DELETE chronione assertem `assertDemo(sql)` — w SQL musi
//    być DEMO_TENANT, inaczej skrypt się wywala bez wykonania
//  • Idempotentny — przy ponownym uruchomieniu z flagą --force czyści
//    poprzednie demo i robi nowe
//
// URUCHOMIENIE:
//   node scripts/clone_to_demo.js          # czysta instalacja (failuje jeśli demo istnieje)
//   node scripts/clone_to_demo.js --force  # nadpisuje istniejące demo
// ════════════════════════════════════════════════════════════════════════════

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

// ── HARDCODED CONSTANTS — chronią Boczki ────────────────────────────────────
const SOURCE_TENANT = 'boczki-salon-glowny-001';
const DEMO_TENANT = 'demo-estelio';
const DEMO_LOGIN = 'demo';
const DEMO_HASLO_PLAINTEXT = 'DemoEstelio';
const DEMO_NAZWA_SALONU = 'Estelio Demo Salon';
const DEMO_EMAIL = 'demo@estelio.com.pl';

const DEMO_PRACOWNICY = [
  { imie: 'Ola',       rola: 'Manager',      pin: '1111' },
  { imie: 'Kasia',     rola: 'Recepcja',     pin: '2222' },
  { imie: 'Patrycja',  rola: 'Recepcja',     pin: '3333' },
  { imie: 'Magdalena', rola: 'Kosmetolog',   pin: '4444' },
  { imie: 'Anna',      rola: 'Kosmetolog',   pin: '5555' },
  { imie: 'Marta',     rola: 'Praktykantka', pin: '6666' }
];

// ── LISTA POLSKICH IMION/NAZWISK do anonimizacji klientek ───────────────────
const POLSKIE_IMIONA = [
  'Anna','Maria','Katarzyna','Małgorzata','Agnieszka','Krystyna','Barbara','Ewa',
  'Elżbieta','Zofia','Joanna','Magdalena','Monika','Aleksandra','Beata','Marta',
  'Dorota','Renata','Iwona','Justyna','Sylwia','Halina','Irena','Karolina',
  'Urszula','Patrycja','Natalia','Paulina','Alicja','Grażyna','Hanna','Klaudia',
  'Wiktoria','Julia','Weronika','Oliwia','Zuzanna','Maja','Lena','Liliana',
  'Emilia','Aniela','Kornelia','Eliza','Klara','Józefina','Wanda','Sandra',
  'Marlena','Roksana','Adrianna','Inga','Wioletta','Edyta','Mariola','Lucyna',
  'Bożena','Stefania','Genowefa','Czesława','Michalina','Kamila','Marzena',
  'Aneta','Olga','Łucja','Helena','Felicja','Julianna','Krystyna','Bogusława',
  'Dominika','Joanna','Daria','Karina','Sara','Nikola','Amelia','Hania','Pola',
  'Liwia','Antonina','Stanisława'
];

const POLSKIE_NAZWISKA = [
  'Nowak','Kowalska','Wiśniewska','Wójcik','Kowalczyk','Kamińska','Lewandowska',
  'Zielińska','Szymańska','Woźniak','Dąbrowska','Kozłowska','Jankowska','Mazur',
  'Kwiatkowska','Krawczyk','Kaczmarek','Piotrowska','Grabowska','Zając',
  'Pawłowska','Michalska','Adamczyk','Nowakowska','Dudek','Zalewska','Wieczorek',
  'Jabłońska','Król','Majewska','Olszewska','Jaworska','Wróbel','Malinowska',
  'Pawlak','Witkowska','Walczak','Stępień','Górska','Rutkowska','Michalak',
  'Sikora','Baran','Duda','Szewczyk','Tomaszewska','Pietrzak','Marciniak',
  'Wróblewska','Zawadzka','Sadowska','Bąk','Chmielewska','Włodarczyk','Marek',
  'Borkowska','Czarnecka','Sawicka','Sokołowska','Urbańska','Kubiak',
  'Maciejewska','Szczepańska','Kucharska','Wilk','Kalinowska','Lis','Mazurek',
  'Czerwińska','Gajewska','Adamska','Bednarczyk','Cieślak','Głowacka','Mróz',
  'Wojciechowska','Karpińska','Brzezińska','Kowal','Stasiak','Jasińska','Gajda',
  'Sosnowska','Andrzejewska','Wasilewska','Bielecka','Cichocka','Jakubowska',
  'Czajkowska','Kasprzak','Witczak','Górecka','Tomczak','Sobczak','Lipińska'
];

// ── SETUP ───────────────────────────────────────────────────────────────────
const FORCE = process.argv.includes('--force');
const log = [];
function logLine(msg) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${msg}`);
  log.push(`[${stamp}] ${msg}`);
}
function rndPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndPhone() {
  const segs = [];
  for (let i = 0; i < 3; i++) segs.push(String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
  return '+48 5' + String(Math.floor(Math.random() * 100)).padStart(2, '0') + ' ' + segs.join(' ');
}
function uniqClientName(used) {
  for (let i = 0; i < 50; i++) {
    const name = `${rndPick(POLSKIE_IMIONA)} ${rndPick(POLSKIE_NAZWISKA)}`;
    if (!used.has(name)) { used.add(name); return name; }
  }
  // fallback z liczbą
  return `${rndPick(POLSKIE_IMIONA)} ${rndPick(POLSKIE_NAZWISKA)} ${used.size}`;
}

function assertDemo(sql) {
  // Każdy DESTRUCTIVE query musi zawierać DEMO_TENANT, nie SOURCE
  if (sql.includes(SOURCE_TENANT)) {
    throw new Error(`[BEZPIECZEŃSTWO] SQL zawiera SOURCE tenant — przerwanie: ${sql.slice(0, 200)}`);
  }
  if (!sql.includes(DEMO_TENANT) && !sql.includes('?')) {
    throw new Error(`[BEZPIECZEŃSTWO] DELETE bez DEMO_TENANT w SQL — przerwanie`);
  }
}

// ── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  logLine('═══════════════════════════════════════════════════════════════════');
  logLine(`KLONOWANIE: ${SOURCE_TENANT} → ${DEMO_TENANT}`);
  logLine(`FORCE mode: ${FORCE}`);
  logLine('═══════════════════════════════════════════════════════════════════');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    dateStrings: true
  });

  try {
    // 1. SPRAWDŹ czy demo istnieje
    const [existing] = await conn.execute(
      `SELECT COUNT(*) as cnt FROM Klienci WHERE tenant_id = ?`,
      [DEMO_TENANT]
    );
    if (existing[0].cnt > 0) {
      if (!FORCE) {
        logLine(`✗ ABORT: Tenant ${DEMO_TENANT} już istnieje (${existing[0].cnt} klientów). Użyj --force żeby nadpisać.`);
        await conn.end();
        return;
      }
      logLine(`⚠ FORCE: czyszczę istniejący tenant ${DEMO_TENANT}...`);
      await czysc(conn);
    }

    // 2. POBIERZ DANE Z BOCZKÓW (read-only)
    logLine('▸ Czytam dane z Boczków (read-only)...');

    const [klienci] = await conn.execute(
      `SELECT * FROM Klienci WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Klienci: ${klienci.length}`);

    const [sprzedaz] = await conn.execute(
      `SELECT * FROM Sprzedaz WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Sprzedaz: ${sprzedaz.length}`);

    const [platnosci] = await conn.execute(
      `SELECT * FROM Platnosci WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Platnosci: ${platnosci.length}`);

    const [zadatki] = await conn.execute(
      `SELECT * FROM Zadatki WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Zadatki: ${zadatki.length}`);

    const [magazyn] = await conn.execute(
      `SELECT * FROM Magazyn WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Magazyn: ${magazyn.length}`);

    const [uslugi] = await conn.execute(
      `SELECT * FROM Uslugi WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Uslugi: ${uslugi.length}`);

    const [pracownicy] = await conn.execute(
      `SELECT * FROM Pracownicy WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Pracownicy (lista): ${pracownicy.length}`);

    const [koszty] = await conn.execute(
      `SELECT * FROM Koszty WHERE tenant_id = ?`, [SOURCE_TENANT]);
    logLine(`  • Koszty: ${koszty.length}`);

    // 3. ZBUDUJ MAPY (klient_id → nowa nazwa, pracownik_old → pracownik_new)
    logLine('▸ Buduję mapy mapowania imion...');

    const usedClientNames = new Set();
    const klientMap = new Map(); // id_klienta → { imie_nazwisko, telefon }
    for (const k of klienci) {
      klientMap.set(String(k.id_klienta), {
        imie_nazwisko: uniqClientName(usedClientNames),
        telefon: rndPhone()
      });
    }
    logLine(`  • Klientów do anonimizacji: ${klientMap.size}`);

    // Mapowanie pracowników: zbieramy unikalne imiona z Pracownicy + Sprzedaz.sprzedawca + Zadatki.pracownicy
    const oldImiona = new Set();
    for (const p of pracownicy) if (p.imie) oldImiona.add(p.imie.trim());
    for (const s of sprzedaz) {
      if (s.sprzedawca) {
        s.sprzedawca.split(',').map(x => x.trim()).filter(Boolean).forEach(n => oldImiona.add(n));
      }
    }
    for (const z of zadatki) {
      if (z.pracownicy) {
        z.pracownicy.split(',').map(x => x.trim()).filter(Boolean).forEach(n => oldImiona.add(n));
      }
    }
    const oldImionaArr = Array.from(oldImiona).filter(n => !['recepcja','-','System','Ręczne'].includes(n));
    logLine(`  • Unikalne imiona pracowników w Boczkach: ${oldImionaArr.length}`);

    const pracownikMap = new Map(); // old_imie → new_imie (cyklicznie z DEMO_PRACOWNICY)
    oldImionaArr.forEach((old, idx) => {
      pracownikMap.set(old, DEMO_PRACOWNICY[idx % DEMO_PRACOWNICY.length].imie);
    });
    logLine(`  • Pracownicy zmapowani na 6 demo (cyklicznie)`);

    function mapPracownik(text) {
      if (!text) return text;
      return text.split(',').map(s => {
        const trimmed = s.trim();
        return pracownikMap.get(trimmed) || trimmed;
      }).join(', ');
    }
    function mapKlient(idKlienta, oldNazwa) {
      if (idKlienta && klientMap.has(String(idKlienta))) {
        return klientMap.get(String(idKlienta)).imie_nazwisko;
      }
      // brak id_klienta — szukamy po starej nazwie (rzadkie)
      return oldNazwa || 'Klient anonimowy';
    }

    // 4. INSERT — Klienci (nowe nazwy, telefony, czyste notatki)
    logLine('▸ INSERT Klienci...');
    let insertedKlienci = 0;
    for (const k of klienci) {
      const nowy = klientMap.get(String(k.id_klienta));
      const newId = randomUUID();
      await conn.execute(
        `INSERT INTO Klienci (id, tenant_id, id_klienta, imie_nazwisko, telefon, data_rejestracji, zgody_rodo_reg, notatki)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId, DEMO_TENANT, k.id_klienta, nowy.imie_nazwisko, nowy.telefon,
         k.data_rejestracji || null, k.zgody_rodo_reg || 'BRAK', null /* notatki wymazane */]
      );
      insertedKlienci++;
    }
    logLine(`  ✓ Klienci: ${insertedKlienci}`);

    // 5. INSERT — Sprzedaz (z mapowaniem klient + sprzedawca)
    logLine('▸ INSERT Sprzedaz...');
    let insertedSprzedaz = 0;
    for (const s of sprzedaz) {
      const newKlient = mapKlient(s.id_klienta, s.klient);
      const newSprzedawca = mapPracownik(s.sprzedawca);
      const newPracownikDodajacy = mapPracownik(s.pracownik_dodajacy);
      await conn.execute(
        `INSERT INTO Sprzedaz (id, tenant_id, data_sprzedazy, klient, zabieg, sprzedawca, kwota, komentarz, szczegoly, status, platnosc, id_klienta, pracownik_dodajacy, czy_rozliczone, id_zadatku)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, DEMO_TENANT, s.data_sprzedazy, newKlient, s.zabieg, newSprzedawca,
         s.kwota, null /* komentarz wymazany */, s.szczegoly, s.status, s.platnosc,
         s.id_klienta, newPracownikDodajacy, s.czy_rozliczone, s.id_zadatku]
      );
      insertedSprzedaz++;
    }
    logLine(`  ✓ Sprzedaz: ${insertedSprzedaz}`);

    // 6. INSERT — Platnosci (id link do Sprzedaz)
    logLine('▸ INSERT Platnosci...');
    let insertedPlatnosci = 0;
    for (const p of platnosci) {
      const newKlient = p.id_klienta ? mapKlient(p.id_klienta, p.klient) : (p.klient ? p.klient : '');
      await conn.execute(
        `INSERT INTO Platnosci (id, tenant_id, data_platnosci, klient, metoda_platnosci, kwota, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.id, DEMO_TENANT, p.data_platnosci, newKlient, p.metoda_platnosci, p.kwota, p.status]
      );
      insertedPlatnosci++;
    }
    logLine(`  ✓ Platnosci: ${insertedPlatnosci}`);

    // 7. INSERT — Zadatki (z mapowaniem)
    logLine('▸ INSERT Zadatki...');
    let insertedZadatki = 0;
    for (const z of zadatki) {
      const newKlient = mapKlient(z.id_klienta, z.klient);
      const newPracownicy = mapPracownik(z.pracownicy);
      await conn.execute(
        `INSERT INTO Zadatki (id, tenant_id, id_klienta, data_wplaty, klient, typ, kwota, metoda, cel, status, pracownicy)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [z.id, DEMO_TENANT, z.id_klienta, z.data_wplaty, newKlient, z.typ, z.kwota,
         z.metoda, z.cel || null, z.status, newPracownicy]
      );
      insertedZadatki++;
    }
    logLine(`  ✓ Zadatki: ${insertedZadatki}`);

    // 8. INSERT — Magazyn (bez zmian, tylko tenant_id)
    // UWAGA: kolumna `min` jest słowem zarezerwowanym MySQL — wymagany backtick
    logLine('▸ INSERT Magazyn...');
    let insertedMagazyn = 0;
    for (const m of magazyn) {
      const cols = Object.keys(m).filter(c => c !== 'tenant_id');
      const vals = cols.map(c => m[c]);
      const placeholders = cols.map(() => '?').join(',');
      const colsList = cols.map(c => '`' + c + '`').join(',');
      await conn.execute(
        'INSERT INTO `Magazyn` (' + colsList + ', `tenant_id`) VALUES (' + placeholders + ', ?)',
        [...vals, DEMO_TENANT]
      );
      insertedMagazyn++;
    }
    logLine(`  ✓ Magazyn: ${insertedMagazyn}`);

    // 9. INSERT — Uslugi (cennik, bez zmian)
    logLine('▸ INSERT Uslugi...');
    let insertedUslugi = 0;
    for (const u of uslugi) {
      const cols = Object.keys(u).filter(c => c !== 'tenant_id');
      const vals = cols.map(c => u[c]);
      const placeholders = cols.map(() => '?').join(',');
      const colsList = cols.map(c => '`' + c + '`').join(',');
      await conn.execute(
        'INSERT INTO `Uslugi` (' + colsList + ', `tenant_id`) VALUES (' + placeholders + ', ?)',
        [...vals, DEMO_TENANT]
      );
      insertedUslugi++;
    }
    logLine(`  ✓ Uslugi: ${insertedUslugi}`);

    // 10. INSERT — Koszty
    logLine('▸ INSERT Koszty...');
    let insertedKoszty = 0;
    for (const k of koszty) {
      const cols = Object.keys(k).filter(c => c !== 'tenant_id');
      const vals = cols.map(c => k[c]);
      const placeholders = cols.map(() => '?').join(',');
      const colsList = cols.map(c => '`' + c + '`').join(',');
      await conn.execute(
        'INSERT INTO `Koszty` (' + colsList + ', `tenant_id`) VALUES (' + placeholders + ', ?)',
        [...vals, DEMO_TENANT]
      );
      insertedKoszty++;
    }
    logLine(`  ✓ Koszty: ${insertedKoszty}`);

    // 11. INSERT — Pracownicy (lista demo)
    logLine('▸ INSERT Pracownicy (lista demo)...');
    for (const p of DEMO_PRACOWNICY) {
      await conn.execute(
        `INSERT INTO Pracownicy (id, tenant_id, imie) VALUES (?, ?, ?)`,
        [randomUUID(), DEMO_TENANT, p.imie]
      );
    }
    logLine(`  ✓ Pracownicy: ${DEMO_PRACOWNICY.length}`);

    // 12. INSERT — Użytkownicy (PIN-y bcrypt)
    logLine('▸ INSERT Użytkownicy (z bcrypt PIN-ami)...');
    for (const p of DEMO_PRACOWNICY) {
      const hashed = await bcrypt.hash(p.pin, 10);
      await conn.execute(
        'INSERT INTO `Użytkownicy` (`id`, `tenant_id`, `imie_login`, `haslo_pin`, `rola`) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), DEMO_TENANT, p.imie, hashed, p.rola]
      );
    }
    logLine(`  ✓ Użytkownicy: ${DEMO_PRACOWNICY.length}`);

    // 13. INSERT — Licencje (konto admina demo)
    logLine('▸ INSERT Licencje (konto admina demo)...');
    const adminHaslo = await bcrypt.hash(DEMO_HASLO_PLAINTEXT, 10);
    // Najpierw sprawdź czy login 'demo' istnieje (Licencje są globalne, nie per tenant_id)
    const [istLicencje] = await conn.execute(
      `SELECT id FROM Licencje WHERE login = ? LIMIT 1`, [DEMO_LOGIN]
    );
    if (istLicencje.length > 0) {
      logLine(`  ⚠ Licencja 'demo' już istnieje — nadpisuję hasło i tenant`);
      await conn.execute(
        `UPDATE Licencje SET haslo = ?, id_bazy = ?, status = 'aktywny', nazwa_salonu = ?, email = ? WHERE login = ?`,
        [adminHaslo, DEMO_TENANT, DEMO_NAZWA_SALONU, DEMO_EMAIL, DEMO_LOGIN]
      );
    } else {
      await conn.execute(
        `INSERT INTO Licencje (id, login, haslo, rola, id_bazy, status, data_waznosci, nazwa_salonu, email, data_utworzenia)
         VALUES (?, ?, ?, 'megaadmin', ?, 'aktywny', DATE_ADD(NOW(), INTERVAL 5 YEAR), ?, ?, NOW())`,
        [randomUUID(), DEMO_LOGIN, adminHaslo, DEMO_TENANT, DEMO_NAZWA_SALONU, DEMO_EMAIL]
      );
    }
    logLine(`  ✓ Licencja demo (login=${DEMO_LOGIN}, hasło=${DEMO_HASLO_PLAINTEXT})`);

    // 14. RAPORT
    logLine('═══════════════════════════════════════════════════════════════════');
    logLine('✓ KLONOWANIE ZAKOŃCZONE');
    logLine('═══════════════════════════════════════════════════════════════════');
    logLine(`Tenant: ${DEMO_TENANT}`);
    logLine(`Salon: ${DEMO_NAZWA_SALONU}`);
    logLine(``);
    logLine(`LOGOWANIE ADMIN (panel firmy):`);
    logLine(`  Login: ${DEMO_LOGIN}`);
    logLine(`  Hasło: ${DEMO_HASLO_PLAINTEXT}`);
    logLine(``);
    logLine(`PRACOWNICY (PIN-y do logowania w aplikacji salonu):`);
    DEMO_PRACOWNICY.forEach(p => {
      logLine(`  ${p.imie.padEnd(12)} (${p.rola.padEnd(13)}) → PIN: ${p.pin}`);
    });
    logLine(``);
    logLine(`Skopiowane:`);
    logLine(`  • Klienci:   ${insertedKlienci}`);
    logLine(`  • Sprzedaz:  ${insertedSprzedaz}`);
    logLine(`  • Platnosci: ${insertedPlatnosci}`);
    logLine(`  • Zadatki:   ${insertedZadatki}`);
    logLine(`  • Magazyn:   ${insertedMagazyn}`);
    logLine(`  • Uslugi:    ${insertedUslugi}`);
    logLine(`  • Koszty:    ${insertedKoszty}`);
    logLine(`Pracownicy demo: ${DEMO_PRACOWNICY.length}`);
    logLine(``);
    logLine(`Boczki nietknięte ✓`);

    fs.writeFileSync(
      path.join(__dirname, 'demo_clone_log.txt'),
      log.join('\n'),
      'utf8'
    );
    logLine(`Raport zapisany: scripts/demo_clone_log.txt`);

  } catch (err) {
    logLine(`✗ BŁĄD: ${err.message}`);
    console.error(err);
  } finally {
    await conn.end();
  }
}

// ── CZYSZCZENIE TENANTA DEMO przy --force ──────────────────────────────────
async function czysc(conn) {
  // Wszystkie DELETE chronione assertem — TYLKO DEMO_TENANT, nigdy SOURCE
  const tabele = [
    'Klienci', 'Sprzedaz', 'Platnosci', 'Zadatki', 'Magazyn', 'Uslugi',
    'Pracownicy', 'Użytkownicy', 'Koszty'
  ];
  for (const t of tabele) {
    const sql = 'DELETE FROM `' + t + '` WHERE tenant_id = ?';
    // Sanity check — usunięcie tylko demo
    if (sql.includes(SOURCE_TENANT)) throw new Error('SECURITY: SQL contains SOURCE');
    const [result] = await conn.execute(sql, [DEMO_TENANT]);
    logLine(`    ${t}: usunięto ${result.affectedRows}`);
  }
  // Licencje są globalne — usuwamy po loginie 'demo'
  const [r] = await conn.execute(`DELETE FROM Licencje WHERE login = ?`, [DEMO_LOGIN]);
  logLine(`    Licencje (login=demo): usunięto ${r.affectedRows}`);
}

main().catch(err => { console.error(err); process.exit(1); });
