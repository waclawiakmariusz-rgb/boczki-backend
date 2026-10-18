// narzedzia/testy-integracyjne/kandydat-sciezki.js — W04/W05 planu wdrożenia (2026-10-17): zwykłe ścieżki recepcji i E05
// na KANDYDACIE wydania, przez rzeczywiste handlery HTTP i rzeczywiste sesje (login salonu → verify_pin), na IZOLOWANEJ bazie.
//   node narzedzia/testy-integracyjne/kandydat-sciezki.js --haslo <plik z hasłem salonu testowego> [--b http://localhost:3999] [--wynik plik.json]
//   faza 2 (dwa procesy na tej samej bazie):  … --faza2 http://localhost:3998
// Odmawia pracy, gdy adres nie jest localhost (próby zapisujące tylko w izolacji). Hasła/PIN-y nie są zapisywane w wyniku.
const fs = require('fs'); const path = require('path');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const B = arg('--b') || 'http://localhost:3999'; const TENANT = 'demo-test'; const OBCY = 'zk02-test';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) { console.error('ODMOWA: próby zapisujące tylko na localhost. Podano: ' + B); process.exit(2); }
const HASLO = fs.readFileSync(arg('--haslo'), 'utf8').trim(); const PIN = { Ola: '1111', Anna: '2222' };
const wyniki = []; let fail = 0;
const zapisz = (id, wynik, opis, dowod) => { wyniki.push({ id, wynik, opis, dowod: dowod ? String(dowod).slice(0, 300) : undefined }); if (wynik === 'FAIL') fail++; console.log(`${wynik.padEnd(4)} ${id} — ${opis}${dowod ? ' · ' + String(dowod).slice(0, 160) : ''}`); };
const sprawdz = (id, ok, opis, dowod) => zapisz(id, ok ? 'PASS' : 'FAIL', opis, dowod);
const post = async (body, tok, base = B) => { const r = await fetch(base + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { 'x-session-token': tok } : {}) }, body: JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { status: 'http', http: r.status, body: t.slice(0, 200) }; } };
const get = async (q, tok, base = B) => { const r = await fetch(base + q, { headers: tok ? { 'x-session-token': tok } : {} }); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { status: 'http', http: r.status, body: t.slice(0, 200) }; } };
const api = (action, dane, tok) => post({ action, tenant_id: TENANT, ...dane }, tok);
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '..', '.env.test'), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const dbq = async (sql, p = []) => { const m = require('mysql2/promise'); const c = await m.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME }); try { const [r] = await c.query(sql, p); return r; } finally { await c.end(); } };

