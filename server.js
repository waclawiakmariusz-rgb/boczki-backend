require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1); // Hostinger używa reverse proxy — bez tego rate-limit nie działa poprawnie
const { validateTenantAccess } = require('./routes/sessions');

// ENFORCE_SESSION=true w .env przełącza z trybu "loguj" na tryb "blokuj"
const ENFORCE_SESSION = env('ENFORCE_SESSION') === 'true';

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      'https://estelio.com.pl',
      'https://www.estelio.com.pl',
    ];
    if (
      !origin ||
      origin.startsWith('http://localhost') ||
      origin.endsWith('.hostingersite.com') ||
      allowed.includes(origin)
    ) {
      return cb(null, true);
    }
    console.warn('[CORS] Zablokowane żądanie z:', origin);
    cb(new Error('CORS: Brak dostępu.'));
  },
  credentials: true,
}));

// Nagłówki bezpieczeństwa HTTP
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
});

// Sanityzacja błędów DB — nie ujawniamy szczegółów struktury bazy klientowi
app.use((req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = function(data) {
        if (data && data.status === 'error' && typeof data.message === 'string') {
            if (/Table '.+' doesn't exist|Unknown column|You have an error in your SQL|Duplicate entry|foreign key constraint|ER_/i.test(data.message)) {
                console.error('[DB ERROR]', req.method, req.path, '|', data.message);
                return origJson({ ...data, message: 'Błąd bazy danych. Spróbuj ponownie.' });
            }
        }
        return origJson(data);
    };
    next();
});

// Timeout requestów — jeśli route nie odpowie w 30s, klient dostaje 503
// (chroni przed zawieszeniem połączeń i wyczerpaniem puli)
app.use((req, res, next) => {
    res.setTimeout(30000, () => {
        console.error('[TIMEOUT]', req.method, req.url);
        if (!res.headersSent) {
            res.status(503).json({ status: 'error', message: 'Przekroczono czas oczekiwania. Spróbuj ponownie.' });
        }
    });
    next();
});

// Rate limiting — ogólny limit na całe API
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,        // okno 1 minuta
    max: 120,                    // max 120 zapytań / minutę z jednego IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Zbyt wiele zapytań. Spróbuj za chwilę.' },
});
app.use('/api/', apiLimiter);

// Stripe webhook musi dostać raw body — PRZED express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Pozostałe endpointy — JSON z limitem 1MB
app.use(express.json({ limit: '1mb' }));

// Redirect strony głównej na zamów
app.get('/', (req, res) => res.redirect(301, '/zamow.html'));

