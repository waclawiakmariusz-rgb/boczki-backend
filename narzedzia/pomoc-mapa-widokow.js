// Generator mapy widoków dla pomocy kontekstowej (P-01 ze specyfikacji z 22.10.2026).
//
// Czyta KOD, nie pamięć: sekcje i modale z public/index.html, widoki/zakładki/kroki z
// public/terminarz.js. Dzięki temu mapa da się odtworzyć po każdej zmianie w aplikacji,
// a nie jest ręcznym spisem, który po tygodniu kłamie.
//
//   node narzedzia/pomoc-mapa-widokow.js            → docs/.../POMOC_MAPA_WIDOKOW.csv
//   node narzedzia/pomoc-mapa-widokow.js --sprawdz  → tylko kontrola katalogu treści (kod wyjścia)

const fs = require('fs');
const path = require('path');

const KORZEN = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(KORZEN, 'public', 'index.html'), 'utf8');
const TRM = fs.readFileSync(path.join(KORZEN, 'public', 'terminarz.js'), 'utf8');
const KATALOG = JSON.parse(fs.readFileSync(path.join(KORZEN, 'public', 'pomoc-tresci.json'), 'utf8'));
const CEL = path.join(KORZEN, 'docs', 'Estelio_Pomoc_Kontekstowa_2026-10-22', 'POMOC_MAPA_WIDOKOW.csv');

/** Pozycje menu bocznego: pokaz('id') + etykieta ze <span>. Daje ludzkie nazwy widoków. */
function etykietyMenu() {
  const mapa = new Map();
  const re = /pokaz\('([a-z0-9_-]+)'[^>]*>[\s\S]{0,400}?<span[^>]*>([^<]{2,40})<\/span>/g;
  let m;
  while ((m = re.exec(INDEX))) if (!mapa.has(m[1])) mapa.set(m[1], m[2].trim());
  return mapa;
}

/** Sekcje aplikacji: <div id="x" class="... section ...">, z pierwszym nagłówkiem w środku. */
function sekcje() {
  const out = [];
  const re = /<div\s+id="([a-zA-Z0-9_-]+)"\s+class="([^"]*\bsection\b[^"]*)"/g;
  let m;
  while ((m = re.exec(INDEX))) {
    const od = m.index;
    const fragment = INDEX.slice(od, od + 2500);
    const h = /<h[12][^>]*>([\s\S]{0,80}?)<\/h[12]>/.exec(fragment);
    out.push({
      id: m[1],
      klasy: m[2],
      tytul: h ? h[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '',
      linia: INDEX.slice(0, od).split('\n').length,
    });
  }
  return out;
}

/** Modale i panele: elementy, których id wygląda na nakładkę. */
function modale() {
  const out = new Set();
  const re = /id="([a-zA-Z0-9_-]*(?:modal|overlay|popup)[a-zA-Z0-9_-]*)"/g;
  let m;
  while ((m = re.exec(INDEX))) out.add(m[1]);
  return [...out].filter(x => !/-(title|client|card|id|nazwa|status|notatka|kampania)$/.test(x));
}

/** Terminarz: widoki, zakładki ustawień, kroki kreatora, panele. */
function terminarz() {
  const out = [];
  const w = /const widoki = \[([^\]]*\])\]/.exec(TRM);
  if (w) {
    const re = /\['([a-z]+)', '([^']+)'\]/g; let m;
    while ((m = re.exec(w[1]))) out.push({ id: 'terminarz.' + m[1], tytul: 'Terminarz — ' + m[2], gdzie: 'public/terminarz.js: szkielet(), przełącznik widoków' });
  }
  const t = /const tabs = \[([^;]*)\];/.exec(TRM);
  if (t) {
    const re = /\['([a-z]+)', '([^']+)'\]/g; let m;
    while ((m = re.exec(t[1]))) out.push({ id: 'terminarz.ustawienia.' + m[1], tytul: 'Ustawienia terminarza — ' + m[2], gdzie: 'public/terminarz.js: renderUstawienia()' });
  }
  [1, 2, 3].forEach(k => out.push({ id: 'terminarz.nowa.krok' + k, tytul: 'Nowa wizyta — krok ' + k, gdzie: 'public/terminarz.js: renderNowa(), krok === ' + k }));
  ['szczegoly', 'powiadomienia'].forEach(p => out.push({ id: 'terminarz.panel.' + p, tytul: 'Panel: ' + p, gdzie: 'public/terminarz.js: panelOtworz()' }));
  return out;
}

