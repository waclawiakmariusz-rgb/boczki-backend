// scripts/clone_to_demo_lib.js
// Logika klonowania Boczków do demo — używana zarówno przez CLI (clone_to_demo.js)
// jak i przez endpoint admina (POST /api/admin/clone_demo)
//
// BEZPIECZEŃSTWO:
//  • Hardcoded SOURCE_TENANT i DEMO_TENANT
//  • Boczki: tylko SELECT (żaden UPDATE/DELETE/INSERT z tym tenant_id)
//  • Demo: tylko INSERT/DELETE
// ════════════════════════════════════════════════════════════════════════════

const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');

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

const POLSKIE_IMIONA = ['Anna','Maria','Katarzyna','Małgorzata','Agnieszka','Krystyna','Barbara','Ewa','Elżbieta','Zofia','Joanna','Magdalena','Monika','Aleksandra','Beata','Marta','Dorota','Renata','Iwona','Justyna','Sylwia','Halina','Irena','Karolina','Urszula','Patrycja','Natalia','Paulina','Alicja','Grażyna','Hanna','Klaudia','Wiktoria','Julia','Weronika','Oliwia','Zuzanna','Maja','Lena','Liliana','Emilia','Aniela','Kornelia','Eliza','Klara','Józefina','Wanda','Sandra','Marlena','Roksana','Adrianna','Inga','Wioletta','Edyta','Mariola','Lucyna','Bożena','Stefania','Genowefa','Czesława','Michalina','Kamila','Marzena','Aneta','Olga','Łucja','Helena','Felicja','Julianna','Bogusława','Dominika','Daria','Karina','Sara','Nikola','Amelia','Hania','Pola','Liwia','Antonina','Stanisława'];

const POLSKIE_NAZWISKA = ['Nowak','Kowalska','Wiśniewska','Wójcik','Kowalczyk','Kamińska','Lewandowska','Zielińska','Szymańska','Woźniak','Dąbrowska','Kozłowska','Jankowska','Mazur','Kwiatkowska','Krawczyk','Kaczmarek','Piotrowska','Grabowska','Zając','Pawłowska','Michalska','Adamczyk','Nowakowska','Dudek','Zalewska','Wieczorek','Jabłońska','Król','Majewska','Olszewska','Jaworska','Wróbel','Malinowska','Pawlak','Witkowska','Walczak','Stępień','Górska','Rutkowska','Michalak','Sikora','Baran','Duda','Szewczyk','Tomaszewska','Pietrzak','Marciniak','Wróblewska','Zawadzka','Sadowska','Bąk','Chmielewska','Włodarczyk','Marek','Borkowska','Czarnecka','Sawicka','Sokołowska','Urbańska','Kubiak','Maciejewska','Szczepańska','Kucharska','Wilk','Kalinowska','Lis','Mazurek','Czerwińska','Gajewska','Adamska','Bednarczyk','Cieślak','Głowacka','Mróz','Wojciechowska','Karpińska','Brzezińska','Kowal','Stasiak','Jasińska','Gajda','Sosnowska','Andrzejewska','Wasilewska','Bielecka','Cichocka','Jakubowska','Czajkowska','Kasprzak','Witczak','Górecka','Tomczak','Sobczak','Lipińska'];

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
  return `${rndPick(POLSKIE_IMIONA)} ${rndPick(POLSKIE_NAZWISKA)} ${used.size}`;
}

