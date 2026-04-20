// routes/blog.js
// Publiczne API bloga + panel admina do zarządzania wpisami

const express = require('express');
const { randomUUID } = require('crypto');
const path = require('path');

// Wbudowany slugify (polska diacritica)
function slugify(text) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l').replace(/ą/g, 'a').replace(/ę/g, 'e')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z')
    .replace(/ż/g, 'z').replace(/ć/g, 'c').replace(/ń/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Kategorie i ich CSS klasy
const CATEGORIES = {
  'Zarządzanie':  { css: 'cat-zarzadzanie', thumb: 'zarzadzanie', emoji: '⏱️' },
  'Pracownicy':   { css: 'cat-pracownicy',  thumb: 'pracownicy',  emoji: '💅' },
  'Magazyn':      { css: 'cat-magazyn',     thumb: 'magazyn',     emoji: '📦' },
  'Klienci':      { css: 'cat-klienci',     thumb: 'klienci',     emoji: '💆' },
  'Sprzedaż':     { css: 'cat-sprzedaz',   thumb: 'sprzedaz',    emoji: '💰' },
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
  return `${d.getUTCDate()} ${MIESIACE[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Pomocnik: szacowany czas czytania
function readTime(html) {
  const words = (html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Renderuje pełną stronę artykułu z danych z bazy
function renderArticle(post) {
  const canonical = `https://estelio.com.pl/blog/${post.slug}`;
  const rt = readTime(post.content_html);
  const dateStr = formatDate(post.date_published);
  const catLabel = post.category || 'Blog';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post.title} — Estelio Blog</title>
  <meta name="description" content="${(post.excerpt || '').replace(/"/g, '&quot;')}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${post.title}">
  <meta property="og:description" content="${(post.excerpt || '').replace(/"/g, '&quot;')}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonical}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${post.title.replace(/"/g, '\\"')}",
    "datePublished": "${post.date_published}",
    "dateModified": "${post.updated_at ? String(post.updated_at).slice(0,10) : post.date_published}",
    "description": "${(post.excerpt || '').replace(/"/g, '\\"')}",
    "author": { "@type": "Organization", "name": "Estelio" },
    "publisher": { "@type": "Organization", "name": "Estelio", "url": "https://estelio.com.pl" }
  }
  </script>
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
    body { font-family: 'DM Sans', sans-serif; background: var(--m-linen); color: var(--m-ink); }
    nav { display: flex; align-items: center; justify-content: space-between; padding: 20px 60px; background: var(--m-cream); border-bottom: 1px solid var(--m-sand); position: sticky; top: 0; z-index: 100; }
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
    @media (max-width: 600px) { nav { padding: 14px 20px; } .nav-links { display: none; } .hamburger { display: block; } }
    .article-hero { background: var(--m-cream); border-bottom: 1px solid var(--m-sand); padding: 56px 60px 48px; text-align: center; position: relative; overflow: hidden; }
    .article-hero::before { content: ''; position: absolute; width: 420px; height: 420px; background: radial-gradient(circle, rgba(196,160,160,.2) 0%, transparent 65%); top: -120px; right: -60px; border-radius: 50%; }
    .article-hero::after { content: ''; position: absolute; width: 300px; height: 300px; background: radial-gradient(circle, rgba(154,171,154,.18) 0%, transparent 65%); bottom: -80px; left: -30px; border-radius: 50%; }
    .article-cat { display: inline-block; font-size: .68rem; font-weight: 600; letter-spacing: .15em; text-transform: uppercase; background: rgba(196,168,112,.15); color: var(--m-camel); padding: 4px 14px; border-radius: 20px; margin-bottom: 16px; border: 1px solid rgba(196,168,112,.3); position: relative; z-index: 1; }
    .article-hero h1 { font-family: 'Cormorant Garamond', serif; font-size: 2.6rem; font-weight: 600; color: var(--m-ink); line-height: 1.2; max-width: 720px; margin: 0 auto 14px; position: relative; z-index: 1; }
    .article-meta { font-size: .8rem; color: var(--m-taupe); position: relative; z-index: 1; }
    .article-body { max-width: 720px; margin: 0 auto; padding: 56px 40px 80px; }
    .lead { font-size: 1.08rem; color: var(--m-muted); line-height: 1.8; margin-bottom: 36px; padding-bottom: 32px; border-bottom: 1px solid var(--m-sand); }
    h2 { font-family: 'Cormorant Garamond', serif; font-size: 1.6rem; font-weight: 600; color: var(--m-ink); margin: 40px 0 14px; line-height: 1.25; }
    h3 { font-size: 1rem; font-weight: 600; color: var(--m-ink); margin: 28px 0 10px; }
    p { font-size: .95rem; color: #4a3e38; line-height: 1.85; margin-bottom: 16px; }
    ul, ol { margin: 10px 0 18px 22px; }
    li { font-size: .95rem; color: #4a3e38; line-height: 1.8; margin-bottom: 6px; }
    strong { color: var(--m-ink); }
    .highlight-box { background: var(--m-cream); border-left: 3px solid var(--m-camel); border-radius: 0 10px 10px 0; padding: 18px 22px; margin: 28px 0; border-top: 1px solid var(--m-sand); border-right: 1px solid var(--m-sand); border-bottom: 1px solid var(--m-sand); }
    .highlight-box p { margin: 0; font-size: .92rem; color: var(--m-muted); }
    .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 28px 0; }
    @media (max-width: 500px) { .stat-grid { grid-template-columns: 1fr; } }
    .stat-card { background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 14px; padding: 20px; text-align: center; }
    .stat-num { font-family: 'Cormorant Garamond', serif; font-size: 2.4rem; font-weight: 600; color: var(--m-mauve); line-height: 1; }
    .stat-label { font-size: .78rem; color: var(--m-muted); margin-top: 6px; line-height: 1.4; }
    .article-cta { background: var(--m-cream); border: 1px solid var(--m-sand); border-radius: 16px; padding: 40px; text-align: center; margin-top: 56px; position: relative; overflow: hidden; }
    .article-cta::before { content: ''; position: absolute; width: 280px; height: 280px; background: radial-gradient(circle, rgba(196,160,160,.15) 0%, transparent 65%); top: -80px; right: -40px; border-radius: 50%; }
    .article-cta h3 { font-family: 'Cormorant Garamond', serif; font-size: 1.6rem; color: var(--m-ink); margin-bottom: 8px; font-weight: 600; position: relative; z-index: 1; }
    .article-cta p { color: var(--m-muted); font-size: .88rem; margin-bottom: 20px; position: relative; z-index: 1; }
    .article-cta a { background: var(--m-mauve); color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: .9rem; display: inline-block; transition: background .2s; position: relative; z-index: 1; }
    .article-cta a:hover { background: var(--m-mauve-d); }
    .back-link { display: inline-block; font-size: .82rem; color: var(--m-muted); text-decoration: none; margin-bottom: 32px; }
    .back-link:hover { color: var(--m-mauve); }
    footer { text-align: center; padding: 24px 40px; font-size: .75rem; color: var(--m-taupe); border-top: 1px solid var(--m-sand); }
    footer a { color: var(--m-mauve); text-decoration: none; }
    footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 24px; margin-bottom: 14px; padding: 0; }
    @media (max-width: 600px) { .article-hero { padding: 40px 20px 36px; } .article-hero h1 { font-size: 1.9rem; } .article-body { padding: 36px 20px 56px; } }
  </style>
