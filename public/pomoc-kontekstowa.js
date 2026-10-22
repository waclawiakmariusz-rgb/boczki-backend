/* ============================================================================
   POMOC KONTEKSTOWA — wspólny komponent „?" (22.10.2026)
   Specyfikacja: docs/Estelio_Pomoc_Kontekstowa_2026-10-22/WDROZENIE_DLA_CLAUDE.md

   Zasady, które ten plik realizuje (i których nie wolno obejść przy zmianach):
   • treści są GOTOWE w katalogu pomoc-tresci.json — przy kliknięciu nic się nie generuje
     i nic nie wychodzi z przeglądarki; żadne dane klientek nie opuszczają aplikacji,
   • komponent niczego nie zapisuje, nie wysyła formularza i nie rusza jego stanu,
   • w całej aplikacji jest najwyżej JEDNA otwarta chmurka,
   • treść renderujemy tekstem (textContent), nigdy przez innerHTML z katalogu,
   • linki tylko do własnych stron pomocy z listy dozwolonych adresów,
   • gdy pomocy nie ma albo katalog się nie wczyta — aplikacja działa dalej,
     a chmurka mówi uczciwie, że instrukcja jest w przygotowaniu.
   ========================================================================== */
(function () {
  'use strict';
  if (window.POMOC) return;

  var KATALOG = null;          // wczytany raz, przy pierwszym otwarciu
  var ladowanie = null;        // obietnica w locie (żeby nie pobierać dwa razy)
  var otwarta = null;          // { ctx, btn, karta, grot }
  var tooltip = null, tooltipT = null, tooltipBtn = null;

  // Adresy, pod które wolno puścić użytkownika z chmurki. Wszystko inne jest
  // ignorowane — katalog treści nie może stać się wektorem na obcą stronę.
  var DOZWOLONE = ['/pomoc/', '/pomoc-manager/', '/pomoc-terminarz/', '/pomoc-maile', '/przewodnik-klienta'];

  var IKONY = {
    i: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    uwaga: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    lista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    stan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    alarm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    kalendarz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
    osoba: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    szukaj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };

  function el(tag, klasa) { var e = document.createElement(tag); if (klasa) e.className = klasa; return e; }

  // ── katalog treści ──────────────────────────────────────────────────────
  function wczytaj() {
    if (KATALOG) return Promise.resolve(KATALOG);
    if (ladowanie) return ladowanie;
    var adres = (window.POMOC_KATALOG_URL || '/pomoc-tresci.json');
    ladowanie = fetch(adres, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { KATALOG = (d && d.konteksty) ? d : { konteksty: {} }; return KATALOG; })
      .catch(function () { KATALOG = { konteksty: {} }; return KATALOG; });
    return ladowanie;
  }

  /** Wpis dla kontekstu; gdy go nie ma — wpis nadrzędny, jawnie oznaczony jako ogólny. */
  function znajdz(ctx) {
    var k = (KATALOG && KATALOG.konteksty) || {};
    if (k[ctx]) return { wpis: k[ctx], ogolny: false };
    var czesci = String(ctx || '').split('.');
    while (czesci.length > 1) {
      czesci.pop();
      var rodzic = czesci.join('.');
      if (k[rodzic]) return { wpis: k[rodzic], ogolny: true };
    }
    return { wpis: null, ogolny: false };
  }

  /** Czy wskazówka/pozycja jest dostępna dla tej roli i tego salonu. */
  function dostepne(war) {
    if (!war) return true;
    if (war.rola) {
      var rola = String(localStorage.getItem('boczki_pracownik_rola') || '').toLowerCase();
      var role = [].concat(war.rola).map(function (x) { return String(x).toLowerCase(); });
      if (role.indexOf(rola) === -1) return false;
    }
    if (war.dodatek) {
      var f = [];
      try { f = JSON.parse(localStorage.getItem('boczki_features') || '[]') || []; } catch (e) { f = []; }
      if (f.indexOf(war.dodatek) === -1) return false;
    }
    return true;
  }

  function bezpiecznyLink(a) {
    if (!a || !a.href) return null;
    var href = String(a.href);
    var ok = DOZWOLONE.some(function (p) { return href === p || href.indexOf(p) === 0; });
    if (!ok) return null;                       // cichy brak linku jest lepszy niż fałszywy
    return { label: a.label || 'Pełna instrukcja', href: href + (a.anchor ? '#' + a.anchor : '') };
  }

  // ── budowa chmurki ──────────────────────────────────────────────────────
  function zbuduj(ctx) {
    var w = znajdz(ctx), wpis = w.wpis;
    var karta = el('div', 'pk-karta');
    karta.setAttribute('role', 'dialog');
    karta.setAttribute('tabindex', '-1');
    karta.id = 'pk-karta-' + Math.random().toString(36).slice(2, 8);

    var gora = el('div', 'pk-gora');
    var etykieta = el('div', 'pk-etykieta');
    etykieta.textContent = 'Pomoc' + (wpis && wpis.eyebrow ? ' • ' + wpis.eyebrow : '');
    var x = el('button', 'pk-x');
    x.type = 'button'; x.innerHTML = IKONY.x;
    x.setAttribute('aria-label', 'Zamknij pomoc');
    x.addEventListener('click', function () { zamknij(true); });
    gora.appendChild(etykieta); gora.appendChild(x);
    karta.appendChild(gora);

    var tytul = el('h2', 'pk-tytul');
    tytul.id = karta.id + '-t';
    karta.setAttribute('aria-labelledby', tytul.id);

    if (!wpis) {
      tytul.textContent = 'Instrukcja w przygotowaniu';
      karta.appendChild(tytul);
      var brak = el('p', 'pk-brak');
      brak.textContent = 'Opis tego widoku jeszcze powstaje. Nie zgadujemy, co robią przyciski — wolimy nic nie napisać niż napisać nieprawdę.';
      karta.appendChild(brak);
      var spis = bezpiecznyLink({ href: '/pomoc/', label: 'Spis instrukcji' });
      if (spis) karta.appendChild(stopka(spis));
      return karta;
    }

    tytul.textContent = w.ogolny && wpis.titleOgolny ? wpis.titleOgolny : (wpis.title || '');
    karta.appendChild(tytul);

    if (wpis.body) { var p = el('p', 'pk-opis'); p.textContent = wpis.body; karta.appendChild(p); }

    var items = (wpis.items || []).filter(function (it) { return dostepne(it.availability); }).slice(0, 3);
    if (items.length) {
      var ul = el('ul', 'pk-lista');
      items.forEach(function (it) {
        var li = el('li');
        var ik = el('span', 'pk-ikona'); ik.setAttribute('aria-hidden', 'true');
        ik.innerHTML = IKONY[it.icon] || IKONY.i;
        var tx = el('span'); tx.textContent = it.text || '';
        li.appendChild(ik); li.appendChild(tx); ul.appendChild(li);
      });
      karta.appendChild(ul);
    }

    if (wpis.tip && dostepne(wpis.tipAvailability)) {
      var ws = el('div', 'pk-wskazowka');
      var ikw = el('span'); ikw.setAttribute('aria-hidden', 'true');
      ikw.innerHTML = wpis.tipTyp === 'ostrzezenie' ? IKONY.uwaga : IKONY.i;
      var tw = el('span'); tw.textContent = wpis.tip;
      ws.appendChild(ikw); ws.appendChild(tw);
      karta.appendChild(ws);
    }

    var link = bezpiecznyLink(wpis.article);
    if (link) karta.appendChild(stopka(link, w.ogolny));
    return karta;
  }

  function stopka(link, ogolny) {
    var s = el('div', 'pk-stopka');
    var a = el('a', 'pk-link');
    a.href = link.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    var tekst = el('span'); tekst.textContent = link.label;
    var ik = el('span'); ik.setAttribute('aria-hidden', 'true'); ik.innerHTML = IKONY.link;
    a.appendChild(tekst); a.appendChild(ik);
    s.appendChild(a);
    var podpis = el('p', 'pk-podpis');
    podpis.textContent = ogolny ? 'Otwiera szerszy rozdział instrukcji w nowej karcie.' : 'Otwiera instrukcję w nowej karcie.';
    s.appendChild(podpis);
    return s;
  }

  // ── pozycjonowanie ──────────────────────────────────────────────────────
  // Preferowane: pod przyciskiem, wyrównanie do jego prawej krawędzi, 8 px odstępu,
  // 12 px marginesu od krawędzi ekranu. Brak miejsca → nad przyciskiem.
  function ustaw(karta, grot, btn) {
    var r = btn.getBoundingClientRect();
    var sz = karta.offsetWidth, wys = karta.offsetHeight;
    var W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
    var ODSTEP = 8, MARGINES = 12;

    var gora = r.bottom + ODSTEP, naDole = true;
    if (gora + wys > H - MARGINES && r.top - ODSTEP - wys > MARGINES) { gora = r.top - ODSTEP - wys; naDole = false; }
    gora = Math.max(MARGINES, Math.min(gora, H - wys - MARGINES));

    var lewo = r.right - sz;
    lewo = Math.max(MARGINES, Math.min(lewo, W - sz - MARGINES));

    karta.style.top = Math.round(gora) + 'px';
    karta.style.left = Math.round(lewo) + 'px';

    // grot tylko wtedy, gdy naprawdę wskazuje przycisk
    var srodek = r.left + r.width / 2;
    var pasuje = srodek > lewo + 14 && srodek < lewo + sz - 14 &&
      (naDole ? Math.abs(gora - (r.bottom + ODSTEP)) < 1 : Math.abs(gora + wys - (r.top - ODSTEP)) < 1);
    grot.style.display = pasuje ? 'block' : 'none';
    if (pasuje) {
      grot.className = 'pk-grot' + (naDole ? '' : ' pk-dol');
      grot.style.left = Math.round(srodek - 7) + 'px';
      grot.style.top = Math.round(naDole ? gora - 7 : gora + wys - 7) + 'px';
    }
  }

  // ── otwieranie i zamykanie ──────────────────────────────────────────────
  function zamknij(wrocFokus) {
    if (!otwarta) return;
    var btn = otwarta.btn;
    if (otwarta.karta && otwarta.karta.parentNode) otwarta.karta.parentNode.removeChild(otwarta.karta);
    if (otwarta.grot && otwarta.grot.parentNode) otwarta.grot.parentNode.removeChild(otwarta.grot);
    if (btn) btn.setAttribute('aria-expanded', 'false');
    otwarta = null;
    document.removeEventListener('keydown', naKlawisz, true);
    window.removeEventListener('scroll', przelicz, true);
    window.removeEventListener('resize', przelicz);
    document.removeEventListener('pointerdown', naKlikPoza, true);
    if (wrocFokus && btn && document.contains(btn)) btn.focus();
  }

  function przelicz() {
    if (!otwarta) return;
    var r = otwarta.btn.getBoundingClientRect();
    var widoczny = r.bottom > 0 && r.top < document.documentElement.clientHeight && r.right > 0 && r.left < document.documentElement.clientWidth;
    if (!widoczny || !document.contains(otwarta.btn)) return zamknij(false);
    ustaw(otwarta.karta, otwarta.grot, otwarta.btn);
  }

  function naKlawisz(ev) {
    if (!otwarta) return;
    if (ev.key === 'Escape') {
      // Esc zamyka NAJPIERW pomoc; to samo naciśnięcie nie może zamknąć formularza pod spodem.
      ev.stopPropagation(); ev.preventDefault();
      zamknij(true);
    }
  }

  function naKlikPoza(ev) {
    if (!otwarta) return;
    if (otwarta.karta.contains(ev.target) || otwarta.btn.contains(ev.target)) return;
    // Zamykamy pomoc, ale NIE blokujemy kliknięcia — klikniętą kontrolkę zostawiamy w spokoju.
    zamknij(false);
  }

  function otworz(ctx, btn) {
    if (otwarta && otwarta.btn === btn) return zamknij(true);
    // Przycisk schowany (jego ekran nie jest wyświetlony) — chmurka nie ma do czego przylgnąć
    // i lądowała w rogu okna. Lepiej nic nie pokazać niż pokazać pomoc znikąd.
    var rb = btn.getBoundingClientRect();
    if (!rb.width || !rb.height) return;
    zamknij(false);
    schowajTooltip();
    wczytaj().then(function () {
      var karta = zbuduj(ctx);
      var grot = el('div', 'pk-grot');
      grot.style.display = 'none';
      document.body.appendChild(grot);
      document.body.appendChild(karta);
      otwarta = { ctx: ctx, btn: btn, karta: karta, grot: grot };
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-controls', karta.id);
      ustaw(karta, grot, btn);
      requestAnimationFrame(function () { karta.classList.add('pk-widoczny'); });
      karta.focus();
      document.addEventListener('keydown', naKlawisz, true);
      window.addEventListener('scroll', przelicz, true);
      window.addEventListener('resize', przelicz);
      document.addEventListener('pointerdown', naKlikPoza, true);
    });
  }

  // ── tooltip („Pomoc do tego widoku") ────────────────────────────────────
  function pokazTooltip(btn) {
    if (otwarta) return;
    schowajTooltip();
    tooltip = el('div', 'pk-tip');
    tooltip.textContent = 'Pomoc do tego widoku';
    document.body.appendChild(tooltip);
    var r = btn.getBoundingClientRect();
    var sz = tooltip.offsetWidth;
    tooltip.style.top = Math.round(r.bottom + 6) + 'px';
    tooltip.style.left = Math.round(Math.max(8, Math.min(r.left + r.width / 2 - sz / 2, document.documentElement.clientWidth - sz - 8))) + 'px';
    requestAnimationFrame(function () { if (tooltip) tooltip.classList.add('pk-widoczny'); });
    tooltipBtn = btn;
  }
  function schowajTooltip() {
    clearTimeout(tooltipT);
    if (tooltip && tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    tooltip = null; tooltipBtn = null;
  }

  // ── podpinanie przycisków ───────────────────────────────────────────────
  // W znaczniku wystarczy: <span class="pk-slot" data-pomoc="magazyn.produkt.nowy"></span>
  // Obserwator podmienia pusty slot na prawdziwy przycisk — działa też dla ekranów
  // rysowanych z JS (Terminarz), bez dopisywania czegokolwiek w ich kodzie.
  function podlacz(slot) {
    if (!slot || slot.dataset.pkGotowy === '1') return;
    if (!slot.getAttribute('data-pomoc')) return;
    slot.dataset.pkGotowy = '1';
    var btn = el('button', 'pk-btn');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Pomoc: ' + (slot.getAttribute('data-pomoc-nazwa') || 'ten widok'));
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();   // nie wysyłamy formularza, nie klikamy tła
      // Klucz czytamy ZA KAŻDYM RAZEM ze slotu, a nie z chwili podpięcia: jeden przycisk
      // w pasku zakładek obsługuje wszystkie zakładki i jego kontekst zmienia się w locie.
      // Zapamiętany klucz dawał we wszystkich zakładkach treść tej pierwszej (złapane próbą).
      otworz(slot.getAttribute('data-pomoc'), btn);
    });
    btn.addEventListener('mouseenter', function () { tooltipT = setTimeout(function () { pokazTooltip(btn); }, 350); });
    btn.addEventListener('mouseleave', schowajTooltip);
    btn.addEventListener('focus', function () { pokazTooltip(btn); });
    btn.addEventListener('blur', schowajTooltip);
    slot.appendChild(btn);
  }

  function skanuj(korzen) {
    var sloty = (korzen || document).querySelectorAll ? (korzen || document).querySelectorAll('.pk-slot[data-pomoc]') : [];
    for (var i = 0; i < sloty.length; i++) podlacz(sloty[i]);
  }

  function start() {
    skanuj(document);
    var obs = new MutationObserver(function (zmiany) {
      for (var i = 0; i < zmiany.length; i++) {
        var dodane = zmiany[i].addedNodes;
        for (var j = 0; j < dodane.length; j++) {
          var n = dodane[j];
          if (n.nodeType !== 1) continue;
          if (n.classList && n.classList.contains('pk-slot')) podlacz(n);
          skanuj(n);
        }
      }
      // Ekran przerysowany pod otwartą chmurką (np. odświeżenie listy) — zamykamy ją,
      // żeby nie wisiała przy przycisku, którego już nie ma.
      if (otwarta && !document.contains(otwarta.btn)) zamknij(false);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    wczytaj();                                   // katalog w tle, żeby pierwsze kliknięcie było natychmiastowe
  }

  window.POMOC = {
    otworz: otworz,
    zamknij: function () { zamknij(false); },
    skanuj: skanuj,
    /** Slot w HTML budowany z JS — dla modułów rysujących własne nagłówki. */
    slot: function (ctx, nazwa) {
      return '<span class="pk-slot" data-pomoc="' + String(ctx).replace(/"/g, '') +
        '"' + (nazwa ? ' data-pomoc-nazwa="' + String(nazwa).replace(/"/g, '') + '"' : '') + '></span>';
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
