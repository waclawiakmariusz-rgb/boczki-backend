// public/eksport-excel.js — Eksport widocznych danych do Excela (.xlsx)
//
// Polecenie właściciela (25.11.2026): „możliwość eksportu wszystkich widocznych danych w poszczególnych widokach …
// to, co widzę, co konkretnie sobie filtruję, jest możliwe do eksportu do pliku Excel … do zewnętrznej analizy AI”.
// Uprawnieni: admin, megaadmin, manager, recepcja. KAŻDY eksport musi zostać zapisany w Dzienniku Zdarzeń —
// bez potwierdzonego wpisu plik nie powstaje.
//
// Jak to działa:
//  1. Co 1,5 s sprawdzamy aktywną sekcję panelu (.section.active). Jeśli ma widoczną tabelę z wierszami, w jej
//     nagłówku pojawia się przycisk „⬇ Excel”. Zero zmian w HTML poszczególnych widoków.
//  2. Kliknięcie czyta tabele TAK, JAK SĄ NA EKRANIE (wiersze ukryte filtrem/szukajką pomijane, kolumny z samymi
//     przyciskami „Akcja” pomijane, kwoty „1 234,50 zł” jako liczby, żeby Excel sumował), zbiera opis ustawionych
//     filtrów, prosi serwer o wpis w Dzienniku (akcja `eksport_log`) i dopiero po potwierdzeniu zapisuje plik.
//  3. Plik .xlsx powstaje w przeglądarce bez żadnej biblioteki: ZIP bez kompresji (metoda „stored”) + XML arkuszy
//     z komórkami tekstowymi „inline”. Dane nie wychodzą na serwer — są już na ekranie użytkownika.
//
// Tabele o tym samym zestawie kolumn w jednym widoku (np. Kosmetyki: tabela na każdą kategorię) trafiają do jednego
// arkusza z dodatkową kolumną „Grupa”. Różne tabele = osobne arkusze w jednym pliku.
(function (global) {
  'use strict';

  const ROLE_EKSPORTU = ['admin', 'megaadmin', 'manager', 'recepcja'];
  const ETYKIETA = '⬇ Excel';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  // ───────────────────────── ZIP bez kompresji (metoda „stored”) ─────────────────────────
  const CRC_TAB = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TAB[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(s) { return new TextEncoder().encode(String(s)); }
  function dosCzas(d) {
    return {
      czas: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      data: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }
  function zip(pliki, kiedy) {
    const { czas, data } = dosCzas(kiedy || new Date());
    const czesci = [], centrala = [];
    let offset = 0;
    for (const p of pliki) {
      const nazwa = utf8(p.nazwa);
      const dane = p.dane instanceof Uint8Array ? p.dane : utf8(p.dane);
      const crc = crc32(dane);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, czas, true); lh.setUint16(12, data, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, dane.length, true); lh.setUint32(22, dane.length, true); lh.setUint16(26, nazwa.length, true); lh.setUint16(28, 0, true);
      czesci.push(new Uint8Array(lh.buffer), nazwa, dane);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, czas, true); ch.setUint16(14, data, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, dane.length, true); ch.setUint32(24, dane.length, true); ch.setUint16(28, nazwa.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      centrala.push(new Uint8Array(ch.buffer), nazwa);
      offset += 30 + nazwa.length + dane.length;
    }
    const rozmiarCentrali = centrala.reduce((s, c) => s + c.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
    eocd.setUint16(8, pliki.length, true); eocd.setUint16(10, pliki.length, true);
    eocd.setUint32(12, rozmiarCentrali, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
    const calosc = czesci.concat(centrala, [new Uint8Array(eocd.buffer)]);
    const out = new Uint8Array(calosc.reduce((s, c) => s + c.length, 0));
    let p = 0;
    for (const c of calosc) { out.set(c, p); p += c.length; }
    return out;
  }

  // ───────────────────────── XLSX ─────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function litera(n) { let s = ''; n += 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
  function nazwaArkusza(t, zajete) {
    const baza = String(t || 'Dane').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Dane';
    let k = baza, i = 2;
    while (zajete.has(k.toLowerCase())) { const suf = ' (' + (i++) + ')'; k = baza.slice(0, 31 - suf.length) + suf; }
    zajete.add(k.toLowerCase());
    return k;
  }
  // style: 0 zwykły, 1 nagłówek (pogrubiony), 2 liczba z dwoma miejscami, 3 stopka (kursywa, szary)
  const STYLE_XML = XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
    + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function komorka(ref, v, styl) {
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="' + (Number.isInteger(v) ? (styl || 0) : 2) + '"><v>' + v + '</v></c>';
    const t = String(v == null ? '' : v);
    if (!t) return '';
    return '<c r="' + ref + '" t="inlineStr" s="' + (styl || 0) + '"><is><t xml:space="preserve">' + esc(t) + '</t></is></c>';
  }
  function arkuszXml(a) {
    const naglowki = a.naglowki || [];
    const wiersze = a.wiersze || [];
    const szer = naglowki.map((h, i) => {
      let m = String(h).length;
      for (let r = 0; r < Math.min(wiersze.length, 500); r++) { const v = wiersze[r][i]; const d = String(v == null ? '' : v).length; if (d > m) m = d; }
      return Math.max(8, Math.min(60, m + 2));
    });
    const cols = szer.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('');
    const rows = ['<row r="1">' + naglowki.map((h, i) => komorka(litera(i) + '1', h, 1)).join('') + '</row>'];
    wiersze.forEach((w, r) => { rows.push('<row r="' + (r + 2) + '">' + w.map((v, i) => komorka(litera(i) + (r + 2), v, 0)).join('') + '</row>'); });
    if (a.stopka) { const r = wiersze.length + 3; rows.push('<row r="' + r + '">' + komorka('A' + r, a.stopka, 3) + '</row>'); }
    return XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + (cols ? '<cols>' + cols + '</cols>' : '') + '<sheetData>' + rows.join('') + '</sheetData></worksheet>';
  }
  function xlsx(arkusze, kiedy) {
    const zajete = new Set();
    const lista = (arkusze && arkusze.length ? arkusze : [{ nazwa: 'Dane', naglowki: [], wiersze: [] }])
      .map((a, i) => ({ naglowki: a.naglowki, wiersze: a.wiersze, stopka: a.stopka, nazwa: nazwaArkusza(a.nazwa, zajete), plik: 'xl/worksheets/sheet' + (i + 1) + '.xml' }));
    const pliki = [
      { nazwa: '[Content_Types].xml', dane: XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + lista.map((a) => '<Override PartName="/' + a.plik + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { nazwa: '_rels/.rels', dane: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + NS_REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { nazwa: 'xl/workbook.xml', dane: XML_HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + NS_REL + '"><sheets>' + lista.map((a, i) => '<sheet name="' + esc(a.nazwa) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { nazwa: 'xl/_rels/workbook.xml.rels', dane: XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + lista.map((a, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + NS_REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (lista.length + 1) + '" Type="' + NS_REL + '/styles" Target="styles.xml"/></Relationships>' },
      { nazwa: 'xl/styles.xml', dane: STYLE_XML },
    ].concat(lista.map((a) => ({ nazwa: a.plik, dane: arkuszXml(a) })));
    return zip(pliki, kiedy);
  }

  // ───────────────────────── Wartości komórek ─────────────────────────
  // Kolumny, których zawartość to „numery”, nie liczby (telefon, kod, EAN, PIN) — zostają tekstem.
  const KOL_TEKST = /telefon|\btel\b|\btel\.|numer|\bnr\b|\bpin\b|\bkod\b|\bean\b|\bnip\b|regon|pesel|\bid\b|identyfikator|kod pocztowy/i;
  function wartosc(tekst, naglowek) {
    const t = String(tekst == null ? '' : tekst).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (naglowek && KOL_TEKST.test(String(naglowek))) return t;
    const m = t.replace(/−/g, '-').match(/^([+-])?\s*(\d{1,3}(?: \d{3})+|\d+)(?:[.,](\d{1,4}))?\s*(zł|PLN|pkt|%|szt\.?|ml|g|kg|min|h)?\.?$/i);
    if (!m) return t;
    const cyfry = m[2].replace(/ /g, '');
    const grupowane = m[2].indexOf(' ') >= 0;
    if (grupowane && !m[3] && !m[4]) return t;                    // „601 200 301” — raczej numer telefonu niż liczba
    if (!grupowane && !m[3] && !m[4] && cyfry.length > 9) return t;  // długie ciągi cyfr (EAN, PESEL) zostają tekstem
    if (/^0\d/.test(cyfry) && !m[3]) return t;                     // „007”, „0123” — kod, nie liczba
    const n = Number((m[1] === '-' ? '-' : '') + cyfry + (m[3] ? '.' + m[3] : ''));
    return isFinite(n) ? n : t;
  }

  // ───────────────────────── Czytanie tabel z ekranu ─────────────────────────
  function widoczny(el) {
    if (!el) return false;
    if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null) return false;   // display:none (dla tabel i wierszy)
    return true;
  }
  function czysc(t) { return String(t == null ? '' : t).replace(/[  ]/g, ' ').replace(/[⇅▲▼↑↓⬆⬇]/g, '').replace(/\s+/g, ' ').trim().replace(/[:]$/, ''); }
  function tekstEl(el) { return (typeof el.innerText === 'string' ? el.innerText : el.textContent) || ''; }
  // Komórka z kilkoma informacjami (plakietka + nazwa + podtytuł „Suplement | Ola | dostawa 1.09.2026”) → OSOBNE KOLUMNY w pliku,
  // nie jeden tekst z kreskami (uwaga właściciela 25.11.2026: „powinno być w osobnych kolumnach, a nie |”).
  // Części = linie tekstu komórki, a w linii fragmenty rozdzielone „ | ”, „ · ”, „ • ”.
  function czesciKomorki(td) {
    const pole = td.querySelector ? td.querySelector('input, select, textarea') : null;
    if (pole) {
      const typ = String(pole.type || '').toLowerCase();
      if (pole.tagName === 'SELECT') { const o = pole.options && pole.options[pole.selectedIndex]; return [o ? czysc(o.text) : String(pole.value || '')]; }
      if (typ === 'checkbox' || typ === 'radio') return [pole.checked ? 'TAK' : 'NIE'];
      if (typ !== 'button' && typ !== 'submit') return [String(pole.value || '').trim()];
    }
    // Polecenie właściciela 25.11: „chcę, żeby wszystkie dane były tak rozłożone na komórki” — w przeglądarce idziemy po budowie
    // komórki: plakietki (inline-block, klasa badge/chip/status…), bloki, <br>, <small> to osobne części, a tekst przycisków
    // wewnątrz komórki z danymi jest pomijany. Bez DOM (testy) — części z linii tekstu.
    let czesci = [];
    if (td.childNodes && td.nodeType === 1 && typeof getComputedStyle === 'function') {
      let biez = '';
      const flush = () => { const t = biez.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim(); if (t) czesci.push(t); biez = ''; };
      const idz = (node) => {
        for (const n of Array.from(node.childNodes)) {
          if (n.nodeType === 3) { biez += n.nodeValue; continue; }
          if (n.nodeType !== 1) continue;
          const tag = String(n.tagName).toUpperCase();
          if (tag === 'BR') { flush(); continue; }
          if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SCRIPT' || tag === 'STYLE' || (tag === 'A' && n.hasAttribute && n.hasAttribute('onclick'))) continue;
          const cs = getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const osobno = /^(DIV|P|UL|OL|LI|H[1-6]|TABLE|TR|SECTION|HR|SMALL)$/.test(tag)
            || /inline-block|flex|grid|^block|list-item|table/.test(cs.display)
            || /badge|chip|pill|\btag\b|status|etykiet/i.test(String(n.className || ''));
          if (osobno) { flush(); idz(n); flush(); } else idz(n);
        }
      };
      idz(td); flush();
    } else {
      czesci = tekstEl(td).replace(/[  ]/g, ' ').split(/\s*\n+\s*/).map((x) => x.trim()).filter(Boolean);
    }
    const wynik = [];
    for (const c of czesci) for (const f of c.split(/\s+[|·•]\s+/)) { const t = f.trim(); if (t) wynik.push(t); }
    return wynik.length ? wynik : [''];
  }
  // Nazwy kolumn dla rozbitych komórek w znanych widokach (klucz: id sekcji → nagłówek kolumny). `pozycyjne` — nazwy kolejnych
  // części; `reguly` — część pasująca do wzorca trafia do wskazanej kolumny (z obcięciem przedrostka) albo jest pomijana.
  const ROZBICIA = {
    magazyn: {
      'Produkt': {
        pozycyjne: ['Kategoria', 'Produkt', 'Typ', 'Przyjął(a)'],
        reguly: [
          { re: /^dostawa\s+/i, kolumna: 'Dostawa' },
          { re: /^🚛\s*/, kolumna: 'Dostawy' },
          { re: /^↓/, pomin: true },                       // podpowiedź „sprzedaż pobiera automatycznie…” — nie dane
          { re: /^(Najstarsza na stanie|Dodał:)/, kolumna: 'Dostawa (partia)' },
        ],
      },
    },
  };
  function rozbijKolumne(naglowek, czesciWierszy, konfig) {
    // czesciWierszy: tablica (na wiersz) tablic części. Zwraca { nazwy, wartosci: [na wiersz tablica tekstów] }.
    const k = konfig || { pozycyjne: [], reguly: [] };
    const nazwy = [];
    const indeks = (nazwa) => { let i = nazwy.indexOf(nazwa); if (i < 0) { nazwy.push(nazwa); i = nazwy.length - 1; } return i; };
    const nazwaPozycyjna = (p) => (p === 0 ? naglowek : (k.pozycyjne[p] || (naglowek + ' (' + (p + 1) + ')')));
    if (k.pozycyjne.length) k.pozycyjne.forEach((n) => indeks(n)); else indeks(naglowek);
    const wartosci = czesciWierszy.map((czesci) => {
      const w = {};
      let poz = 0;
      for (const cz of czesci) {
        const r = (k.reguly || []).find((x) => x.re.test(cz));
        if (r && r.pomin) continue;
        if (r) { const n = r.kolumna; w[n] = (w[n] ? w[n] + '; ' : '') + cz.replace(r.re, '').trim(); indeks(n); continue; }
        const n = k.pozycyjne.length ? (k.pozycyjne[poz] || nazwaPozycyjna(poz)) : nazwaPozycyjna(poz);
        w[n] = cz; indeks(n); poz++;
      }
      return w;
    });
    return { nazwy, wartosci: wartosci.map((w) => nazwy.map((n) => (w[n] != null ? w[n] : ''))) };
  }
  function czyTylkoPrzyciski(td) {
    if (!td.querySelectorAll) return false;
    const przyciski = Array.from(td.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    if (!przyciski.length) return false;
    const caly = String(td.textContent || '').replace(/\s+/g, ' ').trim().length;
    const wPrzyciskach = przyciski.reduce((s, b) => s + String(b.textContent || '').replace(/\s+/g, ' ').trim().length, 0);
    return caly - wPrzyciskach <= 0;
  }
  function naglowkiTabeli(table) {
    let ths = table.tHead ? Array.from(table.tHead.querySelectorAll('th, td')) : [];
    if (!ths.length) { const tr = table.querySelector ? table.querySelector('tr') : null; if (tr && tr.querySelector('th')) ths = Array.from(tr.querySelectorAll('th, td')); }
    // nagłówki z textContent, nie innerText: CSS często robi z nich WIELKIE LITERY, a w pliku ma być „Produkt”, nie „PRODUKT”
    return ths.map((th) => czysc(th.textContent != null ? th.textContent : tekstEl(th)));
  }
  function wierszeTabeli(table) {
    const tbodies = table.tBodies && table.tBodies.length ? Array.from(table.tBodies) : [table];
    const wiersze = [];
    for (const tb of tbodies) {
      for (const tr of Array.from(tb.rows || tb.querySelectorAll('tr'))) {
        const cells = Array.from(tr.cells || tr.querySelectorAll('td, th'));
        if (!cells.length) continue;
        if (!cells.some((c) => String(c.tagName).toUpperCase() === 'TD')) continue;     // wiersz nagłówkowy w tbody
        if (!widoczny(tr)) continue;                                                   // ukryty filtrem / szukajką
        if (cells.length === 1 && Number(cells[0].colSpan) > 1) continue;              // „Brak danych”, komunikaty
        wiersze.push(cells);
      }
    }
    return wiersze;
  }
  function zbierzTabele(table, sekcjaId) {
    const nagl = naglowkiTabeli(table);
    const rows = wierszeTabeli(table);
    const n = Math.max(nagl.length, rows.reduce((m, r) => Math.max(m, r.length), 0));
    const nazwy = Array.from({ length: n }, (_, i) => nagl[i] || ('Kolumna ' + (i + 1)));
    const akcja = nazwy.map((h, i) => {
      if (/^(akcj[ae]|opcje|edycja|usu[ńn]|operacje|zarządzaj)$/i.test(h)) return true;
      const kom = rows.map((r) => r[i]).filter(Boolean);
      if (!kom.length) return false;
      return kom.filter(czyTylkoPrzyciski).length >= Math.ceil(kom.length * 0.8);
    });
    const kol = nazwy.map((h, i) => i).filter((i) => !akcja[i]);
    const konfigSekcji = (sekcjaId && ROZBICIA[sekcjaId]) || {};
    const naglowki = [];
    const kolumnyWierszy = rows.map(() => []);
    for (const i of kol) {
      const czesci = rows.map((r) => (r[i] ? czesciKomorki(r[i]) : ['']));
      const maks = czesci.reduce((m, c) => Math.max(m, c.length), 0);
      if (maks <= 1 && !konfigSekcji[nazwy[i]]) {   // zwykła kolumna
        naglowki.push(nazwy[i]);
        czesci.forEach((c, r) => kolumnyWierszy[r].push(wartosc(c[0], nazwy[i])));
        continue;
      }
      const roz = rozbijKolumne(nazwy[i], czesci, konfigSekcji[nazwy[i]]);
      roz.nazwy.forEach((nz) => naglowki.push(nz));
      roz.wartosci.forEach((w, r) => w.forEach((v, j) => kolumnyWierszy[r].push(wartosc(v, roz.nazwy[j]))));
    }
    return { naglowki, wiersze: kolumnyWierszy, pominiete: nazwy.filter((h, i) => akcja[i]) };
  }
  function tytulSekcji(sekcja) {
    const h = (sekcja.querySelector && (sekcja.querySelector('.header h1, .header h2') || sekcja.querySelector('h1, h2'))) || null;
    const t = h ? czysc(tekstEl(h)).replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*\(.*?\)\s*$/, '') : '';
    return t || String(sekcja.id || 'widok');
  }
  function tytulTabeli(table, sekcja) {
    let el = table;
    while (el && el !== sekcja) {
      let p = el.previousElementSibling;
      while (p) {
        const h = (p.matches && p.matches('h1,h2,h3,h4,h5,h6,.rap_cat-title,.tytul,.title')) ? p : (p.querySelector ? p.querySelector('h2,h3,h4,h5,h6,.rap_cat-title,.tytul,.title') : null);
        if (h) { const t = czysc(tekstEl(h)).replace(/^[^\p{L}\p{N}]+/u, ''); if (t) return t; }
        p = p.previousElementSibling;
      }
      el = el.parentElement;
    }
    return '';
  }
  function tabeleSekcji(sekcja) {
    const tabele = Array.from(sekcja.querySelectorAll('table')).filter((t) => widoczny(t)
      && !(t.closest && t.closest('[data-eksport="nie"]'))
      && !(t.parentElement && t.parentElement.closest && t.parentElement.closest('table')));
    const zebrane = [];
    for (const t of tabele) { const z = zbierzTabele(t, sekcja.id); if (z.wiersze.length) zebrane.push({ el: t, naglowki: z.naglowki, wiersze: z.wiersze, pominiete: z.pominiete }); }
    const grupy = new Map();
    for (const z of zebrane) { const k = z.naglowki.join('|'); if (!grupy.has(k)) grupy.set(k, []); grupy.get(k).push(z); }
    const arkusze = [];
    for (const lista of grupy.values()) {
      if (lista.length === 1) {
        arkusze.push({ nazwa: tytulTabeli(lista[0].el, sekcja) || tytulSekcji(sekcja), naglowki: lista[0].naglowki, wiersze: lista[0].wiersze, pominiete: lista[0].pominiete });
        continue;
      }
      // kilka tabel o tych samych kolumnach (np. Kosmetyki: tabela na kategorię) → jeden arkusz z kolumną „Grupa”
      const wiersze = [];
      lista.forEach((z, i) => { const g = tytulTabeli(z.el, sekcja) || ('Tabela ' + (i + 1)); for (const w of z.wiersze) wiersze.push([g].concat(w)); });
      arkusze.push({ nazwa: tytulSekcji(sekcja), naglowki: ['Grupa'].concat(lista[0].naglowki), wiersze, pominiete: lista[0].pominiete });
    }
    return arkusze;
  }
  function etykieta(p) {
    let t = (p.getAttribute && (p.getAttribute('placeholder') || p.getAttribute('aria-label') || p.getAttribute('title'))) || '';
    if (!t && p.id && typeof document !== 'undefined') { const l = document.querySelector('label[for="' + p.id + '"]'); if (l) t = tekstEl(l); }
    if (!t && p.closest) { const l = p.closest('label'); if (l) t = tekstEl(l); }
    if (!t && p.previousElementSibling && /^(LABEL|SPAN|B|STRONG)$/.test(String(p.previousElementSibling.tagName))) t = tekstEl(p.previousElementSibling);
    return czysc(t).replace(/[:…]+$/, '').slice(0, 40);
  }
  function opisFiltrow(sekcja) {
    const czesci = [];
    const pola = Array.from(sekcja.querySelectorAll('input, select')).filter((p) => widoczny(p) && !(p.closest && p.closest('table')) && !(p.classList && p.classList.contains('eksport-excel-pomin')));
    for (const p of pola) {
      const typ = String(p.type || '').toLowerCase();
      if (['button', 'submit', 'hidden', 'password', 'file', 'radio', 'image', 'reset'].indexOf(typ) >= 0) continue;
      let w = '';
      if (String(p.tagName).toUpperCase() === 'SELECT') {
        const o = p.options && p.options[p.selectedIndex];
        w = o ? czysc(o.text) : '';
        if (!w || (!p.value && /^(wszys|dowol|—|-|$)/i.test(w))) continue;
      } else if (typ === 'checkbox') {
        if (!p.checked) continue;
        w = 'tak';
      } else {
        w = String(p.value || '').trim();
        if (!w) continue;
      }
      const nazwa = etykieta(p);
      czesci.push(nazwa ? nazwa + ': ' + w : w);
    }
    const aktywne = Array.from(sekcja.querySelectorAll('.filter-btn.active, .an_tab.active, button.active, .chip.active, .aktywny'))
      .filter((b) => widoczny(b) && !(b.closest && b.closest('table')) && !(b.classList && b.classList.contains('eksport-excel-btn')));
    for (const b of aktywne) { const t = czysc(tekstEl(b)); if (t) czesci.push(t); }
    return Array.from(new Set(czesci)).join('; ').slice(0, 400);
  }

  // ───────────────────────── Widoki bez zwykłej, widocznej tabeli (paczka B) ─────────────────────────
  // Eksportery dedykowane — gdy widok zwija tabele (Kosmetyki) albo rysuje karty zamiast tabeli (Inwentaryzacja, Ranking,
  // Klub). Dane bierzemy z pamięci widoku lub z kart, zawsze z aktualnym filtrem. Funkcja zwraca { tytul?, filtry, arkusze }
  // albo null, gdy w tym stanie widoku nie ma nic dedykowanego — wtedy działa zwykłe czytanie tabel.
  const dwa = (n) => String(n).padStart(2, '0');
  function dataPLz(v) { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? String(v) : dwa(d.getDate()) + '.' + dwa(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function dataCzasPLz(v) { if (!v) return ''; const d = new Date(v); return isNaN(d.getTime()) ? String(v) : dataPLz(v) + ' ' + dwa(d.getHours()) + ':' + dwa(d.getMinutes()); }
  function liczba(v) { if (v == null || String(v).trim() === '') return ''; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : String(v); }
  function pole(id) { return (typeof document !== 'undefined' && document.getElementById) ? document.getElementById(id) : null; }
  const widoki = {
    // Kosmetyki → Stan magazynowy: tabele kategorii są zwinięte, więc czytamy dane widoku po szukajce (tak jak rap_renderTable)
    rap_magazyn: function () {
      // Uwaga: zmienne panelu deklarowane przez `let` NIE są właściwościami window — czytamy je jako zwykłe identyfikatory (typeof chroni, gdy ich nie ma).
      const dane = (typeof rap_inventoryData !== 'undefined' && Array.isArray(rap_inventoryData)) ? rap_inventoryData : null;
      if (!dane) return null;
      const szukaj = pole('rap_search');
      const term = String((szukaj && szukaj.value) || '').toLowerCase().trim();
      const lista = dane.filter((r) => !term || String(r[1] || '').toLowerCase().indexOf(term) >= 0 || String(r[2] || '').toLowerCase().indexOf(term) >= 0)
        .slice().sort((a, b) => String(a[1] || '').localeCompare(String(b[1] || ''), 'pl') || String(a[2] || '').localeCompare(String(b[2] || ''), 'pl'));
      const status = (q, m) => (typeof rap_getStatus === 'function' ? String((rap_getStatus(q, m) || {}).txt || '') : '');
      return { filtry: term ? 'Szukaj produktu: ' + term : '', arkusze: [{
        nazwa: 'Stan magazynowy', naglowki: ['Kategoria', 'Nazwa', 'Ilość', 'Jednostka', 'Minimum', 'Status', 'Data modyfikacji', 'Ważność'],
        wiersze: lista.map((r) => [String(r[1] || ''), String(r[2] || ''), liczba(r[3]), String(r[5] || 'szt.'), liczba(r[4]), status(r[3], r[4]), dataPLz(r[6]), dataPLz(r[11])]),
      }] };
    },
    // Magazyn → Inwentaryzacja: karty .inv-row (plakietka kategorii, nazwa, suma partii)
    inwentaryzacja: function (sekcja) {
      const karty = Array.from(sekcja.querySelectorAll('#lista-inv .inv-row')).filter(widoczny);
      const wiersze = karty.map((k) => {
        const kat = k.querySelector('.cat-badge'); const b = k.querySelector('b');
        const ilosc = Array.from(k.querySelectorAll('span')).map((s) => czysc(tekstEl(s))).find((t) => /^-?\d+([.,]\d+)?$/.test(t));
        return [kat ? czysc(tekstEl(kat)) : '', b ? czysc(tekstEl(b)) : '', ilosc != null ? liczba(ilosc) : ''];
      });
      return { filtry: '', arkusze: [{ nazwa: 'Inwentaryzacja', naglowki: ['Kategoria', 'Produkt', 'Ilość (suma partii)'], wiersze }] };
    },
    // Klienci → Ranking: karty z pozycją, nazwą, telefonem, liczbą transakcji i sumą
    'ranking-klientow': function (sekcja) {
      const lista = sekcja.querySelector('#rnk-lista');
      if (!lista) return null;
      const karty = Array.from(lista.children || []).filter((k) => widoczny(k) && k.querySelector && k.querySelector('b'));
      const wiersze = karty.map((k) => {
        const linie = tekstEl(k).split('\n').map((x) => x.trim()).filter(Boolean);
        const poz = (linie.find((x) => /^#\d+$/.test(x)) || '').replace('#', '');
        const b = k.querySelector('b');
        const info = linie.find((x) => /transakcji/.test(x)) || '';
        const m = info.match(/^(.*?)(?:\s*·\s*)?(\d+) transakcji/);
        const kwota = linie.length ? linie[linie.length - 1] : '';
        return [liczba(poz), b ? czysc(tekstEl(b)) : '', m && m[1] ? m[1].trim() : '', m ? liczba(m[2]) : '', wartosc(kwota, 'Suma')];
      });
      return { filtry: '', arkusze: [{ nazwa: 'Ranking klientek', naglowki: ['Pozycja', 'Klientka', 'Telefon', 'Transakcje', 'Suma'], wiersze }] };
    },
    // Klub: zależnie od otwartej podstrony — Członkowie (z pamięci, po szukajce i sortowaniu) albo Do obsłużenia (wnioski, odbiory, zgłoszenia)
    'klub-admin': function (sekcja) {
      const strona = Array.from(sekcja.querySelectorAll('.klubadm-page')).find((p) => (!p.style || p.style.display !== 'none') && widoczny(p));
      if (!strona) return null;
      if (strona.id === 'klubadm-czlonkowie') {
        const cache = (typeof klubadm_czlonkowieCache !== 'undefined' && Array.isArray(klubadm_czlonkowieCache)) ? klubadm_czlonkowieCache : [];
        const szukaj = pole('klubadm-cz-szukaj');
        const fraza = String((szukaj && szukaj.value) || '').toLowerCase().trim();
        const sortEl = pole('klubadm-cz-sort');
        const sort = sortEl ? sortEl.value : 'punkty';
        const czas = (x) => { const t = x ? new Date(x).getTime() : NaN; return isNaN(t) ? 0 : t; };
        const lista = cache.filter((c) => !fraza || String(c.klient || '').toLowerCase().indexOf(fraza) >= 0 || String(c.telefon || '').indexOf(fraza) >= 0).slice();
        if (sort === 'punkty') lista.sort((a, b) => (Number(b.saldo) || 0) - (Number(a.saldo) || 0));
        else if (sort === 'dolaczyl') lista.sort((a, b) => czas(b.dolaczyl) - czas(a.dolaczyl));
        else if (sort === 'wizyta') lista.sort((a, b) => czas(b.ostatnia_wizyta) - czas(a.ostatnia_wizyta));
        else if (sort === 'nazwisko') lista.sort((a, b) => String(a.klient || '').localeCompare(String(b.klient || ''), 'pl'));
        const opcja = sortEl && sortEl.options ? sortEl.options[sortEl.selectedIndex] : null;
        const filtry = [fraza ? 'Szukaj: ' + fraza : '', sortEl ? 'Sortowanie: ' + czysc(opcja ? opcja.text : sort) : ''].filter(Boolean).join('; ');
        return { tytul: 'Klub — członkowie', filtry, arkusze: [{
          nazwa: 'Członkowie Klubu', naglowki: ['Klientka', 'Nr klientki', 'Telefon', 'Saldo pkt', 'Dołączyła', 'Ostatnia wizyta', 'Powiadomienia'],
          wiersze: lista.map((c) => [String(c.klient || ('Klient ' + c.id_klienta)), String(c.id_klienta || ''), String(c.telefon || ''), liczba(c.saldo), dataPLz(c.dolaczyl), dataPLz(c.ostatnia_wizyta), c.ma_push ? 'PUSH' : '']),
        }] };
      }
      if (strona.id === 'klubadm-odbiory') {
        const W = (typeof klubadm_eksportWnioski !== 'undefined' && Array.isArray(klubadm_eksportWnioski)) ? klubadm_eksportWnioski : [];
        const O = (typeof klubadm_eksportOdbiory !== 'undefined' && Array.isArray(klubadm_eksportOdbiory)) ? klubadm_eksportOdbiory : [];
        const Z = (typeof klubadm_eksportZgloszenia !== 'undefined' && Array.isArray(klubadm_eksportZgloszenia)) ? klubadm_eksportZgloszenia : [];
        // to samo, co na ekranie: nowe + ostatnio obsłużone (5 wniosków, 10 odbiorów, 5 zgłoszeń)
        const wn = W.filter((w) => w.status === 'NOWY').concat(W.filter((w) => w.status !== 'NOWY').slice(0, 5));
        const od = O.filter((o) => o.status === 'OCZEKUJE').concat(O.filter((o) => o.status !== 'OCZEKUJE').slice(0, 10));
        const zg = Z.filter((z) => z.status === 'NOWE').concat(Z.filter((z) => z.status !== 'NOWE').slice(0, 5));
        const arkusze = [];
        if (wn.length) arkusze.push({ nazwa: 'Wnioski', naglowki: ['Typ', 'Klientka', 'Nr klientki', 'Telefon', 'Status', 'Data'], wiersze: wn.map((w) => [w.typ === 'RESET' ? 'RESET PIN' : 'KONTO', String(w.klient_kartoteka || w.imie || ('Klient ' + w.id_klienta)), String(w.id_klienta || ''), String(w.telefon || ''), String(w.status || ''), dataCzasPLz(w.created_at)]) });
        if (od.length) arkusze.push({ nazwa: 'Odbiory nagród', naglowki: ['Klientka', 'Nr klientki', 'Nagroda', 'Koszt pkt', 'Kod', 'Status', 'Wydał(a)', 'Data'], wiersze: od.map((o) => [String(o.klient || ('Klient ' + o.id_klienta)), String(o.id_klienta || ''), String(o.nagroda_nazwa || ''), liczba(o.koszt_pkt), String(o.kod || ''), String(o.status || ''), String(o.wydal || ''), dataCzasPLz(o.created_at)]) });
        if (zg.length) arkusze.push({ nazwa: 'Zgłoszenia do promocji', naglowki: ['Klientka', 'Nr klientki', 'Telefon', 'Promocja', 'Status', 'Obsłużył(a)', 'Data'], wiersze: zg.map((z) => [String(z.klient || ('Klient ' + z.id_klienta)), String(z.id_klienta || ''), String(z.telefon || ''), String(z.promocja_tytul || ''), String(z.status || ''), String(z.obsluzyl || ''), dataCzasPLz(z.created_at)]) });
        return { tytul: 'Klub — do obsłużenia', filtry: '', arkusze };
      }
      return null;
    },
  };
  function dedykowany(sekcja) {
    const id = sekcja && sekcja.id ? String(sekcja.id) : '';
    if (!id || !Object.prototype.hasOwnProperty.call(widoki, id)) return null;
    try { return widoki[id](sekcja); } catch (e) { return null; }
  }

  // ───────────────────────── Przygotowanie eksportu ─────────────────────────
  function rola() { try { return String(global.localStorage.getItem('boczki_pracownik_rola') || '').toLowerCase().trim(); } catch (e) { return ''; } }
  function salon() { try { return String(global.localStorage.getItem('boczki_tenant_id') || ''); } catch (e) { return ''; } }
  function kto() {
    if (typeof global.currentUser === 'string' && global.currentUser) return global.currentUser;
    try { return String(global.localStorage.getItem('boczki_pracownik_imie') || ''); } catch (e) { return ''; }
  }
  const PL = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };
  function slug(t) { return String(t || '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => PL[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'dane'; }
  function dataISO(d) { return d.getFullYear() + '-' + dwa(d.getMonth() + 1) + '-' + dwa(d.getDate()); }
  function dataPL(d) { return dwa(d.getDate()) + '.' + dwa(d.getMonth() + 1) + '.' + d.getFullYear() + ' o ' + dwa(d.getHours()) + ':' + dwa(d.getMinutes()); }
  function przygotuj(sekcja, teraz) {
    teraz = teraz || new Date();
    const ded = dedykowany(sekcja);
    const tytul = (ded && ded.tytul) || tytulSekcji(sekcja);
    const filtry = (ded && ded.filtry) || opisFiltrow(sekcja);
    const arkusze = ded ? ded.arkusze.map((a) => ({ nazwa: a.nazwa, naglowki: a.naglowki, wiersze: a.wiersze, pominiete: a.pominiete || [] })) : tabeleSekcji(sekcja);
    const wierszy = arkusze.reduce((s, a) => s + a.wiersze.length, 0);
    const plik = 'estelio-' + slug(tytul) + '-' + dataISO(teraz) + '.xlsx';
    const stopka = 'Eksport z Estelio · salon ' + salon() + ' · widok „' + tytul + '” · ' + dataPL(teraz) + ' · filtry: ' + (filtry || 'brak') + ' · wierszy: ' + wierszy + ' · wykonał(a): ' + kto();
    return { tytul, filtry, wierszy, plik, sekcjaId: String(sekcja.id || ''), arkusze: arkusze.map((a) => ({ nazwa: a.nazwa, naglowki: a.naglowki, wiersze: a.wiersze, pominiete: a.pominiete, stopka })) };
  }
  function pobierz(nazwa, bajty) {
    const blob = new Blob([bajty], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nazwa; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  async function eksportuj(sekcja) {
    sekcja = sekcja || document.querySelector('.section.active');
    if (!sekcja) return null;
    const btn = sekcja.querySelector('.eksport-excel-btn');
    const p = przygotuj(sekcja);
    if (!p.wierszy) { alert('W tym widoku nie ma teraz żadnych wierszy do eksportu.'); return null; }
    if (ROLE_EKSPORTU.indexOf(rola()) < 0) { alert('Eksport danych jest dostępny dla recepcji, managera i administratora.'); return null; }
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Zapisuję w Dzienniku…'; }
    const przywroc = () => { if (btn) { btn.disabled = false; btn.textContent = ETYKIETA; } };
    try {
      // Polecenie właściciela 25.11.2026: KAŻDY eksport zapisany w Dzienniku Zdarzeń — bez potwierdzonego wpisu plik nie powstaje.
      const api = (typeof API_URL === 'string') ? API_URL : (global.location.origin + '/api');
      const r = await fetch(api, { method: 'POST', body: JSON.stringify({
        action: 'eksport_log', user_log: kto(), widok: p.tytul, sekcja: p.sekcjaId, wierszy: p.wierszy, arkusze: p.arkusze.length,
        kolumny: p.arkusze.map((a) => a.naglowki.join(', ')).join(' | ').slice(0, 300), filtry: p.filtry, plik: p.plik,
      }) });
      const d = await r.json().catch(() => null);
      if (!d || d.status !== 'success') throw new Error((d && d.message) || 'serwer nie potwierdził wpisu w Dzienniku');
      pobierz(p.plik, xlsx(p.arkusze));
      if (btn) { btn.textContent = '✅ Zapisano (' + p.wierszy + ' wierszy)'; setTimeout(przywroc, 2500); }
      return p;
    } catch (e) {
      przywroc();
      alert('Eksport nie został wykonany: ' + ((e && e.message) || 'błąd połączenia') + '. Plik nie powstał, bo każdy eksport musi zostać zapisany w Dzienniku Zdarzeń.');
      return null;
    }
  }

  // ───────────────────────── Przycisk w aktywnej sekcji ─────────────────────────
  function maTabele(sekcja) { return Array.from(sekcja.querySelectorAll('table')).some((t) => widoczny(t) && wierszeTabeli(t).length > 0); }
  function maDane(sekcja) { const ded = dedykowany(sekcja); return ded ? ded.arkusze.some((a) => a.wiersze.length > 0) : maTabele(sekcja); }
  function zapewnijPrzycisk() {
    const aktywna = document.querySelector('.section.active');
    const wolno = ROLE_EKSPORTU.indexOf(rola()) >= 0;
    document.querySelectorAll('.eksport-excel-btn').forEach((b) => { if (!aktywna || !wolno || !aktywna.contains(b)) b.remove(); });
    if (!aktywna || !wolno) return;
    let btn = aktywna.querySelector('.eksport-excel-btn');
    if (!maDane(aktywna)) { if (btn) btn.remove(); return; }
    if (btn) return;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'eksport-excel-btn'; btn.textContent = ETYKIETA;
    btn.title = 'Zapisz to, co widać w tym widoku (po filtrach), jako plik Excel. Eksport zostanie zapisany w Dzienniku Zdarzeń.';
    btn.addEventListener('click', () => eksportuj(aktywna));
    // Do nagłówka sekcji — obok istniejących przycisków (np. „Eksport PDF”), jeśli nagłówek ma ich grupę
    const naglowek = aktywna.querySelector('.header');
    const grupa = naglowek ? Array.from(naglowek.children).find((el) => el.tagName === 'DIV' && el.querySelector('button')) : null;
    if (grupa) grupa.appendChild(btn); else if (naglowek) naglowek.appendChild(btn); else aktywna.insertBefore(btn, aktywna.firstChild);
  }
  function styl() {
    if (document.getElementById('eksport-excel-css')) return;
    const s = document.createElement('style');
    s.id = 'eksport-excel-css';
    s.textContent = '.eksport-excel-btn{display:inline-flex;align-items:center;gap:6px;margin-left:auto;padding:7px 14px;border:1.5px solid #d9dee7;border-radius:10px;background:#fff;color:#374151;font-size:13px;font-weight:600;line-height:1;font-family:inherit;cursor:pointer;white-space:nowrap;transition:border-color .15s,color .15s}'
      + '.eksport-excel-btn:hover{border-color:#c54f7f;color:#c54f7f}.eksport-excel-btn:disabled{opacity:.65;cursor:wait}'
      + '.header .eksport-excel-btn{margin-left:12px}.section>.eksport-excel-btn{margin:0 0 12px auto;display:flex}'
      + 'body.dark-mode .eksport-excel-btn,body.dark .eksport-excel-btn,[data-theme="dark"] .eksport-excel-btn{background:#1f2430;color:#e5e7eb;border-color:#394150}';
    document.head.appendChild(s);
  }

  const EstelioExcel = { zip, xlsx, wartosc, zbierzTabele, tabeleSekcji, opisFiltrow, tytulSekcji, przygotuj, eksportuj, zapewnijPrzycisk, widoki, dedykowany, maDane, ROLE_EKSPORTU, slug, _crc32: crc32 };
  global.EstelioExcel = EstelioExcel;
  if (typeof module !== 'undefined' && module.exports) module.exports = EstelioExcel;
  if (typeof document !== 'undefined' && document.head) {
    styl();
    setInterval(zapewnijPrzycisk, 1500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', zapewnijPrzycisk); else zapewnijPrzycisk();
  }
})(typeof window !== 'undefined' ? window : globalThis);