</head>
<body>
<nav style="position:relative;">
  <a class="logo" href="/zamow.html">Estelio</a>
  <div class="nav-links">
    <a href="/blog.html">← Blog</a>
    <a href="/zamow.html#formularz" class="nav-cta">Zamów dostęp</a>
  </div>
  <button class="hamburger" id="hamburger" aria-label="Menu" onclick="toggleMenu()">
    <span></span><span></span><span></span>
  </button>
  <div class="nav-mobile-menu" id="mobileMenu">
    <a href="/blog.html" onclick="closeMenu()">← Blog</a>
    <a href="/zamow.html" onclick="closeMenu()">Strona główna</a>
    <a href="/zamow.html#formularz" class="nav-cta" onclick="closeMenu()">Zamów dostęp</a>
  </div>
</nav>

<div class="article-hero">
  <span class="article-cat">${catLabel}</span>
  <h1>${post.title}</h1>
  <div class="article-meta">${dateStr} &nbsp;·&nbsp; ${rt} min czytania</div>
</div>

<div class="article-body">
  <a class="back-link" href="/blog.html">← Wróć do bloga</a>
  ${post.content_html || '<p>Treść artykułu niedostępna.</p>'}
  <div class="article-cta">
    <h3>Wypróbuj Estelio</h3>
    <p>Dołącz do salonów, które już korzystają z systemu.</p>
    <a href="/zamow.html#formularz">Zacznij za 49 zł / miesiąc →</a>
  </div>
