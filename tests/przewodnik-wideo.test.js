// Przewodnik wideo (9.11.2026, docs/przewodnik-wideo/PLAN_2026-11-09.md): kategoria „Przewodnik”, osadzanie filmów
// z kanału YouTube Estelio w treści wpisu (zero zmian w bazie), strona /przewodnik, linki w menu, pole w edytorze.
const fs = require('fs');
const path = require('path');
const KAT = path.join(__dirname, '..');
const czytaj = (...p) => fs.readFileSync(path.join(KAT, ...p), 'utf8');
const BLOG = czytaj('routes', 'blog.js');
const SRV = czytaj('server.js');
const LISTA = czytaj('public', 'blog.html');
const ADMIN = czytaj('public', 'admin-blog.html');
const PRZEW = czytaj('public', 'przewodnik.html');
const ZAMOW = czytaj('public', 'zamow.html');
const blog = require('../routes/blog');

const ID = 'dQw4w9WgXcQ';

describe('youtubeId — identyfikator filmu z adresu w dowolnej postaci', () => {
  test.each([
    ['https://www.youtube.com/watch?v=' + ID],
    ['https://youtube.com/watch?v=' + ID + '&list=PLabc&index=2'],
    ['https://m.youtube.com/watch?v=' + ID],
    ['https://youtu.be/' + ID],
    ['https://youtu.be/' + ID + '?t=30'],
    ['https://www.youtube.com/shorts/' + ID],
    ['https://www.youtube.com/embed/' + ID],
    ['https://www.youtube-nocookie.com/embed/' + ID + '?rel=0'],
    ['https://www.youtube.com/live/' + ID],
    ['youtube.com/watch?v=' + ID],
    ['  ' + ID + '  '],
  ])('rozpoznaje %s', (adres) => { expect(blog.youtubeId(adres)).toBe(ID); });
  test.each([
    ['https://www.youtube.com/@EstelioSystem'],   // kanał, nie film
    ['https://www.youtube.com/playlist?list=PLabc'],
    ['https://vimeo.com/123456'],
    ['https://example.com/watch?v=' + ID],        // inna domena z parametrem v
    ['https://www.youtube.com/watch?v=zaKrotki'],
    [''], [null], [undefined], ['<script>alert(1)</script>'],
  ])('odrzuca %s', (adres) => { expect(blog.youtubeId(adres)).toBeNull(); });
});

describe('osadzenieYoutube i miniatura', () => {
  test('odtwarzacz: domena bez ciasteczek, lazy, pełny ekran, tytuł escapowany, ramka .wideo', () => {
    const h = blog.osadzenieYoutube('https://youtu.be/' + ID, 'Tytuł <b>&</b>');
    expect(h.startsWith('<div class="wideo"><iframe src="https://www.youtube-nocookie.com/embed/' + ID + '"')).toBe(true);
    expect(h).toContain('title="Tytuł &lt;b&gt;&amp;&lt;/b&gt;"');
    expect(h).toContain('loading="lazy"');
    expect(h).toContain('allowfullscreen');
    expect(h).not.toContain('youtube.com/embed/');   // tylko nocookie
  });
  test('nierozpoznany adres → pusty napis (nic nie wstawiamy do treści)', () => {
    expect(blog.osadzenieYoutube('https://vimeo.com/1')).toBe('');
    expect(blog.osadzenieYoutube('')).toBe('');
  });
  test('pierwszeWideo czyta identyfikator z iframe w treści (także zwykłej domeny youtube.com), miniatura z i.ytimg.com', () => {
    expect(blog.pierwszeWideo('<p>x</p>' + blog.osadzenieYoutube(ID))).toBe(ID);
    expect(blog.pierwszeWideo('<iframe src="https://www.youtube.com/embed/' + ID + '?rel=0"></iframe>')).toBe(ID);
    expect(blog.pierwszeWideo('<iframe src="https://player.vimeo.com/video/1"></iframe>')).toBeNull();
    expect(blog.pierwszeWideo('<p>bez filmu</p>')).toBeNull();
    expect(blog.miniaturaYoutube(ID)).toBe('https://i.ytimg.com/vi/' + ID + '/hqdefault.jpg');
    expect(blog.miniaturaYoutube(null)).toBeNull();
  });
});