// /zaloguj — główna aplikacja
app.get('/zaloguj', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// Stary URL /index.html → redirect na /zaloguj
app.get('/index.html', (req, res) => res.redirect(301, '/zaloguj'));

// Dynamiczne renderowanie wpisów bloga z bazy danych
// Działa dla /blog/:slug (bez rozszerzenia .html) — nowe wpisy dodane przez admin CMS
app.get('/blog/:slug', (req, res, next) => {
  const slug = req.params.slug;
  // Jeśli slug zawiera kropkę — to pewnie plik statyczny (.html) — przekaż dalej
  if (slug.includes('.')) return next();
  db.query(
    'SELECT * FROM blog_posts WHERE slug = ? AND status = ?',
    [slug, 'published'],
    (err, rows) => {
      if (err || !rows.length) return next();
      const p = rows[0];
      const dateStr = new Date(p.date_published).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });
      const catMeta = {
        'Zarządzanie': 'cat-zarzadzanie',
        'Pracownicy':  'cat-pracownicy',
        'Magazyn':     'cat-magazyn',
        'Klienci':     'cat-klienci',
        'Sprzedaż':    'cat-sprzedaz',
      };
      const catCss = catMeta[p.category] || 'cat-zarzadzanie';
      res.send(`<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(p.title)} — Estelio Blog</title>
  <meta name="description" content="${escHtml(p.excerpt || '')}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://estelio.com.pl/blog/${escHtml(p.slug)}">
  <meta property="og:title" content="${escHtml(p.title)}">
  <meta property="og:description" content="${escHtml(p.excerpt || '')}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://estelio.com.pl/blog/${escHtml(p.slug)}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":${JSON.stringify(p.title)},"datePublished":${JSON.stringify(p.date_published)},"author":{"@type":"Organization","name":"Estelio"},"publisher":{"@type":"Organization","name":"Estelio","url":"https://estelio.com.pl"}}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--m-linen:#e8e0d5;--m-cream:#f2ede6;--m-sand:#d4c4a8;--m-taupe:#b8a898;--m-mauve:#c4a0a0;--m-mauve-d:#a88080;--m-sage:#9aab9a;--m-camel:#c4a870;--m-ink:#2c2420;--m-muted:#6a5e56}
    body{font-family:'DM Sans',sans-serif;background:var(--m-linen);color:var(--m-ink)}
    nav{display:flex;align-items:center;justify-content:space-between;padding:20px 60px;background:var(--m-cream);border-bottom:1px solid var(--m-sand);position:sticky;top:0;z-index:100}
    .logo{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:600;color:var(--m-ink);text-decoration:none;letter-spacing:.06em}
    .nav-links{display:flex;gap:24px;align-items:center}
    .nav-links a{text-decoration:none;font-size:.85rem;color:var(--m-muted);transition:color .2s}
    .nav-links a:hover{color:var(--m-ink)}
    .nav-cta{background:var(--m-mauve)!important;color:#fff!important;padding:8px 18px;border-radius:6px;font-weight:500!important;transition:background .2s!important}
    .nav-cta:hover{background:var(--m-mauve-d)!important}
    @media(max-width:600px){nav{padding:14px 20px}.nav-links a:not(.nav-cta){display:none}}
    .article-hero{background:var(--m-cream);border-bottom:1px solid var(--m-sand);padding:56px 60px 48px;text-align:center;position:relative;overflow:hidden}
    .article-hero::before{content:'';position:absolute;width:420px;height:420px;background:radial-gradient(circle,rgba(196,160,160,.2) 0%,transparent 65%);top:-120px;right:-60px;border-radius:50%}
    .article-hero::after{content:'';position:absolute;width:300px;height:300px;background:radial-gradient(circle,rgba(154,171,154,.18) 0%,transparent 65%);bottom:-80px;left:-30px;border-radius:50%}
    .article-cat{display:inline-block;font-size:.68rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;background:rgba(196,168,112,.15);color:var(--m-camel);padding:4px 14px;border-radius:20px;margin-bottom:16px;border:1px solid rgba(196,168,112,.3);position:relative;z-index:1}
    .article-hero h1{font-family:'Cormorant Garamond',serif;font-size:2.6rem;font-weight:600;color:var(--m-ink);line-height:1.2;max-width:720px;margin:0 auto 14px;position:relative;z-index:1}
    .article-meta{font-size:.8rem;color:var(--m-taupe);position:relative;z-index:1}
    .article-body{max-width:720px;margin:0 auto;padding:56px 40px 80px}
    .back-link{display:inline-block;font-size:.82rem;color:var(--m-muted);text-decoration:none;margin-bottom:32px}
    .back-link:hover{color:var(--m-mauve)}
    .article-content h2{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:600;color:var(--m-ink);margin:40px 0 14px;line-height:1.25}
    .article-content h3{font-size:1rem;font-weight:600;color:var(--m-ink);margin:28px 0 10px}
    .article-content p{font-size:.95rem;color:#4a3e38;line-height:1.85;margin-bottom:16px}
    .article-content ul,.article-content ol{margin:10px 0 18px 22px}
    .article-content li{font-size:.95rem;color:#4a3e38;line-height:1.8;margin-bottom:6px}
    .article-content strong{color:var(--m-ink)}
    .article-cta{background:var(--m-cream);border:1px solid var(--m-sand);border-radius:16px;padding:40px;text-align:center;margin-top:56px;position:relative;overflow:hidden}
    .article-cta::before{content:'';position:absolute;width:280px;height:280px;background:radial-gradient(circle,rgba(196,160,160,.15) 0%,transparent 65%);top:-80px;right:-40px;border-radius:50%}
    .article-cta h3{font-family:'Cormorant Garamond',serif;font-size:1.6rem;color:var(--m-ink);margin-bottom:8px;font-weight:600;position:relative;z-index:1}
    .article-cta p{color:var(--m-muted);font-size:.88rem;margin-bottom:20px;position:relative;z-index:1}
    .article-cta a{background:var(--m-mauve);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem;display:inline-block;transition:background .2s;position:relative;z-index:1}
    .article-cta a:hover{background:var(--m-mauve-d)}
    footer{text-align:center;padding:24px 40px;font-size:.75rem;color:var(--m-taupe);border-top:1px solid var(--m-sand)}
    footer a{color:var(--m-mauve);text-decoration:none}
    @media(max-width:600px){.article-hero{padding:40px 20px 36px}.article-hero h1{font-size:1.9rem}.article-body{padding:36px 20px 56px}}
  </style>
</head>
<body>
<nav>
  <a class="logo" href="/zamow.html">Estelio</a>
  <div class="nav-links">
    <a href="/blog.html">← Blog</a>
    <a href="/zamow.html#formularz" class="nav-cta">Zamów dostęp</a>
  </div>
</nav>
<div class="article-hero">
  <span class="article-cat">${escHtml(p.category)}</span>
  <h1>${escHtml(p.title)}</h1>
  <div class="article-meta">${escHtml(dateStr)} &nbsp;·&nbsp; 5 min czytania</div>
</div>
<div class="article-body">
  <a class="back-link" href="/blog.html">← Wróć do bloga</a>
  <div class="article-content">${p.content_html || ''}</div>
  <div class="article-cta">
    <h3>Wypróbuj Estelio</h3>
    <p>System zaprojektowany specjalnie dla salonów beauty.</p>
    <a href="/zamow.html#formularz">Zamów dostęp za 49 zł / miesiąc →</a>
  </div>
</div>
<footer>
  © 2026 Estelio ·
  <a href="/blog.html">Blog</a> ·
  <a href="/zamow.html">Strona główna</a> ·
  <a href="/regulamin.html">Regulamin</a> ·
  <a href="/polityka-prywatnosci.html">Polityka prywatności</a>
</footer>
</body>
</html>`);
    }
  );
});

