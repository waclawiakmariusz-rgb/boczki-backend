#!/usr/bin/env node
/*
  PANEL PRÓB — lokalna strona do uruchamiania prób ekranu (narzedzia/proba-ekranu.js) i przeglądania wyników.

  Uruchomienie:  npm run panel-prob        (albo: node narzedzia/panel-prob.js)   →  http://localhost:3998
  Rozszerzanie:  nowy plik w narzedzia/proby/<nazwa>.json z polami "modul" i "opis" — pojawia się w panelu sam.

  Co panel potrafi:
    - lista scenariuszy pogrupowana modułami, uruchomienie jednym kliknięciem (po kolei, nie równolegle),
    - podgląd przebiegu na żywo (log kroków przez SSE),
    - lista wyników z proby-wyniki/ z linkiem do galerii raport.html i zrzutów,
    - start/stop izolowanego środowiska testowego (MariaDB 3307 + serwer 3999) jako procesów-dzieci panelu,
    - produkcja: wyłącznie z jawnym potwierdzeniem w formularzu (przekazuje --produkcja-tak / --zapis-tak do narzędzia).

  Panel słucha tylko na 127.0.0.1. Nie zna haseł — hasła czyta narzędzie z plików poza repo.
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const KORZEN = path.join(__dirname, '..');
const PROBY = path.join(__dirname, 'proby');
const WYNIKI = path.join(KORZEN, 'proby-wyniki');
const NARZEDZIE = path.join(__dirname, 'proba-ekranu.js');
const PORT = Number(process.env.PANEL_PORT || 3998);
const SRODOWISKO_TESTOWE = process.env.ESTELIO_TEST_DIR || 'C:/Users/aaell/estelio-srodowisko-testowe';
const MDB = SRODOWISKO_TESTOWE + '/mariadb';
fs.mkdirSync(WYNIKI, { recursive: true });

// ─── stan ──────────────────────────────────────────────────────────────────
const przebiegi = [];            // { id, plik, srodowisko, start, koniec, kod, log: [], katalog }
const kolejka = [];              // przebiegi czekające
let biezacy = null;
const sluchacze = new Set();     // odpowiedzi SSE
const srodowisko = { baza: null, serwer: null, log: [] };

function emituj(zd) { const s = 'data: ' + JSON.stringify(zd) + '\n\n'; for (const r of sluchacze) r.write(s); }
function portOtwarty(port) { return new Promise(res => { const s = net.connect({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); s.setTimeout(400, () => { s.destroy(); res(false); }); }); }

// ─── scenariusze i wyniki ──────────────────────────────────────────────────
function scenariusze() {
  return fs.readdirSync(PROBY).filter(f => f.endsWith('.json')).map(f => {
    try { const s = JSON.parse(fs.readFileSync(path.join(PROBY, f), 'utf8'));
      return { plik: f, nazwa: s.nazwa || f.replace(/\.json$/, ''), modul: s.modul || 'Inne', opis: s.opis || '', sekcja: s.sekcja || '', krokow: (s.kroki || []).length, zrzutow: (s.kroki || []).filter(k => k.zrzut).length, zapisPrawdziwy: !(s.przechwyc || []).length, sprawdzen: (s.kroki || []).filter(k => k.sprawdz).length };
    } catch (e) { return { plik: f, nazwa: f, modul: 'Błędny plik', opis: e.message, krokow: 0, zrzutow: 0 }; }
  }).sort((a, b) => a.modul.localeCompare(b.modul) || a.nazwa.localeCompare(b.nazwa));
}
function wyniki() {
  return fs.readdirSync(WYNIKI).filter(d => fs.existsSync(path.join(WYNIKI, d, 'raport.json'))).map(d => {
    try { const r = JSON.parse(fs.readFileSync(path.join(WYNIKI, d, 'raport.json'), 'utf8'));
      const fail = r.sprawdzenia.filter(s => s.wynik === 'FAIL').length + r.kroki.filter(k => k.blad).length;
      return { katalog: d, scenariusz: r.scenariusz, srodowisko: r.srodowisko, czas: r.czas, fail, bledyJS: (r.bledyJS || []).length, zrzutow: (r.zrzuty || []).length, sprawdzen: r.sprawdzenia.length, posty: r.nagrane ? r.nagrane.posty.length : 0, maHtml: fs.existsSync(path.join(WYNIKI, d, 'raport.html')) };
    } catch (e) { return { katalog: d, scenariusz: d, fail: -1, czas: '' }; }
  }).sort((a, b) => (b.czas || '').localeCompare(a.czas || ''));
}

// ─── uruchamianie prób (po kolei) ──────────────────────────────────────────
function zaplanuj(plik, opcje) {
  const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), plik, srodowisko: opcje.srodowisko || 'test', zapisTak: !!opcje.zapisTak, start: null, koniec: null, kod: null, log: [], katalog: null, stan: 'w kolejce' };
  przebiegi.unshift(p); kolejka.push(p); emituj({ typ: 'kolejka', przebieg: podsumuj(p) }); nastepny(); return p;
}
function podsumuj(p) { return { id: p.id, plik: p.plik, srodowisko: p.srodowisko, zapisTak: p.zapisTak, start: p.start, koniec: p.koniec, kod: p.kod, katalog: p.katalog, stan: p.stan }; }
async function nastepny() {
  if (biezacy || !kolejka.length) return;
  const p = biezacy = kolejka.shift(); p.start = new Date().toISOString(); p.stan = 'trwa';
  emituj({ typ: 'start', przebieg: podsumuj(p) });
  // Środowisko testowe startuje ~20 s — próba czeka na serwer 3999, zamiast paść na „connection refused”.
  if (p.srodowisko === 'test') {
    for (let i = 0; i < 90 && !(await portOtwarty(3999)); i++) { if (i % 5 === 0) { const l = 'czekam na serwer 3999… (' + i + ' s)'; p.log.push(l); emituj({ typ: 'log', id: p.id, linia: l }); } await new Promise(r => setTimeout(r, 1000)); }
    if (!(await portOtwarty(3999))) { p.kod = 2; p.koniec = new Date().toISOString(); p.stan = 'problem'; const l = 'BŁĄD: serwer 3999 nie odpowiada — uruchom środowisko testowe.'; p.log.push(l); emituj({ typ: 'log', id: p.id, linia: l }); biezacy = null; emituj({ typ: 'koniec', przebieg: podsumuj(p) }); return nastepny(); }
  }
  const args = [NARZEDZIE, path.join(PROBY, p.plik), '--srodowisko', p.srodowisko];
  if (p.srodowisko === 'prod') { args.push('--produkcja-tak'); if (p.zapisTak) args.push('--zapis-tak'); }
  const proc = spawn(process.execPath, args, { cwd: KORZEN });
  const linia = (zrodlo) => (buf) => { for (const l of String(buf).split(/\r?\n/)) { if (!l.trim()) continue; p.log.push(l); const m = /^Wynik: (.+)$/.exec(l); if (m) p.katalog = path.basename(m[1].trim()); emituj({ typ: 'log', id: p.id, linia: l, zrodlo }); } };
  proc.stdout.on('data', linia('out')); proc.stderr.on('data', linia('err'));
  proc.on('close', kod => { p.kod = kod; p.koniec = new Date().toISOString(); p.stan = kod === 0 ? 'ok' : 'problem'; biezacy = null; emituj({ typ: 'koniec', przebieg: podsumuj(p) }); nastepny(); });
}

// ─── środowisko testowe jako procesy-dzieci ────────────────────────────────
function logSrod(l) { srodowisko.log.push(l); if (srodowisko.log.length > 200) srodowisko.log.shift(); emituj({ typ: 'srodowisko-log', linia: l }); }
async function startSrodowiska() {
  if (!(await portOtwarty(3307))) {
    srodowisko.baza = spawn(MDB + '/mariadb-11.8.9-winx64/bin/mariadbd.exe', ['--defaults-file=' + MDB + '/data/my.ini', '--datadir=' + MDB + '/data', '--port=3307', '--bind-address=127.0.0.1', '--console', '--skip-name-resolve', '--innodb-buffer-pool-size=64M', '--max-connections=40', '--performance-schema=OFF'], { stdio: ['ignore', 'pipe', 'pipe'] });
    srodowisko.baza.stderr.on('data', b => { const l = String(b).trim(); if (/ready for connections|ERROR/.test(l)) logSrod('[MariaDB] ' + l.slice(0, 160)); });
    srodowisko.baza.on('close', () => { srodowisko.baza = null; logSrod('[MariaDB] zatrzymana'); emituj({ typ: 'srodowisko' }); });
    for (let i = 0; i < 40 && !(await portOtwarty(3307)); i++) await new Promise(r => setTimeout(r, 500));
  }
  if (!(await portOtwarty(3999))) {
    srodowisko.serwer = spawn(process.execPath, ['-r', 'dotenv/config', 'server.js', 'dotenv_config_path=.env.test'], { cwd: KORZEN, env: { ...process.env, API_RATE_LIMIT: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
    srodowisko.serwer.stdout.on('data', b => { const l = String(b).trim().split('\n')[0]; if (l) logSrod('[serwer] ' + l.slice(0, 160)); });
    srodowisko.serwer.stderr.on('data', b => logSrod('[serwer!] ' + String(b).trim().slice(0, 160)));
    srodowisko.serwer.on('close', () => { srodowisko.serwer = null; logSrod('[serwer] zatrzymany'); emituj({ typ: 'srodowisko' }); });
    for (let i = 0; i < 60 && !(await portOtwarty(3999)); i++) await new Promise(r => setTimeout(r, 500));
  }
  emituj({ typ: 'srodowisko' });
}
async function stopSrodowiska() {
  if (srodowisko.serwer) { srodowisko.serwer.kill(); }
  try { const pw = fs.readFileSync(MDB + '/root.secret', 'utf8').trim(); spawn(MDB + '/mariadb-11.8.9-winx64/bin/mariadb.exe', ['-h', '127.0.0.1', '-P', '3307', '-u', 'root', '-p' + pw, '-e', 'SHUTDOWN'], { stdio: 'ignore' }); } catch (e) { logSrod('[MariaDB] nie udało się wysłać SHUTDOWN: ' + e.message); }
  setTimeout(() => emituj({ typ: 'srodowisko' }), 2500);
}
process.on('exit', () => { if (srodowisko.serwer) srodowisko.serwer.kill(); });

// ─── HTTP ──────────────────────────────────────────────────────────────────
const TYPY = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const json = (res, o, kod = 200) => { res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
const cialo = req => new Promise(r => { let s = ''; req.on('data', d => s += d); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch (e) { r({}); } }); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': TYPY['.html'] }); return res.end(fs.readFileSync(path.join(__dirname, 'panel-prob.html'))); }
    if (u.pathname === '/api/scenariusze') return json(res, scenariusze());
    if (u.pathname === '/api/wyniki') return json(res, wyniki());
    if (u.pathname === '/api/przebiegi') return json(res, przebiegi.map(podsumuj));
    if (u.pathname === '/api/log') { const p = przebiegi.find(x => x.id === u.searchParams.get('id')); return json(res, p ? p.log : []); }
    if (u.pathname === '/api/srodowisko') return json(res, { baza: await portOtwarty(3307), serwer: await portOtwarty(3999), dzieci: { baza: !!srodowisko.baza, serwer: !!srodowisko.serwer }, log: srodowisko.log.slice(-30) });
    if (u.pathname === '/api/uruchom' && req.method === 'POST') {
      const b = await cialo(req);
      if (!b.plik || !fs.existsSync(path.join(PROBY, path.basename(b.plik)))) return json(res, { blad: 'nieznany scenariusz' }, 400);
      if (b.srodowisko === 'prod' && b.potwierdzenie !== 'PRODUKCJA') return json(res, { blad: 'produkcja wymaga wpisania słowa PRODUKCJA' }, 400);
      return json(res, podsumuj(zaplanuj(path.basename(b.plik), b)));
    }
    if (u.pathname === '/api/srodowisko/start' && req.method === 'POST') { startSrodowiska(); return json(res, { ok: true }); }
    if (u.pathname === '/api/srodowisko/stop' && req.method === 'POST') { stopSrodowiska(); return json(res, { ok: true }); }
    if (u.pathname === '/api/strumien') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('data: {"typ":"halo"}\n\n'); sluchacze.add(res); req.on('close', () => sluchacze.delete(res)); return; }
    if (u.pathname.startsWith('/wyniki/')) {
      const rel = decodeURIComponent(u.pathname.slice('/wyniki/'.length)); const plik = path.normalize(path.join(WYNIKI, rel));
      if (!plik.startsWith(WYNIKI) || !fs.existsSync(plik) || fs.statSync(plik).isDirectory()) { res.writeHead(404); return res.end('brak'); }
      res.writeHead(200, { 'Content-Type': TYPY[path.extname(plik)] || 'application/octet-stream' }); return fs.createReadStream(plik).pipe(res);
    }
    res.writeHead(404); res.end('brak');
  } catch (e) { json(res, { blad: e.message }, 500); }
}).listen(PORT, '127.0.0.1', () => console.log('Panel prób: http://localhost:' + PORT + '  (scenariusze: narzedzia/proby/, wyniki: proby-wyniki/)'));