function csvPole(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buduj() {
  const menu = etykietyMenu();
  const konteksty = KATALOG.konteksty || {};
  const wiersze = [];
  const dodaj = (r) => wiersze.push(r);

  sekcje().forEach(s => {
    const ctx = 'sekcja.' + s.id;
    const maWlasny = Object.keys(konteksty).some(k => (konteksty[k].kotwica || '') === '#' + s.id);
    dodaj({
      kontekst: ctx,
      sciezka: 'public/index.html:' + s.linia + ' #' + s.id,
      nadrzedny: '',
      tytul: menu.get(s.id) || s.tytul || s.id,
      rola: '',
      dodatek: /^rap_/.test(s.id) ? 'rap_module' : (/^kon_/.test(s.id) ? 'konsultacje' : (/^klub/.test(s.id) ? 'lojalnosc' : '')),
      kotwica: 'nagłówek sekcji',
      zrodlo: '',
      link: '',
      status: maWlasny ? 'wdrozone' : 'do-opisania',
    });
  });

  modale().forEach(id => dodaj({
    kontekst: 'modal.' + id.replace(/-overlay$/, ''),
    sciezka: 'public/index.html #' + id,
    nadrzedny: '',
    tytul: '(modal) ' + id,
    rola: '', dodatek: '',
    kotwica: 'nagłówek modalu, przed ×',
    zrodlo: '', link: '',
    status: 'do-opisania',
  }));

  terminarz().forEach(t => dodaj({
    kontekst: t.id, sciezka: t.gdzie, nadrzedny: 'sekcja.terminarz', tytul: t.tytul,
    rola: '', dodatek: 'terminarz', kotwica: 'nagłówek widoku/panelu', zrodlo: '', link: '',
    status: 'do-opisania',
  }));

  // Konteksty, które mają już treść — nadpisujemy status i uzupełniamy dane z katalogu.
  Object.keys(konteksty).forEach(k => {
    const w = konteksty[k];
    const istniejacy = wiersze.find(r => r.kontekst === k);
    const dane = {
      kontekst: k,
      sciezka: (w.sources || [])[0] || '',
      nadrzedny: w.parentContextId || '',
      tytul: w.title || '',
      rola: (w.availability && w.availability.rola) ? [].concat(w.availability.rola).join('|') : '',
      dodatek: (w.availability && w.availability.dodatek) || '',
      kotwica: 'podpięte',
      zrodlo: (w.sources || []).join(' ; '),
      link: w.article ? (w.article.href + (w.article.anchor ? '#' + w.article.anchor : '')) : '',
      status: w.reviewStatus === 'verified' ? 'wdrozone-sprawdzone' : w.reviewStatus,
    };
    if (istniejacy) Object.assign(istniejacy, dane); else wiersze.push(dane);
  });

  wiersze.sort((a, b) => a.kontekst.localeCompare(b.kontekst, 'pl'));
  return wiersze;
}

/** Kontrola katalogu — te same reguły, które pilnuje próba automatyczna. */
function sprawdzKatalog() {
  const bledy = [];
  const k = KATALOG.konteksty || {};
  Object.keys(k).forEach(id => {
    const w = k[id];
    if (!w.title) bledy.push(id + ': brak tytułu');
    if (w.title && w.title.length > 55) bledy.push(id + ': tytuł dłuższy niż 55 znaków');
    const slowa = ((w.body || '') + ' ' + (w.items || []).map(x => x.text).join(' ') + ' ' + (w.tip || '')).trim().split(/\s+/).filter(Boolean).length;
    if (slowa > 80) bledy.push(id + ': treść ' + slowa + ' słów (limit 80)');
    if ((w.items || []).length > 3) bledy.push(id + ': więcej niż trzy punkty listy');
    if (!w.sources || !w.sources.length) bledy.push(id + ': brak źródeł');
    if (!w.reviewStatus) bledy.push(id + ': brak reviewStatus');
    if (w.article && !/^\/pomoc/.test(w.article.href) && !/^\/przewodnik-klienta/.test(w.article.href)) bledy.push(id + ': link spoza dozwolonych adresów');
  });
  return bledy;
}

if (require.main === module) {
  const bledy = sprawdzKatalog();
  if (process.argv.includes('--sprawdz')) {
    if (bledy.length) { console.error('BLEDY KATALOGU:\n  ' + bledy.join('\n  ')); process.exit(1); }
    console.log('Katalog pomocy OK — ' + Object.keys(KATALOG.konteksty).length + ' kontekstów.');
    process.exit(0);
  }
  const wiersze = buduj();
  const naglowki = ['kontekst', 'sciezka', 'nadrzedny', 'tytul', 'rola', 'dodatek', 'kotwica', 'zrodlo', 'link', 'status'];
  const csv = [naglowki.join(',')].concat(wiersze.map(r => naglowki.map(h => csvPole(r[h])).join(','))).join('\n');
  fs.writeFileSync(CEL, '﻿' + csv, 'utf8');
  const wg = {};
  wiersze.forEach(r => { wg[r.status] = (wg[r.status] || 0) + 1; });
  console.log('Zapisano ' + path.relative(KORZEN, CEL) + ' — ' + wiersze.length + ' kontekstów.');
  Object.keys(wg).sort().forEach(s => console.log('   ' + s.padEnd(22) + wg[s]));
  if (bledy.length) console.log('\nUWAGA, katalog ma ' + bledy.length + ' usterek:\n  ' + bledy.join('\n  '));
}

module.exports = { buduj, sprawdzKatalog };
