// Magazyn → Kategorie — warstwa prezentacji dodana przy redesignie 23.10.2026
// (docs/redesign/Estelio_Kategorie_Magazynowe_Lekki_Nowy_2026-10-23).
//
// Zero fetch/POST/walidacji. Dane i operacje są te same, co dotąd: rap_zapiszKategorie() czyta #rap_c_name i #rap_c_parent,
// drzewo renderuje rap_renderCategoryTree() z rap_categoriesFlat, a akcje w menu wołają rap_zmienNazweKategorii /
// rap_przeniesKategorie / rap_deleteCategory. Tu jest tylko to, co makieta pokazuje, a stary ekran nie miał:
//   1. dialog „Wybierz miejsce kategorii” nad TYM SAMYM ukrytym <select id="rap_c_parent"> (opcje z selectu, wybór do selectu),
//   2. rozwijanie/zwijanie gałęzi (stan lokalny), „Rozwiń/Zwiń wszystko”, szukanie bez ogonków z pokazaniem przodków,
//   3. menu „⋯” przy wierszu — akcje to zwykłe przyciski, które istniały wcześniej jako ikony.
(function () {
  'use strict';
  var sekcja, select, trigger, tekst, opis, dialog, dSzukaj, dOpcje, dBrak, lSzukaj, dopasowania, drzewo;
  var roboczy = '', rozwiniete = {}, wSzukaniu = false;
  var SEP = ' > ';
  function $(s) { return sekcja.querySelector(s); }
  function bezOgonkow(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'); }
  function opcje() { return [].slice.call(select.options).map(function (o) { return { id: o.value, sciezka: o.value === '' ? '' : o.text, nazwa: o.value === '' ? 'Poziom główny' : o.text.split(SEP).pop(), glebokosc: o.value === '' ? 0 : o.text.split(SEP).length - 1 }; }); }

  // ── wybór miejsca (dialog nad selectem) ──────────────────────────────────
  function odswiezTekst() {
    var o = opcje().filter(function (x) { return x.id === select.value; })[0];
    var glowny = !o || o.id === '';
    tekst.textContent = glowny ? 'Poziom główny' : o.sciezka.split(SEP).join(' › ');
    if (opis) opis.textContent = glowny ? 'Kategoria pojawi się bezpośrednio na liście.' : 'Nowa kategoria będzie podkategorią wskazanej kategorii.';
  }
  function renderujOpcje(fraza) {
    var f = bezOgonkow(fraza).trim().split(/\s+/).filter(Boolean);
    var lista = opcje().filter(function (o) { return o.id === '' ? !f.length : f.every(function (w) { return bezOgonkow(o.sciezka).indexOf(w) >= 0; }); });
    dOpcje.innerHTML = ''; dBrak.hidden = lista.length > 0;
    var ostatniKorzen = null;
    lista.forEach(function (o) {
      var korzen = o.id === '' ? '' : o.sciezka.split(SEP)[0];
      if (o.id !== '' && korzen !== ostatniKorzen) { var h = document.createElement('div'); h.className = 'kat-grupa'; h.textContent = korzen; dOpcje.appendChild(h); ostatniKorzen = korzen; }
      var l = document.createElement('label'); l.className = 'kat-opcja' + (o.id === '' ? ' kat-opcja-glowna' : ''); l.style.setProperty('--glebokosc', String(Math.min(o.glebokosc, 4)));
      var r = document.createElement('input'); r.type = 'radio'; r.name = 'kat-miejsce'; r.value = o.id; r.checked = roboczy === o.id;
      r.addEventListener('change', function () { roboczy = o.id; [].forEach.call(dOpcje.querySelectorAll('.kat-opcja'), function (el) { el.classList.toggle('kat-wybrana', el.querySelector('input').checked); }); });
      l.appendChild(r);
      l.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 3h9v12H3V6Z"/></svg>');
      var t = document.createElement('span'); t.className = 'kat-opcja-tekst';
      var n = document.createElement('strong'); n.textContent = o.nazwa; t.appendChild(n);
      var p = document.createElement('small'); p.textContent = o.id === '' ? 'Bez kategorii nadrzędnej' : (o.glebokosc === 0 ? 'Kategoria główna' : (f.length ? o.sciezka : '')); if (p.textContent) t.appendChild(p);
      l.appendChild(t); if (r.checked) l.classList.add('kat-wybrana');
      dOpcje.appendChild(l);
    });
  }
  function otworz() { roboczy = select.value; dSzukaj.value = ''; renderujOpcje(''); trigger.setAttribute('aria-expanded', 'true'); dialog.showModal(); dSzukaj.focus(); }
  function zamknij() { if (dialog.open) dialog.close(); trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
  function wybierz() { select.value = roboczy; if (select.value !== roboczy) select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); odswiezTekst(); zamknij(); }

  // ── drzewo: rozwijanie, szukanie, menu ───────────────────────────────────
  function ustawGalaz(li, otwarte) {
    li.classList.toggle('kat-otwarte', otwarte);
    var b = li.querySelector(':scope > .kat-wiersz [data-kat-toggle]'); if (b) { b.setAttribute('aria-expanded', String(otwarte)); b.setAttribute('aria-label', (otwarte ? 'Zwiń ' : 'Rozwiń ') + li.dataset.nazwa); }
    if (!wSzukaniu) rozwiniete[li.dataset.sciezka] = otwarte;
  }
  function wszystkie(otwarte) { [].forEach.call(drzewo.querySelectorAll('.kat-ma-dzieci'), function (li) { ustawGalaz(li, otwarte); }); }
  function zamknijMenu() { [].forEach.call(drzewo.querySelectorAll('.kat-menu'), function (m) { m.hidden = true; }); [].forEach.call(drzewo.querySelectorAll('[data-kat-menu]'), function (b) { b.setAttribute('aria-expanded', 'false'); }); }
  function szukaj(fraza) {
    var f = bezOgonkow(fraza).trim().split(/\s+/).filter(Boolean);
    var wezly = [].slice.call(drzewo.querySelectorAll('.kat-wezel'));
    if (!f.length) {
      wSzukaniu = false; dopasowania.hidden = true;
      wezly.forEach(function (li) { li.classList.remove('kat-ukryty', 'kat-dopasowany', 'kat-przodek'); });
      [].forEach.call(drzewo.querySelectorAll('.kat-ma-dzieci'), function (li) { ustawGalaz(li, !!rozwiniete[li.dataset.sciezka]); });
      return;
    }
    wSzukaniu = true; var ile = 0;
    wezly.forEach(function (li) { li.classList.remove('kat-dopasowany', 'kat-przodek'); li.classList.add('kat-ukryty'); });
    wezly.forEach(function (li) {
      var h = bezOgonkow(li.dataset.sciezka);
      if (f.every(function (w) { return h.indexOf(w) >= 0; })) {
        ile++; li.classList.add('kat-dopasowany'); li.classList.remove('kat-ukryty');
        var p = li.parentElement.closest('.kat-wezel'); while (p) { p.classList.remove('kat-ukryty'); p.classList.add('kat-przodek'); p.classList.add('kat-otwarte'); var b = p.querySelector(':scope > .kat-wiersz [data-kat-toggle]'); if (b) b.setAttribute('aria-expanded', 'true'); p = p.parentElement.closest('.kat-wezel'); }
      }
    });
    dopasowania.hidden = false; dopasowania.textContent = ile ? 'Dopasowania: ' + ile : 'Brak dopasowań dla „' + fraza.trim() + '”.';
  }
  function poRenderze() {
    if (!drzewo) return;
    // domyślnie korzenie rozwinięte (jak na makiecie), chyba że użytkownik już coś zwinął
    [].forEach.call(drzewo.querySelectorAll('.kat-ma-dzieci'), function (li) { var s = li.dataset.sciezka; ustawGalaz(li, s in rozwiniete ? !!rozwiniete[s] : li.closest('.kat-galaz').dataset.poziom === '0'); });
    if (lSzukaj.value) szukaj(lSzukaj.value);
  }

  function start() {
    sekcja = document.getElementById('rap_categories');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    select = $('#rap_c_parent'); trigger = $('[data-kat-trigger]'); tekst = $('[data-kat-parent-tekst]'); opis = $('[data-kat-parent-opis]');
    dialog = $('[data-kat-dialog]'); dSzukaj = $('[data-kat-dialog-szukaj]'); dOpcje = $('[data-kat-opcje]'); dBrak = $('[data-kat-brak]');
    lSzukaj = $('[data-kat-szukaj]'); dopasowania = $('[data-kat-dopasowania]'); drzewo = $('#rap_tree-container');
    if (!select || !trigger || !dialog || !dSzukaj || !dOpcje || !lSzukaj || !drzewo) return;
    sekcja.dataset.prezentacjaGotowa = '1';
    window.KATEGORIE_PREZENTACJA = { poRenderze: poRenderze };

    trigger.addEventListener('click', otworz);
    $('[data-kat-zamknij]').addEventListener('click', zamknij);
    $('[data-kat-anuluj]').addEventListener('click', zamknij);
    $('[data-kat-wybierz]').addEventListener('click', wybierz);
    dialog.addEventListener('cancel', function (ev) { ev.preventDefault(); zamknij(); });              // Escape = anuluj
    dialog.addEventListener('click', function (ev) { if (ev.target === dialog) zamknij(); });          // klik w tło = anuluj
    dSzukaj.addEventListener('input', function () { renderujOpcje(dSzukaj.value); });
    dSzukaj.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); } });
    select.addEventListener('change', odswiezTekst);
    new MutationObserver(odswiezTekst).observe(select, { childList: true });
    $('#rap_cat-form').addEventListener('reset', function () { setTimeout(odswiezTekst, 0); });

    $('[data-kat-rozwin]').addEventListener('click', function () { if (!wSzukaniu) wszystkie(true); });
    $('[data-kat-zwin]').addEventListener('click', function () { if (!wSzukaniu) wszystkie(false); });
    lSzukaj.addEventListener('input', function () { szukaj(lSzukaj.value); });
    drzewo.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-kat-toggle]'); if (t) { if (wSzukaniu) return; var li = t.closest('.kat-wezel'); ustawGalaz(li, !li.classList.contains('kat-otwarte')); return; }
      var m = ev.target.closest('[data-kat-menu]'); if (m) { var menu = m.nextElementSibling; var otwarte = menu.hidden; zamknijMenu(); menu.hidden = !otwarte; m.setAttribute('aria-expanded', String(otwarte)); if (otwarte) { var r = menu.getBoundingClientRect(); menu.classList.toggle('kat-menu-gora', r.bottom > window.innerHeight - 8); } return; }
      if (ev.target.closest('.kat-akcja')) { zamknijMenu(); }
    });
    document.addEventListener('mousedown', function (ev) { if (!ev.target.closest('.kat-menu-box')) zamknijMenu(); }, true);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !dialog.open) zamknijMenu(); });
    sekcja.querySelector('.kat-tree').addEventListener('scroll', zamknijMenu, true);
    odswiezTekst(); poRenderze();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
