#!/usr/bin/env node
// Uruchamia WSZYSTKIE scenariusze z narzedzia/proby/*.json po kolei (środowisko testowe: serwer 3999 + MariaDB 3307),
// drukuje tabelę wyników i zapisuje ją do proby-wyniki/PODSUMOWANIE-<czas>.md. Kod wyjścia 1, gdy coś nie przeszło.
//   node narzedzia/proby-wszystkie.js                → wszystkie
//   node narzedzia/proby-wszystkie.js terminarz-     → tylko pliki zaczynające się od „terminarz-”
// Scenariusze z polem "przygotuj"/"posprzataj" same zasiewają i sprzątają bazę izolowaną (patrz proba-ekranu.js).
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const KORZEN = path.join(__dirname, '..');
const PROBY = path.join(__dirname, 'proby');
const filtr = process.argv[2] || '';
const portOtwarty = (port) => new Promise(res => { const s = net.connect({ port, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });

(async () => {
  if (!(await portOtwarty(3999))) { console.error('Serwer testowy 3999 nie odpowiada — uruchom środowisko izolowane (panel prób albo node -r dotenv/config server.js dotenv_config_path=.env.test).'); process.exit(2); }
  const pliki = fs.readdirSync(PROBY).filter(f => f.endsWith('.json') && f.startsWith(filtr)).sort();
  const wyniki = [];
  const start = Date.now();
  for (const f of pliki) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, 'proba-ekranu.js'), path.join(PROBY, f)], { cwd: KORZEN, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(KORZEN, 'node_modules') }, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + '\n' + (r.stderr || '');
    const m = /sprawdzenia FAIL: (\d+) \| kroki z błędem: (\d+) \| błędy JS: (\d+) \| zrzutów: (\d+)/.exec(out);
    const pass = (out.match(/→ PASS/g) || []).length;
    const wynikDir = /Wynik: (.+)/.exec(out);
    const blad = !m ? ((out.match(/BŁĄD: .+/g) || []).slice(-1)[0] || 'brak podsumowania — próba przerwana').slice(0, 160) : '';
    const w = { plik: f, pass, fail: m ? Number(m[1]) : null, bledyKrokow: m ? Number(m[2]) : null, bledyJS: m ? Number(m[3]) : null, zrzutow: m ? Number(m[4]) : null, sek: Math.round((Date.now() - t0) / 1000), kod: r.status, katalog: wynikDir ? path.basename(wynikDir[1].trim()) : '', blad };
    wyniki.push(w);
    const stan = w.kod === 0 ? 'OK ' : 'ZLE';
    console.log(`${stan} ${f.padEnd(42)} PASS ${String(pass).padStart(2)} | FAIL ${w.fail ?? '?'} | błędy kroków ${w.bledyKrokow ?? '?'} | JS ${w.bledyJS ?? '?'} | zrzutów ${w.zrzutow ?? '?'} | ${w.sek}s${w.blad ? ' | ' + w.blad : ''}`);
  }
  const zle = wyniki.filter(w => w.kod !== 0);
  const md = ['# Wszystkie próby ekranu — ' + new Date().toISOString().slice(0, 16).replace('T', ' '), '',
    `Scenariuszy: ${wyniki.length} · bez zastrzeżeń: ${wyniki.length - zle.length} · z problemami: ${zle.length} · czas: ${Math.round((Date.now() - start) / 60000)} min`, '',
    '| Scenariusz | Wynik | PASS | FAIL | błędy kroków | błędy JS | zrzuty | czas | wynik |', '|---|---|---|---|---|---|---|---|---|',
    ...wyniki.map(w => `| ${w.plik} | ${w.kod === 0 ? '✅' : '❌'} | ${w.pass} | ${w.fail ?? '?'} | ${w.bledyKrokow ?? '?'} | ${w.bledyJS ?? '?'} | ${w.zrzutow ?? '?'} | ${w.sek}s | ${w.katalog ? `[${w.katalog}](${w.katalog}/raport.html)` : w.blad} |`)].join('\n');
  const plik = path.join(KORZEN, 'proby-wyniki', 'PODSUMOWANIE-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16) + '.md');
  fs.writeFileSync(plik, md);
  console.log(`\nRazem ${wyniki.length}, z problemami ${zle.length}. Podsumowanie: ${plik}`);
  process.exit(zle.length ? 1 : 0);
})();