describe('renderArticle dla wpisu z filmem', () => {
  const wpis = { slug: '1-pierwsze-logowanie', title: '1. Pierwsze logowanie', excerpt: 'Jak wejść do systemu.', category: 'Przewodnik',
    content_html: blog.osadzenieYoutube(ID, '1. Pierwsze logowanie') + '<p>W tym odcinku…</p>', date_published: '2026-11-09', status: 'published' };
  const html = blog.renderArticle(wpis);
  test('og:image i twitter:image z miniatury YouTube, gdy wpis nie ma okładki ani obrazka', () => {
    expect(html).toContain('<meta property="og:image" content="https://i.ytimg.com/vi/' + ID + '/hqdefault.jpg">');
    expect(html).toContain('<meta name="twitter:image" content="https://i.ytimg.com/vi/' + ID + '/hqdefault.jpg">');
  });
  test('własna okładka ma pierwszeństwo przed miniaturą filmu', () => {
    expect(blog.renderArticle({ ...wpis, okladka: '/img/blog/x/okladka.jpg' })).toContain('og:image" content="https://estelio.com.pl/img/blog/x/okladka.jpg"');
  });
  test('JSON-LD VideoObject z embedUrl bez ciasteczek i contentUrl do YouTube; zwykły wpis go nie ma', () => {
    expect(html).toContain('"@type":"VideoObject"');
    expect(html).toContain('"embedUrl":"https://www.youtube-nocookie.com/embed/' + ID + '"');
    expect(html).toContain('"contentUrl":"https://www.youtube.com/watch?v=' + ID + '"');
    expect(html).toContain('"uploadDate":"2026-11-09"');
    const zwykly = blog.renderArticle({ slug: 'z', title: 'Z', category: 'Sprzedaż', content_html: '<p>a</p>', date_published: '2026-11-09' });
    expect(zwykly).not.toContain('VideoObject');
  });
  test('styl ramki 16:9 i odtwarzacz w treści', () => {
    expect(html).toContain('.article-content .wideo { position: relative; aspect-ratio: 16 / 9;');
    expect(html).toContain('<div class="article-content"><div class="wideo"><iframe src="https://www.youtube-nocookie.com/embed/' + ID + '"');
  });
  test('kategoria Przewodnik wraca do /przewodnik (menu, okruszki, „Wróć do przewodnika”); inne kategorie do bloga', () => {
    expect(html).toContain('<a href="/przewodnik">← Przewodnik</a>');
    expect(html).toContain('<div class="okruszki"><a href="/przewodnik">Przewodnik wideo</a> &nbsp;›&nbsp; Odcinek 1</div>');
    expect(blog.renderArticle({ ...wpis, title: 'Bez numeru' })).toContain('<div class="okruszki"><a href="/przewodnik">Przewodnik wideo</a></div>');
    expect(html).toContain('<a href="/przewodnik">Przewodnik wideo</a>\n    <a href="/pomoc/">Pomoc</a>');   // stopka artykułu
    expect(html).toContain('<a class="back-link" href="/przewodnik">← Wróć do przewodnika</a>');
    const zwykly = blog.renderArticle({ slug: 'z', title: 'Z', category: 'Sprzedaż', content_html: '<p>a</p>', date_published: '2026-11-09' });
    expect(zwykly).toContain('<a href="/blog.html">← Blog</a>');
    expect(zwykly).toContain('<div class="okruszki"><a href="/blog.html">Blog</a> &nbsp;›&nbsp; Sprzedaż</div>');
    expect(zwykly).toContain('<a class="back-link" href="/blog.html">← Wróć do bloga</a>');
  });
});

describe('nagłówki bezpieczeństwa przepuszczają odtwarzacz i miniatury (regresja: szara ramka z 9.11)', () => {
  const naglowki = require('../routes/naglowki-bezpieczenstwa');
  test('CSP: frame-src z youtube-nocookie.com (i youtube.com), img-src z i.ytimg.com; nadal bez gwiazdek', () => {
    expect(naglowki.CSP).toContain("frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com");
    expect(naglowki.CSP).toMatch(/img-src [^;]*https:\/\/i\.ytimg\.com/);
    expect(naglowki.CSP).not.toMatch(/\*/);
  });
});

