// routes/blog.js
// Publiczne API bloga + panel admina do zarządzania wpisami + JEDEN renderer strony wpisu.
//
// 2.11.2026 — „ożywienie bloga” przed serią wpisów ze zrzutami:
//  • naprawa kolejności tras: /blog/posts musi stać PRZED /blog/:slug, inaczej lista wpisów
//    dostawała „Artykuł nie istnieje.” i strona bloga pokazywała trzy zaszyte na sztywno karty;
//  • jeden renderer (renderArticle) używany przez server.js (/blog/:slug), podgląd szkicu w panelu
//    admina i ten router — wcześniej były dwa, a publiczny nie miał stylów dla wstępu, ramek i obrazków;
//  • czytanie: kotwice sekcji z linkiem „#” (spis treści celowo NIE jest wyświetlany — decyzja usera 2.11: lista „W tym wpisie” brzmiała jak szablon),
//    zrzuty w <figure> z podpisem i powiększeniem po kliknięciu, ramki tip/uwaga/manager, tabele, kroki;
//  • udostępnianie: „Kopiuj link”, e-mail, WhatsApp; og:image i twitter card z okładki albo
//    pierwszego obrazka; kanał RSS (/blog/rss.xml) i mapa strony (/sitemap.xml);
//  • kategorie Terminarz i Dodatki; kolumna okladka (NULL-owalna, dopisana bez ruszania reszty).
//
// 9.11.2026 — przewodnik wideo (docs/przewodnik-wideo/PLAN_2026-11-09.md):
//  • kategoria „Przewodnik” (filmy z kanału YouTube Estelio) — jeden wpis = jeden film, odtwarzacz w treści;
//  • czyste funkcje youtubeId / osadzenieYoutube / pierwszeWideo / miniaturaYoutube (bez bazy, bez sieci);
//  • renderArticle: ramka 16:9 dla odtwarzacza, og:image i JSON-LD VideoObject z miniatury YouTube,
//    powrót „← Przewodnik” zamiast „← Blog” dla tej kategorii; POST/PUT: pusta okładka → miniatura filmu.
//    ZERO zmian w bazie — film siedzi w content_html, miniatura w istniejącej kolumnie okladka.

const express = require('express');
const path = require('path');

const BAZA_URL = 'https://estelio.com.pl';

// Wbudowany slugify (polska diacritica)
function slugify(text) {
  return String(text || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l').replace(/ą/g, 'a').replace(/ę/g, 'e')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z')
    .replace(/ż/g, 'z').replace(/ć/g, 'c').replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Kategorie i ich CSS klasy (to samo w public/blog.html i public/admin-blog.html — pilnuje test tests/blog.test.js)
const CATEGORIES = {
  'Zarządzanie':  { css: 'cat-zarzadzanie', thumb: 'zarzadzanie', emoji: '⏱️' },
  'Pracownicy':   { css: 'cat-pracownicy',  thumb: 'pracownicy',  emoji: '💅' },
  'Magazyn':      { css: 'cat-magazyn',     thumb: 'magazyn',     emoji: '📦' },
  'Klienci':      { css: 'cat-klienci',     thumb: 'klienci',     emoji: '💆' },
  'Sprzedaż':     { css: 'cat-sprzedaz',    thumb: 'sprzedaz',    emoji: '💰' },
  'Terminarz':    { css: 'cat-terminarz',   thumb: 'terminarz',   emoji: '🗓️' },
  'Dodatki':      { css: 'cat-dodatki',     thumb: 'dodatki',     emoji: '✨' },
  'Przewodnik':   { css: 'cat-przewodnik',  thumb: 'przewodnik',  emoji: '▶️' },
};

// Starter posts — 3 istniejące artykuły
const SEED_POSTS = [
  {
    slug: 'jak-estelio-oszczedza-czas',
    title: 'Jak Estelio oszczędza 4 godziny tygodniowo w salonie kosmetycznym',
    excerpt: 'Większość właścicielek salonów traci kilka godzin tygodniowo na rozliczenia, które można zautomatyzować.',
    category: 'Zarządzanie',
    emoji: '⏱️',
    date_published: '2026-04-16',
    status: 'published',
    url_override: null,
    content_html: '',
  },
  {
    slug: 'rozliczenia-pracownic-salonu',
    title: 'Rozliczenia pracownic w salonie beauty — koniec z Excelem',
    excerpt: 'Excel, karteczki, zaufanie na słowo — tak wygląda rozliczanie pracownic w większości salonów. Jest lepszy sposób.',
    category: 'Pracownicy',
    emoji: '💅',
    date_published: '2026-04-14',
    status: 'published',
    url_override: null,
    content_html: '',
  },
  {
    slug: 'magazyn-kosmetykow-w-salonie',
    title: 'Jak zarządzać magazynem kosmetyków bez chaosu i przepłacania',
    excerpt: 'Brakujący produkt w połowie zabiegu, przeterminowane zapasy — poznaj sposób na kontrolę magazynu w salonie.',
    category: 'Magazyn',
    emoji: '📦',
    date_published: '2026-04-10',
    status: 'published',
    url_override: null,
    content_html: '',
  },
];

// Pomocnik: formatuj datę po polsku
const MIESIACE = ['stycznia','lutego','marca','kwietnia','maja','czerwca',
                  'lipca','sierpnia','września','października','listopada','grudnia'];
function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  if (isNaN(d)) return '';
  return `${d.getUTCDate()} ${MIESIACE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function dataISO(str) {
  if (!str) return '';
  const d = new Date(str);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

// Pomocnik: szacowany czas czytania (200 słów na minutę + pół minuty na każdy zrzut)
function readTime(html) {
  const tekst = (html || '').replace(/<[^>]+>/g, ' ');
  const words = tekst.split(/\s+/).filter(Boolean).length;
  const obrazy = ((html || '').match(/<img\b/gi) || []).length;
  return Math.max(1, Math.round(words / 200 + obrazy * 0.5));
}

// Pierwszy obrazek z treści (do og:image i miniatury), gdy wpis nie ma okładki
function pierwszyObraz(html) {
  const m = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html || '');
  return m ? m[1] : null;
}
function absUrl(u) {
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return BAZA_URL + (u.startsWith('/') ? '' : '/') + u;
}

// ─── Przewodnik wideo (YouTube) ───────────────────────────────────────────────
// Identyfikator filmu z adresu w dowolnej postaci: watch?v=, youtu.be/, shorts/, embed/, live/,
// także z dodatkowymi parametrami (?t=, &list=) albo sam 11-znakowy identyfikator. Nieznany adres → null.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function youtubeId(adres) {
  const a = String(adres || '').trim();
  if (!a) return null;
  if (YT_ID.test(a)) return a;
  let u;
  try { u = new URL(/^https?:\/\//i.test(a) ? a : 'https://' + a); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') { const id = u.pathname.split('/')[1]; return YT_ID.test(id || '') ? id : null; }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v');
  if (v && YT_ID.test(v)) return v;
  const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/.exec(u.pathname);
  return m ? m[1] : null;
}
function miniaturaYoutube(id) { return YT_ID.test(id || '') ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null; }
// Odtwarzacz do wklejenia w treść wpisu: domena bez ciasteczek (nic nie leci do Google przed kliknięciem Play),
// ładowanie leniwe, ramka 16:9 (styl .wideo w renderArticle). Zwraca '' dla nierozpoznanego adresu.
function osadzenieYoutube(adres, tytul) {
  const id = youtubeId(adres);
  if (!id) return '';
  return `<div class="wideo"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="${escHtml(tytul || 'Film z przewodnika Estelio')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}
// Pierwszy film w treści (iframe z youtube / youtube-nocookie) → identyfikator albo null
function pierwszeWideo(html) {
  const m = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html || '');
  return m ? youtubeId(m[1]) : null;
}
function okladkaZWideo(html) { return miniaturaYoutube(pierwszeWideo(html)); }

