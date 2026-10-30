// Szybka rezerwacja (hold) — symulacja upływu czasu na bazie IZOLOWANEJ: hold „Anny Testowej” z części A dostaje hold_do
// w przeszłości, potem uruchamiamy to samo wygaszanie, które na serwerze robi tykanie co minutę (routes/terminarz.js → wygasHoldy).
// Ostatnia linia wyjścia to JSON z podstawieniami dla scenariusza B: __HOLDB__ (id rezerwacji) i __TOKB__ (token linku,
// ten sam HMAC co serwer, bo ten sam .env.test). Wołany przez proba-ekranu.js jako "przygotuj" scenariusza terminarz-szybka-rezerwacja-b.json.
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..', '..');
require(path.join(KORZEN, 'node_modules', 'dotenv')).config({ path: path.join(KORZEN, '.env.test') });
process.env.NODE_ENV = 'test'; // moduł terminarza nie ma startować własnego tykania
const mysql = require(path.join(KORZEN, 'node_modules', 'mysql2'));
const T = 'demo-test';
(async () => {
  if (process.env.DB_NAME !== 'estelio_test') throw new Error('To nie jest baza izolowana: ' + process.env.DB_NAME + ' — odmowa');
  // pula, nie pojedyncze połączenie — moduł terminarza bierze połączenie do transakcji przez db.getConnection()
  const db = mysql.createPool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 3 });
  const q = (sql, p = []) => new Promise((res, rej) => db.query(sql, p, (e, r) => e ? rej(e) : res(r)));
  const [rez] = await q(`SELECT id, klient_nazwa, status, DATE_FORMAT(hold_do,'%Y-%m-%d %H:%i') AS hold_do FROM Term_Rezerwacje WHERE tenant_id = ? AND klient_nazwa = 'Anna Testowa' AND status = 'do_wplaty' ORDER BY id DESC LIMIT 1`, [T]);
  if (!rez) throw new Error('Brak holdu Anny Testowej w stanie do_wplaty — najpierw uruchom scenariusz terminarz-szybka-rezerwacja-a.json');
  console.log(`hold B przed: EST-${String(rez.id).padStart(4, '0')} ${rez.status}, trzymany do ${rez.hold_do}`);
  await q(`UPDATE Term_Rezerwacje SET hold_do = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE tenant_id = ? AND id = ?`, [T, rez.id]);
  const terminarz = require(path.join(KORZEN, 'routes', 'terminarz'))(db, { log: { error: () => {}, warn: () => {}, log: () => {} } });
  await new Promise(r => setTimeout(r, 1500)); // migracje idempotentne przy ładowaniu modułu
  await terminarz._wygasHoldy();
  const [po] = await q(`SELECT status FROM Term_Rezerwacje WHERE tenant_id = ? AND id = ?`, [T, rez.id]);
  const [spr] = await q(`SELECT typ, stan FROM Term_Sprawy WHERE tenant_id = ? AND rezerwacja_id = ? AND typ = 'E40'`, [T, rez.id]);
  console.log(`hold B po wygaszeniu: ${po.status}; sprawa E40: ${spr ? spr.stan : 'BRAK'}`);
  if (po.status !== 'wygasla') throw new Error('Wygaszanie nie zadziałało — hold nadal ' + po.status);
  const [zg] = await q(`SELECT id, created_at FROM ZgodyPlatnosci WHERE tenant_id = ? AND rezerwacja_id = ? ORDER BY id DESC LIMIT 1`, [T, rez.id]);
  const ZG = require(path.join(KORZEN, 'routes', 'zgody')).narzedzia;
  const token = zg ? ZG.makeToken({ t: T, id: zg.id, exp: new Date(zg.created_at).getTime() + ZG.TOKEN_TTL_MS }) : '';
  await new Promise(r => db.end(r));
  console.log(JSON.stringify({ HOLDB: rez.id, TOKB: token }));
})().catch(e => { console.error(e.message); process.exit(1); });