describe('serwer: kategoria, okładka z filmu przy zapisie, mapa strony, trasa', () => {
  test('CATEGORIES ma Przewodnik z klasami cat-przewodnik / przewodnik', () => {
    expect(blog.CATEGORIES['Przewodnik']).toEqual({ css: 'cat-przewodnik', thumb: 'przewodnik', emoji: '▶️' });
  });
  test('POST i PUT: pusta okładka → miniatura pierwszego filmu z treści (okladkaZWideo), własna okładka bez zmian', () => {
    expect((BLOG.match(/okladka \|\| okladkaZWideo\(content_html\) \|\| null/g) || []).length).toBe(2);
    expect(BLOG).toContain('function okladkaZWideo(html) { return miniaturaYoutube(pierwszeWideo(html)); }');
  });
  test('/przewodnik/ w mapie strony; server.js serwuje public/przewodnik.html pod /przewodnik przed express.static', () => {
    expect(BLOG).toContain("'/przewodnik/'");
    const trasa = SRV.indexOf("app.get(['/przewodnik', '/przewodnik/']");
    expect(trasa).toBeGreaterThan(-1);
    expect(SRV.slice(trasa, trasa + 200)).toContain("'przewodnik.html'");
    expect(trasa).toBeLessThan(SRV.indexOf("app.use(express.static('public'))"));
  });
});

describe('strona /przewodnik (public/przewodnik.html)', () => {
  test('pobiera wpisy z API bloga, filtruje kategorię Przewodnik, sortuje po numerze z tytułu, ma link do kanału i stan pusty', () => {
    expect(PRZEW).toContain("fetch('/api/blog/posts')");
    expect(PRZEW).toContain("const KATEGORIA = 'Przewodnik';");
    expect(PRZEW).toContain('function numerZTytulu(t)');
    expect(PRZEW).toContain('.sort(porownaj)');
    expect(PRZEW).toContain('href="https://www.youtube.com/@EstelioSystem"');
    expect(PRZEW).toContain('Pierwsze odcinki są w przygotowaniu.');
    expect(PRZEW).toContain('<link rel="canonical" href="https://estelio.com.pl/przewodnik">');
  });
  test('ma tę samą oprawę co blog (hero, siatka kart, stopka, menu mobilne) i link do bloga zamiast do siebie', () => {
    expect(PRZEW).toContain('class="blog-hero"');
    expect(PRZEW).toContain('id="blog-grid"');
    expect(PRZEW).toContain('function toggleMenu()');
    expect(PRZEW).toContain('<li><a href="/blog.html">Blog</a></li>');
    expect(PRZEW).not.toContain('<li><a href="/przewodnik">Przewodnik wideo</a></li>');
  });
});

describe('lista bloga, strona główna i panel admina znają Przewodnik', () => {
  test('blog.html: mapa kategorii, plakietka, tło miniatury, „Obejrzyj →” dla filmów, link w menu / menu mobilnym / stopce', () => {
    expect(LISTA).toContain("'Przewodnik':  { css: 'cat-przewodnik',  thumb: 'przewodnik' }");
    expect(LISTA).toContain('.cat-przewodnik ');
    expect(LISTA).toContain('.card-thumb.przewodnik ');
    expect(LISTA).toContain("${p.category === 'Przewodnik' ? 'Obejrzyj' : 'Czytaj'} →");
    expect((LISTA.match(/href="\/przewodnik"/g) || []).length).toBe(3);
  });
  test('zamow.html: link „Przewodnik” w menu, menu mobilnym i stopce', () => {
    expect((ZAMOW.match(/<a href="\/przewodnik">Przewodnik<\/a>/g) || []).length).toBe(3);
  });
  test('admin-blog.html: opcja Przewodnik, pole adresu filmu, przycisk „Wstaw odtwarzacz”, ten sam parser co serwer, odtwarzacz bez ciasteczek, miniatura do pustej okładki', () => {
    expect(ADMIN).toContain('<option value="Przewodnik">Przewodnik</option>');
    expect(ADMIN).toContain('id="f-youtube"');
    expect(ADMIN).toContain('onclick="wstawWideo()"');
    expect(ADMIN).toContain("document.getElementById('f-youtube').value = '';");
    expect(ADMIN).toContain("if (host === 'youtu.be')");
    expect(ADMIN).toContain('https://www.youtube-nocookie.com/embed/');
    expect(ADMIN).toContain("okl.value = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'");
    expect(ADMIN).toContain('https://www.youtube.com/@EstelioSystem');
  });
  test('parser w panelu daje te same wyniki co serwerowy youtubeId (wycinek funkcji uruchomiony osobno)', () => {
    const m = /function youtubeId\(adres\) \{[\s\S]*?\n\}/.exec(ADMIN);
    expect(m).not.toBeNull();
    const fn = new Function(m[0] + '; return youtubeId;')();
    for (const a of ['https://youtu.be/' + ID + '?t=5', 'https://www.youtube.com/watch?v=' + ID, 'https://www.youtube.com/shorts/' + ID, ID, 'https://www.youtube.com/@EstelioSystem', 'https://vimeo.com/1', '']) {
      expect(fn(a)).toBe(blog.youtubeId(a));
    }
  });
});
