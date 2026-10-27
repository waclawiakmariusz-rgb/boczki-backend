// Administracja → Sugestie (cross-selling) — warstwa prezentacji dodana przy redesignie 24.10.2026
// (docs/redesign/Estelio_Sugestie_Lekki_Nowy_2026-10-24).
//
// Zero fetch/POST/walidacji. Zapis i usuwanie robią zapiszReguleSugestii() / usunRegule() z index.html, lista renderuje
// renderKreatorSugestii() z regulyCache. Tu są tylko rzeczy, które makieta pokazuje, a stary ekran nie miał:
//   1. podgląd tworzonej reguły (czyta #sug_matka, #sug_dziecko, #sug_opis — lokalnie),
//   2. wyszukiwarka na liście reguł (obie nazwy + wskazówka, bez ogonków) z licznikiem „Wyniki: X z Y”,
//   3. (ticket #14, 27.10.2026) własna lista wyboru zabiegu w polach „Po zakupie” / „Zaproponuj”: kategorie cennika,
//      przełącznik „pokaż warianty”, szukanie po fragmencie, klawiatura, telefon. Dane przychodzą z wypelnijSelectySugestii()
//      (index.html) przez SUGESTIE_PREZENTACJA.poSlowniku(); pole pozostaje tekstowe — własna nazwa nadal dozwolona.
(function () {
  'use strict';
  var sekcja, matka, dziecko, opis, pMatka, pDziecko, pOpis, szukaj, wyniki, lista;
  var SLOWNIK = { kategorie: [], warianty: [] };   // warianty: [{ kategoria, wariant, tekst }]
  var pokazWarianty = false;
  var otwarty = null;                                // { input, btn, panel, pozycje, aktywna }
  var MAX_POZYCJI = 400;
  function $(s) { return sekcja.querySelector(s); }
  function bezOgonkow(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'); }

  function odswiezPodglad() {
    pMatka.textContent = matka.value.trim() || '—';
    pDziecko.textContent = dziecko.value.trim() || '—';
    var o = opis.value.trim();
    pOpis.textContent = o; pOpis.hidden = !o;
  }
  function filtruj() {
    var f = bezOgonkow(szukaj.value).trim().split(/\s+/).filter(Boolean);
    var wiersze = [].slice.call(lista.querySelectorAll('.sug-wiersz'));
    var ile = 0;
    wiersze.forEach(function (w) {
      var pasuje = !f.length || f.every(function (s) { return bezOgonkow(w.getAttribute('data-sug-tekst')).indexOf(s) >= 0; });
      w.classList.toggle('sug-ukryty', !pasuje); if (pasuje) ile++;
    });
    var stary = lista.querySelector('.sug-brak'); if (stary) stary.remove();
    if (!f.length || !wiersze.length) { wyniki.hidden = true; return; }
    wyniki.hidden = false; wyniki.textContent = 'Wyniki: ' + ile + ' z ' + wiersze.length;
    if (!ile) { var p = document.createElement('p'); p.className = 'sug-state sug-brak'; p.innerHTML = '<strong>Nie znaleziono reguł</strong><br>'; var b = document.createElement('button'); b.type = 'button'; b.className = 'sug-usun'; b.textContent = 'Wyczyść wyszukiwanie'; b.addEventListener('click', function () { szukaj.value = ''; filtruj(); szukaj.focus(); }); p.appendChild(b); lista.appendChild(p); }
  }

  // ── 3. lista wyboru zabiegu ──────────────────────────────────────────────
  function poSlowniku(zabiegi) {
    var kat = {}, war = [];
    (zabiegi || []).forEach(function (z) {
      var k = String(z.kategoria || '').trim(), w = String(z.wariant || '').trim();
      if (!k) return;
      kat[k] = true;
      if (w) war.push({ kategoria: k, wariant: w, tekst: k + ' ' + w });
    });
    SLOWNIK.kategorie = Object.keys(kat).sort(function (a, b) { return a.localeCompare(b, 'pl'); });
    SLOWNIK.warianty = war.sort(function (a, b) { return a.tekst.localeCompare(b.tekst, 'pl'); });
    sekcja.dataset.sugSlownik = String(SLOWNIK.kategorie.length);
    if (otwarty) renderuj(otwarty);
  }
  function pozycjeDla(fraza) {
    var f = bezOgonkow(fraza).trim().split(/\s+/).filter(Boolean);
    var pasuje = function (t) { var b = bezOgonkow(t); return !f.length || f.every(function (s) { return b.indexOf(s) >= 0; }); };
    var out = [];
    if (!pokazWarianty) {
      SLOWNIK.kategorie.forEach(function (k) { if (pasuje(k)) out.push({ tekst: k, typ: 'kategoria' }); });
    } else {
      SLOWNIK.kategorie.forEach(function (k) {
        var w = SLOWNIK.warianty.filter(function (x) { return x.kategoria === k && pasuje(x.tekst); });
        var kPasuje = pasuje(k);
        if (!kPasuje && !w.length) return;
        out.push({ tekst: k, typ: 'kategoria', grupa: true });
        w.forEach(function (x) { out.push({ tekst: x.tekst, typ: 'wariant', etykieta: x.wariant }); });
      });
    }
    return out;
  }
  function zbudujPanel(input, btn) {
    var panel = document.createElement('div');
    panel.className = 'sug-lista'; panel.hidden = true; panel.setAttribute('role', 'listbox'); panel.id = input.id + '-lista';
    panel.innerHTML = '<div class="sug-lista-naglowek"><span class="sug-lista-licznik" data-sug-licznik></span>' +
      '<label class="sug-lista-warianty"><input type="checkbox" data-sug-warianty> pokaż warianty</label></div>' +
      '<div class="sug-lista-pozycje" data-sug-pozycje></div>' +
      '<div class="sug-lista-stopka">Możesz też wpisać własną nazwę — reguła dopasuje ją po fragmencie.</div>';
    input.parentNode.appendChild(panel);
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', panel.id);
    var st = { input: input, btn: btn, panel: panel, pozycje: [], aktywna: -1, rolka: panel.querySelector('[data-sug-pozycje]'), licznik: panel.querySelector('[data-sug-licznik]'), chk: panel.querySelector('[data-sug-warianty]') };
    st.chk.addEventListener('change', function () { pokazWarianty = st.chk.checked; renderuj(st); input.focus(); });
    st.chk.addEventListener('mousedown', function (e) { e.preventDefault(); st.chk.checked = !st.chk.checked; st.chk.dispatchEvent(new Event('change')); });
    st.rolka.addEventListener('mousedown', function (e) {
      var el = e.target.closest('[data-sug-i]'); if (!el) return;
      e.preventDefault(); wybierz(st, Number(el.getAttribute('data-sug-i')));
    });
    input.addEventListener('focus', function () { otworz(st); });
    input.addEventListener('click', function () { otworz(st); });
    input.addEventListener('input', function () { otworz(st); });
    input.addEventListener('keydown', function (e) { klawisz(st, e); });
    input.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== input) zamknij(st); }, 120); });
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () { if (otwarty === st) { zamknij(st); input.focus(); } else { input.focus(); otworz(st, true); } });
    return st;
  }
  function otworz(st, pelna) {
    if (otwarty && otwarty !== st) zamknij(otwarty);
    otwarty = st; st.panel.hidden = false; st.input.setAttribute('aria-expanded', 'true'); st.btn.setAttribute('aria-expanded', 'true');
    st.chk.checked = pokazWarianty;
    renderuj(st, pelna);
  }
  function zamknij(st) {
    if (!st) return;
    st.panel.hidden = true; st.aktywna = -1; st.input.setAttribute('aria-expanded', 'false'); st.btn.setAttribute('aria-expanded', 'false'); st.input.removeAttribute('aria-activedescendant');
    if (otwarty === st) otwarty = null;
  }
  function renderuj(st, pelna) {
    var fraza = pelna ? '' : st.input.value;
    // gdy wartość pola jest dokładnie jedną z pozycji (po wyborze), pokaż całą listę, a nie jeden wiersz
    if (!pelna && SLOWNIK.kategorie.indexOf(fraza.trim()) >= 0) fraza = '';
    st.pozycje = pozycjeDla(fraza).slice(0, MAX_POZYCJI);
    st.aktywna = -1;
    var wart = st.input.value.trim();
    if (!SLOWNIK.kategorie.length) {
      st.rolka.innerHTML = '<p class="sug-lista-pusto">Brak zabiegów w cenniku — dodaj je w Administracja → Produkty i cennik albo wpisz nazwę ręcznie.</p>';
      st.licznik.textContent = '';
      return;
    }
    if (!st.pozycje.length) {
      st.rolka.innerHTML = '<p class="sug-lista-pusto">Nic nie pasuje do „' + esc(st.input.value.trim()) + '”. Zostaw własną nazwę albo zmień frazę.</p>';
    } else {
      var h = '';
      st.pozycje.forEach(function (p, i) {
        if (p.grupa) { h += '<div class="sug-lista-grupa" data-sug-i="' + i + '" role="option" id="' + st.panel.id + '-' + i + '" aria-selected="' + (p.tekst === wart) + '"><span>' + esc(p.tekst) + '</span><small>cała kategoria</small></div>'; return; }
        h += '<div class="sug-lista-pozycja' + (p.typ === 'wariant' ? ' sug-lista-wariant' : '') + '" data-sug-i="' + i + '" role="option" id="' + st.panel.id + '-' + i + '" aria-selected="' + (p.tekst === wart) + '">' + (p.typ === 'wariant' ? esc(p.etykieta) : esc(p.tekst)) + '</div>';
      });
      st.rolka.innerHTML = h;
    }
    var n = SLOWNIK.kategorie.length;
    st.licznik.textContent = pokazWarianty ? n + ' ' + lm(n, 'kategoria', 'kategorie', 'kategorii') + ' · ' + SLOWNIK.warianty.length + ' ' + lm(SLOWNIK.warianty.length, 'wariant', 'warianty', 'wariantów') : n + ' ' + lm(n, 'kategoria z cennika', 'kategorie z cennika', 'kategorii z cennika');
  }
  function wybierz(st, i) {
    var p = st.pozycje[i]; if (!p) return;
    st.input.value = p.tekst;
    st.input.dispatchEvent(new Event('input', { bubbles: true }));
    st.input.dispatchEvent(new Event('change', { bubbles: true }));
    zamknij(st);
  }
  function klawisz(st, e) {
    if (e.key === 'Escape') { if (otwarty === st) { e.preventDefault(); zamknij(st); } return; }
    if (e.key === 'Tab') { zamknij(st); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (otwarty !== st) { otworz(st); }
      if (!st.pozycje.length) return;
      var krok = e.key === 'ArrowDown' ? 1 : -1;
      var i = st.aktywna;
      i = (i + krok + st.pozycje.length) % st.pozycje.length;
      podswietl(st, i); return;
    }
    if (e.key === 'Enter') {
      if (otwarty === st && st.aktywna >= 0) { e.preventDefault(); wybierz(st, st.aktywna); return; }
      if (otwarty === st) { e.preventDefault(); zamknij(st); }   // Enter bez podświetlenia: zostaw wpisany tekst, nie wysyłaj formularza
    }
  }
  function podswietl(st, i) {
    st.aktywna = i;
    var el = st.rolka.querySelectorAll('[data-sug-i]');
    el.forEach(function (x) { x.classList.toggle('sug-lista-aktywna', Number(x.getAttribute('data-sug-i')) === i); });
    var a = st.rolka.querySelector('[data-sug-i="' + i + '"]');
    if (a) { st.input.setAttribute('aria-activedescendant', a.id); if (a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); }
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lm(n, j, m, w) { n = Math.abs(n); if (n === 1) return j; var r = n % 10, r2 = n % 100; return (r >= 2 && r <= 4 && (r2 < 12 || r2 > 14)) ? m : w; }

  function start() {
    sekcja = document.getElementById('setup-sugestie');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    matka = $('#sug_matka'); dziecko = $('#sug_dziecko'); opis = $('#sug_opis');
    pMatka = $('[data-sug-podglad-matka]'); pDziecko = $('[data-sug-podglad-dziecko]'); pOpis = $('[data-sug-podglad-opis]');
    szukaj = $('[data-sug-szukaj]'); wyniki = $('[data-sug-wyniki]'); lista = $('#lista-regul-sugestii');
    if (!matka || !dziecko || !opis || !pMatka || !pDziecko || !pOpis || !szukaj || !wyniki || !lista) return;
    sekcja.dataset.prezentacjaGotowa = '1';
    // własna lista zastępuje podpowiedzi przeglądarki (datalist zostaje w HTML jako zapas, gdyby ten plik się nie wczytał)
    [matka, dziecko].forEach(function (inp) {
      var btn = sekcja.querySelector('[data-sug-rozwin="' + inp.id + '"]');
      if (!btn) return;
      inp.removeAttribute('list');
      zbudujPanel(inp, btn);
    });
    document.addEventListener('mousedown', function (e) { if (otwarty && !otwarty.panel.contains(e.target) && e.target !== otwarty.input && e.target !== otwarty.btn && !otwarty.btn.contains(e.target)) zamknij(otwarty); });
    window.SUGESTIE_PREZENTACJA = { poRenderze: filtruj, poSlowniku: poSlowniku };   // renderKreatorSugestii() woła po każdym renderze — filtr zostaje po dodaniu/usunięciu
    if (window.salesDictCache && Array.isArray(window.salesDictCache.zabiegi)) poSlowniku(window.salesDictCache.zabiegi);
    [matka, dziecko, opis].forEach(function (e) { e.addEventListener('input', odswiezPodglad); e.addEventListener('change', odswiezPodglad); });
    szukaj.addEventListener('input', filtruj);
    odswiezPodglad(); filtruj();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
