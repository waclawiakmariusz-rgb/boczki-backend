// Blog (2.11.2026, „ożywienie bloga”): strażnik kolejności tras, wspólnego renderera, spisu treści,
// kotwic, escapowania i spójności kategorii między serwerem, listą i panelem admina.
const fs = require('fs');
const path = require('path');
const KAT = path.join(__dirname, '..');
const BLOG = fs.readFileSync(path.join(KAT, 'routes', 'blog.js'), 'utf8');
const SRV = fs.readFileSync(path.join(KAT, 'server.js'), 'utf8');
const LISTA = fs.readFileSync(path.join(KAT, 'public', 'blog.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(KAT, 'public', 'admin-blog.html'), 'utf8');
const ROBOTS = fs.readFileSync(path.join(KAT, 'public', 'robots.txt'), 'utf8');
const blog = require('../routes/blog');

describe('trasy publiczne', () => {
  test('lista /blog/posts stoi PRZED /blog/:slug (regresja: lista dostawała „Artykuł nie istnieje.”)', () => {
    const lista = BLOG.indexOf("router.get('/blog/posts',");
    const jeden = BLOG.indexOf("router.get('/blog/posts/:slug',");
    const slug = BLOG.indexOf("router.get('/blog/:slug',");
    expect(lista).toBeGreaterThan(-1);
    expect(jeden).toBeGreaterThan(lista);
    expect(slug).toBeGreaterThan(jeden);
  });
  test('server.js nie ma już własnego renderera — używa routes/blog.js; RSS i mapa strony przed /blog/:slug', () => {
    expect(SRV).toContain('const blogModul = require("./routes/blog");');
    expect(SRV).toContain('blogModul.stronaArtykulu(db, slug,');
    expect(SRV).not.toContain('<div class="article-hero">');   // stary, zdublowany szablon zniknął z server.js
    expect(SRV.indexOf('app.get("/blog/rss.xml"')).toBeLessThan(SRV.indexOf('app.get("/blog/:slug"'));
    expect(SRV.indexOf('app.get("/sitemap.xml"')).toBeLessThan(SRV.indexOf('app.get("/blog/:slug"'));
    expect(SRV.indexOf('app.get("/blog/:slug"')).toBeLessThan(SRV.indexOf("app.use(express.static('public'))"));
  });
  test('robots.txt wskazuje mapę strony i chowa panel oraz API', () => {
    expect(ROBOTS).toContain('Sitemap: https://estelio.com.pl/sitemap.xml');
    expect(ROBOTS).toContain('Disallow: /api/');
    expect(ROBOTS).toContain('Disallow: /admin-blog.html');
  });
});

describe('kategorie są jednym zbiorem w trzech miejscach', () => {
  const klucze = Object.keys(blog.CATEGORIES);
  test('serwer ma Terminarz i Dodatki', () => {
    expect(klucze).toEqual(expect.arrayContaining(['Zarządzanie', 'Pracownicy', 'Magazyn', 'Klienci', 'Sprzedaż', 'Terminarz', 'Dodatki']));
  });
  test('lista (blog.html) zna każdą kategorię: mapa CSS, klasa plakietki i tło miniatury', () => {
    for (const k of klucze) {
      const c = blog.CATEGORIES[k];
      expect(LISTA).toContain(`'${k}':`);
      expect(LISTA).toContain(`.${c.css} `);
      expect(LISTA).toContain(`.card-thumb.${c.thumb} `);
    }
  });
  test('panel admina ma każdą kategorię w wyborze', () => {
    for (const k of klucze) expect(ADMIN).toContain(`<option value="${k}">${k}</option>`);
  });
});

describe('przygotujTresc — spis treści i kotwice', () => {
  test('trzy sekcje: identyfikatory z treści nagłówka, kotwica „#”, spis treści z trzema pozycjami', () => {
    const w = blog.przygotujTresc('<p class="lead">x</p><h2>Zanim zaczniesz</h2><p>a</p><h2>Krok po kroku</h2><p>b</p><h2>Co może pójść nie tak?</h2>');
    expect(w.naglowki.map(n => n.id)).toEqual(['zanim-zaczniesz', 'krok-po-kroku', 'co-moze-pojsc-nie-tak']);
    expect(w.html).toContain('<h2 id="zanim-zaczniesz">Zanim zaczniesz <a class="kotwica" href="#zanim-zaczniesz"');
    expect(w.spis).toContain('<nav class="spis"');
    expect((w.spis.match(/<li>/g) || []).length).toBe(3);
  });
  test('dwie sekcje: kotwice tak, spis treści nie', () => {
    const w = blog.przygotujTresc('<h2>Jeden</h2><h2>Dwa</h2>');
    expect(w.spis).toBe('');
    expect(w.html).toContain('class="kotwica"');
  });
  test('powtórzony tytuł sekcji dostaje unikalny identyfikator; własne id zostaje', () => {
    const w = blog.przygotujTresc('<h2>FAQ</h2><h2 id="moje">FAQ</h2><h2>FAQ</h2>');
    expect(w.naglowki.map(n => n.id)).toEqual(['faq', 'moje', 'faq-2']);
  });
  test('nagłówek z tagiem w środku: id z czystego tekstu, treść nagłówka nienaruszona', () => {
    const w = blog.przygotujTresc('<h2>Sprzedaż <em>Mix</em></h2>');
    expect(w.naglowki[0]).toEqual({ id: 'sprzedaz-mix', tekst: 'Sprzedaż Mix' });
    expect(w.html).toContain('>Sprzedaż <em>Mix</em> <a class="kotwica"');
  });
});

describe('renderArticle', () => {
  const wpis = { slug: 'test-wpis', title: 'Tytuł <script>alert(1)</script> & spółka', excerpt: 'Zajawka "w cudzysłowie"', category: 'Sprzedaż',
    content_html: '<p class="lead">Wstęp</p><h2>A</h2><figure><img src="/img/blog/x/01.jpg" alt="Ekran"><figcaption>Podpis</figcaption></figure><h2>B</h2><h2>C</h2>',
    date_published: '2026-11-02', updated_at: '2026-11-02 10:00:00', status: 'published' };
  const html = blog.renderArticle(wpis, { powiazane: [{ slug: 'inny', title: 'Inny <b>wpis</b>', category: 'Klienci' }] });
  test('tytuł i zajawka są escapowane w tytule strony, meta i nagłówku', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Tytuł &lt;script&gt;alert(1)&lt;/script&gt; &amp; spółka — Estelio Blog</title>');
    expect(html).toContain('content="Zajawka &quot;w cudzysłowie&quot;"');
  });
  test('og:image z pierwszego obrazka treści, gdy brak okładki; z okładki, gdy jest', () => {
    expect(html).toContain('<meta property="og:image" content="https://estelio.com.pl/img/blog/x/01.jpg">');
    const z = blog.renderArticle({ ...wpis, okladka: '/img/blog/x/okladka.jpg' });
    expect(z).toContain('<meta property="og:image" content="https://estelio.com.pl/img/blog/x/okladka.jpg">');
    const bez = blog.renderArticle({ ...wpis, content_html: '<p>bez obrazka</p>' });
    expect(bez).toContain('og:image" content="https://estelio.com.pl/img/estelio-logo.png"');
  });
  test('ma pasek udostępniania (kopiuj link, e-mail, WhatsApp, druk), kotwice bez spisu treści, lightbox i powiązane wpisy', () => {
    expect(html).toContain('onclick="kopiujLink()"');
    expect(html).toContain('href="mailto:?subject=');
    expect(html).toContain('https://wa.me/?text=');
    expect(html).toContain('onclick="window.print()"');
    expect(html).not.toContain('<nav class="spis"');   // spis treści celowo nie jest wyświetlany (decyzja usera 2.11)
    expect(html).toContain('class="kotwica"');
    expect(html).toContain('id="lightbox"');
    expect(html).toContain('<div class="powiazane"><h3>Zobacz też</h3>');
    expect(html).toContain('Inny &lt;b&gt;wpis&lt;/b&gt;');
    expect(html).toContain('<link rel="canonical" href="https://estelio.com.pl/blog/test-wpis">');
  });
  test('bez „N min czytania” w nagłówku (decyzja usera 2.11)', () => { expect(html).not.toMatch(/min czytania/); });
  test('podgląd szkicu: noindex i pasek ostrzegawczy; publiczny: index', () => {
    const p = blog.renderArticle({ ...wpis, status: 'draft' }, { podglad: true });
    expect(p).toContain('content="noindex, nofollow"');
    expect(p).toContain('class="podglad-pasek"');
    expect(html).toContain('content="index, follow"');
    expect(html).not.toContain('class="podglad-pasek"');
  });
  test('czas czytania liczy słowa i zrzuty (pół minuty na obrazek), minimum 1 minuta', () => {
    expect(blog.readTime('<p>' + 'słowo '.repeat(400) + '</p>')).toBe(2);
    expect(blog.readTime('<p>' + 'słowo '.repeat(400) + '</p>' + '<img src="a">'.repeat(4))).toBe(4);
    expect(blog.readTime('')).toBe(1);
  });
});

describe('panel admina', () => {
  test('okładka: pole, odczyt przy edycji, zapis w payloadzie; podgląd szkicu przez blob; link do wpisu i kopiowanie', () => {
    expect(ADMIN).toContain('id="f-okladka"');
    expect(ADMIN).toContain("document.getElementById('f-okladka').value  = p.okladka || '';");
    expect(ADMIN).toContain("okladka:      document.getElementById('f-okladka').value.trim() || null,");
    expect(ADMIN).toContain('/api/admin/blog/podglad/');
    expect(ADMIN).toContain('onclick="podgladPost()"');
    expect(ADMIN).toContain('Kopiuj link');
    expect(BLOG).toContain("router.get('/admin/blog/podglad/:id', requireAdmin,");
    expect(BLOG).toContain('okladka || okladkaZWideo(content_html) || null');   // 9.11: pusta okładka → miniatura filmu z treści
  });
  test('publikacja jednym kliknięciem z listy: PATCH statusu na serwerze i przyciski Publikuj / Cofnij do szkicu w panelu', () => {
    expect(BLOG).toContain("router.patch('/admin/blog/posts/:id/status', requireAdmin,");
    expect(ADMIN).toContain("zmienStatus(${p.id}, 'published')");
    expect(ADMIN).toContain("zmienStatus(${p.id}, 'draft')");
    expect(ADMIN).toContain("method: 'PATCH'");
  });
  test('lista publiczna nie ma już trzech zaszytych na sztywno kart udających działające API', () => {
    expect(LISTA).not.toContain('href="/blog/jak-estelio-oszczedza-czas.html"');
    expect(LISTA).toContain('Nie udało się wczytać wpisów.');
    expect(LISTA).toContain('id="szukaj"');
    expect(LISTA).toContain('id="chipy"');
  });
});