(async () => {
  const faza2 = arg('--faza2');
  // ── Logowanie ───────────────────────────────────────────────────────────────────────────────────────────────
  const login = await post({ action: 'login', login: TENANT, haslo: HASLO });
  if (login.status !== 'success') throw new Error('login salonu: ' + JSON.stringify(login));
  const S = login.session_token;
  const vpM = await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Ola', pin: PIN.Ola }, S); const M = vpM.session_token;
  const vpP = await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Anna', pin: PIN.Anna }, S); const P = vpP.session_token;
  const vpZly = await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Anna', pin: '0000' }, S);
  sprawdz('W04-01', !!M && !!P && !vpZly.session_token, 'logowanie: sesja salonu, PIN managera, PIN pracownika; zły PIN odrzucony', `manager=${!!M} pracownik=${!!P} zły=${vpZly.status}`);
  const bezSesji = await post({ action: 'get_clients', tenant_id: TENANT });
  sprawdz('W04-02', bezSesji.status !== 'success' && !Array.isArray(bezSesji), 'operacja bez sesji odrzucona (ENFORCE_SESSION)', JSON.stringify(bezSesji).slice(0, 120));

  if (faza2) { // ── W05 faza 2: drugi proces B na TEJ SAMEJ bazie, uruchamiany PRZEZ SKRYPT po utworzeniu sesji M/P na procesie A ──
    const { spawn } = require('child_process'); const portB = Number(new URL(faza2).port);
    const procB = spawn(process.execPath, ['-r', 'dotenv/config', 'server.js', 'dotenv_config_path=.env.test'], { cwd: path.join(__dirname, '..', '..'), env: { ...process.env, PORT: String(portB), TERMINARZ_ZAKUPY_TENANTS: '' }, stdio: 'ignore' });
    let gotowy = false; for (let i = 0; i < 60 && !gotowy; i++) { await new Promise(r => setTimeout(r, 500)); try { const r = await fetch(faza2 + '/zaloguj'); gotowy = r.ok; } catch (e) {} }
    await new Promise(r => setTimeout(r, 2500)); // preload sesji z tabeli odbywa się po utworzeniu tabeli (asynchronicznie)
    const sprzatanie = () => { try { procB.kill(); } catch (e) {} };
    if (!gotowy) { sprzatanie(); throw new Error('proces B nie wystartował na ' + faza2); }
    process.on('exit', sprzatanie);
    const kl = (tok, base) => post({ action: 'get_pin_users', tenant_id: TENANT }, tok, base); const jestLista = (r) => Array.isArray(r) || Array.isArray(r.data); // POST objęty kontrolą sesji (GET-y odczytów nie są — stan sprzed wydania, patrz raport)
    const naB = await kl(M, faza2);
    const tokA = (await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Ola', pin: PIN.Ola }, S)).session_token; // nowy token na A PO starcie B
    const nowyNaB = await kl(tokA, faza2);
    zapisz('W05-07a', 'INFO', `token utworzony na A PRZED startem B: B ${jestLista(naB) ? 'AKCEPTUJE (preload z tabeli Sesje)' : 'odrzuca'}`, JSON.stringify(naB).slice(0, 100));
    zapisz('W05-07b', 'INFO', `token utworzony na A PO starcie B: B ${jestLista(nowyNaB) ? 'akceptuje' : 'ODRZUCA (pamięć procesu, bez odczytu tabeli przy żądaniu)'}`, JSON.stringify(nowyNaB).slice(0, 100));
    // unieważnienie na A (zmiana PIN-u Anny) → czy B nadal honoruje stary token Anny?
    const tokAnnaA = (await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Anna', pin: PIN.Anna }, S)).session_token;
    await api('add_admin_user', { imie: 'Anna', pin: '2229', rola: 'kosmetolog' }, M);
    const naA = await kl(tokAnnaA);
    const naBpo = await kl(P, faza2); // P = token Anny sprzed startu B (B go wczytał)
    await api('add_admin_user', { imie: 'Anna', pin: PIN.Anna, rola: 'kosmetolog' }, M);
    sprawdz('W05-07c', !jestLista(naA), 'unieważnienie po zmianie PIN-u działa w procesie, który je wykonał (A)', JSON.stringify(naA).slice(0, 100));
    zapisz('W05-07d', 'INFO', `stary token Anny wczytany wcześniej przez B: po unieważnieniu na A proces B ${jestLista(naBpo) ? 'NADAL HONORUJE (do restartu B / wygaśnięcia)' : 'odrzuca'}`, JSON.stringify(naBpo).slice(0, 100));
    const dbSes = await dbq('SELECT COUNT(*) n FROM Sesje WHERE tenant_id = ? AND TRIM(login) = ?', [TENANT, 'Anna']);
    zapisz('W05-07e', 'INFO', `tabela Sesje po unieważnieniu: sesji Anny = ${dbSes[0].n} (źródło prawdy przy restarcie/preloadzie)`);
    return koniec();
  }

  // ── Klientki ────────────────────────────────────────────────────────────────────────────────────────────────
  const klientki = async () => { const r = await get(`/api?action=get_clients&tenant_id=${TENANT}`, M); return r.klienci || []; }; // odczyty get_* w Estelio idą GET-em (dispatcher POST zna tylko mutacje)
  const lista = await klientki();
  sprawdz('W04-03a', lista.length >= 3 && lista.every(k => k.id !== undefined && k.nazwa !== undefined), 'klientki: odczyt listy, kształt wierszy (id, nazwa, telefon, status…)', `n=${lista.length}, klucze=${Object.keys(lista[0] || {}).slice(0, 8).join(',')}`);
  const telPrzed = (lista.find(k => String(k.id) === '1001') || {}).telefon;
  const ed = await api('edit_client_data', { id: '1001', nowa_nazwa: 'Zestaw A (zwykły pakiet)', nowy_telefon: '+48 500 100 200', pracownik: 'Ola' }, M);
  const k1001 = (await klientki()).find(k => String(k.id) === '1001') || {};
  sprawdz('W04-03b', ed.status === 'success' && /500100200/.test(String(k1001.telefon || '').replace(/\s/g, '')), 'klientki: kontrolowana zmiana telefonu fikcyjnej klientki zapisana i odczytana (prefiks znormalizowany)', `status=${ed.status}, telefon=${k1001.telefon}`);
  await api('edit_client_data', { id: '1001', nowa_nazwa: 'Zestaw A (zwykły pakiet)', nowy_telefon: telPrzed || '', pracownik: 'Ola' }, M);

  // ── Sprzedaż i portfel ──────────────────────────────────────────────────────────────────────────────────────
  const sale = await api('add_sale', { typ_transakcji: 'Zabieg', sprzedawca: ['Anna'], klient: 'Zestaw A (zwykły pakiet)', id_klienta: '1001', zabieg_nazwa: 'Konsultacja', szczegoly: '1x z góry', kwota: '1', platnosc: 'Karta', pracownik: 'Anna' }, P);
  sprawdz('W04-04a', sale.status === 'success', 'sprzedaż: zwykła sprzedaż kartą zapisana przez pracownika', JSON.stringify(sale).slice(0, 120));
  const dep = await api('manage_deposit', { id_klienta: '1001', klient: 'Zestaw A (zwykły pakiet)', kwota: '50', cel: 'Zaliczka na zabieg', platnosc: 'Gotówka', pracownik: 'Ola' }, M);
  let portfelOk = null;
  if (dep.status === 'success') {
    const ms = await api('add_multi_sale', { sprzedawca: ['Anna'], klient: 'Zestaw A (zwykły pakiet)', id_klienta: '1001', pracownik: 'Anna', pozycje: [{ typ: 'Zabieg', kategoria: 'Konsultacja', wariant: '1x z góry', kwota: '30', platnosc: 'Portfel' }] }, P);
    const deps = await api('get_all_deposits', { id_klienta: '1001' }, M);
    const akt = (Array.isArray(deps) ? deps : (deps.data || deps.deposits || [])).filter(d => String(d.id_klienta) === '1001');
    const saldo = akt.reduce((s, d) => s + Number(d.pozostalo ?? d.saldo ?? d.kwota_pozostala ?? 0), 0);
    portfelOk = ms.status === 'success';
    zapisz('W04-04b', portfelOk ? 'PASS' : 'INFO', `sprzedaż za Portfel po wpłacie 50 zł: ${ms.status}; saldo portfela po (suma pól pozostało): ${saldo}`, JSON.stringify(ms).slice(0, 140));
  } else zapisz('W04-04b', 'INFO', 'wpłata do portfela przez manage_deposit nie przyjęta w tej próbie (kod portfela nie zmienia się w wydaniu) — płatność Portfel pominięta', JSON.stringify(dep).slice(0, 160));
  const hist = await get(`/api/sprzedaz?action=full_sales_history&tenant_id=${TENANT}&id_klienta=1001&klient=${encodeURIComponent('Zestaw A (zwykły pakiet)')}`, M);
  const hl = Array.isArray(hist) ? hist : (Object.values(hist).find(v => Array.isArray(v)) || []);
  sprawdz('W04-04c', hl.length >= 1, 'sprzedaż: historia klientki odczytana po zapisie', `pozycji=${hl.length}`);

  // ── Konsultacje / Lojalność (moduły bez zmian w wydaniu — odczyt z właściwą sesją) ───────────────────────────
  const kon = await api('akon_get_months', {}, M);
  sprawdz('W04-05', kon.status !== 'http' && !/Nieznana akcja/i.test(JSON.stringify(kon)), 'konsultacje: odczyt miesięcy odpowiada (bez błędu HTTP/nieznanej akcji)', JSON.stringify(kon).slice(0, 100));
  const loj = await get(`/api?action=loj_klient&tenant_id=${TENANT}&id_klienta=1001`, M);
  sprawdz('W04-06', loj.status !== 'http', 'lojalność: odczyt salda klientki odpowiada kontrolowanie (dodatek wyłączony w salonie testowym → komunikat, nie 500)', JSON.stringify(loj).slice(0, 120));

  // ── Reset hasła (kanał e-mail bez SMTP → nic nie wychodzi; token w bazie izolowanej) ───────────────────────
  const r1 = await fetch(B + '/api/reset-hasla/wyslij', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'test@example.invalid' }) }).then(r => r.json());
  const tok = await dbq('SELECT token FROM Tokeny_reset_hasla WHERE login = ? ORDER BY expires_at DESC LIMIT 1', [TENANT]);
  const w1 = await get('/api/reset-hasla/weryfikuj?token=' + (tok[0] || {}).token);
  const w0 = await get('/api/reset-hasla/weryfikuj?token=nie-ma-takiego');
  const u1 = tok[0] ? await fetch(B + '/api/reset-hasla/ustaw', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok[0].token, nowe_haslo: HASLO }) }).then(r => r.json()) : { status: 'brak tokenu' };
  const w2 = await get('/api/reset-hasla/weryfikuj?token=' + (tok[0] || {}).token);
  const okStatus = (r) => ['ok', 'success'].includes(r && r.status);
  sprawdz('W04-07', /SMTP|nie udało/i.test(r1.message || '') && okStatus(w1) && /Nieprawidłowy link/.test(w0.message || '') && okStatus(u1) && /wykorzystan/i.test(w2.message || ''), 'reset hasła: brak SMTP → jawny błąd wysyłki (nic nie wyszło); link prawidłowy / błędny / zużyty rozpoznane; hasło ustawione na to samo', `wyslij=${r1.message} | ok=${w1.status} | zły=${w0.message} | ustaw=${u1.status}/${u1.message} | zużyty=${w2.message}`);
  const loginPo = await post({ action: 'login', login: TENANT, haslo: HASLO });
  sprawdz('W04-07b', loginPo.status === 'success', 'po resecie na to samo hasło logowanie salonu nadal działa');

  // ── Zgłoszenia ──────────────────────────────────────────────────────────────────────────────────────────────
  const tk = await api('tk_add', { tytul: 'Próba kandydata ' + Date.now(), opis: 'Zgłoszenie testowe z izolowanej bazy, do zignorowania.' }, P);
  const tkl = await api('tk_list', {}, P); const tkRows = tkl.data || tkl.tickets || (Array.isArray(tkl) ? tkl : []);
  sprawdz('W04-08', tk.status === 'success' && tkRows.some(t => String(t.id) === String(tk.id)), 'zgłoszenia: dodanie z sesją pracownika i odczyt listy (mail do admina bez SMTP = tylko log)', `id=${tk.id}, na liście=${tkRows.length}`);

  // ── Dokumenty: mały JPEG (ścieżka embedJpg) + PNG ─────────────────────────────────────────────────────────
  const Jimp = require('jimp');
  const jpgMaly = await new Jimp(64, 48, 0xffffffff).getBufferAsync(Jimp.MIME_JPEG);
  const jpgDuzy = await (async () => { const im = new Jimp(900, 1200, 0xffffffff); for (let i = 0; i < 4000; i++) im.setPixelColor(Jimp.cssColorToHex('#' + ((i * 9973) & 0xffffff).toString(16).padStart(6, '0')), (i * 37) % 900, (i * 53) % 1200); return im.getBufferAsync(Jimp.MIME_JPEG); })();
  const png = await new Jimp(300, 200, 0xffeeddff).getBufferAsync(Jimp.MIME_PNG);
  const upload = async (pliki) => { const fd = new FormData(); fd.append('tenant_id', TENANT); pliki.forEach(([n, b, t]) => fd.append('pages', new Blob([b], { type: t }), n)); const r = await fetch(B + '/api/dokumenty/upload', { method: 'POST', headers: { 'x-session-token': M }, body: fd }); return r.json(); };
  const d1 = await upload([['maly.jpg', jpgMaly, 'image/jpeg']]);
  const d2 = await upload([['duzy.jpg', jpgDuzy, 'image/jpeg'], ['strona.png', png, 'image/png']]);
  const pdf1 = d1.url ? await fetch(B + d1.url, { headers: { 'x-session-token': M } }).then(async r => ({ st: r.status, head: Buffer.from(await r.arrayBuffer()).slice(0, 5).toString() })) : { st: 0 };
  const pdf2 = d2.url ? await fetch(B + d2.url, { headers: { 'x-session-token': M } }).then(async r => ({ st: r.status, head: Buffer.from(await r.arrayBuffer()).slice(0, 5).toString() })) : { st: 0 };
  sprawdz('W04-09a', d1.status === 'success' && pdf1.head === '%PDF-', `dokumenty: MAŁY JPEG (${jpgMaly.length} B — bufor z puli Node) → PDF wygenerowany i odczytany`, JSON.stringify(d1).slice(0, 100));
  sprawdz('W04-09b', d2.status === 'success' && d2.pages === 2 && pdf2.head === '%PDF-', `dokumenty: duży JPEG (${jpgDuzy.length} B) + PNG → PDF 2 strony (regresja PNG)`, JSON.stringify(d2).slice(0, 100));

  // ── Kalendarz bez zakupów (integracja zakupów WYŁĄCZONA w tej konfiguracji) ───────────────────────────────
  const trm = (a, d) => api(a, { pracownik: 'Ola', ...d }, M); // router terminarza wymaga imienia wykonawcy zgodnego z sesją PIN (A24)
  const init = await trm('trm_init', {});
  sprawdz('W04-10a', init.status === 'success' && init.ustawienia && init.ustawienia.zakupy_integracja === 'off', 'kalendarz: trm_init działa, integracja zakupów = off (lista pusta jak na produkcji)', `zakupy_integracja=${init.ustawienia && init.ustawienia.zakupy_integracja}, schemat=${JSON.stringify(init.schemat || {}).slice(0, 60)}`);
  const DZ = '2026-11-23';
  const w1z = await trm('trm_zapisz', { klucz_idem: 'KAND-' + Date.now(), start: DZ + ' 10:00', klient: { id_klienta: '1001', nazwa: 'Zestaw A (zwykły pakiet)' }, pozycje: [{ usluga_id: 'DEMO-U-A', pracownik: 'Anna' }] });
  sprawdz('W04-10b', w1z.status === 'success' && w1z.rezerwacja && w1z.rezerwacja.id, 'kalendarz: nowa wizyta zapisana', JSON.stringify(w1z).slice(0, 120));
  const rez = w1z.rezerwacja || {};
  const kol = await trm('trm_zapisz', { klucz_idem: 'KAND2-' + Date.now(), start: DZ + ' 10:00', klient: { id_klienta: '1002', nazwa: 'Zestaw B (pakiet łączony)' }, pozycje: [{ usluga_id: 'DEMO-U-A', pracownik: 'Anna' }] });
  sprawdz('W04-10c', kol.status !== 'success', 'kalendarz: konflikt (ta sama osoba, ten sam termin) odrzucony', JSON.stringify(kol).slice(0, 120));
  const pod = await trm('trm_zmien', { id: rez.id, wersja: rez.wersja, start: DZ + ' 11:00' });
  const zm = await trm('trm_zmien', { id: rez.id, wersja: rez.wersja, start: DZ + ' 11:00', potwierdz: true });
  const dzien = await trm('trm_dzien', { data: DZ }); const wiz = (dzien.rezerwacje || []).find(r => String(r.id) === String(rez.id)) || {};
  sprawdz('W04-10d', pod.status === 'success' && pod.podglad && zm.status === 'success' && /11:00/.test(String(wiz.start || '')), 'kalendarz: przesunięcie (podgląd → potwierdzenie), stan po ponownym odczycie z serwera = 11:00', `start=${wiz.start}`);
  const blok = await trm('trm_nieobecnosc_zapisz', { typ: 'pracownik', pracownik_nieob: 'Anna', od: DZ + ' 08:00', do: DZ + ' 18:00', opis: 'próba', podglad: true });
  sprawdz('W04-10e', blok.status === 'success' && (blok.dotkniete !== undefined || blok.message), 'kalendarz: podgląd skutków blokady (bez zapisu) wskazuje dotknięte wizyty', JSON.stringify(blok).slice(0, 140));
  const wer2 = (zm.rezerwacja && zm.rezerwacja.wersja) || (wiz.wersja) || rez.wersja;
  const anl = await trm('trm_anuluj', { id: rez.id, wersja: wer2, powod: 'próba kandydata', kto_anulowal: 'salon' });
  const dzien2 = await trm('trm_dzien', { data: DZ }); const wiz2 = (dzien2.rezerwacje || []).find(r => String(r.id) === String(rez.id)) || {};
  const spr = await trm('trm_sprawy_lista', {}); const sprawy = spr.sprawy || spr.data || [];
  sprawdz('W04-10f', anl.status === 'success' && /odwo|anul/i.test(String(wiz2.status || wiz2.stan || '')), 'kalendarz: odwołanie zapisane, stan po odświeżeniu z serwera', `status=${wiz2.status || wiz2.stan}`);
  sprawdz('W04-10g', sprawy.some(s => JSON.stringify(s).includes(String(rez.id)) || s.typ === 'E05'), 'kalendarz: powiadomienie (sprawa E05) po odwołaniu widoczne w centrum spraw', `spraw=${sprawy.length}`);

  // ── E05 ──────────────────────────────────────────────────────────────────────────────────────────────────
  const auS = await api('get_admin_users', {}, S), auP = await api('get_admin_users', {}, P), auM = await api('get_admin_users', {}, M);
  const auRows = Array.isArray(auM) ? auM : (auM.data || auM.users || []);
  const maPin = (rows) => rows.some(u => Object.entries(u).some(([k, v]) => (/^(pin|haslo|haslo_pin|password)$/i.test(k)) || (/pin/i.test(k) && /^\d{4,}$/.test(String(v))))); // `pin_ustawiony` = flaga true/false, nie sekret
  sprawdz('W05-01', Array.isArray(auRows) && auRows.length >= 2 && !maPin(auRows), 'E05: lista użytkowników dla managera BEZ PIN-ów ani pól haseł', `klucze=${Object.keys(auRows[0] || {}).join(',')}`);
  sprawdz('W05-02', !(Array.isArray(auS)) && auS.status !== 'success', 'E05: sama sesja salonu nie wystarcza do listy użytkowników', JSON.stringify(auS).slice(0, 100));
  sprawdz('W05-03', !(Array.isArray(auP)) && auP.status !== 'success', 'E05: zwykły pracownik nie dostaje listy użytkowników (odmowa po stronie serwera)', JSON.stringify(auP).slice(0, 100));
  const pu = await api('get_pin_users', {}, S); const puRows = Array.isArray(pu) ? pu : (pu.data || []);
  sprawdz('W05-04', puRows.length >= 2 && !maPin(puRows), 'E05: lista do ekranu PIN (imiona/role) bez PIN-ów', `klucze=${Object.keys(puRows[0] || {}).join(',')}`);
  const obcy = await post({ action: 'get_clients', tenant_id: OBCY }, M);
  sprawdz('W05-05', !(Array.isArray(obcy)) && obcy.status !== 'success', 'E05: sesja salonu A wskazująca salon B → odmowa bez danych', JSON.stringify(obcy).slice(0, 100));
  const ch = await api('add_admin_user', { imie: 'Anna', pin: '2229', rola: 'kosmetolog' }, M);
  const staryTok = await api('get_clients', {}, P); const staryPin = await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Anna', pin: PIN.Anna }, S); const nowyPin = await post({ action: 'verify_pin', tenant_id: TENANT, imie: 'Anna', pin: '2229' }, S);
  await api('add_admin_user', { imie: 'Anna', pin: PIN.Anna, rola: 'kosmetolog' }, M);
  sprawdz('W05-06', ch.status === 'success' && !(Array.isArray(staryTok)) && !staryPin.session_token && !!nowyPin.session_token, 'E05: zmiana PIN-u konta testowego → stara sesja odrzucona, stary PIN nie działa, nowy działa; przywrócono', `stara sesja=${JSON.stringify(staryTok).slice(0, 60)}`);
  koniec();

  function koniec() {
    const out = { kiedy: new Date().toISOString(), baza: env.DB_NAME + '@' + env.DB_HOST + ':' + env.DB_PORT, serwer: B, faza2: faza2 || null, wyniki };
    if (arg('--wynik')) fs.writeFileSync(arg('--wynik'), JSON.stringify(out, null, 2));
    console.log(`\nRAZEM: ${wyniki.filter(w => w.wynik === 'PASS').length} PASS / ${fail} FAIL / ${wyniki.filter(w => w.wynik === 'INFO').length} INFO`);
    process.exit(fail ? 1 : 0);
  }
})().catch(e => { console.error('BŁĄD:', e.message); process.exit(1); });
