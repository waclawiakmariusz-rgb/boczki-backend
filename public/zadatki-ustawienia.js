// Ustawienia zadatków — warstwa prezentacji dodana przy redesignie 26.10.2026 (docs/redesign/Estelio_Zadatki_Lekki_Nowy_2026-10-23).
// Zero zapisów: odczyt/zapis/progi nadal wykonują wczytajUstawieniaZadatkow(), uz_zapisz(), uz_dodajProg(), uz_usunProg() z index.html,
// czytając te same kontrolki uz-*. Tu tylko:
//  • kafle „Zaokrąglenie kwoty" ustawiają ukryty <select id="uz-zaokraglenie"> (źródło prawdy dla uz_zapisz),
//  • podpowiedź „Zadatek wyniesie X% kwoty zabiegu" i napis „Niezapisane zmiany / Brak niezapisanych zmian" w stopce,
//  • podgląd na przykładowej kwocie — liczony przez ISTNIEJĄCY kalkulator serwera (POST /api/ustawienia/zadatki/oblicz,
//    ten sam, z którego korzysta multisprzedaż; tylko odczyt, na ZAPISANYCH ustawieniach — gdy formularz ma zmiany,
//    podgląd mówi o tym wprost zamiast liczyć własnym, drugim algorytmem).
(function () {
  'use strict';
  var zapisane = null;   // config z ostatniego odczytu serwera (wczytajUstawieniaZadatkow → hook poOdczycie)
  var timer = null, kolejka = 0;

  function $(id) { return document.getElementById(id); }
  function pl(n) { return Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'; }
  function kwotaZPola(v) { var s = String(v || '').trim().replace(/\s/g, '').replace(',', '.'); if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN; return Number(s); }

  function start() {
    var sekcja = $('sekcja-zadatki-config');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    var tryb = $('uz-tryb'), procent = $('uz-procent'), zaokr = $('uz-zaokraglenie'), powyzej = $('uz-powyzej-max'), fallback = $('uz-fallback-procent');
    var kafle = sekcja.querySelectorAll('input[name="uz-zaokr-kafel"]');
    var pomocProcent = sekcja.querySelector('[data-uz-procent-pomoc]'), stan = sekcja.querySelector('[data-uz-stan]');
    var przyklad = $('uz-przyklad'), kwota = sekcja.querySelector('[data-uz-podglad-kwota]'), wzor = sekcja.querySelector('[data-uz-podglad-wzor]');
    var podsum = sekcja.querySelector('[data-uz-podglad-podsumowanie]'), uwaga = sekcja.querySelector('[data-uz-podglad-uwaga]');
    if (!tryb || !procent || !zaokr || !powyzej || !fallback || !kafle.length || !przyklad || !kwota || !wzor || !podsum || !uwaga) return;
    sekcja.dataset.prezentacjaGotowa = '1';

    function biezacy() {
      return { tryb: tryb.value, procent: parseFloat(procent.value) || 0, zaokraglenie: parseInt(zaokr.value) || 0, powyzej_max: powyzej.value, fallback_procent: parseFloat(fallback.value) || 0 };
    }
    function zmienione() {
      if (!zapisane) return false;
      var b = biezacy();
      return b.tryb !== zapisane.tryb || b.procent !== Number(zapisane.procent) || b.zaokraglenie !== Number(zapisane.zaokraglenie)
        || b.powyzej_max !== zapisane.powyzej_max || b.fallback_procent !== Number(zapisane.fallback_procent);
    }
    function etykietaZaokr(z) { z = parseInt(z) || 0; return z === 0 ? 'Brak' : 'Do ' + z + ' zł'; }

    function odswiezFormularz() {
      kafle.forEach(function (r) { r.checked = r.value === String(zaokr.value); });
      if (pomocProcent) {
        var p = String(procent.value || '').trim(), n = Number(p.replace(',', '.'));
        pomocProcent.textContent = (p === '' || isNaN(n) || n < 0 || n > 100) ? '' : 'Zadatek wyniesie ' + n.toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + '% kwoty zabiegu.';
      }
      if (stan) stan.textContent = !zapisane ? '' : (zmienione() ? 'Niezapisane zmiany' : 'Brak niezapisanych zmian');
    }

    function pokazPodsumowanie(c) {
      var pary = c.tryb === 'PROCENT'
        ? [['Procent zadatku', (Number(c.procent)).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + '%']]
        : [['Tryb', 'Progi kwotowe'], ['Powyżej najwyższego progu', c.powyzej_max === 'OSTATNI_PROG' ? 'ostatni próg' : c.powyzej_max === 'PROCENT' ? (Number(c.fallback_procent)).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + '%' : 'recepcja wpisze ręcznie']];
      pary.push(['Zaokrąglenie', etykietaZaokr(c.zaokraglenie)]);
      podsum.innerHTML = '';
      pary.forEach(function (p) { var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = p[0]; dd.textContent = p[1]; podsum.appendChild(dt); podsum.appendChild(dd); });
    }
    function wyczysc(tekst) { kwota.textContent = '—'; wzor.textContent = ''; uwaga.textContent = tekst || ''; }

    function przeliczPodglad() {
      clearTimeout(timer);
      var bilet = ++kolejka;
      if (!zapisane) { wyczysc(''); return; }
      pokazPodsumowanie(zapisane);
      var k = kwotaZPola(przyklad.value);
      if (!(k > 0)) { wyczysc('Wpisz poprawną kwotę przykładu (np. 195,00).'); return; }
      var tenant = (typeof window.uz_tenantId === 'function') ? window.uz_tenantId() : '';
      if (!tenant) { wyczysc('Podgląd niedostępny bez zalogowanego salonu.'); return; }
      timer = setTimeout(function () {
        fetch('/api/ustawienia/zadatki/oblicz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('boczki_session_token') || '' },
          body: JSON.stringify({ tenant_id: tenant, kwota_zabiegu: k })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (bilet !== kolejka) return;
          if (!d || d.status !== 'success') { wyczysc('Nie udało się wyliczyć podglądu' + (d && d.message ? ': ' + d.message : '.')); return; }
          var z = Number(d.zadatek_proponowany) || 0;
          if (d.tryb === 'KWOTOWY_FALLBACK' && z === 0) { kwota.textContent = '—'; wzor.textContent = ''; uwaga.textContent = d.opis || 'Brak progu dla tej kwoty — recepcja wpisze ręcznie.'; }
          else { kwota.textContent = pl(z); wzor.textContent = d.opis ? d.opis + ' = ' + pl(z) : ''; uwaga.textContent = ''; }
          if (zmienione()) uwaga.textContent = (uwaga.textContent ? uwaga.textContent + ' ' : '') + 'Formularz ma niezapisane zmiany — podgląd liczy według ustawień zapisanych w Estelio. Zapisz, aby zobaczyć nowe.';
        }).catch(function () { if (bilet === kolejka) wyczysc('Brak połączenia — nie udało się wyliczyć podglądu.'); });
      }, 220);
    }

    // kafle → select (źródło prawdy dla uz_zapisz); select → kafle (gdyby zmienił się inną drogą)
    kafle.forEach(function (r) { r.addEventListener('change', function () { if (r.checked) { zaokr.value = r.value; odswiezFormularz(); przeliczPodglad(); } }); });
    zaokr.addEventListener('change', function () { odswiezFormularz(); przeliczPodglad(); });
    [tryb, powyzej].forEach(function (el) { el.addEventListener('change', function () { odswiezFormularz(); przeliczPodglad(); }); });
    [procent, fallback].forEach(function (el) { el.addEventListener('input', function () { odswiezFormularz(); przeliczPodglad(); }); });
    przyklad.addEventListener('input', przeliczPodglad);
    przyklad.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });

    // hooki wołane z index.html (jedna linia w wczytajUstawieniaZadatkow i uz_zapisz) — tylko odświeżenie prezentacji
    window.ZADATKI_PREZENTACJA = {
      poOdczycie: function (d) { zapisane = d && d.config ? d.config : null; odswiezFormularz(); przeliczPodglad(); },
      poZapisie: function () { zapisane = biezacy(); odswiezFormularz(); przeliczPodglad(); }
    };
    odswiezFormularz();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
