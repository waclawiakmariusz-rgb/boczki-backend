// Przyjęcie towaru (Kosmetyki) — warstwa prezentacji dodana przy redesignie 22.10.2026
// (makieta: docs/redesign/Estelio_Przyjecie_Towaru_Kod_2026-10-19).
//
// Ten plik NIE dotyka zapisu. Nie ma tu żadnego fetch, POST-a ani walidacji danych.
// Zapis nadal wykonuje dodajProdukt() z index.html, z tym samym payloadem co przed redesignem.
// Tu są tylko trzy rzeczy, które makieta pokazuje, a stary formularz nie miał:
//   1. przyciski −/+ przy liczbie sztuk (zmieniają wartość pola, które użytkownik i tak mógł wpisać ręcznie),
//   2. karta „Podsumowanie” — podgląd liczba sztuk × cena brutto, liczony w groszach, bez dodawania VAT,
//   3. przycisk „Anuluj” — powrót do Stanu Magazynowego, z pytaniem o odrzucenie zmian, gdy coś już wpisano.
(function () {
  'use strict';
  var pola = null, podsum = null, przyciskMinus = null;

  function $(id) { return document.getElementById(id); }
  function zl(grosze) { return (grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'; }

  // Pole type=number oddaje '' dla niepoprawnego wpisu, więc tu zostaje tylko sprawdzenie zakresu.
  function liczbaSztuk() {
    var v = String(pola.ilosc.value || '').trim();
    if (!/^\d+$/.test(v)) return null;
    var n = Number(v);
    return n >= 1 ? n : null;
  }
  function groszeBrutto() {
    var v = String(pola.brutto.value || '').trim().replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
    var g = Math.round(parseFloat(v) * 100);
    return g > 0 ? g : null;
  }
  function tekstTypu() {
    var o = pola.typ.options[pola.typ.selectedIndex];
    return o ? o.textContent : '';
  }

  function odswiezPodsumowanie() {
    var marka = pola.firma.value, model = pola.model.value;
    var n = liczbaSztuk(), g = groszeBrutto();
    podsum.model.textContent = model ? model : 'Wybierz produkt';
    podsum.marka.textContent = marka ? marka : '—';
    podsum.typ.textContent = model ? tekstTypu() : '—';
    podsum.ilosc.textContent = n === null ? '—' : String(n);
    podsum.brutto.textContent = g === null ? '—' : zl(g);
    if (n === null || g === null) {
      podsum.suma.textContent = '—';
      podsum.dzialanie.textContent = 'Uzupełnij ilość i cenę brutto.';
    } else {
      podsum.suma.textContent = zl(n * g);
      podsum.dzialanie.textContent = n + ' szt. × ' + zl(g);
    }
    przyciskMinus.disabled = n === null || n <= 1;
  }

  function krokIlosci(kierunek) {
    var surowe = String(pola.ilosc.value || '').trim();
    var n = liczbaSztuk();
    // Wpisane, ale niepoprawne (np. 0 albo ułamek) — nie zgadujemy, co użytkownik chciał; zostawiamy mu pole.
    if (n === null && surowe) { pola.ilosc.focus(); return; }
    var nast = n === null ? 1 : n + kierunek;
    if (nast < 1) return;
    pola.ilosc.value = String(nast);
    odswiezPodsumowanie();
  }

  function cosWpisano() {
    return !!(pola.firma.value || pola.model.value || pola.ilosc.value || pola.waznosc.value || pola.netto.value || pola.brutto.value || pola.typ.selectedIndex !== 0);
  }

  function anuluj() {
    if (cosWpisano() && !window.confirm('Odrzucić wprowadzone zmiany?\n\nDane tego przyjęcia nie zostały zapisane.')) return;
    // Czyszczenie jak po udanym zapisie w dodajProdukt(): reset formularza, lista modeli do stanu wyjściowego, nazwa z generujNazwe().
    var form = $('nowy').querySelector('form');
    form.reset();
    pola.model.innerHTML = '<option value="">--</option>';
    pola.model.disabled = true;
    if (typeof window.generujNazwe === 'function') window.generujNazwe();
    odswiezPodsumowanie();
    var przyciskMenu = document.querySelector('.sidebar button[onclick*="pokaz(\'magazyn\'"]');
    if (typeof window.pokaz === 'function') window.pokaz('magazyn', przyciskMenu || null);
  }

  function start() {
    var sekcja = $('nowy');
    if (!sekcja || sekcja.dataset.prezentacjaGotowa === '1') return;
    pola = { firma: $('n_firma'), model: $('n_model'), typ: $('n_typ'), ilosc: $('n_ilosc'), waznosc: $('n_waznosc'), netto: $('n_netto'), brutto: $('n_brutto') };
    podsum = {};
    sekcja.querySelectorAll('[data-podsumowanie]').forEach(function (el) { podsum[el.getAttribute('data-podsumowanie')] = el; });
    przyciskMinus = sekcja.querySelector('[data-krok="-1"]');
    var przyciskPlus = sekcja.querySelector('[data-krok="1"]');
    var przyciskAnuluj = sekcja.querySelector('[data-anuluj]');
    var form = sekcja.querySelector('form');
    for (var k in pola) if (!pola[k]) return;
    if (!przyciskMinus || !przyciskPlus || !przyciskAnuluj || !form || !podsum.suma) return;

    // Jedno podpięcie na stałe elementy — wejście/wyjście z widoku nie rejestruje zdarzeń ponownie.
    sekcja.dataset.prezentacjaGotowa = '1';
    Object.keys(pola).forEach(function (k) {
      pola[k].addEventListener('input', odswiezPodsumowanie);
      pola[k].addEventListener('change', odswiezPodsumowanie);
    });
    przyciskMinus.addEventListener('click', function () { krokIlosci(-1); });
    przyciskPlus.addEventListener('click', function () { krokIlosci(1); });
    przyciskAnuluj.addEventListener('click', anuluj);
    // form.reset() w dodajProdukt() po zapisie — podsumowanie ma wrócić do stanu „Wybierz produkt”.
    form.addEventListener('reset', function () { setTimeout(odswiezPodsumowanie, 0); });
    odswiezPodsumowanie();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