// Promisuje db.query (mysql callback-style → promise)
function q(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

/**
 * Klonuje dane Boczków (tenant: boczki-salon-glowny-001) do nowego tenanta demo-estelio
 * z anonimizacją imion klientów i pracowników.
 *
 * @param {object} db — pula MySQL z server.js (callback-style mysql2)
 * @param {object} opts — { force: boolean } — czy nadpisać istniejące demo
 * @returns {Promise<object>} { status, log, stats, credentials }
 */
async function cloneBoczkiToDemo(db, opts = {}) {
  const force = !!opts.force;
  const log = [];
  const logLine = (msg) => {
    const stamp = new Date().toISOString();
    log.push(`[${stamp}] ${msg}`);
    console.log(`[CLONE] ${msg}`);
  };

  logLine('═══════════════════════════════════════════════════════════════════');
  logLine(`KLONOWANIE: ${SOURCE_TENANT} → ${DEMO_TENANT}`);
  logLine(`FORCE mode: ${force}`);
  logLine('═══════════════════════════════════════════════════════════════════');

  // 1. SPRAWDŹ czy demo istnieje
  const existing = await q(db, 'SELECT COUNT(*) as cnt FROM `Klienci` WHERE tenant_id = ?', [DEMO_TENANT]);
  if (existing[0].cnt > 0) {
    if (!force) {
      return { status: 'error', message: `Tenant ${DEMO_TENANT} już istnieje (${existing[0].cnt} klientów). Użyj opcji 'force' żeby nadpisać.`, log };
    }
    logLine(`⚠ FORCE: czyszczę istniejący tenant ${DEMO_TENANT}...`);
    const tabele = ['Klienci','Sprzedaz','Platnosci','Zadatki','Magazyn','Uslugi','Pracownicy','Użytkownicy','Koszty'];
    for (const t of tabele) {
      const sql = 'DELETE FROM `' + t + '` WHERE tenant_id = ?';
      if (sql.includes(SOURCE_TENANT)) throw new Error('SECURITY: SQL contains SOURCE');
      const result = await q(db, sql, [DEMO_TENANT]);
      logLine(`    ${t}: usunięto ${result.affectedRows}`);
    }
    await q(db, 'DELETE FROM `Licencje` WHERE login = ?', [DEMO_LOGIN]);
    logLine(`    Licencje (login=demo): usunięto`);
  }

  // 2. POBIERZ DANE Z BOCZKÓW (READ-ONLY)
  logLine('▸ Czytam dane z Boczków (read-only)...');
  const klienci   = await q(db, 'SELECT * FROM `Klienci` WHERE tenant_id = ?',   [SOURCE_TENANT]); logLine(`  • Klienci: ${klienci.length}`);
  const sprzedaz  = await q(db, 'SELECT * FROM `Sprzedaz` WHERE tenant_id = ?',  [SOURCE_TENANT]); logLine(`  • Sprzedaz: ${sprzedaz.length}`);
  const platnosci = await q(db, 'SELECT * FROM `Platnosci` WHERE tenant_id = ?', [SOURCE_TENANT]); logLine(`  • Platnosci: ${platnosci.length}`);
  const zadatki   = await q(db, 'SELECT * FROM `Zadatki` WHERE tenant_id = ?',   [SOURCE_TENANT]); logLine(`  • Zadatki: ${zadatki.length}`);
  const magazyn   = await q(db, 'SELECT * FROM `Magazyn` WHERE tenant_id = ?',   [SOURCE_TENANT]); logLine(`  • Magazyn: ${magazyn.length}`);
  const uslugi    = await q(db, 'SELECT * FROM `Uslugi` WHERE tenant_id = ?',    [SOURCE_TENANT]); logLine(`  • Uslugi: ${uslugi.length}`);
  const pracownicy= await q(db, 'SELECT * FROM `Pracownicy` WHERE tenant_id = ?',[SOURCE_TENANT]); logLine(`  • Pracownicy: ${pracownicy.length}`);
  const koszty    = await q(db, 'SELECT * FROM `Koszty` WHERE tenant_id = ?',    [SOURCE_TENANT]); logLine(`  • Koszty: ${koszty.length}`);

  // 3. MAPY ANONIMIZACJI
  logLine('▸ Buduję mapy anonimizacji...');
  const usedClientNames = new Set();
  const klientMap = new Map();
  for (const k of klienci) {
    klientMap.set(String(k.id_klienta), {
      imie_nazwisko: uniqClientName(usedClientNames),
      telefon: rndPhone()
    });
  }

  const oldImiona = new Set();
  for (const p of pracownicy) if (p.imie) oldImiona.add(p.imie.trim());
  for (const s of sprzedaz) if (s.sprzedawca) s.sprzedawca.split(',').map(x => x.trim()).filter(Boolean).forEach(n => oldImiona.add(n));
  for (const z of zadatki) if (z.pracownicy) z.pracownicy.split(',').map(x => x.trim()).filter(Boolean).forEach(n => oldImiona.add(n));
  const oldImionaArr = Array.from(oldImiona).filter(n => !['recepcja','-','System','Ręczne','Booksy'].includes(n));
  const pracownikMap = new Map();
  oldImionaArr.forEach((old, idx) => pracownikMap.set(old, DEMO_PRACOWNICY[idx % DEMO_PRACOWNICY.length].imie));

  const mapPracownik = (text) => {
    if (!text) return text;
    return text.split(',').map(s => {
      const t = s.trim();
      return pracownikMap.get(t) || t;
    }).join(', ');
  };
  const mapKlient = (idKlienta, oldNazwa) => {
    if (idKlienta && klientMap.has(String(idKlienta))) return klientMap.get(String(idKlienta)).imie_nazwisko;
    return oldNazwa || 'Klient anonimowy';
  };

  // 4. INSERTY (każda tabela osobno, batch po 1)
  let insK = 0, insS = 0, insP = 0, insZ = 0, insM = 0, insU = 0, insKo = 0;

  logLine('▸ INSERT Klienci...');
  for (const k of klienci) {
    const nowy = klientMap.get(String(k.id_klienta));
    await q(db,
      'INSERT INTO `Klienci` (`id`,`tenant_id`,`id_klienta`,`imie_nazwisko`,`telefon`,`data_rejestracji`,`zgody_rodo_reg`,`notatki`) VALUES (?,?,?,?,?,?,?,?)',
      [randomUUID(), DEMO_TENANT, k.id_klienta, nowy.imie_nazwisko, nowy.telefon, k.data_rejestracji || null, k.zgody_rodo_reg || 'BRAK', null]
    );
    insK++;
  }
  logLine(`  ✓ Klienci: ${insK}`);

  logLine('▸ INSERT Sprzedaz...');
  for (const s of sprzedaz) {
    await q(db,
      'INSERT INTO `Sprzedaz` (`id`,`tenant_id`,`data_sprzedazy`,`klient`,`zabieg`,`sprzedawca`,`kwota`,`komentarz`,`szczegoly`,`status`,`platnosc`,`id_klienta`,`pracownik_dodajacy`,`czy_rozliczone`,`id_zadatku`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [s.id, DEMO_TENANT, s.data_sprzedazy, mapKlient(s.id_klienta, s.klient), s.zabieg, mapPracownik(s.sprzedawca), s.kwota, null, s.szczegoly, s.status, s.platnosc, s.id_klienta, mapPracownik(s.pracownik_dodajacy), s.czy_rozliczone, s.id_zadatku]
    );
    insS++;
  }
  logLine(`  ✓ Sprzedaz: ${insS}`);

  logLine('▸ INSERT Platnosci...');
  for (const p of platnosci) {
    await q(db,
      'INSERT INTO `Platnosci` (`id`,`tenant_id`,`data_platnosci`,`klient`,`metoda_platnosci`,`kwota`,`status`) VALUES (?,?,?,?,?,?,?)',
      [p.id, DEMO_TENANT, p.data_platnosci, p.klient || '', p.metoda_platnosci, p.kwota, p.status]
    );
    insP++;
  }
  logLine(`  ✓ Platnosci: ${insP}`);

  logLine('▸ INSERT Zadatki...');
  for (const z of zadatki) {
    await q(db,
      'INSERT INTO `Zadatki` (`id`,`tenant_id`,`id_klienta`,`data_wplaty`,`klient`,`typ`,`kwota`,`metoda`,`cel`,`status`,`pracownicy`) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [z.id, DEMO_TENANT, z.id_klienta, z.data_wplaty, mapKlient(z.id_klienta, z.klient), z.typ, z.kwota, z.metoda, z.cel || null, z.status, mapPracownik(z.pracownicy)]
    );
    insZ++;
  }
  logLine(`  ✓ Zadatki: ${insZ}`);

  logLine('▸ INSERT Magazyn...');
  for (const m of magazyn) {
    const cols = Object.keys(m).filter(c => c !== 'tenant_id');
    const colsList = cols.map(c => '`' + c + '`').join(',');
    const placeholders = cols.map(() => '?').join(',');
    await q(db,
      'INSERT INTO `Magazyn` (' + colsList + ', `tenant_id`) VALUES (' + placeholders + ', ?)',
      [...cols.map(c => m[c]), DEMO_TENANT]
    );
    insM++;
  }
  logLine(`  ✓ Magazyn: ${insM}`);

  logLine('▸ INSERT Uslugi...');
  for (const u of uslugi) {
    const cols = Object.keys(u).filter(c => c !== 'tenant_id');
    const colsList = cols.map(c => '`' + c + '`').join(',');
    const placeholders = cols.map(() => '?').join(',');
    await q(db,
      'INSERT INTO `Uslugi` (' + colsList + ', `tenant_id`) VALUES (' + placeholders + ', ?)',
      [...cols.map(c => u[c]), DEMO_TENANT]
    );
    insU++;
  }
  logLine(`  ✓ Uslugi: ${insU}`);

  logLine('▸ INSERT Koszty...');
  for (const k of koszty) {
    const cols = Object.keys(k).filter(c => c !== 'tenant_id');
    const colsList = cols.map(c => '`' + c + '`').join(',');
    const placeholders = cols.map(() => '?').join(',');
    await q(db,
      'INSERT INTO `Koszty` (' + colsList + ', `tenant_id`) VALUES (' + placeholders + ', ?)',
      [...cols.map(c => k[c]), DEMO_TENANT]
    );
    insKo++;
  }
  logLine(`  ✓ Koszty: ${insKo}`);

  // 5. PRACOWNICY DEMO
  logLine('▸ INSERT Pracownicy (demo)...');
  for (const p of DEMO_PRACOWNICY) {
    await q(db, 'INSERT INTO `Pracownicy` (`id`, `tenant_id`, `imie`) VALUES (?, ?, ?)', [randomUUID(), DEMO_TENANT, p.imie]);
  }

  logLine('▸ INSERT Użytkownicy (PIN-y bcrypt)...');
  for (const p of DEMO_PRACOWNICY) {
    const hashed = await bcrypt.hash(p.pin, 10);
    await q(db, 'INSERT INTO `Użytkownicy` (`id`, `tenant_id`, `imie_login`, `haslo_pin`, `rola`) VALUES (?, ?, ?, ?, ?)', [randomUUID(), DEMO_TENANT, p.imie, hashed, p.rola]);
  }

  // 6. LICENCJA DEMO
  logLine('▸ INSERT Licencje (admin demo)...');
  const adminHash = await bcrypt.hash(DEMO_HASLO_PLAINTEXT, 10);
  const istLic = await q(db, 'SELECT id FROM `Licencje` WHERE login = ? LIMIT 1', [DEMO_LOGIN]);
  if (istLic.length > 0) {
    await q(db,
      'UPDATE `Licencje` SET `haslo`=?, `id_bazy`=?, `status`=?, `nazwa_salonu`=?, `email`=? WHERE `login`=?',
      [adminHash, DEMO_TENANT, 'aktywny', DEMO_NAZWA_SALONU, DEMO_EMAIL, DEMO_LOGIN]
    );
  } else {
    await q(db,
      "INSERT INTO `Licencje` (`id`,`login`,`haslo`,`rola`,`id_bazy`,`status`,`data_waznosci`,`nazwa_salonu`,`email`,`data_utworzenia`) VALUES (?,?,?,'megaadmin',?,'aktywny',DATE_ADD(NOW(), INTERVAL 5 YEAR),?,?,NOW())",
      [randomUUID(), DEMO_LOGIN, adminHash, DEMO_TENANT, DEMO_NAZWA_SALONU, DEMO_EMAIL]
    );
  }

  logLine('═══════════════════════════════════════════════════════════════════');
  logLine('✓ KLONOWANIE ZAKOŃCZONE');

  const stats = { klienci: insK, sprzedaz: insS, platnosci: insP, zadatki: insZ, magazyn: insM, uslugi: insU, koszty: insKo, pracownicyDemo: DEMO_PRACOWNICY.length };
  const credentials = {
    tenant_id: DEMO_TENANT,
    salon: DEMO_NAZWA_SALONU,
    admin_login: DEMO_LOGIN,
    admin_haslo: DEMO_HASLO_PLAINTEXT,
    pracownicy: DEMO_PRACOWNICY.map(p => ({ imie: p.imie, rola: p.rola, pin: p.pin }))
  };
  return { status: 'success', stats, credentials, log };
}

module.exports = { cloneBoczkiToDemo, SOURCE_TENANT, DEMO_TENANT };
