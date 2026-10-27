/* Analiza → Zadania zespołu → Statystyki (27.10.2026).
   Dane: POST /api/zadania { action: 'statystyki', okres, kto } (routes/zadania.js, rola kierownicza sprawdzana na serwerze).
   Render: czyste HTML/CSS (paski), bez bibliotek. Lista zadań (#zd-lista-wrap) nietknięta — to tylko drugi widok obok niej. */
(function () {
  'use strict';
  var ST = { okres: '30', dane: null, widok: 'lista', ladowanie: false, kiedy: 0 };
  var OKRESY = [['7', '7 dni'], ['30', '30 dni'], ['90', '90 dni'], ['365', 'Rok'], ['wszystko', 'Od początku']];
  var OBSZAR = { MAGAZYN: 'Magazyn', KOSMETYK: 'Kosmetyki', KLIENT: 'Klientki', SPRZEDAZ: 'Sprzedaż', INNE: 'Inne' };
  var PRIO = { PILNY: 'Pilne', WAZNY: 'Ważne', NORMALNY: 'Normalne' };
  var DNI = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
  var MIES = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(a, b) { return b > 0 ? Math.round(a * 100 / b) : null; }
  function pctTxt(a, b) { var p = pct(a, b); return p == null ? '—' : p + '%'; }
  function czas(min) {
    if (min == null) return '—';
    if (min < 60) return min + ' min';
    if (min < 48 * 60) { var h = Math.round(min / 60 * 10) / 10; return (String(h).replace('.', ',')) + ' h'; }
    var d = Math.round(min / 1440 * 10) / 10;
    return String(d).replace('.', ',') + ' ' + (d === 1 ? 'dzień' : Number.isInteger(d) ? 'dni' : 'dnia');
  }
  function lm(n, j, m, w) { // liczba mnoga: 1 zadanie, 2 zadania, 5 zadań
    n = Math.abs(n); if (n === 1) return j; var r = n % 10, r2 = n % 100;
    return (r >= 2 && r <= 4 && (r2 < 12 || r2 > 14)) ? m : w;
  }
  function inicjaly(n) { var p = String(n || '').trim().split(/\s+/); return (p[0] ? p[0][0] : '') + (p[1] ? p[1][0] : ''); }
  function etykietaKubelka(od, ziarno) {
    var p = String(od || '').split('-'); if (p.length < 3) return esc(od);
    if (ziarno === 'miesiac') return MIES[Number(p[1]) - 1] + ' ' + p[0].slice(2);
    return p[2] + '.' + p[1];
  }
  function dzisISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function okresTekst() { return ST.okres === 'wszystko' ? 'od początku' : ST.okres === '365' ? 'w ostatnich 12 miesiącach' : 'w ostatnich ' + ST.okres + ' dniach'; }

  // ── przełączanie widoków i okresów ─────────────────────────────────────
  window.zst_pokaz = function (widok) {
    ST.widok = widok === 'statystyki' ? 'statystyki' : 'lista';
    var lista = document.getElementById('zd-lista-wrap'), stat = document.getElementById('zd-stat');
    if (lista) lista.hidden = ST.widok !== 'lista';
    if (stat) stat.hidden = ST.widok !== 'statystyki';
    document.querySelectorAll('#zd-widok-seg button').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.widok === ST.widok ? 'true' : 'false'); });
    if (ST.widok === 'statystyki' && (!ST.dane || Date.now() - ST.kiedy > 60000)) zaladuj();
  };
  window.zst_okres = function (okres) {
    if (!OKRESY.some(function (o) { return o[0] === okres; })) return;
    ST.okres = okres; zaladuj();
  };
  window.zst_odswiez = function () { zaladuj(); };

  function zaladuj() {
    var el = document.getElementById('zd-stat'); if (!el) return;
    if (ST.ladowanie) return;
    ST.ladowanie = true;
    el.innerHTML = pasek() + '<div class="zs-pusto">Liczę statystyki zespołu…</div>';
    var kto = localStorage.getItem('boczki_pracownik_imie') || '';
    var zadanie = (typeof zd_apiCall === 'function') ? zd_apiCall({ action: 'statystyki', okres: ST.okres, kto: kto }) : Promise.reject(new Error('Brak zd_apiCall'));
    zadanie.then(function (res) {
      ST.ladowanie = false;
      if (!res || res.status !== 'success') { el.innerHTML = pasek() + '<div class="zs-pusto">' + esc((res && res.message) || 'Nie udało się pobrać statystyk') + '</div>'; return; }
      ST.dane = res.data; ST.kiedy = Date.now();
      render(el, res.data);
    }).catch(function (e) {
      ST.ladowanie = false;
      el.innerHTML = pasek() + '<div class="zs-pusto">Błąd połączenia: ' + esc(e && e.message) + '</div>';
    });
  }

  function pasek() {
    return '<div class="zs-toolbar"><div class="zs-okresy" role="radiogroup" aria-label="Okres">' +
      OKRESY.map(function (o) { return '<button type="button" class="zs-okres" role="radio" aria-checked="' + (o[0] === ST.okres) + '" onclick="zst_okres(\'' + o[0] + '\')">' + esc(o[1]) + '</button>'; }).join('') +
      '</div><div class="zs-meta"><span id="zs-kiedy"></span><button type="button" class="zs-odswiez" onclick="zst_odswiez()">↻ Odśwież</button></div></div>';
  }

  // ── render ─────────────────────────────────────────────────────────────
  function render(el, d) {
    var p = d.podsumowanie || {};
    var html = pasek();
    var cokolwiek = (p.zalozone + p.wykonane + p.zarchiwizowane + p.aktywne) > 0;
    if (!cokolwiek) {
      html += '<div class="zs-pusto">Brak zadań ' + esc(okresTekst()) + '. Gdy zespół zacznie zakładać i zamykać sprawy, tu pojawią się liczby.</div>';
      el.innerHTML = html; stopka(d); return;
    }
    html += lead(d) + kafle(d) + odznaki(d);
    html += '<div class="zs-grid">' +
      '<div class="zs-card zs-card-wide">' + trend(d) + '</div>' +
      '<div class="zs-card zs-card-wide">' + tabelaOsob(d) + '</div>' +
      '<div class="zs-card">' + obszary(d) + '</div>' +
      '<div class="zs-card">' + rodzaje(d) + priorytety(d) + '</div>' +
      '<div class="zs-card">' + rozmowy(d) + '</div>' +
      '<div class="zs-card">' + dniTygodnia(d) + '</div>' +
      '<div class="zs-card zs-card-wide">' + najstarsze(d) + '</div>' +
      '</div><div class="zs-stopka">Założone liczone po dacie utworzenia, zamknięte po dacie wykonania, zarchiwizowane po dacie archiwizacji. „Aktywne” i „po terminie” to stan na teraz. Szablony cykliczne pominięte.</div>';
    el.innerHTML = html; stopka(d);
  }
  function stopka(d) {
    var k = document.getElementById('zs-kiedy'); if (!k) return;
    var t = d && d.wygenerowano ? new Date(d.wygenerowano) : new Date();
    k.textContent = 'stan z ' + t.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  function lead(d) {
    var p = d.podsumowanie, z = p.zalozone, w = p.wykonane;
    var s = 'Zespół ' + esc(okresTekst()) + ' założył <b>' + z + '</b> ' + lm(z, 'sprawę', 'sprawy', 'spraw') + ' i zamknął <b>' + w + '</b>';
    if (p.wykonane_z_terminem > 0) s += ', z czego <b>' + pctTxt(p.wykonane_na_czas, p.wykonane_z_terminem) + '</b> terminowych na czas';
    s += '.';
    if (p.po_terminie > 0) s += ' Po terminie ' + (p.po_terminie === 1 ? 'jest' : 'są') + ' teraz <b>' + p.po_terminie + '</b> ' + lm(p.po_terminie, 'zadanie', 'zadania', 'zadań') + '.';
    else if (p.aktywne > 0) s += ' Nic nie jest po terminie — <b>brawo</b>.';
    return '<p class="zs-lead">' + s + '</p>';
  }

  function kafle(d) {
    var p = d.podsumowanie;
    var naCzas = pct(p.wykonane_na_czas, p.wykonane_z_terminem);
    function tile(k, v, sub, kl) { return '<div class="zs-tile' + (kl ? ' ' + kl : '') + '"><div class="zs-k">' + k + '</div><div class="zs-v">' + v + '</div><div class="zs-sub">' + sub + '</div></div>'; }
    return '<div class="zs-kpi">' +
      tile('📝 Założone', p.zalozone, p.zalozone_telefony + ' ' + lm(p.zalozone_telefony, 'telefon', 'telefony', 'telefonów') + ' · ' + (p.zalozone - p.zalozone_telefony) + ' do zrobienia') +
      tile('✅ Zamknięte', p.wykonane + '<small>' + (p.zalozone > 0 ? pctTxt(p.wykonane, p.zalozone) + ' założonych' : '') + '</small>', p.wykonane_telefony + ' ' + lm(p.wykonane_telefony, 'telefon', 'telefony', 'telefonów') + ' · ' + p.zarchiwizowane + ' zarchiw.') +
      tile('🎯 Na czas', naCzas == null ? '—' : naCzas + '%', p.wykonane_z_terminem > 0 ? p.wykonane_na_czas + ' z ' + p.wykonane_z_terminem + ' z terminem' : 'brak zamkniętych z terminem', naCzas != null && naCzas >= 80 ? 'zs-tile-good' : '') +
      tile('⏱️ Śr. czas realizacji', czas(p.sredni_czas_min), 'od założenia do zamknięcia') +
      tile('🔥 Po terminie', p.po_terminie, 'z ' + p.aktywne + ' aktywnych · ' + p.bez_terminu + ' bez terminu', p.po_terminie > 0 ? 'zs-tile-alert' : (p.aktywne > 0 ? 'zs-tile-good' : '')) +
      tile('📞 Umówione rozmowy', d.rozmowy.UMOWIONA, d.rozmowy.NIE_ODEBRALA + ' nieodebranych · ' + d.rozmowy.NIE_ZAINTERESOWANA + ' bez zainteresowania') +
      '</div>';
  }

  function odznaki(d) {
    var os = d.osoby || [];
    function naj(f, min, opis) {
      var best = null, bv = -Infinity;
      os.forEach(function (o) { var v = f(o); if (v != null && v > bv && v >= min) { bv = v; best = o; } });
      return best ? { kto: best.osoba, za: opis(best, bv) } : null;
    }
    var lista = [
      ['🏆', 'Najwięcej zamkniętych', naj(function (o) { return o.wykonane; }, 1, function (o, v) { return v + ' ' + lm(v, 'zadanie', 'zadania', 'zadań'); })],
      ['📋', 'Najwięcej zleconych', naj(function (o) { return o.zalozone; }, 1, function (o, v) { return v + ' ' + lm(v, 'sprawa', 'sprawy', 'spraw'); })],
      ['📞', 'Mistrz telefonów', naj(function (o) { return o.wykonane_telefony; }, 1, function (o, v) { return v + ' ' + lm(v, 'rozmowa', 'rozmowy', 'rozmów') + ' · ' + o.rozmowy.UMOWIONA + ' umów.'; })],
      ['⚡', 'Najszybsza realizacja', naj(function (o) { return o.wykonane >= 3 && o.sredni_czas_min != null ? -o.sredni_czas_min : null; }, -Infinity, function (o) { return 'średnio ' + czas(o.sredni_czas_min); })],
      ['🎯', 'Najbardziej terminowa', naj(function (o) { return o.wykonane_z_terminem >= 3 ? pct(o.wykonane_na_czas, o.wykonane_z_terminem) : null; }, 50, function (o, v) { return v + '% na czas (' + o.wykonane_na_czas + '/' + o.wykonane_z_terminem + ')'; })],
      ['🧹', 'Porządkuje listę', naj(function (o) { return o.zarchiwizowane; }, 1, function (o, v) { return v + ' ' + lm(v, 'archiwizacja', 'archiwizacje', 'archiwizacji'); })]
    ];
    return '<div class="zs-odznaki">' + lista.map(function (x) {
      var w = x[2];
      return '<div class="zs-odznaka' + (w ? '' : ' zs-odznaka-brak') + '"><div class="zs-emoji">' + x[0] + '</div><div style="min-width:0"><div class="zs-tytul">' + x[1] + '</div><div class="zs-kto">' + (w ? esc(w.kto) : 'jeszcze nikt') + '</div><div class="zs-za">' + (w ? esc(w.za) : 'za mało danych') + '</div></div></div>';
    }).join('') + '</div>';
  }

  function trend(d) {
    var t = d.trend || [];
    var max = Math.max(1, Math.max.apply(null, t.map(function (x) { return Math.max(x.zalozone, x.wykonane); })));
    var ziarno = d.ziarno === 'dzien' ? 'dzień po dniu' : d.ziarno === 'tydzien' ? 'tydzień po tygodniu (od poniedziałku)' : 'miesiąc po miesiącu';
    var dzis = dzisISO();
    var kol = t.map(function (x) {
      return '<div class="zs-kol" title="' + esc(etykietaKubelka(x.od, d.ziarno)) + ': założone ' + x.zalozone + ' (w tym ' + x.telefony + ' tel.), zamknięte ' + x.wykonane + '">' +
        '<div class="zs-bar zs-s1" data-v="' + x.zalozone + '" style="height:' + Math.round(x.zalozone / max * 86) + '%"><span>' + x.zalozone + '</span></div>' +
        '<div class="zs-bar zs-s2" data-v="' + x.wykonane + '" style="height:' + Math.round(x.wykonane / max * 86) + '%"><span>' + x.wykonane + '</span></div></div>';
    }).join('');
    var osie = t.map(function (x, i) { var biezacy = (d.ziarno === 'dzien' ? x.od === dzis : i === t.length - 1); return '<span class="' + (biezacy ? 'zs-dzis' : '') + '">' + esc(etykietaKubelka(x.od, d.ziarno)) + '</span>'; }).join('');
    return '<h4>📈 Rytm pracy</h4><p class="zs-opis">Ile spraw zespół zakładał i zamykał — ' + ziarno + '.</p>' +
      '<div class="zs-legenda"><span><i class="zs-s1"></i>założone</span><span><i class="zs-s2"></i>zamknięte</span></div>' +
      '<div class="zs-trend" id="zs-trend">' + kol + '</div><div class="zs-osie">' + osie + '</div>';
  }

  function tabelaOsob(d) {
    var os = d.osoby || [];
    if (!os.length) return '<h4>👥 Kto ile</h4><p class="zs-opis">Brak osób z zadaniami w tym okresie.</p>';
    var maxW = Math.max(1, Math.max.apply(null, os.map(function (o) { return o.wykonane; })));
    var maxZ = Math.max(1, Math.max.apply(null, os.map(function (o) { return o.zalozone; })));
    function mini(v, max, kl) { return '<span class="zs-mini"><span class="zs-mini-track"><span class="zs-fill ' + kl + '" style="width:' + Math.round(v / max * 100) + '%;display:block"></span></span><b>' + v + '</b></span>'; }
    var rows = os.map(function (o) {
      var naCzas = pct(o.wykonane_na_czas, o.wykonane_z_terminem);
      var pillCzas = naCzas == null ? '<span class="zs-pill zs-pill-muted">—</span>' : '<span class="zs-pill ' + (naCzas >= 80 ? 'zs-pill-green' : naCzas >= 50 ? 'zs-pill-amber' : 'zs-pill-red') + '">' + naCzas + '%</span>';
      var pillPo = o.po_terminie > 0 ? '<span class="zs-pill zs-pill-red">' + o.po_terminie + '</span>' : '<span class="zs-pill zs-pill-muted">0</span>';
      return '<tr>' +
        '<td><span class="zs-osoba"><span class="zs-avatar">' + esc(inicjaly(o.osoba)) + '</span>' + esc(o.osoba) + '</span></td>' +
        '<td>' + mini(o.zalozone, maxZ, 'zs-s1') + '</td>' +
        '<td class="zs-num">' + o.otrzymane + '</td>' +
        '<td>' + mini(o.wykonane, maxW, 'zs-s2') + '</td>' +
        '<td class="zs-num">' + o.wykonane_telefony + '<span style="color:var(--zs-muted)"> / ' + o.zalozone_telefony + '</span></td>' +
        '<td class="zs-num">' + pillCzas + '</td>' +
        '<td class="zs-num">' + esc(czas(o.sredni_czas_min)) + '</td>' +
        '<td class="zs-num">' + o.aktywne + '</td>' +
        '<td class="zs-num">' + pillPo + '</td>' +
        '<td><span class="zs-rozmowy-inline" title="umówione / nie odebrała / nie zainteresowana"><span><i class="zs-s2"></i>' + o.rozmowy.UMOWIONA + '</span><span><i class="zs-s3"></i>' + o.rozmowy.NIE_ODEBRALA + '</span><span><i class="zs-sred"></i>' + o.rozmowy.NIE_ZAINTERESOWANA + '</span></span></td>' +
        '<td class="zs-num">' + o.przelozenia + '</td>' +
        '<td class="zs-num">' + o.zarchiwizowane + '</td></tr>';
    }).join('');
    return '<h4>👥 Kto ile</h4><p class="zs-opis">Zlecone i zamknięte w okresie; aktywne i po terminie — stan na teraz (zadania przypisane do osoby). Telefony: zamknięte / założone.</p>' +
      '<div class="zs-tabela-wrap"><table class="zs-tabela" id="zs-tabela-osoby"><thead><tr><th>Osoba</th><th>Zleciła</th><th class="zs-num">Dostała</th><th>Zamknęła</th><th class="zs-num">Telefony</th><th class="zs-num">Na czas</th><th class="zs-num">Śr. czas</th><th class="zs-num">Aktywne</th><th class="zs-num">Po terminie</th><th>Rozmowy</th><th class="zs-num">Przełożeń</th><th class="zs-num">Archiw.</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function paskiPoziome(wiersze, etykieta) {
    var max = Math.max(1, Math.max.apply(null, wiersze.map(function (r) { return Math.max(r.zalozone, r.wykonane, r.aktywne); })));
    return '<div class="zs-rows">' + wiersze.map(function (r) {
      return '<div class="zs-row"><span class="zs-lbl">' + esc(etykieta(r)) + '</span><span class="zs-track">' +
        '<span class="zs-fill zs-s1" style="width:' + Math.round(r.zalozone / max * 100) + '%"></span>' +
        '<span class="zs-fill zs-s2" style="width:' + Math.round(r.wykonane / max * 100) + '%"></span>' +
        '<span class="zs-fill zs-s3" style="width:' + Math.round(r.aktywne / max * 100) + '%"></span></span>' +
        '<span class="zs-n"><b>' + r.zalozone + '</b> · ' + r.wykonane + ' · ' + r.aktywne + '</span></div>';
    }).join('') + '</div>';
  }
  function obszary(d) {
    var ob = (d.obszary || []).slice().sort(function (a, b) { return (b.zalozone + b.aktywne) - (a.zalozone + a.aktywne); });
    if (!ob.length) return '<h4>🗂️ Obszary</h4><p class="zs-opis">Brak danych.</p>';
    return '<h4>🗂️ Obszary</h4><p class="zs-opis">Czego dotyczą sprawy (zadanie może mieć kilka obszarów).</p>' +
      '<div class="zs-legenda"><span><i class="zs-s1"></i>założone</span><span><i class="zs-s2"></i>zamknięte</span><span><i class="zs-s3"></i>aktywne teraz</span></div>' +
      paskiPoziome(ob, function (r) { return OBSZAR[r.kategoria] || r.kategoria; });
  }
  function rodzaje(d) {
    var p = d.podsumowanie, tel = p.zalozone_telefony, doz = p.zalozone - p.zalozone_telefony, suma = tel + doz;
    var pt = suma ? Math.round(tel / suma * 100) : 0;
    return '<h4>📞 Telefony czy do zrobienia?</h4><p class="zs-opis">Udział rodzajów wśród założonych w okresie.</p>' +
      '<div class="zs-udzial"><div class="zs-s1" style="width:' + pt + '%" title="telefony ' + tel + '"></div><div class="zs-s3" style="width:' + (100 - pt) + '%" title="do zrobienia ' + doz + '"></div></div>' +
      '<div class="zs-udzial-opis"><span><i class="zs-s1" style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px"></i><b>' + tel + '</b> telefonów (' + pt + '%) · zamkn. ' + p.wykonane_telefony + ' · aktywne ' + p.aktywne_telefony + '</span>' +
      '<span><i class="zs-s3" style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px"></i><b>' + doz + '</b> do zrobienia (' + (100 - pt) + '%) · zamkn. ' + (p.wykonane - p.wykonane_telefony) + ' · aktywne ' + (p.aktywne - p.aktywne_telefony) + '</span></div>';
  }
  function priorytety(d) {
    var kol = ['PILNY', 'WAZNY', 'NORMALNY'];
    var pr = kol.map(function (k) { return (d.priorytety || []).filter(function (x) { return x.priorytet === k; })[0] || { priorytet: k, zalozone: 0, wykonane: 0, aktywne: 0 }; });
    return '<h4 style="margin-top:18px">🚩 Priorytety</h4><p class="zs-opis">Pilne zadania wymagają uwagi dziś — ' + d.podsumowanie.aktywne_pilne + ' ' + lm(d.podsumowanie.aktywne_pilne, 'aktywne pilne', 'aktywne pilne', 'aktywnych pilnych') + '.</p>' +
      paskiPoziome(pr, function (r) { return PRIO[r.priorytet] || r.priorytet; });
  }
  function rozmowy(d) {
    var r = d.rozmowy, suma = r.UMOWIONA + r.NIE_ODEBRALA + r.NIE_ZAINTERESOWANA;
    var wiersze = [['Umówione', r.UMOWIONA, 'zs-s2'], ['Nie odebrała', r.NIE_ODEBRALA, 'zs-s3'], ['Nie zainteresowana', r.NIE_ZAINTERESOWANA, 'zs-sred']];
    var max = Math.max(1, r.UMOWIONA, r.NIE_ODEBRALA, r.NIE_ZAINTERESOWANA);
    var skut = suma ? Math.round(r.UMOWIONA / suma * 100) : null;
    return '<h4>☎️ Jak idą rozmowy</h4><p class="zs-opis">Wyniki zapisane przy telefonach w okresie' + (skut != null ? ' — skuteczność <b>' + skut + '%</b> umówionych' : '') + '. Przełożeń terminu: ' + r.przelozenia + '.</p>' +
      '<div class="zs-rows">' + wiersze.map(function (w) {
        return '<div class="zs-row"><span class="zs-lbl">' + w[0] + '</span><span class="zs-track"><span class="zs-fill ' + w[2] + '" style="width:' + Math.round(w[1] / max * 100) + '%;height:12px"></span></span><span class="zs-n"><b>' + w[1] + '</b>' + (suma ? ' · ' + Math.round(w[1] / suma * 100) + '%' : '') + '</span></div>';
      }).join('') + '</div>' + (suma === 0 ? '<p class="zs-opis" style="margin-top:10px">Jeszcze nikt nie zapisał wyniku rozmowy — przy telefonie na Pulpicie są przyciski „Umówiona / Nie odebrała / Nie zainteresowana”.</p>' : '');
  }
  function dniTygodnia(d) {
    var dn = d.dni_tygodnia || [0, 0, 0, 0, 0, 0, 0];
    var max = Math.max(1, Math.max.apply(null, dn));
    var iMax = dn.indexOf(Math.max.apply(null, dn));
    return '<h4>📅 Kiedy zamykacie sprawy</h4><p class="zs-opis">Zamknięte zadania według dnia tygodnia' + (max > 1 ? ' — najmocniejszy ' + ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'][iMax] : '') + '.</p>' +
      '<div class="zs-dni">' + dn.map(function (v, i) { return '<div class="zs-d" title="' + DNI[i] + ': ' + v + '"><em>' + (v || '') + '</em><div class="zs-bar' + (v > 0 && i === iMax ? ' zs-max' : '') + '" style="height:' + Math.max(2, Math.round(v / max * 80)) + 'px"></div><small>' + DNI[i] + '</small></div>'; }).join('') + '</div>';
  }
  function najstarsze(d) {
    var n = d.najstarsze || [];
    if (!n.length) return '<h4>🔥 Najdłużej po terminie</h4><p class="zs-ok">Nic nie czeka po terminie. Tak trzymać.</p>';
    return '<h4>🔥 Najdłużej po terminie</h4><p class="zs-opis">Pięć aktywnych zadań, które najdłużej czekają — do przełożenia, zamknięcia albo archiwum.</p><ul class="zs-lista">' + n.map(function (z) {
      return '<li><span class="zs-dni-po">' + z.dni_po_terminie + ' ' + lm(z.dni_po_terminie, 'dzień', 'dni', 'dni') + '</span><span class="zs-tyt">' + (z.rodzaj === 'TELEFON' ? '📞 ' : '') + (z.priorytet === 'PILNY' ? '🚩 ' : '') + esc(z.tytul) + '</span><span class="zs-kto-przyp">' + esc(z.przypisani || '—') + '</span></li>';
    }).join('') + '</ul>';
  }
})();
