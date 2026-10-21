// Reguła pilności — próba na IZOLOWANEJ bazie (port 3307). Buduję trzy sytuacje i patrzę,
// co robi z nimi przebieg tickSprawy: zaległość sprzed tygodnia, sprawa o wczorajszej wizycie
// i sprawa o wizycie jutrzejszej (kontrola — ta ma dalej być pilna).
const mysql = require(process.cwd() + '/node_modules/mysql2/promise');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const B = 'http://localhost:3999'; const T = 'demo-test';
const fs = require('fs');
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  require('dotenv').config({ path: process.cwd() + '/.env.test' });
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3307, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  const pokaz = async (etykieta) => {
    const [r] = await c.execute(`SELECT id, typ, priorytet, stan, LEFT(tytul, 42) AS tytul,
      DATE_FORMAT(powiazany_czas,'%Y-%m-%d %H:%i') AS termin, DATE_FORMAT(utworzono,'%Y-%m-%d %H:%i') AS wpis
      FROM Term_Sprawy WHERE tenant_id = ? AND id IN (?, ?, ?) ORDER BY id`, [T, ids.zalegla, ids.wczoraj, ids.jutro]);
    console.log('\n' + etykieta);
    for (const x of r) console.log(`   ${String(x.typ).padEnd(4)} ${String(x.priorytet).padEnd(3)} ${String(x.tytul).padEnd(44)} termin: ${String(x.termin || '—').padEnd(17)} wpis: ${x.wpis}`);
  };

  // ── 1. zaległość E13 sprzed tygodnia (wpis cofnięty o 8 dni, nigdy nieeskalowana)
  const [e13] = await c.execute(`SELECT id FROM Term_Sprawy WHERE tenant_id = ? AND typ = 'E13' AND stan = 'nowa' ORDER BY id DESC LIMIT 1`, [T]);
  // ── 2. sprawa o wizycie sprzed dwóch dni (termin cofnięty, nadal P0 po staremu)
  const [e05] = await c.execute(`SELECT id FROM Term_Sprawy WHERE tenant_id = ? AND typ = 'E05' AND priorytet = 'P0' ORDER BY id LIMIT 1`, [T]);
  // ── 3. kontrola: sprawa o wizycie jutrzejszej
  const [e05j] = await c.execute(`SELECT id FROM Term_Sprawy WHERE tenant_id = ? AND typ = 'E05' AND powiazany_czas > NOW() ORDER BY id DESC LIMIT 1`, [T]);
  if (!e13.length || !e05.length || !e05j.length) { console.error('brak materiału do próby:', e13.length, e05.length, e05j.length); process.exit(1); }
  const ids = { zalegla: e13[0].id, wczoraj: e05[0].id, jutro: e05j[0].id };

  await c.execute(`UPDATE Term_Sprawy SET priorytet = 'P0', eskalowano_o = NULL, utworzono = DATE_SUB(NOW(), INTERVAL 8 DAY), powiazany_czas = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = ?`, [ids.zalegla]);
  await c.execute(`UPDATE Term_Sprawy SET priorytet = 'P0', powiazany_czas = DATE_SUB(NOW(), INTERVAL 48 HOUR) WHERE id = ?`, [ids.wczoraj]);
  await c.execute(`UPDATE Term_Sprawy SET priorytet = 'P0' WHERE id = ?`, [ids.jutro]);
  await pokaz('PRZED przebiegiem (wszystkie ustawione na „Pilne teraz"):');

  console.log('\nczekam na przebieg tickSprawy (do 70 s)…');
  for (let i = 0; i < 14; i++) {
    await sleep(5000);
    const [r] = await c.execute(`SELECT COUNT(*) AS n FROM Term_Sprawy WHERE id IN (?, ?) AND priorytet = 'P1'`, [ids.zalegla, ids.wczoraj]);
    if (r[0].n === 2) { console.log(`   zmiana po ~${(i + 1) * 5} s`); break; }
  }
  await pokaz('PO przebiegu:');

  const [dz] = await c.execute(`SELECT sprawa_id, akcja, opis FROM Term_Sprawy_Dziennik WHERE sprawa_id IN (?, ?, ?) AND akcja IN ('wygaszenie','eskalacja') ORDER BY id DESC LIMIT 4`, [ids.zalegla, ids.wczoraj, ids.jutro]);
  console.log('\nwpisy w dzienniku spraw:');
  dz.forEach(x => console.log('   sprawa', x.sprawa_id, '·', x.akcja, '·', x.opis));

  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const lista = await post({ action: 'trm_sprawy_lista', tenant_id: T, pracownik: 'Ola', zakladka: 'do_dzialania' }, { 'x-session-token': tok });
  const s = lista.sprawy || [];
  console.log('\nco pokaże dzwonek:', s.length, 'spraw do działania ·', s.filter(x => x.priorytet === 'P0').length, 'pilnych');
  await c.end(); process.exit(0);
})().catch(e => { console.error('BLAD:', e.message); process.exit(1); });