// Serwowanie plików statycznych (index.html, etc.)
app.use(express.static('public'));

// Escapowanie HTML (do renderowania dynamicznych stron bloga)
function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Usuwa apostrofy/cudzysłowy które Hostinger panel dodaje do wartości env
function env(key) {
    return (process.env[key] || '').replace(/^['"]|['"]$/g, '');
}

// Konfiguracja puli połączeń z bazą MySQL
const db = mysql.createPool({
    host: env('DB_HOST'),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('Błąd połączenia z bazą danych:', err.message);
    } else {
        console.log('SUKCES! Połączono z bazą danych MySQL!');
        connection.release();
    }
});

// Pula połączeń DB — obsługa błędów runtime (np. serwer MySQL restartuje się)
db.on('error', (err) => {
    console.error('[DB POOL ERROR]', err.message);
    // Nie rzucamy wyjątku — pool sam próbuje się zresetować
});

// ==========================================
// IMPORTY ROUTERÓW
// ==========================================
const authRoutes       = require('./routes/auth')(db);
const magazynRoutes    = require('./routes/magazyn')(db);
const sprzedazRoutes   = require('./routes/sprzedaz')(db);
const klienciRoutes    = require('./routes/klienci')(db);
const rodoRoutes       = require('./routes/rodo')(db);
const urodzinyRoutes   = require('./routes/urodziny')(db);
const retencjaRoutes   = require('./routes/retencja')(db);
const analitykaRoutes  = require('./routes/analityka')(db);
const konsultacjeRoutes = require('./routes/konsultacje')(db);
const targetyRoutes    = require('./routes/targety')(db);
const raportRoutes     = require('./routes/raport')(db);
const usersRoutes      = require('./routes/users')(db);
const logiRoutes       = require('./routes/logi')(db);
const adminRoutes      = require('./routes/admin')(db);
const stripeRoutes     = require('./routes/stripe')(db);
const dokumentyRoutes  = require('./routes/dokumenty')(db);
const magdaRoutes      = require('./routes/magda')(db);
const helpkbRoutes     = require('./routes/helpkb')(db);
const billingRoutes    = require('./routes/billing')(db);
const blogRoutes       = require('./routes/blog')(db);
const predefRoutes     = require('./routes/predef')(db);
const kosztPlanRoutes  = require('./routes/koszty_plan')(db);

// ==========================================
// REJESTRACJA ROUTERÓW
// ==========================================
app.use('/api', authRoutes);
app.use('/api', magazynRoutes);
app.use('/api', sprzedazRoutes);
app.use('/api', klienciRoutes);
app.use('/api', rodoRoutes);
app.use('/api', urodzinyRoutes);
app.use('/api', retencjaRoutes);
app.use('/api', analitykaRoutes);
app.use('/api', konsultacjeRoutes);
app.use('/api', targetyRoutes);
app.use('/api', raportRoutes);
app.use('/api', usersRoutes);
app.use('/api', logiRoutes);
app.use('/api', adminRoutes);
app.use('/api', stripeRoutes);
app.use('/api', dokumentyRoutes);
app.use('/api', magdaRoutes);
app.use('/api', helpkbRoutes);
app.use('/api', billingRoutes);
app.use('/api', blogRoutes);
app.use('/api', predefRoutes);
app.use('/api', kosztPlanRoutes);

// ==========================================
// MIDDLEWARE WERYFIKACJI SESJI
// Sprawdza czy x-session-token pasuje do tenant_id w żądaniu.
// ENFORCE_SESSION=false → tylko loguje naruszenia (tryb miękki)
// ENFORCE_SESSION=true  → blokuje nieprawidłowe żądania (tryb produkcyjny)
// ==========================================
const PUBLIC_PATHS = [
  '/login', '/admin/login',
  '/reset-hasla/wyslij', '/reset-hasla/weryfikuj', '/reset-hasla/ustaw',
  '/rejestracja/weryfikuj', '/rejestracja/zaloz',
  '/zamowienie', '/voucher/weryfikuj',
  '/stripe/webhook', '/kontakt',
  '/billing/login',
];

app.use('/api', (req, res, next) => {
  // Pomiń publiczne endpointy, panel Magdy, admina i router kompatybilności (req.path = '/')
  if (
    req.path === '/' ||
    PUBLIC_PATHS.includes(req.path) ||
    req.path.startsWith('/magda') ||
    req.path.startsWith('/admin')
  ) {
    return next();
  }

  const tenant_id = req.body?.tenant_id || req.query?.tenant_id;
  if (!tenant_id) return next();

  const token = req.headers['x-session-token'];
  const result = validateTenantAccess(token, tenant_id);

  if (!result.valid) {
    console.warn(`[SESJA ${result.reason.toUpperCase()}] ${req.method} ${req.path} | IP: ${req.ip} | tenant: ${tenant_id} | token: ${token ? 'obecny' : 'brak'}`);

    // ENFORCE_SESSION=true blokuje — włączyć dopiero po aktualizacji frontendu
    if (ENFORCE_SESSION) {
      const status = result.reason === 'expired' ? 401 : 403;
      const message = result.reason === 'expired'
        ? 'Sesja wygasła. Zaloguj się ponownie.'
        : 'Brak dostępu.';
      return res.status(status).json({ status: 'error', message });
    }
  }

  next();
});

// ==========================================
// TEST ENDPOINT
// ==========================================
app.get('/test', (req, res) => {
    res.json({ message: 'Serwer Boczki API działa w 100%!' });
});

app.get('/dbstatus', (req, res) => {
    const tabele = ['Licencje', 'Zamowienia', 'Kody_rabatowe', 'Tokeny_rejestracji'];
    const wyniki = {};
    let pozostalo = tabele.length;

    tabele.forEach(t => {
        db.query(`SELECT COUNT(*) AS n FROM \`${t}\``, (err, rows) => {
            wyniki[t] = err ? 'BŁĄD: ' + err.message : rows[0].n + ' rekordów';
            if (--pozostalo === 0) {
                res.json({
                    db_host: process.env.DB_HOST,
                    db_name: process.env.DB_NAME,
                    tabele: wyniki
                });
            }
        });
    });
});

// ==========================================
// ENDPOINT GŁÓWNY - ROUTER KOMPATYBILNOŚCI
// Obsługa starych klientów wysyłających ?action=...
// ==========================================
app.get('/api', (req, res) => {
    const action = req.query.action;
    const tenant_id = req.query.tenant_id;

    if (!action) return res.send('SaaS Master Engine działa poprawnie (Status: OK).');
    if (!tenant_id) return res.json({ status: 'error', message: 'Błąd sesji SaaS: Brak autoryzacji (tenant_id).' });

    // Przekierowanie do właściwych endpointów poprzez wewnętrzne wywołanie
    const getActions = {
        'read': '/api/magazyn?action=read&tenant_id=' + tenant_id,
        'archive_read': '/api/magazyn?action=archive_read&tenant_id=' + tenant_id,
        'dictionary': '/api/magazyn?action=dictionary&tenant_id=' + tenant_id,
        'birthdays': '/api/urodziny?action=birthdays&tenant_id=' + tenant_id + (req.query.miesiac ? '&miesiac=' + req.query.miesiac : ''),
        'upcoming_birthdays': '/api/urodziny?action=upcoming_birthdays&tenant_id=' + tenant_id,
        'get_client_birthday': '/api/urodziny?action=get_client_birthday&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'sales_history': '/api/sprzedaz?action=sales_history&tenant_id=' + tenant_id,
        'full_sales_history': '/api/sprzedaz?action=full_sales_history&tenant_id=' + tenant_id,
        'sales_dictionary': '/api/sprzedaz?action=sales_dictionary&tenant_id=' + tenant_id,
        'get_discounts': '/api/sprzedaz?action=get_discounts&tenant_id=' + tenant_id,
        'emergency_history': '/api/sprzedaz?action=emergency_history&tenant_id=' + tenant_id,
        'get_system_logs': '/api/get_system_logs?tenant_id=' + tenant_id,
        'get_clients': '/api/klienci?action=get_clients&tenant_id=' + tenant_id,
        'get_client_profile_data': '/api/klienci?action=get_client_profile_data&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'get_wallet': '/api/klienci?action=get_wallet&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'get_all_deposits': '/api/klienci?action=get_all_deposits&tenant_id=' + tenant_id,
        'get_client_memo': '/api/klienci?action=get_client_memo&tenant_id=' + tenant_id + '&klient=' + encodeURIComponent(req.query.klient || ''),
        'get_suggestion_rules': '/api/klienci?action=get_suggestion_rules&tenant_id=' + tenant_id,
        'get_consents': '/api/rodo?action=get_consents&tenant_id=' + tenant_id + '&id=' + (req.query.id || ''),
        'get_rodo': '/api/rodo?action=get_rodo&tenant_id=' + tenant_id + '&id=' + (req.query.id || ''),
        'get_all_rodo': '/api/rodo?action=get_all_rodo&tenant_id=' + tenant_id,
        'get_retention': '/api/retencja?tenant_id=' + tenant_id,
        'get_months': '/api/analityka?action=get_months&tenant_id=' + tenant_id,
        'an_get_months': '/api/analityka?action=get_months&tenant_id=' + tenant_id,
        'get_daily_summary': '/api/analityka?action=get_daily_summary&tenant_id=' + tenant_id + '&date=' + (req.query.date || ''),
        'an_get_daily_summary': '/api/analityka?action=get_daily_summary&tenant_id=' + tenant_id + '&date=' + (req.query.date || ''),
        'get_costs_list': '/api/analityka?action=get_costs_list&tenant_id=' + tenant_id,
        'an_get_costs_list': '/api/analityka?action=get_costs_list&tenant_id=' + tenant_id,
        'kon_read_results': '/api/konsultacje?action=kon_read_results&tenant_id=' + tenant_id,
        'kon_get_consultants': '/api/konsultacje?action=kon_get_consultants&tenant_id=' + tenant_id + '&onlyActive=' + (req.query.onlyActive || ''),
        'kon_get_logs': '/api/konsultacje?action=kon_get_logs&tenant_id=' + tenant_id,
        'kon_get_campaigns': '/api/konsultacje?action=kon_get_campaigns&tenant_id=' + tenant_id,
        'akon_get_months': '/api/konsultacje?action=akon_get_months&tenant_id=' + tenant_id,
        'get_pin_users': '/api/users?action=get_pin_users&tenant_id=' + tenant_id,
        'get_admin_users': '/api/users?action=get_admin_users&tenant_id=' + tenant_id,
    };

    if (getActions[action]) {
        return res.redirect(getActions[action]);
    }

    return res.json({ status: 'error', message: 'Błąd: Nieznana akcja GET: ' + action });
});

// ==========================================
// POST /api/kontakt — formularz kontaktowy z zamow.html
// ==========================================
app.post('/api/kontakt', async (req, res) => {
  const { imie, email, typ, wiadomosc } = req.body || {};
  if (!imie || !email || !wiadomosc) {
    return res.json({ status: 'error', message: 'Uzupełnij wszystkie wymagane pola.' });
  }
  if (!email.includes('@')) {
    return res.json({ status: 'error', message: 'Nieprawidłowy adres e-mail.' });
  }
  try {
    const { wyslijKontakt } = require('./routes/mailer');
    await wyslijKontakt({
      imie:      String(imie).trim(),
      email:     String(email).trim(),
      typ:       typ === 'klient' ? 'klient' : 'zainteresowany',
      wiadomosc: String(wiadomosc).trim(),
    });
    return res.json({ status: 'success' });
  } catch (err) {
    console.error('[kontakt] błąd wysyłki:', err.message);
    return res.json({ status: 'error', message: 'Błąd wysyłki. Spróbuj napisać bezpośrednio na kontakt@estelio.com.pl.' });
  }
});

// ==========================================
// POST /api - ROUTER KOMPATYBILNOŚCI
// Obsługa starych klientów wysyłających JSON z action
// ==========================================
app.post('/api', (req, res) => {
    const d = req.body || {};
    const action = d.action;

    if (!action) return res.json({ status: 'error', message: 'Brak akcji' });

    // Login nie wymaga tenant_id
    if (action === 'login') {
        req.url = '/login';
        return authRoutes(req, res, () => res.json({ status: 'error', message: 'Nieznana akcja auth' }));
    }

    const tenant_id = d.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Błąd sesji SaaS: Brak przypisanej bazy. Zaloguj się ponownie.' });

    // Mapowanie akcji na route handlery
    const magazynActions = ['update', 'add', 'add_model', 'delete', 'restore', 'edit_product', 'edit_dictionary_entry', 'delete_dictionary_entry'];
    const sprzedazActions = ['add_sale', 'edit_sale', 'delete_sale', 'add_sales_def', 'add_multi_sale', 'emergency_edit_sale', 'add_discount_def', 'delete_employee', 'delete_service', 'edit_service'];
    const klienciActions = ['add_client', 'add_client_fast_sales', 'edit_client_data', 'save_client_memo', 'manage_deposit', 'merge_deposits', 'add_suggestion_rule', 'delete_suggestion_rule'];
    const rodoActions = ['save_rodo', 'update_consents'];
    const urodzinyActions = ['add_birthday', 'update_birthday_status', 'update_birthday_comment', 'update_birthday_field'];
    const retencjaActions = ['save_retention'];
    const analitykaActions = ['get_months', 'an_get_months', 'get_daily_summary', 'an_get_daily_summary', 'get_monthly_details', 'an_get_monthly_details', 'save_monthly_cost', 'an_save_monthly_cost', 'get_costs_list', 'an_get_costs_list', 'get_stats', 'an_get_stats', 'get_yearly_summary', 'an_get_yearly_summary', 'get_treatment_analysis', 'an_get_treatment_analysis', 'get_bi_data', 'an_get_bi_data'];
    const konsultacjeActions = ['kon_save_result', 'kon_update_result', 'kon_add_consultant', 'kon_delete_consultant', 'kon_save_campaign', 'kon_toggle_campaign', 'akon_get_months', 'akon_get_stats', 'akon_get_daily_summary', 'akon_get_monthly_details', 'akon_get_monthly_list', 'akon_get_consultants', 'odp_getReportData'];
    const targetyActions = ['add_target', 'get_targets', 'edit_target', 'tgt_get_employee_dashboard'];
    const raportActions = ['rap_getInventory', 'rap_getCategories', 'rap_getLogs', 'rap_updateStock', 'rap_archiveProduct', 'rap_saveProduct', 'rap_saveCategory', 'rap_deleteCategory'];
    const usersActions = ['verify_pin', 'get_pin_users', 'get_admin_users', 'add_admin_user', 'delete_admin_user'];

    if (magazynActions.includes(action)) {
        req.url = '/magazyn';
        return magazynRoutes(req, res, () => {});
    } else if (sprzedazActions.includes(action)) {
        req.url = '/sprzedaz';
        return sprzedazRoutes(req, res, () => {});
    } else if (klienciActions.includes(action)) {
        req.url = '/klienci';
        return klienciRoutes(req, res, () => {});
    } else if (rodoActions.includes(action)) {
        req.url = '/rodo';
        return rodoRoutes(req, res, () => {});
    } else if (urodzinyActions.includes(action)) {
        req.url = '/urodziny';
        return urodzinyRoutes(req, res, () => {});
    } else if (retencjaActions.includes(action)) {
        req.url = '/retencja';
        return retencjaRoutes(req, res, () => {});
    } else if (analitykaActions.includes(action)) {
        req.url = '/analityka';
        return analitykaRoutes(req, res, () => {});
    } else if (konsultacjeActions.includes(action)) {
        req.url = '/konsultacje';
        return konsultacjeRoutes(req, res, () => {});
    } else if (targetyActions.includes(action)) {
        req.url = '/targety';
        return targetyRoutes(req, res, () => {});
    } else if (raportActions.includes(action)) {
        req.url = '/raport';
        return raportRoutes(req, res, () => {});
    } else if (usersActions.includes(action)) {
        req.url = '/users';
        return usersRoutes(req, res, () => {});
    }

    return res.json({ status: 'error', message: 'Nieznana akcja POST: ' + action });
});

// ==========================================
// HANDLER 404 — nieznane adresy
// API zwraca JSON, strony HTML zwracają branded 404.html
// ==========================================
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ status: 'error', message: 'Nie znaleziono zasobu: ' + req.path });
    }
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ==========================================
// GLOBALNY HANDLER BŁĘDÓW EXPRESS
// Przechwytuje wszystkie nieobsłużone wyjątki z routes i middleware.
// Zamiast HTML 500, zwraca czysty JSON { status: 'error' }.
// ==========================================
app.use((err, req, res, next) => {
    console.error('[SERWER ERROR]', req.method, req.url, '→', err.message);
    if (res.headersSent) return next(err);
    res.status(500).json({
        status: 'error',
        message: 'Nieoczekiwany błąd serwera. Spróbuj ponownie za chwilę.',
    });
});

// Zabezpieczenie przed crashem procesu (Node nie padnie przy nieobsłużonym błędzie)
process.on('uncaughtException', (err) => {
    console.error('[KRYTYCZNY BŁĄD - uncaughtException]:', err.message, '\n', err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[KRYTYCZNY BŁĄD - unhandledRejection]:', reason);
});

// ==========================================
// URUCHOMIENIE SERWERA
// ==========================================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Serwer nasłuchuje na porcie: ${PORT}`);
    console.log(`Otwórz w przeglądarce: http://localhost:${PORT}/test`);
});

// Graceful shutdown — Hostinger/system wysyła SIGTERM przed restartem
// Dajemy czas na dokończenie aktywnych requestów zanim zamkniemy serwer
function gracefulShutdown(signal) {
    console.log(`[${signal}] Zamykanie serwera...`);
    server.close(() => {
        console.log('Serwer HTTP zamknięty. Zamykam pulę DB...');
        db.end(() => {
            console.log('Pula DB zamknięta. Do widzenia.');
            process.exit(0);
        });
    });
    // Wymuszony shutdown po 10s gdyby coś nie chciało się zamknąć
    setTimeout(() => {
        console.error('Wymuszony shutdown po 10s.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