</div>

<footer>
  <nav>
    <a href="/blog.html">Blog</a>
    <a href="/zamow.html">Strona główna</a>
    <a href="/zamow.html#formularz" style="color:var(--m-mauve); font-weight:500;">Zamów dostęp</a>
  </nav>
  <div>© 2026 Estelio · <a href="/blog.html">Blog</a> · <a href="/zamow.html">Strona główna</a> · <a href="/regulamin.html">Regulamin</a> · <a href="/polityka-prywatnosci.html">Polityka prywatności</a></div>
</footer>

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
  const nav = document.querySelector('nav');
  if (nav && !nav.contains(e.target)) closeMenu();
});
</script>
</body>
</html>`;
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

  // ─── Dynamiczny widok artykułu /blog/:slug ───────────────────
  router.get('/blog/:slug', (req, res) => {
    const { slug } = req.params;
    if (!/^[a-z0-9-]+$/.test(slug)) return res.status(404).send('Nie znaleziono.');
    db.query(
      `SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'`,
      [slug],
      (err, rows) => {
        if (err || !rows.length) return res.status(404).send('Artykuł nie istnieje.');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(renderArticle(rows[0]));
      }
    );
  });

  // GET /api/blog/posts — lista opublikowanych wpisów
  router.get('/blog/posts', (req, res) => {
    const sql = `
      SELECT id, slug, title, excerpt, category, emoji, url_override, date_published, status
      FROM blog_posts
      WHERE status = 'published'
      ORDER BY date_published DESC, id DESC
    `;
    db.query(sql, (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
      res.json({ status: 'success', posts: rows });
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

  // ════════════════════════════════════════════
  // ADMIN ENDPOINTY
  // ════════════════════════════════════════════

  // GET /api/admin/blog/posts — lista wszystkich (draft + published)
  router.get('/admin/blog/posts', requireAdmin, (req, res) => {
    db.query(
      'SELECT id, slug, title, excerpt, category, emoji, url_override, date_published, status, created_at FROM blog_posts ORDER BY date_published DESC, id DESC',
      (err, rows) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy.' });
        res.json({ status: 'success', posts: rows });
      }
    );
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
    const { title, excerpt, category, emoji, content_html, date_published, status, url_override } = req.body || {};
    if (!title || !date_published) {
      return res.json({ status: 'error', message: 'Tytuł i data są wymagane.' });
    }
    const slug = slugify(title);
    const cat = CATEGORIES[category] ? category : 'Zarządzanie';
    const emo = emoji || (CATEGORIES[cat]?.emoji) || '✍️';
    const st  = status === 'draft' ? 'draft' : 'published';

    db.query(
      `INSERT INTO blog_posts (slug, title, excerpt, category, emoji, content_html, url_override, date_published, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [slug, title, excerpt || '', cat, emo, content_html || '', url_override || null, date_published, st],
      (err, result) => {
        if (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            return res.json({ status: 'error', message: 'Wpis o takim slugu już istnieje. Zmień tytuł.' });
          }
          return res.status(500).json({ status: 'error', message: 'Błąd bazy: ' + err.message });
        }
        res.json({ status: 'success', id: result.insertId, slug });
      }
    );
  });

  // PUT /api/admin/blog/posts/:id — aktualizacja
  router.put('/admin/blog/posts/:id', requireAdmin, (req, res) => {
    const { title, excerpt, category, emoji, content_html, date_published, status, url_override } = req.body || {};
    if (!title || !date_published) {
      return res.json({ status: 'error', message: 'Tytuł i data są wymagane.' });
    }
    const cat = CATEGORIES[category] ? category : 'Zarządzanie';
    const emo = emoji || (CATEGORIES[cat]?.emoji) || '✍️';
    const st  = status === 'draft' ? 'draft' : 'published';

    db.query(
      `UPDATE blog_posts SET title=?, excerpt=?, category=?, emoji=?, content_html=?, url_override=?, date_published=?, status=?
       WHERE id=?`,
      [title, excerpt || '', cat, emo, content_html || '', url_override || null, date_published, st, req.params.id],
      (err, result) => {
        if (err) return res.status(500).json({ status: 'error', message: 'Błąd bazy: ' + err.message });
        if (result.affectedRows === 0) return res.json({ status: 'error', message: 'Nie znaleziono wpisu.' });
        res.json({ status: 'success' });
      }
    );
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
