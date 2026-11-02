#!/usr/bin/env node
// Wgrywa wpis bloga z pliku HTML do bazy (INSERT albo UPDATE po slugu).
//
//   node narzedzia/blog/wgraj-wpis.js blog/wpisy/<nazwa>.html            → baza IZOLOWANA (.env.test), do podglądu
//   node narzedzia/blog/wgraj-wpis.js blog/wpisy/<nazwa>.html --produkcja-tak   → produkcja (tylko na wyraźne „tak” właściciela)
//   node narzedzia/blog/wgraj-wpis.js --wszystkie [--produkcja-tak]       → wszystkie pliki z blog/wpisy/
//
// Plik wpisu = nagłówek JSON w komentarzu HTML + treść:
//   <!--WPIS
//   { "slug": "...", "title": "...", "excerpt": "...", "category": "Sprzedaż", "emoji": "💰",
//     "okladka": "/img/blog/.../okladka.jpg", "date_published": "2026-11-05", "status": "draft" }
//   -->
//   <p class="lead">…</p> …
//
// Treść wersjonujemy w repozytorium (blog/wpisy/), baza jest tylko miejscem publikacji.
// Skrypt sprawdza, czy każdy obrazek z treści istnieje w public/, i odmawia wgrania, gdy brakuje pliku.
'use strict';
const fs = require('fs');
const path = require('path');
const KORZEN = path.join(__dirname, '..', '..');
const argv = process.argv.slice(2);
const flaga = n => argv.includes('--' + n);
const PROD = flaga('produkcja-tak');
require('dotenv').config({ path: path.join(KORZEN, PROD ? '.env' : '.env.test'), quiet: true });
const mysql = require('mysql2/promise');
const { CATEGORIES, slugify } = require(path.join(KORZEN, 'routes', 'blog.js'));

function wczytaj(plik) {
  const zrodlo = fs.readFileSync(plik, 'utf8');
  const m = /<!--WPIS\s*([\s\S]*?)-->/.exec(zrodlo);
  if (!m) throw new Error(plik + ': brak nagłówka <!--WPIS { … } -->');
  let meta;
  try { meta = JSON.parse(m[1]); } catch (e) { throw new Error(plik + ': nagłówek nie jest poprawnym JSON: ' + e.message); }
  const tresc = zrodlo.replace(m[0], '').trim();
  if (!meta.title) throw new Error(plik + ': brak title');
  if (!meta.date_published) throw new Error(plik + ': brak date_published (RRRR-MM-DD)');
  if (meta.category && !CATEGORIES[meta.category]) throw new Error(plik + ': nieznana kategoria ' + meta.category + ' (dozwolone: ' + Object.keys(CATEGORIES).join(', ') + ')');
  meta.slug = meta.slug || slugify(meta.title);
  if (!/^[a-z0-9-]+$/.test(meta.slug)) throw new Error(plik + ': slug ma mieć tylko małe litery, cyfry i myślniki');
  // Obrazki muszą istnieć w public/ — inaczej wpis pokaże puste ramki
  const brak = [];
  for (const im of [...tresc.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(x => x[1]).concat(meta.okladka ? [meta.okladka] : [])) {
    if (/^https?:\/\//i.test(im)) continue;
    if (!fs.existsSync(path.join(KORZEN, 'public', im.replace(/^\//, '')))) brak.push(im);
  }
  if (brak.length) throw new Error(plik + ': brak plików obrazków w public/: ' + brak.join(', '));
  return { meta, tresc, plik };
}

(async () => {
  const pliki = flaga('wszystkie')
    ? fs.readdirSync(path.join(KORZEN, 'blog', 'wpisy')).filter(f => f.endsWith('.html')).map(f => path.join(KORZEN, 'blog', 'wpisy', f))
    : argv.filter(a => !a.startsWith('--')).map(p => path.resolve(KORZEN, p));
  if (!pliki.length) { console.error('Podaj plik wpisu albo --wszystkie.'); process.exit(2); }
  const wpisy = pliki.map(wczytaj);
  const c = await mysql.createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: process.env.DB_PORT || (PROD ? 3306 : 3307) });
  console.log((PROD ? 'PRODUKCJA' : 'baza izolowana') + ' · ' + process.env.DB_NAME + ' · wpisów: ' + wpisy.length);
  for (const { meta, tresc, plik } of wpisy) {
    const [ist] = await c.query('SELECT id, status FROM blog_posts WHERE slug = ?', [meta.slug]);
    const dane = [meta.title, meta.excerpt || '', meta.category || 'Zarządzanie', meta.emoji || CATEGORIES[meta.category || 'Zarządzanie'].emoji, tresc, meta.okladka || null, meta.date_published, meta.status === 'published' ? 'published' : 'draft'];
    if (ist.length) {
      await c.query('UPDATE blog_posts SET title=?, excerpt=?, category=?, emoji=?, content_html=?, okladka=?, date_published=?, status=? WHERE id=?', [...dane, ist[0].id]);
      console.log(`  ↻ ${meta.slug} (id ${ist[0].id}, ${dane[7]}) ← ${path.relative(KORZEN, plik)}`);
    } else {
      const [r] = await c.query('INSERT INTO blog_posts (slug, title, excerpt, category, emoji, content_html, okladka, date_published, status) VALUES (?,?,?,?,?,?,?,?,?)', [meta.slug, ...dane]);
      console.log(`  + ${meta.slug} (id ${r.insertId}, ${dane[7]}) ← ${path.relative(KORZEN, plik)}`);
    }
    console.log(`    adres: ${PROD ? 'https://estelio.com.pl' : 'http://localhost:3999'}/blog/${meta.slug}${dane[7] === 'draft' ? '  (szkic — widoczny tylko przez podgląd w panelu admina)' : ''}`);
  }
  await c.end();
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