// Treść wpisu przed wyświetleniem: nadaje nagłówkom h2 identyfikatory (jeśli ich nie mają),
// dopisuje kotwicę „#” do kopiowania linku do sekcji i buduje spis treści, gdy jest ≥ 3 sekcji.
// Zwraca { html, spis, naglowki } — czysta funkcja, bez bazy, łatwa do testów.
function przygotujTresc(html) {
  const zrodlo = String(html || '');
  const zajete = new Set();
  const naglowki = [];
  const wynik = zrodlo.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (calosc, atrybuty, wnetrze) => {
    const tekst = wnetrze.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    let id = (/\bid\s*=\s*["']([^"']+)["']/i.exec(atrybuty) || [])[1];
    let atr = atrybuty;
    if (!id) {
      const baza = slugify(tekst) || 'sekcja';
      id = baza; let n = 2;
      while (zajete.has(id)) id = baza + '-' + (n++);
      atr = atrybuty + ` id="${id}"`;
    }
    zajete.add(id);
    naglowki.push({ id, tekst });
    return `<h2${atr}>${wnetrze} <a class="kotwica" href="#${id}" aria-label="Link do sekcji: ${escHtml(tekst)}" title="Link do tej sekcji">#</a></h2>`;
  });
  const spis = naglowki.length >= 3
    ? `<nav class="spis" aria-label="Spis treści"><div class="spis-tytul">W tym wpisie</div><ol>${naglowki.map(n => `<li><a href="#${n.id}">${escHtml(n.tekst)}</a></li>`).join('')}</ol></nav>`
    : '';
  return { html: wynik, spis, naglowki };
}

// Ikony do paska udostępniania — proste linie, bez emoji
const IKONY = {
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  czat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.2A8 8 0 1 1 21 12z"/></svg>',
  drukuj: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
};

