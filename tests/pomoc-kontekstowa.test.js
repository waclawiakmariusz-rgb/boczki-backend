// Pomoc kontekstowa — komponent „?" i katalog treści (specyfikacja z 22.10.2026).
//
// Czego pilnują te próby: katalog ma być KRÓTKI, kompletny i bezpieczny, a komponent nie może
// stać się furtką do wstrzyknięcia treści ani kanałem wysyłania czegokolwiek na zewnątrz.
// Rozdz. 13 specyfikacji wymaga próby wykrywającej brak wpisu, zły format, zbyt długi tekst,
// brak kotwicy i nieużywane klucze — i to jest ten plik.
//
// RODZAJ PRÓB: statyczna analiza katalogu, komponentu i miejsc podpięcia. Zachowanie na żywo
// (klawiatura, pozycjonowanie, nienaruszalność formularza) sprawdzone w izolowanym środowisku:
// docs/Estelio_Pomoc_Kontekstowa_2026-10-22/RAPORT_P02.md
const fs = require('fs');
const path = require('path');

const KORZEN = path.join(__dirname, '..');
const KATALOG = JSON.parse(fs.readFileSync(path.join(KORZEN, 'public', 'pomoc-tresci.json'), 'utf8'));
const JS = fs.readFileSync(path.join(KORZEN, 'public', 'pomoc-kontekstowa.js'), 'utf8');
const CSS = fs.readFileSync(path.join(KORZEN, 'public', 'pomoc-kontekstowa.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(KORZEN, 'public', 'index.html'), 'utf8');
const POMOC_F = fs.readFileSync(path.join(KORZEN, 'public', 'estelio_pomoc_f.html'), 'utf8');
const { sprawdzKatalog } = require('../narzedzia/pomoc-mapa-widokow');

const wpisy = Object.entries(KATALOG.konteksty || {});

describe('katalog treści', () => {
  test('generator nie zgłasza usterek formatu', () => {
    expect(sprawdzKatalog()).toEqual([]);
  });

  test('każdy wpis ma źródła i stan sprawdzenia', () => {
    for (const [id, w] of wpisy) {
      expect(Array.isArray(w.sources) && w.sources.length).toBeTruthy();
      expect(['draft', 'verified', 'needs-resolution']).toContain(w.reviewStatus);
      if (w.reviewStatus === 'verified') expect(w.verifiedAgainst).toBeTruthy();
    }
  });

  test('tekst mieści się w limitach z rozdziału 5 (tytuł 55 znaków, całość 80 słów)', () => {
    for (const [id, w] of wpisy) {
      expect(`${id}: ${w.title.length}`).toBe(`${id}: ${Math.min(w.title.length, 55)}`);
      const slowa = `${w.body || ''} ${(w.items || []).map(x => x.text).join(' ')} ${w.tip || ''}`.trim().split(/\s+/).filter(Boolean).length;
      expect(`${id}: ${slowa} słów`).toBe(`${id}: ${Math.min(slowa, 80)} słów`);
      expect((w.items || []).length).toBeLessThanOrEqual(3);
    }
  });

  test('linki prowadzą do naszych stron pomocy i do ISTNIEJĄCEJ kotwicy', () => {
    for (const [id, w] of wpisy) {
      if (!w.article) continue;
      expect(w.article.href).toMatch(/^\/pomoc/);
      if (w.article.anchor && w.article.href === '/pomoc/') {
        // kotwica musi naprawdę być w dokumencie, a nie tylko dobrze wyglądać
        expect(`${id} → #${w.article.anchor}`).toBe(
          POMOC_F.includes(`id="${w.article.anchor}"`) ? `${id} → #${w.article.anchor}` : `${id} → kotwica nie istnieje w /pomoc/`);
      }
    }
  });

  test('katalog nie zawiera danych osobowych ani kwot z rekordów', () => {
    const tekst = wpisy.map(([, w]) => `${w.title} ${w.body || ''} ${(w.items || []).map(x => x.text).join(' ')} ${w.tip || ''}`).join(' ');
    expect(tekst).not.toMatch(/\d{3}[ -]?\d{3}[ -]?\d{3}/);     // telefon
    expect(tekst).not.toMatch(/\d+[.,]\d{2}\s*(zł|PLN)/i);       // kwota z paragonu
    expect(tekst).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);       // adres e-mail
  });
});

describe('komponent', () => {
  test('nie wstrzykuje treści katalogu jako HTML', () => {
    // innerHTML wolno użyć TYLKO do własnych ikon SVG ze stałej IKONY
    const miejsca = JS.match(/\.innerHTML\s*=\s*([^;]+);/g) || [];
    for (const m of miejsca) expect(m).toMatch(/IKONY/);
  });

  test('przepuszcza tylko własne adresy pomocy', () => {
    expect(JS).toMatch(/var DOZWOLONE = \[/);
    expect(JS).toMatch(/function bezpiecznyLink/);
    expect(JS).toMatch(/rel = 'noopener noreferrer'/);
  });

  test('nic nie wysyła poza wczytaniem katalogu', () => {
    const fetche = JS.match(/fetch\(/g) || [];
    expect(fetche).toHaveLength(1);
    expect(JS).toMatch(/fetch\(adres, \{ cache: 'no-cache' \}\)/);
    expect(JS).not.toMatch(/method:\s*'POST'/);
  });

  test('otwarcie pomocy nie rusza formularza', () => {
    const klik = JS.slice(JS.indexOf("btn.addEventListener('click'"), JS.indexOf("btn.addEventListener('mouseenter'"));
    expect(klik).toMatch(/ev\.preventDefault\(\)/);
    expect(klik).toMatch(/ev\.stopPropagation\(\)/);
    expect(JS).toMatch(/btn\.type = 'button'/);
  });

  test('Esc zamyka najpierw pomoc, nie formularz pod spodem', () => {
    const esc = JS.slice(JS.indexOf('function naKlawisz'), JS.indexOf('function naKlikPoza'));
    expect(esc).toMatch(/ev\.stopPropagation\(\)/);
    expect(esc).toMatch(/zamknij\(true\)/);                      // fokus wraca na przycisk
  });

  test('chmurka to niemodalny dialog, nie tooltip', () => {
    expect(JS).toMatch(/setAttribute\('role', 'dialog'\)/);
    expect(JS).not.toMatch(/aria-modal/);
    expect(JS).toMatch(/setAttribute\('aria-labelledby'/);
    expect(JS).toMatch(/setAttribute\('aria-expanded'/);
  });

  test('jedna otwarta chmurka w całej aplikacji', () => {
    const otw = JS.slice(JS.indexOf('function otworz('), JS.indexOf('function pokazTooltip'));
    expect(otw).toMatch(/zamknij\(false\)/);                     // najpierw zamknij poprzednią
  });

  test('brak wpisu nie wywala widoku — jest uczciwy stan zastępczy', () => {
    expect(JS).toMatch(/Instrukcja w przygotowaniu/);
    expect(JS).toMatch(/catch\(function \(\) \{ KATALOG = \{ konteksty: \{\} \}/);
  });
});

describe('wygląd zgodny ze specyfikacją (rozdz. 7)', () => {
  const regula = (sel) => { const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(CSS); return m ? m[1] : ''; };

  test('przycisk: pole 44 px, koło 36 px, znak „?" w kolorze #842D49', () => {
    expect(regula('.pk-btn')).toMatch(/width:44px;\s*height:44px/);
    const przed = regula('.pk-btn::before');
    expect(przed).toMatch(/width:36px;\s*height:36px/);
    expect(przed).toMatch(/content:'\?'/);
    expect(przed).toMatch(/color:#842D49/);
    expect(przed).toMatch(/background:#F8EDF1/);
  });

  test('chmurka: 360 px WRAZ z paddingiem', () => {
    const k = regula('.pk-karta');
    expect(k).toMatch(/box-sizing:border-box/);                  // bez tego wychodziło 402 px
    expect(k).toMatch(/width:360px/);
    expect(k).toMatch(/max-width:calc\(100vw - 24px\)/);
    expect(k).toMatch(/padding:20px/);
    expect(k).toMatch(/border-radius:16px/);
  });

  test('brak animacji przy ograniczonej animacji systemu', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe('podpięcie w aplikacji', () => {
  test('pliki wczytywane ze znacznikiem wersji wdrożenia', () => {
    expect(INDEX).toMatch(/pomoc-kontekstowa\.css\?v=__WERSJA_PLIKOW__/);
    expect(INDEX).toMatch(/pomoc-kontekstowa\.js\?v=__WERSJA_PLIKOW__/);
  });

  test('trzy miejsca pilotażu mają slot', () => {
    for (const ctx of ['magazyn.stan', 'magazyn.pro.produkt.nowy', 'klient.profil.podsumowanie']) {
      expect(INDEX).toContain(`data-pomoc="${ctx}"`);
    }
  });

  test('zmiana zakładki profilu przestawia kontekst i zamyka starą chmurkę', () => {
    const fn = INDEX.slice(INDEX.indexOf('function przelaczTabProfilu'), INDEX.indexOf('function przelaczTabProfilu') + 1400);
    expect(fn).toMatch(/pk-profil-slot/);
    expect(fn).toMatch(/POMOC\.zamknij\(\)/);
    expect(fn).toMatch(/setAttribute\('data-pomoc', 'klient\.profil\.' \+ tabId\)/);
  });

  test('każdy użyty w aplikacji kontekst ma wpis albo świadomego rodzica', () => {
    const uzyte = [...INDEX.matchAll(/data-pomoc="([a-z0-9.]+)"/g)].map(m => m[1]);
    expect(uzyte.length).toBeGreaterThan(0);
    for (const ctx of uzyte) {
      const czesci = ctx.split('.');
      let ok = false;
      while (czesci.length && !ok) { if (KATALOG.konteksty[czesci.join('.')]) ok = true; else czesci.pop(); }
      expect(`${ctx}: ${ok ? 'ma pomoc' : 'OSIEROCONY'}`).toBe(`${ctx}: ma pomoc`);
    }
  });

  test('nie ma nieużywanych kluczy katalogu bez roli nadrzędnej', () => {
    const uzyte = new Set([...INDEX.matchAll(/data-pomoc="([a-z0-9.]+)"/g)].map(m => m[1]));
    for (const [id] of wpisy) {
      const jestUzyty = uzyte.has(id) || [...uzyte].some(u => u.startsWith(id + '.'));
      expect(`${id}: ${jestUzyty ? 'używany' : 'MARTWY KLUCZ'}`).toBe(`${id}: używany`);
    }
  });
});
