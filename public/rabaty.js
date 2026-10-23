// Rabaty — warstwa prezentacji dodana przy redesignie 23.10.2026 (docs/redesign/Estelio_Rabaty_Lekki_Nowy_2026-10-22).
// Zero fetch/POST/walidacji. Zapis nadal wykonuje zapiszDefinicjeRabatu() z index.html, czytając <select id="rabat-typ">.
// Tu: segmenty Procentowy/Kwotowy ustawiają ten select, a podgląd pokazuje niezapisaną nazwę i wartość.
(function () {
  'use strict';
  function start() {
    var sekcja = document.getElementById('sekcja-kreator-rabatow');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    var nazwa = document.getElementById('rabat-nazwa'), typ = document.getElementById('rabat-typ'), wartosc = document.getElementById('rabat-wartosc');
    var segmenty = sekcja.querySelectorAll('input[name="rb-typ-segment"]');
    var jednostka = sekcja.querySelector('[data-rb-jednostka]'), pomoc = sekcja.querySelector('[data-rb-wartosc-pomoc]');
    var pNazwa = sekcja.querySelector('[data-rb-podglad-nazwa]'), pWartosc = sekcja.querySelector('[data-rb-podglad-wartosc]');
    if (!nazwa || !typ || !wartosc || !segmenty.length || !jednostka || !pNazwa || !pWartosc) return;
    sekcja.dataset.prezentacjaGotowa = '1';

    function odswiez() {
      var procent = typ.value === 'PROCENT';
      jednostka.textContent = procent ? '%' : 'zł';
      if (pomoc) pomoc.textContent = procent ? 'Wpisz wartość procentową rabatu.' : 'Wpisz kwotę rabatu w walucie salonu.';
      pNazwa.textContent = nazwa.value.trim() || 'Nazwa rabatu';
      var v = String(wartosc.value || '').trim();
      var n = v === '' ? NaN : Number(v.replace(',', '.'));
      pWartosc.textContent = isNaN(n) ? '—' : '−' + n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + (procent ? '%' : ' zł');
    }
    segmenty.forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) { typ.value = r.value; odswiez(); } });
    });
    // Gdyby select zmienił się inną drogą (np. form.reset) — segmenty podążają.
    typ.addEventListener('change', function () { segmenty.forEach(function (r) { r.checked = r.value === typ.value; }); odswiez(); });
    nazwa.addEventListener('input', odswiez);
    wartosc.addEventListener('input', odswiez);
    segmenty.forEach(function (r) { r.checked = r.value === typ.value; });
    odswiez();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
