/* ═══════════════════════════════════════════════════════════════════════
   TERMINARZ — dodatek Estelio+ (etap A: terminarz wewnętrzny), 2026-10-12.
   Osobny plik: index.html ma tylko pozycję menu, sekcję #terminarz, hook w pokaz()
   i <script src>. Wszystko globalne ma prefiks trm_/TRM, żeby nie kolidować.
   Czas: łańcuchy 'YYYY-MM-DD HH:MM:SS' w czasie salonu, jak w backendzie.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const TRM = window.TRM = { dane: null, zaladowano: 0, data: null, widok: 'dzien', osoba: null, dzien: null, zakres: null, panel: null, nowa: null, szcz: null, ust: { tab: 'ogolne', prac: null }, rozliczanie: null, szukajT: null,
    sprawy: { zakladka: 'do_dzialania', lista: [], szczegolyId: null, szczegoly: null, dziennik: [], forma: null } };
  const PRIOR_LABEL = { P0: ['Pilne teraz', 'bad'], P1: ['Wymaga działania', 'warn'], P2: ['Informacja', 'neu'] };
  const STAN_SPRAWY_LABEL = { nowa: 'Nowa', w_trakcie: 'W trakcie', oczekuje: 'Oczekuje', rozwiazana: 'Rozwiązana', nieaktualna: 'Nieaktualna' };
  const SPRAWY_TABY = [['do_dzialania', 'Do działania'], ['zmiany', 'Zmiany w wizytach'], ['dla_mnie', 'Dla mnie'], ['informacje', 'Informacje']];
  const PX = 1.6; // px na minutę
  const DNI = ['', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota', 'Niedziela'];
  const DNI_K = ['', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
  const MIES = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const ST_LABEL = { potwierdzona: ['Potwierdzona', 'ok'], hold: ['Tymczasowo zajęty', 'warn'], do_zatwierdzenia: ['Do zatwierdzenia', 'warn'], do_wplaty: ['Do wpłaty', 'warn'], anulowana: ['Anulowana', 'bad'], odrzucona: ['Odrzucona', 'bad'], wygasla: ['Wygasła', 'bad'], szkic: ['Szkic', 'neu'] };
  const OB_LABEL = { oczekiwana: ['Oczekiwana', 'neu'], przybyl: ['Przybyła', 'ok'], spozniony: ['Spóźniona', 'warn'], nieobecny: ['Nieobecna', 'bad'] };
  const WYK_LABEL = { zaplanowana: ['Zaplanowana', 'neu'], w_toku: ['W trakcie', 'info'], wykonana: ['Wykonana', 'ok'], czesciowo: ['Częściowo wykonana', 'warn'], niewykonana: ['Niewykonana', 'bad'], anulowana: ['Anulowana', 'bad'] };
  const POZ_LABEL = { zaplanowana: 'Zaplanowana', w_trakcie: 'W trakcie', wykonana: 'Wykonana', przerwana: 'Przerwana', anulowana: 'Anulowana', niewykonana: 'Niewykonana', odmowa: 'Odmowa kwalifikacji' };
  const KANAL_LABEL = { recepcja: 'Recepcja', telefon: 'Telefon', wiadomosc: 'Wiadomość', online: 'Online', klub: 'Klub', import: 'Import', kampania: 'Kampania' };

  // ── pomocnicze ────────────────────────────────────────────────────────
  const esc = (s) => (typeof escHtml === 'function') ? escHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const API = () => (typeof API_URL !== 'undefined' ? API_URL : (location.origin + '/api'));
  const kto = () => (typeof currentUser !== 'undefined' && currentUser) || localStorage.getItem('boczki_pracownik_imie') || '';
  const rola = () => (localStorage.getItem('boczki_pracownik_rola') || '').toLowerCase().trim();
  const manager = () => ['manager', 'admin', 'megaadmin'].includes(rola());
  const operacyjna = () => ['recepcja', 'manager', 'admin', 'megaadmin'].includes(rola());
  const specjalista = () => ['kosmetolog', 'pracownik'].includes(rola());
  const toast = (typ, tyt, msg) => (typeof pokazPowiadomienie === 'function') ? pokazPowiadomienie(typ, tyt, msg || '') : window.alert(tyt + (msg ? ' — ' + msg : ''));
  const pad = (n) => String(n).padStart(2, '0');
  const dzisStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const minDnia = (s) => { const m = /(\d{2}):(\d{2})/.exec(String(s).slice(11, 16)); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
  const hhmm = (s) => String(s || '').slice(11, 16);
  const dodajDni = (data, n) => { const d = new Date(data + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const dzienTyg = (data) => { const d = new Date(data + 'T00:00:00').getDay(); return d === 0 ? 7 : d; };
  const ladnaData = (data, krotko) => { const d = new Date(data + 'T00:00:00'); return krotko ? `${DNI_K[dzienTyg(data)]} ${d.getDate()}.${pad(d.getMonth() + 1)}` : `${DNI[dzienTyg(data)]}, ${d.getDate()} ${MIES[d.getMonth()]} ${d.getFullYear()}`; };
  const poniedzialek = (data) => dodajDni(data, 1 - dzienTyg(data));
  const zl = (n) => (n == null ? '—' : Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now() + Math.random().toString(16).slice(2));
  const el = (id) => document.getElementById(id);
  const waski = () => window.innerWidth < 760;
  const czyDodatek = () => typeof hasFeature === 'function' && hasFeature('terminarz');

  async function api(akcja, dane) {
    try {
      const r = await fetch(API(), { method: 'POST', body: JSON.stringify({ action: akcja, pracownik: kto(), ...(dane || {}) }) });
      return await r.json();
    } catch (e) { return { status: 'error', message: 'Brak połączenia. Zapis będzie możliwy po odzyskaniu połączenia.' }; }
  }
  const usluga = (id) => (TRM.dane ? TRM.dane.uslugi.find(u => String(u.id) === String(id)) : null);
  const zasob = (id) => (TRM.dane ? TRM.dane.zasoby.find(z => Number(z.id) === Number(id)) : null);
  const nazwaUslugi = (u) => u ? (u.kategoria + (u.wariant ? ' / ' + u.wariant : '')) : '';
  const kolorKat = (u) => (u && u.kolor && /^#[0-9a-f]{6}$/i.test(u.kolor)) ? u.kolor : '#BD9560';
  const pill = (para, extra) => para ? `<span class="trm-pill ${para[1]} ${extra || ''}">${esc(para[0])}</span>` : '';
  const AWATAR_KOLORY = ['', 'mint', 'gold', 'blue'];
  const awatarKolor = (nazwa) => { let h = 0; for (const ch of String(nazwa || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return AWATAR_KOLORY[h % AWATAR_KOLORY.length]; };
  const avatarHtml = (nazwa, mala) => `<span class="trm-awatar ${awatarKolor(nazwa)}${mala ? ' sm' : ''}">${esc(String(nazwa || '?').trim().charAt(0).toUpperCase())}</span>`;
  function terminEtykieta(dt) {
    const dzis = new Date().toISOString().slice(0, 10), jutro = dodajDni(dzis, 1);
    const data = dt.slice(0, 10), godz = dt.slice(11, 16);
    if (data === dzis) return `do ${godz}`;
    if (data === jutro) return `do jutra, ${godz}`;
    return `do ${ladnaData(data, true)}, ${godz}`;
  }

  // ── widoczność w menu (wołane po logowaniu i po przełączeniu dodatku) ─
  window.trm_aktualizujWidocznosc = function () {
    const li = el('menu-terminarz'); if (!li) return;
    li.style.display = czyDodatek() ? '' : 'none';
  };

  // ── wejście do sekcji ─────────────────────────────────────────────────
  window.trm_otworz = async function () {
    const root = el('trm-root'); if (!root) return;
    if (!czyDodatek()) { root.innerHTML = `<div class="trm"><div class="trm-empty"><div class="big">📅</div><p>Dodatek „Terminarz” nie jest włączony w tym salonie.</p><p class="small muted">Manager włącza go w Administracja → Dodatki (0 zł).</p></div></div>`; return; }
    if (!TRM.data) TRM.data = dzisStr();
    if (!TRM.dane || Date.now() - TRM.zaladowano > 5 * 60 * 1000) {
      root.innerHTML = `<div class="trm"><div class="trm-empty"><div class="big">⏳</div><p>Pobieramy terminarz…</p></div></div>`;
      const d = await api('trm_init');
      if (d.status !== 'success' || !d.feature_on) { root.innerHTML = `<div class="trm"><div class="trm-empty"><div class="big">📅</div><p>${esc(d.message || 'Dodatek nie jest aktywny.')}</p></div></div>`; return; }
      TRM.dane = d; TRM.zaladowano = Date.now();
      if (specjalista() && !TRM.osoba && d.pracownicy.includes(kto())) TRM.osoba = kto();
      if (specjalista() && TRM.widok === 'dzien') TRM.widok = 'moj';
    }
    szkielet();
    await odswiez();
    odswiezLicznikSpraw();
  };
  window.trm_odswiezDane = async function () { const d = await api('trm_init'); if (d.status === 'success' && d.feature_on) { TRM.dane = d; TRM.zaladowano = Date.now(); } };

  function szkielet() {
    const root = el('trm-root');
    const widoki = [['dzien', 'Dzień'], ['tydzien', 'Tydzień'], ['agenda', 'Agenda'], ['zasoby', 'Zasoby']];
    if (specjalista()) widoki.unshift(['moj', 'Mój dzień']);
    if (manager()) widoki.push(['ustawienia', 'Ustawienia']);
    root.innerHTML = `
    <div class="trm">
      <div class="trm-top">
        <div><h1>Terminarz</h1><div class="trm-sub" id="trm-sub"></div></div>
        <div class="trm-nav">
          <button class="trm-btn" onclick="TRM.idz(0)">Dzisiaj</button>
          <button class="trm-btn" onclick="TRM.idz(-1)" title="Poprzedni">‹</button>
          <button class="trm-btn" onclick="TRM.idz(1)" title="Następny">›</button>
          <input type="date" id="trm-data" value="${TRM.data}" onchange="TRM.ustawDate(this.value)">
        </div>
        <div class="trm-views" id="trm-views">${widoki.map(([k, n]) => `<button class="${TRM.widok === k ? 'on' : ''}" onclick="TRM.widokZmien('${k}')">${n}</button>`).join('')}</div>
        <div class="trm-spacer"></div>
        <a class="trm-btn" href="/pomoc-terminarz/" target="_blank" rel="noopener" title="Przewodnik po Terminarzu — scenki, FAQ" style="text-decoration:none;display:inline-flex;align-items:center">📖 Pomoc</a>
        ${(operacyjna() || specjalista()) ? `<button class="trm-btn trm-dzwonek fix" onclick="TRM.otworzPowiadomienia()" title="Powiadomienia i sprawy">🔔<span class="trm-dzwonek-licz" id="trm-dzwonek-licz" hidden>0</span></button>` : ''}
        ${operacyjna() ? `<button class="trm-btn primary" onclick="TRM.nowaWizyta()">+ Nowa wizyta</button>` : ''}
      </div>
      <div class="trm-counters" id="trm-counters"></div>
      <div class="trm-body" id="trm-body"><div class="trm-main" id="trm-main"></div><aside class="trm-panel" id="trm-panel" hidden></aside></div>
      <div class="trm-bubble-layer" id="trm-bubble-layer"></div>
    </div>`;
  }
  async function odswiezLicznikSpraw() {
    if (!operacyjna() && !specjalista()) return;
    const d = await api('trm_sprawy_licznik');
    const b = el('trm-dzwonek-licz'); if (d.status !== 'success' || !b) return;
    if (d.pilne > 0) { b.hidden = false; b.textContent = d.pilne; b.classList.add('pilne'); }
    else if (d.nieprzeczytane > 0) { b.hidden = false; b.textContent = d.nieprzeczytane; b.classList.remove('pilne'); }
    else { b.hidden = true; b.classList.remove('pilne'); }
  }
  TRM.idz = (n) => { if (n === 0) TRM.data = dzisStr(); else TRM.data = dodajDni(TRM.data, (TRM.widok === 'tydzien' || TRM.widok === 'agenda') ? 7 * n : n); el('trm-data').value = TRM.data; odswiez(); };
  TRM.ustawDate = (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { TRM.data = v; odswiez(); } };
  TRM.widokZmien = (w) => { TRM.widok = w; document.querySelectorAll('#trm-views button').forEach(b => b.classList.toggle('on', b.textContent === ({ dzien: 'Dzień', tydzien: 'Tydzień', agenda: 'Agenda', zasoby: 'Zasoby', ustawienia: 'Ustawienia', moj: 'Mój dzień' })[w])); odswiez(); };

  async function odswiez() {
    const main = el('trm-main'); if (!main) return;
    const sub = el('trm-sub');
    const di = el('trm-data'); if (di && di.value !== TRM.data) di.value = TRM.data;
    if (TRM.widok === 'ustawienia') { if (sub) sub.textContent = 'Konfiguracja salonu'; return renderUstawienia(); }
    if (TRM.widok === 'tydzien' || TRM.widok === 'agenda') {
      const od = TRM.widok === 'tydzien' ? poniedzialek(TRM.data) : TRM.data, do_ = dodajDni(od, 6);
      if (sub) sub.textContent = `${ladnaData(od, true)} – ${ladnaData(do_, true)}`;
      main.innerHTML = `<div class="trm-empty"><div class="big">⏳</div>Pobieramy…</div>`;
      const d = await api('trm_zakres', { od, do: do_, pracownik_filtr: TRM.widok === 'tydzien' ? (TRM.osoba || TRM.dane.pracownicy[0] || null) : (TRM.osoba || null) });
      if (d.status !== 'success') { main.innerHTML = `<div class="trm-note bad">${esc(d.message)}</div>`; return; }
      TRM.zakres = d;
      return TRM.widok === 'tydzien' ? renderTydzien(od) : renderAgenda(od, do_);
    }
    if (sub) sub.textContent = ladnaData(TRM.data);
    main.innerHTML = `<div class="trm-empty"><div class="big">⏳</div>Pobieramy terminarz…</div>`;
    const d = await api('trm_dzien', { data: TRM.data, tylko_moje: TRM.widok === 'moj' });
    if (d.status !== 'success') { main.innerHTML = `<div class="trm-note bad">${esc(d.message)}</div>`; return; }
    TRM.dzien = d;
    liczniki(d);
    if (TRM.widok === 'zasoby') return renderZasoby();
    if (TRM.widok === 'moj' || waski()) return renderAgendaDnia();
    renderDzien();
  }
  function liczniki(d) {
    const c = el('trm-counters'); if (!c) return;
    const akt = d.rezerwacje.filter(r => !['anulowana', 'odrzucona', 'wygasla'].includes(r.status));
    const doRozl = akt.filter(r => r.wykonanie === 'wykonana' && !r.sprzedaz_id).length;
    const nieob = d.nieobecnosci.length;
    const anul = d.rezerwacje.length - akt.length;
    c.innerHTML = `<span><b>${akt.length}</b> wizyt</span><span><b>${akt.filter(r => r.obecnosc === 'przybyl').length}</b> przybyło</span>${doRozl ? `<span><b>${doRozl}</b> do rozliczenia</span>` : ''}${nieob ? `<span><b>${nieob}</b> nieobecności/blokad</span>` : ''}${anul ? `<label style="display:inline-flex;align-items:center;gap:4px;text-transform:none;letter-spacing:0;font-size:12px;margin:0;cursor:pointer"><input type="checkbox" ${TRM.pokazAnul ? 'checked' : ''} onchange="TRM.pokazAnul=this.checked;TRM.widokZmien(TRM.widok)" style="width:auto;min-height:0"> pokaż anulowane (${anul})</label>` : ''}<span class="small">Ostatnia aktualizacja ${hhmm(d.teraz)}</span>`;
  }

  // ── wspólne: zakres godzin siatki ─────────────────────────────────────
  function zakresGodzin(przedzialy, rezerwacje) {
    let od = 8 * 60, do_ = 20 * 60;
    const wsz = [];
    (przedzialy || []).forEach(p => wsz.push([minDnia(p.od), minDnia(p.do) || 1440]));
    (rezerwacje || []).forEach(r => wsz.push([minDnia(r.start), minDnia(r.koniec) || 1440]));
    if (wsz.length) { od = Math.min(od, ...wsz.map(x => x[0])); do_ = Math.max(do_, ...wsz.map(x => x[1])); }
    return { od: Math.floor(od / 60) * 60, do: Math.min(1440, Math.ceil(do_ / 60) * 60) };
  }
  function kolumnaHtml(rezerwacje, dostepnosc, bloki, zak, klik, filtrPoz, dragPrac) {
    const h = zak.do - zak.od;
    let s = '';
    for (let m = zak.od; m <= zak.do; m += 30) s += `<div class="hline ${m % 60 ? 'half' : ''}" style="top:${(m - zak.od) * PX}px"></div>`;
    (dostepnosc || []).forEach(p => { const a = Math.max(zak.od, minDnia(p.od)), b = Math.min(zak.do, minDnia(p.do) || 1440); if (b > a) s += `<div class="dost" style="top:${(a - zak.od) * PX}px;height:${(b - a) * PX}px"></div>`; });
    (bloki || []).forEach(b => { const a = Math.max(zak.od, minDnia(b.od)), c = Math.min(zak.do, minDnia(b.do) || 1440); if (c > a) s += `<div class="blok" style="top:${(a - zak.od) * PX}px;height:${(c - a) * PX}px">${esc(b.opis || 'Niedostępne')}</div>`; });
    for (let m = zak.od; m <= zak.do; m += 30) s += `<div class="hline ${m % 60 ? 'half' : ''}" style="top:${(m - zak.od) * PX}px"></div>`;
    rezerwacje.forEach(r => {
      // anulowane domyślnie nie zajmują siatki (05: filtr „Pokaż anulowane”); agenda pokazuje je zawsze
      if (!TRM.pokazAnul && ['anulowana', 'odrzucona', 'wygasla'].includes(r.status) && !(TRM.szcz && TRM.szcz.rez && TRM.szcz.rez.id === r.id)) return;
      const poz = filtrPoz ? r.pozycje.filter(filtrPoz) : r.pozycje;
      if (!poz.length) return;
      const a = Math.min(...poz.map(p => minDnia(p.start))), b = Math.max(...poz.map(p => minDnia(p.koniec) || 1440));
      const u0 = usluga(poz[0].usluga_id);
      const kol = kolorKat(u0);
      const anul = ['anulowana', 'odrzucona', 'wygasla'].includes(r.status);
      const zn = [];
      if (r.status !== 'potwierdzona') zn.push(`<span class="st">${esc(ST_LABEL[r.status] ? ST_LABEL[r.status][0] : r.status)}</span>`);
      if (r.obecnosc === 'nieobecny') zn.push('<span class="st">Nieobecna</span>'); else if (r.obecnosc === 'spozniony') zn.push('<span class="st">Spóźniona</span>');
      if (r.wykonanie === 'wykonana') zn.push(r.sprzedaz_id ? '<span class="st">Rozliczona</span>' : '<span class="st">Do rozliczenia</span>'); else if (r.wykonanie === 'w_toku') zn.push('<span class="st">W trakcie</span>'); else if (r.obecnosc === 'przybyl') zn.push('<span class="st">Przybyła</span>');
      if (r.kanal === 'online' || r.kanal === 'klub') zn.push('<span>Online</span>');
      const naz = poz.map(p => p.kategoria + (p.wariant ? ' · ' + p.wariant : '')).join(' + ');
      const mozePrzeciagac = !!dragPrac && operacyjna() && !anul && r.wykonanie === 'zaplanowana';
      const pozIdsCsv = poz.map(x => x.id).join(',');
      const krotka = (b - a) < 40;
      s += `<div class="trm-karta ${anul ? 'anul' : ''} ${r.wykonanie === 'wykonana' ? 'wyk' : ''} ${r.obecnosc === 'nieobecny' ? 'nieob' : ''} ${TRM.szcz && TRM.szcz.rez && TRM.szcz.rez.id === r.id ? 'akt' : ''} ${mozePrzeciagac ? 'przeciagalna' : ''} ${krotka ? 'krotka' : ''}" data-rezerwacja="${r.id}" data-pozycje="${pozIdsCsv}" data-prac-zrodlo="${mozePrzeciagac ? esc(dragPrac) : ''}" ${mozePrzeciagac ? 'onpointerdown="TRM.pDown(event)"' : ''} style="--kat:${kol};--tlo:${kol}1f;top:${(a - zak.od) * PX}px;height:${Math.max(22, (b - a) * PX - 2)}px" onclick="event.stopPropagation();TRM.kartaKlik(event, ${r.id})" title="${esc(r.klient_nazwa + ' — ' + naz)}${mozePrzeciagac ? ' · przeciągnij, aby zmienić termin lub osobę' : ''}">
        <div class="g">${hhmm(poz[0].start)}–${hhmm(poz[poz.length - 1].koniec)}</div><div class="k">${esc(r.klient_nazwa)}</div><div class="u">${esc(naz)}</div>${zn.length ? `<div class="zn">${zn.slice(0, 2).join('')}</div>` : ''}
      </div>`;
    });
    return `<div class="trm-col" data-prac="${dragPrac ? esc(dragPrac) : ''}" style="height:${h * PX}px" ${klik ? `onclick="${klik}"` : ''}>${s}<div id="trm-teraz-slot"></div></div>`;
  }
  function kolumnaGodzin(zak) {
    let s = '';
    for (let m = zak.od; m <= zak.do; m += 60) s += `<div class="trm-hour" style="top:${(m - zak.od) * PX}px;${m === zak.od ? 'transform:none' : ''}">${pad(m / 60)}:00</div>`;
    return `<div class="trm-hours" style="height:${(zak.do - zak.od) * PX}px;position:relative">${s}</div>`;
  }
  function liniaTeraz(zak) {
    if (TRM.data !== dzisStr()) return;
    const t = minDnia(TRM.dzien ? TRM.dzien.teraz : '') || (new Date().getHours() * 60 + new Date().getMinutes());
    if (t < zak.od || t > zak.do) return;
    document.querySelectorAll('#trm-main .trm-col').forEach(c => { const d = document.createElement('div'); d.className = 'teraz'; d.style.top = ((t - zak.od) * PX) + 'px'; c.appendChild(d); });
  }
  TRM.klikSiatka = (ev, pracownik) => {
    if (!operacyjna()) return;
    const col = ev.currentTarget; const rect = col.getBoundingClientRect();
    const zak = TRM._zak || { od: 480 };
    const siatka = (TRM.dane.ustawienia.siatka_min || 15);
    let m = zak.od + Math.floor((ev.clientY - rect.top) / PX); m = Math.floor(m / siatka) * siatka;
    TRM.nowaWizyta({ start: `${TRM.data} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`, pracownik });
  };

  // ── CHMURKA: krótki podgląd po najechaniu/kliknięciu karty, bez otwierania pełnego panelu ──
  // Najazd ~240ms otwiera, przejście z karty do chmurki jej nie zamyka (tolerancja ~220ms po opuszczeniu).
  // Kliknięcie karty przypina. Dane bierzemy z już wczytanego TRM.dzien — bez dodatkowego zapytania.
  let trmHoverT = null, trmLeaveT = null;
  const rezZDnia = (id) => (TRM.dzien && TRM.dzien.rezerwacje || []).find(r => r.id === id);
  function trmPokazBuble() {
    const layer = el('trm-bubble-layer'); if (!layer || !TRM.bubla) return;
    const r = rezZDnia(TRM.bubla.id);
    if (!r) { layer.innerHTML = ''; TRM.bubla = null; return; }
    const p = r.pozycje[0] || {};
    const rect = TRM.bubla.rect, szer = 380;
    let left = rect.right + 14; if (left + szer > window.innerWidth - 16) left = Math.max(12, rect.left - szer - 14);
    const top = Math.max(12, Math.min(rect.top - 80, window.innerHeight - 420));
    const anul = ['anulowana', 'odrzucona', 'wygasla'].includes(r.status);
    const aktywna = !anul && r.wykonanie !== 'wykonana';
    layer.innerHTML = `<div class="trm-bubble" style="left:${left}px;top:${Math.max(12, top)}px" role="dialog" aria-label="Podgląd wizyty" tabindex="-1">
      <div class="trm-row" style="margin-bottom:4px">${pill(ST_LABEL[r.status])}<div class="trm-spacer"></div><button class="trm-x" onclick="TRM.zamknijBuble()" title="Zamknij podgląd">✕</button></div>
      <h4>${esc(r.klient_nazwa)}</h4>
      <div class="muted small">${esc(ladnaData(r.start.slice(0, 10)))} · <b>${hhmm(r.start)}–${hhmm(r.koniec)}</b></div>
      <div style="margin-top:10px"><b>${esc(r.pozycje.map(x => x.kategoria + (x.wariant ? ' / ' + x.wariant : '')).join(' + '))}</b>
        <div class="muted small">${esc(p.pracownik || '—')}${p.gabinet ? ' · ' + esc(p.gabinet) : ''}${p.urzadzenie ? ' · ' + esc(p.urzadzenie) : ''}</div>
      </div>
      <div class="trm-bubble-foot">
        ${aktywna && operacyjna() && r.obecnosc !== 'przybyl' ? `<button class="trm-btn sm" onclick="TRM.bublaObecnosc('przybyl')">Przybyła</button>` : ''}
        ${aktywna && operacyjna() && r.wykonanie === 'zaplanowana' ? `<button class="trm-btn sm" onclick="TRM.bublaPrzelozenie()">Przełóż</button>` : ''}
        <button class="trm-btn sm primary" onclick="TRM.bublaSzczegoly()">Szczegóły</button>
      </div>
    </div>`;
  }
  TRM.zamknijBuble = () => { TRM.bubla = null; const l = el('trm-bubble-layer'); if (l) l.innerHTML = ''; };
  TRM.bublaSzczegoly = async () => { const id = TRM.bubla.id; TRM.zamknijBuble(); await TRM.otworzSzczegoly(id); };
  TRM.bublaPrzelozenie = async () => { const id = TRM.bubla.id; TRM.zamknijBuble(); await TRM.otworzSzczegoly(id); if (!TRM.szcz || !TRM.szcz.rez) return; TRM.szcz.tryb = 'zmiana'; TRM.zm = { start: TRM.szcz.rez.start.slice(0, 16), prac: {} }; TRM.renderSzczegoly(); };
  TRM.bublaObecnosc = async (stan) => { const id = TRM.bubla.id; TRM.zamknijBuble(); const d = await api('trm_obecnosc', { id, obecnosc: stan }); if (d.status !== 'success') return toast('error', 'Nie udało się', d.message); toast('success', 'Zapisano'); await odswiez(); };
  TRM.kartaKlik = (ev, id) => {
    if (TRM._suprimKlik && Date.now() < TRM._suprimKlik) return;
    clearTimeout(trmHoverT); clearTimeout(trmLeaveT);
    TRM.bubla = { id, pinned: true, rect: ev.currentTarget.getBoundingClientRect() };
    trmPokazBuble();
  };
  function trmHoverKarta(ev) {
    if (drag || ev.pointerType === 'touch') return;
    const card = ev.target.closest('.trm-karta[data-rezerwacja]'); if (!card) return;
    clearTimeout(trmLeaveT);
    if (TRM.bubla && TRM.bubla.pinned) return;
    clearTimeout(trmHoverT);
    // ponowne sprawdzenie "pinned" w chwili odpalenia timera — kliknięcie mogło przypiąć chmurkę
    // w międzyczasie (np. szybki klik tuż po najechaniu, zanim upłynęło 240ms)
    trmHoverT = setTimeout(() => { if (drag || (TRM.bubla && TRM.bubla.pinned)) return; TRM.bubla = { id: Number(card.dataset.rezerwacja), pinned: false, rect: card.getBoundingClientRect() }; trmPokazBuble(); }, 240);
  }
  function trmLeaveKarta(ev) {
    const from = ev.target.closest('.trm-karta[data-rezerwacja], .trm-bubble'); if (!from) return;
    if (TRM.bubla && TRM.bubla.pinned) return;
    const to = ev.relatedTarget;
    if (to && to.closest && to.closest('.trm-bubble, .trm-karta[data-rezerwacja]')) return;
    clearTimeout(trmHoverT); clearTimeout(trmLeaveT);
    trmLeaveT = setTimeout(() => { if (TRM.bubla && !TRM.bubla.pinned) TRM.zamknijBuble(); }, 220);
  }

  // ── PRZECIĄGANIE kart w widoku Dzień: Pointer Events, próg 6px, podgląd celu na żywo, krok 5 minut,
  // potwierdzenie przed zapisem. Zatwierdzenie woła dokładnie trm_zmien — tę samą akcję co panel
  // „Zmień termin / osobę" — najpierw bez potwierdz (podgląd), potem z potwierdz:true po kliknięciu „Zatwierdź”.
  let drag = null, dragRaf = 0;
  TRM.pDown = (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch') return;
    const card = ev.currentTarget, lane = card.closest('.trm-col'); if (!lane) return;
    drag = { pointerId: ev.pointerId, card, lane, rezId: Number(card.dataset.rezerwacja), pozIds: (card.dataset.pozycje || '').split(',').map(Number).filter(Boolean), pracZrodlo: card.dataset.pracZrodlo, startX: ev.clientX, startY: ev.clientY, x: ev.clientX, y: ev.clientY, started: false };
  };
  function trmDragMove(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    drag.x = ev.clientX; drag.y = ev.clientY;
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      drag.started = true; TRM.zamknijBuble();
      try { drag.card.setPointerCapture(ev.pointerId); } catch (e) {}
      document.querySelectorAll('.trm').forEach(n => n.classList.add('przeciaganie'));
      drag.card.classList.add('przeciagana');
      drag.lanes = [...document.querySelectorAll('#trm-main .trm-col')];
      const tip = document.createElement('div'); tip.className = 'trm-drag-tip'; tip.setAttribute('role', 'status');
      const bl = el('trm-bubble-layer'); if (bl) bl.appendChild(tip); drag.tip = tip;
    }
    ev.preventDefault();
    if (!dragRaf) dragRaf = requestAnimationFrame(trmDragFrame);
  }
  function trmDragFrame() {
    dragRaf = 0; if (!drag || !drag.started) return;
    document.querySelectorAll('.trm-draft-slot').forEach(n => n.remove());
    const laneEl = (drag.lanes || []).find(l => { const r = l.getBoundingClientRect(); return drag.x >= r.left && drag.x < r.right; });
    if (!laneEl) { if (drag.tip) drag.tip.textContent = 'Puszczenie poza siatką anuluje zmianę.'; drag.candidate = null; return; }
    const rect = laneEl.getBoundingClientRect(), zak = TRM._zak || { od: 480 }, krok = 5;
    let m = zak.od + Math.round((drag.y - rect.top) / PX); m = Math.round(m / krok) * krok;
    const rezOryg = rezZDnia(drag.rezId), trwanie = rezOryg ? (minDnia(rezOryg.koniec) - minDnia(rezOryg.start)) : 40;
    const koniecM = m + trwanie, pracDocelowy = laneEl.dataset.prac;
    drag.candidate = { start: `${TRM.data} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`, pracDocelowy };
    const slot = document.createElement('div'); slot.className = 'trm-draft-slot';
    slot.style.top = ((m - zak.od) * PX) + 'px'; slot.style.height = Math.max(20, trwanie * PX) + 'px';
    slot.innerHTML = `<strong>${pad(Math.floor(m / 60))}:${pad(m % 60)}–${pad(Math.floor(koniecM / 60))}:${pad(koniecM % 60)}</strong>`;
    laneEl.appendChild(slot);
    if (drag.tip) {
      drag.tip.style.left = Math.max(12, Math.min(window.innerWidth - 320, drag.x + 18)) + 'px';
      drag.tip.style.top = Math.max(12, Math.min(window.innerHeight - 90, drag.y + 18)) + 'px';
      drag.tip.innerHTML = `<strong>${pad(Math.floor(m / 60))}:${pad(m % 60)}–${pad(Math.floor(koniecM / 60))}:${pad(koniecM % 60)} · ${esc(pracDocelowy || '')}</strong><br>Puść, aby sprawdzić zmianę`;
    }
  }
  function trmDragUp(ev) {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const d = drag; drag = null;
    document.querySelectorAll('.trm').forEach(n => n.classList.remove('przeciaganie'));
    if (d.card) d.card.classList.remove('przeciagana');
    if (d.tip) d.tip.remove();
    document.querySelectorAll('.trm-draft-slot').forEach(n => n.remove());
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    try { d.card.releasePointerCapture(d.pointerId); } catch (e) {}
    if (!d.started) return;
    TRM._suprimKlik = Date.now() + 350;
    if (!d.candidate) return;
    const rezOryg = rezZDnia(d.rezId); if (!rezOryg) return;
    if (d.candidate.start === rezOryg.start && (!d.candidate.pracDocelowy || d.candidate.pracDocelowy === d.pracZrodlo)) return;
    trmPotwierdzPrzesuniecie(d, rezOryg);
  }
  async function trmPotwierdzPrzesuniecie(d, rezOryg) {
    const body = { id: d.rezId, wersja: rezOryg.wersja, start: d.candidate.start };
    if (d.candidate.pracDocelowy && d.candidate.pracDocelowy !== d.pracZrodlo && d.pozIds.length) {
      const mapa = {}; d.pozIds.forEach(pid => { mapa[pid] = d.candidate.pracDocelowy; }); body.pracownicy_pozycji = mapa;
    }
    const podglad = await api('trm_zmien', body);
    if (podglad.status === 'konflikt') return trmPokazKonflikt(podglad, d);
    if (podglad.status !== 'success' || !podglad.podglad) { toast('error', 'Nie udało się', podglad.message); return; }
    trmPokazConfirmPrzesuniecia(podglad.podglad, d, body);
  }
  function trmPokazConfirmPrzesuniecia(podglad, d, body) {
    const layer = el('trm-bubble-layer'); if (!layer) return;
    const left = Math.max(12, Math.min(window.innerWidth - 332, d.x - 40)), top = Math.max(12, Math.min(window.innerHeight - 200, d.y));
    const nowy = podglad.nowy || {};
    layer.innerHTML = `<div class="trm-confirm-move" style="left:${left}px;top:${top}px" role="dialog" aria-label="Potwierdź przeniesienie">
      <div class="small muted">Propozycja — nic jeszcze nie zapisano</div>
      <div style="margin:6px 0 12px"><b>${hhmm(nowy.start)}–${hhmm(nowy.koniec)}</b>${nowy.pozycje && nowy.pozycje[0] ? ' · ' + esc(nowy.pozycje[0].pracownik || '') : ''}</div>
      <div class="trm-row"><button class="trm-btn sm fix" onclick="TRM.anulujPrzesuniecie()">Anuluj</button><button class="trm-btn sm primary fix" onclick="TRM.zatwierdzPrzesuniecie()">Zatwierdź</button></div>
    </div>`;
    TRM._oczekPrzesuniecie = { body, rezId: d.rezId };
  }
  function trmPokazKonflikt(wynik, d) {
    const layer = el('trm-bubble-layer'); if (!layer) return;
    const left = Math.max(12, Math.min(window.innerWidth - 332, d.x - 40)), top = Math.max(12, Math.min(window.innerHeight - 260, d.y));
    layer.innerHTML = `<div class="trm-confirm-move" style="left:${left}px;top:${top}px;border-color:#eab8c3" role="dialog" aria-label="Konflikt terminu">
      <div class="trm-note bad" style="margin:0 0 10px">${esc(wynik.message || 'Ten termin nie jest dostępny.')}</div>
      ${(wynik.alternatywy || []).length ? '<div class="small muted" style="margin-bottom:6px">Dostępne alternatywy:</div>' + wynik.alternatywy.slice(0, 3).map((alt, i) => `<div class="trm-row" style="margin-bottom:6px"><span class="small fix">${esc(ladnaData(alt.start.slice(0, 10), true))} · ${hhmm(alt.start)}–${hhmm(alt.koniec)}</span><button class="trm-btn sm fix" onclick="TRM.wybierzAlternatywePrzesuniecia(${i})">Wybierz</button></div>`).join('') : ''}
      <button class="trm-btn sm fix" onclick="TRM.anulujPrzesuniecie()">Zamknij</button>
    </div>`;
    TRM._alternatywyPrzesuniecia = wynik.alternatywy || []; TRM._danePrzesuniecia = d;
  }
  TRM.wybierzAlternatywePrzesuniecia = (i) => {
    const alt = (TRM._alternatywyPrzesuniecia || [])[i], d = TRM._danePrzesuniecia; if (!alt || !d) return;
    const rezOryg = rezZDnia(d.rezId); if (!rezOryg) return;
    d.candidate = { start: alt.start, pracDocelowy: alt.pozycje && alt.pozycje[0] ? alt.pozycje[0].pracownik : d.pracZrodlo };
    trmPotwierdzPrzesuniecie(d, rezOryg);
  };
  TRM.anulujPrzesuniecie = () => { TRM._oczekPrzesuniecie = null; TRM._alternatywyPrzesuniecia = null; TRM._danePrzesuniecia = null; const l = el('trm-bubble-layer'); if (l) l.innerHTML = ''; };
  TRM.zatwierdzPrzesuniecie = async () => {
    const pend = TRM._oczekPrzesuniecie; if (!pend) return;
    TRM._oczekPrzesuniecie = null; const l = el('trm-bubble-layer'); if (l) l.innerHTML = '';
    const wynik = await api('trm_zmien', { ...pend.body, potwierdz: true });
    if (wynik.status === 'konflikt') { toast('warning', 'Termin właśnie zajęty', wynik.message); await odswiez(); return; }
    if (wynik.status !== 'success') { toast('error', 'Nie przeniesiono', wynik.message); await odswiez(); return; }
    toast('success', 'Przeniesiono wizytę');
    await odswiez();
    if (TRM.szcz && TRM.szcz.id === pend.rezId) await przeladujSzczegoly();
  };
  document.addEventListener('pointermove', trmDragMove);
  document.addEventListener('pointerup', trmDragUp);
  document.addEventListener('pointerover', trmHoverKarta);
  document.addEventListener('pointerout', trmLeaveKarta);
  document.addEventListener('click', (e) => { if (TRM.bubla && TRM.bubla.pinned && !e.target.closest('.trm-bubble, .trm-karta[data-rezerwacja]')) TRM.zamknijBuble(); });

  // ── widok DZIEŃ / ZESPÓŁ (E01) ─────────────────────────────────────────
  function renderDzien() {
    const d = TRM.dzien, main = el('trm-main');
    const prac = TRM.dane.pracownicy;
    if (!prac.length) { main.innerHTML = `<div class="trm-empty"><div class="big">👩‍⚕️</div><p>Salon nie ma jeszcze pracowników (Administracja → Pracownicy).</p></div>`; return; }
    const wszPrzedz = Object.values(d.dostepnosc).flat();
    const zak = TRM._zak = zakresGodzin([...wszPrzedz, ...d.salon], d.rezerwacje);
    const brakGrafiku = prac.filter(p => !(d.dostepnosc[p] || []).length);
    let html = '';
    if (brakGrafiku.length === prac.length && !d.rezerwacje.length) {
      html += `<div class="trm-note warn">Nikt nie ma grafiku na ten dzień, więc nie ma dostępnych terminów. ${manager() ? 'Ustaw grafik w <b>Ustawienia → Grafik</b> (albo skopiuj godziny salonu jednym kliknięciem).' : 'Poproś managera o ustawienie grafiku.'}</div>`;
    }
    html += `<div class="trm-grid"><div class="trm-grid-inner" style="grid-template-columns:58px repeat(${prac.length}, minmax(180px,1fr))">
      <div class="trm-col-h hours"></div>${prac.map(p => { const dp = d.dostepnosc[p] || []; return `<div class="trm-col-h">${avatarHtml(p)}<div><div class="name">${esc(p)}</div><div class="hrs">${dp.length ? dp.map(x => hhmm(x.od) + '–' + hhmm(x.do)).join(', ') : 'brak grafiku'}</div></div></div>`; }).join('')}
      ${kolumnaGodzin(zak)}${prac.map(p => kolumnaHtml(d.rezerwacje, d.dostepnosc[p], d.nieobecnosci.filter(n => n.pracownik === p || (!n.pracownik && !n.zasob_id)), zak, `TRM.klikSiatka(event, '${esc(p).replace(/'/g, "\\'")}')`, (x) => x.pracownik === p, p)).join('')}
    </div></div>
    <div class="trm-legenda"><span style="--c:#fff;border:1px solid #E6DBD5">dostępność</span><span style="--c:#efe6dd">poza grafikiem / blokada</span><span style="--c:#BD9560">karta wizyty (kolor = kategoria)</span>${operacyjna() ? '<span class="muted">Kliknij wolne pole, żeby dodać wizytę</span>' : ''}</div>`;
    main.innerHTML = html;
    liniaTeraz(zak);
    if (TRM.panel === 'szczegoly' && TRM.szcz) renderSzczegoly();
  }

  // ── widok ZASOBY (E04) ────────────────────────────────────────────────
  function renderZasoby() {
    const d = TRM.dzien, main = el('trm-main');
    const zas = TRM.dane.zasoby.filter(z => z.aktywny && !z.zarchiwizowano);
    if (!zas.length) { main.innerHTML = `<div class="trm-empty"><div class="big">🏠</div><p>Brak gabinetów i urządzeń. ${manager() ? 'Dodaj je w Ustawienia → Zasoby.' : ''}</p></div>`; return; }
    const zak = TRM._zak = zakresGodzin(d.salon, d.rezerwacje);
    const html = `<div class="trm-grid"><div class="trm-grid-inner" style="grid-template-columns:58px repeat(${zas.length}, minmax(170px,1fr))">
      <div class="trm-col-h hours"></div>${zas.map(z => `<div class="trm-col-h"><div class="name">${z.typ === 'gabinet' ? '🏠' : '⚙️'} ${esc(z.nazwa)}</div><div class="hrs">${z.typ === 'gabinet' ? 'gabinet' : 'urządzenie'}${z.pojemnosc > 1 ? ' · ' + z.pojemnosc + ' miejsc' : ''}</div></div>`).join('')}
      ${kolumnaGodzin(zak)}${zas.map(z => {
        let kol = kolumnaHtml(d.rezerwacje, d.dostepnosc_zasobow[String(z.id)], d.nieobecnosci.filter(n => Number(n.zasob_id) === Number(z.id) || (!n.pracownik && !n.zasob_id)), zak, null, (p) => Number(p.gabinet_id) === Number(z.id) || Number(p.urzadzenie_id) === Number(z.id));
        const buf = (d.zajecia || []).filter(x => x.powod === 'bufor' && String(x.klucz) === String(z.id) && x.typ_zasobu !== 'pracownik').map(x => `<div class="trm-karta bufor" style="top:${(minDnia(x.od) - zak.od) * PX}px;height:${Math.max(10, (minDnia(x.do) - minDnia(x.od)) * PX - 2)}px">sprzątanie / bufor</div>`).join('');
        return kol.replace('<div id="trm-teraz-slot"></div>', buf);
      }).join('')}
    </div></div><div class="trm-legenda"><span class="muted">Wolny pracownik ≠ wolny komplet: każdy zapis sprawdza gabinet i sprzęt razem z osobą.</span></div>`;
    main.innerHTML = html;
    liniaTeraz(zak);
  }

  // ── widok TYDZIEŃ jednej osoby (E02) ───────────────────────────────────
  function renderTydzien(od) {
    const main = el('trm-main'), rez = TRM.zakres.rezerwacje;
    const osoba = TRM.osoba || TRM.dane.pracownicy[0];
    const dni = [0, 1, 2, 3, 4, 5, 6].map(i => dodajDni(od, i));
    const zak = TRM._zak = zakresGodzin(Object.values(TRM.dane.ustawienia.godziny).flat().map(p => ({ od: od + ' ' + p.od, do: od + ' ' + p.do })), rez);
    const graf = TRM.dane.grafik.filter(g => g.pracownik === osoba);
    const html = `<div class="trm-row" style="margin-bottom:10px"><div class="fix"><label>Osoba</label><select onchange="TRM.osoba=this.value;TRM.widokZmien('tydzien')" style="width:auto">${TRM.dane.pracownicy.map(p => `<option ${p === osoba ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div></div>
    <div class="trm-grid"><div class="trm-grid-inner" style="grid-template-columns:58px repeat(7, minmax(150px,1fr))">
      <div class="trm-col-h hours"></div>${dni.map(dz => { const g = graf.filter(x => Number(x.dzien_tyg) === dzienTyg(dz)); return `<div class="trm-col-h" style="cursor:pointer" onclick="TRM.data='${dz}';TRM.widokZmien('dzien')"><div class="name">${ladnaData(dz, true)}</div><div class="hrs">${g.length ? g.map(x => x.od + '–' + x.do).join(', ') : 'wolne'}</div></div>`; }).join('')}
      ${kolumnaGodzin(zak)}${dni.map(dz => {
        const dost = graf.filter(x => Number(x.dzien_tyg) === dzienTyg(dz)).map(x => ({ od: dz + ' ' + x.od, do: dz + ' ' + x.do }));
        const rd = rez.filter(r => r.start.slice(0, 10) === dz);
        return kolumnaHtml(rd, dost, [], zak, `TRM.data='${dz}';TRM.klikSiatka(event, '${esc(osoba).replace(/'/g, "\\'")}')`, (p) => p.pracownik === osoba);
      }).join('')}
    </div></div><div class="trm-legenda"><span class="muted">Nieobecności i blokady pokazuje widok dnia. Kliknij nagłówek dnia, żeby przejść do zespołu.</span></div>`;
    main.innerHTML = html;
  }

  // ── AGENDA (E03) ───────────────────────────────────────────────────────
  function wierszAgendy(r) {
    const poz = r.pozycje.filter(p => p.stan !== 'anulowana');
    const u0 = usluga((poz[0] || r.pozycje[0] || {}).usluga_id);
    const anul = ['anulowana', 'odrzucona', 'wygasla'].includes(r.status);
    return `<div class="trm-ag-row" style="--kat:${kolorKat(u0)};${anul ? 'opacity:.5' : ''}" onclick="TRM.otworzSzczegoly(${r.id})">
      <div class="t">${hhmm(r.start)}–${hhmm(r.koniec)}</div>
      <div><div class="k">${esc(r.klient_nazwa)}</div><div class="u">${esc(r.pozycje.map(p => p.kategoria + (p.wariant ? ' · ' + p.wariant : '') + ' — ' + p.pracownik).join(' + '))}</div></div>
      <div>${pill(ST_LABEL[r.status])} ${r.obecnosc !== 'oczekiwana' ? pill(OB_LABEL[r.obecnosc]) : ''} ${r.wykonanie !== 'zaplanowana' ? pill(WYK_LABEL[r.wykonanie]) : ''} ${r.wykonanie === 'wykonana' ? (r.sprzedaz_id ? pill(['Rozliczona', 'ok']) : pill(['Do rozliczenia', 'warn'])) : ''}</div>
    </div>`;
  }
  function renderAgenda(od, do_) {
    const main = el('trm-main'), rez = TRM.zakres.rezerwacje;
    let html = `<div class="trm-row" style="margin-bottom:10px"><div class="fix"><label>Osoba</label><select onchange="TRM.osoba=this.value||null;TRM.widokZmien('agenda')" style="width:auto"><option value="">Cały zespół</option>${TRM.dane.pracownicy.map(p => `<option ${p === TRM.osoba ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div><div class="fix muted small">${rez.length} wizyt · każda pozycja otwiera tę samą wizytę</div></div>`;
    if (!rez.length) html += `<div class="trm-empty"><div class="big">🗓️</div><p>Brak wizyt w tym zakresie.</p></div>`;
    for (let i = 0; i < 7; i++) {
      const dz = dodajDni(od, i), rd = rez.filter(r => r.start.slice(0, 10) === dz);
      if (!rd.length) continue;
      html += `<div class="trm-agenda-dzien"><h3>${ladnaData(dz)}</h3>${rd.map(wierszAgendy).join('')}</div>`;
    }
    main.innerHTML = html;
  }
  function renderAgendaDnia() {
    const d = TRM.dzien, main = el('trm-main');
    const rez = TRM.widok === 'moj' ? d.rezerwacje.filter(r => r.pozycje.some(p => p.pracownik === kto())) : d.rezerwacje;
    main.innerHTML = (TRM.widok === 'moj' ? `<div class="trm-note info">Mój dzień — ${esc(kto())}. Rozpoczęcie i zakończenie usługi zapisujesz w szczegółach wizyty.</div>` : '') + (rez.length ? rez.map(wierszAgendy).join('') : `<div class="trm-empty"><div class="big">🗓️</div><p>Brak wizyt w tym dniu.</p></div>`);
  }

  // ── PANEL: pokaż / schowaj ─────────────────────────────────────────────
  function panelOtworz(html) { const p = el('trm-panel'), b = el('trm-body'); if (!p) return; p.innerHTML = html; p.hidden = false; b.classList.add('z-panelem'); }
  TRM.panelZamknij = () => { const p = el('trm-panel'), b = el('trm-body'); if (p) { p.hidden = true; p.innerHTML = ''; } if (b) b.classList.remove('z-panelem'); TRM.panel = null; TRM.szcz = null; TRM.nowa = null; document.querySelectorAll('.trm-karta.akt').forEach(k => k.classList.remove('akt')); };
  const naglowekPanelu = (tytul, sub) => `<div class="trm-panel-head"><div><h2>${tytul}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><button class="trm-x" onclick="TRM.panelZamknij()" title="Zamknij">✕</button></div>`;

  // ── NOWA WIZYTA (E05/E06) ──────────────────────────────────────────────
  TRM.nowaWizyta = (opcje) => {
    if (!operacyjna()) return;
    const o = opcje || {};
    const start = o.start || `${TRM.data} ${pad(Math.max(8, new Date().getHours() + 1))}:00`;
    TRM.nowa = { idem: uuid(), klient: null, fraza: '', wyniki: [], nowyKlient: false, pozycje: [], start, kanal: 'recepcja', notatka: '', wynik: null, zapis: false, filtrUsl: '', szybka: !!o.start, krok: 1 };
    if (o.pracownik) TRM.nowa.domyslny = o.pracownik;
    TRM.panel = 'nowa';
    renderNowa();
    setTimeout(() => { const i = el('trm-k-fraza'); if (i) i.focus(); }, 50);
  };
  function klientWynikiHtml(wyniki) {
    return wyniki.map((k, i) => `<button type="button" class="trm-klient-karta" onclick="TRM.nowaKlient(${i})"><b>${esc(k.nazwa)}</b> <span class="m">· ${esc(k.telefon || 'brak tel.')} · ID ${esc(k.id_klienta)}</span>${k.ostrzezenie ? ' <span class="trm-pill warn">⚠</span>' : ''}</button>`).join('');
  }
  function sekcjaKlientHtml(n) {
    return `<div class="trm-field"><label>Klientka</label>
      ${n.klient ? `<div class="trm-wybrana"><b>${esc(n.klient.nazwa)}</b> <span class="muted small">· ${esc(n.klient.telefon || 'brak telefonu')} · ID ${esc(n.klient.id_klienta)}</span> <button class="trm-btn link sm" onclick="TRM.nowaKlient(null)">zmień</button>${n.klient.ostrzezenie ? `<div class="trm-note warn small">⚠ ${esc(n.klient.ostrzezenie)}</div>` : ''}</div>`
      : n.nowyKlient ? `<div class="trm-wybrana"><div class="trm-grid2"><div><label>Imię i nazwisko</label><input id="trm-nk-nazwa" value="${esc(n.nkNazwa || '')}"></div><div><label>Telefon</label><input id="trm-nk-tel" value="${esc(n.nkTel || '')}" inputmode="tel"></div></div>
          <div class="trm-row" style="margin-top:8px"><button class="trm-btn primary sm fix" onclick="TRM.nowaDodajKlienta()">Dodaj do kartoteki</button><button class="trm-btn sm fix" onclick="TRM.nowa.nowyKlient=false;TRM.renderNowa()">Wróć do szukania</button></div>
          <div class="muted small" style="margin-top:6px">Powstanie jeden profil w kartotece Klientów (tak jak przez „Dodaj klienta”). Zgody i dokumenty uzupełnia się w profilu.</div></div>`
      : `<input id="trm-k-fraza" placeholder="Nazwisko, telefon albo ID klientki…" value="${esc(n.fraza)}" oninput="TRM.nowaSzukaj(this.value)" autocomplete="off">
         <div class="trm-wyniki-klient" id="trm-k-wyniki" ${n.wyniki.length ? '' : 'hidden'}>${klientWynikiHtml(n.wyniki)}</div>
         <div class="trm-row" style="margin-top:6px"><button class="trm-btn sm fix" onclick="TRM.nowa.nowyKlient=true;TRM.nowa.nkNazwa=TRM.nowa.fraza;TRM.renderNowa()">+ Dodaj nową klientkę</button><span class="muted small">Samo nazwisko nie łączy historii — sprawdź podobny profil po telefonie.</span></div>`}
    </div>`;
  }
  function sekcjaUslugiHtml(n, lista) {
    const skonf = TRM.dane.uslugi.filter(u => u.skonfigurowana && u.aktywna);
    return `<div class="trm-field"><label>Usługi i wykonawcy</label>
      ${n.pozycje.map((p, i) => { const u = usluga(p.usluga_id); return `<div class="trm-wybrana"><div class="trm-row"><b>${esc(nazwaUslugi(u))}</b><span class="fix muted small">${u.cena != null ? zl(u.cena) : ''}</span><button class="trm-btn link sm fix" onclick="TRM.nowaUsunPoz(${i})">usuń</button></div>
        <div class="r"><select onchange="TRM.nowa.pozycje[${i}].pracownik=this.value||null;TRM.nowaUniewaznij()"><option value="">Dowolna właściwa osoba</option>${(u.pracownicy && u.pracownicy.length ? u.pracownicy : TRM.dane.pracownicy).map(x => `<option ${p.pracownik === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <input type="number" min="5" max="480" step="5" value="${p.czas_min}" title="Czas (min) — dziś krócej/dłużej" onchange="TRM.nowa.pozycje[${i}].czas_min=Number(this.value)||${u.czas_min};TRM.nowaUniewaznij()"><span class="muted small">min</span></div></div>`; }).join('')}
      <input placeholder="Szukaj usługi w cenniku…" value="${esc(n.filtrUsl)}" oninput="TRM.nowa.filtrUsl=this.value;TRM.renderNowaUslugi()" style="margin-top:6px">
      <div class="trm-usl-lista" id="trm-usl-lista">${listaUslugHtml(lista)}</div>
      ${!skonf.length ? `<div class="trm-note warn small">Żadna usługa nie ma jeszcze czasu trwania. ${manager() ? 'Ustaw go w Ustawienia → Usługi.' : 'Poproś managera o konfigurację usług w terminarzu.'}</div>` : ''}
    </div>`;
  }
  function sekcjaTerminuHtml(n) {
    return `<div class="trm-grid2">
        <div class="trm-field"><label>Data</label><input type="date" id="trm-n-data" value="${n.start.slice(0, 10)}" onchange="TRM.nowaStart()"></div>
        <div class="trm-field"><label>Godzina</label><input type="time" id="trm-n-godz" step="300" value="${n.start.slice(11, 16)}" onchange="TRM.nowaStart()"></div>
      </div>
      <div class="trm-grid2">
        <div class="trm-field"><label>Kanał</label><select onchange="TRM.nowa.kanal=this.value">${Object.entries(KANAL_LABEL).filter(([k]) => !['online', 'klub', 'import'].includes(k)).map(([k, v]) => `<option value="${k}" ${n.kanal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="trm-field"><label>&nbsp;</label><button class="trm-btn" style="width:100%" onclick="TRM.nowaSzukajTerminy()">Znajdź najbliższe terminy</button></div>
      </div>
      <div class="trm-field"><label>Notatka (wewnętrzna)</label><textarea rows="2" onchange="TRM.nowa.notatka=this.value">${esc(n.notatka)}</textarea></div>
      <div id="trm-n-wynik">${wynikHtml(n.wynik)}</div>`;
  }
  function renderNowa() {
    const n = TRM.nowa; if (!n) return;
    const fr = (n.filtrUsl || '').toLowerCase();
    const lista = TRM.dane.uslugi.filter(u => !fr || nazwaUslugi(u).toLowerCase().includes(fr)).slice(0, 60);
    panelOtworz(n.szybka ? renderNowaSzybka(n, lista) : renderNowaKreator(n, lista));
  }
  function renderNowaSzybka(n, lista) {
    return naglowekPanelu('Nowa wizyta', 'Klient → usługi → termin → komplet zasobów → zapis')
      + sekcjaKlientHtml(n) + sekcjaUslugiHtml(n, lista) + sekcjaTerminuHtml(n)
      + `<div class="trm-row" style="margin-top:10px"><button class="trm-btn" onclick="TRM.nowaSprawdz()" ${n.pozycje.length ? '' : 'disabled'}>Sprawdź komplet</button><button class="trm-btn primary" onclick="TRM.nowaZapisz()" ${n.pozycje.length && n.klient ? '' : 'disabled'} id="trm-n-zapisz">Zapisz wizytę</button></div>
      <div class="muted small" style="margin-top:8px">Zapis sprawdza pracownika, gabinet i sprzęt razem. Wynik wyszukiwarki jest ofertą, nie gwarancją — przy zapisie sprawdzamy jeszcze raz.</div>`;
  }
  function renderNowaKreator(n, lista) {
    const krok = Math.max(1, Math.min(3, n.krok || 1));
    const kroki = `<div class="trm-kroki">${['Klientka', 'Usługi', 'Termin'].map((t, i) => `<div class="trm-krok-el ${i + 1 === krok ? 'aktywny' : ''}"><b>${i + 1 < krok ? '✓' : i + 1}</b>${esc(t)}</div>`).join('')}</div>`;
    let body;
    if (krok === 1) {
      body = sekcjaKlientHtml(n) + `<div class="trm-row" style="margin-top:10px"><button class="trm-btn primary" style="width:100%" onclick="TRM.nowaDalej()" ${n.klient ? '' : 'disabled'}>Dalej</button></div>`;
    } else if (krok === 2) {
      body = sekcjaKlientHtml(n) + sekcjaUslugiHtml(n, lista) + `<div class="trm-row" style="margin-top:10px"><button class="trm-btn" onclick="TRM.nowaWstecz()">Wstecz</button><button class="trm-btn primary fix" onclick="TRM.nowaDalej()" ${n.pozycje.length ? '' : 'disabled'}>Dalej</button></div>`;
    } else {
      body = sekcjaKlientHtml(n) + sekcjaUslugiHtml(n, lista) + sekcjaTerminuHtml(n)
        + `<div class="trm-row" style="margin-top:10px"><button class="trm-btn" onclick="TRM.nowaWstecz()">Wstecz</button><button class="trm-btn fix" onclick="TRM.nowaSprawdz()" ${n.pozycje.length ? '' : 'disabled'}>Sprawdź komplet</button><button class="trm-btn primary" onclick="TRM.nowaZapisz()" ${n.pozycje.length && n.klient ? '' : 'disabled'} id="trm-n-zapisz">Zapisz wizytę</button></div>
        <div class="muted small" style="margin-top:8px">Zapis sprawdza pracownika, gabinet i sprzęt razem. Wynik wyszukiwarki jest ofertą, nie gwarancją — przy zapisie sprawdzamy jeszcze raz.</div>`;
    }
    return naglowekPanelu('Nowa wizyta', 'Klient → usługi → termin → komplet zasobów → zapis') + kroki + body;
  }
  TRM.renderNowa = renderNowa;
  TRM.nowaDalej = () => { const n = TRM.nowa; if (!n) return; if ((n.krok || 1) === 1 && !n.klient) return; if ((n.krok || 1) === 2 && !n.pozycje.length) return; n.krok = Math.min(3, (n.krok || 1) + 1); renderNowa(); };
  TRM.nowaWstecz = () => { const n = TRM.nowa; if (!n) return; n.krok = Math.max(1, (n.krok || 1) - 1); renderNowa(); };
  function listaUslugHtml(lista) {
    return lista.length ? lista.map(u => `<div class="trm-usl-karta ${u.skonfigurowana && u.aktywna ? '' : 'off'}" onclick="${u.skonfigurowana && u.aktywna ? `TRM.nowaDodajPoz('${esc(u.id)}')` : ''}" title="${u.skonfigurowana ? '' : 'Brak czasu trwania — skonfiguruj w Ustawieniach'}"><span>${esc(nazwaUslugi(u))}</span><span class="muted">${u.skonfigurowana ? u.czas_min + ' min' : 'brak czasu'}${u.cena != null ? ' · ' + zl(u.cena) : ''}</span></div>`).join('') : '<div class="muted" style="padding:8px 10px">Brak usług w cenniku.</div>';
  }
  TRM.renderNowaUslugi = () => { const fr = (TRM.nowa.filtrUsl || '').toLowerCase(); const l = el('trm-usl-lista'); if (l) l.innerHTML = listaUslugHtml(TRM.dane.uslugi.filter(u => !fr || nazwaUslugi(u).toLowerCase().includes(fr)).slice(0, 60)); };
  let szukajT = null;
  TRM.nowaSzukaj = (v) => { TRM.nowa.fraza = v; clearTimeout(szukajT); szukajT = setTimeout(async () => { const d = await api('trm_szukaj_klienta', { fraza: v }); if (!TRM.nowa) return; TRM.nowa.wyniki = d.klienci || []; const w = el('trm-k-wyniki'); if (w) { w.hidden = !TRM.nowa.wyniki.length; w.innerHTML = klientWynikiHtml(TRM.nowa.wyniki); } }, 250); };
  TRM.nowaKlient = (i) => { TRM.nowa.klient = i == null ? null : TRM.nowa.wyniki[i]; TRM.nowa.wynik = null; renderNowa(); if (i == null) setTimeout(() => { const f = el('trm-k-fraza'); if (f) f.focus(); }, 30); };
  TRM.nowaDodajKlienta = async () => {
    const nazwa = (el('trm-nk-nazwa').value || '').trim(), tel = (el('trm-nk-tel').value || '').trim();
    if (nazwa.length < 3) return toast('warning', 'Podaj imię i nazwisko');
    const d = await api('add_client', { tryb: 'FULL', klient: nazwa, telefon: tel, zgoda_regulamin: false, data_podpisu: null });
    if (d.status !== 'success') return toast('error', 'Nie dodano klientki', d.message);
    const s = await api('trm_szukaj_klienta', { fraza: tel || nazwa });
    const k = (s.klienci || []).find(x => x.nazwa === nazwa) || (s.klienci || [])[0];
    if (typeof zaladujListeKlientow === 'function') zaladujListeKlientow(true);
    TRM.nowa.nowyKlient = false; TRM.nowa.klient = k || null; TRM.nowa.wynik = null; renderNowa();
    toast('success', 'Klientka dodana', k ? 'Profil powiązany z wizytą.' : 'Wyszukaj ją i wybierz.');
  };
  TRM.nowaDodajPoz = (id) => { const u = usluga(id); if (!u) return; TRM.nowa.pozycje.push({ usluga_id: u.id, pracownik: TRM.nowa.domyslny && (!u.pracownicy || !u.pracownicy.length || u.pracownicy.includes(TRM.nowa.domyslny)) ? TRM.nowa.domyslny : null, czas_min: u.czas_min }); TRM.nowa.filtrUsl = ''; TRM.nowa.wynik = null; renderNowa(); };
  TRM.nowaUsunPoz = (i) => { TRM.nowa.pozycje.splice(i, 1); TRM.nowa.wynik = null; renderNowa(); };
  TRM.nowaUniewaznij = () => { TRM.nowa.wynik = null; const w = el('trm-n-wynik'); if (w) w.innerHTML = ''; };
  TRM.nowaStart = () => { const dt = el('trm-n-data').value, g = el('trm-n-godz').value; if (dt && g) { TRM.nowa.start = `${dt} ${g}`; TRM.nowaUniewaznij(); } };
  function wynikHtml(w) {
    if (!w) return '';
    if (w.ok) return `<div class="trm-note ok"><b>Cały komplet jest dostępny</b> · ${hhmm(w.start)}–${hhmm(w.koniec)}${w.przerwy_min ? ` (w tym ${w.przerwy_min} min przerwy)` : ''}<br>${w.pozycje.map(p => `${esc(p.nazwa)} — <b>${esc(p.pracownik)}</b>${p.gabinet_id ? ' · ' + esc((zasob(p.gabinet_id) || {}).nazwa || 'gabinet') : ''}${p.urzadzenie_id ? ' · ' + esc((zasob(p.urzadzenie_id) || {}).nazwa || 'urządzenie') : ''} (${hhmm(p.start)}–${hhmm(p.koniec)})`).join('<br>')}</div>`;
    return `<div class="trm-note bad"><b>Wybrany komplet nie jest dostępny.</b><br>${(w.problemy || []).map(p => esc(p.opis)).join('<br>')}</div>` + alternatywyHtml(w.alternatywy, 'TRM.nowaWybierzAlt');
  }
  function alternatywyHtml(alt, fn) {
    if (!alt || !alt.length) return '<div class="muted small">Brak alternatyw w najbliższych dniach — zmień zakres albo osobę.</div>';
    return `<div class="small muted" style="margin-top:8px">Dostępne rozwiązania:</div>` + alt.map((a, i) => `<div class="trm-alt"><div><b>${ladnaData(a.start.slice(0, 10), true)} · ${hhmm(a.start)}–${hhmm(a.koniec)}</b><div class="d">${esc(a.opis || '')} · ${a.pozycje.map(p => p.pracownik).join(', ')}</div></div><button class="trm-btn sm" onclick="${fn}(${i})">Wybierz</button></div>`).join('');
  }
  TRM.nowaWybierzAlt = (i) => { const a = TRM.nowa.wynik.alternatywy[i]; TRM.nowa.start = a.start.slice(0, 16); a.pozycje.forEach((p, j) => { if (TRM.nowa.pozycje[j]) TRM.nowa.pozycje[j].pracownik = p.pracownik; }); TRM.nowa.wynik = null; renderNowa(); TRM.nowaSprawdz(); };
  TRM.nowaSprawdz = async () => {
    const n = TRM.nowa; if (!n || !n.pozycje.length) return;
    const w = el('trm-n-wynik'); if (w) w.innerHTML = '<div class="muted small">Sprawdzamy komplet…</div>';
    const d = await api('trm_sprawdz', { start: n.start, pozycje: n.pozycje, id_klienta: n.klient ? n.klient.id_klienta : null });
    if (d.status !== 'success') { if (w) w.innerHTML = `<div class="trm-note bad">${esc(d.message)}</div>`; return; }
    n.wynik = d; if (w) w.innerHTML = wynikHtml(d);
  };
  TRM.nowaSzukajTerminy = async () => {
    const n = TRM.nowa; if (!n || !n.pozycje.length) return toast('warning', 'Najpierw wybierz usługę');
    const w = el('trm-n-wynik'); if (w) w.innerHTML = '<div class="muted small">Szukamy pełnych kompletów (14 dni)…</div>';
    const od = n.start.slice(0, 10);
    const d = await api('trm_szukaj', { dzien_od: od, dzien_do: dodajDni(od, 13), pozycje: n.pozycje, limit: 8, id_klienta: n.klient ? n.klient.id_klienta : null });
    if (d.status !== 'success') { if (w) w.innerHTML = `<div class="trm-note bad">${esc(d.message)}</div>`; return; }
    n.wynik = { ok: false, problemy: [], alternatywy: d.terminy.map(t => ({ ...t, opis: 'Pełny komplet' })) };
    if (w) w.innerHTML = d.terminy.length ? `<div class="trm-note info">Najbliższe pełne terminy (osoby + gabinet + sprzęt):</div>` + alternatywyHtml(n.wynik.alternatywy, 'TRM.nowaWybierzAlt') : `<div class="trm-note warn">Nie znaleźliśmy terminu dla tego wyboru w 14 dni. Zmień zakres dat, osobę albo sprawdź grafik.</div>`;
  };
  TRM.nowaZapisz = async () => {
    const n = TRM.nowa; if (!n || n.zapis) return;
    if (!n.klient) return toast('warning', 'Wskaż klientkę');
    n.zapis = true; const btn = el('trm-n-zapisz'); if (btn) { btn.disabled = true; btn.textContent = 'Zapisujemy…'; }
    const d = await api('trm_zapisz', { klucz_idem: n.idem, klient: { id_klienta: n.klient.id_klienta, nazwa: n.klient.nazwa }, pozycje: n.pozycje, start: n.start, kanal: n.kanal, notatka: n.notatka });
    n.zapis = false;
    if (d.status === 'konflikt') { n.wynik = { ok: false, problemy: d.problemy, alternatywy: d.alternatywy }; n.idem = uuid(); renderNowa(); return toast('warning', 'Termin niedostępny', d.message); }
    if (d.status !== 'success') { if (btn) { btn.disabled = false; btn.textContent = 'Zapisz wizytę'; } return toast('error', 'Nie zapisano', d.message); }
    toast('success', d.powtorzenie ? 'Ta wizyta była już zapisana' : 'Zapisano wizytę', `${d.rezerwacja.numer} · ${d.rezerwacja.klient_nazwa} · ${hhmm(d.rezerwacja.start)}`);
    TRM.data = d.rezerwacja.start.slice(0, 10); const di = el('trm-data'); if (di) di.value = TRM.data;
    TRM.nowa = null; TRM.panel = null;
    await odswiez();
    TRM.otworzSzczegoly(d.rezerwacja.id);
  };

  // ── CENTRUM POWIADOMIEŃ: Sprawy ─────────────────────────────────────────
  TRM.otworzPowiadomienia = async () => {
    TRM.panel = 'powiadomienia';
    panelOtworz(naglowekPanelu('Powiadomienia', 'Pobieramy…'));
    await zaladujSprawy(TRM.sprawy.zakladka);
  };
  async function zaladujSprawy(zakladka) {
    TRM.sprawy.zakladka = zakladka;
    const d = await api('trm_sprawy_lista', { zakladka });
    if (d.status !== 'success') { panelOtworz(naglowekPanelu('Powiadomienia') + `<div class="trm-note bad">${esc(d.message)}</div>`); return; }
    TRM.sprawy.lista = d.sprawy;
    renderSprawyLista();
    odswiezLicznikSpraw();
  }
  TRM.sprawyZakladka = (z) => zaladujSprawy(z);
  function renderSprawyLista() {
    const z = TRM.sprawy.zakladka, lista = TRM.sprawy.lista;
    const html = naglowekPanelu('Powiadomienia', `${lista.length} ${lista.length === 1 ? 'sprawa' : lista.length % 10 >= 2 && lista.length % 10 <= 4 && (lista.length % 100 < 10 || lista.length % 100 >= 20) ? 'sprawy' : 'spraw'}`) +
      `<div class="trm-tabs sm">${SPRAWY_TABY.map(([k, n]) => `<button class="${z === k ? 'on' : ''}" onclick="TRM.sprawyZakladka('${k}')">${n}</button>`).join('')}</div>` +
      (lista.length ? `<div class="trm-sprawy-lista">${lista.map(kartaSprawy).join('')}</div>` : `<div class="trm-empty"><div class="big">✅</div><p>Brak spraw w tej zakładce.</p></div>`);
    panelOtworz(html);
  }
  function kartaSprawy(sp) {
    const [plab, pcls] = PRIOR_LABEL[sp.priorytet] || ['', 'neu'];
    const termin = sp.termin_dzialania ? terminEtykieta(sp.termin_dzialania) : null;
    const czas = (sp.powiazany_czas || sp.utworzono || '').slice(0, 16).replace(' ', ' · ');
    const mozePrzejac = sp.priorytet !== 'P2' && !sp.wlasciciel && !['rozwiazana', 'nieaktualna'].includes(sp.stan);
    return `<div class="trm-sprawa-karta ${pcls} ${sp.przeczytane ? '' : 'nieprz'}" onclick="TRM.otworzSprawe(${sp.id})">
      <div class="trm-sprawa-gora"><span class="trm-pill ${pcls}">${esc(termin ? `${plab} · ${termin}` : plab)}</span>${!sp.przeczytane ? '<span class="trm-kropka" title="Nieprzeczytane"></span>' : ''}${!termin ? `<span class="fix muted small">${esc(czas)}</span>` : ''}</div>
      <div class="trm-sprawa-tytul">${esc(sp.tytul)}</div>
      ${sp.opis ? `<div class="muted small trm-sprawa-opis">${esc(sp.opis)}</div>` : ''}
      <div class="trm-sprawa-dol">
        <div class="trm-sprawa-prowadzi">${sp.wlasciciel ? `${avatarHtml(sp.wlasciciel, true)}<span class="muted small">Prowadzi: <b>${esc(sp.wlasciciel)}</b></span>` : (sp.priorytet !== 'P2' ? '<span class="muted small">Nikt jeszcze nie przejął</span>' : '')}</div>
        ${mozePrzejac ? `<button class="trm-btn primary sm fix" onclick="event.stopPropagation();TRM.sprawaPrzejmij(${sp.id})">Przejmij</button>` : ''}
      </div>
    </div>`;
  }
  TRM.otworzSprawe = async (id) => {
    TRM.sprawy.szczegolyId = id; TRM.sprawy.forma = null;
    panelOtworz(naglowekPanelu('Sprawa', 'Pobieramy…'));
    const d = await api('trm_sprawa_szczegoly', { id });
    if (d.status !== 'success') { panelOtworz(naglowekPanelu('Sprawa') + `<div class="trm-note bad">${esc(d.message)}</div>`); return; }
    TRM.sprawy.szczegoly = d.sprawa; TRM.sprawy.dziennik = d.dziennik || [];
    api('trm_sprawy_przeczytane', { id });
    renderSprawaSzczegoly();
    odswiezLicznikSpraw();
  };
  function danePodglad(sp) {
    const d = sp.dane || {};
    if (Array.isArray(d.dotkniete)) {
      const obsl = d.dotkniete.filter(x => x.rozwiazana).length;
      return `<div class="trm-field"><label>Dotknięte wizyty (${obsl}/${d.dotkniete.length} obsłużone)</label>
        ${d.dotkniete.map(x => `<div class="trm-dotknieta ${x.rozwiazana ? 'ok' : ''}"><div><b>${esc(x.klient_nazwa || 'wizyta')}</b><br><span class="muted small">${esc(x.kategoria || '')} · ${esc((x.start || '').slice(0, 16))} · ${esc(x.pracownik || '')}</span></div>${x.rozwiazana ? '<span class="trm-pill ok">obsłużona</span>' : `<button class="trm-btn sm fix" onclick="TRM.sprawaObsluzPozycje(${sp.id},${x.rezerwacja_id})">Obsłużono</button>`}</div>`).join('')}
      </div>`;
    }
    if (d.poprzednio && d.teraz) {
      return `<div class="trm-field"><label>Zmiana terminu</label><div class="trm-przedpo"><div><span class="muted small">było</span><br>${esc((d.poprzednio.start || '').slice(0, 16))}</div><div>→</div><div><span class="muted small">jest</span><br><b>${esc((d.teraz.start || '').slice(0, 16))}</b></div></div></div>`;
    }
    if (Array.isArray(d.pozycje) && d.pozycje.length) {
      return `<div class="trm-field"><label>Dotyczy</label>${d.pozycje.map(ppz => `<div class="small">${esc(ppz.nazwa || ppz.kategoria || '')}${ppz.wariant ? ' / ' + esc(ppz.wariant) : ''} — ${ppz.nowy !== undefined ? `${esc(ppz.poprzedni || '—')} → <b>${esc(ppz.nowy || '—')}</b>` : esc(ppz.pracownik || '—')}</div>`).join('')}</div>`;
    }
    return '';
  }
  function akcjeSprawy(sp) {
    if (['rozwiazana', 'nieaktualna'].includes(sp.stan)) return operacyjna() ? `<button class="trm-btn fix" onclick="TRM.sprawaWznow(${sp.id})">Wznów sprawę</button>` : '';
    const btns = [];
    if (!sp.wlasciciel || sp.wlasciciel !== kto()) btns.push(`<button class="trm-btn primary fix" onclick="TRM.sprawaPrzejmij(${sp.id})">Przejmij</button>`);
    btns.push(`<button class="trm-btn fix" onclick="TRM.sprawaFormaPokaz('kontakt')">Zapisz kontakt</button>`);
    btns.push(`<button class="trm-btn fix" onclick="TRM.sprawaFormaPokaz('rozwiaz')">Rozwiąż</button>`);
    if (operacyjna()) btns.push(`<button class="trm-btn fix" onclick="TRM.sprawaFormaPokaz('przekaz')">Przekaż</button>`);
    return btns.join('');
  }
  function formaSprawy() {
    const typ = TRM.sprawy.forma; if (!typ) return '';
    if (typ === 'przekaz') {
      const prac = (TRM.dane && TRM.dane.pracownicy) || [];
      return `<div class="trm-card" style="margin-top:10px"><label>Komu przekazujesz</label>
        <select id="trm-sf-komu">${prac.map(pp => `<option ${pp === kto() ? 'disabled' : ''}>${esc(pp)}</option>`).join('')}</select>
        <div style="margin-top:8px"><label>Powód (opcjonalnie)</label><input id="trm-sf-tekst" placeholder="np. koniec zmiany"></div>
        <div class="trm-row" style="margin-top:8px"><button class="trm-btn primary sm fix" onclick="TRM.sprawaWyslijForme()">Przekaż</button><button class="trm-btn sm fix" onclick="TRM.sprawaFormaAnuluj()">Anuluj</button></div></div>`;
    }
    const etyk = typ === 'kontakt' ? ['Wynik kontaktu', 'np. zadzwoniono, klientka potwierdziła zmianę…'] : ['Wynik sprawy', 'np. ustalono zastępstwo z Kasią'];
    return `<div class="trm-card" style="margin-top:10px"><label>${etyk[0]}</label>
      <textarea id="trm-sf-tekst" rows="3" placeholder="${etyk[1]}"></textarea>
      <div class="trm-row" style="margin-top:8px"><button class="trm-btn primary sm fix" onclick="TRM.sprawaWyslijForme()">Zapisz</button><button class="trm-btn sm fix" onclick="TRM.sprawaFormaAnuluj()">Anuluj</button></div></div>`;
  }
  function renderSprawaSzczegoly() {
    const sp = TRM.sprawy.szczegoly; if (!sp) return;
    const [plab, pcls] = PRIOR_LABEL[sp.priorytet] || ['', 'neu'];
    const html = naglowekPanelu('Sprawa', sp.typ) +
      `<button class="trm-btn link sm" onclick="TRM.sprawyZakladka(TRM.sprawy.zakladka)">← wróć do listy</button>
      <div class="trm-sprawa-naglowek">
        <span class="trm-pill ${pcls}">${esc(plab)}</span>
        <span class="trm-pill neu">${esc(STAN_SPRAWY_LABEL[sp.stan] || sp.stan)}</span>
        ${sp.wlasciciel ? `<span class="muted small">Prowadzi: <b>${esc(sp.wlasciciel)}</b></span>` : '<span class="muted small">Nikt jeszcze nie przejął</span>'}
      </div>
      <h2 style="margin:8px 0 4px">${esc(sp.tytul)}</h2>
      ${sp.opis ? `<div class="muted small" style="margin-bottom:10px">${esc(sp.opis)}</div>` : ''}
      ${danePodglad(sp)}
      ${sp.wynik ? `<div class="trm-note ${sp.stan === 'nieaktualna' ? 'info' : 'ok'}" style="margin-top:10px"><b>Wynik:</b> ${esc(sp.wynik)}${sp.rozwiazal ? ' — ' + esc(sp.rozwiazal) : ''}${sp.rozwiazano ? ' · ' + esc(sp.rozwiazano.slice(0, 16)) : ''}</div>` : ''}
      <div class="trm-row" style="margin-top:12px;flex-wrap:wrap;gap:6px">${akcjeSprawy(sp)}</div>
      ${formaSprawy()}
      <div class="trm-field" style="margin-top:14px"><label>Historia sprawy</label>
        ${(TRM.sprawy.dziennik || []).map(z => `<div class="trm-dziennik-wpis"><span class="muted small">${esc((z.kiedy || '').slice(0, 16))}</span> <b>${esc(z.kto || 'System')}</b> — ${esc(z.opis || z.akcja)}</div>`).join('') || '<div class="muted small">Brak wpisów.</div>'}
      </div>`;
    panelOtworz(html);
  }
  TRM.sprawaFormaPokaz = (typ) => { TRM.sprawy.forma = typ; renderSprawaSzczegoly(); setTimeout(() => { const i = el('trm-sf-tekst'); if (i) i.focus(); }, 30); };
  TRM.sprawaFormaAnuluj = () => { TRM.sprawy.forma = null; renderSprawaSzczegoly(); };
  TRM.sprawaWyslijForme = async () => {
    const typ = TRM.sprawy.forma, id = TRM.sprawy.szczegolyId;
    const tekst = ((el('trm-sf-tekst') || {}).value || '').trim();
    let d;
    if (typ === 'kontakt') { if (!tekst) return toast('warning', 'Opisz wynik kontaktu'); d = await api('trm_sprawa_kontakt', { id, tresc: tekst }); }
    else if (typ === 'rozwiaz') { if (!tekst) return toast('warning', 'Opisz wynik sprawy'); d = await api('trm_sprawa_rozwiaz', { id, wynik: tekst }); }
    else if (typ === 'przekaz') { const komu = (el('trm-sf-komu') || {}).value; if (!komu) return toast('warning', 'Wybierz osobę'); d = await api('trm_sprawa_przekaz', { id, komu, powod: tekst }); }
    if (!d || d.status !== 'success') return toast('error', 'Nie zapisano', d && d.message);
    TRM.sprawy.forma = null;
    toast('success', 'Zapisano');
    await TRM.otworzSprawe(id);
  };
  TRM.sprawaPrzejmij = async (id) => {
    const d = await api('trm_sprawa_przejmij', { id });
    if (d.status !== 'success') return toast('error', 'Nie udało się', d.message);
    if (d.juz_przejeta) toast('warning', 'Sprawa jest już przejęta', 'Prowadzi: ' + (d.sprawa.wlasciciel || '—'));
    else toast('success', 'Przejęto sprawę');
    await TRM.otworzSprawe(id);
  };
  TRM.sprawaWznow = async (id) => {
    const d = await api('trm_sprawa_wznow', { id, powod: 'Wznowiono ręcznie' });
    if (d.status !== 'success') return toast('error', 'Nie wznowiono', d.message);
    toast('success', 'Sprawa wznowiona');
    await TRM.otworzSprawe(id);
  };
  TRM.sprawaObsluzPozycje = async (id, rezerwacja_id) => {
    const d = await api('trm_sprawa_pozycja_obsluzono', { id, rezerwacja_id });
    if (d.status !== 'success') return toast('error', 'Nie udało się', d.message);
    toast('success', 'Oznaczono jako obsłużone');
    await TRM.otworzSprawe(id);
  };

  // ── SZCZEGÓŁY WIZYTY (E07) ─────────────────────────────────────────────
  TRM.otworzSzczegoly = async (id) => {
    TRM.panel = 'szczegoly'; TRM.szcz = { id, tryb: 'podglad' };
    panelOtworz(naglowekPanelu('Wizyta', 'Pobieramy…'));
    const d = await api('trm_rezerwacja', { id });
    if (d.status !== 'success') { panelOtworz(naglowekPanelu('Wizyta') + `<div class="trm-note bad">${esc(d.message)}</div>`); return; }
    TRM.szcz = { id, tryb: 'podglad', rez: d.rezerwacja, historia: d.historia, sprzedaz: d.sprzedaz };
    document.querySelectorAll('.trm-karta.akt').forEach(k => k.classList.remove('akt'));
    renderSzczegoly();
  };
  async function przeladujSzczegoly(rez) {
    if (rez) TRM.szcz.rez = rez;
    const d = await api('trm_rezerwacja', { id: TRM.szcz.id });
    if (d.status === 'success') { TRM.szcz.rez = d.rezerwacja; TRM.szcz.historia = d.historia; TRM.szcz.sprzedaz = d.sprzedaz; }
    TRM.szcz.tryb = 'podglad'; renderSzczegoly();
    if (TRM.widok === 'ustawienia') return;
    await odswiez();
  }
  function wizytaKartaHtml(r, s, anul, op) {
    let h = `<div class="trm-card"><h3>Usługi</h3>${r.pozycje.map(p => {
      const u = usluga(p.usluga_id);
      const akcje = [];
      const moge = op || (specjalista() && p.pracownik === kto());
      if (!anul && moge) {
        if (p.stan === 'zaplanowana') { akcje.push(`<button class="trm-btn sm ok" onclick="TRM.pozStan(${p.id},'w_trakcie')">▶ Rozpocznij</button>`); akcje.push(`<button class="trm-btn sm" onclick="TRM.pozStan(${p.id},'wykonana')">✓ Wykonana</button>`); if (op) akcje.push(`<button class="trm-btn sm" onclick="TRM.pozStan(${p.id},'niewykonana')">Nie wykonano</button>`); akcje.push(`<button class="trm-btn sm" onclick="TRM.pozStan(${p.id},'odmowa','Odmowa kwalifikacji — powód (zostanie w historii):')">Odmowa kwalifikacji</button>`); }
        if (p.stan === 'w_trakcie') { akcje.push(`<button class="trm-btn sm ok" onclick="TRM.pozStan(${p.id},'wykonana')">■ Zakończ</button>`); akcje.push(`<button class="trm-btn sm danger" onclick="TRM.pozStan(${p.id},'przerwana','Powód przerwania:')">Przerwij</button>`); }
      }
      return `<div class="trm-poz" style="border-left:4px solid ${kolorKat(u)}"><div class="trm-row"><div class="n">${esc(p.kategoria)}${p.wariant ? ' · ' + esc(p.wariant) : ''}</div><span class="fix trm-pill ${p.stan === 'wykonana' ? 'ok' : p.stan === 'w_trakcie' ? 'info' : ['anulowana', 'niewykonana', 'odmowa', 'przerwana'].includes(p.stan) ? 'bad' : 'neu'}">${POZ_LABEL[p.stan] || p.stan}</span></div>
        <div class="m">${hhmm(p.start)}–${hhmm(p.koniec)} · ${p.czas_min} min · <b>${esc(p.pracownik)}</b>${p.wykonawca_fakt && p.wykonawca_fakt !== p.pracownik ? ' (wykonała: ' + esc(p.wykonawca_fakt) + ')' : ''}${p.gabinet ? ' · ' + esc(p.gabinet) : ''}${p.urzadzenie ? ' · ' + esc(p.urzadzenie) : ''}${p.cena != null && op ? ' · ' + zl(p.cena) : ''}</div>
        ${p.start_fakt ? `<div class="m">Faktycznie: ${hhmm(p.start_fakt)}${p.koniec_fakt ? '–' + hhmm(p.koniec_fakt) : ' (trwa)'}</div>` : ''}
        ${akcje.length ? `<div class="a">${akcje.join('')}</div>` : ''}</div>`;
    }).join('')}</div>`;
    if (op && !anul) {
      h += `<div class="trm-card"><h3>Obecność i obsługa</h3><div class="trm-row">
        ${r.obecnosc !== 'przybyl' ? `<button class="trm-btn ok sm" onclick="TRM.obecnosc('przybyl')">Klientka przybyła</button>` : ''}
        ${r.obecnosc !== 'spozniony' && r.wykonanie === 'zaplanowana' ? `<button class="trm-btn sm" onclick="TRM.obecnosc('spozniony')">Spóźniona</button>` : ''}
        ${r.obecnosc !== 'nieobecny' && r.wykonanie === 'zaplanowana' ? `<button class="trm-btn danger sm" onclick="TRM.obecnosc('nieobecny')">Nieobecna</button>` : ''}
      </div><div class="muted small" style="margin-top:6px">Nieobecność potwierdza człowiek — system jej nie zgaduje. Jednostka karnetu nie jest zużywana.</div>
      <div class="trm-row" style="margin-top:10px">
        ${r.wykonanie === 'zaplanowana' ? `<button class="trm-btn" onclick="TRM.szcz.tryb='zmiana';TRM.zm={start:TRM.szcz.rez.start.slice(0,16),prac:{}};TRM.renderSzczegoly()">Zmień termin / osobę</button>` : ''}
        ${r.pozycje.some(p => p.stan === 'zaplanowana') ? `<button class="trm-btn danger" onclick="TRM.szcz.tryb='anuluj';TRM.an={zakres:'cala',kto:'klient',powod:''};TRM.renderSzczegoly()">Odwołaj / rozpatrz</button>` : ''}
      </div></div>`;
      h += `<div class="trm-card"><h3>Notatka</h3><textarea rows="2" id="trm-s-notatka">${esc(r.notatka || '')}</textarea><div class="trm-row" style="margin-top:6px"><button class="trm-btn sm fix" onclick="TRM.zapiszNotatke()">Zapisz notatkę</button></div></div>`;
    } else if (r.notatka && op) h += `<div class="trm-card"><h3>Notatka</h3><div class="small">${esc(r.notatka)}</div></div>`;
    if (anul) h += `<div class="trm-note bad">Odwołana ${esc(hhmm(r.anulowano || ''))} ${r.anulowano ? esc(r.anulowano.slice(0, 10)) : ''} przez ${r.kto_anulowal === 'klient' ? 'klientkę' : 'salon'}${r.anulowal ? ' (' + esc(r.anulowal) + ')' : ''}: ${esc(r.powod_anulacji || '')}. Odtworzenie to nowa rezerwacja z pełną walidacją.</div>`;
    return h;
  }
  function rozliczenieHtml(r, s, suma, anul) {
    return `<div class="trm-card"><h3>Rozliczenie</h3><div class="trm-kwota"><span>Cena usług wg cennika</span><b>${zl(suma)}</b></div><div class="trm-kwota suma"><span>${r.sprzedaz_id ? 'Sprzedaż' : 'Stan'}</span><span>${r.sprzedaz_id ? '<code>' + esc(r.sprzedaz_id) + '</code>' : (r.wykonanie === 'wykonana' || r.wykonanie === 'czesciowo' ? 'Do rozliczenia' : 'Po wykonaniu')}</span></div>
      ${s.sprzedaz && s.sprzedaz.length ? `<div class="small muted" style="margin-top:6px">${s.sprzedaz.map(x => `${esc(x.data)} · ${esc(x.zabieg)}${x.szczegoly ? ' / ' + esc(x.szczegoly) : ''} · ${zl(x.kwota)} · ${esc(x.platnosc || '')}`).join('<br>')}</div>` : ''}
      <div class="muted small" style="margin-top:6px">Zadatki, karnety i vouchery rozlicza istniejąca Sprzedaż — terminarz nie tworzy drugiej kasy. Wpłata ≠ wykonanie ≠ rozliczenie.</div>
      ${!anul && !r.sprzedaz_id && (r.wykonanie === 'wykonana' || r.wykonanie === 'czesciowo') ? `<div class="trm-row" style="margin-top:8px"><button class="trm-btn primary" onclick="TRM.rozlicz()">Rozlicz w Sprzedaży</button>${r.rozliczenie_od ? `<button class="trm-btn" onclick="TRM.rozliczPowiaz()">Powiąż zapisaną sprzedaż</button>` : ''}</div>` : ''}
    </div>`;
  }
  function historiaHtml(s) {
    if (!s.historia || !s.historia.length) return '<div class="trm-empty"><div class="big">🗒️</div><p>Brak zdarzeń w historii tej wizyty.</p></div>';
    return `<div class="trm-card"><h3>Historia</h3><div class="trm-hist">${s.historia.map(h => `<div><b>${esc(h.kiedy.slice(5, 16))}</b> · ${esc(h.kto || 'system')} · ${esc(h.akcja)} — ${esc(h.opis || '')}</div>`).join('')}</div></div>`;
  }
  function renderSzczegoly() {
    const s = TRM.szcz; if (!s || !s.rez) return;
    const r = s.rez, anul = ['anulowana', 'odrzucona', 'wygasla'].includes(r.status);
    const op = operacyjna();
    const suma = r.pozycje.filter(p => p.stan !== 'anulowana').reduce((a, p) => a + (Number(p.cena) || 0), 0);
    let html = naglowekPanelu(`${esc(r.numer)} · ${esc(r.klient_nazwa)}`, `${ladnaData(r.start.slice(0, 10))} · ${hhmm(r.start)}–${hhmm(r.koniec)}`);
    html += `<div class="trm-row" style="margin-bottom:10px">${pill(ST_LABEL[r.status])}${anul ? '' : pill(OB_LABEL[r.obecnosc])}${anul ? '' : pill(WYK_LABEL[r.wykonanie])}${r.wykonanie === 'wykonana' || r.wykonanie === 'czesciowo' ? (r.sprzedaz_id ? pill(['Rozliczona', 'ok']) : pill(['Do rozliczenia', 'warn'])) : ''}</div>`;
    html += `<div class="trm-card"><div class="trm-row"><div><b>${esc(r.klient_nazwa)}</b><div class="muted small">${r.klient_telefon ? esc(r.klient_telefon) + ' · ' : ''}${r.id_klienta ? 'ID ' + esc(r.id_klienta) : 'bez kartoteki'} · kanał: ${esc(KANAL_LABEL[r.kanal] || r.kanal)}${r.brak_kontaktu ? ' · <span class="trm-pill warn">brak kontaktu</span>' : ''}</div></div>${r.id_klienta && op ? `<button class="trm-btn link sm fix" onclick="pokaz('klient-profil'); setTimeout(() => otworzProfil('${esc(r.id_klienta)}'), 100);">Profil klientki ↗</button>` : ''}</div></div>`;
    if (s.tryb === 'zmiana') return panelOtworz(html + formZmiany());
    if (s.tryb === 'anuluj') return panelOtworz(html + formAnulacji());
    const karta = op ? (s.karta || 'wizyta') : 'wizyta';
    if (op) html += `<div class="trm-tabs">${[['wizyta', 'Wizyta'], ['rozliczenie', 'Rozliczenie'], ['historia', 'Historia']].map(([k, n]) => `<button class="${karta === k ? 'aktywny' : ''}" onclick="TRM.szczegolyTab('${k}')">${n}</button>`).join('')}</div>`;
    if (karta === 'rozliczenie') html += rozliczenieHtml(r, s, suma, anul);
    else if (karta === 'historia') html += historiaHtml(s);
    else html += wizytaKartaHtml(r, s, anul, op);
    panelOtworz(html);
    const k = document.querySelector(`.trm-karta[onclick*="otworzSzczegoly(${r.id})"]`); if (k) k.classList.add('akt');
  }
  TRM.renderSzczegoly = renderSzczegoly; // inline onclick="...renderSzczegoly()" (Zmień termin/osobę, Odwołaj, Wróć) woła ją z zasięgu globalnego
  TRM.szczegolyTab = (k) => { if (!TRM.szcz) return; TRM.szcz.karta = k; renderSzczegoly(); };
  TRM.pozStan = async (pozId, stan, pytanie) => {
    let uwaga = '';
    if (pytanie) { uwaga = window.prompt(pytanie) || ''; if (!uwaga.trim()) return; }
    const d = await api('trm_pozycja_stan', { id: TRM.szcz.id, pozycja_id: pozId, stan, uwaga });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    if (d.powtorzenie) toast('info', 'Bez zmian', 'Ten stan był już zapisany.');
    await przeladujSzczegoly(d.rezerwacja);
  };
  TRM.obecnosc = async (ob) => {
    if (ob === 'nieobecny' && !window.confirm('Potwierdzasz, że klientka nie przybyła? Zaplanowane usługi zostaną oznaczone jako niewykonane, a zasoby zwolnione. Rozrachunek (zadatek, ulga) prowadzi się osobno w kartotece.')) return;
    const d = await api('trm_obecnosc', { id: TRM.szcz.id, obecnosc: ob });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    await przeladujSzczegoly(d.rezerwacja);
  };
  TRM.zapiszNotatke = async () => { const d = await api('trm_notatka', { id: TRM.szcz.id, notatka: el('trm-s-notatka').value }); if (d.status === 'success') toast('success', 'Zapisano notatkę'); else toast('error', 'Nie zapisano', d.message); };

  // zmiana terminu (E08/E09)
  function formZmiany() {
    const r = TRM.szcz.rez, z = TRM.zm, akt = r.pozycje.filter(p => p.stan !== 'anulowana');
    return `<div class="trm-card"><h3>Zmień termin / osobę</h3>
      <div class="trm-note info small">Obecna wizyta pozostaje: <b>${ladnaData(r.start.slice(0, 10), true)} ${hhmm(r.start)}</b>. Zmienimy ją dopiero po poprawnym zatwierdzeniu.</div>
      <div class="trm-grid2"><div class="trm-field"><label>Nowa data</label><input type="date" id="trm-z-data" value="${z.start.slice(0, 10)}"></div><div class="trm-field"><label>Godzina</label><input type="time" id="trm-z-godz" step="300" value="${z.start.slice(11, 16)}"></div></div>
      ${akt.map(p => { const u = usluga(p.usluga_id); const lista = (u && u.pracownicy && u.pracownicy.length) ? u.pracownicy : TRM.dane.pracownicy; return `<div class="trm-field"><label>${esc(p.kategoria)}${p.wariant ? ' · ' + esc(p.wariant) : ''}</label><select onchange="TRM.zm.prac['${p.id}']=this.value||null"><option value="">Dowolna właściwa osoba</option>${lista.map(x => `<option ${(z.prac[p.id] !== undefined ? z.prac[p.id] : p.pracownik) === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>`; }).join('')}
      <div class="trm-field"><label>Powód (opcjonalnie)</label><input id="trm-z-powod" placeholder="np. prośba klientki"></div>
      <div id="trm-z-wynik">${z.wynik ? podgladZmianyHtml(z.wynik) : ''}</div>
      <div class="trm-row" style="margin-top:8px"><button class="trm-btn" onclick="TRM.zmianaSprawdz(false)">Sprawdź</button><button class="trm-btn primary" onclick="TRM.zmianaSprawdz(true)" ${z.wynik && z.wynik.status === 'success' ? '' : 'disabled'} id="trm-z-ok">Zatwierdź zmianę</button><button class="trm-btn fix" onclick="TRM.szcz.tryb='podglad';TRM.renderSzczegoly()">Wróć</button></div></div>`;
  }
  function podgladZmianyHtml(d) {
    const pg = d.podglad || {};
    let h = '';
    if (d.status === 'konflikt') h += `<div class="trm-note bad"><b>${esc(d.message)}</b></div>` + alternatywyHtml(d.alternatywy, 'TRM.zmianaWybierzAlt');
    else if (pg.nowy) h += `<div class="trm-note ok"><b>Komplet dostępny</b> · ${ladnaData(pg.nowy.start.slice(0, 10), true)} ${hhmm(pg.nowy.start)}–${hhmm(pg.nowy.koniec)}<br>${pg.nowy.pozycje.map(p => `${esc(p.nazwa)} — <b>${esc(p.pracownik)}</b>${p.gabinet_id ? ' · ' + esc((zasob(p.gabinet_id) || {}).nazwa || '') : ''}${p.urzadzenie_id ? ' · ' + esc((zasob(p.urzadzenie_id) || {}).nazwa || '') : ''}`).join('<br>')}</div>`;
    return h;
  }
  TRM.zmianaSprawdz = async (potwierdz) => {
    const z = TRM.zm, r = TRM.szcz.rez;
    z.start = `${el('trm-z-data').value} ${el('trm-z-godz').value}`;
    const d = await api('trm_zmien', { id: r.id, wersja: r.wersja, start: z.start, pracownicy_pozycji: z.prac, potwierdz: !!potwierdz, powod: (el('trm-z-powod') || {}).value || '' });
    if (d.code === 'WERSJA') { toast('warning', 'Ktoś zmienił tę wizytę', 'Sprawdź aktualne dane przed zapisaniem.'); return przeladujSzczegoly(d.rezerwacja); }
    if (d.status === 'error') return toast('error', 'Nie można zmienić', d.message);
    if (potwierdz && d.status === 'success' && d.rezerwacja) { toast('success', 'Termin zmieniony', `${d.rezerwacja.numer} · ${hhmm(d.rezerwacja.start)}`); TRM.data = d.rezerwacja.start.slice(0, 10); const di = el('trm-data'); if (di) di.value = TRM.data; return przeladujSzczegoly(d.rezerwacja); }
    z.wynik = d; const w = el('trm-z-wynik'); if (w) w.innerHTML = podgladZmianyHtml(d); const ok = el('trm-z-ok'); if (ok) ok.disabled = d.status !== 'success';
  };
  TRM.zmianaWybierzAlt = (i) => { const a = TRM.zm.wynik.alternatywy[i]; TRM.zm.start = a.start.slice(0, 16); const akt = TRM.szcz.rez.pozycje.filter(p => p.stan !== 'anulowana'); a.pozycje.forEach((p, j) => { if (akt[j]) TRM.zm.prac[akt[j].id] = p.pracownik; }); TRM.zm.wynik = null; renderSzczegoly(); TRM.zmianaSprawdz(false); };

  // odwołanie (E10)
  function formAnulacji() {
    const r = TRM.szcz.rez, a = TRM.an;
    const zapl = r.pozycje.filter(p => p.stan === 'zaplanowana');
    return `<div class="trm-card"><h3>Odwołanie</h3>
      <div class="trm-field"><label>Zakres</label><select onchange="TRM.an.zakres=this.value"><option value="cala" ${a.zakres === 'cala' ? 'selected' : ''}>Cała wizyta (wszystkie zaplanowane usługi)</option>${zapl.map(p => `<option value="${p.id}" ${String(a.zakres) === String(p.id) ? 'selected' : ''}>Tylko: ${esc(p.kategoria)}${p.wariant ? ' · ' + esc(p.wariant) : ''}</option>`).join('')}</select></div>
      <div class="trm-field"><label>Kto odwołuje</label><select onchange="TRM.an.kto=this.value"><option value="klient" ${a.kto === 'klient' ? 'selected' : ''}>Klientka</option><option value="salon" ${a.kto === 'salon' ? 'selected' : ''}>Salon (własna przyczyna)</option></select></div>
      <div class="trm-field"><label>Powód</label><input id="trm-a-powod" placeholder="np. klientka nie może przyjść" value="${esc(a.powod)}"></div>
      <div class="trm-note warn small"><b>Wynik przed decyzją:</b> termin zostanie zwolniony; jednostka karnetu nie jest zużyta; zadatek i ewentualna ulga za późne odwołanie rozliczane są w kartotece klientki (flaga „Odwołanie po czasie”) — terminarz nie potrąca środków sam.</div>
      <div class="trm-row"><button class="trm-btn danger" onclick="TRM.anulujPotwierdz()">Potwierdź odwołanie</button><button class="trm-btn fix" onclick="TRM.szcz.tryb='podglad';TRM.renderSzczegoly()">Wróć</button></div></div>`;
  }
  TRM.anulujPotwierdz = async () => {
    const r = TRM.szcz.rez, a = TRM.an; a.powod = el('trm-a-powod').value.trim();
    if (!a.powod) return toast('warning', 'Podaj powód odwołania');
    const d = await api('trm_anuluj', { id: r.id, wersja: r.wersja, pozycja_id: a.zakres === 'cala' ? null : Number(a.zakres), kto_anulowal: a.kto, powod: a.powod });
    if (d.code === 'WERSJA') { toast('warning', 'Ktoś zmienił tę wizytę', 'Sprawdź aktualne dane.'); return przeladujSzczegoly(d.rezerwacja); }
    if (d.status !== 'success') return toast('error', 'Nie odwołano', d.message);
    toast('success', 'Wizyta odwołana', d.rozrachunek || '');
    await przeladujSzczegoly(d.rezerwacja);
  };

  // most do Sprzedaży (E11)
  TRM.rozlicz = async () => {
    const d = await api('trm_rozlicz_start', { id: TRM.szcz.id });
    if (d.status !== 'success') return toast('error', 'Nie można rozliczyć', d.message);
    if (d.juz_rozliczona) { toast('info', 'Już rozliczona', 'Sprzedaż ' + d.sprzedaz_id); return przeladujSzczegoly(d.rezerwacja); }
    const pf = d.prefill, rez = d.rezerwacja;
    TRM.rozliczanie = { id: rez.id, numer: rez.numer };
    if (typeof pokaz !== 'function') return;
    pokaz('sprzedaz');
    setTimeout(() => {
      try {
        const pole = el('multi_klient');
        if (pole) {
          let etyk = pf.klient;
          if (typeof etykietaKlienta === 'function' && Array.isArray(window.wszyscyKlienciDane)) { const k = window.wszyscyKlienciDane.find(x => String(x.id) === String(pf.id_klienta)); if (k) etyk = etykietaKlienta(k); }
          pole.value = etyk; if (typeof sprawdzSaldoKlienta === 'function') sprawdzSaldoKlienta();
        }
        const cont = el('items-container');
        if (cont && typeof dodajNowyWiersz === 'function') {
          cont.innerHTML = '';
          pf.pozycje.forEach(p => {
            dodajNowyWiersz('Zabieg');
            const row = cont.lastElementChild; if (!row) return;
            const cat = row.querySelector('.item-cat'); if (cat) { cat.value = p.kategoria; if (typeof zmienKategorieWiersza === 'function') zmienKategorieWiersza(cat); }
            const v = row.querySelector('.item-var'); if (v) { const chce = p.wariant || '-'; if ([...v.options].some(o => o.value === chce)) { v.value = chce; if (typeof zmienWariantWiersza === 'function') zmienWariantWiersza(v); } }
          });
          if (typeof odswiezSume === 'function') odswiezSume();
        }
        const wyk = [...new Set(pf.pozycje.map(p => p.pracownik))];
        document.querySelectorAll('.seller-chip').forEach(ch => { const inp = ch.querySelector('input'); const on = inp && wyk.includes(inp.value); ch.classList.toggle('selected', !!on); if (inp) inp.checked = !!on; });
      } catch (e) { console.warn('[terminarz] prefill sprzedaży:', e); }
      pasekRozliczenia();
    }, 350);
  };
  function pasekRozliczenia() {
    let bar = el('trm-rozlicz-bar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'trm-rozlicz-bar'; bar.className = 'trm-rozlicz-bar'; document.body.appendChild(bar); }
    bar.innerHTML = `<span>Rozliczasz wizytę <b>${esc(TRM.rozliczanie.numer)}</b> — po zatwierdzeniu sprzedaży kliknij „Powiąż”.</span><button onclick="TRM.rozliczPowiazZPaska()">Powiąż sprzedaż</button><button class="sec" onclick="TRM.rozliczAnulujPasek()">Anuluj</button>`;
  }
  TRM.rozliczAnulujPasek = () => { const b = el('trm-rozlicz-bar'); if (b) b.remove(); TRM.rozliczanie = null; };
  TRM.rozliczPowiazZPaska = async () => {
    const id = TRM.rozliczanie && TRM.rozliczanie.id; if (!id) return;
    const d = await api('trm_rozlicz_powiaz', { id });
    if (d.status !== 'success') return toast('error', 'Nie powiązano', d.message);
    if (!d.znaleziono) return toast('warning', 'Jeszcze nie ma sprzedaży', d.message);
    TRM.rozliczAnulujPasek();
    toast('success', 'Wizyta rozliczona', 'Powiązano ze sprzedażą ' + d.sprzedaz_id);
    if (typeof pokaz === 'function') { const btn = document.querySelector('#menu-terminarz button'); pokaz('terminarz', btn || null); }
    setTimeout(() => TRM.otworzSzczegoly(id), 400);
  };
  TRM.rozliczPowiaz = async () => { const d = await api('trm_rozlicz_powiaz', { id: TRM.szcz.id }); if (d.status !== 'success') return toast('error', 'Nie powiązano', d.message); if (!d.znaleziono) return toast('warning', 'Jeszcze nie ma sprzedaży', d.message); toast('success', 'Powiązano', 'Sprzedaż ' + d.sprzedaz_id); await przeladujSzczegoly(d.rezerwacja); };

  // ── USTAWIENIA (E16/E17/E18/E19 — zakres etapu A) ──────────────────────
  function renderUstawienia() {
    if (!manager()) { el('trm-main').innerHTML = '<div class="trm-note bad">Ustawienia terminarza zmienia manager lub właściciel.</div>'; return; }
    const t = TRM.ust.tab;
    const tabs = [['ogolne', 'Godziny i zasady'], ['zespol', 'Zespół'], ['uslugi', 'Usługi'], ['zasoby', 'Gabinety i urządzenia'], ['grafik', 'Grafik zespołu'], ['nieobecnosci', 'Nieobecności i blokady']];
    let html = `<div class="trm-tabs">${tabs.map(([k, n]) => `<button class="${t === k ? 'on' : ''}" onclick="TRM.ust.tab='${k}';TRM.widokZmien('ustawienia')">${n}</button>`).join('')}</div>`;
    html += ({ ogolne: ustOgolne, zespol: ustZespol, uslugi: ustUslugi, zasoby: ustZasoby, grafik: ustGrafik, nieobecnosci: ustNieob })[t]();
    el('trm-main').innerHTML = html;
  }
  const godzinyHtml = (godziny, prefix) => `<div class="trm-godz">${[1, 2, 3, 4, 5, 6, 7].map(dz => { const l = godziny[dz] || []; return `<div class="d">${DNI[dz]}</div><div class="p"><input type="time" id="${prefix}-${dz}-a-od" value="${(l[0] || {}).od || ''}"> – <input type="time" id="${prefix}-${dz}-a-do" value="${(l[0] || {}).do || ''}"> <span class="muted small">i</span> <input type="time" id="${prefix}-${dz}-b-od" value="${(l[1] || {}).od || ''}"> – <input type="time" id="${prefix}-${dz}-b-do" value="${(l[1] || {}).do || ''}"></div>`; }).join('')}</div>`;
  const zbierzGodziny = (prefix) => { const g = {}; for (let dz = 1; dz <= 7; dz++) { g[dz] = []; ['a', 'b'].forEach(x => { const od = el(`${prefix}-${dz}-${x}-od`).value, do_ = el(`${prefix}-${dz}-${x}-do`).value; if (od && do_ && od < do_) g[dz].push({ od, do: do_ }); }); } return g; };
  function ustOgolne() {
    const u = TRM.dane.ustawienia;
    return `<div class="trm-card"><h3>Godziny otwarcia salonu</h3><div class="muted small" style="margin-bottom:10px">Otwarcie drzwi nie oznacza pracy konkretnej osoby — dostępność wynika z grafiku pracownika. Gabinety i urządzenia są dostępne w godzinach salonu.</div>${godzinyHtml(u.godziny, 'trm-g')}</div>
    <div class="trm-card"><h3>Zasady</h3><div class="trm-grid2">
      <div class="trm-field"><label>Siatka kalendarza</label><select id="trm-u-siatka">${[5, 10, 15, 30].map(x => `<option value="${x}" ${u.siatka_min === x ? 'selected' : ''}>${x} min</option>`).join('')}</select></div>
      <div class="trm-field"><label>Tolerancja spóźnienia (tylko sugestia)</label><input type="number" id="trm-u-tol" min="0" max="30" value="${u.tolerancja_min}"></div>
      <div class="trm-field"><label>Tryb pracy</label><select id="trm-u-tryb"><option value="wewnetrzny" selected>Terminarz wyłącznie wewnętrzny</option><option value="online" disabled>Główny terminarz z rezerwacjami online (etap B)</option><option value="obok" disabled>Praca obok zewnętrznego kalendarza (etap B)</option></select></div>
      <div class="trm-field"><label>Horyzont planowania (dni)</label><input type="number" id="trm-u-hor" min="7" max="365" value="${u.horyzont_dni}"></div>
    </div><button class="trm-btn primary" onclick="TRM.ustZapiszOgolne()">Zapisz ustawienia</button></div>`;
  }
  TRM.ustZapiszOgolne = async () => {
    const d = await api('trm_ustawienia_zapisz', { godziny: zbierzGodziny('trm-g'), siatka_min: Number(el('trm-u-siatka').value), tolerancja_min: Number(el('trm-u-tol').value), horyzont_dni: Number(el('trm-u-hor').value), tryb: el('trm-u-tryb').value });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.ustawienia = d.ustawienia; toast('success', 'Zapisano ustawienia');
  };
  function ustZespol() {
    const z = TRM.dane.zespol || [];
    if (!z.length) return '<div class="trm-note warn">Brak pracowników.</div>';
    return `<div class="trm-note info small">Osoby, które nie wykonują zabiegów (np. tylko recepcja), nie pojawiają się w terminarzu jako wykonawcy — nie trzeba ich wyłączać z każdej usługi z osobna. To ustawienie jest niezależne od „Kto wykonuje” przy konkretnej usłudze (zakładka Usługi) — tam nadal możesz zawężać, kto robi co, wśród osób zaznaczonych tutaj.</div>
    <div class="trm-card"><table class="trm-table"><thead><tr><th>Osoba</th><th>Wykonuje zabiegi</th></tr></thead><tbody>
    ${z.map(p => `<tr><td><b>${esc(p.imie)}</b></td><td><label style="text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" ${p.wykonuje_zabiegi ? 'checked' : ''} onchange="TRM.ustZmienZespol('${esc(p.imie)}', this.checked)" style="width:auto;min-height:0"> ${p.wykonuje_zabiegi ? 'tak — widoczna w terminarzu' : 'nie — tylko recepcja'}</label></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  TRM.ustZmienZespol = async (kto, wartosc) => {
    const d = await api('trm_zespol_zapisz', { pracownik_zespol: kto, wykonuje_zabiegi: wartosc });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.zespol = d.zespol; TRM.dane.pracownicy = d.pracownicy;
    toast('success', wartosc ? 'Wykonuje zabiegi' : 'Tylko recepcja', kto); renderUstawienia();
  };
  function ustUslugi() {
    const zas = TRM.dane.zasoby.filter(z => z.aktywny && !z.zarchiwizowano), gab = zas.filter(z => z.typ === 'gabinet'), urz = zas.filter(z => z.typ === 'urzadzenie');
    const prac = TRM.dane.pracownicy;
    return `<div class="trm-note info small">Każda usługa z cennika, którą chcesz umawiać, potrzebuje <b>czasu trwania</b>. Bufor to przygotowanie/sprzątanie liczone dla wskazanych zasobów (nie zjada czasu klientki). Pusta lista pracowników = wszyscy mogą wykonywać. Zmiana definicji nie przestawia istniejących wizyt.</div>
    <div class="trm-card" style="overflow:auto"><table class="trm-table"><thead><tr><th>Usługa</th><th>Czas (min)</th><th>Bufor przed</th><th>Bufor po</th><th>Bufor dotyczy</th><th>Gabinet</th><th>Urządzenia (pula)</th><th>Kto wykonuje</th><th>W terminarzu</th><th></th></tr></thead><tbody>
    ${TRM.dane.uslugi.map((u, i) => `<tr id="trm-us-${i}" style="${u.skonfigurowana ? '' : 'background:var(--t-warn-bg)'}">
      <td><b>${esc(u.kategoria)}</b>${u.wariant ? '<br><span class="muted small">' + esc(u.wariant) + '</span>' : ''}${u.cena != null ? '<br><span class="muted small">' + zl(u.cena) + '</span>' : ''}</td>
      <td><input type="number" class="czas" min="5" max="480" step="5" value="${u.czas_min || ''}" style="width:80px" placeholder="np. 40"></td>
      <td><input type="number" class="bp" min="0" max="120" value="${u.bufor_przed_min}" style="width:70px"></td>
      <td><input type="number" class="ba" min="0" max="120" value="${u.bufor_po_min}" style="width:70px"></td>
      <td><select class="bd" style="width:120px">${[['oba', 'osoba + gabinet/sprzęt'], ['pracownik', 'tylko osoba'], ['gabinet', 'tylko gabinet/sprzęt'], ['brak', 'brak']].map(([k, n]) => `<option value="${k}" ${u.bufor_dotyczy === k ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
      <td><label style="text-transform:none;letter-spacing:0;font-size:12px"><input type="checkbox" class="wg" ${u.wymaga_gabinet ? 'checked' : ''} style="width:auto;min-height:0"> wymaga</label>${gab.length ? `<div class="trm-chips" style="margin-top:4px">${gab.map(g => `<span class="trm-chip gab ${u.gabinety && u.gabinety.map(Number).includes(g.id) ? 'on' : ''}" data-id="${g.id}" onclick="this.classList.toggle('on')">${esc(g.nazwa)}</span>`).join('')}</div><div class="muted small">żaden zaznaczony = dowolny</div>` : '<div class="muted small">brak gabinetów</div>'}</td>
      <td>${urz.length ? `<div class="trm-chips">${urz.map(g => `<span class="trm-chip urz ${(u.urzadzenia || []).map(Number).includes(g.id) ? 'on' : ''}" data-id="${g.id}" onclick="this.classList.toggle('on')">${esc(g.nazwa)}</span>`).join('')}</div><div class="muted small">zaznacz zgodne jednostki</div>` : '<div class="muted small">brak urządzeń</div>'}</td>
      <td><div class="trm-chips">${prac.map(p => `<span class="trm-chip pr ${u.pracownicy && u.pracownicy.includes(p) ? 'on' : ''}" data-id="${esc(p)}" onclick="this.classList.toggle('on')">${esc(p)}</span>`).join('')}</div></td>
      <td><input type="checkbox" class="akt" ${u.aktywna ? 'checked' : ''} style="width:auto;min-height:0"></td>
      <td><button class="trm-btn sm primary" onclick="TRM.ustZapiszUsluge(${i})">Zapisz</button></td></tr>`).join('')}
    </tbody></table></div>`;
  }
  TRM.ustZapiszUsluge = async (i) => {
    const u = TRM.dane.uslugi[i], tr = el('trm-us-' + i);
    const chips = (kl) => [...tr.querySelectorAll('.trm-chip.' + kl + '.on')].map(c => c.dataset.id);
    const d = await api('trm_usluga_zapisz', { usluga_id: u.id, czas_min: tr.querySelector('.czas').value || null, bufor_przed_min: tr.querySelector('.bp').value, bufor_po_min: tr.querySelector('.ba').value, bufor_dotyczy: tr.querySelector('.bd').value, wymaga_gabinet: tr.querySelector('.wg').checked, gabinety: chips('gab'), urzadzenia: chips('urz'), pracownicy: chips('pr'), aktywna: tr.querySelector('.akt').checked });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.uslugi = d.uslugi; toast('success', 'Zapisano usługę', nazwaUslugi(u)); renderUstawienia();
  };
  function ustZasoby() {
    const z = TRM.dane.zasoby;
    const lista = (typ) => z.filter(x => x.typ === typ).map(x => `<tr><td>${x.zarchiwizowano ? '<span class="muted">' + esc(x.nazwa) + ' (archiwum)</span>' : '<b>' + esc(x.nazwa) + '</b>'}</td><td>${x.pojemnosc}</td><td>${x.zarchiwizowano ? '' : `<button class="trm-btn sm" onclick="TRM.ustArchiwizuj(${x.id}, false)">Archiwizuj</button>`}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">brak</td></tr>';
    return `<div class="trm-note info small">Gabinet i urządzenie to konkretne zasoby o pojemności 1 (chyba że podasz inną). Dwa identyczne urządzenia = dwa osobne wpisy („Infinity 1”, „Infinity 2”), żeby dwie klientki mogły mieć je równolegle, a trzecia nie.</div>
    <div class="trm-grid2"><div class="trm-card"><h3>🏠 Gabinety</h3><table class="trm-table"><thead><tr><th>Nazwa</th><th>Miejsc</th><th></th></tr></thead><tbody>${lista('gabinet')}</tbody></table></div>
    <div class="trm-card"><h3>⚙️ Urządzenia</h3><table class="trm-table"><thead><tr><th>Nazwa</th><th>Szt.</th><th></th></tr></thead><tbody>${lista('urzadzenie')}</tbody></table></div></div>
    <div class="trm-card" style="margin-top:12px"><h3>Dodaj zasób</h3><div class="trm-row"><select id="trm-zs-typ" style="width:auto"><option value="gabinet">Gabinet</option><option value="urzadzenie">Urządzenie</option></select><input id="trm-zs-nazwa" placeholder="np. Gabinet 1 albo Infinity 1"><input type="number" id="trm-zs-poj" value="1" min="1" max="50" style="width:90px" title="Pojemność"><button class="trm-btn primary fix" onclick="TRM.ustDodajZasob()">Dodaj</button></div></div>`;
  }
  TRM.ustDodajZasob = async () => { const d = await api('trm_zasob_zapisz', { typ: el('trm-zs-typ').value, nazwa: el('trm-zs-nazwa').value, pojemnosc: el('trm-zs-poj').value }); if (d.status !== 'success') return toast('error', 'Nie dodano', d.message); TRM.dane.zasoby = d.zasoby; toast('success', 'Dodano zasób'); renderUstawienia(); };
  TRM.ustArchiwizuj = async (id, wymus) => {
    const d = await api('trm_zasob_archiwizuj', { id, wymus });
    if (d.status !== 'success') return toast('error', 'Nie zarchiwizowano', d.message);
    if (d.wymaga_decyzji) { if (window.confirm(d.message + '\n\n' + d.dotkniete.slice(0, 8).map(x => `${x.start.slice(0, 16)} ${x.klient_nazwa} — ${x.kategoria}`).join('\n') + '\n\nZarchiwizować mimo to?')) return TRM.ustArchiwizuj(id, true); return; }
    TRM.dane.zasoby = d.zasoby; toast('success', 'Zasób zarchiwizowany'); renderUstawienia();
  };
  function ustGrafik() {
    const prac = TRM.dane.pracownicy; if (!prac.length) return '<div class="trm-note warn">Brak pracowników.</div>';
    const kto_ = TRM.ust.prac && prac.includes(TRM.ust.prac) ? TRM.ust.prac : prac[0]; TRM.ust.prac = kto_;
    const g = {}; TRM.dane.grafik.filter(x => x.pracownik === kto_).forEach(x => { (g[x.dzien_tyg] = g[x.dzien_tyg] || []).push({ od: x.od, do: x.do }); });
    const bez = prac.filter(p => !TRM.dane.grafik.some(x => x.pracownik === p));
    return `<div class="trm-note info small">Grafik tygodniowy osoby = kiedy można ją umawiać. Zmiana grafiku <b>nie odwołuje</b> wizyt — najpierw pokażemy listę zagrożonych terminów.</div>
    ${bez.length ? `<div class="trm-note warn small">Bez grafiku: ${bez.map(esc).join(', ')}. <button class="trm-btn sm" onclick="TRM.ustGrafikZSalonu()">Skopiuj godziny salonu do osób bez grafiku</button></div>` : ''}
    <div class="trm-card"><div class="trm-row" style="margin-bottom:10px"><div class="fix"><label>Pracownik</label><select onchange="TRM.ust.prac=this.value;TRM.widokZmien('ustawienia')" style="width:auto">${prac.map(p => `<option ${p === kto_ ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div></div>
    ${godzinyHtml(g, 'trm-gr')}<div class="trm-row" style="margin-top:12px"><button class="trm-btn primary fix" onclick="TRM.ustZapiszGrafik(false)">Zapisz grafik ${esc(kto_)}</button></div></div>`;
  }
  TRM.ustZapiszGrafik = async (wymus) => {
    const g = zbierzGodziny('trm-gr'); const wzorce = []; Object.keys(g).forEach(dz => g[dz].forEach(p => wzorce.push({ dzien_tyg: Number(dz), od: p.od, do: p.do })));
    const d = await api('trm_grafik_zapisz', { pracownik_grafik: TRM.ust.prac, wzorce, wymus });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    if (d.wymaga_decyzji) { if (window.confirm(d.message + '\n\n' + d.dotkniete.slice(0, 10).map(x => `${x.start.slice(0, 16)} ${x.klient_nazwa} — ${x.kategoria}`).join('\n') + '\n\nZapisać grafik mimo to? (wizyty zostaną do rozwiązania)')) return TRM.ustZapiszGrafik(true); return; }
    TRM.dane.grafik = d.grafik; toast('success', 'Zapisano grafik', TRM.ust.prac); renderUstawienia();
  };
  TRM.ustGrafikZSalonu = async () => { const d = await api('trm_grafik_z_godzin_salonu', {}); if (d.status !== 'success') return toast('error', 'Nie skopiowano', d.message); TRM.dane.grafik = d.grafik; toast('success', 'Grafik uzupełniony z godzin salonu'); renderUstawienia(); };
  function ustNieob() {
    const n = TRM.dane.nieobecnosci || [], zas = TRM.dane.zasoby.filter(z => z.aktywny && !z.zarchiwizowano);
    return `<div class="trm-note info small">Urlop, choroba, szkolenie, przerwa, serwis urządzenia albo zamknięcie salonu. Publicznie zawsze tylko „Niedostępne”. Zapis nie odwołuje wizyt — pokaże, które wymagają decyzji.</div>
    <div class="trm-card"><h3>Dodaj nieobecność / blokadę</h3><div class="trm-grid2">
      <div class="trm-field"><label>Kogo / czego dotyczy</label><select id="trm-nb-kogo"><option value="">Cały salon</option>${TRM.dane.pracownicy.map(p => `<option value="p:${esc(p)}">${esc(p)}</option>`).join('')}${zas.map(z => `<option value="z:${z.id}">${z.typ === 'gabinet' ? '🏠' : '⚙️'} ${esc(z.nazwa)}</option>`).join('')}</select></div>
      <div class="trm-field"><label>Typ</label><select id="trm-nb-typ">${[['urlop', 'Urlop'], ['choroba', 'Choroba'], ['szkolenie', 'Szkolenie'], ['przerwa', 'Przerwa'], ['serwis', 'Serwis / awaria'], ['zamkniete', 'Salon zamknięty'], ['inne', 'Inne']].map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="trm-field"><label>Od</label><input type="datetime-local" id="trm-nb-od" value="${TRM.data}T09:00"></div>
      <div class="trm-field"><label>Do</label><input type="datetime-local" id="trm-nb-do" value="${TRM.data}T17:00"></div>
    </div><div class="trm-field"><label>Opis wewnętrzny (niepubliczny)</label><input id="trm-nb-opis" placeholder="np. serwis Infinity 1"></div>
    <button class="trm-btn primary" onclick="TRM.ustDodajNieob(false)">Zapisz blokadę</button></div>
    <div class="trm-card" style="margin-top:12px"><h3>Zaplanowane i ostatnie</h3><table class="trm-table"><thead><tr><th>Kogo</th><th>Od</th><th>Do</th><th>Typ</th><th>Opis</th><th></th></tr></thead><tbody>${n.length ? n.map(x => `<tr><td>${x.pracownik ? esc(x.pracownik) : x.zasob_id ? esc((zasob(x.zasob_id) || {}).nazwa || 'zasób') : '<b>cały salon</b>'}</td><td>${esc(x.od.slice(0, 16))}</td><td>${esc(x.do.slice(0, 16))}</td><td>${esc(x.typ)}</td><td class="muted">${esc(x.opis || '')}</td><td><button class="trm-btn sm" onclick="TRM.ustUsunNieob(${x.id})">Usuń</button></td></tr>`).join('') : '<tr><td colspan="6" class="muted">brak</td></tr>'}</tbody></table></div>`;
  }
  TRM.ustDodajNieob = async (wymus) => {
    const kogo = el('trm-nb-kogo').value;
    const d = await api('trm_nieobecnosc_zapisz', { pracownik_nieob: kogo.startsWith('p:') ? kogo.slice(2) : null, zasob_id: kogo.startsWith('z:') ? Number(kogo.slice(2)) : null, od: el('trm-nb-od').value.replace('T', ' '), do: el('trm-nb-do').value.replace('T', ' '), typ: el('trm-nb-typ').value, opis: el('trm-nb-opis').value, wymus });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    if (d.wymaga_decyzji) { if (window.confirm(d.message + '\n\n' + d.dotkniete.slice(0, 10).map(x => `${x.start.slice(0, 16)} ${x.klient_nazwa} — ${x.kategoria} (${x.pracownik})`).join('\n') + '\n\nZapisać blokadę mimo to?')) return TRM.ustDodajNieob(true); return; }
    await window.trm_odswiezDane(); toast('success', 'Zapisano blokadę', d.dotkniete && d.dotkniete.length ? `${d.dotkniete.length} wizyt do rozwiązania` : ''); renderUstawienia();
  };
  TRM.ustUsunNieob = async (id) => { if (!window.confirm('Usunąć tę blokadę? Dostępność wróci do pełnej walidacji grafiku.')) return; const d = await api('trm_nieobecnosc_usun', { id }); if (d.status !== 'success') return toast('error', 'Nie usunięto', d.message); await window.trm_odswiezDane(); renderUstawienia(); };

  // skróty klawiaturowe (05): N = nowa wizyta, T = dzisiaj, strzałki, Esc — nie w polach
  document.addEventListener('keydown', (e) => {
    const sek = el('terminarz'); if (!sek || !sek.classList.contains('active')) return;
    const tag = (e.target && e.target.tagName) || ''; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable) return;
    if (e.key === 'Escape') { if (TRM.bubla) { TRM.zamknijBuble(); return; } if (TRM.panel) { if (TRM.panel === 'nowa' && (TRM.nowa.pozycje.length || TRM.nowa.klient) && !window.confirm('Zamknąć panel? Niezapisane dane zostaną utracone.')) return; TRM.panelZamknij(); } }
    else if (e.key === 'n' || e.key === 'N') { if (operacyjna()) TRM.nowaWizyta(); }
    else if (e.key === 't' || e.key === 'T') TRM.idz(0);
    else if (e.key === 'ArrowLeft') TRM.idz(-1);
    else if (e.key === 'ArrowRight') TRM.idz(1);
  });
  window.addEventListener('resize', () => { if (el('trm-main') && (TRM.widok === 'dzien') && el('terminarz') && el('terminarz').classList.contains('active')) odswiez(); });
  // lekkie odświeżanie dzwonka powiadomień, tylko gdy sekcja terminarza jest aktywna (bez pollingu w tle poza nią)
  setInterval(() => { if (el('terminarz') && el('terminarz').classList.contains('active') && el('trm-dzwonek-licz')) odswiezLicznikSpraw(); }, 45000);
  // po załadowaniu pliku (defer): menu mogło zostać policzone zanim ten plik się wczytał
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.trm_aktualizujWidocznosc); else window.trm_aktualizujWidocznosc();
})();
