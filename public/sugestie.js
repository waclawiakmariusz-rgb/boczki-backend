// Administracja → Sugestie (cross-selling) — warstwa prezentacji dodana przy redesignie 24.10.2026
// (docs/redesign/Estelio_Sugestie_Lekki_Nowy_2026-10-24).
//
// Zero fetch/POST/walidacji. Zapis i usuwanie robią zapiszReguleSugestii() / usunRegule() z index.html, lista renderuje
// renderKreatorSugestii() z regulyCache. Tu są tylko rzeczy, które makieta pokazuje, a stary ekran nie miał:
//   1. podgląd tworzonej reguły (czyta #sug_matka, #sug_dziecko, #sug_opis — lokalnie),
//   2. wyszukiwarka na liście reguł (obie nazwy + wskazówka, bez ogonków) z licznikiem „Wyniki: X z Y”.
(function () {
  'use strict';
  var sekcja, matka, dziecko, opis, pMatka, pDziecko, pOpis, szukaj, wyniki, lista;
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

  function start() {
    sekcja = document.getElementById('setup-sugestie');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    matka = $('#sug_matka'); dziecko = $('#sug_dziecko'); opis = $('#sug_opis');
    pMatka = $('[data-sug-podglad-matka]'); pDziecko = $('[data-sug-podglad-dziecko]'); pOpis = $('[data-sug-podglad-opis]');
    szukaj = $('[data-sug-szukaj]'); wyniki = $('[data-sug-wyniki]'); lista = $('#lista-regul-sugestii');
    if (!matka || !dziecko || !opis || !pMatka || !pDziecko || !pOpis || !szukaj || !wyniki || !lista) return;
    sekcja.dataset.prezentacjaGotowa = '1';
    window.SUGESTIE_PREZENTACJA = { poRenderze: filtruj };   // renderKreatorSugestii() woła po każdym renderze — filtr zostaje po dodaniu/usunięciu
    [matka, dziecko, opis].forEach(function (e) { e.addEventListener('input', odswiezPodglad); e.addEventListener('change', odswiezPodglad); });
    szukaj.addEventListener('input', filtruj);
    // Enter w polu wyboru (datalist) nie ma wysyłać reguły — przycisk zapisu nie jest submitem, więc wystarczy nie robić nic.
    odswiezPodglad(); filtruj();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
