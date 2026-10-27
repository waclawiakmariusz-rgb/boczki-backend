// Zadania na Pulpicie — warstwa widoku po redesignie 26.10.2026 (docs/redesign/Estelio_Zadania_Lekki_Nowy_2026-10-26_v2).
// Nadpisuje funkcje widgetu z index.html (ds_zd_renderTabs / renderList / renderTaskCard / toggleMore / ds_zadanieComplete /
// updateCollapsedSummary / applyCollapseState) oraz zd_addOpen / zd_editOpen / zd_save formularza. Dane nadal pobiera
// ds_loadZadania (window.__ds_zd_all, __ds_zd_szablony, __ds_zd_isRecepcja); zapisy idą przez zd_apiCall do routes/zadania.js.
// Zasady: jedna lista (domyślnie Wszystkie), rodzaj TELEFON / DO_ZROBIENIA, wielokategorie zachowane (chip + „+N”),
// „Tylko moje” = przypisane do mnie (nie autorstwo), wszystko przez escHtml, numer bez tel: gdy pusty.
(function () {
  'use strict';
  var F = { rodzaj: 'ALL', moje: false, obszar: 'ALL', q: '' };   // filtry widgetu (reset przy nowym otwarciu Pulpitu)
  var rozwiniete = {};        // grupa → true (pokaż wszystkie wiersze)
  var otwarte = null;         // id zadania z otwartymi szczegółami
  var szukajTimer = null, lead = {};   // cache statusu leada {id: {status,kampania}}
  var OBSZAR = { KLIENT: 'Klient', MAGAZYN: 'Magazyn', KOSMETYK: 'Kosmetyk', SPRZEDAZ: 'Sprzedaż', INNE: 'Inne' };
  var OBSZAR_KOLEJNOSC = ['KLIENT', 'MAGAZYN', 'KOSMETYK', 'SPRZEDAZ', 'INNE'];
  var PRI = { PILNY: 0, WAZNY: 1, NORMALNY: 2 };
  var WYNIK_NAZWA = { UMOWIONA: 'Umówiona', NIE_ODEBRALA: 'Nie odebrała', NIE_ZAINTERESOWANA: 'Nie zainteresowana' };

  function esc(v) { return (typeof escHtml === 'function') ? escHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function $(id) { return document.getElementById(id); }
  function ls(k) { return localStorage.getItem(k) || ''; }
  function mojeImie() { return ls('boczki_pracownik_imie').trim().toLowerCase(); }
  function mojaRola() { return ls('boczki_pracownik_rola').trim().toLowerCase(); }
  function jestManager() { return ['admin', 'megaadmin', 'manager'].indexOf(mojaRola()) !== -1; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function lokalnyISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dataDnia(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function telDoWybierania(t) { return String(t || '').replace(/[^\d+]/g, ''); }
  function powiadom(typ, tytul, tekst) { if (typeof pokazPowiadomienie === 'function') pokazPowiadomienie(typ, tytul, tekst || ''); else if (typ === 'error') alert(tekst || tytul); }

  // ── dane pomocnicze zadania ───────────────────────────────────────────────
  function kategorie(z) { var k = (Array.isArray(z.kategorie) && z.kategorie.length) ? z.kategorie : [z.kategoria || 'INNE']; return k.slice().sort(function (a, b) { return OBSZAR_KOLEJNOSC.indexOf(a) - OBSZAR_KOLEJNOSC.indexOf(b); }); }
  function przypisani(z) { return (Array.isArray(z.przypisani) && z.przypisani.length) ? z.przypisani : (z.przypisane_do ? [z.przypisane_do] : []); }
  function jestMoje(z) {
    var ja = mojeImie(), rola = mojaRola();
    if (!ja) return false;
    return przypisani(z).some(function (p) { p = String(p || '').trim().toLowerCase(); return p === ja || (p === rola && ['recepcja', 'praktykantka', 'kosmetolog'].indexOf(p) !== -1); });
  }
  function rodzaj(z) { return z.rodzaj === 'TELEFON' ? 'TELEFON' : 'DO_ZROBIENIA'; }
  function grupa(z, teraz) {
    if (!z.deadline) return 'bez';
    var d = new Date(z.deadline); if (isNaN(d)) return 'bez';
    if (d.getTime() < teraz.getTime()) return 'po';
    return dataDnia(d) === dataDnia(teraz) ? 'dzis' : 'plan';
  }
  function terminTekst(z, teraz) {
    if (!z.deadline) return 'Bez terminu';
    var d = new Date(z.deadline); if (isNaN(d)) return 'Bez terminu';
    var dzien = dataDnia(d) === dataDnia(teraz) ? 'Dziś' : (pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + (d.getFullYear() !== teraz.getFullYear() ? '.' + d.getFullYear() : ''));
    var godz = (d.getHours() || d.getMinutes()) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : 'cały dzień';
    return dzien + ' · ' + godz + (d.getTime() < teraz.getTime() ? ' · po terminie' : '');
  }
  function pasuje(z) {
    if (F.moje && !jestMoje(z)) return false;
    if (F.obszar !== 'ALL' && kategorie(z).indexOf(F.obszar) === -1) return false;
    if (F.q) {
      var pola = [z.tytul, z.opis, z.kontakt_nazwa, z.telefon, z.klient_nazwa].concat(przypisani(z), (Array.isArray(z.klienci) ? z.klienci : []).map(function (k) { return k.nazwa; }), kategorie(z).map(function (k) { return OBSZAR[k] || k; }));
      if (!pola.filter(Boolean).map(function (s) { return String(s).toLowerCase(); }).join(' | ').includes(F.q)) return false;
    }
    return true;
  }
  function sortuj(a, b) {
    var da = a.deadline ? new Date(a.deadline).getTime() : Infinity, db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (da !== db) return da - db;
    var pa = PRI[a.priorytet] != null ? PRI[a.priorytet] : 2, pb = PRI[b.priorytet] != null ? PRI[b.priorytet] : 2;
    if (pa !== pb) return pa - pb;
    return String(a.id).localeCompare(String(b.id));
  }

  // ── nagłówek / zwijanie ───────────────────────────────────────────────────
  window.ds_zd_applyCollapseState = function () {
    var body = $('ds-zadania-body'), btn = $('ds-zadania-chevron');
    if (!body) return;
    var zwiniete = localStorage.getItem('ds_zadania_collapsed') === '1';
    body.style.display = zwiniete ? 'none' : '';
    if (btn) { btn.setAttribute('aria-expanded', zwiniete ? 'false' : 'true'); btn.setAttribute('aria-label', zwiniete ? 'Rozwiń zadania' : 'Zwiń zadania'); }
  };
  window.ds_zd_updateCollapsedSummary = function () {
    var el = $('ds-zadania-summary'); if (!el) return;
    var all = window.__ds_zd_all || [], teraz = new Date();
    if (!all.length) { el.textContent = 'Brak aktywnych zadań'; return; }
    var tel = 0, po = 0, dzis = 0;
    all.forEach(function (z) { if (rodzaj(z) === 'TELEFON') tel++; var g = grupa(z, teraz); if (g === 'po') po++; if (g === 'dzis') dzis++; });
    el.textContent = tel + ' ' + (tel === 1 ? 'telefon' : (tel >= 2 && tel <= 4 ? 'telefony' : 'telefonów')) + ' · ' + po + ' po terminie · ' + dzis + ' na dziś';
  };

  // ── filtry ────────────────────────────────────────────────────────────────
  window.ds_zd_setRodzaj = function (r) { F.rodzaj = r; rozwiniete = {}; render(); };
  window.ds_zd_setTab = function (r) { window.ds_zd_setRodzaj(r === 'TELEFON' || r === 'DO_ZROBIENIA' ? r : 'ALL'); };
  window.ds_zd_setMoje = function (v) { F.moje = !!v; rozwiniete = {}; render(); };
  window.ds_zd_setObszar = function (v) { F.obszar = OBSZAR[v] ? v : 'ALL'; rozwiniete = {}; render(); };
  window.ds_zd_setSearch = function (q) { clearTimeout(szukajTimer); szukajTimer = setTimeout(function () { F.q = String(q || '').trim().toLowerCase(); rozwiniete = {}; render(); }, 250); };
  window.ds_zd_clearFilters = function () {
    F = { rodzaj: 'ALL', moje: false, obszar: 'ALL', q: '' }; rozwiniete = {};
    var m = $('ds-zadania-moje'), o = $('ds-zadania-obszar'), s = $('ds-zadania-search');
    if (m) m.checked = false; if (o) o.value = 'ALL'; if (s) s.value = '';
    render();
  };
  window.ds_zd_toggleGroup = function (g) { rozwiniete[g] = !rozwiniete[g]; render(); };
  window.ds_zd_toggleSzablony = function () {
    var box = $('ds-zadania-szablony'); if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    var sz = window.__ds_zd_szablony || [];
    box.innerHTML = '<h5>Szablony cykliczne (' + sz.length + ')</h5>' + (sz.length ? '<ul>' + sz.map(function (s) {
      return '<li><b>' + esc(s.tytul) + '</b> · ' + esc(cyklOpis(s)) + (przypisani(s).length ? ' · ' + esc(przypisani(s).join(', ')) : '') + (jestManager() ? ' <button type="button" class="et-link" onclick="ds_zd_actionEdit(\'' + esc(s.id) + '\')">Edytuj</button>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="et-foot-note">Brak szablonów — utwórz zadanie z opcją „Powtarzaj” w sekcji „Więcej”.</p>');
    box.hidden = false;
  };
  function cyklOpis(z) {
    var co = parseInt(z.powtarzaj_co, 10) || 1, dni = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd'];
    if (z.powtarzaj === 'CODZIENNIE') return 'codziennie';
    if (z.powtarzaj === 'TYGODNIOWO') return (co === 1 ? 'co tydzień' : 'co ' + co + ' tyg.') + ' (' + (dni[Number(z.powtarzaj_dzien) - 1] || '?') + ')';
    if (z.powtarzaj === 'MIESIECZNIE') return (co === 1 ? 'co miesiąc' : 'co ' + co + ' mies.') + ' (' + (Number(z.powtarzaj_dzien) === 99 ? 'ostatni dzień' : z.powtarzaj_dzien + '.') + ')';
    return 'cykl';
  }

  // ── render ────────────────────────────────────────────────────────────────
  window.ds_zd_renderTabs = function () { render(); };
  window.ds_zd_renderList = function () { render(); };
  function render() {
    var all = window.__ds_zd_all || [], teraz = new Date();
    var tabs = $('ds-zadania-tabs'), list = $('ds-zadania-list'), zakres = $('ds-zadania-zakres'), clearBtn = $('ds-zadania-clear'), szBtn = $('ds-zadania-szablony-btn');
    if (!tabs || !list) return;
    var baza = all.filter(pasuje);
    var n = { ALL: baza.length, TELEFON: 0, DO_ZROBIENIA: 0 };
    baza.forEach(function (z) { n[rodzaj(z)]++; });
    tabs.innerHTML = [['ALL', 'Wszystkie', 'Wszystko'], ['TELEFON', 'Telefony', 'Telefony'], ['DO_ZROBIENIA', 'Do zrobienia', 'Zrobić']].map(function (s) {
      return '<button type="button" class="et-seg" role="radio" aria-checked="' + (F.rodzaj === s[0]) + '" onclick="ds_zd_setRodzaj(\'' + s[0] + '\')"><span class="et-seg-long">' + s[1] + '</span><span class="et-seg-short">' + s[2] + '</span> <b>' + n[s[0]] + '</b></button>';
    }).join('');
    var sz = window.__ds_zd_szablony || [];
    if (szBtn) { szBtn.style.display = ''; szBtn.textContent = 'Szablony cykliczne (' + sz.length + ')'; }
    var widoczne = baza.filter(function (z) { return F.rodzaj === 'ALL' || rodzaj(z) === F.rodzaj; });
    var opisWidoku = (F.moje ? 'Przypisane do mnie' : (F.rodzaj === 'TELEFON' ? 'Telefony' : F.rodzaj === 'DO_ZROBIENIA' ? 'Do zrobienia' : 'Wszystkie aktywne')) + (F.obszar !== 'ALL' ? ' · ' + OBSZAR[F.obszar] : '') + (F.q ? ' · „' + F.q + '”' : '');
    if (zakres) zakres.textContent = opisWidoku + ' · ' + widoczne.length + ' z ' + all.length + ' zadań';
    if (clearBtn) clearBtn.hidden = !(F.moje || F.obszar !== 'ALL' || F.q || F.rodzaj !== 'ALL');
    window.ds_zd_updateCollapsedSummary(); window.ds_zd_applyCollapseState();
    if (!all.length) { list.innerHTML = pusty('Brak aktywnych zadań', 'Wszystkie zadania są zrobione.', $('ds-zadania-add-btn') && $('ds-zadania-add-btn').style.display !== 'none' ? '<button type="button" class="et-primary" onclick="zd_addOpen()">+ Nowe zadanie</button>' : ''); return; }
    if (!widoczne.length) {
      list.innerHTML = F.moje && !F.q && F.obszar === 'ALL'
        ? pusty('Nie masz przypisanych zadań', 'W zespole jest ' + all.length + ' aktywnych zadań.', '<button type="button" class="et-btn" onclick="ds_zd_setMoje(false); document.getElementById(\'ds-zadania-moje\').checked=false;">Pokaż zadania zespołu</button>')
        : pusty('Brak zadań dla tych filtrów', 'Zmień filtry lub wpisane wyszukiwanie.', '<button type="button" class="et-btn" onclick="ds_zd_clearFilters()">Wyczyść filtry</button>');
      return;
    }
    var grupy = [['po', 'Po terminie'], ['dzis', 'Na dziś'], ['plan', 'Zaplanowane'], ['bez', 'Bez terminu']];
    list.innerHTML = grupy.map(function (g) {
      var wiersze = widoczne.filter(function (z) { return grupa(z, teraz) === g[0]; }).sort(sortuj);
      if (!wiersze.length) return '';
      var pokaz = rozwiniete[g[0]] ? wiersze : wiersze.slice(0, 4);
      return '<section class="et-group"><div class="et-group-head"><h4 class="' + (g[0] === 'po' ? 'et-overdue-title' : '') + '">' + g[1] + ' · ' + wiersze.length + '</h4>' +
        (wiersze.length > 4 ? '<button type="button" class="et-link" onclick="ds_zd_toggleGroup(\'' + g[0] + '\')">' + (rozwiniete[g[0]] ? 'Zwiń listę' : 'Pokaż pozostałe ' + (wiersze.length - 4)) + '</button>' : '') +
        '</div>' + pokaz.map(function (z) { return window.ds_zd_renderTaskCard(z, !!window.__ds_zd_isRecepcja, mojaRola() === 'praktykantka', teraz.getTime()); }).join('') + '</section>';
    }).join('') + '<p class="et-foot-note">Obszary, przypisania i komentarze są w szczegółach zadania (kliknij tytuł).</p>';
  }
  function pusty(t, p, akcja) { return '<div class="et-empty"><span class="et-round" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg></span><h4>' + esc(t) + '</h4><p>' + esc(p) + '</p>' + (akcja || '') + '</div>'; }

  var IKONA_TEL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>';
  var IKONA_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  window.ds_zd_renderTaskCard = function (z, isReceiver, isPraktykantka, nowMs) {
    var teraz = new Date(nowMs || Date.now()), tel = rodzaj(z) === 'TELEFON', kat = kategorie(z), id = esc(z.id);
    var utworzylJa = z.utworzone_przez && String(z.utworzone_przez).trim().toLowerCase() === mojeImie();
    // Ticket #17 (26.10.2026): recepcja edytuje zadania własne ORAZ do niej przypisane; usuwanie zostaje dla autora/managera
    var mozeMenu = jestManager() || (mojaRola() === 'recepcja' && (utworzylJa || jestMoje(z)));
    var mozeUsunac = jestManager() || (mojaRola() === 'recepcja' && utworzylJa);
    var mozeWykonac = isReceiver && !z.is_szablon;
    var mozeTelefon = (mozeWykonac || mozeMenu) && tel && !z.is_szablon;
    var mozePrzelozyc = (mozeWykonac || mozeMenu) && !z.is_szablon;   // termin przekłada każdy, kto może zadanie wykonać
    var meta = '';
    if (tel) meta += z.telefon ? '<a class="et-call" href="tel:' + esc(telDoWybierania(z.telefon)) + '" onclick="event.stopPropagation()">' + IKONA_TEL + 'Zadzwoń · ' + esc(z.telefon) + '</a>' : (mozeMenu ? '<button type="button" class="et-call et-call-brak" onclick="ds_zd_actionEdit(\'' + id + '\')">Brak numeru — dodaj</button>' : '<span class="et-call et-call-brak">Brak numeru</span>');
    meta += '<span class="et-chip et-chip-' + esc(kat[0]) + '">' + esc(OBSZAR[kat[0]] || kat[0]) + '</span>';
    if (kat.length > 1) meta += '<button type="button" class="et-chip" onclick="ds_zd_toggleDetails(\'' + id + '\')" aria-label="Pokaż wszystkie obszary">+' + (kat.length - 1) + '</button>';
    if (!z.is_szablon) meta += '<span class="et-date ' + (grupa(z, teraz) === 'po' ? 'et-overdue' : '') + '">' + esc(terminTekst(z, teraz)) + '</span>';
    if (z.priorytet && z.priorytet !== 'NORMALNY') meta += '<span class="et-chip et-chip-pri">' + (z.priorytet === 'PILNY' ? 'Pilne' : 'Ważne') + '</span>';
    if (z.is_szablon || z.parent_powtarzajacy_id) meta += '<span class="et-chip et-chip-cykl">' + esc(cyklOpis(z)) + '</span>';
    var extra = [];
    if (z.kontakt_typ === 'LEAD') extra.push('<span>Lead · ' + esc(z.kontakt_nazwa || '') + '</span>');
    else if (z.kontakt_typ === 'KLIENT') extra.push('<span>Klientka · ' + esc(z.kontakt_nazwa || '') + '</span>');
    if (z.prob_kontaktu > 0) extra.push('<span>' + z.prob_kontaktu + ' ' + (z.prob_kontaktu === 1 ? 'próba kontaktu' : 'próby kontaktu') + '</span>');
    if (z.komentarzy > 0) extra.push('<button type="button" class="et-link" onclick="zd_openComments(\'' + id + '\', \'' + esc(String(z.tytul || '').replace(/'/g, '’')) + '\')">Komentarze (' + z.komentarzy + ')</button>');
    var akcje = '';
    if (mozeWykonac) akcje += '<button type="button" class="et-btn et-done-btn" onclick="ds_zadanieComplete(\'' + id + '\')">Zrobione</button>';
    if (mozePrzelozyc) akcje += '<div class="et-popover-wrap"><button type="button" class="et-btn et-later" onclick="ds_zd_later(\'' + id + '\', this)">' + (tel ? 'Oddzwonić później' : 'Przełóż termin') + ' ⌄</button></div>';
    if (mozeMenu || mozeTelefon || mozePrzelozyc) akcje += '<div class="et-popover-wrap"><button type="button" class="et-btn et-menu" onclick="ds_zd_toggleMore(\'' + id + '\', this)" aria-label="Opcje zadania: ' + esc(z.tytul) + '">⋮</button></div>';
    return '<article class="et-task et-task-' + (tel ? 'tel' : 'zad') + '" data-id="' + id + '">' +
      '<span class="et-round" aria-hidden="true">' + (tel ? IKONA_TEL : IKONA_OK) + '</span>' +
      '<div class="et-main"><button type="button" class="et-title" onclick="ds_zd_toggleDetails(\'' + id + '\')" aria-expanded="' + (otwarte === z.id) + '">' + esc(z.tytul) + '</button>' +
      '<div class="et-meta">' + meta + '</div>' + (extra.length ? '<div class="et-extra">' + extra.join('') + '</div>' : '') + '</div>' +
      '<div class="et-actions">' + akcje + '</div>' +
      (otwarte === z.id ? szczegoly(z, mozeTelefon) : '') + '</article>';
  };

  function szczegoly(z, mozeTelefon) {
    var tel = rodzaj(z) === 'TELEFON', id = esc(z.id);
    var lewa = '<div><h5>Szczegóły ' + (tel ? 'telefonu' : 'zadania') + '</h5><p>' + (z.opis ? esc(z.opis) : '<span class="et-muted">Brak opisu.</span>') + '</p>' +
      '<p>' + kategorie(z).map(function (k) { return '<span class="et-chip et-chip-' + esc(k) + '">' + esc(OBSZAR[k] || k) + '</span> '; }).join('') + '</p>' +
      '<p class="et-kv">Przypisane: <b>' + (przypisani(z).length ? esc(przypisani(z).join(', ')) : 'brak') + '</b><br>Priorytet: <b>' + esc(z.priorytet === 'PILNY' ? 'Pilny' : z.priorytet === 'WAZNY' ? 'Ważny' : 'Normalny') + '</b>' + (z.utworzone_przez ? '<br>Utworzone przez: <b>' + esc(z.utworzone_przez) + '</b>' : '') + '</p>';
    if (z.kontakt_typ) {
      var L = lead[z.kontakt_id];
      lewa += '<p class="et-kv">Powiązanie: <b>' + (z.kontakt_typ === 'LEAD' ? 'Lead' : 'Klientka') + ' · ' + esc(z.kontakt_nazwa || '') + '</b> <button type="button" class="et-link" onclick="ds_zd_otworzKontakt(\'' + esc(z.kontakt_typ) + '\', \'' + esc(z.kontakt_id) + '\')">Otwórz ↗</button>' +
        (z.kontakt_typ === 'LEAD' ? '<br>Status leada: <b id="et-lead-status-' + id + '">' + (L ? esc(L.status || '—') + (L.kampania ? ' · ' + esc(L.kampania) : '') : '…') + '</b>' : '') + '</p>';
    }
    if (Array.isArray(z.klienci) && z.klienci.length) lewa += '<p class="et-kv">Klientki: ' + z.klienci.map(function (k) { return '<button type="button" class="et-link" onclick="zd_otworzKlienta(\'' + esc(k.id) + '\')">' + esc(k.nazwa) + '</button>'; }).join(' ') + '</p>';
    if (Array.isArray(z.magazyn_pozycje) && z.magazyn_pozycje.length) lewa += '<p class="et-kv">Produkty: <b>' + esc(z.magazyn_pozycje.map(function (p) { return p.nazwa_produktu; }).join(', ')) + '</b></p>';
    lewa += '<p><button type="button" class="et-btn" onclick="zd_openComments(\'' + id + '\', \'' + esc(String(z.tytul || '').replace(/'/g, '’')) + '\')">Komentarze' + (z.komentarzy ? ' (' + z.komentarzy + ')' : '') + '</button></p>';
    lewa += '<h5>Historia</h5><ul class="et-historia" id="et-historia-' + id + '"><li class="et-muted">Ładowanie…</li></ul></div>';
    var prawa = '';
    if (tel && mozeTelefon) {
      var jutro = new Date(); jutro.setDate(jutro.getDate() + 1); jutro.setHours(10, 0, 0, 0);
      prawa = '<div><form class="et-wynik-form" onsubmit="event.preventDefault(); ds_zd_wynikZapisz(\'' + id + '\', this)"><h5>Wynik rozmowy <span class="pk-slot" data-pomoc="zadania.telefon" data-pomoc-nazwa="Wynik rozmowy"></span></h5>' +
        '<div class="et-wynik">' + ['UMOWIONA', 'NIE_ODEBRALA', 'NIE_ZAINTERESOWANA'].map(function (w) { return '<label><input type="radio" name="et-wynik-' + id + '" value="' + w + '" required onchange="ds_zd_wynikZmiana(\'' + id + '\', this.form)">' + WYNIK_NAZWA[w] + '</label>'; }).join('') + '</div>' +
        '<textarea class="et-textarea" name="notatka" maxlength="2000" placeholder="Notatka z rozmowy (opcjonalnie)" aria-label="Notatka z rozmowy"></textarea>' +
        '<div class="et-kolejny" hidden><span class="et-label">Kolejny kontakt</span><select name="kolejny" class="et-area" onchange="this.form.querySelector(\'[name=kolejny_custom]\').hidden = this.value !== \'custom\'"><option value="jutro">Jutro 10:00</option><option value="custom">Wybierz termin</option><option value="keep">Zachowaj obecny termin</option></select> <input type="datetime-local" name="kolejny_custom" value="' + lokalnyISO(jutro) + '" hidden aria-label="Własny termin kolejnego kontaktu"></div>' +
        '<p class="et-wynik-hint">Wybierz wynik, aby zobaczyć skutek zapisu.</p>' +
        '<button type="submit" class="et-btn et-primary-sm">Zapisz i zamknij</button></form></div>';
    }
    return '<div class="et-details">' + lewa + prawa + '</div>';
  }

  window.ds_zd_toggleDetails = function (id) {
    otwarte = (otwarte === id) ? null : id;
    render();
    if (otwarte !== id) return;
    var z = (window.__ds_zd_all || []).find(function (x) { return x.id === id; }); if (!z) return;
    zd_apiCall({ action: 'historia', id: id }).then(function (r) {
      var ul = $('et-historia-' + id); if (!ul) return;
      var rows = (r && r.status === 'success') ? (r.data || []) : [];
      ul.innerHTML = rows.length ? rows.map(function (h) {
        var kiedy = h.data ? new Date(h.data) : null, kiedyTxt = kiedy && !isNaN(kiedy) ? pad(kiedy.getDate()) + '.' + pad(kiedy.getMonth() + 1) + ' ' + pad(kiedy.getHours()) + ':' + pad(kiedy.getMinutes()) : '';
        var co = h.typ === 'TERMIN' ? 'Przełożono na ' + esc(h.kolejny_termin ? terminTekst({ deadline: h.kolejny_termin }, new Date()) : '') : (WYNIK_NAZWA[h.wynik] || esc(h.wynik || '')) + (h.notatka ? ' — ' + esc(h.notatka) : '') + (h.kolejny_termin ? ' · kolejny kontakt ' + esc(terminTekst({ deadline: h.kolejny_termin }, new Date())) : '') + (h.lead_status_po && h.lead_status_po !== h.lead_status_przed ? ' · lead: ' + esc(h.lead_status_przed) + ' → ' + esc(h.lead_status_po) : '');
        return '<li>' + esc(h.autor || '') + ' · ' + kiedyTxt + ' · ' + co + '</li>';
      }).join('') : '<li class="et-muted">Brak wpisów.</li>';
    }).catch(function () { var ul = $('et-historia-' + id); if (ul) ul.innerHTML = '<li class="et-muted">Nie udało się pobrać historii.</li>'; });
    if (z.kontakt_typ === 'LEAD' && z.kontakt_id && !lead[z.kontakt_id] && typeof leady_apiCall === 'function') {
      leady_apiCall({ action: 'get', id: z.kontakt_id }).then(function (r) {
        if (r && r.status === 'success' && r.data) { lead[z.kontakt_id] = { status: r.data.status, kampania: r.data.kampania }; var el = $('et-lead-status-' + esc(id)); if (el) el.textContent = (r.data.status || '—') + (r.data.kampania ? ' · ' + r.data.kampania : ''); }
      }).catch(function () {});
    }
  };
  window.ds_zd_otworzKontakt = function (typ, id) {
    if (typ === 'KLIENT' && typeof zd_otworzKlienta === 'function') return zd_otworzKlienta(id);
    if (typ === 'LEAD') { if (typeof pokaz === 'function') pokaz('leady', null); if (typeof leady_otworzLeada === 'function') setTimeout(function () { leady_otworzLeada(id); }, 300); }
  };
  window.ds_zd_wynikZmiana = function (id, form) {
    var w = form.querySelector('input[name="et-wynik-' + id + '"]:checked'), hint = form.querySelector('.et-wynik-hint'), kol = form.querySelector('.et-kolejny');
    var z = (window.__ds_zd_all || []).find(function (x) { return x.id === id; }) || {};
    var wynik = w ? w.value : '';
    if (kol) kol.hidden = wynik !== 'NIE_ODEBRALA';
    if (!hint) return;
    if (wynik === 'NIE_ODEBRALA') hint.textContent = 'Zadanie pozostanie aktywne. ' + (z.kontakt_typ === 'LEAD' ? 'Status leada nie zmieni się (zapiszemy próbę kontaktu).' : '');
    else if (wynik) {
      var L = lead[z.kontakt_id], mozeZmienic = !L || ['nowy', 'kontakt'].indexOf(String(L.status)) !== -1;
      hint.textContent = 'Zadanie zostanie zakończone.' + (z.kontakt_typ === 'LEAD' ? (mozeZmienic ? ' Status leada: ' + (wynik === 'UMOWIONA' ? 'umówiony.' : 'odrzucony.') : ' Obecny status leada pozostanie bez zmian.') : '') + (wynik === 'UMOWIONA' ? ' To nie tworzy wizyty w terminarzu.' : '');
    } else hint.textContent = 'Wybierz wynik, aby zobaczyć skutek zapisu.';
  };
  window.ds_zd_wynikZapisz = function (id, form) {
    var w = form.querySelector('input[name="et-wynik-' + id + '"]:checked');
    if (!w) { powiadom('error', 'Wybierz wynik rozmowy'); return; }
    var btn = form.querySelector('button[type=submit]'); if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Zapisywanie…';
    var body = { action: 'wynik_rozmowy', id: id, wynik: w.value, notatka: form.querySelector('[name=notatka]').value.trim() };
    if (w.value === 'NIE_ODEBRALA') {
      var sel = form.querySelector('[name=kolejny]').value;
      if (sel === 'jutro') { var j = new Date(); j.setDate(j.getDate() + 1); j.setHours(10, 0, 0, 0); body.kolejny_termin = lokalnyISO(j).replace('T', ' ') + ':00'; }
      else if (sel === 'custom') { var c = form.querySelector('[name=kolejny_custom]').value; if (!c) { btn.disabled = false; btn.textContent = 'Zapisz i zamknij'; powiadom('error', 'Wybierz termin kolejnego kontaktu'); return; } body.kolejny_termin = c.replace('T', ' ') + ':00'; }
    }
    zd_apiCall(body).then(function (r) {
      if (!r || (r.status !== 'success' && !r.zadanie_zakonczone && !r.kolejny_termin)) { btn.disabled = false; btn.textContent = 'Zapisz i zamknij'; powiadom('error', 'Nie udało się zapisać wyniku', r && r.message); return; }
      if (r.status !== 'success') powiadom('error', 'Zapisano częściowo', r.message);
      else powiadom('success', r.zadanie_zakonczone ? 'Zapisano wynik i zakończono zadanie' : 'Zapisano próbę kontaktu — zadanie pozostaje aktywne', WYNIK_NAZWA[r.wynik] || '');
      if (r.lead_status_po) delete lead[(window.__ds_zd_all || []).filter(function (x) { return x.id === id; }).map(function (x) { return x.kontakt_id; })[0]];
      otwarte = null;
      if (r.zadanie_zakonczone) oznaczZrobione(id); else odswiez();
    }).catch(function () { btn.disabled = false; btn.textContent = 'Zapisz i zamknij'; powiadom('error', 'Brak połączenia'); });
  };

  // ── akcje wiersza ─────────────────────────────────────────────────────────
  function zamknijPopovery() { document.querySelectorAll('.estelio-tasks .et-popover').forEach(function (p) { p.remove(); }); }
  function popover(btn, html) {
    zamknijPopovery();
    var pop = document.createElement('div'); pop.className = 'et-popover'; pop.innerHTML = html;
    btn.parentElement.appendChild(pop);
    setTimeout(function () { var out = function (e) { if (!pop.contains(e.target) && e.target !== btn) { pop.remove(); document.removeEventListener('click', out); } }; document.addEventListener('click', out); }, 30);
    return pop;
  }
  window.ds_zd_later = function (id, btn) {
    var za2 = new Date(Date.now() + 2 * 3600000), jutro = new Date(); jutro.setDate(jutro.getDate() + 1); jutro.setHours(10, 0, 0, 0);
    var inny = dataDnia(za2) !== dataDnia(new Date());
    var pop = popover(btn, '<button type="button" data-t="' + lokalnyISO(za2) + '">' + (inny ? 'Za 2 godziny · ' + pad(za2.getDate()) + '.' + pad(za2.getMonth() + 1) + ' ' : 'Dziś za 2 godziny · ') + pad(za2.getHours()) + ':' + pad(za2.getMinutes()) + '</button>' +
      '<button type="button" data-t="' + lokalnyISO(jutro) + '">Jutro · 10:00</button>' +
      '<p>Wybierz termin:</p><div style="padding:0 12px 8px;"><input type="datetime-local" class="et-area" style="width:100%;" value="' + lokalnyISO(jutro) + '" aria-label="Własny termin"> <button type="button" class="et-btn et-primary-sm" style="margin-top:8px; width:100%;" data-custom="1">Zapisz termin</button></div>');
    pop.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { window.ds_zd_przeloz(id, b.getAttribute('data-t')); }; });
    pop.querySelector('[data-custom]').onclick = function () { var v = pop.querySelector('input[type=datetime-local]').value; if (!v) return powiadom('error', 'Wybierz termin'); window.ds_zd_przeloz(id, v); };
  };
  window.ds_zd_przeloz = function (id, lokalny) {
    zamknijPopovery();
    zd_apiCall({ action: 'przeloz', id: id, deadline: String(lokalny).replace('T', ' ') + ':00' }).then(function (r) {
      if (!r || r.status !== 'success') return powiadom('error', 'Nie udało się przełożyć', r && r.message);
      powiadom('success', 'Termin zmieniony — zadanie pozostaje aktywne');
      var z = (window.__ds_zd_all || []).find(function (x) { return x.id === id; }); if (z) z.deadline = r.deadline || (String(lokalny).replace('T', ' ') + ':00');
      render(); odswiez();
    }).catch(function () { powiadom('error', 'Brak połączenia'); });
  };
  window.ds_zd_toggleMore = function (id, btn) {
    if (btn.parentElement.querySelector('.et-popover')) { zamknijPopovery(); return; }
    var z = (window.__ds_zd_all || []).find(function (x) { return x.id === id; }) || (window.__ds_zd_szablony || []).find(function (x) { return x.id === id; }) || {};
    var utworzylJa = z.utworzone_przez && String(z.utworzone_przez).trim().toLowerCase() === mojeImie();
    var mozeMenu = jestManager() || (mojaRola() === 'recepcja' && (utworzylJa || jestMoje(z)));
    var mozeUsunac = jestManager() || (mojaRola() === 'recepcja' && utworzylJa);
    var html = '';
    if (rodzaj(z) === 'TELEFON') html += '<button type="button" onclick="ds_zd_toggleDetails(\'' + esc(id) + '\'); setTimeout(function(){ var f=document.querySelector(\'[data-id=&quot;' + esc(id) + '&quot;] .et-wynik-form input\'); if(f) f.focus(); }, 50)">Zapisz wynik rozmowy</button>' + (z.telefon ? '<button type="button" onclick="ds_zd_copyNumber(\'' + esc(z.telefon) + '\')">Kopiuj numer</button>' : '');
    if (mozeMenu) html += '<button type="button" onclick="ds_zd_actionEdit(\'' + esc(id) + '\')">Edytuj zadanie</button><button type="button" onclick="ds_zd_actionArchive(\'' + esc(id) + '\')">Archiwizuj zadanie</button>';
    if (mozeUsunac) html += '<button type="button" class="et-danger" onclick="ds_zd_actionDelete(\'' + esc(id) + '\')">Usuń</button>';
    if (!mozeMenu) html += '<p>Treść zadania zmienia zleceniodawca' + (utworzylJa ? '' : ' (' + esc(z.utworzone_przez || 'manager') + ')') + '. Termin możesz przełożyć przyciskiem obok.</p>';
    popover(btn, html || '<p>Brak dostępnych opcji.</p>');
  };
  window.ds_zd_copyNumber = function (tel) {
    zamknijPopovery();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tel).then(function () { powiadom('success', 'Skopiowano numer', tel); }, function () { prompt('Skopiuj numer:', tel); });
    else prompt('Skopiuj numer:', tel);
  };
  function oznaczZrobione(id) {
    var card = document.querySelector('.estelio-tasks .et-task[data-id="' + id + '"]');
    if (card) { card.classList.add('et-done'); card.querySelectorAll('.et-actions button').forEach(function (b) { b.disabled = true; }); }
    setTimeout(function () {
      window.__ds_zd_all = (window.__ds_zd_all || []).filter(function (x) { return x.id !== id; });
      var c = $('ds-zadania-count'); if (c) c.textContent = window.__ds_zd_all.length ? '(' + window.__ds_zd_all.length + ')' : '';
      render(); odswiez();
    }, 3000);
  }
  function odswiez() {
    window.__ds_zd_lastLoadedAt = 0;
    if (typeof ds_loadZadania === 'function') ds_loadZadania(ls('boczki_pracownik_rola'), ls('boczki_pracownik_imie'));
    if (typeof zd_refreshSidebarBadge === 'function') zd_refreshSidebarBadge();
  }
  window.ds_zadanieComplete = function (id) {
    if (!confirm('Oznaczyć zadanie jako wykonane?')) return;
    zd_apiCall({ action: 'complete', id: id, wykonane_przez: ls('boczki_pracownik_imie') }).then(function (r) {
      if (!r || r.status !== 'success') return powiadom('error', 'Nie udało się zakończyć zadania', r && r.message);
      oznaczZrobione(id);
    }).catch(function () { powiadom('error', 'Brak połączenia'); });
  };

  // ── formularz: rodzaj / kontakt / numer / szybkie terminy / „Więcej” ─────
  function rodzajFormularza() { var r = document.querySelector('input[name="zd-rodzaj"]:checked'); return r ? r.value : 'DO_ZROBIENIA'; }
  function ustawRodzaj(v) { var r = document.querySelector('input[name="zd-rodzaj"][value="' + v + '"]'); if (r) r.checked = true; window.zd_rodzajChange(); }
  window.zd_rodzajChange = function () {
    var tel = rodzajFormularza() === 'TELEFON', w = $('zd-telefon-wrap'); if (w) w.style.display = tel ? '' : 'none';
    var t = $('zd-tytul'); if (t) t.placeholder = tel ? 'np. Potwierdzić termin konsultacji' : 'np. Sprawdzić terminy ważności kosmetyków';
    // Podpowiedź obszaru tylko gdy użytkownik jeszcze nic nie wybrał poza domyślnym
    if (typeof zd_kategorie !== 'undefined' && Array.isArray(zd_kategorie) && zd_kategorie.length === 1 && (zd_kategorie[0] === 'INNE' || zd_kategorie[0] === 'KLIENT') && !$('zd-edit-id').value) { zd_kategorie = [tel ? 'KLIENT' : 'INNE']; if (typeof zd_renderKategorieBadges === 'function') zd_renderKategorieBadges(); }
  };
  function ustawKontakt(typ, id, nazwa, telefon, opis) {
    $('zd-kontakt-typ').value = typ || ''; $('zd-kontakt-id').value = id || ''; $('zd-kontakt-nazwa').value = nazwa || '';
    var w = $('zd-kontakt-wybrany'), sw = $('zd-kontakt-search-wrap');
    if (typ) { $('zd-kontakt-wybrany-tekst').innerHTML = esc(nazwa) + ' <small>· ' + (typ === 'LEAD' ? 'lead' : 'klientka') + (opis ? ' · ' + esc(opis) : '') + '</small>'; w.hidden = false; sw.style.display = 'none'; if (telefon && !$('zd-telefon').value) $('zd-telefon').value = telefon; }
    else { w.hidden = true; sw.style.display = ''; }
    var res = $('zd-kontakt-results'); if (res) { res.hidden = true; res.innerHTML = ''; }
    var inp = $('zd-kontakt-search'); if (inp) inp.value = '';
  }
  window.zd_kontaktWyczysc = function () { ustawKontakt('', '', '', '', ''); };
  var kontaktTimer = null, kontaktBilet = 0;
  window.zd_kontaktSzukajInput = function () {
    clearTimeout(kontaktTimer);
    var inp = $('zd-kontakt-search'), res = $('zd-kontakt-results'); if (!inp || !res) return;
    var q = inp.value.trim();
    if (q.length < 2) { res.hidden = true; res.innerHTML = ''; return; }
    kontaktTimer = setTimeout(function () {
      var bilet = ++kontaktBilet;
      zd_apiCall({ action: 'kontakt_szukaj', q: q }).then(function (r) {
        if (bilet !== kontaktBilet) return;
        var kl = (r && r.klienci) || [], ld = (r && r.leady) || [];
        if (!kl.length && !ld.length) { res.innerHTML = '<div class="etf-results-tytul">Brak wyników</div>'; res.hidden = false; return; }
        res.innerHTML = (kl.length ? '<div class="etf-results-tytul">Klientki</div>' + kl.map(function (k) { return '<button type="button" data-typ="KLIENT" data-id="' + esc(k.id) + '" data-nazwa="' + esc(k.nazwa) + '" data-tel="' + esc(k.telefon || '') + '">' + esc(k.nazwa) + ' <small>' + esc(k.telefon || 'brak numeru') + '</small></button>'; }).join('') : '') +
          (ld.length ? '<div class="etf-results-tytul">Leady</div>' + ld.map(function (l) { return '<button type="button" data-typ="LEAD" data-id="' + esc(l.id) + '" data-nazwa="' + esc(l.nazwa || 'Lead') + '" data-tel="' + esc(l.telefon || '') + '" data-opis="' + esc((l.kampania ? l.kampania + ' · ' : '') + (l.status || '')) + '">' + esc(l.nazwa || 'Lead') + ' <small>' + esc(l.telefon || 'brak numeru') + (l.kampania ? ' · ' + esc(l.kampania) : '') + '</small></button>'; }).join('') : '');
        res.hidden = false;
        res.querySelectorAll('button').forEach(function (b) { b.onclick = function () { ustawKontakt(b.getAttribute('data-typ'), b.getAttribute('data-id'), b.getAttribute('data-nazwa'), b.getAttribute('data-tel'), b.getAttribute('data-opis')); if (b.getAttribute('data-typ') === 'LEAD' && typeof zd_kategorie !== 'undefined' && zd_kategorie.length === 1 && zd_kategorie[0] === 'KLIENT') { zd_kategorie = ['SPRZEDAZ']; if (typeof zd_renderKategorieBadges === 'function') zd_renderKategorieBadges(); } }; });
      }).catch(function () { res.innerHTML = '<div class="etf-results-tytul">Nie udało się wyszukać</div>'; res.hidden = false; });
    }, 250);
  };
  window.zd_terminSzybki = function (co) {
    var d = $('zd-deadline'), hint = $('zd-termin-hint'), teraz = new Date(), t = new Date();
    if (!d) return;
    if (co === 'brak') { d.value = ''; if (hint) hint.textContent = ''; return; }
    if (co === 'dzis') { t.setHours(16, 0, 0, 0); if (t.getTime() <= teraz.getTime()) { if (hint) hint.textContent = 'Godzina 16:00 już minęła — wybierz inny termin.'; return; } }
    if (co === 'jutro') { t.setDate(t.getDate() + 1); t.setHours(10, 0, 0, 0); }
    if (co === 'tydzien') { var cur = d.value ? new Date(d.value) : null; t.setDate(t.getDate() + 7); if (cur && !isNaN(cur)) t.setHours(cur.getHours(), cur.getMinutes(), 0, 0); else t.setHours(10, 0, 0, 0); }
    d.value = lokalnyISO(t); if (hint) hint.textContent = '';
  };
  function wiecejPodsumowanie() {
    var s = $('zd-wiecej-summary'); if (!s) return;
    var czesci = [];
    if (typeof zd_przypisani !== 'undefined' && zd_przypisani.length) czesci.push('przypisane: ' + zd_przypisani.join(', '));
    var p = $('zd-priorytet'); if (p && p.value !== 'NORMALNY') czesci.push(p.value === 'PILNY' ? 'pilne' : 'ważne');
    var pw = $('zd-powtarzaj'); if (pw && pw.value !== 'NIE') czesci.push('cykliczne');
    s.textContent = czesci.length ? czesci.join(' · ') : 'przypisania, priorytet, opis, klientki, produkty, cykliczność';
  }
  function domyslnePrzypisanie() {
    var ja = ls('boczki_pracownik_imie').trim();
    if (!ja || typeof zd_przypisani === 'undefined' || zd_przypisani.length) return;
    zd_przypisani = [ja];
    var sel = $('zd-przypisane-source');
    if (sel && !Array.from(sel.options).some(function (o) { return o.value === ja; })) { var o = document.createElement('option'); o.value = ja; o.textContent = ja; sel.appendChild(o); }
    if (typeof zd_renderPrzypisaniBadges === 'function') zd_renderPrzypisaniBadges();
  }

  var _addOpen = window.zd_addOpen, _editOpen = window.zd_editOpen;
  window.zd_addOpen = function () {
    if (typeof _addOpen === 'function') _addOpen();
    var ov = $('zd-modal-overlay'); if (!ov || ov.style.display === 'none') return;   // np. brak uprawnień — oryginał nie otworzył
    ustawRodzaj(F.rodzaj === 'TELEFON' ? 'TELEFON' : 'DO_ZROBIENIA');
    ustawKontakt('', '', '', '', ''); $('zd-telefon').value = ''; var h = $('zd-termin-hint'); if (h) h.textContent = '';
    var w = $('zd-wiecej'); if (w) w.open = false;
    setTimeout(domyslnePrzypisanie, 0); setTimeout(domyslnePrzypisanie, 400);
    wiecejPodsumowanie();
    var t = $('zd-tytul'); if (t) t.focus();
  };
  window.zd_editOpen = async function (id) {
    if (typeof _editOpen === 'function') await _editOpen(id);
    var z = (Array.isArray(window.zd_data) ? zd_data : []).find(function (r) { return r.id === id; }) || (window.__ds_zd_all || []).find(function (r) { return r.id === id; }) || (window.__ds_zd_szablony || []).find(function (r) { return r.id === id; });
    if (!z) return;
    ustawRodzaj(rodzaj(z));
    $('zd-telefon').value = z.telefon || '';
    ustawKontakt(z.kontakt_typ || '', z.kontakt_id || '', z.kontakt_nazwa || '', '', '');
    if (z.telefon) $('zd-telefon').value = z.telefon;
    var w = $('zd-wiecej'); if (w) w.open = !!(z.opis || (z.priorytet && z.priorytet !== 'NORMALNY') || (z.powtarzaj && z.powtarzaj !== 'NIE') || (Array.isArray(z.klienci) && z.klienci.length) || (Array.isArray(z.magazyn_pozycje) && z.magazyn_pozycje.length));
    wiecejPodsumowanie();
  };
  window.zd_save = function () {
    var id = $('zd-edit-id').value, tytul = $('zd-tytul').value.trim(), opis = $('zd-opis').value.trim();
    var btn = $('zd-save-btn'); if (btn && btn.disabled) return;
    var rodz = rodzajFormularza(), telefon = $('zd-telefon').value.trim();
    if (!tytul) { powiadom('error', 'Tytuł jest wymagany'); $('zd-tytul').focus(); return; }
    if (!zd_przypisani.length) { var w = $('zd-wiecej'); if (w) w.open = true; powiadom('error', 'Wskaż przynajmniej jedną osobę lub rolę (sekcja „Więcej”)'); return; }
    if (rodz === 'TELEFON' && telefon && !/^[+\d\s()-]{3,30}$/.test(telefon)) { powiadom('error', 'Numer telefonu może zawierać cyfry, spacje, +, nawiasy i myślnik'); $('zd-telefon').focus(); return; }
    var deadlineLocal = $('zd-deadline').value, deadline = deadlineLocal ? deadlineLocal.replace('T', ' ') + ':00' : null;
    var powtarzaj = $('zd-powtarzaj').value;
    var powtarzaj_dzien = (powtarzaj === 'TYGODNIOWO' || powtarzaj === 'MIESIECZNIE') ? parseInt($('zd-powtarzaj-dzien').value, 10) : null;
    var powtarzaj_co = (powtarzaj === 'TYGODNIOWO' || powtarzaj === 'MIESIECZNIE') ? (parseInt($('zd-powtarzaj-co').value, 10) || 1) : 1;
    var myImie = ls('boczki_pracownik_imie');
    var base = { tytul: tytul, opis: opis, przypisani: zd_przypisani.slice(), magazyn_pozycje: zd_magazyn.slice(), kategorie: zd_kategorie.slice(), priorytet: $('zd-priorytet').value, deadline: deadline, klienci: zd_klienci.slice(), powtarzaj: powtarzaj, powtarzaj_dzien: powtarzaj_dzien, powtarzaj_co: powtarzaj_co,
      rodzaj: rodz, telefon: rodz === 'TELEFON' ? telefon : '', kontakt_typ: rodz === 'TELEFON' ? $('zd-kontakt-typ').value : '', kontakt_id: rodz === 'TELEFON' ? $('zd-kontakt-id').value : '' };
    var payload = id ? Object.assign({ action: 'edit', id: id, kto_edytuje: myImie }, base) : Object.assign({ action: 'add', utworzone_przez: myImie }, base);
    if (btn) { btn.disabled = true; btn.textContent = 'Zapisywanie…'; }
    var gotowe = function () { if (btn) { btn.disabled = false; btn.textContent = 'Zapisz zadanie'; } };
    zd_apiCall(payload).then(function (res) {
      gotowe();
      if (!res || res.status !== 'success') { powiadom('error', 'Nie udało się zapisać', (res && res.message) || 'Spróbuj ponownie.'); return; }
      zd_modalClose();
      powiadom('success', id ? 'Zadanie zaktualizowane' : 'Zadanie dodane', tytul.length > 60 ? tytul.slice(0, 60) + '…' : tytul);
      var tbody = $('zd-tbody'); if (tbody && tbody.offsetParent !== null && typeof zd_loadList === 'function') zd_loadList();
      if (typeof zd_refreshSidebarBadge === 'function') zd_refreshSidebarBadge();
      var sec = $('ds-zadania-section'); if (sec && sec.offsetParent !== null) odswiez();
    }).catch(function () { gotowe(); powiadom('error', 'Brak połączenia', 'Zadanie nie zostało zapisane — dane pozostały w formularzu.'); });
  };
  // Obszary w formularzu: ten sam stan (zd_kategorie) i te same akcje (zd_addKategorie / zd_removeKategorie / zd_toggleKategoriePopup), chipy bez emoji
  window.zd_renderKategorieBadges = function () {
    var wrap = $('zd-kategorie-badges'); if (!wrap || typeof zd_kategorie === 'undefined') return;
    var def = (typeof ZD_KATEGORIE_DEF !== 'undefined') ? ZD_KATEGORIE_DEF : OBSZAR_KOLEJNOSC.map(function (v) { return { v: v, label: OBSZAR[v] }; });
    var wybrane = zd_kategorie.map(function (k, idx) { var d = def.find(function (x) { return x.v === k; }) || { label: k }; return '<span class="etf-chip etf-chip-' + esc(k) + '">' + esc(d.label) + '<button type="button" onclick="zd_removeKategorie(' + idx + ')" aria-label="Usuń obszar ' + esc(d.label) + '">&times;</button></span>'; }).join('');
    var dostepne = def.filter(function (d) { return zd_kategorie.indexOf(d.v) === -1; });
    var dropdown = dostepne.length ? '<div class="etf-chip-dodaj"><button type="button" onclick="zd_toggleKategoriePopup(event)" id="zd-kat-add-btn">+ Dodaj obszar</button><div id="zd-kat-popup" class="etf-chip-popup" style="display:none;">' + dostepne.map(function (d) { return '<button type="button" onclick="zd_addKategorie(\'' + esc(d.v) + '\')">' + esc(d.label) + '</button>'; }).join('') + '</div></div>' : '';
    wrap.innerHTML = wybrane + ' ' + dropdown;
  };
  document.addEventListener('change', function (e) { if (e.target && (e.target.id === 'zd-priorytet' || e.target.id === 'zd-powtarzaj')) wiecejPodsumowanie(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') zamknijPopovery(); });
})();
