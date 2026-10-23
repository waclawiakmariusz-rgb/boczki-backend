// Magazyn → Nowy produkt / Edycja — warstwa prezentacji dodana przy redesignie 23.10.2026
// (docs/redesign/Estelio_Magazyn_Lekki_Nowy_2026-10-21).
//
// Zero fetch/POST/walidacji danych. Zapis nadal wykonuje rap_zapiszProdukt() z index.html, czytając TE SAME pola rap_p_*.
// Tu są tylko rzeczy, które makieta pokazuje, a stary formularz nie miał:
//   1. wybór kategorii jako panel z wyszukiwarką i grupami — nad ukrytym <select id="rap_p_cat">, który dalej jest źródłem
//      prawdy (panel ustawia select.value i wysyła 'change'; opcje bierze z selectu, więc lista jest zawsze ta sama),
//   2. tytuł i etykiety w trybie dodawania / edycji (rap_edit() ustawia #rap_p_id — to jedyny sygnał),
//   3. przycisk „Anuluj” — powrót do listy magazynu z pytaniem o odrzucenie zmian.
(function () {
  'use strict';
  var sekcja, select, trigger, tekst, picker, szukaj, opcje, brak, form;
  var SEP = /\s*(?:>|\/|›|→)\s*/;   // separator w pełnej ścieżce kategorii ("Rodzic > Dziecko")

  function bezOgonkow(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'); }
  function $(sel) { return sekcja.querySelector(sel); }

  // ── kategorie: lista z selectu → grupy po rodzicu ────────────────────────
  function pozycje() {
    return [].slice.call(select.options).filter(function (o) { return o.value !== ''; }).map(function (o) {
      var czesci = o.value.split(SEP).filter(Boolean);
      return { wartosc: o.value, nazwa: czesci.length ? czesci[czesci.length - 1] : o.value, rodzic: czesci.slice(0, -1).join(' › '), tekst: o.text };
    });
  }
  function renderuj(fraza) {
    var f = bezOgonkow(fraza).trim().split(/\s+/).filter(Boolean);
    var lista = pozycje().filter(function (p) { var h = bezOgonkow(p.wartosc + ' ' + p.tekst); return f.every(function (w) { return h.indexOf(w) >= 0; }); });
    opcje.innerHTML = '';
    brak.hidden = lista.length > 0;
    var grupy = {}; var kolejnosc = [];
    lista.forEach(function (p) { if (!grupy[p.rodzic]) { grupy[p.rodzic] = []; kolejnosc.push(p.rodzic); } grupy[p.rodzic].push(p); });
    kolejnosc.forEach(function (rodzic) {
      if (rodzic) {
        var g = document.createElement('div'); g.className = 'ei-group';
        g.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 3h9v12H3V6Z"/></svg>';
        g.appendChild(document.createTextNode(rodzic)); opcje.appendChild(g);
      }
      grupy[rodzic].forEach(function (p) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'ei-option' + (rodzic ? '' : ' ei-root'); b.setAttribute('role', 'option');
        b.setAttribute('aria-selected', select.value === p.wartosc ? 'true' : 'false'); b.dataset.wartosc = p.wartosc;
        b.appendChild(document.createTextNode(p.nazwa));
        b.innerHTML += '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
        b.addEventListener('click', function () { wybierz(p.wartosc); });
        opcje.appendChild(b);
      });
    });
    aktywna(select.value ? [].slice.call(opcje.querySelectorAll('.ei-option')).findIndex(function (b) { return b.dataset.wartosc === select.value; }) : 0);
  }
  var indeks = 0;
  function aktywna(i) {
    var el = opcje.querySelectorAll('.ei-option'); if (!el.length) { indeks = 0; return; }
    indeks = Math.max(0, Math.min(i, el.length - 1));
    el.forEach(function (b, k) { b.classList.toggle('ei-aktywna', k === indeks); });
    if (el[indeks] && el[indeks].scrollIntoView) el[indeks].scrollIntoView({ block: 'nearest' });
  }
  function odswiezTekst() {
    var p = pozycje().filter(function (x) { return x.wartosc === select.value; })[0];
    tekst.textContent = p ? p.wartosc.split(SEP).filter(Boolean).join(' › ') : 'Wybierz kategorię';
    tekst.classList.toggle('ei-pusta', !p);
  }
  function wybierz(wartosc) {
    select.value = wartosc;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    odswiezTekst(); zamknij(); trigger.focus();
  }
  function otworz() {
    picker.hidden = false; trigger.setAttribute('aria-expanded', 'true'); szukaj.setAttribute('aria-expanded', 'true');
    szukaj.value = ''; renderuj('');
    // Przy dolnej krawędzi ekranu panel otwiera się nad polem.
    var r = trigger.getBoundingClientRect(); picker.classList.toggle('ei-nad', window.innerHeight - r.bottom < 320 && r.top > 360);
    szukaj.focus();
    document.addEventListener('mousedown', klikPoza, true);
  }
  function zamknij() {
    if (picker.hidden) return;
    picker.hidden = true; trigger.setAttribute('aria-expanded', 'false'); szukaj.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', klikPoza, true);
  }
  function klikPoza(ev) { if (!$('[data-ei-kategoria]').contains(ev.target)) zamknij(); }

  // ── tryb dodaj / edytuj ──────────────────────────────────────────────────
  function odswiezTryb() {
    var edycja = !!$('#rap_p_id').value;
    sekcja.classList.toggle('ei-tryb-edycja', edycja);
    $('[data-ei-tytul]').textContent = edycja ? 'Edytuj produkt w magazynie' : 'Dodaj produkt do magazynu';
    $('[data-ei-podtytul]').textContent = edycja ? 'Popraw dane produktu. Ilość to obecny stan, nie dostawa.' : 'Uzupełnij dane produktu i jego stan początkowy.';
    $('[data-ei-okruszek]').textContent = edycja ? 'Edycja produktu' : 'Nowy produkt';
    $('[data-ei-ilosc-etykieta]').textContent = edycja ? 'Obecna ilość' : 'Stan początkowy';
    $('[data-ei-ilosc-pomoc]').textContent = edycja ? 'Stan po korekcie, nie wielkość dostawy.' : 'Ilość dostępna w chwili dodania.';
    var zapisz = $('[data-ei-zapisz]'); if (zapisz && !zapisz.disabled) zapisz.textContent = edycja ? 'Zapisz zmiany' : 'Dodaj produkt';
    odswiezTekst();
  }

  // ── Anuluj ───────────────────────────────────────────────────────────────
  function cosWpisano() {
    var id = $('#rap_p_id').value;
    if (id) return true; // w edycji zawsze pytamy — nie wiemy, co zmieniono
    return !!($('#rap_p_name').value || select.value || $('#rap_p_unit').value || $('#rap_p_expiration').value || $('#rap_p_price').value || $('#rap_p_qty').value !== '0' || $('#rap_p_min').value !== '5');
  }
  function anuluj() {
    if (cosWpisano() && !window.confirm('Odrzucić zmiany?\n\nWprowadzone dane nie zostały zapisane.')) return;
    // To samo, co robi rap_zapiszProdukt() po sukcesie: reset formularza i powrót do listy.
    if (typeof window.rap_resetProdForm === 'function') window.rap_resetProdForm();
    odswiezTryb();
    if (typeof window.pokaz === 'function') window.pokaz('rap_magazyn');
  }

  function start() {
    sekcja = document.getElementById('rap_add');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    select = $('#rap_p_cat'); trigger = $('[data-ei-trigger]'); tekst = $('[data-ei-kategoria-tekst]'); picker = $('[data-ei-picker]');
    szukaj = $('[data-ei-szukaj]'); opcje = $('[data-ei-opcje]'); brak = $('[data-ei-brak]'); form = $('#rap_product-form');
    if (!select || !trigger || !picker || !szukaj || !opcje || !form) return;
    sekcja.dataset.prezentacjaGotowa = '1';

    trigger.addEventListener('click', function () { picker.hidden ? otworz() : zamknij(); });
    trigger.addEventListener('keydown', function (ev) { if (ev.key === 'ArrowDown') { ev.preventDefault(); otworz(); } });
    szukaj.addEventListener('input', function () { renderuj(szukaj.value); });
    szukaj.addEventListener('keydown', function (ev) {
      var el = opcje.querySelectorAll('.ei-option');
      if (ev.key === 'ArrowDown') { ev.preventDefault(); aktywna(indeks + 1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); aktywna(indeks - 1); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Home') { ev.preventDefault(); aktywna(0); }
      else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'End') { ev.preventDefault(); aktywna(el.length - 1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); if (el[indeks]) wybierz(el[indeks].dataset.wartosc); } // Enter wybiera, NIE wysyła formularza
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); zamknij(); trigger.focus(); }
      else if (ev.key === 'Tab') { zamknij(); }
    });
    select.addEventListener('change', odswiezTekst);
    form.addEventListener('reset', function () { setTimeout(odswiezTryb, 0); });
    $('[data-ei-anuluj]').addEventListener('click', anuluj);
    // rap_edit() ustawia #rap_p_id i woła pokaz('rap_add') — wejście w sekcję to moment, w którym czytamy tryb.
    new MutationObserver(function () { if (sekcja.classList.contains('active')) { odswiezTryb(); zamknij(); } }).observe(sekcja, { attributes: true, attributeFilter: ['class'] });
    // Lista kategorii dosypuje się asynchronicznie (rap_populateCategorySelects) — tekst przycisku ma za nią nadążyć.
    new MutationObserver(odswiezTekst).observe(select, { childList: true });
    odswiezTryb();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
