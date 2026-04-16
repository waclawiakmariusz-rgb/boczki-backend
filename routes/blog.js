// routes/blog.js
// Publiczne API bloga + panel admina do zarządzania wpisami

const express = require('express');
const { randomUUID } = require('crypto');
const fs   = require('fs');
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
    url_override: '/blog/jak-estelio-oszczedza-czas.html',
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
    url_override: '/blog/rozliczenia-pracownic-salonu.html',
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
    url_override: '/blog/magazyn-kosmetykow-w-salonie.html',
    content_html: '',
  },
];

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
      // Po seedzie od razu wypełnij content_html z plików statycznych
      setTimeout(extractStaticContent, 500);
    });

    // Dla istniejących pustych wpisów też uzupełnij content_html
    extractStaticContent();
  });

  // Wyciąga treść artykułu z pliku statycznego i zapisuje do DB
  function extractStaticContent() {
    const publicDir = path.join(__dirname, '..', 'public', 'blog');
    const STATIC_MAP = [
      { slug: 'jak-estelio-oszczedza-czas',    file: 'jak-estelio-oszczedza-czas.html' },
      { slug: 'rozliczenia-pracownic-salonu',  file: 'rozliczenia-pracownic-salonu.html' },
      { slug: 'magazyn-kosmetykow-w-salonie',  file: 'magazyn-kosmetykow-w-salonie.html' },
    ];

    STATIC_MAP.forEach(({ slug, file }) => {
      db.query('SELECT id, content_html FROM blog_posts WHERE slug = ?', [slug], (err, rows) => {
        if (err || !rows.length) return;
        if (rows[0].content_html && rows[0].content_html.trim().length > 50) return; // już wypełniony

        const filePath = path.join(publicDir, file);
        if (!fs.existsSync(filePath)) return;

        const html = fs.readFileSync(filePath, 'utf8');

        // Wyciągnij wszystko między back-link a article-cta
        const bodyMatch = html.match(/<a class="back-link"[^>]*>.*?<\/a>([\s\S]*?)<div class="article-cta">/);
        if (!bodyMatch) return;

        const content = bodyMatch[1].trim();
        db.query('UPDATE blog_posts SET content_html = ? WHERE id = ?', [content, rows[0].id], (e) => {
          if (!e) console.log(`[blog] Wypełniono content_html dla: ${slug}`);
        });
      });
    });
  }

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