// Renderuje pełną stronę artykułu z danych z bazy.
// opcje.powiazane — do 3 innych wpisów { slug, title, category }; opcje.podglad — szkic w panelu admina (noindex + pasek)
function renderArticle(post, opcje = {}) {
  const powiazane = Array.isArray(opcje.powiazane) ? opcje.powiazane : [];
  const podglad = !!opcje.podglad;
  const canonical = `${BAZA_URL}/blog/${post.slug}`;
  const dateStr = formatDate(post.date_published);
  const catLabel = post.category || 'Blog';
  const tytul = escHtml(post.title);
  const zajawka = escHtml(post.excerpt || '');
  const wideoId = pierwszeWideo(post.content_html);
  const okladka = absUrl(post.okladka || pierwszyObraz(post.content_html) || miniaturaYoutube(wideoId) || '/img/estelio-logo.png');
  const tresc = przygotujTresc(post.content_html || '<p>Treść artykułu niedostępna.</p>');
  // Filmy z przewodnika wracają do /przewodnik, reszta do bloga
  const przewodnik = post.category === 'Przewodnik';
  const wstecz = przewodnik ? { href: '/przewodnik', tekst: 'Przewodnik', dok: 'przewodnika' } : { href: '/blog.html', tekst: 'Blog', dok: 'bloga' };
  const zmieniono = dataISO(post.updated_at) || dataISO(post.date_published);
  const tematMaila = encodeURIComponent(post.title || 'Wpis z bloga Estelio');
  const trescMaila = encodeURIComponent((post.excerpt ? post.excerpt + '\n\n' : '') + canonical);
  const whatsapp = 'https://wa.me/?text=' + encodeURIComponent((post.title || '') + ' ' + canonical);

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tytul} — Estelio Blog</title>
  <meta name="description" content="${zajawka}">
  <meta name="robots" content="${podglad ? 'noindex, nofollow' : 'index, follow'}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/rss+xml" title="Blog Estelio" href="${BAZA_URL}/blog/rss.xml">
  <meta property="og:title" content="${tytul}">
  <meta property="og:description" content="${zajawka}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${escHtml(okladka)}">
  <meta property="og:site_name" content="Estelio">
  <meta property="og:locale" content="pl_PL">
  <meta property="article:published_time" content="${dataISO(post.date_published)}">
  <meta property="article:modified_time" content="${zmieniono}">
  <meta property="article:section" content="${escHtml(catLabel)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${tytul}">
  <meta name="twitter:description" content="${zajawka}">
  <meta name="twitter:image" content="${escHtml(okladka)}">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Article',
    headline: post.title || '', datePublished: dataISO(post.date_published), dateModified: zmieniono,
    description: post.excerpt || '', image: okladka, articleSection: catLabel, mainEntityOfPage: canonical,
    author: { '@type': 'Organization', name: 'Estelio' },
    publisher: { '@type': 'Organization', name: 'Estelio', url: BAZA_URL, logo: { '@type': 'ImageObject', url: BAZA_URL + '/img/estelio-logo.png' } },
  }).replace(/</g, '\\u003c')}</script>${wideoId ? `
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'VideoObject',
    name: post.title || '', description: post.excerpt || '', thumbnailUrl: miniaturaYoutube(wideoId),
    uploadDate: dataISO(post.date_published), embedUrl: 'https://www.youtube-nocookie.com/embed/' + wideoId,
    contentUrl: 'https://www.youtube.com/watch?v=' + wideoId, publisher: { '@type': 'Organization', name: 'Estelio', url: BAZA_URL },
  }).replace(/</g, '\\u003c')}</script>` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --m-linen: #e8e0d5; --m-cream: #f2ede6; --m-sand: #d4c4a8;
      --m-taupe: #b8a898; --m-mauve: #c4a0a0; --m-mauve-d: #a88080;
      --m-sage: #9aab9a; --m-camel: #c4a870; --m-ink: #2c2420; --m-muted: #6a5e56;
    }
    html { scroll-behavior: smooth; scroll-padding-top: 84px; }
    body { font-family: 'DM Sans', sans-serif; background: var(--m-linen); color: var(--m-ink); }
    nav.gorne { display: flex; align-items: center; justify-content: space-between; padding: 20px 60px; background: var(--m-cream); border-bottom: 1px solid var(--m-sand); position: sticky; top: 0; z-index: 100; }
    .logo { font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; font-weight: 600; color: var(--m-ink); text-decoration: none; letter-spacing: .06em; }
    .nav-links { display: flex; gap: 24px; align-items: center; }
    .nav-links a { text-decoration: none; font-size: .85rem; color: var(--m-muted); transition: color .2s; }
    .nav-links a:hover { color: var(--m-ink); }
    .nav-cta { background: var(--m-mauve) !important; color: #fff !important; padding: 8px 18px; border-radius: 6px; font-weight: 500 !important; }
    .nav-cta:hover { background: var(--m-mauve-d) !important; }
    .hamburger { display: none; background: none; border: none; cursor: pointer; padding: 6px; color: var(--m-ink); }
    .hamburger span { display: block; width: 24px; height: 2px; background: var(--m-ink); margin: 5px 0; transition: transform .3s, opacity .3s; }
    .hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .hamburger.open span:nth-child(2) { opacity: 0; }
    .hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
    .nav-mobile-menu { display: none; flex-direction: column; background: var(--m-cream); border-top: 1px solid var(--m-sand); padding: 14px 20px 20px; position: absolute; top: 100%; left: 0; right: 0; box-shadow: 0 8px 24px rgba(0,0,0,.08); z-index: 99; }
    .nav-mobile-menu.open { display: flex; }
    .nav-mobile-menu a { text-decoration: none; font-size: .93rem; color: var(--m-muted); padding: 11px 0; border-bottom: 1px solid var(--m-sand); transition: color .2s; }
    .nav-mobile-menu a:last-child { border-bottom: none; }
    .nav-mobile-menu .nav-cta { margin-top: 6px; text-align: center; background: var(--m-mauve); color: #fff !important; border-radius: 6px; padding: 11px; font-weight: 500; border-bottom: none; }
    @media (max-width: 600px) { nav.gorne { padding: 14px 20px; } .nav-links { display: none; } .hamburger { display: block; } }
    .podglad-pasek { background: #8a3040; color: #fff; text-align: center; padding: 8px 16px; font-size: .82rem; }
    .article-hero { background: var(--m-cream); border-bottom: 1px solid var(--m-sand); padding: 48px 60px 44px; text-align: center; position: relative; overflow: hidden; }
    .article-hero::before { content: ''; position: absolute; width: 420px; height: 420px; background: radial-gradient(circle, rgba(196,160,160,.2) 0%, transparent 65%); top: -120px; right: -60px; border-radius: 50%; }
    .article-hero::after { content: ''; position: absolute; width: 300px; height: 300px; background: radial-gradient(circle, rgba(154,171,154,.18) 0%, transparent 65%); bottom: -80px; left: -30px; border-radius: 50%; }
    .okruszki { font-size: .76rem; color: var(--m-taupe); margin-bottom: 14px; position: relative; z-index: 1; }
    .okruszki a { color: var(--m-taupe); text-decoration: none; }
    .okruszki a:hover { color: var(--m-ink); }
    .article-cat { display: inline-block; font-size: .68rem; font-weight: 600; letter-spacing: .15em; text-transform: uppercase; background: rgba(196,168,112,.15); color: var(--m-camel); padding: 4px 14px; border-radius: 20px; margin-bottom: 16px; border: 1px solid rgba(196,168,112,.3); position: relative; z-index: 1; }
    .article-hero h1 { font-family: 'Cormorant Garamond', serif; font-size: 2.6rem; font-weight: 600; color: var(--m-ink); line-height: 1.2; max-width: 760px; margin: 0 auto 14px; position: relative; z-index: 1; }
    .article-meta { font-size: .8rem; color: var(--m-taupe); position: relative; z-index: 1; }
    .article-body { max-width: 760px; margin: 0 auto; padding: 40px 40px 80px; }
    .pasek-gorny { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
    .back-link { display: inline-block; font-size: .82rem; color: var(--m-muted); text-decoration: none; }
    .back-link:hover { color: var(--m-mauve); }
    .udostepnij { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .udostepnij button, .udostepnij a { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--m-sand); background: var(--m-cream); color: var(--m-ink); font: inherit; font-size: .78rem; text-decoration: none; cursor: pointer; transition: border-color .2s, background .2s; }
    .udostepnij button:hover, .udostepnij a:hover { border-color: var(--m-mauve); background: #fff; }
    .udostepnij svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .spis { background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 14px; padding: 18px 22px; margin: 0 0 32px; }
    .spis-tytul { font-size: .7rem; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--m-camel); margin-bottom: 10px; }
    .spis ol { margin: 0 0 0 20px; }
    .spis li { font-size: .9rem; line-height: 1.7; margin: 0; color: var(--m-muted); }
    .spis a { color: var(--m-ink); text-decoration: none; }
    .spis a:hover { color: var(--m-mauve-d); text-decoration: underline; }
    .article-content .lead, .lead { font-size: 1.08rem; color: var(--m-muted); line-height: 1.8; margin-bottom: 36px; padding-bottom: 32px; border-bottom: 1px solid var(--m-sand); }
    .article-content h2 { font-family: 'Cormorant Garamond', serif; font-size: 1.7rem; font-weight: 600; color: var(--m-ink); margin: 44px 0 14px; line-height: 1.25; }
    .article-content h2 .kotwica { opacity: 0; margin-left: 8px; color: var(--m-taupe); text-decoration: none; font-family: 'DM Sans', sans-serif; font-size: .9rem; font-weight: 500; vertical-align: middle; transition: opacity .2s; }
    .article-content h2:hover .kotwica, .article-content h2 .kotwica:focus { opacity: 1; }
    .article-content h3 { font-size: 1.02rem; font-weight: 600; color: var(--m-ink); margin: 28px 0 10px; }
    .article-content p { font-size: .95rem; color: #4a3e38; line-height: 1.85; margin-bottom: 16px; }
    .article-content ul, .article-content ol { margin: 10px 0 18px 22px; }
    .article-content li { font-size: .95rem; color: #4a3e38; line-height: 1.8; margin-bottom: 6px; }
    .article-content strong { color: var(--m-ink); }
    .article-content a { color: var(--m-mauve-d); }
    .article-content hr { border: 0; border-top: 1px solid var(--m-sand); margin: 36px 0; }
    .article-content kbd { font-family: inherit; font-size: .82em; background: var(--m-cream); border: 1px solid var(--m-sand); border-bottom-width: 2px; border-radius: 6px; padding: 1px 7px; color: var(--m-ink); white-space: nowrap; }
    .article-content .wideo { position: relative; aspect-ratio: 16 / 9; margin: 0 0 30px; border-radius: 12px; overflow: hidden; background: #000; box-shadow: 0 10px 32px rgba(44,36,32,.14); }
    .article-content .wideo iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
    .article-content figure { margin: 28px 0 32px; }
    .article-content figure img { display: block; width: 100%; height: auto; border: 1px solid var(--m-sand); border-radius: 12px; background: #fff; cursor: zoom-in; box-shadow: 0 6px 24px rgba(44,36,32,.08); }
    .article-content figure.waska img { max-width: 420px; margin: 0 auto; }
    .article-content figcaption { font-size: .8rem; color: var(--m-muted); margin-top: 10px; text-align: center; line-height: 1.55; }
    .article-content figcaption b { color: var(--m-ink); font-weight: 600; }
    .article-content > img, .article-content p > img { max-width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--m-sand); }
    .ramka, .highlight-box { background: var(--m-cream); border: 1px solid var(--m-sand); border-left: 4px solid var(--m-camel); border-radius: 0 12px 12px 0; padding: 16px 20px; margin: 26px 0; }
    .ramka p, .highlight-box p { margin: 0; font-size: .92rem; color: var(--m-muted); }
    .ramka p + p, .highlight-box p + p { margin-top: 8px; }
    .ramka ul, .ramka ol { margin-bottom: 0; }
    .ramka.tip { border-left-color: var(--m-sage); }
    .ramka.uwaga { border-left-color: var(--m-mauve-d); }
    .ramka.manager { border-left-color: var(--m-camel); }
    .ramka-tytul { font-size: .7rem; letter-spacing: .14em; text-transform: uppercase; font-weight: 600; color: var(--m-muted); margin-bottom: 6px; }
    .tabela { overflow-x: auto; margin: 20px 0; }
    .article-content table { width: 100%; border-collapse: collapse; font-size: .88rem; background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 12px; overflow: hidden; }
    .article-content th, .article-content td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--m-sand); vertical-align: top; line-height: 1.5; color: #4a3e38; }
    .article-content th { font-weight: 600; font-size: .74rem; letter-spacing: .08em; text-transform: uppercase; color: var(--m-muted); background: rgba(212,196,168,.25); }
    .article-content tr:last-child td { border-bottom: none; }
    .article-content ol.steps { counter-reset: krok; list-style: none; margin-left: 0; }
    .article-content ol.steps > li { position: relative; padding-left: 46px; margin-bottom: 16px; min-height: 32px; }
    .article-content ol.steps > li::before { counter-increment: krok; content: counter(krok); position: absolute; left: 0; top: 0; width: 32px; height: 32px; border-radius: 50%; background: var(--m-mauve); color: #fff; font-weight: 600; font-size: .85rem; display: flex; align-items: center; justify-content: center; }
    .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 28px 0; }
    @media (max-width: 500px) { .stat-grid { grid-template-columns: 1fr; } }
    .stat-card { background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 14px; padding: 20px; text-align: center; }
    .stat-num { font-family: 'Cormorant Garamond', serif; font-size: 2.4rem; font-weight: 600; color: var(--m-mauve); line-height: 1; }
    .stat-label { font-size: .78rem; color: var(--m-muted); margin-top: 6px; line-height: 1.4; }
    .faq details { border: 1px solid var(--m-sand); border-radius: 12px; background: var(--m-cream); margin-bottom: 10px; padding: 0 18px; }
    .faq summary { cursor: pointer; padding: 14px 0; font-weight: 600; font-size: .95rem; color: var(--m-ink); list-style: none; }
    .faq summary::-webkit-details-marker { display: none; }
    .faq summary::after { content: '+'; float: right; color: var(--m-taupe); font-weight: 400; }
    .faq details[open] summary::after { content: '–'; }
    .faq details p { padding-bottom: 14px; }
    .powiazane { margin-top: 52px; }
    .powiazane h3 { font-family: 'Cormorant Garamond', serif; font-size: 1.4rem; font-weight: 600; margin-bottom: 14px; }
    .powiazane-lista { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .powiazane a { display: block; background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 12px; padding: 14px 16px; text-decoration: none; color: var(--m-ink); transition: box-shadow .2s, transform .2s; }
    .powiazane a:hover { box-shadow: 0 8px 24px rgba(44,36,32,.1); transform: translateY(-2px); }
    .powiazane .kat { font-size: .66rem; text-transform: uppercase; letter-spacing: .12em; color: var(--m-camel); font-weight: 600; }
    .powiazane .tyt { font-family: 'Cormorant Garamond', serif; font-size: 1.12rem; font-weight: 600; margin-top: 4px; line-height: 1.3; }
    .article-cta { background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 16px; padding: 40px; text-align: center; margin-top: 56px; position: relative; overflow: hidden; }
    .article-cta::before { content: ''; position: absolute; width: 280px; height: 280px; background: radial-gradient(circle, rgba(196,160,160,.15) 0%, transparent 65%); top: -80px; right: -40px; border-radius: 50%; }
    .article-cta h3 { font-family: 'Cormorant Garamond', serif; font-size: 1.6rem; color: var(--m-ink); margin-bottom: 8px; font-weight: 600; position: relative; z-index: 1; }
    .article-cta p { color: var(--m-muted); font-size: .88rem; margin-bottom: 20px; position: relative; z-index: 1; }
    .article-cta a { background: var(--m-mauve); color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: .9rem; display: inline-block; transition: background .2s; position: relative; z-index: 1; }
    .article-cta a:hover { background: var(--m-mauve-d); }
    footer { text-align: center; padding: 24px 40px; font-size: .75rem; color: var(--m-taupe); border-top: 1px solid var(--m-sand); }
    footer a { color: var(--m-mauve); text-decoration: none; }
    footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 24px; margin-bottom: 14px; padding: 0; }
    .lightbox { position: fixed; inset: 0; background: rgba(44,36,32,.92); display: none; align-items: center; justify-content: center; z-index: 1000; padding: 24px; cursor: zoom-out; }
    .lightbox.open { display: flex; }
    .lightbox img { max-width: 100%; max-height: 100%; border-radius: 8px; box-shadow: 0 20px 60px rgba(0,0,0,.45); background: #fff; }
    .lightbox figcaption { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center; color: #fff; font-size: .85rem; padding: 0 24px; opacity: .9; }
    .toast { position: fixed; bottom: 24px; left: 50%; transform: translate(-50%, 16px); background: var(--m-ink); color: #fff; padding: 10px 18px; border-radius: 10px; font-size: .85rem; opacity: 0; transition: opacity .3s, transform .3s; pointer-events: none; z-index: 1001; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    @media (max-width: 600px) { .article-hero { padding: 36px 20px 32px; } .article-hero h1 { font-size: 1.9rem; } .article-body { padding: 28px 20px 56px; } .udostepnij span.etykieta { display: none; } }
    @media print { nav.gorne, .pasek-gorny, .article-cta, .powiazane, footer, .kotwica { display: none !important; } body { background: #fff; } .article-content figure img { box-shadow: none; } }
  </style>
</head>
<body>
<nav class="gorne" style="position:relative;">
  <a class="logo" href="/zamow.html" aria-label="Estelio — strona główna"><img src="/img/estelio-logo.png" alt="Estelio" style="height:36px;width:auto;display:block"></a>
  <div class="nav-links">
    <a href="${wstecz.href}">← ${wstecz.tekst}</a>
    <a href="/pomoc/">Pomoc</a>
    <a href="/zamow.html#formularz" class="nav-cta">Zamów dostęp</a>
  </div>
  <button class="hamburger" id="hamburger" aria-label="Menu" onclick="toggleMenu()">
    <span></span><span></span><span></span>
  </button>
  <div class="nav-mobile-menu" id="mobileMenu">
    <a href="${wstecz.href}" onclick="closeMenu()">← ${wstecz.tekst}</a>
    <a href="/pomoc/" onclick="closeMenu()">Pomoc</a>
    <a href="/zamow.html" onclick="closeMenu()">Strona główna</a>
    <a href="/zamow.html#formularz" class="nav-cta" onclick="closeMenu()">Zamów dostęp</a>
  </div>
</nav>
${podglad ? `<div class="podglad-pasek">Podgląd ${post.status === 'draft' ? 'szkicu' : 'wpisu'} z panelu admina — ta strona nie jest publiczna.</div>` : ''}

<div class="article-hero">
  <div class="okruszki"><a href="${wstecz.href}">${wstecz.tekst}</a> &nbsp;›&nbsp; ${escHtml(catLabel)}</div>
  <span class="article-cat">${escHtml(catLabel)}</span>
  <h1>${tytul}</h1>
  <div class="article-meta">${escHtml(dateStr)}</div>
</div>

<div class="article-body">
  <div class="pasek-gorny">
    <a class="back-link" href="${wstecz.href}">← Wróć do ${wstecz.dok}</a>
    <div class="udostepnij" aria-label="Udostępnij ten wpis">
      <button type="button" onclick="kopiujLink()" title="Skopiuj adres tego wpisu">${IKONY.link}<span class="etykieta">Kopiuj link</span></button>
      <a href="mailto:?subject=${tematMaila}&body=${trescMaila}" title="Wyślij link e-mailem">${IKONY.mail}<span class="etykieta">E-mail</span></a>
      <a href="${whatsapp}" target="_blank" rel="noopener" title="Wyślij przez WhatsApp">${IKONY.czat}<span class="etykieta">WhatsApp</span></a>
      <button type="button" onclick="window.print()" title="Drukuj albo zapisz jako PDF">${IKONY.drukuj}<span class="etykieta">Drukuj</span></button>
    </div>
  </div>
  <div class="article-content">${tresc.html}</div>
  ${powiazane.length ? `<div class="powiazane"><h3>Zobacz też</h3><div class="powiazane-lista">${powiazane.map(p => `<a href="/blog/${escHtml(p.slug)}"><div class="kat">${escHtml(p.category || '')}</div><div class="tyt">${escHtml(p.title)}</div></a>`).join('')}</div></div>` : ''}
  <div class="article-cta">
    <h3>Wypróbuj Estelio</h3>
    <p>14 dni za darmo, potem 79 zł miesięcznie. Bez umowy na czas określony.</p>
    <a href="/zamow.html#formularz">Zamów dostęp →</a>
  </div>
</div>

<footer>
  <nav>
    <a href="/blog.html">Blog</a>
    <a href="/pomoc/">Pomoc</a>
    <a href="/zamow.html">Strona główna</a>
    <a href="/zamow.html#formularz" style="color:var(--m-mauve); font-weight:500;">Zamów dostęp</a>
  </nav>
  <div>© 2026 Estelio · <a href="/blog/rss.xml">RSS</a> · <a href="/regulamin.html">Regulamin</a> · <a href="/polityka-prywatnosci.html">Polityka prywatności</a> · <a href="mailto:kontakt@estelio.com.pl">kontakt@estelio.com.pl</a></div>
</footer>

<div class="lightbox" id="lightbox" onclick="zamknijLightbox()" role="dialog" aria-label="Powiększony zrzut"><img id="lightbox-img" src="" alt=""><figcaption id="lightbox-podpis"></figcaption></div>
<div class="toast" id="toast" role="status"></div>

<script>
function toggleMenu() {
  document.getElementById('hamburger').classList.toggle('open');
  document.getElementById('mobileMenu').classList.toggle('open');
}
function closeMenu() {
  document.getElementById('hamburger').classList.remove('open');
  document.getElementById('mobileMenu').classList.remove('open');
}
document.addEventListener('click', function(e) {
  var nav = document.querySelector('nav.gorne');
  if (nav && !nav.contains(e.target)) closeMenu();
});
function toast(t) {
  var el = document.getElementById('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(function(){ el.classList.remove('show'); }, 2200);
}
function kopiujLink(adres) {
  var url = adres || (location.origin + location.pathname);
  var gotowe = function(){ toast('Link skopiowany. Możesz go wkleić w wiadomości.'); };
  var recznie = function(){ var i = document.createElement('input'); i.value = url; document.body.appendChild(i); i.select(); try { document.execCommand('copy'); gotowe(); } catch (e) { prompt('Skopiuj adres:', url); } document.body.removeChild(i); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(gotowe, recznie); else recznie();
}
// Kotwica „#” przy nagłówku: kopiuje link do sekcji zamiast tylko przewijać
document.querySelectorAll('.article-content h2 .kotwica').forEach(function(a) {
  a.addEventListener('click', function(e) { e.preventDefault(); history.replaceState(null, '', a.getAttribute('href')); kopiujLink(location.origin + location.pathname + a.getAttribute('href')); });
});
// Powiększenie zrzutów po kliknięciu
var LB = document.getElementById('lightbox'), LBI = document.getElementById('lightbox-img'), LBP = document.getElementById('lightbox-podpis');
document.querySelectorAll('.article-content figure img, .article-content img').forEach(function(img) {
  img.addEventListener('click', function() { LBI.src = img.src; LBI.alt = img.alt || ''; var fc = img.closest('figure'); var cap = fc ? fc.querySelector('figcaption') : null; LBP.textContent = cap ? cap.textContent : (img.alt || ''); LB.classList.add('open'); document.body.style.overflow = 'hidden'; });
  if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
});
function zamknijLightbox() { LB.classList.remove('open'); LBI.src = ''; document.body.style.overflow = ''; }
document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && LB.classList.contains('open')) zamknijLightbox(); });
</script>
</body>
</html>`;
}

// Strona wpisu dla server.js: wpis + do trzech powiązanych (najpierw ta sama kategoria, potem najnowsze).
// cb(err, html) — html === null, gdy wpisu nie ma albo nie jest opublikowany.
function stronaArtykulu(db, slug, cb) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ''))) return cb(null, null);
  db.query(`SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'`, [slug], (err, rows) => {
    if (err) return cb(err);
    if (!rows || !rows.length) return cb(null, null);
    const post = rows[0];
    db.query(
      `SELECT slug, title, category FROM blog_posts WHERE status = 'published' AND slug <> ? ORDER BY (category = ?) DESC, date_published DESC, id DESC LIMIT 3`,
      [slug, post.category || ''],
      (err2, pow) => cb(null, renderArticle(post, { powiazane: err2 ? [] : pow }))
    );
  });
}

// Mapa strony: strony stałe + opublikowane wpisy (lastmod z updated_at)
const STRONY_STALE = ['/zamow.html', '/blog.html', '/przewodnik/', '/pomoc/', '/pomoc-terminarz/', '/regulamin.html', '/polityka-prywatnosci.html'];
function sitemapXml(db, cb) {
  db.query(`SELECT slug, url_override, date_published, updated_at FROM blog_posts WHERE status = 'published' ORDER BY date_published DESC`, (err, rows) => {
    if (err) return cb(err);
    const dzis = new Date().toISOString().slice(0, 10);
    const wpisy = (rows || []).filter(r => !r.url_override).map(r => `  <url><loc>${BAZA_URL}/blog/${escHtml(r.slug)}</loc><lastmod>${dataISO(r.updated_at) || dataISO(r.date_published) || dzis}</lastmod><changefreq>monthly</changefreq></url>`);
    const stale = STRONY_STALE.map(u => `  <url><loc>${BAZA_URL}${u}</loc><changefreq>weekly</changefreq></url>`);
    cb(null, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${stale.concat(wpisy).join('\n')}\n</urlset>\n`);
  });
}

// Kanał RSS — ostatnie 20 wpisów, bez pełnej treści (zajawka + link)
function rssXml(db, cb) {
  db.query(`SELECT slug, title, excerpt, category, date_published, url_override FROM blog_posts WHERE status = 'published' ORDER BY date_published DESC, id DESC LIMIT 20`, (err, rows) => {
    if (err) return cb(err);
    const items = (rows || []).map(r => {
      const link = r.url_override ? absUrl(r.url_override) : `${BAZA_URL}/blog/${r.slug}`;
      const d = new Date(r.date_published);
      return `    <item>\n      <title>${escHtml(r.title)}</title>\n      <link>${escHtml(link)}</link>\n      <guid isPermaLink="true">${escHtml(link)}</guid>\n      <category>${escHtml(r.category || '')}</category>\n      <pubDate>${isNaN(d) ? '' : d.toUTCString()}</pubDate>\n      <description>${escHtml(r.excerpt || '')}</description>\n    </item>`;
    });
    cb(null, `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n    <title>Blog Estelio</title>\n    <link>${BAZA_URL}/blog.html</link>\n    <atom:link href="${BAZA_URL}/blog/rss.xml" rel="self" type="application/rss+xml"/>\n    <description>Praktyczne wpisy o prowadzeniu salonu beauty z Estelio: sprzedaż, klientki, magazyn, terminarz, dodatki.</description>\n    <language>pl-PL</language>\n${items.join('\n')}\n  </channel>\n</rss>\n`);
  });
}

module.exports = (db) => {
  const router = express.Router();

  // ─── Utwórz tabelę ──────────────────────────────────────────
  db.query(`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      slug         VARCHAR(200) NOT NULL UNIQUE,
      title        VARCHAR(400) NOT NULL,
      excerpt      TEXT,
      category     VARCHAR(80)  DEFAULT 'Zarządzanie',
      emoji        VARCHAR(8)   DEFAULT '✍️',
      content_html LONGTEXT,
      url_override VARCHAR(300) DEFAULT NULL,
      date_published DATE        NOT NULL,
      status       ENUM('published','draft') DEFAULT 'published',
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `, (err) => {
    if (err) { console.error('[blog] CREATE TABLE błąd:', err.message); return; }

    // 2.11.2026: okładka wpisu (adres obrazka do og:image i miniatury na liście). Dopisana kolumna NULL-owalna —
    // istniejące wiersze i panel nietknięte; brak okładki = pierwszy obrazek z treści albo logo.
    db.query(`ALTER TABLE blog_posts ADD COLUMN okladka VARCHAR(300) NULL`, (e2) => {
      if (e2 && e2.code !== 'ER_DUP_FIELDNAME') console.error('[blog] ALTER okladka:', e2.message);
    });

    // Seed 3 starter posts jeśli tabela pusta
    db.query('SELECT COUNT(*) AS n FROM blog_posts', (err2, rows) => {
      if (err2 || rows[0].n > 0) return;
      SEED_POSTS.forEach(p => {
        db.query(
          `INSERT IGNORE INTO blog_posts (slug, title, excerpt, category, emoji, content_html, url_override, date_published, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.slug, p.title, p.excerpt, p.category, p.emoji, p.content_html, p.url_override, p.date_published, p.status]
        );
      });
      console.log('[blog] Seed: dodano 3 starter posts');
    });

    // Wyczyść stare url_override dla 3 artykułów statycznych
    ['jak-estelio-oszczedza-czas','rozliczenia-pracownic-salonu','magazyn-kosmetykow-w-salonie'].forEach(slug => {
      db.query(`UPDATE blog_posts SET url_override = NULL WHERE slug = ? AND url_override IS NOT NULL`, [slug]);
    });
  });

  // ─── Middleware admina (lokalny, oparty na tokenie) ──────────
  function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token) return res.status(403).json({ status: 'error', message: 'Brak tokenu admina.' });
    db.query('SELECT expires FROM admin_sessions WHERE token = ?', [token], (err, rows) => {
      if (err || !rows?.length || Date.now() > rows[0].expires) {
        return res.status(403).json({ status: 'error', message: 'Sesja admina wygasła lub nieprawidłowa.' });
      }
      // Sliding expiry — 7 dni
      const newExp = Date.now() + 7 * 24 * 60 * 60 * 1000;
      db.query('UPDATE admin_sessions SET expires = ? WHERE token = ?', [newExp, token]);
      next();
    });
  }

  // ════════════════════════════════════════════
  // PUBLICZNE ENDPOINTY
  // ════════════════════════════════════════════

  // ─── 301 przekierowania ze starych URLi .html → /blog/:slug ──
  const REDIRECTS = [
    '/blog/jak-estelio-oszczedza-czas.html',
    '/blog/rozliczenia-pracownic-salonu.html',
    '/blog/magazyn-kosmetykow-w-salonie.html',
  ];
  REDIRECTS.forEach(oldUrl => {
    router.get(oldUrl, (req, res) => {
      const slug = path.basename(oldUrl, '.html');
      res.redirect(301, `/blog/${slug}`);
    });
  });

  // GET /api/blog/posts — lista opublikowanych wpisów. MUSI stać przed /blog/:slug (inaczej „posts” jest brane za slug).
  router.get('/blog/posts', (req, res) => {
    const sql = `
      SELECT id, slug, title, excerpt, category, emoji, okladka, url_override, date_published, status, updated_at
      FROM blog_posts
      WHERE status = 'published'
      ORDER BY date_published DESC, id DESC
    `;
    db.query(sql, (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
      res.json({ status: 'success', posts: rows, kategorie: Object.keys(CATEGORIES) });
    });
  });

  // GET /api/blog/posts/:slug — pojedynczy wpis (do renderowania)
  router.get('/blog/posts/:slug', (req, res) => {
    db.query('SELECT * FROM blog_posts WHERE slug = ? AND status = ?', [req.params.slug, 'published'], (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
      if (!rows.length) return res.status(404).json({ status: 'error', message: 'Nie znaleziono wpisu.' });
      res.json({ status: 'success', post: rows[0] });
    });
  });

  // ─── Dynamiczny widok artykułu /api/blog/:slug (zgodność; publiczny adres to /blog/:slug w server.js) ───
  router.get('/blog/:slug', (req, res) => {
    stronaArtykulu(db, req.params.slug, (err, html) => {
      if (err || !html) return res.status(404).send('Artykuł nie istnieje.');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  });

  // ════════════════════════════════════════════
  // ADMIN ENDPOINTY
  // ════════════════════════════════════════════

  router.get('/admin/blog/posts', requireAdmin, (req, res) => {
    db.query(
      'SELECT id, slug, title, excerpt, category, emoji, okladka, url_override, date_published, status, created_at, updated_at FROM blog_posts ORDER BY date_published DESC, id DESC',
      (err, rows) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
        res.json({ status: 'success', posts: rows, kategorie: Object.keys(CATEGORIES) });
      }
    );
  });

  // GET /api/admin/blog/podglad/:id — pełna strona wpisu (także szkicu) renderowana tym samym kodem co publicznie.
  // Panel pobiera ją z nagłówkiem tokenu i otwiera w nowej karcie; strona ma noindex i pasek „Podgląd”.
  router.get('/admin/blog/podglad/:id', requireAdmin, (req, res) => {
    db.query('SELECT * FROM blog_posts WHERE id = ?', [req.params.id], (err, rows) => {
      if (err) return res.status(500).send('Błąd bazy.');
      if (!rows.length) return res.status(404).send('Nie znaleziono wpisu.');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderArticle(rows[0], { podglad: true }));
    });
  });

  // GET /api/admin/blog/posts/:id — pełny wpis do edycji
  router.get('/admin/blog/posts/:id', requireAdmin, (req, res) => {
    db.query('SELECT * FROM blog_posts WHERE id = ?', [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
      if (!rows.length) return res.status(404).json({ status: 'error', message: 'Nie znaleziono wpisu.' });
      res.json({ status: 'success', post: rows[0] });
    });
  });

  // POST /api/admin/blog/posts — nowy wpis
  router.post('/admin/blog/posts', requireAdmin, (req, res) => {
    const { title, excerpt, category, emoji, content_html, date_published, status, url_override, okladka } = req.body || {};
    if (!title || !date_published) {
      return res.json({ status: 'error', message: 'Tytuł i data są wymagane.' });
    }
    const slug = req.body.slug && /^[a-z0-9-]+$/.test(req.body.slug) ? req.body.slug : slugify(title);
    const cat = CATEGORIES[category] ? category : 'Zarządzanie';
    const emo = emoji || (CATEGORIES[cat]?.emoji) || '✍️';
    const st  = status === 'draft' ? 'draft' : 'published';

    db.query(
      `INSERT INTO blog_posts (slug, title, excerpt, category, emoji, content_html, url_override, okladka, date_published, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [slug, title, excerpt || '', cat, emo, content_html || '', url_override || null, okladka || okladkaZWideo(content_html) || null, date_published, st],
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.json({ status: 'error', message: 'Wpis o takim slugu już istnieje. Zmień tytuł.' });
          }
          return res.status(500).json({ status: 'error', message: 'Błąd bazy: ' + err.message });
        }
        res.json({ status: 'success', id: result.insertId, slug, url: `/blog/${slug}` });
      }
    );
  });

  // PUT /api/admin/blog/posts/:id — aktualizacja
  router.put('/admin/blog/posts/:id', requireAdmin, (req, res) => {
    const { title, excerpt, category, emoji, content_html, date_published, status, url_override, okladka } = req.body || {};
    if (!title || !date_published) {
      return res.json({ status: 'error', message: 'Tytuł i data są wymagane.' });
    }
    const cat = CATEGORIES[category] ? category : 'Zarządzanie';
    const emo = emoji || (CATEGORIES[cat]?.emoji) || '✍️';
    const st  = status === 'draft' ? 'draft' : 'published';

    db.query(
      `UPDATE blog_posts SET title=?, excerpt=?, category=?, emoji=?, content_html=?, url_override=?, okladka=?, date_published=?, status=?
       WHERE id=?`,
      [title, excerpt || '', cat, emo, content_html || '', url_override || null, okladka || okladkaZWideo(content_html) || null, date_published, st, req.params.id],
      (err, result) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy: ' + err.message });
        if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
        res.json({ status: 'success' });
      }
    );
  });

  // PATCH /api/admin/blog/posts/:id/status — publikacja albo cofnięcie do szkicu jednym kliknięciem z listy
  router.patch('/admin/blog/posts/:id/status', requireAdmin, (req, res) => {
    const st = req.body && req.body.status === 'published' ? 'published' : 'draft';
    db.query('UPDATE blog_posts SET status = ? WHERE id = ?', [st, req.params.id], (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
      if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
      res.json({ status: 'success', post_status: st });
    });
  });

  // DELETE /api/admin/blog/posts/:id — usuń wpis
  router.delete('/admin/blog/posts/:id', requireAdmin, (req, res) => {
    db.query('DELETE FROM blog_posts WHERE id = ?', [req.params.id], (err, result) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
      if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
      res.json({ status: 'success' });
    });
  });

  return router;
};

// Pomocniki dla server.js, panelu i testów
module.exports.CATEGORIES = CATEGORIES;
module.exports.slugify = slugify;
module.exports.escHtml = escHtml;
module.exports.readTime = readTime;
module.exports.pierwszyObraz = pierwszyObraz;
module.exports.youtubeId = youtubeId;
module.exports.osadzenieYoutube = osadzenieYoutube;
module.exports.pierwszeWideo = pierwszeWideo;
module.exports.miniaturaYoutube = miniaturaYoutube;
module.exports.przygotujTresc = przygotujTresc;
module.exports.renderArticle = renderArticle;
module.exports.stronaArtykulu = stronaArtykulu;
module.exports.sitemapXml = sitemapXml;
module.exports.rssXml = rssXml;
