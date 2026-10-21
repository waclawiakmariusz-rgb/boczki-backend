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
  // ─── Kolory kafelków (zgłoszenie #12, Gosia, 20.10.2026) ──────────────────────────────────────
  // „Chodzi o to, aby każda usługa miała swój kolor… wizyty się nie zlewają ze sobą."
  // Kolor jest w bazie przypisany do TYPU zabiegu, nie do kategorii — u Boczków daje to cztery
  // kolory na 483 usługi (202 usługi „ciało" = ten sam niebieski w 21 kategoriach). Dlatego
  // kategoria dostaje własny odcień WEWNĄTRZ rodziny koloru swojego typu: „ciało" zostaje niebieskie,
  // ale endermologia, kriolipoliza i wakuum różnią się od siebie na pierwszy rzut oka.
  // Odcień liczy się z nazwy kategorii, więc jest stały — ta sama usługa ma zawsze ten sam kolor,
  // bez żadnej konfiguracji i bez zapisywania czegokolwiek w bazie.
  const haszNazwy = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function hexNaHsl(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
    return [h * 60, s * 100, l * 100];
  }
  function hslNaHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  // Odcienie rozkładamy znając CAŁY cennik, a nie każdą kategorię z osobna: inaczej dwie kategorie
  // potrafią wylosować ten sam kolor (przy cenniku Boczków zdarzało się to 8 razy na 57 kategorii).
  // Kolejność alfabetyczna w obrębie rodziny daje stały wynik — ta sama kategoria ma zawsze ten sam
  // odcień, dopóki nie zmieni się jej nazwa albo kolor typu. Mapa liczy się raz na wczytanie danych.
  let kolCache = { zrodlo: null, mapa: new Map() };
  function zbudujKolory() {
    const uslugi = (TRM.dane && TRM.dane.uslugi) || [];
    const rodziny = new Map();                      // kolor typu (albo '') → lista kategorii
    const bazaKat = new Map();                      // kategoria → kolor typu
    uslugi.forEach(u => {
      const kat = String(u.kategoria || '').trim(); if (!kat || bazaKat.has(kat)) return;
      const baza = (u.kolor && /^#[0-9a-f]{6}$/i.test(u.kolor)) ? u.kolor.toLowerCase() : '';
      bazaKat.set(kat, baza);
      if (!rodziny.has(baza)) rodziny.set(baza, []);
      rodziny.get(baza).push(kat);
    });
    const mapa = new Map();
    for (const [baza, katy] of rodziny) {
      katy.sort((a, b) => a.localeCompare(b, 'pl'));
      const n = katy.length;
      katy.forEach((kat, i) => {
        if (!baza) {                                 // brak koloru typu — pełne koło barw
          mapa.set(kat, hslNaHex((i * 360) / Math.max(1, n) + 18, 48, 52));
          return;
        }
        // Im więcej kategorii w rodzinie, tym szerszy wachlarz barw — przy 21 kategoriach „ciała"
        // ciasny zakres dawał odcienie nie do odróżnienia (zmierzona odległość RGB 14).
        // Do tego naprzemienna jasność i nasycenie, żeby sąsiedzi w kolejności różnili się nie
        // tylko barwą. Rodzina nadal jest rozpoznawalna: niebieskie zostaje niebieskim.
        const [H, S, L] = hexNaHsl(baza);
        const rozpietosc = Math.max(36, Math.min(90, n * 7));
        const srodek = n === 1 ? 0 : (i / (n - 1)) - 0.5;   // -0.5 … +0.5 w obrębie rodziny
        const jasnosc = [0, 12, -11, 6][i % 4];
        const nasycenie = [0, -14, 10, -6][i % 4];
        mapa.set(kat, hslNaHex(H + srodek * rozpietosc, Math.max(30, Math.min(90, S + nasycenie)), Math.max(36, Math.min(70, L + jasnosc))));
      });
    }
    kolCache = { zrodlo: uslugi, mapa };
  }
  const kolorKat = (u) => {
    const kat = u && u.kategoria ? String(u.kategoria).trim() : '';
    const bazowy = (u && u.kolor && /^#[0-9a-f]{6}$/i.test(u.kolor)) ? u.kolor : null;
    if (!kat) return bazowy || '#BD9560';
    const uslugi = (TRM.dane && TRM.dane.uslugi) || [];
    if (kolCache.zrodlo !== uslugi) zbudujKolory();
    if (kolCache.mapa.has(kat)) return kolCache.mapa.get(kat);
    // Kategoria spoza wczytanego cennika (np. archiwalna wizyta) — wtedy stały kolor z nazwy.
    const h = haszNazwy(kat.toLowerCase());
    if (!bazowy) return hslNaHex(h % 360, 48, 52);
    const [H, S, L] = hexNaHsl(bazowy);
    return hslNaHex(H + (((h % 7) - 3) * 9), Math.max(32, Math.min(88, S + ((((h >> 3) % 3) - 1) * 10))), Math.max(38, Math.min(68, L + ((((h >> 6) % 3) - 1) * 9))));
  };
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
    // R04: przełącznik widoków kalendarza w jednej grupie; Ustawienia modułu jako osobne wejście (nie „kolejny widok dnia”)
    const widoki = [['dzien', 'Dzień'], ['tydzien', 'Tydzień'], ['agenda', 'Agenda'], ['zasoby', 'Zasoby'], ['historia', 'Historia']];
    if (specjalista()) widoki.unshift(['moj', 'Mój dzień']);
    root.innerHTML = `
    <div class="trm" data-wersja="20261018a">
      <div class="trm-top">
        <div><h1>Terminarz</h1><div class="trm-sub" id="trm-sub"></div></div>
        <div class="trm-spacer"></div>
        ${operacyjna() ? `<div class="trm-szukaj"><input id="trm-szukaj" placeholder="Szukaj wizyty lub klientki…" autocomplete="off" oninput="TRM.szukajWizyt(this.value)" onfocus="TRM.szukajWizyt(this.value)" aria-label="Szukaj wizyty lub klientki"><div class="trm-szukaj-wyniki" id="trm-szukaj-wyniki" hidden></div></div>` : ''}
        <a class="trm-btn" href="/pomoc-terminarz/" target="_blank" rel="noopener" title="Przewodnik po Terminarzu — scenki, FAQ" style="text-decoration:none;display:inline-flex;align-items:center">📖 Pomoc</a>
        ${(operacyjna() || specjalista()) ? `<button class="trm-btn trm-dzwonek fix" onclick="TRM.otworzPowiadomienia()" title="Powiadomienia i sprawy">🔔<span class="trm-dzwonek-licz" id="trm-dzwonek-licz" hidden>0</span></button>` : ''}
        ${operacyjna() ? `<button class="trm-btn fix" onclick="TRM.blokadaNowa()" title="Zarezerwuj czas albo gabinet na szkolenie, rozmowę, serwis">⛔ Rezerwacja techniczna</button><button class="trm-btn primary" onclick="TRM.nowaWizyta()">+ Nowa wizyta</button>` : ''}
      </div>
      <div class="trm-top2">
        <div class="trm-nav">
          <button class="trm-btn" onclick="TRM.idz(0)">Dzisiaj</button>
          <button class="trm-btn" onclick="TRM.idz(-1)" aria-label="Poprzedni">‹</button>
          <button class="trm-btn" onclick="TRM.idz(1)" aria-label="Następny">›</button>
          <input type="date" id="trm-data" value="${TRM.data}" onchange="TRM.ustawDate(this.value)">
        </div>
        <div class="trm-views" id="trm-views">${widoki.map(([k, n]) => `<button class="${TRM.widok === k ? 'on' : ''}" onclick="TRM.widokZmien('${k}')">${n}</button>`).join('')}</div>
        <div class="trm-ust-naglowek"><h2>Ustawienia terminarza</h2><button class="trm-btn" onclick="TRM.wrocDoKalendarza()">‹ Wróć do kalendarza</button></div>
        <div class="trm-spacer"></div>
        ${manager() ? `<button class="trm-btn ust ${TRM.widok === 'ustawienia' ? 'on' : ''}" id="trm-btn-ust" onclick="TRM.widokZmien('ustawienia')" aria-label="Ustawienia terminarza">⚙ Ustawienia</button>` : ''}
      </div>
      <div class="trm-counters" id="trm-counters"></div>
      <div class="trm-zmiany-pasek" id="trm-zmiany-pasek" hidden></div>
      <div class="trm-filtry" id="trm-filtry" hidden></div>
      <div class="trm-body" id="trm-body"><div class="trm-main" id="trm-main"></div><aside class="trm-panel" id="trm-panel" hidden></aside></div>
      <div class="trm-bubble-layer" id="trm-bubble-layer"></div>
    </div>`;
  }
  async function odswiezLicznikSpraw() {
    if (!operacyjna() && !specjalista()) return;
    const d = await api('trm_sprawy_licznik');
    const b = el('trm-dzwonek-licz'); if (d.status !== 'success' || !b) return;
    // D04: dzwonek = liczba OTWARTYCH spraw do działania w zakresie odbiorcy (zasada centrum powiadomień); kolor „pilne”, gdy jest choć jedna P0
    const dzw = b.closest('.trm-dzwonek'); const opis = `${d.otwarte} do działania · ${d.pilne} pilnych · ${d.nieprzeczytane} nieprzeczytanych`;
    if (dzw) { dzw.title = 'Powiadomienia: ' + opis; dzw.setAttribute('aria-label', 'Powiadomienia: ' + opis); }
    if (d.otwarte > 0) { b.hidden = false; b.textContent = d.otwarte; b.classList.toggle('pilne', d.pilne > 0); }
    else { b.hidden = true; b.classList.remove('pilne'); }
  }
  TRM.idz = (n) => { if (n === 0) TRM.data = dzisStr(); else TRM.data = dodajDni(TRM.data, (TRM.widok === 'tydzien' || TRM.widok === 'agenda') ? 7 * n : n); el('trm-data').value = TRM.data; odswiez(); };
  TRM.ustawDate = (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { TRM.data = v; odswiez(); } };

  // ── filtr osób (widok Dzień) + wyszukiwarka wizyt/klientek (raport T08) ──
  TRM.filtrPrac = new Set();
  function renderFiltry(wszyscy) {
    const f = el('trm-filtry'); if (!f) return;
    if (TRM.widok !== 'dzien' || !wszyscy || wszyscy.length < 2) { f.hidden = true; f.innerHTML = ''; return; }
    f.hidden = false;
    f.innerHTML = `<span class="muted small">Osoby:</span>${wszyscy.map(p => `<span class="trm-chip ${TRM.filtrPrac.has(p) ? 'on' : ''}" role="button" tabindex="0" onclick="TRM.filtrPracToggle('${esc(p).replace(/'/g, "\\'")}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">${avatarHtml(p, true)}${esc(p)}</span>`).join('')}${TRM.filtrPrac.size ? `<button class="trm-btn link sm" onclick="TRM.filtrWyczysc()">Wyczyść filtry</button>` : '<span class="muted small">(bez zaznaczenia = cały zespół)</span>'}`;
  }
  TRM.filtrPracToggle = (p) => { if (TRM.filtrPrac.has(p)) TRM.filtrPrac.delete(p); else TRM.filtrPrac.add(p); if (TRM.dzien && TRM.widok === 'dzien') renderDzien(); };
  TRM.filtrWyczysc = () => { TRM.filtrPrac.clear(); if (TRM.dzien && TRM.widok === 'dzien') renderDzien(); };
  let szukajWizytT = null, szukajWizytReq = 0;
  TRM.szukajWizyt = (fraza) => {
    const box = el('trm-szukaj-wyniki'); if (!box) return;
    clearTimeout(szukajWizytT);
    const f = String(fraza || '').trim();
    if (f.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    szukajWizytT = setTimeout(async () => {
      const req = ++szukajWizytReq;
      const d = await api('trm_szukaj_wizyt', { fraza: f });
      if (req !== szukajWizytReq) return;
      if (d.status !== 'success') { box.hidden = false; box.innerHTML = `<div class="m">${esc(d.message || 'Nie udało się wyszukać')}</div>`; return; }
      box.hidden = false;
      box.innerHTML = (d.wizyty || []).length
        ? `<div class="m" style="cursor:default">Wizyty ±${d.dni || 60} dni · ${d.wizyty.length}${d.wiecej ? '+' : ''}</div>` + d.wizyty.map(w => `<div onclick="TRM.szukajOtworz(${w.id}, '${w.start.slice(0, 10)}')"><b>${esc(w.klient_nazwa)}</b> · ${esc(ladnaData(w.start.slice(0, 10), true))} ${hhmm(w.start)}<div class="m">${esc(w.uslugi || '')}${w.pracownicy ? ' · ' + esc(w.pracownicy) : ''}${w.status !== 'potwierdzona' ? ' · ' + esc((ST_LABEL[w.status] || [w.status])[0]) : ''}</div></div>`).join('')
        : `<div class="m" style="cursor:default">Brak wizyt dla „${esc(f)}” w zakresie ±${d.dni || 60} dni.${(d.klienci || []).length ? ' Znalezione klientki: ' + d.klienci.map(k => esc(k.nazwa)).join(', ') : ''}</div>`;
    }, 300);
  };
  TRM.szukajOtworz = async (id, data) => { const box = el('trm-szukaj-wyniki'); if (box) { box.hidden = true; box.innerHTML = ''; } const inp = el('trm-szukaj'); if (inp) inp.value = ''; if (data && data !== TRM.data) { TRM.data = data; const di = el('trm-data'); if (di) di.value = data; } if (TRM.widok !== 'dzien' && TRM.widok !== 'moj') TRM.widokZmien('dzien'); else await odswiez(); TRM.otworzSzczegoly(id); };
  document.addEventListener('click', (e) => { const box = el('trm-szukaj-wyniki'); if (box && !box.hidden && !e.target.closest('.trm-szukaj')) { box.hidden = true; } });
  TRM.widokZmien = (w) => {
    if (w === 'ustawienia' && TRM.widok !== 'ustawienia') TRM.widokPoprzedni = TRM.widok; // R04: powrót do tego samego widoku, dnia i filtrów
    TRM.widok = w;
    document.querySelectorAll('#trm-views button').forEach(b => b.classList.toggle('on', b.textContent === ({ dzien: 'Dzień', tydzien: 'Tydzień', agenda: 'Agenda', zasoby: 'Zasoby', historia: 'Historia', moj: 'Mój dzień' })[w]));
    const root = document.querySelector('#trm-root .trm'); if (root) root.classList.toggle('tryb-ustawienia', w === 'ustawienia');
    const bu = el('trm-btn-ust'); if (bu) bu.classList.toggle('on', w === 'ustawienia');
    odswiez();
  };
  TRM.wrocDoKalendarza = () => TRM.widokZmien(TRM.widokPoprzedni && TRM.widokPoprzedni !== 'ustawienia' ? TRM.widokPoprzedni : 'dzien');

  let odswiezReq = 0; // A17: szybkie klikanie ‹ › / zmiana widoku — starsza odpowiedź nie może nadpisać nowszego widoku
  async function odswiez(opcje) {
    const main = el('trm-main'); if (!main) return;
    trmOznaczAktywny();
    const req = ++odswiezReq;
    // E04: ten sam dzień/widok już wyrenderowany → nie zastępujemy siatki „Pobieramy…”, tylko podmieniamy dane po odpowiedzi; pozycja przewinięcia zostaje
    const kontener = document.querySelector('.main-content'); const scrollPrzed = kontener ? kontener.scrollTop : 0;
    const cicho = !!(TRM.dzien && TRM.dzien.data === TRM.data && (TRM.widok === 'dzien' || TRM.widok === 'zasoby' || TRM.widok === 'moj')) || !!(opcje && opcje.cicho);
    const przywrocScroll = () => { if (kontener && cicho) kontener.scrollTop = scrollPrzed; };
    const sub = el('trm-sub');
    const di = el('trm-data'); if (di && di.value !== TRM.data) di.value = TRM.data;
    if (TRM.widok !== 'dzien') renderFiltry(null); // chipy osób tylko w widoku Dzień
    if (TRM.widok === 'ustawienia') { if (sub) sub.textContent = 'Ustawienia modułu'; document.querySelectorAll('.trm-propozycja').forEach(x => x.remove()); return renderUstawienia(); }
    if (TRM.widok === 'historia') { if (sub) sub.textContent = 'Historia wizyt'; document.querySelectorAll('.trm-propozycja').forEach(x => x.remove()); return renderHistoria(); }
    if (TRM.widok === 'tydzien' || TRM.widok === 'agenda') {
      const od = TRM.widok === 'tydzien' ? poniedzialek(TRM.data) : TRM.data, do_ = dodajDni(od, 6);
      if (sub) sub.textContent = `${ladnaData(od, true)} – ${ladnaData(do_, true)}`;
      main.innerHTML = `<div class="trm-empty"><div class="big">⏳</div>Pobieramy…</div>`;
      const d = await api('trm_zakres', { od, do: do_, pracownik_filtr: TRM.widok === 'tydzien' ? (TRM.osoba || TRM.dane.pracownicy[0] || null) : (TRM.osoba || null) });
      if (req !== odswiezReq) return;
      if (d.status !== 'success') { main.innerHTML = `<div class="trm-note bad">${esc(d.message)}</div>`; return; }
      TRM.zakres = d;
      pobierzPreferencje(d.rezerwacje, TRM.data).then(() => { if (req === odswiezReq) odswiezWidokPoPreferencjach(); });
      return TRM.widok === 'tydzien' ? renderTydzien(od) : renderAgenda(od, do_);
    }
    if (sub) sub.textContent = ladnaData(TRM.data);
    if (!cicho) main.innerHTML = `<div class="trm-empty"><div class="big">⏳</div>Pobieramy terminarz…</div>`; else main.classList.add('trm-odswiezanie');
    const d = await api('trm_dzien', { data: TRM.data, tylko_moje: TRM.widok === 'moj' });
    main.classList.remove('trm-odswiezanie');
    if (req !== odswiezReq) return;
    if (d.status !== 'success') { main.innerHTML = `<div class="trm-note bad">${esc(d.message)}</div>`; return; }
    TRM.dzien = d;
    liczniki(d);
    odswiezPasekZmian();
    pobierzPreferencje(d.rezerwacje, TRM.data).then(() => { if (req === odswiezReq && TRM.pref.dzien === TRM.data) odswiezWidokPoPreferencjach(); });
    nowaSynchronizujDate();
    if (TRM.widok === 'zasoby') { renderZasoby(); przywrocScroll(); return; }
    if (TRM.widok === 'moj' || waski()) { renderAgendaDnia(); przywrocScroll(); return; }
    renderDzien(); przywrocScroll();
  }
  // ── Zmiany w grafiku (19.10.2026) ────────────────────────────────────────────────────────────
  // Scenariusz Oli: w niedzielę dziesięć wizyt na środę, we wtorek zostają dwie i nikt nie wie,
  // kto skasował resztę. Pasek pokazuje, co zniknęło z NADCHODZĄCYCH dni i czego jeszcze nie
  // widziałaś — znika po otwarciu, bo wtedy sprawy są oznaczane jako przeczytane.
  async function odswiezPasekZmian() {
    const pasek = el('trm-zmiany-pasek'); if (!pasek) return;
    const d = await api('trm_zmiany_grafiku', { dni: 7 });
    if (d.status !== 'success' || !d.nowych) { pasek.hidden = true; pasek.innerHTML = ''; return; }
    const czesci = [];
    if (d.odwolane) czesci.push(`<b>${d.odwolane}</b> ${d.odwolane === 1 ? 'wizyta odwołana' : (d.odwolane < 5 ? 'wizyty odwołane' : 'wizyt odwołanych')}`);
    if (d.przelozone) czesci.push(`<b>${d.przelozone}</b> ${d.przelozone === 1 ? 'przełożona' : 'przełożone'}`);
    if (d.zmiana_wykonawcy) czesci.push(`<b>${d.zmiana_wykonawcy}</b> ze zmianą wykonawcy`);
    if (d.serie) czesci.push(`<b>${d.serie}</b> seryjne czyszczenie grafiku`);
    pasek.hidden = false;
    pasek.innerHTML = `<span class="ikona">⚠</span>
      <span class="tresc">W najbliższych ${d.dni} dniach ${operacyjna() ? 'w grafiku' : 'w Twoim grafiku'}: ${czesci.join(' · ')}.</span>
      <button class="trm-btn sm" onclick="TRM.zmianyPokaz()">Zobacz co zniknęło</button>`;
  }
  TRM.zmianyPokaz = () => { TRM.otworzPowiadomienia('zmiany'); const p = el('trm-zmiany-pasek'); if (p) { p.hidden = true; p.innerHTML = ''; } };

  // ── „Co się zmieniło w tym dniu" ─────────────────────────────────────────────────────────────
  // Jedno miejsce z odpowiedzią na „nikt nie pamięta, kto tam był zapisany": kto, kiedy, co i dlaczego.
  TRM.zmianyDnia = async () => {
    panelOtworz(naglowekPanelu('Zmiany w tym dniu', ladnaData(TRM.data)) + '<div class="trm-empty"><div class="big">⏳</div><p>Pobieramy…</p></div>');
    const d = await api('trm_zmiany_dnia', { data: TRM.data });
    if (d.status !== 'success') return panelOtworz(naglowekPanelu('Zmiany w tym dniu') + `<div class="trm-note bad">${esc(d.message)}</div>`);
    const p = d.podsumowanie;
    const AKCJA = { anulowano: ['Odwołano wizytę', 'bad'], anulowano_pozycje: ['Odwołano zabiegi', 'bad'], przelozono: ['Przełożono', 'warn'], utworzono: ['Dodano wizytę', 'ok'], przywrocono: ['Przywrócono', 'ok'] };
    const lista = d.zmiany.length ? d.zmiany.map(x => {
      const a = AKCJA[x.akcja] || [x.akcja, 'neu'];
      return `<div class="trm-zmiana ${a[1]}" onclick="TRM.otworzSzczegoly(${x.rezerwacja_id})" title="Otwórz wizytę">
        <div class="glowa"><b>${esc(a[0])}</b> <span class="muted small">${esc(x.kiedy)} · ${esc(x.kto)}</span></div>
        <div class="kto">${esc(x.klient || '—')}${x.pracownicy ? ' · ' + esc(x.pracownicy) : ''}${x.start ? ' · ' + esc(x.start.slice(11, 16)) : ''} <span class="muted small">${esc(x.numer)}</span></div>
        ${x.opis ? `<div class="opis">${esc(x.opis)}</div>` : ''}
      </div>`;
    }).join('') : '<div class="trm-empty"><div class="big">🗓️</div><p>W tym dniu nic się nie zmieniało.</p></div>';
    panelOtworz(naglowekPanelu('Zmiany w tym dniu', ladnaData(TRM.data)) + `
      <div class="trm-card"><div class="trm-row" style="gap:18px; flex-wrap:wrap">
        <div><div class="muted small">odwołań</div><b style="font-size:18px">${p.odwolan}</b></div>
        <div><div class="muted small">przełożeń</div><b style="font-size:18px">${p.przelozen}</b></div>
        <div><div class="muted small">dodanych</div><b style="font-size:18px">${p.dodanych}</b></div>
      </div></div>
      <div class="trm-zmiany-lista">${lista}</div>`);
  };

  function liczniki(d) {
    const c = el('trm-counters'); if (!c) return;
    const akt = d.rezerwacje.filter(r => !['anulowana', 'odrzucona', 'wygasla'].includes(r.status));
    const doRozl = akt.filter(r => r.wykonanie === 'wykonana' && !r.sprzedaz_id).length;
    const nieob = d.nieobecnosci.length;
    const anul = d.rezerwacje.length - akt.length;
    const lm = (n, j, m, w) => n === 1 ? j : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? m : w;
    c.innerHTML = `<span><b>${akt.length}</b> ${lm(akt.length, 'wizyta', 'wizyty', 'wizyt')}</span><span><b>${akt.filter(r => r.obecnosc === 'przybyl').length}</b> przybyło</span>${doRozl ? `<span><b>${doRozl}</b> do rozliczenia</span>` : ''}${nieob ? `<span><b>${nieob}</b> nieobecności/blokad</span>` : ''}${anul ? `<label style="display:inline-flex;align-items:center;gap:4px;text-transform:none;letter-spacing:0;font-size:12px;margin:0;cursor:pointer"><input type="checkbox" ${TRM.pokazAnul ? 'checked' : ''} onchange="TRM.pokazAnul=this.checked;TRM.widokZmien(TRM.widok)" style="min-height:0"> pokaż anulowane (${anul})</label>` : ''}${operacyjna() ? '<button class="trm-btn link sm" onclick="TRM.zmianyDnia()" title="Kto odwołał, przełożył albo dodał wizytę w tym dniu">Co się zmieniło?</button>' : ''}<span class="small">Ostatnia aktualizacja ${hhmm(d.teraz)}</span>`;
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
  // ── Preferencje klientki (19.10.2026) ────────────────────────────────────────────────────────
  // „Chcę jednym rzutem oka wiedzieć, że lubi kawę z mlekiem i woli ciepło”. Dane są per klientka
  // (moduł preferencji), więc dla całego dnia pytamy raz — jedno żądanie na listę identyfikatorów.
  // Serwer sam ogranicza zakres: kosmetolog dostaje tylko preferencje oznaczone „przy zabiegu”.
  TRM.pref = { mapa: {}, slownik: null, dzien: null, edycja: null };
  const preferencje = (r) => (r && r.id_klienta && TRM.pref.mapa[r.id_klienta]) || [];

  async function pobierzPreferencje(rezerwacje, dzien) {
    const idy = [...new Set((rezerwacje || []).map(r => r.id_klienta).filter(Boolean))];
    if (!idy.length) { TRM.pref.mapa = {}; TRM.pref.dzien = dzien; return; }
    const d = await api('pref_wielu', { id_klientow: idy });
    if (d.status === 'success') { TRM.pref.mapa = d.preferencje || {}; TRM.pref.dzien = dzien; }
  }
  /** Chipsy preferencji — „☕ Kawa z mlekiem · 🌡️ Woli ciepło”. */
  function chipsyPreferencji(r, limit) {
    const p = preferencje(r); if (!p.length) return '';
    const widoczne = limit ? p.slice(0, limit) : p;
    const reszta = p.length - widoczne.length;
    return `<div class="trm-pref">${widoczne.map(x => `<span class="trm-pref-chip" title="${esc(x.nazwa + ': ' + x.wartosc)}">${x.ikona ? `<span class="ik">${esc(x.ikona)}</span>` : ''}${esc(x.wartosc)}</span>`).join('')}${reszta > 0 ? `<span class="trm-pref-chip wiecej">+${reszta}</span>` : ''}</div>`;
  }
  /** Znak przy nazwisku: są preferencje, zobacz szczegóły. */
  function znakPreferencji(r) {
    const p = preferencje(r); if (!p.length) return '';
    return `<span class="trm-pref-znak" title="${esc(p.map(x => x.nazwa + ': ' + x.wartosc).join(' · '))}" aria-label="Klientka ma zapisane preferencje">${esc(p[0].ikona || '★')}</span>`;
  }
  /** Przerysowanie bieżącego widoku po doczytaniu preferencji — bez ponownego pytania o dane.
   *  Pozycję przewinięcia odtwarzamy sami: to przerysowanie dzieje się „w tle”, już po tym,
   *  jak recepcja zobaczyła dzień, i nie może jej zrzucić na górę listy. */
  function odswiezWidokPoPreferencjach() {
    const kontener = document.querySelector('.main-content');
    const scrollPrzed = kontener ? kontener.scrollTop : 0;
    const wroc = () => { if (kontener) kontener.scrollTop = scrollPrzed; };
    if (TRM.szcz && TRM.szcz.rez) renderSzczegoly();
    if ((TRM.widok === 'tydzien' || TRM.widok === 'agenda') && TRM.zakres) {
      const od = TRM.widok === 'tydzien' ? poniedzialek(TRM.data) : TRM.data;
      TRM.widok === 'tydzien' ? renderTydzien(od) : renderAgenda(od, dodajDni(od, 6));
      return wroc();
    }
    if (!TRM.dzien) return;
    if (TRM.widok === 'zasoby') { renderZasoby(); return wroc(); }
    if (TRM.widok === 'moj' || waski()) { renderAgendaDnia(); return wroc(); }
    if (TRM.widok === 'dzien') { renderDzien(); wroc(); }
  }
  /** Karta preferencji w szczegółach wizyty — z edycją dla recepcji i managera. */
  function prefKartaHtml(r) {
    if (!r.id_klienta) return '';
    const p = preferencje(r), edycja = TRM.pref.edycja === r.id_klienta, mozna = operacyjna();
    if (!p.length && !mozna) return '';
    const naglowek = `<div class="trm-row" style="justify-content:space-between;align-items:center"><h3 style="margin:0">Preferencje klientki</h3>${mozna ? `<button class="trm-btn link sm" onclick="TRM.prefEdytor('${esc(r.id_klienta)}')">${edycja ? 'Gotowe' : (p.length ? 'Zmień' : '+ dodaj')}</button>` : ''}</div>`;
    if (!edycja) return `<div class="trm-card">${naglowek}${p.length ? chipsyPreferencji(r) : '<div class="muted small">Nic jeszcze nie zapisano. Kawa czy herbata? Woli ciepło? Jedno kliknięcie i następnym razem wie o tym cała zmiana.</div>'}</div>`;
    const sl = TRM.pref.slownik || [];
    const teraz = Object.fromEntries(p.map(x => [x.klucz, x.wartosc]));
    return `<div class="trm-card">${naglowek}
      <div class="trm-pref-edytor">${sl.map(s => {
        const w = teraz[s.klucz] || '';
        if (s.typ === 'tekst') return `<label class="trm-pref-pole"><span>${esc(s.ikona || '')} ${esc(s.nazwa)}</span>
          <input type="text" maxlength="120" value="${esc(w)}" placeholder="wpisz…" onchange="TRM.prefUstaw('${esc(r.id_klienta)}','${esc(s.klucz)}', this.value)"></label>`;
        return `<label class="trm-pref-pole"><span>${esc(s.ikona || '')} ${esc(s.nazwa)}</span>
          <select onchange="TRM.prefUstaw('${esc(r.id_klienta)}','${esc(s.klucz)}', this.value)">
            <option value="">—</option>${(s.opcje || []).map(o => `<option ${o === w ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select></label>`;
      }).join('')}</div>
      <div class="trm-pomoc">Preferencje to komfort obsługi. Alergie, choroby i leki zapisuj w konsultacji i dokumentach klientki — nie tutaj.</div>
    </div>`;
  }
  TRM.prefEdytor = async (id) => {
    if (TRM.pref.edycja === id) { TRM.pref.edycja = null; return renderSzczegoly(); }
    if (!TRM.pref.slownik) { const d = await api('pref_slownik'); if (d.status !== 'success') return toast('error', 'Nie udało się pobrać listy preferencji', d.message); TRM.pref.slownik = d.slownik || []; }
    TRM.pref.edycja = id; renderSzczegoly();
  };
  TRM.prefUstaw = async (id, klucz, wartosc) => {
    const d = await api('pref_zapisz', { id_klienta: id, klucz, wartosc });
    if (d.status !== 'success') return toast('error', 'Nie zapisano preferencji', d.message);
    TRM.pref.mapa[id] = d.preferencje || [];
    toast('success', wartosc ? 'Zapisano preferencję' : 'Usunięto preferencję');
    renderSzczegoly(); odswiezWidokPoPreferencjach();
  };

  // ── Znak notatki (19.10.2026) ────────────────────────────────────────────────────────────────
  // Prośba z recepcji: „jak nie kliknę, to się nie dowiem, że przy wizycie jest notatka”.
  // Notatka przychodzi tylko do ról operacyjnych (serwer zeruje ją kosmetologom), więc sam fakt
  // jej obecności wystarczy jako warunek — nic więcej nie trzeba sprawdzać po stronie przeglądarki.
  const notatkaTekst = (r) => String((r && r.notatka) || '').trim();
  const IKONA_NOTATKI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/><path d="M8.5 9h7"/><path d="M8.5 13h4"/></svg>';
  function znakNotatki(r) {
    const n = notatkaTekst(r); if (!n) return '';
    const skrot = n.length > 180 ? n.slice(0, 180) + '…' : n;
    return `<span class="trm-notatka-znak" title="Notatka: ${esc(skrot)}" aria-label="Wizyta z notatką">${IKONA_NOTATKI}</span>`;
  }

  function kolumnaHtml(rezerwacje, dostepnosc, bloki, zak, klik, filtrPoz, dragPrac) {
    const h = zak.do - zak.od;
    let s = '';
    for (let m = zak.od; m <= zak.do; m += 30) s += `<div class="hline ${m % 60 ? 'half' : ''}" style="top:${(m - zak.od) * PX}px"></div>`;
    (dostepnosc || []).forEach(p => { const a = Math.max(zak.od, minDnia(p.od)), b = Math.min(zak.do, minDnia(p.do) || 1440); if (b > a) s += `<div class="dost" style="top:${(a - zak.od) * PX}px;height:${(b - a) * PX}px"></div>`; });
    // Blokada w siatce: rezerwację techniczną recepcja zdejmuje jednym kliknięciem; urlop
    // i choroba zostają sprawą managera (podpowiedź tłumaczy, dlaczego klik nic nie robi).
    (bloki || []).forEach(bl => {
      const a = Math.max(zak.od, minDnia(bl.od)), c = Math.min(zak.do, minDnia(bl.do) || 1440);
      if (c <= a) return;
      const techniczna = ['szkolenie', 'przerwa', 'serwis', 'inne'].includes(bl.typ);
      // Klik otwiera szczegóły (jak przy wizycie): tam są godziny, powód, wydłużenie i zdjęcie.
      const klik = bl.id ? `onclick="event.stopPropagation(); TRM.blokadaOtworz(${bl.id})" ` : '';
      const tytul = techniczna ? 'Rezerwacja techniczna — kliknij, żeby zobaczyć i zmienić' : 'Nieobecność — kliknij, żeby zobaczyć szczegóły';
      s += `<div class="blok" title="${esc(tytul)}" ${klik}style="${bl.id ? 'cursor:pointer;' : ''}top:${(a - zak.od) * PX}px;height:${(c - a) * PX}px">${esc(bl.opis || 'Niedostępne')}</div>`;
    });
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
      const krotka = (b - a) < 40, mini = (b - a) < 20; // D01: 20–39 min = 2 linie (godzina·klientka / usługa), <20 min = 1 linia
      s += `<div class="trm-karta ${anul ? 'anul' : ''} ${r.wykonanie === 'wykonana' ? 'wyk' : ''} ${r.obecnosc === 'nieobecny' ? 'nieob' : ''} ${TRM.szcz && TRM.szcz.rez && TRM.szcz.rez.id === r.id ? 'akt' : ''} ${mozePrzeciagac ? 'przeciagalna' : ''} ${krotka ? 'krotka' : ''} ${mini ? 'mini' : ''}" data-rezerwacja="${r.id}" data-pozycje="${pozIdsCsv}" data-prac-zrodlo="${mozePrzeciagac ? esc(dragPrac) : ''}" ${mozePrzeciagac ? 'onpointerdown="TRM.pDown(event)"' : ''} style="--kat:${kol};--tlo:${kol}1f;top:${(a - zak.od) * PX}px;height:${Math.max(22, (b - a) * PX - 2)}px" onclick="event.stopPropagation();TRM.kartaKlik(event, ${r.id})" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();TRM.kartaKlik(event, ${r.id});}" aria-label="${esc(r.klient_nazwa + ', ' + hhmm(poz[0].start) + '–' + hhmm(poz[poz.length - 1].koniec) + ', ' + naz)}">
        ${znakNotatki(r)}${znakPreferencji(r)}${krotka ? `<div class="l1"><span class="g">${hhmm(poz[0].start)}–${hhmm(poz[poz.length - 1].koniec)}</span><span class="sep"> · </span><span class="k">${esc(r.klient_nazwa)}</span></div>${mini ? '' : `<div class="u">${esc(naz)}</div>`}` : `<div class="g">${hhmm(poz[0].start)}–${hhmm(poz[poz.length - 1].koniec)}</div><div class="k">${esc(r.klient_nazwa)}</div><div class="u">${esc(naz)}${poz.some(p => p.pierwsza) ? ' <span class="trm-pierwsza">1. wizyta</span>' : ''}</div>${zn.length ? `<div class="zn">${zn.slice(0, 2).join('')}</div>` : ''}`}
      </div>`;
    });
    return `<div class="trm-col" data-prac="${dragPrac ? esc(dragPrac) : ''}" style="height:${h * PX}px" ${klik ? `onclick="${klik}"` : ''}>${s}<div id="trm-teraz-slot"></div></div>`;
  }
  // Legenda kolorów dla kategorii widocznych TEGO dnia (zgłoszenie #12). Bez niej kolor jest ładny,
  // ale nic nie znaczy — recepcja musiałaby zgadywać, co oznacza odcień. Pokazujemy tylko to,
  // co faktycznie jest na ekranie; przy dniu z kilkunastoma kategoriami reszta ląduje pod „+N".
  function legendaKategorii(rezerwacje) {
    const mapa = new Map();
    (rezerwacje || []).forEach(r => (r.pozycje || []).forEach(p => {
      const u = usluga(p.usluga_id); const kat = (p.kategoria || (u && u.kategoria) || '').trim();
      if (kat && !mapa.has(kat)) mapa.set(kat, kolorKat(u || { kategoria: kat }));
    }));
    if (!mapa.size) return '';
    const lista = [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl'));
    const widoczne = lista.slice(0, 12), reszta = lista.length - widoczne.length;
    return `<div class="trm-legenda-kat"><span class="e">Kolory zabiegów:</span>${widoczne.map(([kat, kol]) =>
      `<span class="poz"><i style="background:${kol}"></i>${esc(kat)}</span>`).join('')}${reszta > 0 ? `<span class="muted">+${reszta} ${reszta === 1 ? 'inna' : 'innych'}</span>` : ''}</div>`;
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
    if (TRM._suprimKlik && Date.now() < TRM._suprimKlik) return; // C01: puszczenie myszy po geście (także anulowanym) nie jest kliknięciem w siatkę
    const col = ev.currentTarget; const rect = col.getBoundingClientRect();
    const zak = TRM._zak || { od: 480 };
    const siatka = (TRM.dane.ustawienia.siatka_min || 15);
    let m = zak.od + Math.floor((ev.clientY - rect.top) / PX); m = Math.floor(m / siatka) * siatka;
    const start = `${TRM.data} ${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    TRM.nowaWizyta({ start, pracownik });
  };

  // ── REZERWACJA TECHNICZNA (19.10.2026) ───────────────────────────────────────────────────────
  // „Ola chciałaby zarezerwować gabinet na szkolenie albo rozmowę kwalifikacyjną." Blokady
  // istniały w Ustawieniach u managera; tutaj to samo z poziomu kalendarza, dla recepcji,
  // bez spraw kadrowych (urlop i choroba zostają w Ustawieniach).
  const POWODY_BLOKADY = [['szkolenie', 'Szkolenie'], ['przerwa', 'Rozmowa / spotkanie'], ['serwis', 'Serwis, naprawa'], ['inne', 'Inne']];
  TRM.blokadaNowa = (o) => {
    if (!operacyjna()) return;
    const start = (o && o.start) || `${TRM.data} 09:00`;
    const koniec = S_dodajMin(start, 60);
    TRM.blok = { od: start, do: koniec, typ: 'szkolenie', osoba: (o && o.osoba) || '', zasob_id: (o && o.zasob_id) || '', opis: '', caly_salon: !!(o && o.caly_salon), dotkniete: null };
    renderBlokada();
  };
  // Dodanie minut z poprawnym przejściem przez północ (próba wyłapała „+1 godz." do 23:59,
  // które przy prostym liczeniu godzin gubiło datę i dawało koniec przed początkiem).
  const S_dodajMin = (dt, min) => {
    const [d, g] = String(dt).split(" ");
    const [rok, mies, dzien] = d.split("-").map(Number);
    const [h, m] = (g || "00:00").split(":").map(Number);
    const t = new Date(rok, mies - 1, dzien, h, m);
    t.setMinutes(t.getMinutes() + min);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  };
  function renderBlokada() {
    const b = TRM.blok; if (!b) return;
    const zas = (TRM.dane.zasoby || []).filter(z => !z.archiwalny);
    const istniejaca = !!b.id;
    const nazwaZasobu = (id) => { const z = (TRM.dane.zasoby || []).find(x => String(x.id) === String(id)); return z ? z.nazwa : null; };
    // Podgląd: dla osób bez prawa zmiany, a także dla KAŻDEJ nieobecności (urlop, choroba).
    // Ten panel zna tylko powody techniczne, więc edycja urlopu po cichu zmieniłaby mu rodzaj —
    // nieobecności zostają tam, gdzie się je zakłada, czyli w Ustawieniach.
    if (istniejaca && (b.mozna === false || b.techniczna === false)) {
      return panelOtworz(naglowekPanelu(b.techniczna ? 'Rezerwacja techniczna' : 'Nieobecność', ladnaData(b.od.slice(0, 10))) + `
        <div class="trm-card">
          <h3 style="margin-bottom:6px">${esc(b.opis || POWODY_BLOKADY.reduce((a, [k, n]) => (k === b.typ ? n : a), b.typ))}</h3>
          <div class="muted small">${esc(b.od.slice(11, 16))}–${esc(b.do.slice(11, 16))}${b.osoba ? ' · ' + esc(b.osoba) : ''}${b.zasob_id ? ' · ' + esc(nazwaZasobu(b.zasob_id) || '') : ''}</div>
          <div class="trm-note info small" style="margin-top:10px">${b.techniczna ? 'Ten czas jest zarezerwowany, więc nie można tu umówić klientki. Zmienia go recepcja albo manager.' : 'Nieobecność zakłada i zdejmuje manager w Ustawieniach.'}</div>
          ${b.utworzyl ? `<div class="trm-pomoc">Zapisał(a): ${esc(b.utworzyl)}</div>` : ''}
          <div class="trm-row" style="margin-top:10px"><button class="trm-btn fix" onclick="TRM.panelZamknij()">Zamknij</button></div>
        </div>`);
    }
    panelOtworz(naglowekPanelu(istniejaca ? 'Rezerwacja techniczna' : 'Rezerwacja techniczna', `${ladnaData(b.od.slice(0, 10))}${istniejaca ? ' · ' + esc(b.od.slice(11, 16)) + '–' + esc(b.do.slice(11, 16)) : ''}`) + `
      <div class="trm-card">
        <div class="trm-note info small">${istniejaca
          ? 'Możesz przesunąć godziny, zmienić powód albo dopisać, czego dotyczy. Zmiana działa od razu — czas zwolni się albo zajmie w grafiku.'
          : 'Czas zarezerwowany na coś innego niż wizyta: szkolenie, rozmowa kwalifikacyjna, serwis urządzenia. W grafiku pojawi się blokada, więc nikt nie umówi tu klientki.'}</div>
        ${istniejaca ? `<div class="trm-row" style="margin:10px 0 2px">
          <span class="muted small fix">Czas trwania:</span>
          <button class="trm-btn sm fix" onclick="TRM.blokadaWydluz(-30)">−30 min</button>
          <button class="trm-btn sm fix" onclick="TRM.blokadaWydluz(30)">+30 min</button>
          <button class="trm-btn sm fix" onclick="TRM.blokadaWydluz(60)">+1 godz.</button>
          ${b.utworzyl ? `<span class="muted small">Zapisał(a): ${esc(b.utworzyl)}</span>` : ''}
        </div>` : ''}
        <div class="trm-grid2" style="margin-top:10px">
          <div class="trm-field"><label>Od</label><input type="datetime-local" value="${esc(b.od.replace(' ', 'T'))}" onchange="TRM.blokadaPole('od', this.value)"></div>
          <div class="trm-field"><label>Do</label><input type="datetime-local" value="${esc(b.do.replace(' ', 'T'))}" onchange="TRM.blokadaPole('do', this.value)"></div>
        </div>
        <div class="trm-field"><label>Kogo dotyczy</label>
          <div class="trm-segment">
            <button class="${b.caly_salon ? '' : 'active'}" onclick="TRM.blokadaZakres(false)">Wybrana osoba / gabinet</button>
            <button class="${b.caly_salon ? 'active' : ''}" onclick="TRM.blokadaZakres(true)">Cały salon</button>
          </div></div>
        ${b.caly_salon
          ? '<div class="trm-note warn small"><b>Cały salon</b> — w tym czasie nikt nie przyjmuje i żaden gabinet nie jest dostępny. Tak zapisuje się zebranie zespołu, remanent czy szkolenie dla wszystkich.</div>'
          : `<div class="trm-grid2">
          <div class="trm-field"><label>Osoba (opcjonalnie)</label><select onchange="TRM.blokadaPole('osoba', this.value)"><option value="">— nikogo nie zajmuje —</option>${(TRM.dane.pracownicy || []).map(p => `<option ${b.osoba === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
          <div class="trm-field"><label>Gabinet lub urządzenie (opcjonalnie)</label>
            <select onchange="TRM.blokadaPole('zasob_id', this.value)"><option value="">— żadnego —</option>${zas.map(z => `<option value="${z.id}" ${String(b.zasob_id) === String(z.id) ? 'selected' : ''}>${esc(z.nazwa)}${z.typ === 'urzadzenie' ? ' (urządzenie)' : ''}</option>`).join('')}</select></div>
        </div>`}
        <div class="trm-field"><label>Powód</label><select onchange="TRM.blokadaPole('typ', this.value)">${POWODY_BLOKADY.map(([k, n]) => `<option value="${k}" ${b.typ === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="trm-field"><label>Czego dotyczy</label><input value="${esc(b.opis)}" placeholder="np. szkolenie Vagheggi, rozmowa kwalifikacyjna" onchange="TRM.blokadaPole('opis', this.value)"></div>
        <div class="trm-pomoc">${b.caly_salon ? 'Blokada obejmie wszystkie kolumny w widoku Dzień i wszystkie gabinety' : b.osoba ? 'Zobaczysz to w kolumnie osoby w widoku Dzień' : 'Bez wskazanej osoby rezerwacja pokaże się w widoku <b>Zasoby</b> — w grafiku dnia nie zajmie niczyjej kolumny'}${b.zasob_id ? ', a gabinet będzie zajęty dla całego zespołu' : ''}.</div>
        ${b.dotkniete && b.dotkniete.length ? `<div class="trm-note warn small"><b>W tym czasie ${b.dotkniete.length === 1 ? 'jest już wizyta' : 'są już wizyty'}:</b>
          ${b.dotkniete.slice(0, 6).map(x => `<div>${esc((x.start || '').slice(11, 16))}–${esc((x.koniec || '').slice(11, 16))} · ${esc(x.klient_nazwa || '')} · ${esc(x.pracownik || '')}</div>`).join('')}
          Rezerwacja ich nie odwołuje — przestaw je albo zapisz świadomie.</div>` : ''}
        <div class="trm-row" style="margin-top:10px">
          <button class="trm-btn primary" onclick="TRM.blokadaZapisz()">${b.dotkniete && b.dotkniete.length ? 'Zapisz mimo wizyt' : (istniejaca ? 'Zapisz zmiany' : 'Zarezerwuj czas')}</button>
          ${istniejaca ? `<button class="trm-btn danger fix" onclick="TRM.blokadaUsun(${b.id}, '${esc(String(b.opis || '')).replace(/'/g, "\\'")}')">Zdejmij rezerwację</button>` : ''}
          <button class="trm-btn fix" onclick="TRM.panelZamknij()">${istniejaca ? 'Zamknij' : 'Anuluj'}</button>
        </div>
      </div>`);
  }
  TRM.blokadaZakres = (calySalon) => { const b = TRM.blok; if (!b) return; b.caly_salon = !!calySalon; if (calySalon) { b.osoba = ''; b.zasob_id = ''; } b.dotkniete = null; renderBlokada(); };
  TRM.blokadaPole = (pole, wartosc) => { if (!TRM.blok) return; TRM.blok[pole] = String(wartosc || '').replace('T', ' ').slice(0, pole === 'opis' ? 255 : 16); if (pole === 'od' || pole === 'do' || pole === 'osoba' || pole === 'zasob_id') TRM.blok.dotkniete = null; };
  TRM.blokadaZapisz = async () => {
    const b = TRM.blok; if (!b) return;
    const d = await api('trm_blokada_zapisz', { id: b.id || undefined, od: b.od, do: b.do, typ: b.typ, osoba: b.osoba, zasob_id: b.zasob_id, caly_salon: !!b.caly_salon, opis: b.opis, wymus: !!(b.dotkniete && b.dotkniete.length) });
    if (d.status !== 'success') return toast('error', 'Nie zarezerwowano', d.message);
    if (d.wymaga_decyzji) { b.dotkniete = d.dotkniete || []; return renderBlokada(); }
    toast('success', b.id ? 'Rezerwacja zmieniona' : 'Czas zarezerwowany', b.opis);
    TRM.blok = null; TRM.panelZamknij(); odswiez({ cicho: true });
  };
  TRM.blokadaUsun = async (id, opis) => {
    if (!window.confirm(`Zdjąć rezerwację „${opis || ''}”? Czas wróci jako wolny.`)) return;
    const d = await api('trm_blokada_usun', { id });
    if (d.status !== 'success') return toast('error', 'Nie zdjęto rezerwacji', d.message);
    toast('success', 'Rezerwacja zdjęta'); TRM.blok = null; TRM.panelZamknij(); odswiez({ cicho: true });
  };
  /** Kliknięcie w blokadę otwiera szczegóły (jak przy wizycie), a nie od razu kasuje. */
  TRM.blokadaOtworz = async (id) => {
    const d = await api('trm_blokada_szczegoly', { id });
    if (d.status !== 'success') return toast('error', 'Nie otwarto rezerwacji', d.message);
    const b = d.blokada;
    TRM.blok = { id: b.id, od: b.od, do: b.do, typ: b.typ, osoba: b.pracownik || '', zasob_id: b.zasob_id || '', opis: b.opis || '', caly_salon: !!b.caly_salon,
      dotkniete: null, utworzyl: b.utworzyl, techniczna: b.techniczna, mozna: d.mozna_edytowac, podglad: true };
    renderBlokada();
  };
  /** Szybkie przesunięcie końca (wydłużenie/skrócenie) — najczęstsza zmiana przy szkoleniu. */
  TRM.blokadaWydluz = (minuty) => {
    const b = TRM.blok; if (!b) return;
    const nowy = S_dodajMin(b.do, minuty);
    if (nowy <= b.od) return toast('warning', 'Koniec musi być po początku');   // porównanie tekstu „RRRR-MM-DD GG:MM” działa jak porównanie czasu
    b.do = nowy; renderBlokada();
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
    const rect = TRM.bubla.rect, szer = 380;
    let left = rect.right + 14; if (left + szer > window.innerWidth - 16) left = Math.max(12, rect.left - szer - 14);
    const anul = ['anulowana', 'odrzucona', 'wygasla'].includes(r.status);
    const aktywna = !anul && r.wykonanie !== 'wykonana';
    const poz = r.pozycje.filter(x => x.stan !== 'anulowana');
    const lista = poz.length ? poz : r.pozycje;
    const op = operacyjna();
    // jeden główny stan obsługi (T05/T06): odwołana > nieobecna > wykonana > w trakcie > przybyła > zaplanowana
    const glowny = anul ? ST_LABEL[r.status] : r.obecnosc === 'nieobecny' ? OB_LABEL.nieobecny : r.wykonanie === 'wykonana' ? WYK_LABEL.wykonana : r.wykonanie === 'czesciowo' ? WYK_LABEL.czesciowo : r.wykonanie === 'w_toku' ? WYK_LABEL.w_toku : r.obecnosc === 'przybyl' ? OB_LABEL.przybyl : r.obecnosc === 'spozniony' ? OB_LABEL.spozniony : ['Zaplanowana', 'info'];
    // rozliczenie: tylko to, co system naprawdę wie (bez fikcyjnych liczników pakietu — etap A nie śledzi jednostek zakupu)
    const zPakietu = lista.some(x => x.zakup_skladnik_id);
    const rozl = !op ? '' : (zPakietu ? `<span class="trm-pill pakiet">Z pakietu</span>` : '') + (r.sprzedaz_id ? `<span class="trm-pill ok">Rozliczona</span><span>sprzedaż ${esc(r.sprzedaz_id)}</span>` : (r.wykonanie === 'wykonana' || r.wykonanie === 'czesciowo') ? `<span class="trm-pill warn">Do rozliczenia</span><span>w Sprzedaży, po wykonaniu</span>` : zPakietu ? `<span>jednostka zarezerwowana</span>` : `<span class="trm-pill neu">Rozliczenie po wykonaniu</span>`);
    // główna czynność zależna od etapu
    let akcja = '';
    if (op && aktywna) {
      if (r.obecnosc !== 'przybyl' && r.wykonanie === 'zaplanowana') akcja = `<button class="trm-btn sm primary" onclick="TRM.bublaObecnosc('przybyl')">Oznacz przybycie</button>`;
      else if (lista.some(x => x.stan === 'zaplanowana') && r.wykonanie !== 'w_toku') akcja = `<button class="trm-btn sm primary" onclick="TRM.bublaStan(${(lista.find(x => x.stan === 'zaplanowana') || {}).id}, 'w_trakcie')">Rozpocznij zabieg</button>`;
      else if (lista.some(x => x.stan === 'w_trakcie')) akcja = `<button class="trm-btn sm primary" onclick="TRM.bublaStan(${(lista.find(x => x.stan === 'w_trakcie') || {}).id}, 'wykonana')">Zakończ zabieg</button>`;
    }
    layer.innerHTML = `<div class="trm-bubble" style="left:${left}px;top:12px" role="dialog" aria-label="Podgląd wizyty" tabindex="-1">
      <div class="trm-row" style="margin-bottom:4px">${pill(glowny)}<div class="trm-spacer"></div><button class="trm-x" onclick="TRM.zamknijBuble()" aria-label="Zamknij podgląd">✕</button></div>
      <h4>${esc(r.klient_nazwa)}${r.id_klienta && op ? ` <button class="trm-btn link sm" style="font-size:12px;vertical-align:middle" onclick="TRM.zamknijBuble();pokaz('klient-profil'); setTimeout(() => otworzProfil('${esc(r.id_klienta)}'), 100);">Profil ↗</button>` : ''}</h4>
      <div class="muted small">${esc(ladnaData(r.start.slice(0, 10)))} · <b>${hhmm(r.start)}–${hhmm(r.koniec)}</b> · ${lista.length} ${lista.length === 1 ? 'zabieg' : lista.length < 5 ? 'zabiegi' : 'zabiegów'}</div>
      <div style="margin-top:10px">${lista.map(x => `<div class="trm-bubble-poz"><span class="g">${hhmm(x.start)}–${hhmm(x.koniec)}</span><span><b>${esc(x.kategoria)}${x.wariant ? ' · ' + esc(x.wariant) : ''}</b></span><span class="m">${esc(x.wykonawca_fakt || x.pracownik || '—')}${x.gabinet ? ' · ' + esc(x.gabinet) : ''}${x.urzadzenie ? ' · ' + esc(x.urzadzenie) : ''}${x.stan !== 'zaplanowana' ? ' · ' + esc(POZ_LABEL[x.stan] || x.stan) : ''}</span></div>`).join('')}</div>
      ${chipsyPreferencji(r, 5)}
      ${notatkaTekst(r) ? `<div class="trm-bubble-notatka">${IKONA_NOTATKI}<span>${esc(notatkaTekst(r))}</span></div>` : ''}
      ${rozl ? `<div class="trm-bubble-rozl">${rozl}</div>` : ''}
      <div class="trm-bubble-foot">
        ${akcja ? akcja.replace('class="trm-btn sm primary"', 'class="trm-btn primary glowna"') : ''}
        ${aktywna && op && r.wykonanie === 'zaplanowana' ? `<button class="trm-btn sm" onclick="TRM.bublaPrzelozenie()">Przełóż</button>` : '<span></span>'}
        <button class="trm-btn sm ${akcja ? 'link' : 'primary'}" onclick="TRM.bublaSzczegoly()">Szczegóły wizyty</button>
      </div>
    </div>`;
    // dopasowanie do ekranu dopiero po zmierzeniu realnej wysokości (chmurka ma się mieścić w oknie)
    const b = layer.firstElementChild; if (b) { const h = b.offsetHeight; b.style.top = Math.max(12, Math.min(rect.top - 40, window.innerHeight - h - 12)) + 'px'; }
  }
  TRM.bublaStan = async (pozId, stan) => { const id = TRM.bubla && TRM.bubla.id; if (!id || !pozId) return; TRM.zamknijBuble(); const d = await api('trm_pozycja_stan', { id, pozycja_id: pozId, stan }); if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message); toast('success', stan === 'w_trakcie' ? 'Zabieg rozpoczęty' : 'Zabieg zakończony'); await odswiez(); if (TRM.szcz && TRM.szcz.id === id) await przeladujSzczegoly(d.rezerwacja); };
  TRM.zamknijBuble = () => { TRM.bubla = null; const l = el('trm-bubble-layer'); if (l) l.innerHTML = ''; };
  TRM.bublaSzczegoly = async () => { const id = TRM.bubla.id; TRM.zamknijBuble(); await TRM.otworzSzczegoly(id); };
  TRM.bublaPrzelozenie = async () => { const id = TRM.bubla.id; TRM.zamknijBuble(); await TRM.otworzSzczegoly(id); if (!TRM.szcz || !TRM.szcz.rez) return; TRM.szcz.tryb = 'zmiana'; TRM.zm = { start: TRM.szcz.rez.start.slice(0, 16), prac: {} }; TRM.renderSzczegoly(); };
  TRM.bublaObecnosc = async (stan) => { const id = TRM.bubla.id; TRM.zamknijBuble(); const d = await api('trm_obecnosc', { id, obecnosc: stan }); if (d.status !== 'success') return toast('error', 'Nie udało się', d.message); toast('success', 'Zapisano'); await odswiez(); };
  // Hak do prób: pozwala sprawdzić kolory kategorii bez klikania po całym terminarzu
  // (używany przez harness przy zgłoszeniu #12 — rozróżnialność odcieni na prawdziwym cenniku).
  TRM._kolorKat = kolorKat;
  TRM.kartaKlik = (ev, id) => {
    if (TRM._suprimKlik && Date.now() < TRM._suprimKlik) return;
    clearTimeout(trmHoverT); clearTimeout(trmLeaveT);
    TRM.bubla = { id, pinned: true, rect: ev.currentTarget.getBoundingClientRect() };
    trmPokazBuble();
  };
  let trmKursor = { x: -1, y: -1 };
  document.addEventListener('pointermove', (ev) => { trmKursor = { x: ev.clientX, y: ev.clientY }; }, { passive: true });
  const trmKursorNaChmurce = () => { const e = document.elementFromPoint(trmKursor.x, trmKursor.y); return !!(e && e.closest && e.closest('.trm-bubble, .trm-karta[data-rezerwacja]')); };
  function trmHoverKarta(ev) {
    if (drag || ev.pointerType === 'touch') return;
    // wejście na chmurkę (albo powrót na kafelek) kasuje zegar zamknięcia — wcześniej kasował go tylko kafelek,
    // więc przejście przez 14 px szczeliny kafelek→chmurka zamykało ją po 220 ms, zanim dało się kliknąć
    if (ev.target.closest && ev.target.closest('.trm-bubble')) { clearTimeout(trmLeaveT); return; }
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
    const zamknijGdyPoza = () => { if (!TRM.bubla || TRM.bubla.pinned) return; if (trmKursorNaChmurce()) { trmLeaveT = setTimeout(zamknijGdyPoza, 420); return; } TRM.zamknijBuble(); };
    trmLeaveT = setTimeout(zamknijGdyPoza, 420);
  }

  // ── PRZECIĄGANIE kart w widoku Dzień: Pointer Events, próg 6px, podgląd celu na żywo, krok 5 minut,
  // potwierdzenie przed zapisem. Zatwierdzenie woła dokładnie trm_zmien — tę samą akcję co panel
  // „Zmień termin / osobę" — najpierw bez potwierdz (podgląd), potem z potwierdz:true po kliknięciu „Zatwierdź”.
  let drag = null, dragRaf = 0;
  TRM.pDown = (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch') return;
    const card = ev.currentTarget, lane = card.closest('.trm-col'); if (!lane) return;
    drag = { pointerId: ev.pointerId, card, lane, rezId: Number(card.dataset.rezerwacja), pozIds: (card.dataset.pozycje || '').split(',').map(Number).filter(Boolean), pracZrodlo: card.dataset.pracZrodlo, startX: ev.clientX, startY: ev.clientY, offsetY: ev.clientY - card.getBoundingClientRect().top, x: ev.clientX, y: ev.clientY, started: false };
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
    // C01: krok = siatka salonu (nie 5 min na sztywno); karta trzyma punkt chwycenia (offsetY), więc jej GÓRA wyznacza nowy start
    const rect = laneEl.getBoundingClientRect(), zak = TRM._zak || { od: 480 }, krok = (TRM.dane && TRM.dane.ustawienia && TRM.dane.ustawienia.siatka_min) || 15;
    let m = zak.od + (drag.y - (drag.offsetY || 0) - rect.top) / PX; m = Math.max(zak.od, Math.round(m / krok) * krok);
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
  // Escape / utrata gestu (pointercancel) anuluje propozycję bez żadnej mutacji (raport T12)
  function trmDragAnuluj() {
    if (!drag) return;
    const d = drag; drag = null;
    document.querySelectorAll('.trm').forEach(n => n.classList.remove('przeciaganie'));
    if (d.card) d.card.classList.remove('przeciagana');
    if (d.tip) d.tip.remove();
    document.querySelectorAll('.trm-draft-slot').forEach(n => n.remove());
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    try { d.card.releasePointerCapture(d.pointerId); } catch (e) {}
    if (d.started) TRM._suprimKlik = Date.now() + 350;
  }
  document.addEventListener('pointercancel', trmDragAnuluj);
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
    const nowy = podglad.nowy || {}, obecny = podglad.obecny || {}, rez = rezZDnia(d.rezId) || {};
    const prac = (l) => [...new Set((l || []).map(p => p.pracownik).filter(Boolean))].join(', ');
    const pracPrzed = prac(obecny.pozycje), pracPo = prac(nowy.pozycje);
    const zabiegi = (nowy.pozycje || obecny.pozycje || []).map(p => p.nazwa).join(' + ');
    // C01: okno mówi, CO się zmieni — klientka, zabieg, termin przed → po, zmiana wykonawcy; akcja nazwana jednoznacznie
    layer.innerHTML = `<div class="trm-confirm-move" style="left:${left}px;top:${top}px" role="dialog" aria-label="Przełożyć wizytę?">
      <h4 style="margin:0 0 2px">Przełożyć wizytę?</h4><div class="small muted" style="margin-bottom:8px">Nic jeszcze nie zapisano.</div>
      <div class="trm-cm-wiersz"><span class="e">Klientka</span><b>${esc(rez.klient_nazwa || '—')}</b></div>
      <div class="trm-cm-wiersz"><span class="e">Zabieg</span><span>${esc(zabiegi || '—')}</span></div>
      <div class="trm-cm-wiersz"><span class="e">Termin</span><span>${esc(ladnaData((obecny.start || '').slice(0, 10), true))} ${hhmm(obecny.start)}–${hhmm(obecny.koniec)} → <span class="nowy">${esc(ladnaData((nowy.start || '').slice(0, 10), true))} ${hhmm(nowy.start)}–${hhmm(nowy.koniec)}</span></span></div>
      ${pracPrzed !== pracPo ? `<div class="trm-cm-wiersz"><span class="e">Wykonawca</span><span>${esc(pracPrzed || '—')} → <span class="nowy">${esc(pracPo || '—')}</span></span></div>` : `<div class="trm-cm-wiersz"><span class="e">Wykonawca</span><span>${esc(pracPo || '—')} (bez zmian)</span></div>`}
      <div class="trm-row" style="margin-top:10px"><button class="trm-btn sm fix" onclick="TRM.anulujPrzesuniecie()">Anuluj</button><button class="trm-btn sm primary fix" onclick="TRM.zatwierdzPrzesuniecie()">Przełóż wizytę</button></div>
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
    const kartaZ = document.querySelector(`.trm-karta[data-rezerwacja="${pend.rezId}"]`); if (kartaZ) kartaZ.classList.add('zapis'); // E04: siatka zostaje, zmieniana karta pokazuje oczekiwanie
    const wynik = await api('trm_zmien', { ...pend.body, potwierdz: true });
    if (kartaZ) kartaZ.classList.remove('zapis');
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
    const wszyscy = TRM.dane.pracownicy;
    renderFiltry(wszyscy);
    // filtr osób zawęża tylko widok — kolizje liczy serwer na pełnych danych (raport T08)
    const prac = (TRM.filtrPrac && TRM.filtrPrac.size) ? wszyscy.filter(p => TRM.filtrPrac.has(p)) : wszyscy;
    if (!wszyscy.length) { main.innerHTML = `<div class="trm-empty"><div class="big">👩‍⚕️</div><p>Salon nie ma jeszcze pracowników (Administracja → Pracownicy).</p></div>`; return; }
    if (!prac.length) { main.innerHTML = `<div class="trm-empty"><p>Filtr nie pasuje do żadnej osoby. <button class="trm-btn link sm" onclick="TRM.filtrWyczysc()">Wyczyść filtry</button></p></div>`; return; }
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
    <div class="trm-legenda"><span style="--c:#fff;border:1px solid #E6DBD5">dostępność</span><span style="--c:#efe6dd">poza grafikiem / blokada</span>${operacyjna() ? '<span class="muted">Kliknij wolne pole, żeby dodać wizytę</span>' : ''}</div>
    ${legendaKategorii(d.rezerwacje)}`;
    main.innerHTML = html;
    liniaTeraz(zak);
    nowaRysujPropozycje();
    if (TRM.panel === 'szczegoly' && TRM.szcz) renderSzczegoly();
  }

  // ── widok ZASOBY (E04) ────────────────────────────────────────────────
  TRM.zasTypZmien = (t) => { TRM.zasTyp = t; renderZasoby(); };
  function renderZasoby() {
    const d = TRM.dzien, main = el('trm-main');
    const wszystkie = TRM.dane.zasoby.filter(z => z.aktywny && !z.zarchiwizowano);
    if (!wszystkie.length) { main.innerHTML = `<div class="trm-empty"><div class="big">🏠</div><p>Brak gabinetów i urządzeń. ${manager() ? 'Dodaj je w Ustawienia → Zasoby.' : ''}</p></div>`; return; }
    if (!TRM.zasTyp || !wszystkie.some(z => z.typ === TRM.zasTyp)) TRM.zasTyp = wszystkie.some(z => z.typ === 'gabinet') ? 'gabinet' : 'urzadzenie';
    const zas = wszystkie.filter(z => z.typ === TRM.zasTyp);
    const zak = TRM._zak = zakresGodzin(d.salon, d.rezerwacje);
    const przelacznik = `<div class="trm-row" style="margin-bottom:10px;justify-content:space-between"><div class="fix muted small">Widok: Zasoby</div><div class="trm-segment">
      ${['gabinet', 'urzadzenie'].map(t => `<button class="${TRM.zasTyp === t ? 'active' : ''}" onclick="TRM.zasTypZmien('${t}')">${t === 'gabinet' ? 'Gabinety' : 'Urządzenia'}</button>`).join('')}
    </div></div>`;
    if (!zas.length) { main.innerHTML = przelacznik + `<div class="trm-empty"><div class="big">🏠</div><p>Brak ${TRM.zasTyp === 'gabinet' ? 'gabinetów' : 'urządzeń'} tego typu.</p></div>`; return; }
    const html = przelacznik + `<div class="trm-grid"><div class="trm-grid-inner" style="grid-template-columns:58px repeat(${zas.length}, minmax(170px,1fr))">
      <div class="trm-col-h hours"></div>${zas.map(z => {
        const serwis = (d.nieobecnosci || []).find(n => Number(n.zasob_id) === Number(z.id) && n.typ === 'serwis' && n.od <= d.teraz && n.do >= d.teraz);
        return `<div class="trm-col-h"><div><div class="name">${z.typ === 'gabinet' ? '🏠' : '⚙️'} ${esc(z.nazwa)}</div><div class="hrs">${serwis ? pill(['Serwis do ' + hhmm(serwis.do), 'warn']) : pill(['Aktywne', 'ok'])}</div></div></div>`;
      }).join('')}
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
  const TRM_AG_HEAD = `<div class="trm-ag-head"><span>Godzina</span><span>Klientka i zabiegi</span><span>Pracownik</span><span>Status</span><span>Rozliczenie</span></div>`;
  function wierszAgendy(r) {
    const poz = r.pozycje.filter(p => p.stan !== 'anulowana');
    const u0 = usluga((poz[0] || r.pozycje[0] || {}).usluga_id);
    const anul = ['anulowana', 'odrzucona', 'wygasla'].includes(r.status);
    const pracownicy = [...new Set(r.pozycje.map(p => p.pracownik).filter(Boolean))];
    const prac = pracownicy.length === 1 ? `${avatarHtml(pracownicy[0], true)}<span>${esc(pracownicy[0])}</span>`
      : pracownicy.length ? `<span class="muted small">${pracownicy.map(esc).join(', ')}</span>` : '<span class="muted small">—</span>';
    const uslugi = r.pozycje.map(p => `${esc(p.kategoria)}${p.wariant ? ' · ' + esc(p.wariant) : ''}${pracownicy.length > 1 ? ' — ' + esc(p.pracownik) : ''}`).join(' + ');
    return `<div class="trm-ag-row" style="--kat:${kolorKat(u0)};${anul ? 'opacity:.5' : ''}" onclick="TRM.otworzSzczegoly(${r.id})">
      <div class="t">${hhmm(r.start)}–${hhmm(r.koniec)}</div>
      <div><div class="k">${esc(r.klient_nazwa)}${znakNotatki(r)}</div><div class="u">${uslugi}</div>${chipsyPreferencji(r, 4)}${notatkaTekst(r) ? `<div class="trm-ag-notatka">${esc(notatkaTekst(r))}</div>` : ''}</div>
      <div class="trm-ag-prac">${prac}</div>
      <div class="trm-ag-status">${pill(ST_LABEL[r.status])}${r.obecnosc !== 'oczekiwana' ? pill(OB_LABEL[r.obecnosc]) : ''}${r.wykonanie !== 'zaplanowana' ? pill(WYK_LABEL[r.wykonanie]) : ''}</div>
      <div class="trm-ag-rozl">${!operacyjna() ? '<span class="muted small">brak uprawnień</span>' : anul ? '<span class="muted small">nie dotyczy</span>' : (r.pozycje.some(p => p.zakup_skladnik_id) ? '<span class="trm-pill pakiet">Z pakietu</span> ' : '') + (r.wykonanie === 'wykonana' || r.wykonanie === 'czesciowo' ? (r.sprzedaz_id ? pill(['Rozliczona', 'ok']) : pill(['Do rozliczenia', 'warn'])) : !r.id_klienta ? '<span class="muted small">bez kartoteki</span>' : r.pozycje.some(p => p.zakup_skladnik_id) ? '' : '<span class="muted small">pojedynczy zabieg</span>')}</div>
    </div>`;
  }
  // ─── HISTORIA (2026-10-19) ──────────────────────────────────────────────────────────────────
  // Dwa spojrzenia na te same dane: historia jednej klientki (co, kiedy, u kogo) i historia
  // jednej osoby z zespołu (kogo obsługiwała, jakie zabiegi) w wybranym zakresie dat.
  // Dane biorą się z gotowych akcji tylko do odczytu — ten widok niczego nie zapisuje.
  TRM.hist = { tryb: 'klientka', od: null, do: null, klient: null, fraza: '', wyniki: [], pracownik: null, dane: null, laduje: false };

  // Zakres sięga też W PRZÓD (21.10.2026, prośba właściciela): historia ma pokazywać nie tylko to,
  // co się odbyło, ale i to, co klientka ma umówione. Przy zakresie kończącym się „dzisiaj"
  // zaplanowane wizyty były niewidoczne, więc pytanie „kiedy ma następną?" wymagało drugiego ekranu.
  const HIST_PRZOD_DNI = 90;   // serwer przyjmuje zakres do 400 dni — 300 wstecz + 90 w przód mieści się z zapasem
  const histDomyslnyZakres = () => {
    const dzis = TRM.data || new Date().toISOString().slice(0, 10);
    return { od: dodajDni(dzis, -90), do: dodajDni(dzis, HIST_PRZOD_DNI) };
  };
  TRM.histZakres = (dni) => {
    const dzis = TRM.data || new Date().toISOString().slice(0, 10);
    TRM.hist.od = dni ? dodajDni(dzis, -dni) : TRM.hist.od;
    TRM.hist.do = dodajDni(dzis, HIST_PRZOD_DNI);
    histPobierz();
  };
  // Wejście z panelu wizyty: „Historia wizyt ↗" przy konkretnej klientce — bez szukania jej po nazwisku.
  // Imię i telefon bierzemy z otwartej wizyty, a nie z atrybutu onclick: nazwiska bywają z apostrofem
  // („O'Brien"), a cudzysłów w atrybucie HTML rozbijał wywołanie (złapane w próbie 21.10.2026).
  TRM.historiaKlientki = (id, nazwa, telefon) => {
    const dzis = TRM.data || new Date().toISOString().slice(0, 10);
    const zPanelu = (TRM.szcz && TRM.szcz.rez && String(TRM.szcz.rez.id_klienta) === String(id)) ? TRM.szcz.rez : null;
    TRM.panelZamknij();
    TRM.hist.tryb = 'klientka';
    TRM.hist.klient = {
      id_klienta: id,
      nazwa: nazwa || (zPanelu ? zPanelu.klient_nazwa : '') || '',
      telefon: telefon || (zPanelu ? zPanelu.klient_telefon : '') || '',
    };
    TRM.hist.wyniki = []; TRM.hist.fraza = ''; TRM.hist.dane = null; TRM.hist.blad = null;
    TRM.hist.od = dodajDni(dzis, -300); TRM.hist.do = dodajDni(dzis, HIST_PRZOD_DNI);
    TRM.widokZmien('historia');
    histPobierz();
  };
  TRM.histTryb = (t) => { TRM.hist.tryb = t; TRM.hist.dane = null; renderHistoria(); if ((t === 'pracownik' && TRM.hist.pracownik) || (t === 'klientka' && TRM.hist.klient)) histPobierz(); };
  TRM.histPole = (co, v) => { TRM.hist[co] = v; };
  TRM.histSzukaj = (v) => {
    TRM.hist.fraza = v;
    clearTimeout(TRM.hist._t);
    TRM.hist._t = setTimeout(async () => {
      if (!v || v.trim().length < 2) { TRM.hist.wyniki = []; return renderHistoria(); }
      const d = await api('trm_szukaj_klienta', { fraza: v });
      TRM.hist.wyniki = d.klienci || []; renderHistoria();
    }, 250);
  };
  TRM.histKlient = (i) => { TRM.hist.klient = TRM.hist.wyniki[i] || null; TRM.hist.wyniki = []; TRM.hist.fraza = ''; histPobierz(); };
  TRM.histPracownik = (v) => { TRM.hist.pracownik = v || null; histPobierz(); };

  async function histPobierz() {
    const h = TRM.hist;
    if (!h.od || !h.do) { const z = histDomyslnyZakres(); h.od = h.od || z.od; h.do = h.do || z.do; }
    if (h.tryb === 'klientka' && !h.klient) return renderHistoria();
    if (h.tryb === 'pracownik' && !h.pracownik && operacyjna()) return renderHistoria();
    h.laduje = true; renderHistoria();
    const d = h.tryb === 'klientka'
      ? await api('trm_historia_klientki', { id_klienta: h.klient.id_klienta, klient_nazwa: h.klient.nazwa, od: h.od, do: h.do })
      : await api('trm_historia_pracownika', { osoba: h.pracownik, od: h.od, do: h.do });
    h.laduje = false;
    if (d.status !== 'success') { h.dane = null; h.blad = d.message; } else { h.dane = d; h.blad = null; }
    renderHistoria();
  }

  const histKafel = (etykieta, wartosc, kolor) => `
    <div class="trm-hist-kafel"><div class="w" ${kolor ? `style="color:${kolor}"` : ''}>${wartosc}</div><div class="e">${etykieta}</div></div>`;

  function renderHistoria() {
    const main = el('trm-main'); if (!main) return;
    const h = TRM.hist;
    if (!h.od || !h.do) { const z = histDomyslnyZakres(); h.od = z.od; h.do = z.do; }
    if (!operacyjna() && h.tryb !== 'pracownik') h.tryb = 'pracownik';   // specjalista widzi tylko własną historię

    const zakres = `
      <div class="trm-hist-pasek">
        <div class="trm-segment">
          ${operacyjna() ? `<button type="button" class="${h.tryb === 'klientka' ? 'active' : ''}" onclick="TRM.histTryb('klientka')">Klientka</button>` : ''}
          <button type="button" class="${h.tryb === 'pracownik' ? 'active' : ''}" onclick="TRM.histTryb('pracownik')">${operacyjna() ? 'Pracownik' : 'Moja historia'}</button>
        </div>
        <div class="trm-hist-daty">
          <label>Od</label><input type="date" value="${h.od}" onchange="TRM.histPole('od', this.value)">
          <label>do</label><input type="date" value="${h.do}" onchange="TRM.histPole('do', this.value)">
          <button class="trm-btn sm" onclick="TRM.histZakres(0)">Pokaż</button>
          <span class="trm-hist-szybkie">
            <button class="trm-btn link sm" onclick="TRM.histZakres(30)">30 dni</button>
            <button class="trm-btn link sm" onclick="TRM.histZakres(90)">3 miesiące</button>
            <button class="trm-btn link sm" onclick="TRM.histZakres(365)">rok</button>
          </span>
        </div>
      </div>`;

    let wybor = '';
    if (h.tryb === 'klientka') {
      wybor = h.klient
        ? `<div class="trm-wybrana"><b>${esc(h.klient.nazwa)}</b> <span class="muted small">· ${esc(h.klient.telefon || 'brak telefonu')} · ID ${esc(h.klient.id_klienta || '—')}</span>
             <button class="trm-btn link sm" onclick="TRM.hist.klient=null; TRM.hist.dane=null; TRM.histTryb('klientka')">zmień</button></div>`
        : `<div class="trm-card"><label>Klientka</label>
             <input placeholder="Nazwisko, telefon albo ID klientki…" value="${esc(h.fraza)}" oninput="TRM.histSzukaj(this.value)" autocomplete="off">
             ${h.wyniki.length ? `<div class="trm-hist-wyniki">${h.wyniki.map((k, i) => `<button type="button" class="trm-klient-karta" onclick="TRM.histKlient(${i})"><b>${esc(k.nazwa)}</b> <span class="m">· ${esc(k.telefon || 'brak tel.')} · ID ${esc(k.id_klienta)}</span></button>`).join('')}</div>` : ''}
           </div>`;
    } else if (operacyjna()) {
      const lista = (TRM.dane.pracownicy || []);
      wybor = `<div class="trm-card"><label>Pracownik</label>
          <select onchange="TRM.histPracownik(this.value)"><option value="">— wybierz osobę —</option>
            ${lista.map(p => `<option ${h.pracownik === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>`;
    }

    let tresc = '';
    if (h.laduje) tresc = `<div class="trm-empty"><div class="big">⏳</div><p>Pobieramy historię…</p></div>`;
    else if (h.blad) tresc = `<div class="trm-note bad">${esc(h.blad)}</div>`;
    else if (!h.dane) tresc = h.tryb === 'klientka'
      ? `<div class="trm-empty"><div class="big">🔎</div><p>Wybierz klientkę, żeby zobaczyć jej historię wizyt.</p></div>`
      : (operacyjna() ? `<div class="trm-empty"><div class="big">🔎</div><p>Wybierz osobę z zespołu i zakres dat.</p></div>` : '');
    else tresc = h.tryb === 'klientka' ? histKlientkaHtml(h.dane) : histPracownikHtml(h.dane);

    main.innerHTML = `<div class="trm-historia">${zakres}${wybor}${tresc}</div>`;
    if (!h.dane && h.tryb === 'pracownik' && !operacyjna()) histPobierz();   // specjalista: od razu własna historia
  }

  function histKlientkaHtml(d) {
    const p = d.podsumowanie;
    if (!d.wizyty.length) return `<div class="trm-empty"><div class="big">🗓️</div><p>Brak wizyt w tym zakresie.</p></div>`;
    const kafelki = `<div class="trm-hist-kafelki">
      ${histKafel('wizyt', p.wizyt)}
      ${histKafel('wykonanych', p.wykonane, '#15803d')}
      ${histKafel('odwołanych', p.odwolane, p.odwolane ? '#b45309' : '')}
      ${histKafel('nieobecności', p.nieobecnosci, p.nieobecnosci ? '#b91c1c' : '')}
      ${operacyjna() ? histKafel('wartość wykonanych', zl(p.wartosc)) : ''}
    </div>`;
    const listy = `<div class="trm-hist-listy">
      ${p.zabiegi.length ? `<div><div class="mini">Najczęstsze zabiegi</div>${p.zabiegi.map(x => `<div class="poz"><span>${esc(x.nazwa)}</span><b>${x.ile}×</b></div>`).join('')}</div>` : ''}
      ${p.osoby.length ? `<div><div class="mini">U kogo bywa</div>${p.osoby.map(x => `<div class="poz"><span>${esc(x.nazwa)}</span><b>${x.ile}×</b></div>`).join('')}</div>` : ''}
    </div>`;
    // Sortowanie od najnowszych do najstarszych (prośba właściciela 21.10.2026). Serwer już tak
    // oddaje dane, ale kolejność jest tu częścią umowy z użytkownikiem — pilnujemy jej na miejscu.
    const wizytyPosortowane = [...d.wizyty].sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const ETYKIETY = { wykonana: ['Odbyła się', 'ok'], planowana: ['Zaplanowana', 'info'], odwolana: ['Odwołana', 'warn'], nieobecna: ['Nieobecność', 'bad'] };
    const os = wizytyPosortowane.map(w => {
      const anul = ['anulowana', 'odrzucona', 'wygasla'].includes(w.status);
      const klasa = anul ? 'odwolana' : (w.obecnosc === 'nieobecny' ? 'nieobecna' : (w.pozycje.some(x => x.stan === 'wykonana' || x.stan === 'przerwana') ? 'wykonana' : 'planowana'));
      const poz = w.pozycje.map(x => `
        <div class="trm-hist-poz">
          <span class="nazwa">${esc(x.kategoria)}${x.wariant ? ' · ' + esc(x.wariant) : ''}</span>
          <span class="kto">${esc(x.wykonawca || '—')}${x.wykonawca && x.pracownik && x.wykonawca !== x.pracownik ? ' <span class="muted">(zastępstwo za ' + esc(x.pracownik) + ')</span>' : ''}</span>
          <span class="stan">${POZ_LABEL[x.stan] || x.stan}${x.z_pakietu ? ' <span class="trm-pill pakiet">z pakietu</span>' : ''}</span>
          <span class="cena">${operacyjna() && x.cena != null ? zl(x.cena) : ''}</span>
        </div>`).join('');
      return `
        <div class="trm-hist-wizyta ${klasa}" onclick="TRM.otworzSzczegoly(${w.id})" title="Otwórz wizytę">
          <div class="glowa">
            <div class="data"><b>${ladnaData(w.start.slice(0, 10), true)}</b> <span class="muted">${w.start.slice(11, 16)}–${w.koniec.slice(11, 16)}</span>
              <span class="trm-pill ${ETYKIETY[klasa][1]}">${ETYKIETY[klasa][0]}</span></div>
            <div class="numer muted small">${esc(w.numer || '')}</div>
          </div>
          ${poz}
          ${anul && w.powod_anulacji ? `<div class="uwaga">Odwołane przez ${w.kto_anulowal === 'klient' ? 'klientkę' : 'salon'}: ${esc(w.powod_anulacji)}</div>` : ''}
          ${w.obecnosc === 'nieobecny' ? `<div class="uwaga">Klientka nie przyszła.</div>` : ''}
          ${w.notatka ? `<div class="notatka">${esc(w.notatka)}</div>` : ''}
        </div>`;
    }).join('');
    // Legenda: kolor i tło mają znaczyć zawsze to samo, a nie być ozdobą.
    const legenda = `<div class="trm-hist-legenda">
      <span class="poz"><i class="pr wykonana"></i>odbyła się</span>
      <span class="poz"><i class="pr planowana"></i>zaplanowana</span>
      <span class="poz"><i class="pr odwolana"></i>odwołana</span>
      <span class="poz"><i class="pr nieobecna"></i>nieobecność</span>
      <span class="muted">najnowsze na górze · zakres obejmuje też wizyty zaplanowane</span>
    </div>`;
    return `${kafelki}${listy}${legenda}<div class="trm-hist-os">${os}</div>`;
  }

  function histPracownikHtml(d) {
    const p = d.podsumowanie;
    if (!d.dni.length) return `<div class="trm-empty"><div class="big">🗓️</div><p>Brak wizyt w tym zakresie.</p></div>`;
    const godziny = Math.floor(p.minuty / 60), minuty = p.minuty % 60;
    const kafelki = `<div class="trm-hist-kafelki">
      ${histKafel('wykonanych zabiegów', p.wykonane, '#15803d')}
      ${histKafel('klientek', p.klientek)}
      ${histKafel('czas przy pracy', godziny + ' h' + (minuty ? ' ' + minuty + ' min' : ''))}
      ${histKafel('odwołanych', p.odwolane, p.odwolane ? '#b45309' : '')}
      ${histKafel('nieobecności', p.nieobecnosci, p.nieobecnosci ? '#b91c1c' : '')}
      ${p.wartosc != null ? histKafel('wartość wykonanych', zl(p.wartosc)) : ''}
    </div>`;
    const zabiegi = p.zabiegi.length ? `<div class="trm-hist-listy"><div><div class="mini">Co robi najczęściej</div>${p.zabiegi.map(x => `<div class="poz"><span>${esc(x.nazwa)}</span><b>${x.ile}×</b></div>`).join('')}</div></div>` : '';
    const dni = d.dni.map(dz => `
      <div class="trm-hist-dzien">
        <div class="naglowek">${ladnaData(dz.dzien, true)} <span class="muted small">· ${dz.wizyty.length} ${dz.wizyty.length === 1 ? 'pozycja' : (dz.wizyty.length < 5 ? 'pozycje' : 'pozycji')}</span></div>
        ${dz.wizyty.map(w => `
          <div class="trm-hist-poz klik" onclick="TRM.otworzSzczegoly(${w.id})" title="Otwórz wizytę">
            <span class="godz">${esc(w.godzina)}</span>
            <span class="nazwa">${esc(w.klient || '—')}</span>
            <span class="kto">${esc(w.kategoria)}${w.wariant ? ' · ' + esc(w.wariant) : ''}${w.zastepstwo ? ' <span class="muted">(zastępstwo)</span>' : ''}</span>
            <span class="stan">${POZ_LABEL[w.stan] || w.stan}${w.z_pakietu ? ' <span class="trm-pill pakiet">z pakietu</span>' : ''}</span>
            <span class="cena">${w.cena != null ? zl(w.cena) : ''}</span>
          </div>`).join('')}
      </div>`).join('');
    return `${kafelki}${zabiegi}<div class="trm-hist-dni">${dni}</div>`;
  }

  function renderAgenda(od, do_) {
    const main = el('trm-main'), rez = TRM.zakres.rezerwacje;
    let html = `<div class="trm-row" style="margin-bottom:10px"><div class="fix"><label>Osoba</label><select onchange="TRM.osoba=this.value||null;TRM.widokZmien('agenda')" style="width:auto"><option value="">Cały zespół</option>${TRM.dane.pracownicy.map(p => `<option ${p === TRM.osoba ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div><div class="fix muted small">${rez.length} wizyt · każda pozycja otwiera tę samą wizytę</div></div>`;
    if (!rez.length) html += `<div class="trm-empty"><div class="big">🗓️</div><p>Brak wizyt w tym zakresie.</p></div>`;
    else html += TRM_AG_HEAD;
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
    main.innerHTML = (TRM.widok === 'moj' ? `<div class="trm-note info">Mój dzień — ${esc(kto())}. Rozpoczęcie i zakończenie usługi zapisujesz w szczegółach wizyty.</div>` : '') + (rez.length ? TRM_AG_HEAD + rez.map(wierszAgendy).join('') : `<div class="trm-empty"><div class="big">🗓️</div><p>Brak wizyt w tym dniu.</p></div>`);
  }

  // ── PANEL: pokaż / schowaj ─────────────────────────────────────────────
  // C08: panel ma własne przewijanie, a jego stopka („Umów wizytę”) ma być widoczna bez przewijania całej strony.
  // CSS zakłada panel od 12 px od góry, ale w Estelio zaczyna się niżej (nagłówek hosta + nagłówek terminarza) —
  // dopasowujemy max-height do faktycznego położenia, przy otwarciu i przy zmianie rozmiaru okna.
  function trmDopasujPanel() { const p = el('trm-panel'); if (!p || p.hidden) return; p.style.maxHeight = ''; if (getComputedStyle(p).position === 'fixed') return; /* wąski lub niski ekran: panel jest nakładką (CSS) */ const top = p.getBoundingClientRect().top; if (top > 12) p.style.maxHeight = Math.max(260, window.innerHeight - top - 12) + 'px'; }
  window.addEventListener('resize', () => trmDopasujPanel());
  // D02: gdy sekcja terminarza jest aktywna, body dostaje klasę trm-aktywny — terminarz.css odsuwa wtedy pływający widget
  // pomocy i toasty hosta (#est-help-widget, #boczki-toasts) z prawego dolnego rogu, gdzie stoi stopka panelu.
  const trmOznaczAktywny = () => { const s = el('terminarz'); const akt = !!(s && s.classList.contains('active')); document.body.classList.toggle('trm-aktywny', akt); if (!akt) document.body.classList.remove('trm-panel-otwarty', 'trm-pomoc-otwarta'); };
  (function () { const s = el('terminarz'); if (s && window.MutationObserver) new MutationObserver(trmOznaczAktywny).observe(s, { attributes: true, attributeFilter: ['class'] }); trmOznaczAktywny(); })();
  function panelOtworz(html) {
    const p = el('trm-panel'), b = el('trm-body'); if (!p) return; p.innerHTML = html; p.hidden = false; b.classList.add('z-panelem'); document.body.classList.add('trm-panel-otwarty'); trmDopasujPanel(); trmOznaczAktywny();
    // D04: wizyta otwarta ze sprawy ma drogę powrotu do tej sprawy (kontekst listy zostaje w TRM.sprawy)
    if (TRM.panel === 'szczegoly' && TRM.szcz && TRM.szcz.powrotSprawa) { const head = p.querySelector('.trm-panel-head'); if (head) head.insertAdjacentHTML('afterend', `<button class="trm-btn link sm" onclick="TRM.otworzSprawe(${TRM.szcz.powrotSprawa})">← wróć do sprawy</button>`); }
  }
  TRM.panelZamknij = () => { document.querySelectorAll('.trm-propozycja, .trm-szkic').forEach(x => x.remove()); const p = el('trm-panel'), b = el('trm-body'); if (p) { p.hidden = true; p.innerHTML = ''; } if (b) b.classList.remove('z-panelem'); document.body.classList.remove('trm-panel-otwarty', 'trm-pomoc-otwarta'); TRM.panel = null; TRM.szcz = null; TRM.nowa = null; document.querySelectorAll('.trm-karta.akt').forEach(k => k.classList.remove('akt')); };
  // E01: pomoc (Esti) jako mała akcja nagłówka panelu — pływający widget hosta jest schowany, dopóki panel jest otwarty (CSS: body.trm-panel-otwarty)
  const naglowekPanelu = (tytul, sub) => `<div class="trm-panel-head"><div><h2>${tytul}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div><div class="trm-row" style="gap:6px"><button class="trm-x trm-pomoc-btn" onclick="TRM.pomocOtworz()" title="Pomoc (Esti)" aria-label="Pomoc">?</button><button class="trm-x" onclick="TRM.panelZamknij()" title="Zamknij" aria-label="Zamknij">✕</button></div></div>`;
  TRM.pomocOtworz = () => { document.body.classList.add('trm-pomoc-otwarta'); const btn = document.getElementById('est-help-btn'), pan = document.getElementById('est-help-panel'); if (btn && pan && !pan.classList.contains('est-open')) btn.click(); };
  (function () { const pan = document.getElementById('est-help-panel'); if (pan && window.MutationObserver) new MutationObserver(() => { if (!pan.classList.contains('est-open')) document.body.classList.remove('trm-pomoc-otwarta'); }).observe(pan, { attributes: true, attributeFilter: ['class'] }); })();

  // ── NOWA WIZYTA (E05/E06) ──────────────────────────────────────────────
  TRM.nowaWizyta = (opcje) => {
    if (!operacyjna()) return;
    const o = opcje || {};
    // C01: otwarty szkic z wpisanymi danymi nie jest kasowany przez kliknięcie siatki — przejmuje tylko wskazany termin/osobę
    const szkic = TRM.nowa;
    if (szkic && o.start && (szkic.klient || szkic.pozycje.length || szkic.notatka)) {
      szkic.start = o.start; szkic.dataReczna = true; if (o.pracownik) szkic.prefPrac = o.pracownik;
      nowaResetDostep(szkic); renderNowa(); if (nowaNaTerminie(szkic)) { nowaLadujSloty(); TRM.nowaZmiana(true); }
      toast('info', 'Szkic zachowany', `Termin zmieniony na ${o.start.slice(11, 16)}${o.pracownik ? ' · ' + o.pracownik : ''}`); return;
    }
    // D03: z przycisku „Nowa wizyta” nie zgadujemy godziny (dawniej „aktualna+1”, wieczorem 20:00 poza grafikiem → czerwony błąd na start);
    // data = kontekst kalendarza, godzinę wybiera użytkownik (slot lub pole). Z pustej komórki siatki godzina jest wskazana.
    const start = o.start || `${TRM.data} 00:00`;
    // dataReczna: użytkownik świadomie wpisał datę w formularzu — wtedy nawigacja kalendarza jej nie nadpisuje (raport T01)
    TRM.nowa = { idem: uuid(), klient: null, fraza: '', wyniki: [], pozycje: [], start, kanal: 'recepcja', notatka: '', wynik: null, zapis: false, filtrUsl: '', szybka: !!o.start, godzina: !!o.start, krok: 1, dataReczna: !!o.start, dostep: null, sloty: null, req: 0, prefPrac: o.pracownik || '' };
    if (o.pracownik) TRM.nowa.domyslny = o.pracownik;
    TRM.panel = 'nowa';
    renderNowa();
    setTimeout(() => { const i = el('trm-k-fraza'); if (i) i.focus(); }, 50);
  };
  function klientWynikiHtml(wyniki) {
    return wyniki.map((k, i) => `<button type="button" class="trm-klient-karta" onclick="TRM.nowaKlient(${i})"><b>${esc(k.nazwa)}</b> <span class="m">· ${esc(k.telefon || 'brak tel.')} · ID ${esc(k.id_klienta)}</span>${k.ostrzezenie ? ' <span class="trm-pill warn">⚠</span>' : ''}</button>`).join('');
  }
  function sekcjaKlientHtml(n) {
    // Przejście „to nie wizyta" bez chowania funkcji pod skrótem klawiaturowym: rezerwacja
    // techniczna jest normalnym elementem pracy salonu, więc stoi obok, z gotową godziną.
    return `${n.klient || n.pozycje.length ? '' : `<div class="trm-row" style="justify-content:flex-end;margin:-4px 0 6px"><button class="trm-btn link sm" onclick="TRM.blokadaNowa({ start: '${esc(n.start)}', osoba: '${esc(n.prefPrac || n.domyslny || '')}' })">To nie wizyta — zarezerwuj czas technicznie</button></div>`}
      <div class="trm-field"><label>Klientka</label>
      ${n.klient ? `<div class="trm-wybrana"><b>${esc(n.klient.nazwa)}</b> <span class="muted small">· ${esc(n.klient.telefon || 'brak telefonu')} · ID ${esc(n.klient.id_klienta)}</span> <button class="trm-btn link sm" onclick="TRM.nowaKlient(null)">zmień</button>${n.klient.ostrzezenie ? `<div class="trm-note warn small">⚠ ${esc(n.klient.ostrzezenie)}</div>` : ''}</div>`
      : `<input id="trm-k-fraza" placeholder="Nazwisko, telefon albo ID klientki…" value="${esc(n.fraza)}" oninput="TRM.nowaSzukaj(this.value)" autocomplete="off">
         <div class="trm-wyniki-klient" id="trm-k-wyniki" ${n.wyniki.length ? '' : 'hidden'}>${klientWynikiHtml(n.wyniki)}</div>
         <div class="trm-row" style="margin-top:6px"><span class="muted small">Klientki zakłada się w module <b>Klienci</b> — tam są zgody, dokumenty i kontrola duplikatów. Tutaj tylko wyszukujesz istniejący profil.</span></div>`}
    </div>`;
  }
  // T02/T03: zakupy klientki na pierwszym planie kroku „Zabieg”; cennik jako „pojedynczy zabieg” (albo tylko informacja o Sprzedaży przy włączonej kontroli)
  const zakupyIntegracja = () => !!(TRM.dane && TRM.dane.ustawienia && TRM.dane.ustawienia.zakupy_integracja === 'on'); // sekcja 0 odbioru: UI zakupów tylko gdy właściciel włączył integrację
  async function nowaLadujZakupy() {
    if (!zakupyIntegracja()) return;
    const n = TRM.nowa; if (!n || !n.klient) { if (n) n.zakupy = null; return; }
    const req = n.reqZakupy = (n.reqZakupy || 0) + 1; n.zakupy = undefined; renderNowa();
    let d; try { d = await api('trm_zakupy_klientki', { id_klienta: n.klient.id_klienta, klient_nazwa: n.klient.nazwa }); } catch (e) { d = null; }
    if (TRM.nowa !== n || req !== n.reqZakupy) return;
    n.zakupy = d && d.status === 'success' ? d.zakupy : Object.assign([], { blad: true }); n.zakupyBezMapowania = d ? d.bez_mapowania : 0;
    renderNowa();
  }
  // Historia wybranych zabiegów u tej klientki (#12b). Jedno żądanie na zmianę wyboru, nie na zabieg.
  async function nowaLadujHistorie() {
    const n = TRM.nowa; if (!n) return;
    const kategorie = [...new Set(n.pozycje.map(p => { const u = usluga(p.usluga_id); return u ? u.kategoria : null; }).filter(Boolean))];
    if (!n.klient || !kategorie.length) { if (n.hist) { n.hist = null; renderNowa(); } return; }
    const req = n.reqHist = (n.reqHist || 0) + 1;
    let d; try { d = await api('trm_pierwsza_wizyta', { id_klienta: n.klient.id_klienta, kategorie }); } catch (e) { d = null; }
    if (TRM.nowa !== n || req !== n.reqHist) return;
    n.hist = d && d.status === 'success' ? d.historia : null;
    renderNowa();
  }
  TRM.nowaDodajZZakupu = (sklId) => {
    const n = TRM.nowa; if (!n || !n.zakupy) return;
    let z = null, s = null; n.zakupy.forEach(x => x.skladniki.forEach(y => { if (y.id === sklId) { z = x; s = y; } })); if (!s) return;
    const u = usluga(s.usluga_wyk_id); if (!u || !u.skonfigurowana || !u.aktywna) return toast('warning', 'Usługa z zakupu nie jest gotowa do umawiania', 'Ustaw czas trwania w Ustawieniach → Usługi.');
    const juz = n.pozycje.filter(p => p.zakup_skladnik_id === sklId).length;
    if (s.wolne - juz <= 0) return toast('warning', 'Brak wolnych jednostek w tym zakupie');
    // Z8: po terminie ważności umawiamy, ale recepcja ma to zobaczyć, nie przeoczyć.
    if (s.po_terminie || (z.data_waznosci && z.data_waznosci < n.start.slice(0, 10))) toast('warning', 'Ten zabieg z pakietu jest po terminie', s.ostrzezenie || `Pakiet „${z.nazwa}” był ważny do ${z.data_waznosci}. Umawiamy mimo to — potwierdź z klientką.`);
    const pref = n.prefPrac || n.domyslny;
    n.pozycje.push({ usluga_id: u.id, pracownik: pref && (!u.pracownicy || !u.pracownicy.length || u.pracownicy.includes(pref)) ? pref : null, czas_min: u.czas_min, zakup_skladnik_id: sklId, zakup_nazwa: z.nazwa });
    nowaResetDostep(n); renderNowa(); if (nowaNaTerminie(n)) { nowaLadujSloty(); TRM.nowaZmiana(); }
  };
  TRM.nowaBilans = (zakupId) => { // ZK-03: stan pakietu sprawdza się per składnik w Ustawieniach → Pakiety i zakupy → „Sprawdź stan pakietów” (nie w kreatorze)
    TRM.ust = TRM.ust || {}; TRM.ust.tab = 'pakiety'; TRM.ust.pz = TRM.ust.pz || {}; TRM.ust.pz.tab = 'stan'; TRM.ust.pz.stanFiltrZakup = zakupId; TRM.ust.pz.stan = null;
    TRM.panelZamknij(); TRM.widokZmien('ustawienia');
  };
  function zakupyKlientkiHtml(n) {
    if (!zakupyIntegracja()) return '';
    const kontrola = TRM.dane.ustawienia && TRM.dane.ustawienia.kontrola_zakupow === 'on';
    if (!n.klient) return kontrola ? '<div class="trm-pomoc">Najpierw wybierz klientkę — pokażemy jej zakupy.</div>' : '';
    if (n.zakupy === undefined) return '<div class="muted small">⏳ Sprawdzamy zakupy klientki…</div>';
    if (n.zakupy && n.zakupy.blad) return '<div class="trm-note warn small">Nie udało się pobrać zakupów klientki. <button class="trm-btn link sm" onclick="TRM.nowaOdswiezZakupy()">Spróbuj ponownie</button></div>';
    const lista = n.zakupy || [];
    const dzis = dzisStr(), dzien = n.start.slice(0, 10);
    const bez = n.zakupyBezMapowania ? `<div class="trm-pomoc">${n.zakupyBezMapowania} ${n.zakupyBezMapowania === 1 ? 'zakup klientki wymaga' : 'zakupy klientki wymagają'} konfiguracji pakietu (Ustawienia → Pakiety i zakupy).</div>` : '';
    if (!lista.length) return `<div class="trm-field"><label>Zakupy klientki</label><div class="trm-note ${kontrola ? 'warn' : 'info'} small">Brak zakupów z wolnymi jednostkami.${kontrola ? ' Kontrola zakupów jest włączona — nowy zakup zarejestruj w Sprzedaży, potem wróć do umawiania.' : ' Możesz umówić pojedynczy zabieg z cennika poniżej.'}</div>${bez}</div>`;
    return `<div class="trm-field"><label>Zakupy klientki</label>${lista.map(z => {
      const wygasly = z.data_waznosci && z.data_waznosci < dzien, zamkniety = z.stan !== 'aktywny';
      return `<div class="trm-zakup ${wygasly ? 'wygasly' : ''} ${zamkniety ? 'zamkniety' : ''}"><div class="trm-row"><div><div class="n">${esc(z.nazwa)}</div><div class="m">zakup ${esc(z.data_zakupu || '—')}${z.data_waznosci ? ` · ważny do ${esc(z.data_waznosci)}${wygasly ? ' (wygasł)' : ''}` : ' · bezterminowo'}${zamkniety ? ' · zamknięty' : ''}${z.bilans_status === 'niezweryfikowany' ? ' · <span class="trm-pill warn">do sprawdzenia</span>' : ''}${z.stan_zrodla && z.stan_zrodla !== 'ok' ? ' · <span class="trm-pill bad">wymaga wyjaśnienia</span>' : ''}</div></div>${manager() ? `<button class="trm-btn link sm fix" onclick="TRM.nowaBilans(${z.id})">Sprawdź stan pakietu</button>` : ''}</div>
        ${z.skladniki.map(s => { const juz = n.pozycje.filter(p => p.zakup_skladnik_id === s.id).length; const wolneTeraz = s.wolne - juz; const u = usluga(s.usluga_wyk_id); // Z8 (zasada salonu): zabieg po terminie ważności WOLNO umówić — nie blokujemy, pokazujemy ostrzeżenie z serwera.
          const poTerminie = !!s.po_terminie || wygasly; const ostrzTekst = s.ostrzezenie || (poTerminie && z.data_waznosci ? `Ten zabieg z pakietu jest już po terminie — pakiet był ważny do ${z.data_waznosci}.` : '');
          const moge = !zamkniety && wolneTeraz > 0 && u && u.skonfigurowana && u.aktywna; const powod = zamkniety ? 'zakup zamknięty' : wolneTeraz <= 0 ? 'brak wolnych jednostek' : !u || !u.skonfigurowana ? 'usługa bez czasu trwania (Ustawienia → Usługi)' : !u.aktywna ? 'usługa wyłączona w terminarzu' : '';
          return `<div class="trm-zakup-skl"><span style="flex:1;min-width:140px"><b>${esc(s.usluga_nazwa)}</b></span><span class="saldo"><span title="wykorzystane">Wykorzystano ${s.wykonane}</span><span title="umówione">Umówione ${s.zaplanowane + juz}</span>${s.stan_weryfikacji && s.stan_weryfikacji !== 'zweryfikowany' ? '<span class="zero">Do sprawdzenia</span>' : `<span class="${wolneTeraz > 0 ? 'wolne' : 'zero'}">Do umówienia ${Math.max(0, wolneTeraz)}</span>`}</span><button class="trm-btn sm ${moge ? 'primary' : ''}" ${moge ? '' : 'disabled'} title="${esc(powod || ostrzTekst)}" onclick="TRM.nowaDodajZZakupu(${s.id})">${moge ? (poTerminie ? 'Umów mimo terminu' : 'Umów z tego zakupu') : esc(powod || 'niedostępne')}</button></div>${moge && poTerminie ? `<div class="trm-note warn small po-terminie">⏳ ${esc(ostrzTekst)} Możesz umówić, ale potwierdź to z klientką.</div>` : ''}`; }).join('')}
      </div>`; }).join('')}${bez}</div>`;
  }
  TRM.nowaOdswiezZakupy = () => nowaLadujZakupy();
  // Zgłoszenie #12b: przy każdym zabiegu mówimy, czy klientka ma go po raz pierwszy. Liczone na żywo
  // na serwerze (wizyty wykonane + sprzedaż), więc po nieobecności oznaczenie samo wraca na kolejny termin.
  function historiaZabieguHtml(n, u) {
    if (!n.klient || !u || !n.hist) return '';
    const h = n.hist[u.kategoria];
    if (!h) return '';
    if (!h.ile) return `<div class="trm-hist-zab pierwsza">✦ Pierwsza wizyta na „${esc(u.kategoria)}" — klientka nie miała tego zabiegu ani w terminarzu, ani w sprzedaży.</div>`;
    return `<div class="trm-hist-zab">Była już ${h.ile}× na „${esc(u.kategoria)}"${h.ostatnia ? ' · ostatnio ' + esc(ladnaData(h.ostatnia, true)) : ''}</div>`;
  }

  function sekcjaUslugiHtml(n, lista) {
    const skonf = TRM.dane.uslugi.filter(u => u.skonfigurowana && u.aktywna);
    const kontrola = TRM.dane.ustawienia && TRM.dane.ustawienia.kontrola_zakupow === 'on';
    return `<div class="trm-field"><label>Usługi i wykonawcy</label>
      ${n.pozycje.map((p, i) => { const u = usluga(p.usluga_id); return `<div class="trm-wybrana"><div class="trm-row"><b>${esc(nazwaUslugi(u))}</b>${p.zakup_skladnik_id ? `<span class="trm-pill pakiet fix">Z pakietu${p.zakup_nazwa ? ': ' + esc(p.zakup_nazwa) : ''}</span>` : ''}<span class="fix muted small">${u.cena != null && !p.zakup_skladnik_id ? zl(u.cena) : ''}</span><button class="trm-btn link sm fix" onclick="TRM.nowaUsunPoz(${i})">usuń</button></div>
        <div class="r"><select onchange="TRM.nowa.pozycje[${i}].pracownik=this.value||null;TRM.nowaUniewaznij()"><option value="">Dowolna właściwa osoba</option>${(u.pracownicy && u.pracownicy.length ? u.pracownicy : TRM.dane.pracownicy).map(x => `<option ${p.pracownik === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <input type="number" min="5" max="480" step="5" value="${p.czas_min}" title="Czas (min) — dziś krócej/dłużej" onchange="TRM.nowa.pozycje[${i}].czas_min=Number(this.value)||${u.czas_min};TRM.nowaUniewaznij()"><span class="muted small">min</span></div>${historiaZabieguHtml(n, u)}</div>`; }).join('')}
    </div>
    ${zakupyKlientkiHtml(n)}
    ${kontrola ? (n.klient ? `<div class="trm-pomoc">Nowy zakup (pojedynczy zabieg lub pakiet) zarejestruj w <b>Sprzedaży</b> — po zapisaniu pojawi się tutaj.</div>` : '') : `<div class="trm-field"><label>Pojedynczy zabieg z cennika</label>
      <input placeholder="Szukaj usługi w cenniku…" value="${esc(n.filtrUsl)}" oninput="TRM.nowa.filtrUsl=this.value;TRM.renderNowaUslugi()">
      <div class="trm-usl-lista" id="trm-usl-lista">${listaUslugHtml(lista)}</div>
      ${!skonf.length ? `<div class="trm-note warn small">Żadna usługa nie ma jeszcze czasu trwania. ${manager() ? 'Ustaw go w Ustawienia → Usługi.' : 'Poproś managera o konfigurację usług w terminarzu.'}</div>` : ''}
    </div>`}`;
  }
  // Krok 3 (raport T01/T04): data zawsze jawna, wolne godziny jako przyciski, dostępność sprawdzana automatycznie
  // po każdej istotnej zmianie (bez ręcznego „Sprawdź komplet”), 4 stany: czekam / ok / zajęty / błąd.
  // Zgłoszenie #10 (Gosia, recepcja, 20.10.2026): „jest w dwóch miejscach wykonawca, nie rozumiem
  // dlaczego — Julia wykona usługę, a wykonawca to Dominika". Pole niżej NIE jest wykonawcą wizyty,
  // tylko ustawieniem hurtowym: wstawia wybraną osobę przy każdym zabiegu, ale wyłącznie tam, gdzie
  // wolno jej go wykonywać (lista „Kto wykonuje zabieg?" przy usłudze). Przy pozostałych zabiegach
  // po cichu wracało „ktokolwiek" i silnik dobierał kogo innego — a w polu dalej widniała wybrana
  // osoba. Stąd wrażenie dwóch wykonawców. Teraz mówimy to wprost, zamiast kazać się domyślać.
  function uslugiPozaZasiegiem(n) {
    if (!n.prefPrac) return [];
    const nazwy = n.pozycje
      .filter(p => { const u = usluga(p.usluga_id); return u && u.pracownicy && u.pracownicy.length && !u.pracownicy.includes(n.prefPrac); })
      .map(p => nazwaUslugi(usluga(p.usluga_id)));
    return [...new Set(nazwy)];
  }

  // Komunikat pod polem: co się naprawdę stanie z wyborem. Manager dostaje skrót do przypisania
  // osoby do usługi, recepcja — zdanie, kogo o to poprosić (sama tego nie zmieni).
  function prefOstrzezenieHtml(n) {
    const zle = uslugiPozaZasiegiem(n);
    if (!zle.length) return '';
    const kto = esc(n.prefPrac);
    const lista = esc(zle.join(', '));
    const pierwsza = n.pozycje.find(p => { const u = usluga(p.usluga_id); return u && u.pracownicy && u.pracownicy.length && !u.pracownicy.includes(n.prefPrac); });
    const link = manager() && pierwsza
      ? ` <button class="trm-btn link sm" onclick="TRM.panelZamknij();TRM.ust.tab='uslugi';TRM.ust.uslWybrana='${esc(String(pierwsza.usluga_id)).replace(/'/g, "\\'")}';TRM.widokZmien('ustawienia')">Przypisz ${kto} do tego zabiegu →</button>`
      : ' <span class="muted">Przypisanie osoby do zabiegu ustawia manager w Ustawieniach → Usługi.</span>';
    return `<div class="trm-pref-uwaga">⚠ <b>${kto}</b> nie wykonuje ${zle.length === 1 ? 'zabiegu' : 'zabiegów'}: <b>${lista}</b>.
      Ten ${zle.length === 1 ? 'zabieg wykona' : 'zabiegi wykona'} osoba dobrana automatycznie — zobaczysz ją niżej, po wybraniu godziny.${link}</div>`;
  }

  function sekcjaTerminuHtml(n) {
    const prac = TRM.dane.pracownicy;
    const dost = n.dostep || {}, st = dost.stan;
    const nazwaZasobu = (id, dom) => esc((zasob(id) || {}).nazwa || dom);
    // R03: jedna wyróżniona karta wyniku — duża godzina, wykonawca, gabinet/urządzenie, status; nic nie jest zapisane
    let wynikHtml2 = '';
    if (n.pozycje.length) {
      if (st === 'ok' && dost.wynik) wynikHtml2 = `<div class="trm-wynik-termin ok"><div class="godz">${hhmm(dost.wynik.start)}–${hhmm(dost.wynik.koniec)}</div><div class="st">✓ Termin dostępny${dost.wynik.przerwy_min ? ` · w tym ${dost.wynik.przerwy_min} min przerwy` : ''} · ${esc(ladnaData(n.start.slice(0, 10), true))}</div>
        ${dost.wynik.pozycje.map(p => `<div class="seg"><span>${hhmm(p.start)}–${hhmm(p.koniec)}</span><span><b>${esc(p.nazwa)}</b> — ${esc(p.pracownik)}</span><span class="m">${p.gabinet_id ? nazwaZasobu(p.gabinet_id, 'gabinet') : 'bez gabinetu'}${p.urzadzenie_id ? ' · ' + nazwaZasobu(p.urzadzenie_id, 'urządzenie') : ''}</span></div>`).join('')}
        <div class="m" style="margin-top:8px;font-size:12.5px;color:var(--t-mut)">${n.pozycje.some(p => p.zakup_skladnik_id) ? `Rozliczenie: z zakupu klientki — przy zapisie zarezerwujemy ${n.pozycje.filter(p => p.zakup_skladnik_id).length === 1 ? '1 zabieg' : n.pozycje.filter(p => p.zakup_skladnik_id).length + ' zabiegi'} z pakietu${n.pozycje.some(p => !p.zakup_skladnik_id) ? '; pozostałe po wykonaniu, w Sprzedaży' : ''}.` : 'Rozliczenie: po wykonaniu, w Sprzedaży.'}</div></div>`;
      else if (st === 'zajety' && dost.wynik) { // D03: „zajęty” = nakładanie wizyt/zasobów; „niedostępny” = poza grafikiem / brak wykonawcy; przy „dowolnym” mówimy o całym zespole
        const problemy = dost.wynik.problemy || [], kody = problemy.map(p => p.kod || '');
        const zajety = kody.some(k => /ZAJET/.test(k));
        const dowolny = !n.prefPrac && n.pozycje.some(p => !p.pracownik);
        const opis = problemy.map(p => (dowolny && p.kod === 'GRAFIK') ? `Nikt z dostępnych specjalistów nie pracuje o tej godzinie (${p.opis})` : p.opis).join('; ') || 'konflikt zasobów';
        wynikHtml2 = `<div class="trm-wynik-termin zajety"><div class="godz">${n.start.slice(11, 16)}</div><div class="st">✕ ${zajety ? 'Termin zajęty' : 'Termin niedostępny'}</div><div class="m" style="margin-top:6px">${esc(opis)}</div>${alternatywyHtml(dost.wynik.alternatywy, 'TRM.nowaWybierzAlt')}</div>`;
      }
      else if (st === 'blad') wynikHtml2 = `<div class="trm-wynik-termin blad"><div class="godz">${n.start.slice(11, 16)}</div><div class="st">⚠ Nie udało się sprawdzić terminu</div><div class="m">${esc(dost.komunikat || 'brak odpowiedzi')} <button class="trm-btn link sm" onclick="TRM.nowaZmiana(true)">Sprawdź ponownie</button></div></div>`;
      else if (st === 'czekam') wynikHtml2 = `<div class="trm-wynik-termin"><div class="godz">${n.start.slice(11, 16)}</div><div class="st muted">⏳ Sprawdzamy termin…</div></div>`;
      else wynikHtml2 = `<div class="trm-wynik-termin neutralna"><div class="st">Wybierz godzinę z listy albo wpisz własną — dostępność sprawdzimy automatycznie, bez zapisu.</div></div>`;
      if (!n.godzina) wynikHtml2 = `<div class="trm-wynik-termin neutralna"><div class="godz muted">Wybierz godzinę</div><div class="st">${esc(ladnaData(n.start.slice(0, 10), true))} · ${n.prefPrac ? esc(n.prefPrac) : 'dowolny dostępny specjalista'} — po wyborze godziny pokażemy wykonawcę i czas końca.</div></div>`;
    }
    const sloty = n.sloty;
    const slotyHtml = !n.pozycje.length ? '<div class="muted small">Najpierw wybierz zabieg.</div>'
      : sloty == null ? '<div class="muted small">⏳ Szukamy wolnych godzin…</div>'
      : sloty.blad ? '<div class="muted small">Nie udało się pobrać propozycji — wpisz godzinę ręcznie.</div>'
      : !sloty.length ? `<div class="trm-note warn small">Brak wolnych godzin tego dnia dla tego wyboru. <button class="trm-btn link sm" onclick="TRM.nowaSzukajTerminy()">Pokaż najbliższe inne dni</button></div>`
      : `<div class="trm-sloty">${sloty.map(s => `<button type="button" class="${n.start === s.start.slice(0, 16) ? 'selected' : ''}" onclick="TRM.nowaWybierzSlot('${s.start.slice(0, 16)}')">${hhmm(s.start)}</button>`).join('')}</div>${sloty.length >= (n.limitSlotow || 12) ? `<button type="button" class="trm-btn link sm" style="margin-top:6px" onclick="TRM.nowaWiecejSlotow()">Pokaż kolejne godziny (po ${hhmm(sloty[sloty.length - 1].start)})</button>` : `<div class="trm-pomoc">To wszystkie wolne godziny tego dnia dla tego wyboru.</div>`}`;
    const innaOtwarta = n.innaGodzina || (sloty && Array.isArray(sloty) && sloty.length && !sloty.some(s => s.start.slice(0, 16) === n.start));
    return `<div class="trm-grid2">
        <div class="trm-field"><label>Data wizyty</label><input type="date" id="trm-n-data" value="${n.start.slice(0, 10)}" onchange="TRM.nowaStart()"></div>
        <div class="trm-field"><label>Wykonawca dla wszystkich zabiegów</label><select id="trm-n-pref" onchange="TRM.nowaPrefPrac(this.value)"><option value="">Dowolny dostępny specjalista</option>${prac.map(p => `<option ${n.prefPrac === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>${prefOstrzezenieHtml(n)}</div>
      </div>
      <div class="trm-field"><label>Wolne godziny · ${esc(ladnaData(n.start.slice(0, 10), true))}</label>${slotyHtml}</div>
      <details class="trm-wiecej" ${innaOtwarta ? 'open' : ''} ontoggle="TRM.nowa&&(TRM.nowa.innaGodzina=this.open)"><summary>Inna godzina</summary><div class="trm-field"><label>Godzina rozpoczęcia</label><input type="time" id="trm-n-godz" step="300" value="${n.godzina ? n.start.slice(11, 16) : ''}" onchange="TRM.nowaStart()"></div></details>
      ${wynikHtml2}
      <details class="trm-wiecej" ${n.notatka || n.kanal !== 'recepcja' ? 'open' : ''}><summary>Notatka i kanał</summary>
        <div class="trm-field"><label>Notatka (wewnętrzna)</label><textarea rows="2" onchange="TRM.nowa.notatka=this.value">${esc(n.notatka)}</textarea></div>
        <div class="trm-field"><label>Kanał</label><select onchange="TRM.nowa.kanal=this.value">${Object.entries(KANAL_LABEL).filter(([k]) => !['online', 'klub', 'import'].includes(k)).map(([k, v]) => `<option value="${k}" ${n.kanal === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      </details>
      <div id="trm-n-wynik"></div>`;
  }
  function podsumowanieKrok3(n) {
    return `<div class="trm-podsum"><div><div class="t">Klientka</div><div class="v">${esc(n.klient ? n.klient.nazwa : '—')}</div><div class="m">${n.klient ? esc(n.klient.telefon || 'brak telefonu') : ''}</div></div><button class="trm-btn link sm fix" onclick="TRM.nowaIdzDoKroku(1)">Zmień</button></div>
    <div class="trm-podsum"><div><div class="t">Zabiegi</div>${n.pozycje.map(p => `<div class="v">${esc(nazwaUslugi(usluga(p.usluga_id)))} <span class="m">· ${p.czas_min} min${p.pracownik ? ' · ' + esc(p.pracownik) : ''}</span>${p.zakup_skladnik_id ? ` <span class="trm-pill pakiet">Z pakietu${p.zakup_nazwa ? ': ' + esc(p.zakup_nazwa) : ''}</span>` : ' <span class="trm-pill neu">Pojedynczy zabieg</span>'}</div>`).join('') || '<div class="m">brak</div>'}</div><button class="trm-btn link sm fix" onclick="TRM.nowaIdzDoKroku(2)">Zmień</button></div>`;
  }
  function stopkaNowej(n) {
    const gotowe = n.pozycje.length && n.klient && n.godzina && n.dostep && n.dostep.stan === 'ok';
    return `<div class="trm-stopka">${n.szybka ? '' : `<button class="trm-btn fix" onclick="TRM.nowaWstecz()">Wstecz</button>`}<button class="trm-btn primary" onclick="TRM.nowaZapisz()" ${gotowe ? '' : 'disabled'} id="trm-n-zapisz" title="${gotowe ? '' : 'Najpierw wybierz klientkę, zabieg i dostępny termin'}">Umów wizytę</button></div>`;
  }
  function renderNowa() {
    const n = TRM.nowa; if (!n) return;
    const fr = (n.filtrUsl || '').toLowerCase();
    const lista = TRM.dane.uslugi.filter(u => !fr || nazwaUslugi(u).toLowerCase().includes(fr)).slice(0, 60);
    panelOtworz(n.szybka ? renderNowaSzybka(n, lista) : renderNowaKreator(n, lista));
    nowaRysujPropozycje();
  }
  function renderNowaSzybka(n, lista) {
    // „· DominikaR" w nagłówku brzmiało jak wykonawca wizyty, a to tylko kolumna, w którą kliknięto
    // (zgłoszenie #10). Nazywamy rzecz po imieniu — wykonawcę ustawia się niżej, przy zabiegach.
    return naglowekPanelu('Nowa wizyta', `${esc(ladnaData(n.start.slice(0, 10)))}${n.domyslny ? ' · z kolumny ' + esc(n.domyslny) : ''}`)
      + sekcjaKlientHtml(n) + sekcjaUslugiHtml(n, lista) + sekcjaTerminuHtml(n) + stopkaNowej(n);
  }
  function renderNowaKreator(n, lista) {
    const krok = Math.max(1, Math.min(3, n.krok || 1));
    const kroki = `<div class="trm-kroki">${['Klientka', 'Zabieg', 'Termin'].map((t, i) => `<div class="trm-krok-el ${i + 1 === krok ? 'aktywny' : ''}"><b>${i + 1 < krok ? '✓' : i + 1}</b>${esc(t)}</div>`).join('')}</div>`;
    let body;
    if (krok === 1) {
      body = sekcjaKlientHtml(n) + `<div class="trm-stopka"><button class="trm-btn primary" onclick="TRM.nowaDalej()" ${n.klient ? '' : 'disabled'}>Dalej</button></div>`;
    } else if (krok === 2) {
      body = sekcjaKlientHtml(n) + sekcjaUslugiHtml(n, lista) + `<div class="trm-stopka"><button class="trm-btn fix" onclick="TRM.nowaWstecz()">Wstecz</button><button class="trm-btn primary" onclick="TRM.nowaDalej()" ${n.pozycje.length ? '' : 'disabled'}>Dalej</button></div>`;
    } else {
      body = podsumowanieKrok3(n) + sekcjaTerminuHtml(n) + stopkaNowej(n);
    }
    return naglowekPanelu('Nowa wizyta', esc(ladnaData(n.start.slice(0, 10)))) + kroki + body;
  }
  TRM.renderNowa = renderNowa;
  TRM.nowaDalej = () => { const n = TRM.nowa; if (!n) return; if ((n.krok || 1) === 1 && !n.klient) return; if ((n.krok || 1) === 2 && !n.pozycje.length) return; n.krok = Math.min(3, (n.krok || 1) + 1); renderNowa(); if (n.krok === 3) { nowaLadujSloty(); TRM.nowaZmiana(true); } };
  TRM.nowaWstecz = () => { const n = TRM.nowa; if (!n) return; n.krok = Math.max(1, (n.krok || 1) - 1); renderNowa(); };
  TRM.nowaIdzDoKroku = (k) => { const n = TRM.nowa; if (!n) return; n.krok = k; renderNowa(); };
  function listaUslugHtml(lista) {
    return lista.length ? lista.map(u => `<div class="trm-usl-karta ${u.skonfigurowana && u.aktywna ? '' : 'off'}" onclick="${u.skonfigurowana && u.aktywna ? `TRM.nowaDodajPoz('${esc(u.id)}')` : ''}" title="${u.skonfigurowana ? '' : 'Brak czasu trwania — skonfiguruj w Ustawieniach'}"><span>${esc(nazwaUslugi(u))}</span><span class="muted">${u.skonfigurowana ? u.czas_min + ' min' : 'brak czasu'}${u.cena != null ? ' · ' + zl(u.cena) : ''}</span></div>`).join('') : '<div class="muted" style="padding:8px 10px">Brak usług w cenniku.</div>';
  }
  TRM.renderNowaUslugi = () => { const fr = (TRM.nowa.filtrUsl || '').toLowerCase(); const l = el('trm-usl-lista'); if (l) l.innerHTML = listaUslugHtml(TRM.dane.uslugi.filter(u => !fr || nazwaUslugi(u).toLowerCase().includes(fr)).slice(0, 60)); };
  let szukajT = null;
  TRM.nowaSzukaj = (v) => { TRM.nowa.fraza = v; clearTimeout(szukajT); szukajT = setTimeout(async () => { const d = await api('trm_szukaj_klienta', { fraza: v }); if (!TRM.nowa) return; TRM.nowa.wyniki = d.klienci || []; const w = el('trm-k-wyniki'); if (w) { w.hidden = !TRM.nowa.wyniki.length; w.innerHTML = klientWynikiHtml(TRM.nowa.wyniki); } }, 250); };
  TRM.nowaKlient = (i) => { const n = TRM.nowa; if (!n) return; n.klient = i == null ? null : n.wyniki[i]; n.zakupy = null; n.pozycje = n.pozycje.filter(p => !p.zakup_skladnik_id); /* zmiana klientki czyści obce zakupy (A03) */ nowaResetDostep(n); renderNowa(); if (i == null) setTimeout(() => { const f = el('trm-k-fraza'); if (f) f.focus(); }, 30); else { nowaLadujZakupy(); nowaLadujHistorie(); if (nowaNaTerminie(n)) { nowaLadujSloty(); TRM.nowaZmiana(); } } };
  // czy krok „Termin” jest aktualnie widoczny (tryb szybki pokazuje wszystko na raz)
  const nowaNaTerminie = (n) => n && (n.szybka || n.krok === 3);
  const nowaResetDostep = (n) => { n.wynik = null; n.dostep = null; n.sloty = null; };
  TRM.nowaDodajPoz = (id) => { const n = TRM.nowa; const u = usluga(id); if (!n || !u) return; const pref = n.prefPrac || n.domyslny; n.pozycje.push({ usluga_id: u.id, pracownik: pref && (!u.pracownicy || !u.pracownicy.length || u.pracownicy.includes(pref)) ? pref : null, czas_min: u.czas_min }); n.filtrUsl = ''; nowaResetDostep(n); renderNowa(); nowaLadujHistorie(); if (nowaNaTerminie(n)) { nowaLadujSloty(); TRM.nowaZmiana(); } };
  TRM.nowaUsunPoz = (i) => { const n = TRM.nowa; if (!n) return; n.pozycje.splice(i, 1); nowaResetDostep(n); renderNowa(); nowaLadujHistorie(); if (nowaNaTerminie(n)) { nowaLadujSloty(); TRM.nowaZmiana(); } };
  TRM.nowaUniewaznij = () => { const n = TRM.nowa; if (!n) return; nowaResetDostep(n); const w = el('trm-n-wynik'); if (w) w.innerHTML = ''; if (nowaNaTerminie(n)) { nowaLadujSloty(); TRM.nowaZmiana(); } };
  TRM.nowaPrefPrac = (v) => { const n = TRM.nowa; if (!n) return; n.prefPrac = v || ''; n.pozycje.forEach(p => { const u = usluga(p.usluga_id); p.pracownik = v && (!u || !u.pracownicy || !u.pracownicy.length || u.pracownicy.includes(v)) ? v : null; }); nowaResetDostep(n); renderNowa(); nowaLadujSloty(); TRM.nowaZmiana(); };
  TRM.nowaWybierzSlot = (start) => { const n = TRM.nowa; if (!n) return; n.start = start; n.godzina = true; n.dataReczna = true; n.dostep = null; renderNowa(); TRM.nowaZmiana(true); };
  TRM.nowaStart = () => {
    const n = TRM.nowa; if (!n) return;
    const dtEl = el('trm-n-data'), gEl = el('trm-n-godz');
    const dt = dtEl && dtEl.value ? dtEl.value : n.start.slice(0, 10), g = gEl && gEl.value ? gEl.value : (n.godzina ? n.start.slice(11, 16) : '00:00');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || !/^\d{2}:\d{2}$/.test(g)) return;
    const zmianaDnia = dt !== n.start.slice(0, 10);
    if (gEl && gEl.value) n.godzina = true; // D03: godzina wpisana świadomie
    n.start = `${dt} ${g}`; n.dataReczna = true; nowaResetDostep(n);
    if (zmianaDnia) { TRM.data = dt; const di = el('trm-data'); if (di) di.value = dt; odswiez(); } // kalendarz podąża za datą z formularza (T01)
    renderNowa(); nowaLadujSloty(); TRM.nowaZmiana();
  };
  // nawigacja kalendarza przy otwartym formularzu: data formularza podąża za dniem, dopóki ktoś nie wpisał jej ręcznie (T01)
  function nowaSynchronizujDate() {
    const n = TRM.nowa; if (!n || TRM.panel !== 'nowa') return;
    if (n.dataReczna || n.start.slice(0, 10) === TRM.data) return;
    n.start = TRM.data + n.start.slice(10); nowaResetDostep(n);
    renderNowa(); if (nowaNaTerminie(n)) { nowaLadujSloty(); TRM.nowaZmiana(); }
  }
  // automatyczne sprawdzenie dostępności z ochroną przed nieaktualną odpowiedzią (A17: licznik żądań)
  let nowaSprawdzT = null;
  TRM.nowaZmiana = (natychmiast) => {
    const n = TRM.nowa; if (!n) return;
    clearTimeout(nowaSprawdzT);
    if (!n.pozycje.length || !nowaNaTerminie(n)) return;
    n.dostep = { stan: 'czekam' }; renderNowa();
    nowaSprawdzT = setTimeout(nowaAutoSprawdz, natychmiast ? 0 : 350);
  };
  async function nowaAutoSprawdz() {
    const n = TRM.nowa; if (!n || !n.pozycje.length || !n.godzina) return; // D03: bez wybranej godziny nic nie sprawdzamy
    const req = ++n.req;
    let d; try { d = await api('trm_sprawdz', { start: n.start, pozycje: n.pozycje, id_klienta: n.klient ? n.klient.id_klienta : null }); } catch (e) { d = { status: 'error', message: 'brak połączenia' }; }
    if (TRM.nowa !== n || req !== n.req) return; // stara odpowiedź po kolejnej zmianie — ignorujemy
    if (!d || d.status !== 'success') n.dostep = { stan: 'blad', komunikat: (d && d.message) || 'brak odpowiedzi' };
    else n.dostep = d.ok ? { stan: 'ok', wynik: d } : { stan: 'zajety', wynik: d };
    renderNowa();
  }
  async function nowaLadujSloty() {
    const n = TRM.nowa; if (!n) return;
    if (!n.pozycje.length) { n.sloty = []; return; }
    const dzien = n.start.slice(0, 10); const req = n.reqSloty = (n.reqSloty || 0) + 1;
    n.sloty = null;
    let d; try { d = await api('trm_szukaj', { dzien_od: dzien, dzien_do: dzien, pozycje: n.pozycje, limit: n.limitSlotow || 12, id_klienta: n.klient ? n.klient.id_klienta : null }); } catch (e) { d = null; }
    if (TRM.nowa !== n || req !== n.reqSloty || n.start.slice(0, 10) !== dzien) return;
    n.sloty = d && d.status === 'success' ? d.terminy : Object.assign([], { blad: true });
    renderNowa();
  }
  TRM.nowaWiecejSlotow = () => { const n = TRM.nowa; if (!n) return; n.limitSlotow = Math.min(30, (n.limitSlotow || 12) + 12); nowaLadujSloty(); };
  // R03: tymczasowa propozycja wizyty w siatce (właściwa kolumna i godzina) — tylko podgląd, bez zapisu
  // ─── Kafelek-szkic na siatce (zgłoszenie #11, Gosia, 20.10.2026) ──────────────────────────────
  // „Gdy wpisuje się usługę, nie pojawia się ona od razu na ekranie. Dopiero po wybraniu godziny ją
  // widać. Łatwiej byłoby, gdyby kafelek był przesuwalny, po pojawieniu się można byłoby go od razu
  // przestawić w odpowiednie miejsce." Szkic pojawia się więc zaraz po dodaniu zabiegu — zanim
  // padnie decyzja o godzinie — i da się go przeciągnąć: w pionie ustawia godzinę, w poziomie osobę.
  // Nic nie zapisuje: po puszczeniu idzie zwykłe sprawdzenie dostępności, to samo co przy wyborze
  // godziny z listy. Dopóki termin nie jest potwierdzony, szkic jest przerywany i półprzezroczysty.
  let szkicDrag = null;
  function nowaRysujSzkic() {
    document.querySelectorAll('.trm-szkic').forEach(x => x.remove());
    const n = TRM.nowa;
    if (!n || TRM.panel !== 'nowa' || !n.pozycje.length || !operacyjna()) return;
    if (TRM.widok !== 'dzien' || n.start.slice(0, 10) !== TRM.data || !TRM._zak) return;
    if (n.godzina && n.dostep && n.dostep.stan === 'ok' && n.dostep.wynik) return;   // jest już zielona propozycja
    const zak = TRM._zak;
    const kolumny = [...document.querySelectorAll('#trm-main .trm-col')].filter(c => c.dataset.prac);
    if (!kolumny.length) return;
    const celPrac = n.prefPrac || n.domyslny || ((n.pozycje.find(p => p.pracownik) || {}).pracownik || '');
    const col = kolumny.find(c => c.dataset.prac === celPrac) || kolumny[0];
    const trwanie = n.pozycje.reduce((s, p) => s + (Number(p.czas_min) || 0), 0) || 30;
    const a = Math.max(zak.od, Math.min(zak.do - 10, minDnia(n.start)));
    const e = document.createElement('div');
    e.className = 'trm-szkic' + (n.godzina ? ' ustalony' : '');
    e.style.top = ((a - zak.od) * PX) + 'px';
    e.style.height = Math.max(24, trwanie * PX - 2) + 'px';
    e.innerHTML = `<b>${pad(Math.floor(a / 60))}:${pad(a % 60)}–${pad(Math.floor((a + trwanie) / 60))}:${pad((a + trwanie) % 60)}</b>
      <span>${esc(n.pozycje.map(p => nazwaUslugi(usluga(p.usluga_id))).join(' + '))}</span>
      <em>${n.godzina ? 'przeciągnij, żeby zmienić' : 'przeciągnij na właściwą godzinę'}</em>`;
    e.addEventListener('pointerdown', szkicDown);
    col.appendChild(e);
  }
  function szkicDown(ev) {
    if (ev.button !== 0) return;
    const e = ev.currentTarget;
    szkicDrag = { id: ev.pointerId, e, offsetY: ev.clientY - e.getBoundingClientRect().top, kolumny: [...document.querySelectorAll('#trm-main .trm-col')].filter(c => c.dataset.prac) };
    e.classList.add('ciagniety');
    try { e.setPointerCapture(ev.pointerId); } catch (x) {}
    ev.preventDefault(); ev.stopPropagation();
  }
  function szkicMove(ev) {
    if (!szkicDrag || ev.pointerId !== szkicDrag.id) return;
    const n = TRM.nowa; if (!n) return;
    const zak = TRM._zak || { od: 480, do: 1200 }, krok = (TRM.dane && TRM.dane.ustawienia && TRM.dane.ustawienia.siatka_min) || 15;
    const trwanie = n.pozycje.reduce((s, p) => s + (Number(p.czas_min) || 0), 0) || 30;
    const kol = szkicDrag.kolumny.find(c => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right; }) || szkicDrag.e.parentElement;
    const rect = kol.getBoundingClientRect();
    let m = zak.od + (ev.clientY - szkicDrag.offsetY - rect.top) / PX;
    m = Math.max(zak.od, Math.min(zak.do - trwanie, Math.round(m / krok) * krok));
    if (kol !== szkicDrag.e.parentElement) kol.appendChild(szkicDrag.e);
    szkicDrag.e.style.top = ((m - zak.od) * PX) + 'px';
    szkicDrag.e.querySelector('b').textContent = `${pad(Math.floor(m / 60))}:${pad(m % 60)}–${pad(Math.floor((m + trwanie) / 60))}:${pad((m + trwanie) % 60)}`;
    szkicDrag.cel = { m, prac: kol.dataset.prac };
  }
  function szkicUp(ev) {
    if (!szkicDrag || ev.pointerId !== szkicDrag.id) return;
    const d = szkicDrag; szkicDrag = null;
    d.e.classList.remove('ciagniety');
    const n = TRM.nowa; if (!n || !d.cel) return;
    n.start = `${TRM.data}T${pad(Math.floor(d.cel.m / 60))}:${pad(d.cel.m % 60)}`;
    n.godzina = true; n.dataReczna = true; n.dostep = null;
    // Przeciągnięcie JEST wyborem terminu, więc kreator przeskakuje na krok „Termin" — inaczej
    // dostępność nie byłaby sprawdzana (sprawdzamy tylko na tym kroku) i szkic wisiałby bez odpowiedzi.
    if (!n.szybka && n.krok !== 3) n.krok = 3;
    // Zmiana kolumny = zmiana osoby; ta sama ścieżka co wybór z listy, więc reguły „kto wykonuje
    // zabieg" i ostrzeżenie z #10 działają tak samo.
    if (d.cel.prac && d.cel.prac !== (n.prefPrac || '')) TRM.nowaPrefPrac(d.cel.prac);
    else { renderNowa(); TRM.nowaZmiana(true); }
  }
  document.addEventListener('pointermove', szkicMove);
  document.addEventListener('pointerup', szkicUp);
  document.addEventListener('pointercancel', () => { if (szkicDrag) { szkicDrag.e.classList.remove('ciagniety'); szkicDrag = null; nowaRysujSzkic(); } });

  function nowaRysujPropozycje() {
    document.querySelectorAll('.trm-propozycja').forEach(x => x.remove());
    nowaRysujSzkic();
    const n = TRM.nowa; if (!n || TRM.panel !== 'nowa' || !n.godzina || !n.dostep || n.dostep.stan !== 'ok' || !n.dostep.wynik) return;
    if (TRM.widok !== 'dzien' || n.start.slice(0, 10) !== TRM.data || !TRM._zak) return;
    const zak = TRM._zak;
    n.dostep.wynik.pozycje.forEach((p, i) => {
      const col = [...document.querySelectorAll('#trm-main .trm-col')].find(c => c.dataset.prac === p.pracownik); if (!col) return;
      const a = minDnia(p.start), b = minDnia(p.koniec) || 1440; if (b <= zak.od || a >= zak.do) return;
      const el2 = document.createElement('div'); el2.className = 'trm-propozycja'; el2.style.top = ((Math.max(a, zak.od) - zak.od) * PX) + 'px'; el2.style.height = (Math.max(18, (Math.min(b, zak.do) - Math.max(a, zak.od)) * PX - 2)) + 'px';
      el2.innerHTML = `<b>${hhmm(p.start)}–${hhmm(p.koniec)} · propozycja</b>${esc(n.klient ? n.klient.nazwa : '')}`;
      // #11: gotową propozycję też da się chwycić i przestawić — ta sama obsługa co szkicu,
      // żeby „przesuwalny kafelek" działał niezależnie od tego, czy godzina już padła.
      if (!i) { el2.classList.add('ciagalna'); el2.addEventListener('pointerdown', szkicDown); }
      col.appendChild(el2);
    });
  }
  function wynikHtml(w) {
    if (!w) return '';
    if (w.ok) return `<div class="trm-note ok"><b>Cały komplet jest dostępny</b> · ${hhmm(w.start)}–${hhmm(w.koniec)}${w.przerwy_min ? ` (w tym ${w.przerwy_min} min przerwy)` : ''}<br>${w.pozycje.map(p => `${esc(p.nazwa)} — <b>${esc(p.pracownik)}</b>${p.gabinet_id ? ' · ' + esc((zasob(p.gabinet_id) || {}).nazwa || 'gabinet') : ''}${p.urzadzenie_id ? ' · ' + esc((zasob(p.urzadzenie_id) || {}).nazwa || 'urządzenie') : ''} (${hhmm(p.start)}–${hhmm(p.koniec)})`).join('<br>')}</div>`;
    return `<div class="trm-note bad"><b>Wybrany komplet nie jest dostępny.</b><br>${(w.problemy || []).map(p => esc(p.opis)).join('<br>')}</div>` + alternatywyHtml(w.alternatywy, 'TRM.nowaWybierzAlt');
  }
  function alternatywyHtml(alt, fn) {
    if (!alt || !alt.length) return '<div class="muted small">Brak alternatyw w najbliższych dniach — zmień zakres albo osobę.</div>';
    return `<div class="small muted" style="margin-top:8px">Dostępne rozwiązania:</div>` + alt.map((a, i) => `<div class="trm-alt"><div><b>${ladnaData(a.start.slice(0, 10), true)} · ${hhmm(a.start)}–${hhmm(a.koniec)}</b><div class="d">${esc(a.opis || '')} · ${a.pozycje.map(p => p.pracownik).join(', ')}</div></div><button class="trm-btn sm" onclick="${fn}(${i})">Wybierz</button></div>`).join('');
  }
  TRM.nowaWybierzAlt = (i) => {
    const n = TRM.nowa; if (!n) return;
    const zrodlo = (n.dostep && n.dostep.wynik && n.dostep.wynik.alternatywy) || (n.wynik && n.wynik.alternatywy) || [];
    const a = zrodlo[i]; if (!a) return;
    const nowyDzien = a.start.slice(0, 10), zmianaDnia = nowyDzien !== n.start.slice(0, 10);
    n.start = a.start.slice(0, 16); n.dataReczna = true;
    a.pozycje.forEach((p, j) => { if (n.pozycje[j]) n.pozycje[j].pracownik = p.pracownik; });
    nowaResetDostep(n);
    if (zmianaDnia) { TRM.data = nowyDzien; const di = el('trm-data'); if (di) di.value = nowyDzien; odswiez(); }
    renderNowa(); nowaLadujSloty(); TRM.nowaZmiana(true);
  };
  TRM.nowaSprawdz = () => TRM.nowaZmiana(true); // zgodność wsteczna — sprawdzanie jest teraz automatyczne
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
    if (d.status === 'konflikt') { n.dostep = { stan: 'zajety', wynik: { problemy: d.problemy, alternatywy: d.alternatywy } }; n.idem = uuid(); renderNowa(); return toast('warning', 'Termin niedostępny', d.message); }
    if (d.status !== 'success') { if (btn) { btn.disabled = false; btn.textContent = 'Umów wizytę'; } return toast('error', 'Nie zapisano', d.message); }
    toast('success', d.powtorzenie ? 'Ta wizyta była już zapisana' : 'Zapisano wizytę', `${d.rezerwacja.numer} · ${d.rezerwacja.klient_nazwa} · ${hhmm(d.rezerwacja.start)}`);
    // Z8: wizyta zapisana, ale zabieg pochodzi z pakietu po terminie — osobny, widoczny komunikat po zapisie.
    for (const o of (d.ostrzezenia || [])) if (o.kod === 'PO_TERMINIE') toast('warning', 'Zabieg z pakietu po terminie', `${o.zakup_nazwa ? '„' + o.zakup_nazwa + '”: ' : ''}${o.tekst}`);
    TRM.data = d.rezerwacja.start.slice(0, 10); const di = el('trm-data'); if (di) di.value = TRM.data;
    TRM.nowa = null; TRM.panel = null;
    await odswiez();
    TRM.otworzSzczegoly(d.rezerwacja.id);
  };

  // ── CENTRUM POWIADOMIEŃ: Sprawy ─────────────────────────────────────────
  TRM.otworzPowiadomienia = async (zakladka) => {
    TRM.panel = 'powiadomienia';
    panelOtworz(naglowekPanelu('Powiadomienia', 'Pobieramy…'));
    await zaladujSprawy(zakladka || TRM.sprawy.zakladka);
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
    const lm = (n, j, m, w) => n === 1 ? j : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? m : w;
    const pilne = lista.filter(x => x.priorytet === 'P0').length;
    const podtytul = z === 'do_dzialania' ? `${lista.length} ${lm(lista.length, 'sprawa', 'sprawy', 'spraw')} do działania${pilne ? ` · ${pilne} ${lm(pilne, 'pilna', 'pilne', 'pilnych')}` : ''} — to liczy dzwonek` : `${lista.length} ${lm(lista.length, 'sprawa', 'sprawy', 'spraw')} w tej zakładce`;
    const html = naglowekPanelu('Powiadomienia', podtytul) +
      `<div class="trm-tabs sm">${SPRAWY_TABY.map(([k, n]) => `<button class="${z === k ? 'on' : ''}" onclick="TRM.sprawyZakladka('${k}')">${n}</button>`).join('')}</div>` +
      (lista.length ? `<div class="trm-sprawy-lista">${lista.map(kartaSprawy).join('')}</div>` : `<div class="trm-empty"><div class="big">✅</div><p>Brak spraw w tej zakładce.</p></div>`);
    panelOtworz(html);
  }
  function kartaSprawy(sp) {
    const [plab, pcls] = PRIOR_LABEL[sp.priorytet] || ['', 'neu'];
    const termin = sp.termin_dzialania ? terminEtykieta(sp.termin_dzialania) : null;
    const mozePrzejac = sp.priorytet !== 'P2' && !sp.wlasciciel && !['rozwiazana', 'nieaktualna'].includes(sp.stan);
    const w = wizytaSprawy(sp), powod = powodPriorytetu(sp);
    return `<div class="trm-sprawa-karta ${pcls} ${sp.przeczytane ? '' : 'nieprz'}" role="button" tabindex="0" onclick="TRM.otworzSprawe(${sp.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();TRM.otworzSprawe(${sp.id});}" aria-label="${esc(sp.tytul)}">
      <div class="trm-sprawa-gora"><span class="trm-pill ${pcls}">${esc(termin ? `${plab} · ${termin}` : plab)}</span>${!sp.przeczytane ? '<span class="trm-kropka" title="Nieprzeczytane"></span>' : ''}${powod ? `<span class="muted small">${esc(powod)}</span>` : ''}</div>
      <div class="trm-sprawa-tytul">${esc(sp.tytul)}</div>
      ${w ? `<div class="small trm-sprawa-wizyta">${esc(w)}</div>` : ''}
      ${sp.opis ? `<div class="muted small trm-sprawa-opis">${esc(sp.opis)}</div>` : ''}
      <div class="trm-sprawa-dol">
        <div class="trm-sprawa-prowadzi">${sp.wlasciciel ? `${avatarHtml(sp.wlasciciel, true)}<span class="muted small">Prowadzi: <b>${esc(sp.wlasciciel)}</b></span>` : (sp.priorytet !== 'P2' ? '<span class="muted small">Nikt jeszcze nie przejął</span>' : '')}</div>
        <div class="trm-row" style="gap:6px">${akcjaWizytySprawy(sp, true)}${mozePrzejac ? `<button class="trm-btn primary sm fix" onclick="event.stopPropagation();TRM.sprawaPrzejmij(${sp.id})">Przejmij</button>` : ''}</div>
      </div>
    </div>`;
  }
  // D04: jedna linia „o jakiej wizycie mowa” — termin wizyty (podpisany), wykonawca, liczba wizyt przy sprawach grupowych
  function wizytaSprawy(sp) {
    const d = sp.dane || {};
    const kiedy = sp.powiazany_czas ? `${ladnaData(sp.powiazany_czas.slice(0, 10), true)} · ${sp.powiazany_czas.slice(11, 16)}` : null;
    if (Array.isArray(d.dotkniete) && d.dotkniete.length) {
      const osoby = [...new Set(d.dotkniete.map(x => x.pracownik).filter(Boolean))];
      return `${d.dotkniete.length === 1 ? 'Wizyta' : d.dotkniete.length + ' wizyt'}${kiedy ? ': od ' + kiedy : ''}${osoby.length ? ' · ' + osoby.join(', ') : ''}`;
    }
    const prac = (Array.isArray(d.pozycje) && d.pozycje[0] && (d.pozycje[0].nowy || d.pozycje[0].pracownik)) || d.pracownik || d.kogo || null;
    // E33 nie dotyczy jednej wizyty, a całego dnia — godzina 00:00 z powiązanego czasu nic nie znaczy
    if (sp.typ === 'E33') return `Dzień: ${ladnaData(String(d.dzien || (sp.powiazany_czas || '')).slice(0, 10), true)}${prac ? ' · ' + prac : ''}${Array.isArray(d.wizyty) ? ' · ' + d.wizyty.length + ' wizyt' : ''}`;
    if (!kiedy && !prac) return '';
    return `Wizyta${kiedy ? ': ' + kiedy : ''}${prac ? ' · ' + prac : ''}`;
  }
  // D04: powód pilności widoczny na karcie — z typu zdarzenia i czasu wizyty (reguła eskalacji: P0 w ciągu 2 h od wizyty)
  function powodPriorytetu(sp) {
    const typ = sp.typ || '';
    const baza = { E13: 'brak wyniku po zakończeniu wizyty', E19: 'wizyta zakończona bez zapisanego rozliczenia', E15: 'wizyty w czasie nieobecności', E16: 'wizyty na niedostępnym zasobie', E18: 'wizyty poza nową dostępnością', E02: 'przełożona wizyta', E03: 'zmiana wykonawcy', E05: 'odwołana wizyta', E06: 'nieobecność klientki', E08: 'przerwany zabieg', E20: 'zakup zmieniony w Sprzedaży — nowe umówienia z tego pakietu wstrzymane', E21: 'wizyta bez zakupu — wymaga zakupu albo wyjaśnienia', E22: 'zmiana ważności dotyka umówionych wizyt', E23: 'wykonanie oczekuje na przypisanie do zakupu', E24: 'uzgadnianie zakupów nie powiodło się', E33: 'seryjne odwoływanie wizyt z jednego dnia' }[typ] || '';
    if (sp.priorytet !== 'P0') return baza;
    const teraz = TRM.dzien && TRM.dzien.teraz ? TRM.dzien.teraz : null;
    const pc = sp.powiazany_czas || '';
    // znikanie wizyt ma własną regułę (P0 do 48 h, P1 do 7 dni) — nie wolno mówić „w ciągu 2 h”
    const ZNIKANIE = ['E02', 'E03', 'E05', 'E33'];
    const dlaczego = pc && teraz
      ? (pc <= teraz ? 'wizyta już się odbyła'
        : typ === 'E33' ? 'ten dzień jest już blisko'
          : ZNIKANIE.includes(typ) ? 'wizyta w najbliższych dwóch dniach' : 'wizyta w ciągu 2 h')
      : 'eskalacja czasowa';
    return `pilne, bo ${dlaczego}${baza ? ' — ' + baza : ''}`;
  }
  function akcjaWizytySprawy(sp, naKarcie) {
    const d = sp.dane || {};
    const stop = naKarcie ? 'event.stopPropagation();' : '';
    if (sp.rezerwacja_id) return `<button class="trm-btn sm fix" onclick="${stop}TRM.sprawaOtworzWizyte(${sp.id}, ${sp.rezerwacja_id})">Otwórz wizytę</button>`;
    const pierwsza = Array.isArray(d.dotkniete) && d.dotkniete[0] ? d.dotkniete[0] : null;
    const data = (pierwsza && pierwsza.start ? pierwsza.start : (sp.powiazany_czas || '')).slice(0, 10);
    if (data) return `<button class="trm-btn sm fix" onclick="${stop}TRM.sprawaPokazDzien('${data}'${pierwsza && pierwsza.pracownik ? `, '${esc(pierwsza.pracownik).replace(/'/g, "\\'")}'` : ''})">Sprawdź wizyty</button>`;
    return '';
  }
  TRM.sprawaOtworzWizyte = async (sprawaId, rezId) => { await TRM.otworzSzczegoly(rezId); if (TRM.szcz) { TRM.szcz.powrotSprawa = sprawaId; const p = el('trm-panel'); const head = p && p.querySelector('.trm-panel-head'); if (head && !p.querySelector('.trm-powrot-sprawa')) head.insertAdjacentHTML('afterend', `<button class="trm-btn link sm trm-powrot-sprawa" onclick="TRM.otworzSprawe(${sprawaId})">← wróć do sprawy</button>`); } };
  TRM.sprawaPokazDzien = (data, prac) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return; TRM.data = data; const di = el('trm-data'); if (di) di.value = data; if (prac && TRM.widok === 'dzien') { TRM.filtrPrac = new Set([prac]); } if (TRM.widok !== 'dzien') TRM.widokZmien('dzien'); else odswiez(); toast('info', 'Pokazujemy dzień ' + ladnaData(data, true), 'Panel sprawy zostaje otwarty — wróć do listy przyciskiem u góry.'); };

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
        ${d.dotkniete.map(x => `<div class="trm-dotknieta ${x.rozwiazana ? 'ok' : ''}"><div><b>${esc(x.klient_nazwa || 'wizyta')}</b><br><span class="muted small">${esc(x.kategoria || '')} · ${esc((x.start || '').slice(0, 16))} · ${esc(x.pracownik || '')}</span></div>${x.rozwiazana ? '<span class="trm-pill ok">obsłużona</span>' : `<button class="trm-btn sm fix" title="Sprawdzimy, czy wizyta nadal koliduje — samo kliknięcie nie usuwa kolizji" onclick="TRM.sprawaObsluzPozycje(${sp.id},${x.rezerwacja_id})">Obsłużono</button>`}</div>`).join('')}
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
  const TYP_SPRAWY_LABEL = { E02: 'Zmiana terminu', E03: 'Zmiana wykonawcy', E05: 'Odwołanie wizyty', E06: 'Nieobecność klientki', E08: 'Przerwany zabieg', E13: 'Brak wyniku wizyty', E15: 'Nieobecność wykonawcy', E16: 'Niedostępny zasób', E18: 'Zmiana grafiku', E19: 'Rozliczenie wizyty', E20: 'Zakup zmieniony w Sprzedaży', E21: 'Wizyta wymaga zakupu lub wyjaśnienia', E22: 'Zmiana ważności pakietu', E23: 'Wykonanie do wyjaśnienia', E24: 'Błąd uzgadniania zakupów', E33: 'Czyszczenie grafiku' };
  const pozostaloWizyt = (sp) => { const d = sp.dane || {}; return Array.isArray(d.dotkniete) ? d.dotkniete.filter(x => !x.rozwiazana).length : 0; };
  function akcjeSprawy(sp) {
    if (['rozwiazana', 'nieaktualna'].includes(sp.stan)) return operacyjna() ? `<button class="trm-btn fix" onclick="TRM.sprawaWznow(${sp.id})">Wznów sprawę</button>` : '';
    const btns = [];
    const otw = akcjaWizytySprawy(sp, false); if (otw) btns.push(otw);
    if (!sp.wlasciciel || sp.wlasciciel !== kto()) btns.push(`<button class="trm-btn primary fix" onclick="TRM.sprawaPrzejmij(${sp.id})">Przejmij</button>`);
    btns.push(`<button class="trm-btn fix" onclick="TRM.sprawaFormaPokaz('kontakt')">Zapisz kontakt</button>`);
    const pozostalo = pozostaloWizyt(sp);
    // E02: sprawa z listą wizyt zamyka się dopiero, gdy każda wizyta ma rozstrzygnięcie (przełożona / inny wykonawca / odwołana / poza kolizją). Notatka tego nie zastępuje.
    if (pozostalo) { btns.push(`<span class="trm-pill warn fix" title="Przełóż, zmień wykonawcę albo odwołaj te wizyty — wtedy sprawa zamknie się sama">Pozostało ${pozostalo} ${pozostalo === 1 ? 'wizyta' : pozostalo < 5 ? 'wizyty' : 'wizyt'} do obsłużenia</span>`); if (manager()) btns.push(`<button class="trm-btn link fix" onclick="TRM.sprawaFormaPokaz('wyjatek')">Zamknij wyjątkowo (manager)</button>`); }
    else btns.push(`<button class="trm-btn fix" onclick="TRM.sprawaFormaPokaz('rozwiaz')">Rozwiąż</button>`);
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
    const etyk = typ === 'kontakt' ? ['Wynik kontaktu', 'np. zadzwoniono, klientka potwierdziła zmianę…'] : typ === 'wyjatek' ? ['Wyjątek managera — powód zamknięcia mimo nieobsłużonych wizyt (zostanie zapisany w historii sprawy)', 'np. klientki poinformowane telefonicznie, wizyty odbędą się u Kasi — zmiana wykonawcy wprowadzona będzie jutro'] : ['Wynik sprawy', 'np. ustalono zastępstwo z Kasią'];
    return `<div class="trm-card" style="margin-top:10px"><label>${etyk[0]}</label>
      <textarea id="trm-sf-tekst" rows="3" placeholder="${etyk[1]}"></textarea>
      <div class="trm-row" style="margin-top:8px"><button class="trm-btn primary sm fix" onclick="TRM.sprawaWyslijForme()">Zapisz</button><button class="trm-btn sm fix" onclick="TRM.sprawaFormaAnuluj()">Anuluj</button></div></div>`;
  }
  function renderSprawaSzczegoly() {
    const sp = TRM.sprawy.szczegoly; if (!sp) return;
    const [plab, pcls] = PRIOR_LABEL[sp.priorytet] || ['', 'neu'];
    const html = naglowekPanelu('Sprawa', TYP_SPRAWY_LABEL[sp.typ] || 'Sprawa') +
      `<button class="trm-btn link sm" onclick="TRM.sprawyZakladka(TRM.sprawy.zakladka)">← wróć do listy</button>
      <div class="trm-sprawa-naglowek">
        <span class="trm-pill ${pcls}">${esc(plab)}</span>
        <span class="trm-pill neu">${esc(STAN_SPRAWY_LABEL[sp.stan] || sp.stan)}</span>
        ${sp.wlasciciel ? `<span class="muted small">Prowadzi: <b>${esc(sp.wlasciciel)}</b></span>` : '<span class="muted small">Nikt jeszcze nie przejął</span>'}
      </div>
      <h2 style="margin:8px 0 4px">${esc(sp.tytul)}</h2>
      ${wizytaSprawy(sp) ? `<div class="small" style="margin-bottom:4px"><b>${esc(wizytaSprawy(sp))}</b></div>` : ''}
      <div class="muted small" style="margin-bottom:6px">Zgłoszono: ${esc((sp.utworzono || '').slice(0, 16).replace(' ', ' · '))}${powodPriorytetu(sp) ? ' · ' + esc(powodPriorytetu(sp)) : ''}</div>
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
    else if (typ === 'wyjatek') { if (!tekst) return toast('warning', 'Podaj powód wyjątku'); d = await api('trm_sprawa_rozwiaz', { id, wynik: tekst, wyjatek: true }); }
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
    const powrot = TRM.szcz && TRM.szcz.id === id ? TRM.szcz.powrotSprawa : null;
    TRM.panel = 'szczegoly'; TRM.szcz = { id, tryb: 'podglad', powrotSprawa: powrot || null };
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
  // Jedna główna czynność zależna od etapu (raport T06), reszta w rozwijanym „Więcej działań”.
  function glownaAkcjaWizyty(r, anul, op) {
    if (anul || !op) return '';
    const akt = r.pozycje.filter(p => !['anulowana', 'niewykonana', 'odmowa'].includes(p.stan));
    const wTrakcie = akt.find(p => p.stan === 'w_trakcie'), zapl = akt.find(p => p.stan === 'zaplanowana');
    const nazwa = (p) => esc(p.kategoria + (p.wariant ? ' · ' + p.wariant : ''));
    if (wTrakcie) return `<button class="trm-btn primary" onclick="TRM.pozStan(${wTrakcie.id},'wykonana')">Zakończ zabieg${akt.length > 1 ? ': ' + nazwa(wTrakcie) : ''}</button>`;
    if (zapl && r.obecnosc !== 'przybyl' && r.obecnosc !== 'spozniony') return `<button class="trm-btn primary" onclick="TRM.obecnosc('przybyl')">Oznacz przybycie</button>`;
    if (zapl) return `<button class="trm-btn primary" onclick="TRM.pozStan(${zapl.id},'w_trakcie')">${akt.some(p => p.stan === 'wykonana') ? 'Rozpocznij kolejny' : 'Rozpocznij zabieg'}${akt.length > 1 ? ': ' + nazwa(zapl) : ''}</button>`;
    return '';
  }
  function wizytaKartaHtml(r, s, anul, op) {
    const akt = r.pozycje.filter(p => !['anulowana', 'niewykonana', 'odmowa'].includes(p.stan));
    const wieleAktywnych = akt.filter(p => ['zaplanowana', 'w_trakcie'].includes(p.stan)).length > 1;
    let h = `<div class="trm-card"><h3>Zabiegi</h3>${r.pozycje.map(p => {
      const u = usluga(p.usluga_id);
      const moge = op || (specjalista() && p.pracownik === kto());
      const szybkie = [], inne = [];
      if (!anul && moge) {
        // przy kilku aktywnych zabiegach każdy ma własne „Rozpocznij/Zakończ”, żeby wybrać właściwy segment; przy jednym wystarczy akcja główna
        if (p.stan === 'zaplanowana' && (wieleAktywnych || !op)) szybkie.push(`<button class="trm-btn sm ok" onclick="TRM.pozStan(${p.id},'w_trakcie')">▶ Rozpocznij</button>`);
        if (p.stan === 'w_trakcie' && (wieleAktywnych || !op)) szybkie.push(`<button class="trm-btn sm ok" onclick="TRM.pozStan(${p.id},'wykonana')">■ Zakończ</button>`);
        if (p.stan === 'zaplanowana') { inne.push(`<button class="trm-btn sm" onclick="TRM.pozStan(${p.id},'wykonana')">Oznacz jako wykonany (bez „Rozpocznij”)</button>`); if (op) inne.push(`<button class="trm-btn sm" onclick="TRM.pozStan(${p.id},'niewykonana')">Nie wykonano</button>`); inne.push(`<button class="trm-btn sm" onclick="TRM.pozStan(${p.id},'odmowa','Odmowa kwalifikacji — powód (zostanie w historii):')">Odmowa kwalifikacji</button>`); }
        if (p.stan === 'w_trakcie') inne.push(`<button class="trm-btn sm danger" onclick="TRM.pozStan(${p.id},'przerwana','Powód przerwania:')">Przerwij zabieg</button>`);
      }
      return `<div class="trm-poz" style="border-left:4px solid ${kolorKat(u)}"><div class="trm-row"><div class="n">${esc(p.kategoria)}${p.wariant ? ' · ' + esc(p.wariant) : ''}</div><span class="fix trm-pill ${p.stan === 'wykonana' ? 'ok' : p.stan === 'w_trakcie' ? 'info' : ['anulowana', 'niewykonana', 'odmowa', 'przerwana'].includes(p.stan) ? 'bad' : 'neu'}">${POZ_LABEL[p.stan] || p.stan}</span></div>
        <div class="m">${hhmm(p.start)}–${hhmm(p.koniec)} · ${p.czas_min} min · <b>${esc(p.pracownik)}</b>${p.wykonawca_fakt && p.wykonawca_fakt !== p.pracownik ? ' (wykonała: ' + esc(p.wykonawca_fakt) + ')' : ''}${p.gabinet ? ' · ' + esc(p.gabinet) : ''}${p.urzadzenie ? ' · ' + esc(p.urzadzenie) : ''}${p.zakup_skladnik_id ? ' · <span class="trm-pill pakiet">Z pakietu</span>' : (p.cena != null && op ? ' · ' + zl(p.cena) : '')}</div>
        ${p.start_fakt ? `<div class="m">Faktycznie: ${hhmm(p.start_fakt)}${p.koniec_fakt ? '–' + hhmm(p.koniec_fakt) : ' (trwa)'}</div>` : ''}
        ${szybkie.length ? `<div class="a">${szybkie.join('')}</div>` : ''}
        ${inne.length ? `<details class="trm-wiecej"><summary>Inne działania dla tego zabiegu</summary><div class="a">${inne.join('')}</div></details>` : ''}</div>`;
    }).join('')}</div>`;
    const glowna = glownaAkcjaWizyty(r, anul, op);
    if (op && !anul) {
      const wszystkieWykonane = akt.length && akt.every(p => ['wykonana', 'przerwana'].includes(p.stan));
      h += `<div class="trm-card">${glowna ? `<div class="trm-akcja-glowna">${glowna}</div>` : wszystkieWykonane ? `<div class="trm-note ok small">Wizyta wykonana — podsumowanie i rozliczenie w zakładce „Rozliczenie”.</div>` : ''}
      <details class="trm-wiecej"><summary>Więcej działań</summary>
        <div class="trm-row">
          ${r.wykonanie === 'zaplanowana' ? `<button class="trm-btn sm" onclick="TRM.szcz.tryb='zmiana';TRM.zm={start:TRM.szcz.rez.start.slice(0,16),prac:{}};TRM.renderSzczegoly()">Przełóż całą wizytę</button>` : ''}
          ${r.obecnosc !== 'spozniony' && r.wykonanie === 'zaplanowana' ? `<button class="trm-btn sm" onclick="TRM.obecnosc('spozniony')">Spóźniona</button>` : ''}
          ${r.obecnosc !== 'nieobecny' && r.wykonanie === 'zaplanowana' ? `<button class="trm-btn sm danger" onclick="TRM.obecnosc('nieobecny')">Nieobecna (potwierdzona)</button>` : ''}
          ${r.pozycje.some(p => p.stan === 'zaplanowana') ? `<button class="trm-btn sm danger" onclick="TRM.szcz.tryb='anuluj';TRM.an={zakres:'cala',kto:'klient',powod:''};TRM.renderSzczegoly()">Odwołaj wizytę</button>` : ''}
        </div>
        <div class="trm-pomoc">Nieobecność potwierdza człowiek — system jej nie zgaduje i nie zużywa jednostki karnetu.</div>
      </details></div>`;
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
    const aktywne = r.pozycje.filter(p => p.stan !== 'anulowana').length;
    // nagłówek: klientka na pierwszym planie, numer EST-… jako informacja pomocnicza (raport T06)
    let html = `<div class="trm-panel-head"><div><h2>${esc(r.klient_nazwa)}</h2><div class="trm-numer">${esc(ladnaData(r.start.slice(0, 10)))} · <b>${hhmm(r.start)}–${hhmm(r.koniec)}</b> · ${aktywne} ${aktywne === 1 ? 'zabieg' : aktywne < 5 ? 'zabiegi' : 'zabiegów'} · ${esc(r.numer)}</div></div><button class="trm-x" onclick="TRM.panelZamknij()" aria-label="Zamknij">✕</button></div>`;
    // jeden główny stan obsługi + pozostałe osie modelu słownie (dane zostają, zmienia się tylko hierarchia prezentacji)
    const glowny = anul ? ST_LABEL[r.status] : r.obecnosc === 'nieobecny' ? OB_LABEL.nieobecny : r.wykonanie === 'wykonana' ? WYK_LABEL.wykonana : r.wykonanie === 'czesciowo' ? WYK_LABEL.czesciowo : r.wykonanie === 'w_toku' ? WYK_LABEL.w_toku : r.obecnosc === 'przybyl' ? OB_LABEL.przybyl : r.obecnosc === 'spozniony' ? OB_LABEL.spozniony : ['Zaplanowana', 'info'];
    const pomoc = [];
    if (!anul && r.status !== 'potwierdzona') pomoc.push('rezerwacja: ' + (ST_LABEL[r.status] || [r.status])[0].toLowerCase());
    if (!anul && glowny !== OB_LABEL[r.obecnosc] && r.obecnosc !== 'oczekiwana') pomoc.push('obecność: ' + OB_LABEL[r.obecnosc][0].toLowerCase());
    if (!anul && (r.wykonanie === 'wykonana' || r.wykonanie === 'czesciowo')) pomoc.push(r.sprzedaz_id ? 'rozliczona' : 'do rozliczenia');
    html += `<div class="trm-status-glowny">${pill(glowny)}${pomoc.length ? `<span class="pomoc">${esc(pomoc.join(' · '))}</span>` : ''}</div>`;
    html += `<div class="trm-card"><div class="trm-row"><div><b>${esc(r.klient_nazwa)}</b><div class="muted small">${r.klient_telefon ? esc(r.klient_telefon) + ' · ' : ''}${r.id_klienta ? 'ID ' + esc(r.id_klienta) : 'bez kartoteki'} · kanał: ${esc(KANAL_LABEL[r.kanal] || r.kanal)}${r.brak_kontaktu ? ' · <span class="trm-pill warn">brak kontaktu</span>' : ''}</div></div>${r.id_klienta && op ? `<button class="trm-btn link sm fix" onclick="TRM.historiaKlientki('${esc(r.id_klienta)}')" title="Wszystkie wizyty tej klientki — odbyte i zaplanowane">Historia wizyt ↗</button>` : ''}${r.id_klienta && op ? `<button class="trm-btn link sm fix" onclick="pokaz('klient-profil'); setTimeout(() => otworzProfil('${esc(r.id_klienta)}'), 100);">Profil klientki ↗</button>` : ''}</div></div>`;
    html += prefKartaHtml(r);
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
    return `<div class="trm-card"><h3>Odwołaj wizytę</h3>
      <div class="trm-pomoc" style="margin-bottom:8px">To odwołanie przez klientkę lub salon. „Nie wykonano” i „Odmowa kwalifikacji” dla pojedynczego zabiegu są w zakładce Wizyta, przy zabiegu.</div>
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
    const tabs = [['ogolne', 'Godziny i zasady'], ['zespol', 'Zespół'], ['uslugi', 'Usługi'], ...((TRM.dane.ustawienia || {}).zakupy_integracja === 'on' ? [['pakiety', 'Pakiety i zakupy']] : []), ['zasoby', 'Gabinety i urządzenia'], ['grafik', 'Grafik zespołu'], ['nieobecnosci', 'Nieobecności i blokady'], ['maile', 'Powiadomienia e-mail']];
    const t = tabs.some(x => x[0] === TRM.ust.tab) ? TRM.ust.tab : 'ogolne'; TRM.ust.tab = t; // zakładka niedostępna (np. zakupy przy wyłączonej integracji) → Godziny i zasady
    let html = `<div class="trm-tabs">${tabs.map(([k, n]) => `<button class="${t === k ? 'on' : ''}" onclick="TRM.ustTab('${k}')">${n}</button>`).join('')}</div>`;
    TRM.ust.brudne = false;
    html += ({ ogolne: ustOgolne, zespol: ustZespol, uslugi: ustUslugi, pakiety: ustPakiety, zasoby: ustZasoby, grafik: ustGrafik, nieobecnosci: ustNieob, maile: ustMaile })[t]();
    el('trm-main').innerHTML = html;
    if (t === 'maile') TRM.maileWczytaj();
    if (t === 'nieobecnosci') TRM.nieobZmiana(true); // podgląd skutków od razu dla domyślnie wypełnionego formularza
    if (t === 'pakiety' && !TRM.ust.oferty) ustPakietyZaladuj();
    if (t === 'grafik' && TRM.ust.dzien) ustDzienPodglad();
  }
  // ── ZK-03: „Pakiety i zakupy” — skład ofert (wersje), przygotowanie zakupów (podgląd → rejestracja), stan pakietów (per składnik),
  //    istniejące wizyty (decyzje → plan/uruchomienie), gotowość ewidencji. Język recepcji: Kupiono · Wykorzystano · Umówione · Do umówienia · Do sprawdzenia.
  const PZ = () => (TRM.ust.pz = TRM.ust.pz || { tab: 'oferty', oferty: null, edycja: null, ofFiltr: '', ofWidok: 'pakiety', podglad: null, kluczRej: null, zazn: {}, rozstrz: {}, wynikRej: null, stan: null, kand: {}, dec: {}, pokazSprawdzone: false, filtrKlient: '', od: '', do: '' });
  const RODZAJ_LABEL = { pakiet: 'Pakiet (zabiegi na przyszłość)', pojedynczy_z_gory: 'Pojedynczy zabieg kupiony z góry', nie_ewidencjonuj: 'Nie ewidencjonuj (sprzedaż = wykonany zabieg / inny zapis)', nieobslugiwany: 'Nieobsługiwany typ (abonament / czas / rodzinny)' };
  const KATEGORIA_LABEL = { gotowe: ['Gotowe do zarejestrowania', 'ok'], wymaga_mapowania: ['Wymaga mapowania', 'warn'], wymaga_rozstrzygniecia: ['Do rozstrzygnięcia', 'warn'], pominiete: ['Pominięte', 'neu'], istniejace: ['Już zarejestrowane', 'neu'], zmienione: ['Zmienione od ostatniego sprawdzenia', 'bad'] };
  const TRYB_LABEL = { nie_uruchomiono: 'Nie uruchomiono', przygotowanie: 'Przygotowanie', aktywna: 'Aktywna', konczenie: 'Kończenie pracy z licznikami', wstrzymana: 'Wstrzymana', zakonczona: 'Zakończona', uzgadnianie: 'Wymaga uzgodnienia po przerwie', niedostepna: 'Technicznie niedostępna' };
  const PRZEJSCIA_UI = { nie_uruchomiono: ['przygotowanie'], przygotowanie: ['aktywna', 'nie_uruchomiono'], aktywna: ['konczenie', 'wstrzymana'], konczenie: ['aktywna', 'zakonczona'], wstrzymana: ['uzgadnianie'], zakonczona: ['uzgadnianie'], uzgadnianie: ['aktywna'] };
  async function ustPakietyZaladuj() { TRM.ust.oferty = 'ladowanie'; const pz = PZ(); const d = await api('trm_oferty_lista', {}); if (d.status !== 'success') pz.oferty = Object.assign([], { blad: d.message }); else { pz.oferty = d.oferty; pz.ewidencja = d.ewidencja; } if (TRM.widok === 'ustawienia' && TRM.ust.tab === 'pakiety') renderUstawienia(); }
  async function pzZaladujStan() { const pz = PZ(); pz.stan = 'ladowanie'; const d = await api('trm_ewidencja_stan', {}); pz.stan = d.status === 'success' ? d : { blad: d.message }; if (TRM.widok === 'ustawienia' && TRM.ust.tab === 'pakiety') renderUstawienia(); }
  function ustPakiety() {
    const pz = PZ(); const u = TRM.dane.ustawienia || {};
    const tabs = [['oferty', 'Skład ofert'], ['przygotowanie', 'Przygotowanie zakupów'], ['stan', 'Sprawdź stan pakietów'], ['wizyty', 'Istniejące wizyty'], ['gotowosc', 'Gotowość ewidencji']];
    const seg = `<div class="trm-row" style="margin-bottom:12px;gap:8px;flex-wrap:wrap"><div class="trm-segment pz-seg">${tabs.map(t => `<button type="button" class="${pz.tab === t[0] ? 'active' : ''}" onclick="TRM.pzTab('${t[0]}')">${t[1]}</button>`).join('')}</div><span class="trm-pill ${u.ewidencja === 'aktywna' ? 'ok' : u.ewidencja === 'niedostepna' ? 'bad' : 'neu'} fix" title="tryb ewidencji">${esc(TRYB_LABEL[u.ewidencja] || u.ewidencja || '—')}</span></div>`;
    return seg + ({ oferty: pzOferty, przygotowanie: pzPrzygotowanie, stan: pzStan, wizyty: pzWizyty, gotowosc: pzGotowosc })[pz.tab]();
  }
  TRM.pzTab = (t) => { const pz = PZ(); pz.tab = t; if (['stan', 'wizyty', 'gotowosc'].includes(t) && (!pz.stan || pz.stan.blad)) pzZaladujStan(); renderUstawienia(); };
  TRM.pzOdswiezStan = () => pzZaladujStan();
  const pzUslugiOpcje = (wyb) => (PZ().oferty || []).map(x => `<option value="${esc(x.usluga_id)}" ${String(x.usluga_id) === String(wyb) ? 'selected' : ''}>${esc(x.nazwa)}</option>`).join('');
  const skladText = (o) => (o.skladniki || []).map(s => `${s.jednostki} × ${esc((PZ().oferty.find(x => String(x.usluga_id) === String(s.usluga_wyk_id)) || {}).nazwa || s.usluga_wyk_id)}${s.jednostki_na_pozycje > 1 ? ` (${s.jednostki_na_pozycje} na pozycję)` : ''}${s.jednostka_miary && s.jednostka_miary !== 'sesja' ? ' · ' + esc(s.jednostka_miary) : ''}`).join(', ');
  // ── 1. Skład ofert (Z3-02): wielowierszowy edytor, wersje, podgląd wpływu
  function pzOferty() {
    const pz = PZ(); const of = pz.oferty;
    if (!of || of === 'ladowanie') return '<div class="muted small">⏳ Wczytujemy cennik i mapowania…</div>';
    if (of.blad) return `<div class="trm-note bad small">${esc(of.blad)} <button class="trm-btn link sm" onclick="ustPakietyZaladuj()">Spróbuj ponownie</button></div>`;
    const fr = (pz.ofFiltr || '').toLowerCase(); const widok = pz.ofWidok;
    const lista = of.filter(o => (widok === 'wszystkie' || /\d+\s*[x×]\s*$/i.test(o.nazwa) || o.stan !== 'brak') && (!fr || o.nazwa.toLowerCase().includes(fr)));
    const e = pz.edycja;
    const edytor = (o) => `<div class="pz-edytor" id="pz-edytor"><div class="trm-row" style="margin-bottom:8px"><div style="flex:1;min-width:220px"><label>Rodzaj oferty</label><select id="pz-rodzaj">${Object.keys(RODZAJ_LABEL).map(r => `<option value="${r}" ${e.rodzaj === r ? 'selected' : ''}>${RODZAJ_LABEL[r]}</option>`).join('')}</select></div></div>
      <div class="pz-sklad-naglowek small muted">Składniki (każdy wiersz = osobny licznik): zabieg wykonywany · jednostka · ile w jednym pakiecie · ile zużywa jedna pozycja w kalendarzu</div>
      ${e.skladniki.map((s, i) => `<div class="trm-row pz-sklad-wiersz" data-i="${i}"><select class="wyk" aria-label="zabieg wykonywany" style="flex:2;min-width:180px">${pzUslugiOpcje(s.usluga_wyk_id)}</select><select class="jm" aria-label="jednostka" style="flex:0 0 120px"><option value="sesja" ${s.jednostka_miary === 'sesja' || !s.jednostka_miary ? 'selected' : ''}>sesja</option><option value="przylozenie" ${s.jednostka_miary === 'przylozenie' ? 'selected' : ''}>przyłożenie</option><option value="zabieg" ${s.jednostka_miary === 'zabieg' ? 'selected' : ''}>zabieg</option></select><input class="j" type="number" min="1" max="500" value="${s.jednostki}" aria-label="w jednym pakiecie" style="flex:0 0 90px" title="w jednym pakiecie"><input class="np" type="number" min="1" max="20" value="${s.jednostki_na_pozycje || 1}" aria-label="na jedną pozycję" style="flex:0 0 80px" title="ile zużywa jedna pozycja"><button class="trm-btn sm fix" type="button" onclick="TRM.pzSkladUsun(${i})" aria-label="usuń składnik">Usuń</button></div>`).join('')}
      <div class="trm-row" style="margin-top:8px;flex-wrap:wrap"><button class="trm-btn sm fix" type="button" onclick="TRM.pzSkladDodaj()">+ Dodaj składnik</button><span class="trm-spacer"></span><button class="trm-btn sm fix" type="button" onclick="TRM.pzEdycjaAnuluj()">Anuluj</button><button class="trm-btn sm fix" type="button" onclick="TRM.pzOfertaZapisz('odrzucona')">Odrzuć ofertę</button><button class="trm-btn sm primary fix" type="button" onclick="TRM.pzOfertaZapisz('zatwierdzona')">Zapisz i zatwierdź</button></div>
      ${o.wersja ? `<div class="trm-pomoc" style="margin-top:6px">Zapis zmian utworzy wersję ${o.wersja + 1}. Istniejące zakupy zachowują wersję ${o.wersja} — nic nie jest przeliczane.</div>` : ''}</div>`;
    const wiersz = (o) => { const st = o.stan === 'zatwierdzona' ? pill(['Zatwierdzona', 'ok']) : o.stan === 'odrzucona' ? pill(['Odrzucona', 'bad']) : o.stan === 'brak' ? pill(['Bez mapowania', 'neu']) : pill(['Propozycja z nazwy', 'warn']);
      const wEd = e && String(e.usluga_id) === String(o.usluga_id);
      return `<tr id="trm-of-${esc(o.usluga_id)}" class="${wEd ? 'pz-edytowany' : ''}"><td><b>${esc(o.nazwa)}</b>${o.cena != null ? `<div class="muted small">${zl(o.cena)}</div>` : ''}</td>
        <td>${o.stan === 'brak' || o.stan === 'propozycja' ? `<div class="small">${esc((o.propozycja || {}).uwaga || '')}</div>` : ''}<div class="small">${skladText(o) || '<span class="muted">—</span>'}</div><div class="muted small">${esc(RODZAJ_LABEL[o.rodzaj] || o.rodzaj || '')}${o.wersja ? ` · wersja ${o.wersja}` : ''}</div></td>
        <td>${st}</td><td><button class="trm-btn sm fix" onclick="TRM.pzEdytuj('${esc(o.usluga_id)}')">${wEd ? 'Edytujesz…' : 'Edytuj skład'}</button></td></tr>${wEd ? `<tr class="pz-edytor-tr"><td colspan="4">${edytor(o)}</td></tr>` : ''}`; };
    return `<div class="trm-card"><h3>Co obejmuje pakiet?</h3><div class="trm-pomoc" style="margin-bottom:8px">Oferta z cennika (np. „1 obszar 4x”) to pakiet. Tu potwierdzasz, <b>co</b> jest wykonywane i <b>ile razy</b>. Nazwa z „4x” to tylko propozycja — liczba z tekstu nie jest dowodem. Pakiet łączony (np. 5 × endermologia + 4 × Meltivio) ma osobny wiersz dla każdego zabiegu i osobne liczniki. Zwykłe „1x” domyślnie nie tworzy zabiegu na przyszłość.</div>
      <div class="trm-row" style="margin-bottom:8px"><input placeholder="Szukaj oferty…" value="${esc(pz.ofFiltr || '')}" oninput="TRM.ust.pz.ofFiltr=this.value;TRM.widokZmien('ustawienia')"><div class="trm-segment fix"><button type="button" class="${widok === 'pakiety' ? 'active' : ''}" onclick="TRM.ust.pz.ofWidok='pakiety';TRM.widokZmien('ustawienia')">Pakiety i zmapowane</button><button type="button" class="${widok === 'wszystkie' ? 'active' : ''}" onclick="TRM.ust.pz.ofWidok='wszystkie';TRM.widokZmien('ustawienia')">Cały cennik</button></div></div>
      <div style="overflow:auto"><table class="trm-oferty pz-tabela"><thead><tr><th>Oferta (cennik)</th><th>Skład i rodzaj</th><th>Stan</th><th></th></tr></thead><tbody>${lista.slice(0, 150).map(wiersz).join('')}</tbody></table>${lista.length > 150 ? `<div class="trm-pomoc">Pokazano 150 z ${lista.length} — zawęź wyszukiwaniem.</div>` : ''}${!lista.length ? '<div class="muted small" style="padding:10px 0">Brak pozycji.</div>' : ''}</div></div>`;
  }
  TRM.pzEdytuj = (uslugaId) => { const pz = PZ(); const o = (pz.oferty || []).find(x => String(x.usluga_id) === String(uslugaId)); if (!o) return; pz.edycja = { usluga_id: o.usluga_id, rodzaj: o.rodzaj || 'pakiet', skladniki: (o.skladniki && o.skladniki.length ? o.skladniki : [{ usluga_wyk_id: o.usluga_id, jednostki: 1, jednostka_miary: 'sesja', jednostki_na_pozycje: 1 }]).map(s => ({ ...s })) }; renderUstawienia(); setTimeout(() => { const x = el('pz-edytor'); if (x) x.scrollIntoView({ block: 'center', behavior: 'instant' }); }, 30); };
  const pzZbierzEdycje = () => { const pz = PZ(); const e = pz.edycja; if (!e) return null; const r = el('pz-rodzaj'); if (r) e.rodzaj = r.value; e.skladniki = [...document.querySelectorAll('#pz-edytor .pz-sklad-wiersz')].map(w => ({ usluga_wyk_id: w.querySelector('.wyk').value, jednostka_miary: w.querySelector('.jm').value, jednostki: Number(w.querySelector('.j').value) || 1, jednostki_na_pozycje: Number(w.querySelector('.np').value) || 1 })); return e; };
  TRM.pzSkladDodaj = () => { const e = pzZbierzEdycje(); if (!e) return; e.skladniki.push({ usluga_wyk_id: e.usluga_id, jednostki: 1, jednostka_miary: 'sesja', jednostki_na_pozycje: 1 }); renderUstawienia(); };
  TRM.pzSkladUsun = (i) => { const e = pzZbierzEdycje(); if (!e) return; e.skladniki.splice(i, 1); renderUstawienia(); };
  TRM.pzEdycjaAnuluj = () => { PZ().edycja = null; renderUstawienia(); };
  TRM.pzOfertaZapisz = async (stan) => {
    const e = pzZbierzEdycje(); if (!e) return;
    if (stan === 'zatwierdzona' && ['pakiet', 'pojedynczy_z_gory'].includes(e.rodzaj) && !e.skladniki.length) return toast('warning', 'Dodaj co najmniej jeden składnik');
    if (e.rodzaj === 'pojedynczy_z_gory' && (e.skladniki.length !== 1 || e.skladniki[0].jednostki !== 1)) return toast('warning', 'Pojedynczy zabieg kupiony z góry ma dokładnie jeden składnik × 1');
    const d = await api('trm_oferta_zapisz', { usluga_id: e.usluga_id, stan, rodzaj: e.rodzaj, skladniki: e.skladniki });
    if (d.status !== 'success') return toast('error', 'Nie zapisano składu', d.message);
    toast('success', d.bez_zmian ? 'Bez zmian — wersja ' + d.wersja : (stan === 'zatwierdzona' ? 'Skład zatwierdzony — wersja ' + d.wersja : 'Oferta odrzucona'), d.zakupy_na_starych_wersjach ? `${d.zakupy_na_starych_wersjach} istniejących zakupów pozostaje przy wcześniejszej wersji` : '');
    PZ().edycja = null; ustPakietyZaladuj();
  };
  // ── 2. Przygotowanie zakupów (Z3-03): podgląd → jawne potwierdzenie → idempotentna rejestracja
  function pzPrzygotowanie() {
    const pz = PZ(); const p = pz.podglad;
    const filtry = `<div class="trm-row" style="flex-wrap:wrap;gap:8px;margin-bottom:8px"><div><label>ID klientki (opcjonalnie)</label><input value="${esc(pz.filtrKlient)}" oninput="TRM.ust.pz.filtrKlient=this.value" style="width:140px" placeholder="np. 1023"></div><div><label>Sprzedaż od</label><input type="date" value="${esc(pz.od)}" oninput="TRM.ust.pz.od=this.value"></div><div><label>do</label><input type="date" value="${esc(pz.do)}" oninput="TRM.ust.pz.do=this.value"></div><div><label>&nbsp;</label><button class="trm-btn primary" onclick="TRM.pzPodglad()">Pokaż źródła</button></div></div>`;
    let tresc = '';
    if (p === 'ladowanie') tresc = '<div class="muted small">⏳ Sprawdzamy sprzedaże…</div>';
    else if (p && p.blad) tresc = `<div class="trm-note bad small">Nie udało się sprawdzić zakupów: ${esc(p.blad)} <button class="trm-btn link sm" onclick="TRM.pzPodglad()">Spróbuj ponownie</button></div>`;
    else if (p) {
      const l = p.liczniki || {}; const pigulki = Object.keys(KATEGORIA_LABEL).filter(k => l[k]).map(k => pill([`${KATEGORIA_LABEL[k][0]}: ${l[k]}`, KATEGORIA_LABEL[k][1]])).join(' ');
      const doZazn = p.pozycje.filter(x => x.kategoria === 'gotowe' || x.kategoria === 'wymaga_rozstrzygniecia');
      const wiersz = (x) => { const k = KATEGORIA_LABEL[x.kategoria] || [x.kategoria, 'neu']; const rz = pz.rozstrz[x.sprzedaz_id] || {}; const mozna = x.kategoria === 'gotowe' || x.kategoria === 'wymaga_rozstrzygniecia';
        const rozstrz = x.kategoria !== 'wymaga_rozstrzygniecia' ? '' : (x.wersje_do_wyboru ? `<select onchange="TRM.pzRozstrz('${esc(x.sprzedaz_id)}','wersja_id',this.value)" aria-label="wersja składu"><option value="">— wskaż wersję składu —</option>${x.wersje_do_wyboru.map(w => `<option value="${w.id}" ${String(rz.wersja_id) === String(w.id) ? 'selected' : ''}>wersja ${w.wersja} (${RODZAJ_LABEL[w.rodzaj] || w.rodzaj})</option>`).join('')}</select>` : x.niejednoznaczne ? `<input placeholder="ID dopłat do powiązania (po przecinku) albo puste" value="${esc(rz.powiazane || '')}" oninput="TRM.pzRozstrz('${esc(x.sprzedaz_id)}','powiazane',this.value)">` : !x.id_klienta ? `<input placeholder="ID klientki z kartoteki" value="${esc(rz.id_klienta || '')}" oninput="TRM.pzRozstrz('${esc(x.sprzedaz_id)}','id_klienta',this.value)" style="width:150px">` : '');
        return `<tr class="pz-${x.kategoria}"><td>${mozna ? `<input type="checkbox" ${pz.zazn[x.sprzedaz_id] ? 'checked' : ''} onchange="TRM.ust.pz.zazn['${esc(x.sprzedaz_id)}']=this.checked" aria-label="zarejestruj ${esc(x.sprzedaz_id)}">` : ''}</td><td class="small"><b>${esc(x.data || '—')}</b><div class="muted">${esc(x.sprzedaz_id)}${x.grupa_id ? ' · egz. z grupy' : ''}</div></td><td class="small">${x.id_klienta ? 'ID ' + esc(x.id_klienta) : '<span class="trm-pill warn">bez ID</span>'}</td><td><b>${esc(x.zabieg || '')}</b>${x.szczegoly ? ' / ' + esc(x.szczegoly) : ''}${x.powiazane && x.powiazane.length ? `<div class="muted small">+ dopłata: ${esc(x.powiazane.join(', '))}</div>` : ''}${x.skladniki ? `<div class="muted small">${x.skladniki.map(s => `${s.jednostki} × ${esc((pz.oferty || []).find(o => String(o.usluga_id) === String(s.usluga_wyk_id)) ? (pz.oferty.find(o => String(o.usluga_id) === String(s.usluga_wyk_id))).nazwa : s.usluga_wyk_id)}`).join(', ')}${x.wersja ? ` · wersja ${x.wersja}` : ''}</div>` : ''}</td><td>${pill(k)}<div class="small" style="margin-top:4px">${esc(x.powod || '')}</div>${rozstrz ? `<div style="margin-top:6px">${rozstrz}</div>` : ''}</td></tr>`; };
      const wyn = pz.wynikRej ? `<div class="trm-note ${pz.wynikRej.pominieto ? 'warn' : 'ok'} small" style="margin:8px 0"><b>Wynik rejestracji:</b> zarejestrowano ${pz.wynikRej.zarejestrowano}, już było ${pz.wynikRej.istnialo}, pominięto/do rozstrzygnięcia ${pz.wynikRej.pominieto}.${pz.wynikRej.powtorzenie ? ' (ponowienie — wynik zapisany wcześniej)' : ''}<ul class="small" style="margin:6px 0 0 16px">${pz.wynikRej.wyniki.map(w => `<li>${esc(w.sprzedaz_id)}: ${esc(w.wynik)}${w.powod ? ' — ' + esc(w.powod) : ''}${w.kwalifikacja === 'do_sprawdzenia' ? ' — <b>potwierdź kwalifikację „1×” w zakładce Stan</b>' : ''}</li>`).join('')}</ul></div>` : '';
      tresc = `<div class="trm-row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px">${pigulki || '<span class="muted small">Brak sprzedaży w tym zakresie.</span>'}<span class="trm-spacer"></span><span class="muted small">sprawdzono ${esc((p.sprawdzono || '').slice(0, 16))}</span></div>${wyn}
        <div style="overflow:auto"><table class="trm-oferty pz-tabela"><thead><tr><th><input type="checkbox" aria-label="zaznacz wszystkie gotowe" onchange="TRM.pzZaznaczWszystkie(this.checked)"></th><th>Sprzedaż</th><th>Klientka</th><th>Oferta i skład</th><th>Stan</th></tr></thead><tbody>${p.pozycje.map(wiersz).join('')}</tbody></table></div>
        <div class="trm-row" style="margin-top:10px;flex-wrap:wrap"><div class="trm-pomoc" style="flex:1;min-width:240px">Podgląd niczego nie zapisuje. Rejestracja tworzy zakupy ze <b>stanem do sprawdzenia</b> (puste dane historyczne nie są zerem) — nie rezerwuje wizyt i nie odejmuje zabiegów. Powtórzenie nie tworzy duplikatów.</div><button class="trm-btn primary fix" onclick="TRM.pzRejestruj()" ${doZazn.length ? '' : 'disabled'}>Zarejestruj zaznaczone (${Object.keys(pz.zazn).filter(k => pz.zazn[k]).length})</button></div>`;
    } else tresc = '<div class="trm-pomoc">Wybierz zakres i kliknij „Pokaż źródła”. Zobaczysz, które sprzedaże są gotowe do zarejestrowania jako zakupy, które wymagają mapowania albo decyzji, a które są pomijane (produkty, zwroty, dopłaty, zwykłe „1x”).</div>';
    return `<div class="trm-card"><h3>Przygotowanie zakupów</h3>${filtry}${tresc}</div>`;
  }
  TRM.pzPodglad = async () => { const pz = PZ(); pz.podglad = 'ladowanie'; pz.wynikRej = null; renderUstawienia(); const d = await api('trm_zakupy_podglad', { id_klienta: pz.filtrKlient || null, od: pz.od || null, do: pz.do || null }); pz.podglad = d.status === 'success' ? d : { blad: d.message }; pz.kluczRej = uuid(); pz.zazn = {}; renderUstawienia(); };
  TRM.pzRozstrz = (sid, pole, v) => { const pz = PZ(); pz.rozstrz[sid] = { ...(pz.rozstrz[sid] || {}), [pole]: v }; };
  TRM.pzZaznaczWszystkie = (on) => { const pz = PZ(); (pz.podglad && pz.podglad.pozycje || []).forEach(x => { if (x.kategoria === 'gotowe') pz.zazn[x.sprzedaz_id] = on; }); renderUstawienia(); };
  TRM.pzRejestruj = async () => {
    const pz = PZ(); const ids = Object.keys(pz.zazn).filter(k => pz.zazn[k]); if (!ids.length) return toast('warning', 'Zaznacz sprzedaże do zarejestrowania');
    const pozycje = ids.map(sid => { const rz = pz.rozstrz[sid] || {}; return { sprzedaz_id: sid, wersja_id: rz.wersja_id || null, id_klienta: rz.id_klienta || null, powiazane: rz.powiazane !== undefined ? String(rz.powiazane).split(',').map(s => s.trim()).filter(Boolean) : undefined }; });
    const d = await api('trm_zakupy_rejestruj', { pozycje, klucz_idem: pz.kluczRej }); // ten sam klucz przy ponowieniu → ten sam wynik, bez duplikatów
    if (d.status !== 'success') return toast('error', 'Nie zarejestrowano', d.message + ' — zaznaczenie zachowane, możesz ponowić.');
    pz.wynikRej = d; toast(d.pominieto ? 'warning' : 'success', `Zarejestrowano ${d.zarejestrowano}`, d.pominieto ? `${d.pominieto} pozycji wymaga decyzji` : (d.istnialo ? `${d.istnialo} już było` : ''));
    const zareg = pz.podglad && pz.podglad.pozycje ? pz.podglad.pozycje.map(x => { const w = d.wyniki.find(y => y.sprzedaz_id === x.sprzedaz_id); return w && (w.wynik === 'zarejestrowano' || w.wynik === 'istnieje') ? { ...x, kategoria: 'istniejace', powod: w.wynik === 'zarejestrowano' ? 'zarejestrowano przed chwilą' : 'zakup już zarejestrowany', zakup_id: w.zakup_id } : x; }) : [];
    pz.podglad = { ...pz.podglad, pozycje: zareg }; pz.zazn = {}; pz.kluczRej = uuid(); pz.stan = null; renderUstawienia();
  };
  // ── 3. Sprawdź stan pakietów (Z3-04): osobna weryfikacja każdego składnika, jawne zera, kwalifikacja „1×”
  function pzStan() {
    const pz = PZ(); const st = pz.stan;
    if (!st || st === 'ladowanie') return '<div class="muted small">⏳ Wczytujemy pakiety…</div>';
    if (st.blad) return `<div class="trm-note bad small">${esc(st.blad)} <button class="trm-btn link sm" onclick="TRM.pzOdswiezStan()">Spróbuj ponownie</button></div>`;
    const skl = st.skladniki.filter(s => pz.pokazSprawdzone || s.stan_weryfikacji !== 'zweryfikowany' || s.kwalifikacja === 'do_sprawdzenia' || (pz.stanFiltrZakup && s.zakup_id === pz.stanFiltrZakup));
    const grupy = {}; skl.forEach(s => (grupy[s.zakup_id] = grupy[s.zakup_id] || []).push(s));
    const rowSkl = (s) => { const w = pz.dec['s' + s.id] || {}; const h = s.hist || {}; const v = (k) => w[k] !== undefined ? w[k] : (h[k] == null ? '' : h[k]); const zwer = s.stan_weryfikacji === 'zweryfikowany';
      return `<div class="pz-stan-wiersz ${zwer ? 'zwer' : ''}"><div class="trm-row" style="flex-wrap:wrap;gap:8px;align-items:flex-end"><div style="flex:1;min-width:160px"><b>${esc(s.usluga_nazwa)}</b><div class="small muted">Kupiono: <b>${s.saldo.G}</b>${s.saldo.R ? ` · Umówione: ${s.saldo.R}` : ''}${s.uruchomiony ? ' · ' + pill(['Uruchomiony', 'ok']) : ''} ${zwer ? pill(['Sprawdzono', 'ok']) : pill(['Do sprawdzenia', 'warn'])}</div></div>
        <div><label>Wykorzystano wcześniej</label><input type="number" min="0" style="width:90px" value="${esc(v('wykorzystane'))}" placeholder="nie wiem" oninput="TRM.pzDec('s${s.id}','wykorzystane',this.value)"></div><div><label>Wycofano</label><input type="number" min="0" style="width:80px" value="${esc(v('wycofane'))}" placeholder="nie wiem" oninput="TRM.pzDec('s${s.id}','wycofane',this.value)"></div><div><label>Potrącono</label><input type="number" min="0" style="width:80px" value="${esc(v('potracone'))}" placeholder="nie wiem" oninput="TRM.pzDec('s${s.id}','potracone',this.value)"></div>
        <div style="flex:1;min-width:200px"><label>Na podstawie czego</label><input value="${esc(w.zrodlo !== undefined ? w.zrodlo : (h.zrodlo_ustalen || ''))}" placeholder="np. zweryfikowana karta klientki" oninput="TRM.pzDec('s${s.id}','zrodlo',this.value)"></div>
        <div><label>&nbsp;</label><button class="trm-btn sm primary" onclick="TRM.pzWeryfikuj(${s.id})">${zwer ? 'Zapisz korektę' : 'Zatwierdź składnik'}</button></div></div>
        <label class="pz-zero small" style="text-transform:none;letter-spacing:0;font-weight:500;display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" onchange="TRM.pzZera(${s.id},this.checked)" ${w.zera ? 'checked' : ''} style="width:auto"> Potwierdzam brak wcześniejszego wykorzystania, wycofań i potrąceń (wpisuje 0 we wszystkie pola)</label>${h.zweryfikowal ? `<div class="muted small">sprawdził(a) ${esc(h.zweryfikowal)} ${esc((h.zweryfikowano || '').slice(0, 16))}</div>` : ''}</div>`; };
    const karta = (zid) => { const lista = grupy[zid]; const s0 = lista[0]; const wszystkieWyp = lista.every(s => ['wykorzystane', 'wycofane', 'potracone'].every(k => { const w = pz.dec['s' + s.id] || {}; const h = s.hist || {}; return (w[k] !== undefined && w[k] !== '') || h[k] != null; }));
      const kw = s0.kwalifikacja === 'do_sprawdzenia' ? `<div class="trm-note warn small" style="margin:6px 0"><b>Ta sprzedaż dokumentuje pojedynczy zabieg.</b> Potwierdź, czy zakupiono go na przyszłość. <button class="trm-btn sm fix" onclick="TRM.pzKwalifikuj(${zid},'pojedynczy_z_gory')">Kupiono na przyszłość</button> <button class="trm-btn sm fix" onclick="TRM.pzKwalifikuj(${zid},'nie_ewidencjonuj')">Nie ewidencjonuj</button></div>` : '';
      const zr = s0.stan_zrodla && s0.stan_zrodla !== 'ok' ? `<div class="trm-note bad small" style="margin:6px 0">Zakup zmienił się w Sprzedaży (${esc(s0.stan_zrodla === 'wycofane' ? 'wycofany/zwrócony' : s0.stan_zrodla === 'usuniete' ? 'usunięty' : 'do uzgodnienia')}). Sprawdź aktualne dane przed zatwierdzeniem.</div>` : '';
      const wer = lista.every(s => s.stan_weryfikacji === 'zweryfikowany') ? pill(['Sprawdzono', 'ok']) : lista.some(s => s.stan_weryfikacji === 'zweryfikowany') ? pill(['Częściowo sprawdzony', 'warn']) : pill(['Do sprawdzenia', 'warn']);
      return `<div class="trm-card pz-zakup" style="margin-bottom:10px"><div class="trm-row" style="flex-wrap:wrap"><div style="flex:1"><h3 style="font-size:15px">${esc(s0.zakup_nazwa || 'Zakup')}</h3><div class="muted small">klientka ID ${esc(s0.id_klienta)} · zakup #${zid}</div></div>${wer}${lista.length > 1 ? `<button class="trm-btn sm fix" onclick="TRM.pzWeryfikujWszystkie(${zid})" ${wszystkieWyp ? '' : 'disabled'} title="${wszystkieWyp ? '' : 'najpierw uzupełnij wszystkie wiersze (także zera)'}">Potwierdź wszystkie</button>` : ''}</div>${kw}${zr}${lista.map(rowSkl).join('')}</div>`; };
    return `<div class="trm-pomoc" style="margin-bottom:8px">Każdy składnik pakietu potwierdzasz osobno. Puste pole oznacza „nie wiem”, nie zero — składnik bez potwierdzenia nie jest dostępny do umawiania. Endermologia może już działać, gdy Meltivio nadal wymaga sprawdzenia.</div>
      <div class="trm-row" style="margin-bottom:8px"><label class="small" style="text-transform:none;letter-spacing:0;font-weight:500;display:flex;gap:6px;align-items:center"><input type="checkbox" ${pz.pokazSprawdzone ? 'checked' : ''} onchange="TRM.ust.pz.pokazSprawdzone=this.checked;renderUstawienia()" style="width:auto"> pokaż także sprawdzone</label><span class="trm-spacer"></span><button class="trm-btn sm fix" onclick="TRM.pzOdswiezStan()">Odśwież</button></div>
      ${Object.keys(grupy).length ? Object.keys(grupy).map(karta).join('') : '<div class="muted small">Brak pakietów do sprawdzenia. Zarejestruj zakupy w zakładce „Przygotowanie zakupów”.</div>'}`;
  }
  TRM.pzDec = (k, pole, v) => { const pz = PZ(); pz.dec[k] = { ...(pz.dec[k] || {}), [pole]: v }; };
  TRM.pzZera = (sid, on) => { const pz = PZ(); pz.dec['s' + sid] = { ...(pz.dec['s' + sid] || {}), wykorzystane: on ? 0 : '', wycofane: on ? 0 : '', potracone: on ? 0 : '', zera: on }; renderUstawienia(); };
  TRM.pzWeryfikuj = async (sid, cicho) => {
    const pz = PZ(); const s = (pz.stan.skladniki || []).find(x => x.id === sid); const w = pz.dec['s' + sid] || {}; const h = (s && s.hist) || {};
    const v = (k) => (w[k] !== undefined && w[k] !== '') ? w[k] : (h[k] == null ? '' : h[k]);
    const d = await api('trm_skladnik_weryfikuj', { skladnik_id: sid, hist_wykorzystane: v('wykorzystane'), hist_wycofane: v('wycofane'), hist_potracone: v('potracone'), zrodlo_ustalen: w.zrodlo !== undefined ? w.zrodlo : (h.zrodlo_ustalen || '') });
    if (d.status !== 'success') { toast('error', 'Nie zatwierdzono składnika', d.message); return false; }
    if (!cicho) { toast('success', d.powtorzenie ? 'Bez zmian' : (s ? `${s.usluga_nazwa} — sprawdzono` : 'Składnik sprawdzony'), `Do umówienia: ${Math.max(0, d.saldo.B)} · Wykorzystano: ${d.saldo.U}`); pzZaladujStan(); }
    return true;
  };
  TRM.pzWeryfikujWszystkie = async (zid) => { const pz = PZ(); const lista = (pz.stan.skladniki || []).filter(s => s.zakup_id === zid); let ok = 0; for (const s of lista) if (await TRM.pzWeryfikuj(s.id, true)) ok++; toast(ok === lista.length ? 'success' : 'warning', `Potwierdzono ${ok} z ${lista.length} składników`); pzZaladujStan(); };
  TRM.pzKwalifikuj = async (zid, kw) => { const powod = window.prompt(kw === 'pojedynczy_z_gory' ? 'Na jakiej podstawie zakup dotyczy zabiegu na przyszłość?' : 'Dlaczego nie ewidencjonujemy tej sprzedaży?'); if (powod === null) return; const d = await api('trm_zakup_kwalifikuj', { zakup_id: zid, kwalifikacja: kw, powod }); if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message); toast('success', 'Kwalifikacja zapisana'); pzZaladujStan(); };
  // ── 4. Istniejące wizyty (Z3-05) + uruchomienie (Z3-06)
  function pzWizyty() {
    const pz = PZ(); const st = pz.stan;
    if (!st || st === 'ladowanie') return '<div class="muted small">⏳ Wczytujemy pakiety…</div>';
    if (st.blad) return `<div class="trm-note bad small">${esc(st.blad)}</div>`;
    const skl = st.skladniki.filter(s => s.stan_weryfikacji === 'zweryfikowany' && s.kwalifikacja !== 'do_sprawdzenia' && s.stan === 'aktywny');
    const karta = (s) => { const k = pz.kand[s.id]; let wew = '';
      if (k === 'ladowanie') wew = '<div class="muted small">⏳ Szukamy wizyt…</div>';
      else if (k && k.blad) wew = `<div class="trm-note bad small">${esc(k.blad)}</div>`;
      else if (k) { const doDec = k.kandydaci.filter(x => !x.juz_powiazana && !x.rozliczenie); const dec = pz.dec['w' + s.id] || {}; const wyb = doDec.filter(x => (dec[x.id] || {}).decyzja === 'powiaz').reduce((a, x) => a + x.jednostki, 0); const dost = Math.max(0, k.saldo.B);
        wew = `<div class="trm-note ${k.niedobor ? 'warn' : 'info'} small" style="margin:6px 0">Masz <b>${dost}</b> ${dost === 1 ? 'zabieg' : 'zabiegów'} do przypisania i <b>${k.kandydaci.length}</b> istniejących wizyt${doDec.length ? ` — <b>${doDec.length}</b> ${doDec.length === 1 ? 'wymaga decyzji' : 'wymagają decyzji'}` : ''}.${k.niedobor ? ` Niedobór: ${k.niedobor} — rozstrzygnij nadmiarowe wizyty jako wymagające zakupu/wyjaśnienia albo dopuszczoną usługę jednorazową.` : ''}${wyb > dost ? ` <b>Wybrano ${wyb} — za dużo.</b>` : ''}</div>
          ${k.kandydaci.length ? `<div style="overflow:auto"><table class="trm-oferty pz-tabela"><thead><tr><th>Wizyta</th><th>Termin</th><th>Stan</th><th>Decyzja</th><th>Uzasadnienie</th></tr></thead><tbody>${k.kandydaci.map(x => { const d = dec[x.id] || {}; const zablok = x.juz_powiazana || x.rozliczenie; return `<tr><td class="small"><b>${esc(x.numer)}</b><div class="muted">${esc(x.pracownik || '')}</div></td><td class="small">${esc(String(x.start).slice(0, 16))}${x.przeszla ? ' <span class="trm-pill warn">przeszła, nierozstrzygnięta</span>' : ''}</td><td class="small">${esc(x.stan)}${x.juz_powiazana ? ' · ' + pill(['już powiązana', 'ok']) : x.rozliczenie ? ' · ' + pill([x.rozliczenie, 'neu']) : ''}</td><td>${zablok ? '<span class="muted small">bez decyzji</span>' : `<select onchange="TRM.pzDecW(${s.id},${x.id},'decyzja',this.value)" aria-label="decyzja"><option value="">— wybierz —</option><option value="powiaz" ${d.decyzja === 'powiaz' ? 'selected' : ''}>Z tego pakietu (rezerwuje ${x.jednostki})</option><option value="jednorazowa" ${d.decyzja === 'jednorazowa' ? 'selected' : ''}>Usługa jednorazowa (płatna osobno)</option><option value="wyjasnienie" ${d.decyzja === 'wyjasnienie' ? 'selected' : ''}>Wymaga zakupu / wyjaśnienia</option><option value="historyczna" ${d.decyzja === 'historyczna' ? 'selected' : ''}>Wykonana wcześniej, ujęta w stanie początkowym</option><option value="niezwiazana" ${d.decyzja === 'niezwiazana' ? 'selected' : ''}>Nie dotyczy tego pakietu</option></select>`}</td><td>${zablok ? '' : `<input value="${esc(d.uzasadnienie || '')}" placeholder="${['wyjasnienie', 'historyczna', 'niezwiazana'].includes(d.decyzja) ? 'wymagane' : 'opcjonalnie'}" oninput="TRM.pzDecW(${s.id},${x.id},'uzasadnienie',this.value)">`}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="muted small">Brak istniejących wizyt tej klientki na tę usługę.</div>'}
          <div class="trm-row" style="margin-top:8px;flex-wrap:wrap"><label class="small" style="text-transform:none;letter-spacing:0;font-weight:500;display:flex;gap:6px;align-items:center"><input type="checkbox" ${dec._przejrzane ? 'checked' : ''} onchange="TRM.pzDecW(${s.id},'_przejrzane','v',this.checked)" style="width:auto"> Przejrzałam/em wszystkie istniejące wizyty tej klientki</label><span class="trm-spacer"></span><button class="trm-btn sm fix" onclick="TRM.pzKandydaci(${s.id})">Odśwież listę</button><button class="trm-btn sm primary fix" onclick="TRM.pzUruchom(${s.id})">${st.ewidencja === 'aktywna' ? 'Uruchom składnik' : 'Zapisz plan powiązań'}</button></div>`; }
      return `<div class="trm-card pz-zakup" style="margin-bottom:10px"><div class="trm-row" style="flex-wrap:wrap"><div style="flex:1"><h3 style="font-size:15px">${esc(s.usluga_nazwa)} <span class="muted small">— ${esc(s.zakup_nazwa || '')}, klientka ID ${esc(s.id_klienta)}</span></h3><div class="small muted">Kupiono ${s.saldo.G} · Wykorzystano ${s.saldo.U} · Umówione ${s.saldo.R} · Do umówienia ${Math.max(0, s.saldo.B)}</div></div>${s.uruchomiony ? pill(['Uruchomiony', 'ok']) : s.ma_plan ? pill(['Plan zapisany', 'info']) : pill(['Najpierw rozstrzygnij istniejące wizyty', 'warn'])}${!s.uruchomiony ? `<button class="trm-btn sm fix" onclick="TRM.pzKandydaci(${s.id})">Istniejące wizyty</button>` : ''}${s.ma_plan && st.ewidencja === 'aktywna' ? `<button class="trm-btn sm primary fix" onclick="TRM.pzUruchom(${s.id}, true)">Uruchom z planu</button>` : ''}</div>${wew}</div>`; };
    return `<div class="trm-pomoc" style="margin-bottom:8px">Zanim pakiet zacznie działać w kalendarzu, rozstrzygnij wizyty, które już istnieją: które rozliczyć z tego pakietu (rezerwacja, nie zużycie), które są jednorazowe, a które wymagają zakupu lub wyjaśnienia. W trybie przygotowania zapisujemy plan — rezerwacje powstają dopiero przy uruchomieniu.</div>${skl.length ? skl.map(karta).join('') : '<div class="muted small">Brak sprawdzonych składników. Najpierw potwierdź stan pakietów.</div>'}`;
  }
  TRM.pzKandydaci = async (sid) => { const pz = PZ(); pz.kand[sid] = 'ladowanie'; renderUstawienia(); const d = await api('trm_skladnik_kandydaci', { skladnik_id: sid }); pz.kand[sid] = d.status === 'success' ? d : { blad: d.message }; if (d.status === 'success' && d.plan && d.plan.decyzje) { pz.dec['w' + sid] = pz.dec['w' + sid] || {}; d.plan.decyzje.forEach(x => { pz.dec['w' + sid][x.pozycja_id] = { decyzja: x.decyzja, uzasadnienie: x.uzasadnienie }; }); } renderUstawienia(); };
  TRM.pzDecW = (sid, pid, pole, v) => { const pz = PZ(); const g = pz.dec['w' + sid] = pz.dec['w' + sid] || {}; if (pid === '_przejrzane') { g._przejrzane = v; return; } g[pid] = { ...(g[pid] || {}), [pole]: v }; if (pole === 'decyzja') renderUstawienia(); };
  TRM.pzUruchom = async (sid, zPlanu) => {
    const pz = PZ(); const k = pz.kand[sid]; const dec = pz.dec['w' + sid] || {};
    const body = zPlanu ? { skladnik_id: sid, z_planu: true } : { skladnik_id: sid, skrot: k && k.skrot, potwierdzenie_zaleznych: !!dec._przejrzane, decyzje: (k && k.kandydaci || []).filter(x => !x.juz_powiazana && !x.rozliczenie).map(x => ({ pozycja_id: x.id, decyzja: (dec[x.id] || {}).decyzja || '', uzasadnienie: (dec[x.id] || {}).uzasadnienie || '' })) };
    if (!zPlanu && body.decyzje.some(x => !x.decyzja)) return toast('warning', 'Każda wizyta na liście potrzebuje decyzji');
    pz.kluczUr = pz.kluczUr || {}; pz.kluczUr[sid] = pz.kluczUr[sid] || uuid();
    const d = await api('trm_skladnik_uruchom', { ...body, klucz_idem: pz.kluczUr[sid] });
    if (d.status !== 'success') { if (d.code === 'PODGLAD_NIEAKTUALNY') { toast('warning', 'Zakup albo wizyty zmieniły się od podglądu', 'Sprawdź aktualne dane przed zatwierdzeniem.'); pz.kluczUr[sid] = null; return TRM.pzKandydaci(sid); } return toast('error', 'Nie uruchomiono', d.message); }
    pz.kluczUr[sid] = null; toast('success', d.plan ? 'Plan powiązań zapisany' : 'Składnik uruchomiony', d.plan ? `${d.powiazan} wizyt do powiązania przy uruchomieniu` : `Umówione: ${d.saldo ? d.saldo.R : d.powiazan} · Do umówienia: ${d.saldo ? Math.max(0, d.saldo.B) : '—'}`); delete pz.kand[sid]; pzZaladujStan();
  };
  // ── 5. Gotowość ewidencji (Z3-06/07) + tryb + kontrola zakupów
  function pzGotowosc() {
    const pz = PZ(); const st = pz.stan; const u = TRM.dane.ustawienia || {};
    if (!st || st === 'ladowanie') return '<div class="muted small">⏳ Sprawdzamy gotowość…</div>';
    if (st.blad) return `<div class="trm-note bad small">${esc(st.blad)}</div>`;
    const l = st.liczniki || {}; const kontrola = u.kontrola_zakupow === 'on';
    const kafel = (t, v, cls) => `<div class="pz-kafel ${cls || ''}"><div class="v">${v}</div><div class="t">${t}</div></div>`;
    const przej = (PRZEJSCIA_UI[st.ewidencja_zapisana] || []).filter(t => !(st.przerwa_od && t !== 'aktywna'));
    return `<div class="trm-grid2 pz-grid" style="align-items:start"><div class="trm-card"><h3>Tryb ewidencji</h3><div class="trm-row" style="flex-wrap:wrap;margin:6px 0"><b>${esc(TRYB_LABEL[st.ewidencja] || st.ewidencja)}</b>${st.ewidencja !== st.ewidencja_zapisana ? `<span class="muted small">(zapisany stan: ${esc(TRYB_LABEL[st.ewidencja_zapisana] || st.ewidencja_zapisana)})</span>` : ''}</div>
        ${!st.techniczna ? '<div class="trm-note bad small">Ewidencja jest technicznie niedostępna (dodatek lub schemat). Zachowaliśmy historię i wcześniejsze powiązania.</div>' : ''}${st.przerwa_od ? `<div class="trm-note warn small">Ewidencja była niedostępna od ${esc(st.przerwa_od.slice(0, 16))}. Powrót wymaga uzgodnienia: sprawdź zakupy i wizyty z przerwy, potem wznów.</div>` : ''}
        <div class="trm-row" style="flex-wrap:wrap;gap:6px;margin-top:8px">${st.techniczna ? (st.przerwa_od ? `<button class="trm-btn sm primary" onclick="TRM.pzTryb('aktywna')">Uzgodniono — wznów</button>` : przej.map(t => `<button class="trm-btn sm ${t === 'aktywna' ? 'primary' : ''}" onclick="TRM.pzTryb('${t}')">${esc({ przygotowanie: 'Przygotuj rozliczanie zakupów', aktywna: 'Uruchom ewidencję', konczenie: 'Zakończ pracę z licznikami', wstrzymana: 'Wstrzymaj awaryjnie', zakonczona: 'Zakończ ewidencję', uzgadnianie: 'Rozpocznij uzgadnianie', nie_uruchomiono: 'Cofnij przygotowanie' }[t] || t)}</button>`).join('')) : ''}</div>
        <div class="trm-pomoc" style="margin-top:8px">Dostęp techniczny (lista salonów), uruchomienie ewidencji przez managera i obowiązek zakupu przy umawianiu to trzy osobne decyzje. Schemat v2: ${st.schemat_v2 && st.schemat_v2.gotowy ? 'gotowy' : esc((st.schemat_v2 || {}).typ || 'brak')}.</div></div>
      <div class="trm-card"><h3>Kontrola zakupów przy umawianiu</h3><div class="trm-row"><label class="trm-switch"><input type="checkbox" ${kontrola ? 'checked' : ''} onchange="TRM.ustKontrolaZakupow(this.checked)"><span></span></label><div><b>${kontrola ? 'Włączona' : 'Wyłączona'}</b><div class="trm-pomoc">${kontrola ? 'Umówić można tylko zabieg z zakupu klientki z wolną jednostką.' : 'Zakupy są pokazywane w umawianiu, ale można też umówić pojedynczy zabieg z cennika.'} Wyłączenie tego obowiązku nie wyłącza ewidencji — powiązane wizyty nadal rezerwują i rozliczają jednostki.</div></div></div></div></div>
      <div class="pz-kafle" style="margin-top:12px">${kafel('zakupów', l.zakupy || 0)}${kafel('składników sprawdzonych', l.zweryfikowane || 0, 'ok')}${kafel('do sprawdzenia', l.niezweryfikowane || 0, l.niezweryfikowane ? 'warn' : '')}${kafel('uruchomionych', l.uruchomione || 0, 'ok')}${kafel('z zapisanym planem', l.z_planem || 0)}${kafel('kwalifikacji „1×” do potwierdzenia', l.kwalifikacje_do_potwierdzenia || 0, l.kwalifikacje_do_potwierdzenia ? 'warn' : '')}${kafel('zakupów zmienionych w Sprzedaży', l.zrodla_do_uzgodnienia || 0, l.zrodla_do_uzgodnienia ? 'bad' : '')}${kafel('umówionych jednostek', l.aktywne_przydzialy || 0)}${kafel('zapisanych wykonań', l.realizacje || 0)}${kafel('otwartych spraw zakupów', l.sprawy_otwarte || 0, l.sprawy_otwarte ? 'warn' : '')}</div>
      <div class="trm-pomoc" style="margin-top:8px">Składniki niesprawdzone i nieuruchomione pozostają lokalnie zablokowane — nie blokują innych klientek ani kalendarza. Przy uruchomieniu niczego nie odliczamy „za miniony czas”.</div>`;
  }
  TRM.pzTryb = async (tryb) => { if (['wstrzymana', 'zakonczona', 'konczenie'].includes(tryb) && !window.confirm({ wstrzymana: 'Wstrzymać ewidencję awaryjnie? Historia i rezerwacje zostaną zachowane; nowe operacje jednostkowe będą odrzucane.', zakonczona: 'Zakończyć ewidencję? Dalsze zabiegi nie będą aktualizować liczników.', konczenie: 'Przejść w tryb kończenia? Nowe umówienia z pakietów będą wstrzymane, istniejące nadal rozliczane.' }[tryb])) return; const d = await api('trm_ewidencja_ustaw', { tryb }); if (d.status !== 'success') return toast('error', 'Nie zmieniono trybu', d.message); TRM.dane.ustawienia = d.ustawienia || TRM.dane.ustawienia; toast('success', 'Tryb ewidencji: ' + (TRYB_LABEL[d.tryb] || d.tryb)); pzZaladujStan(); };
  TRM.ustKontrolaZakupow = async (wlacz) => {
    const u = TRM.dane.ustawienia;
    const d = await api('trm_ustawienia_zapisz', { godziny: u.godziny, siatka_min: u.siatka_min, tolerancja_min: u.tolerancja_min, horyzont_dni: u.horyzont_dni, tryb: u.tryb || 'wewnetrzny', kontrola_zakupow: wlacz ? 'on' : 'off' });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.ustawienia = { ...d.ustawienia, kontrola_zakupow: wlacz ? 'on' : 'off' }; toast('success', wlacz ? 'Kontrola zakupów włączona' : 'Kontrola zakupów wyłączona'); renderUstawienia();
  };
  // zmiana zakładki Ustawień: ostrzeżenie tylko wtedy, gdy są niezapisane zmiany (raport T14)
  TRM.ustTab = (k) => { if (TRM.ust.brudne && !window.confirm('Masz niezapisane zmiany w tej zakładce. Przejść dalej i je porzucić?')) return; TRM.ust.tab = k; TRM.widokZmien('ustawienia'); };
  document.addEventListener('input', (e) => { if (TRM.widok === 'ustawienia' && e.target.closest && e.target.closest('#trm-main') && !e.target.closest('.trm-tabs, #trm-szukaj')) TRM.ust.brudne = true; });
  const godzinyHtml = (godziny, prefix) => `<div class="trm-godz-lista">${[1, 2, 3, 4, 5, 6, 7].map(dz => { const l = godziny[dz] || []; const ma = l.length > 0; return `<div class="trm-dzien-wiersz">
      <span class="trm-dzien-nazwa">${DNI[dz]}</span>
      <label class="trm-switch"><input type="checkbox" id="${prefix}-${dz}-on" ${ma ? 'checked' : ''} onchange="TRM.godzToggle('${prefix}',${dz},this.checked)"><span></span></label>
      <div class="trm-dz-godz" id="${prefix}-${dz}-pola" ${ma ? '' : 'hidden'}>
        <input type="time" id="${prefix}-${dz}-a-od" value="${(l[0] || {}).od || '09:00'}" aria-label="${DNI[dz]}: od"> – <input type="time" id="${prefix}-${dz}-a-do" value="${(l[0] || {}).do || '17:00'}" aria-label="${DNI[dz]}: do">
        <span class="trm-dz-b" id="${prefix}-${dz}-b" ${l[1] && l[1].od && l[1].do ? '' : 'hidden'}><span class="muted small">po przerwie:</span><input type="time" id="${prefix}-${dz}-b-od" value="${(l[1] || {}).od || ''}" aria-label="${DNI[dz]}: drugi przedział od"> – <input type="time" id="${prefix}-${dz}-b-do" value="${(l[1] || {}).do || ''}" aria-label="${DNI[dz]}: drugi przedział do"><button type="button" class="trm-btn link sm" onclick="TRM.godzDrugi('${prefix}',${dz},false)">Usuń przerwę</button></span>
        <button type="button" class="trm-btn link sm" id="${prefix}-${dz}-b-btn" ${l[1] && l[1].od && l[1].do ? 'hidden' : ''} onclick="TRM.godzDrugi('${prefix}',${dz},true)">+ Dodaj przerwę</button>
      </div>
      <span class="muted small" id="${prefix}-${dz}-zamk" ${ma ? 'hidden' : ''}>Zamknięte</span>
    </div>`; }).join('')}</div>
    <div class="trm-pomoc">Drugi przedział to praca po przerwie (np. 9–13 i 15–19). Dzień bez przedziałów = zamknięte.</div>
    <button class="trm-btn link sm" type="button" onclick="TRM.godzKopiuj('${prefix}')" style="margin-top:4px">⧉ Skopiuj poniedziałek na dni robocze (wt–pt)</button>`;
  TRM.godzToggle = (prefix, dz, wlacz) => { const pola = el(`${prefix}-${dz}-pola`), zamk = el(`${prefix}-${dz}-zamk`); if (pola) pola.hidden = !wlacz; if (zamk) zamk.hidden = wlacz; };
  TRM.godzDrugi = (prefix, dz, pokaz) => { const b = el(`${prefix}-${dz}-b`), btn = el(`${prefix}-${dz}-b-btn`); if (b) b.hidden = !pokaz; if (btn) btn.hidden = pokaz; if (!pokaz) { const o = el(`${prefix}-${dz}-b-od`), d = el(`${prefix}-${dz}-b-do`); if (o) o.value = ''; if (d) d.value = ''; } };
  TRM.godzKopiuj = (prefix) => {
    const on = el(`${prefix}-1-on`).checked, aod = el(`${prefix}-1-a-od`).value, ado = el(`${prefix}-1-a-do`).value, bod = el(`${prefix}-1-b-od`).value, bdo = el(`${prefix}-1-b-do`).value;
    [2, 3, 4, 5].forEach(dz => { el(`${prefix}-${dz}-on`).checked = on; el(`${prefix}-${dz}-a-od`).value = aod; el(`${prefix}-${dz}-a-do`).value = ado; el(`${prefix}-${dz}-b-od`).value = bod; el(`${prefix}-${dz}-b-do`).value = bdo; TRM.godzToggle(prefix, dz, on); TRM.godzDrugi(prefix, dz, !!(bod && bdo)); });
    toast('success', 'Skopiowano godziny poniedziałku na wtorek–piątek');
  };
  const zbierzGodziny = (prefix) => { const g = {}; for (let dz = 1; dz <= 7; dz++) { g[dz] = []; const on = el(`${prefix}-${dz}-on`); if (on && !on.checked) continue; ['a', 'b'].forEach(x => { const odEl = el(`${prefix}-${dz}-${x}-od`), doEl = el(`${prefix}-${dz}-${x}-do`); if (!odEl || !doEl) return; const od = odEl.value, do_ = doEl.value; if (od && do_ && od < do_) g[dz].push({ od, do: do_ }); }); } return g; };
  function ustOgolne() {
    const u = TRM.dane.ustawienia;
    return `<div class="trm-grid2">
      <div class="trm-card"><h3>Godziny otwarcia salonu</h3><div class="trm-pomoc" style="margin-bottom:10px">Ustaw standardowy tydzień pracy salonu.</div>${godzinyHtml(u.godziny, 'trm-g')}</div>
      <div class="trm-card"><h3>Zasady umawiania</h3>
        <div class="trm-field"><label>Krok przesuwania wizyt (minuty)</label><select id="trm-u-siatka">${[5, 10, 15, 30].map(x => `<option value="${x}" ${u.siatka_min === x ? 'selected' : ''}>${x} minut</option>`).join('')}</select><div class="trm-pomoc">O jaką wartość przesuwać wizyty na siatce.</div></div>
        <div class="trm-field" style="margin-top:10px"><label>Planowanie z wyprzedzeniem (dni)</label><input type="number" id="trm-u-hor" min="7" max="365" value="${u.horyzont_dni}"><div class="trm-pomoc">Na ile dni do przodu można umawiać wizyty.</div></div>
        <div class="trm-field" style="margin-top:10px"><label>Przypomnienie o spóźnieniu (minuty)</label><input type="number" id="trm-u-tol" min="0" max="30" value="${u.tolerancja_min}"><div class="trm-pomoc">Po tym czasie recepcja widzi przypomnienie — to sugestia, nic nie dzieje się automatycznie.</div></div>
        <input type="hidden" id="trm-u-tryb" value="wewnetrzny">
        <details class="trm-pomoc-wiecej" style="margin-top:10px"><summary>Więcej o tych ustawieniach</summary><div class="trm-pomoc">Otwarcie salonu nie oznacza pracy konkretnej osoby — dostępność wynika z grafiku pracownika (zakładka „Grafik zespołu”). Gabinety i urządzenia są dostępne w godzinach salonu. Terminarz pracuje w trybie wewnętrznym: rezerwacje umawia wyłącznie zespół salonu.</div></details>
      </div>
    </div><div class="trm-stopka"><button class="trm-btn primary" onclick="TRM.ustZapiszOgolne()">Zapisz ustawienia</button></div>`;
  }
  TRM.ustZapiszOgolne = async () => {
    const d = await api('trm_ustawienia_zapisz', { godziny: zbierzGodziny('trm-g'), siatka_min: Number(el('trm-u-siatka').value), tolerancja_min: Number(el('trm-u-tol').value), horyzont_dni: Number(el('trm-u-hor').value), tryb: el('trm-u-tryb').value });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.ustawienia = d.ustawienia; toast('success', 'Zapisano ustawienia');
  };
  function ustZespol() {
    const z = TRM.dane.zespol || [];
    if (!z.length) return '<div class="trm-note warn">Brak pracowników.</div>';
    const uslugiOsoby = (imie) => TRM.dane.uslugi.filter(u => u.pracownicy && u.pracownicy.includes(imie));
    return `<div class="trm-card"><h3>Osoby w terminarzu</h3><div class="trm-pomoc" style="margin-bottom:8px">Włącz osoby, do których można umawiać zabiegi. Osoba wyłączona (np. tylko recepcja) nadal obsługuje terminarz, ale nie pojawia się jako wykonawca. <details class="trm-pomoc-wiecej" style="display:inline"><summary style="display:inline">Więcej</summary> To ustawienie jest niezależne od „Kto wykonuje zabieg?” przy konkretnej usłudze (zakładka Usługi) — tam zawężasz wybór wśród osób włączonych tutaj.</details></div><table class="trm-table"><thead><tr><th>Pracownik</th><th>Wykonuje zabiegi</th><th>Przypisane usługi</th><th>Grafik</th></tr></thead><tbody>
    ${z.map(p => { const us = uslugiOsoby(p.imie); return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">${avatarHtml(p.imie, true)}<div><b>${esc(p.imie)}</b>${p.rola && !p.wykonuje_zabiegi ? `<div class="muted small">${esc(p.rola)}</div>` : ''}</div></div></td>
      <td><label class="trm-switch"><input type="checkbox" ${p.wykonuje_zabiegi ? 'checked' : ''} onchange="TRM.ustZmienZespol('${esc(p.imie)}', this.checked)"><span></span></label></td>
      <td>${!p.wykonuje_zabiegi ? '<span class="muted small">Nie wykonuje zabiegów</span>' : (us.length ? `<div class="trm-chips">${us.map(u => `<span class="trm-chip on">${esc(nazwaUslugi(u))}</span>`).join('')}</div>` : '<span class="muted small">bez ograniczeń (wszystkie usługi)</span>')}</td>
      <td>${p.wykonuje_zabiegi ? `<button class="trm-btn link sm" onclick="TRM.ust.tab='grafik';TRM.ust.prac='${esc(p.imie).replace(/'/g, "\\'")}';TRM.widokZmien('ustawienia')">Edytuj grafik →</button>` : '<span class="muted small">—</span>'}</td>
    </tr>`; }).join('')}
    </tbody></table></div>`;
  }
  TRM.ustZmienZespol = async (kto, wartosc) => {
    const d = await api('trm_zespol_zapisz', { pracownik_zespol: kto, wykonuje_zabiegi: wartosc });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.zespol = d.zespol; TRM.dane.pracownicy = d.pracownicy;
    toast('success', wartosc ? 'Wykonuje zabiegi' : 'Tylko recepcja', kto); renderUstawienia();
  };
  function uslugaDetalHtml(u) {
    const zas = TRM.dane.zasoby.filter(z => z.aktywny && !z.zarchiwizowano), gab = zas.filter(z => z.typ === 'gabinet'), urz = zas.filter(z => z.typ === 'urzadzenie');
    const prac = TRM.dane.pracownicy;
    return `<div class="trm-row" style="justify-content:space-between;align-items:flex-start">
      <div><h3 style="margin:0">${esc(nazwaUslugi(u))}</h3>${u.cena != null ? `<div class="muted small">${zl(u.cena)}</div>` : ''}</div>
      <label class="trm-switch" title="Można umawiać"><input type="checkbox" id="trm-us-akt" ${u.aktywna ? 'checked' : ''}><span></span></label>
    </div>
    <div class="trm-grid2" style="margin-top:12px">
      <div class="trm-field"><label>Czas zabiegu (min)</label><input type="number" id="trm-us-czas" min="5" max="480" step="5" value="${u.czas_min || ''}" placeholder="np. 40"></div>
      <div class="trm-field"><label>Bufor przed (min)</label><input type="number" id="trm-us-bp" min="0" max="120" value="${u.bufor_przed_min}"></div>
      <div class="trm-field"><label>Bufor po (min)</label><input type="number" id="trm-us-ba" min="0" max="120" value="${u.bufor_po_min}"></div>
      <div class="trm-field"><label>Bufor dotyczy</label><select id="trm-us-bd">${[['oba', 'osoba + gabinet/sprzęt'], ['pracownik', 'tylko osoba'], ['gabinet', 'tylko gabinet/sprzęt'], ['brak', 'brak']].map(([k, n]) => `<option value="${k}" ${u.bufor_dotyczy === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    ${powodyKonfiguracji(u).length ? `<div class="trm-note warn small" style="margin-top:10px">Wymaga konfiguracji: ${esc(powodyKonfiguracji(u).join(', '))}.</div>` : ''}
    <div class="trm-field" style="margin-top:10px"><label>Kto wykonuje zabieg?</label>
      <div class="trm-radio"><label><input type="radio" name="trm-us-kto" value="wszyscy" ${u.pracownicy && u.pracownicy.length ? '' : 'checked'} onchange="TRM.ustRadio('trm-us-kto-chipy', false)"> Wszyscy wykonujący zabiegi (${prac.length})</label><label><input type="radio" name="trm-us-kto" value="wybrani" ${u.pracownicy && u.pracownicy.length ? 'checked' : ''} onchange="TRM.ustRadio('trm-us-kto-chipy', true)"> Tylko wybrane osoby</label></div>
      <div id="trm-us-kto-chipy" ${u.pracownicy && u.pracownicy.length ? '' : 'hidden'}><div class="trm-chips">${prac.length ? prac.map(p => `<span class="trm-chip pr ${u.pracownicy && u.pracownicy.includes(p) ? 'on' : ''}" data-id="${esc(p)}" role="button" tabindex="0" onclick="this.classList.toggle('on')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">${esc(p)}</span>`).join('') : '<span class="muted small">brak pracowników</span>'}</div></div>
    </div>
    <div class="trm-field" style="margin-top:10px"><label style="text-transform:none;letter-spacing:0"><input type="checkbox" id="trm-us-wg" ${u.wymaga_gabinet ? 'checked' : ''} style="width:auto;min-height:0;margin-right:6px">Wymaga gabinetu</label>
      ${gab.length ? `<div class="trm-chips" style="margin-top:6px">${gab.map(g => `<span class="trm-chip gab ${u.gabinety && u.gabinety.map(Number).includes(g.id) ? 'on' : ''}" data-id="${g.id}" role="button" tabindex="0" onclick="this.classList.toggle('on')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">${esc(g.nazwa)}</span>`).join('')}</div><div class="trm-pomoc">Bez zaznaczenia: dowolny wolny gabinet.</div>` : '<div class="trm-pomoc">Brak gabinetów — dodaj w zakładce „Gabinety i urządzenia”.</div>'}
    </div>
    <div class="trm-field" style="margin-top:10px"><label>Urządzenie</label>
      <div class="trm-radio"><label><input type="radio" name="trm-us-urz" value="nie" ${(u.urzadzenia || []).length ? '' : 'checked'} onchange="TRM.ustRadio('trm-us-urz-chipy', false)"> Nie wymaga urządzenia</label><label><input type="radio" name="trm-us-urz" value="tak" ${(u.urzadzenia || []).length ? 'checked' : ''} ${urz.length ? '' : 'disabled'} onchange="TRM.ustRadio('trm-us-urz-chipy', true)"> Wymaga jednego z wybranych</label></div>
      <div id="trm-us-urz-chipy" ${(u.urzadzenia || []).length ? '' : 'hidden'}>${urz.length ? `<div class="trm-chips">${urz.map(g => `<span class="trm-chip urz ${(u.urzadzenia || []).map(Number).includes(g.id) ? 'on' : ''}" data-id="${g.id}" role="button" tabindex="0" onclick="this.classList.toggle('on')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">${esc(g.nazwa)}</span>`).join('')}</div><div class="trm-pomoc">Estelio wybierze wolną jednostkę z zaznaczonych.</div>` : '<div class="trm-pomoc">Brak urządzeń — dodaj w zakładce „Gabinety i urządzenia”.</div>'}</div>
    </div>
    ${wariantyRodzenstwa(u).length ? `<div class="trm-pomoc" style="margin-top:8px">Warianty ilościowe tej usługi (${wariantyRodzenstwa(u).map(x => esc(x.wariant || '')).join(', ')}) to ta sama czynność. <button type="button" class="trm-btn link sm" onclick="TRM.ustZastosujDoWariantow('${esc(u.id)}')" ${u.skonfigurowana ? '' : 'disabled'}>Zastosuj czas i zasoby do ${wariantyRodzenstwa(u).length} wariantów</button></div>` : ''}
    <div class="trm-stopka"><button class="trm-btn primary" onclick="TRM.ustZapiszUsluge('${esc(u.id)}')">Zapisz zmiany</button></div>`;
  }
  // co brakuje, żeby usługę dało się umawiać (raport T02 pkt 7: konkretny powód zamiast „do ustawienia”)
  function powodyKonfiguracji(u) {
    const p = [];
    if (u.czas_min == null) p.push('brak czasu trwania');
    if (!u.aktywna) p.push('wyłączona w terminarzu');
    if (u.pracownicy && u.pracownicy.length && !u.pracownicy.some(x => TRM.dane.pracownicy.includes(x))) p.push('żadna z wybranych osób nie wykonuje już zabiegów');
    return p;
  }
  // warianty ilościowe tej samej czynności: ta sama kategoria i wariant różniący się tylko końcówką „Nx” (np. „1 obszar 1x/4x/6x”)
  const bazaWariantu = (w) => String(w || '').replace(/\s*\d+\s*[x×]\s*$/i, '').trim().toLowerCase();
  function wariantyRodzenstwa(u) {
    if (!/\d+\s*[x×]\s*$/i.test(String(u.wariant || ''))) return [];
    return TRM.dane.uslugi.filter(x => x.id !== u.id && x.kategoria === u.kategoria && bazaWariantu(x.wariant) === bazaWariantu(u.wariant));
  }
  TRM.ustRadio = (idKontenera, pokaz) => { const k = el(idKontenera); if (k) k.hidden = !pokaz; };
  TRM.ustZastosujDoWariantow = async (uslugaId) => {
    const u = TRM.dane.uslugi.find(x => x.id === uslugaId); if (!u || !u.skonfigurowana) return;
    const cele = wariantyRodzenstwa(u); if (!cele.length) return;
    // R07: pokaż konkretne pozycje i wartości przed/po; to pomoc przejściowa — sprawdź, czy to naprawdę ta sama czynność (obszar, technologia, czas)
    const opisKonf = (x) => `${x.czas_min != null ? x.czas_min + ' min' : 'brak czasu'}, bufor ${x.bufor_przed_min || 0}/${x.bufor_po_min || 0}, ${x.wymaga_gabinet ? 'gabinet' : 'bez gabinetu'}, ${(x.urzadzenia || []).length ? 'urządzenie' : 'bez urządzenia'}, ${x.pracownicy && x.pracownicy.length ? x.pracownicy.length + ' os.' : 'wszyscy'}`;
    if (!window.confirm(`Skopiować konfigurację z „${nazwaUslugi(u)}” (${opisKonf(u)}) do poniższych pozycji? Sprawdź, czy to na pewno ta sama czynność — inny obszar, technologia lub czas to osobna usługa.\n\n${cele.map(x => `• ${nazwaUslugi(x)}\n   teraz: ${opisKonf(x)}\n   po:    ${opisKonf(u)}`).join('\n')}\n\nCeny, włączenie/wyłączenie i historia każdej pozycji zostają bez zmian.`)) return;
    let ok = 0, blad = null;
    for (const c of cele) {
      const d = await api('trm_usluga_zapisz', { usluga_id: c.id, czas_min: u.czas_min, bufor_przed_min: u.bufor_przed_min, bufor_po_min: u.bufor_po_min, bufor_dotyczy: u.bufor_dotyczy, wymaga_gabinet: u.wymaga_gabinet, gabinety: u.gabinety || [], urzadzenia: u.urzadzenia || [], pracownicy: u.pracownicy || [], aktywna: c.aktywna });
      if (d.status === 'success') { ok++; TRM.dane.uslugi = d.uslugi; } else { blad = d.message; break; }
    }
    if (blad) toast('error', `Zastosowano do ${ok} z ${cele.length}`, blad); else toast('success', `Zastosowano do ${ok} wariantów`);
    renderUstawienia();
  };
  function ustUslugi() {
    const wszystkie = TRM.dane.uslugi;
    const gotowe = wszystkie.filter(u => u.skonfigurowana).length, doUst = wszystkie.length - gotowe;
    const zak = TRM.ust.uslZakladka || 'wszystkie';
    const fr = (TRM.ust.uslFiltr || '').toLowerCase();
    const lista = wszystkie.filter(u => (zak === 'gotowe' ? u.skonfigurowana : zak === 'do_ustawienia' ? !u.skonfigurowana : true) && (!fr || nazwaUslugi(u).toLowerCase().includes(fr)));
    if (TRM.ust.uslWybrana == null || !wszystkie.some(u => u.id === TRM.ust.uslWybrana)) TRM.ust.uslWybrana = lista[0] ? lista[0].id : null;
    const wyb = wszystkie.find(u => u.id === TRM.ust.uslWybrana);
    return `<div class="trm-grid2">
      <div class="trm-card">
        <h3>Usługi w terminarzu</h3>
        <input placeholder="Szukaj zabiegu…" value="${esc(TRM.ust.uslFiltr || '')}" oninput="TRM.ust.uslFiltr=this.value;TRM.widokZmien('ustawienia')" style="margin-bottom:8px">
        <div class="trm-segment" style="width:100%;margin-bottom:10px">
          <button type="button" style="flex:1" class="${zak === 'gotowe' ? 'active' : ''}" onclick="TRM.ust.uslZakladka='gotowe';TRM.widokZmien('ustawienia')">Gotowe ${gotowe}</button>
          <button type="button" style="flex:1" class="${zak === 'do_ustawienia' ? 'active' : ''}" onclick="TRM.ust.uslZakladka='do_ustawienia';TRM.widokZmien('ustawienia')">Do ustawienia ${doUst}</button>
        </div>
        <div style="max-height:520px;overflow:auto">${lista.length ? lista.map(u => `<div class="trm-usl-wiersz ${u.id === TRM.ust.uslWybrana ? 'wybrana' : ''}" onclick="TRM.ust.uslWybrana='${esc(u.id)}';TRM.widokZmien('ustawienia')">
          <span class="trm-usl-kropka" style="background:${kolorKat(u)}"></span>
          <div><b>${esc(nazwaUslugi(u))}</b><div class="muted small">${powodyKonfiguracji(u).length ? esc(powodyKonfiguracji(u).join(', ')) : u.czas_min + ' min' + (u.pracownicy && u.pracownicy.length ? ' · ' + u.pracownicy.length + ' os.' : '')}</div></div>
          <span class="trm-usl-strzalka">›</span>
        </div>`).join('') : '<div class="muted small" style="padding:8px 0">Brak usług.</div>'}</div>
      </div>
      <div class="trm-card">${wyb ? uslugaDetalHtml(wyb) : '<div class="trm-empty"><p>Wybierz zabieg, aby ustawić jego umawianie.</p></div>'}</div>
    </div>`;
  }
  TRM.ustZapiszUsluge = async (uslugaId) => {
    const u = TRM.dane.uslugi.find(x => x.id === uslugaId); if (!u) return;
    const chips = (kl) => [...document.querySelectorAll('.trm-chip.' + kl + '.on')].map(c => c.dataset.id);
    // jawny wybór zamiast „pusta lista = wszyscy” (raport T11); backend zachowuje dotychczasową semantykę (null = wszyscy)
    const kto = (document.querySelector('input[name="trm-us-kto"]:checked') || {}).value || 'wszyscy';
    const pracownicyWyb = kto === 'wybrani' ? chips('pr') : [];
    if (kto === 'wybrani' && !pracownicyWyb.length) return toast('warning', 'Wybierz co najmniej jedną osobę', 'albo zaznacz „Wszyscy wykonujący zabiegi”.');
    const urzTryb = (document.querySelector('input[name="trm-us-urz"]:checked') || {}).value || 'nie';
    const urzWyb = urzTryb === 'tak' ? chips('urz') : [];
    if (urzTryb === 'tak' && !urzWyb.length) return toast('warning', 'Wybierz co najmniej jedno urządzenie', 'albo zaznacz „Nie wymaga urządzenia”.');
    const d = await api('trm_usluga_zapisz', { usluga_id: u.id, czas_min: el('trm-us-czas').value || null, bufor_przed_min: el('trm-us-bp').value, bufor_po_min: el('trm-us-ba').value, bufor_dotyczy: el('trm-us-bd').value, wymaga_gabinet: el('trm-us-wg').checked, gabinety: chips('gab'), urzadzenia: urzWyb, pracownicy: pracownicyWyb, aktywna: el('trm-us-akt').checked });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    TRM.dane.uslugi = d.uslugi; toast('success', 'Zapisano usługę', nazwaUslugi(u)); renderUstawienia();
  };
  function zasobKartaHtml(x) {
    return `<div class="trm-zasob-karta">
      <span class="trm-zasob-ikona">${x.typ === 'gabinet' ? '🚪' : '⚙️'}</span>
      <div class="trm-zasob-info"><b>${esc(x.nazwa)}</b><div class="muted small">${x.pojemnosc} ${x.pojemnosc === 1 ? 'wizyta jednocześnie' : 'wizyty jednocześnie'}</div></div>
      ${x.zarchiwizowano ? pill(['Zarchiwizowany', 'neu']) : pill(['Aktywny', 'ok'])}
      ${!x.zarchiwizowano ? `<button class="trm-btn sm fix" onclick="TRM.ustArchiwizuj(${x.id}, false)">Archiwizuj</button>` : ''}
    </div>`;
  }
  function ustZasoby() {
    const z = TRM.dane.zasoby;
    const lista = (typ, pustyTekst) => { const l = z.filter(x => x.typ === typ); return l.length ? l.map(zasobKartaHtml).join('') : `<div class="trm-empty" style="padding:18px 8px"><p>${pustyTekst}</p><button class="trm-btn primary sm" onclick="TRM.ustFokusDodaj('${typ}')">${typ === 'gabinet' ? '+ Dodaj pierwszy gabinet' : '+ Dodaj pierwsze urządzenie'}</button></div>`; };
    return `<div class="trm-grid2">
      <div class="trm-card"><div class="trm-row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">Gabinety</h3><button class="trm-btn sm fix" onclick="TRM.ustFokusDodaj('gabinet')">+ Dodaj gabinet</button></div>${lista('gabinet', 'Brak gabinetów. Bez gabinetu umawiasz tylko usługi, które go nie wymagają.')}</div>
      <div class="trm-card"><div class="trm-row" style="justify-content:space-between;margin-bottom:6px"><h3 style="margin:0">Urządzenia</h3><button class="trm-btn sm fix" onclick="TRM.ustFokusDodaj('urzadzenie')">+ Dodaj urządzenie</button></div>${lista('urzadzenie', 'Brak urządzeń. Dodaj każde fizyczne urządzenie osobno (np. „LPG 1”, „LPG 2”), żeby kolizje i serwis liczyły się per sztuka.')}</div>
    </div>
    <div class="trm-card" style="margin-top:12px" id="trm-zs-dodaj"><h3>Nowy zasób</h3><div class="trm-grid2" style="grid-template-columns:140px 1fr 170px auto;align-items:end">
      <div class="trm-field" style="margin:0"><label>Rodzaj</label><select id="trm-zs-typ"><option value="gabinet">Gabinet</option><option value="urzadzenie">Urządzenie</option></select></div>
      <div class="trm-field" style="margin:0"><label>Nazwa</label><input id="trm-zs-nazwa" placeholder="np. Gabinet 1 albo LPG 1"></div>
      <div class="trm-field" style="margin:0"><label>Jednoczesne wizyty</label><input type="number" id="trm-zs-poj" value="1" min="1" max="50" aria-label="Ile wizyt jednocześnie obsługuje ten zasób"></div>
      <button class="trm-btn primary" onclick="TRM.ustDodajZasob()">Dodaj</button>
    </div><div class="trm-pomoc">„Jednoczesne wizyty” = 1 dla zwykłego gabinetu i każdego fizycznego urządzenia. Większą liczbę ustaw tylko dla sali, w której naprawdę odbywa się kilka wizyt naraz. Blokady serwisowe dodasz w zakładce „Nieobecności i blokady”.</div></div>`;
  }
  TRM.ustFokusDodaj = (typ) => { const sel = el('trm-zs-typ'); if (sel) sel.value = typ; const form = el('trm-zs-dodaj'); if (form) form.scrollIntoView({ block: 'center' }); const nazwa = el('trm-zs-nazwa'); if (nazwa) nazwa.focus(); };
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
    // C02: do pól stałego harmonogramu trafiają TYLKO reguły cykliczne — wyjątki dnia (od_daty = do_daty) mają własny edytor w obsadzie
    const g = {}; TRM.dane.grafik.filter(x => x.pracownik === kto_ && !jestWyjatkiem(x)).forEach(x => { (g[x.dzien_tyg] = g[x.dzien_tyg] || []).push({ od: x.od, do: x.do }); });
    const bez = prac.filter(p => !TRM.dane.grafik.some(x => x.pracownik === p));
    return obsadaTabela(prac) +
    `${bez.length ? `<div class="trm-note warn small">Bez grafiku: ${bez.map(esc).join(', ')}. <button class="trm-btn sm" onclick="TRM.ustGrafikZSalonu()">Skopiuj godziny salonu do osób bez grafiku</button></div>` : ''}
    <div class="trm-card" id="trm-grafik-osoba"><div class="trm-row" style="margin-bottom:10px"><div class="fix"><label>Stały harmonogram osoby</label><select onchange="TRM.ust.prac=this.value;TRM.widokZmien('ustawienia')" style="width:auto">${prac.map(p => `<option ${p === kto_ ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div><div class="trm-pomoc" style="align-self:flex-end">Reguła cykliczna (co tydzień). Zmiana nie odwołuje wizyt — najpierw pokażemy listę zagrożonych terminów.</div></div>
    ${godzinyHtml(g, 'trm-gr')}<div class="trm-stopka"><span class="muted small fix">Stały harmonogram: <b>${esc(kto_)}</b></span><button class="trm-btn primary" onclick="TRM.ustZapiszGrafik(false)">Zapisz grafik</button></div></div>`;
  }
  // zbiorczy podgląd obsady: pracownicy w wierszach, realne dni wybranego tygodnia w kolumnach (raport T09)
  function obsadaTabela(prac) {
    const od = TRM.ust.tydzienOd || poniedzialek(dzisStr()); TRM.ust.tydzienOd = od;
    const dni = [0, 1, 2, 3, 4, 5, 6].map(i => dodajDni(od, i)), dzis = dzisStr();
    const nieob = TRM.dane.nieobecnosci || [];
    const wyb = TRM.ust.dzien; // R05: wybrana komórka {prac, data}
    const kom = (p, dz) => {
      const wyj = wyjatkiDnia(p, dz);
      const g = wyj.length ? wyj.filter(x => !(x.od === '00:00' && x.do === '00:00')) : TRM.dane.grafik.filter(x => x.pracownik === p && Number(x.dzien_tyg) === dzienTyg(dz) && !jestWyjatkiem(x) && (!x.od_daty || x.od_daty <= dz) && (!x.do_daty || x.do_daty >= dz));
      const bl = nieob.filter(n => n.pracownik === p && String(n.od).slice(0, 10) <= dz && String(n.do).slice(0, 10) >= dz);
      const txt = g.length ? g.map(x => x.od + '–' + x.do).join(', ') : 'wolne';
      const akt = wyb && wyb.prac === p && wyb.data === dz;
      return `<span class="kom ${bl.length ? 'blok' : g.length ? '' : 'wolne'} ${wyj.length ? 'wyjatek' : ''} ${akt ? 'akt' : ''}" role="button" tabindex="0" aria-pressed="${akt ? 'true' : 'false'}" onclick="TRM.ustDzienWybierz('${esc(p).replace(/'/g, "\\'")}','${dz}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}" aria-label="${esc(p)}, ${esc(ladnaData(dz, true))}: ${esc(txt)}${wyj.length ? ' (wyjątek dnia)' : ''} — zmień ten dzień">${esc(txt)}${wyj.length ? '<br><small>wyjątek dnia</small>' : ''}${bl.length ? `<br><small>${esc(bl.map(b => b.typ + ' ' + String(b.od).slice(11, 16) + '–' + String(b.do).slice(11, 16)).join(', '))}</small>` : ''}</span>`;
    };
    return `<div class="trm-card"><div class="trm-row" style="margin-bottom:8px"><h3 style="margin:0">Obsada zespołu</h3><div class="trm-spacer"></div><button class="trm-btn sm fix" onclick="TRM.ustTydzien(-1)" aria-label="Poprzedni tydzień">‹</button><span class="fix small"><b>${esc(ladnaData(od, true))} – ${esc(ladnaData(dni[6], true))}</b></span><button class="trm-btn sm fix" onclick="TRM.ustTydzien(1)" aria-label="Następny tydzień">›</button><button class="trm-btn sm fix" onclick="TRM.ustTydzien(0)">Ten tydzień</button></div>
    <div style="overflow:auto"><table class="trm-obsada"><thead><tr><th>Osoba</th>${dni.map(dz => `<th class="${dz === dzis ? 'dzis' : ''}">${DNI_K[dzienTyg(dz)]} ${dz.slice(8, 10)}.${dz.slice(5, 7)}</th>`).join('')}</tr></thead><tbody>${prac.map(p => `<tr><td class="os">${esc(p)}</td>${dni.map(dz => `<td>${kom(p, dz)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="trm-pomoc">Zielone = grafik tego dnia, żółte = nieobecność/blokada, szare = wolne, obramowanie przerywane = wyjątek tylko na ten dzień. Kliknij komórkę, aby zmienić <b>ten jeden dzień</b> (skrócony dzień, dodatkowa zmiana, dzień wolny) bez ruszania stałego harmonogramu.</div>
    ${wyb && prac.includes(wyb.prac) ? dzienEdytorHtml(wyb) : ''}</div>`;
  }
  // R05: wyjątek dnia = wiersz grafiku z od_daty === do_daty === data; zastępuje regułę cykliczną tylko w tym dniu; 00:00–00:00 = dzień wolny
  const jestWyjatkiem = (x) => !!(x.od_daty && x.do_daty && String(x.od_daty).slice(0, 10) === String(x.do_daty).slice(0, 10));
  const wyjatkiDnia = (p, dz) => TRM.dane.grafik.filter(x => x.pracownik === p && jestWyjatkiem(x) && String(x.od_daty).slice(0, 10) === dz);
  function dzienEdytorHtml(w) {
    const wyj = wyjatkiDnia(w.prac, w.data);
    const staly = TRM.dane.grafik.filter(x => x.pracownik === w.prac && Number(x.dzien_tyg) === dzienTyg(w.data) && !jestWyjatkiem(x)).map(x => x.od + '–' + x.do).join(', ') || 'wolne';
    const tryb = TRM.ust.dzienTryb || (wyj.length && wyj.every(x => x.od === '00:00' && x.do === '00:00') ? 'wolne' : 'godziny');
    const baza = wyj.length && tryb === 'godziny' ? wyj : TRM.dane.grafik.filter(x => x.pracownik === w.prac && Number(x.dzien_tyg) === dzienTyg(w.data) && !jestWyjatkiem(x));
    const a = baza[0] || {}, b = baza[1] || {};
    const pod = TRM.ust.dzienPodglad;
    let podHtml = '';
    if (pod && pod.stan === 'czekam') podHtml = '<div class="muted small">⏳ Sprawdzamy wizyty tego dnia…</div>';
    else if (pod && pod.stan === 'blad') podHtml = `<div class="trm-note bad small">⚠ Nie udało się sprawdzić wizyt: ${esc(pod.message || 'brak odpowiedzi')} <button class="trm-btn link sm" onclick="TRM.ustDzienZmiana(true)">Sprawdź ponownie</button></div>`;
    else if (pod && pod.stan === 'ok') podHtml = pod.dotkniete.length ? `<div class="trm-note warn small"><b>⚠ Ta zmiana dotknie ${pod.dotkniete.length} ${pod.dotkniete.length === 1 ? 'wizyty' : 'wizyt'}</b> — zostaną w kalendarzu i trafią do spraw „Do działania”.${pod.dotkniete.slice(0, 8).map(x => `<div class="trm-dotknieta"><div><b>${esc(x.klient_nazwa || 'wizyta')}</b> <span class="muted">${esc(x.kategoria || '')} · ${esc((x.start || '').slice(11, 16))}–${esc((x.koniec || '').slice(11, 16))}</span></div></div>`).join('')}</div>` : '<div class="trm-note ok small">✓ Żadna zaplanowana wizyta tego dnia nie wypada poza nową dostępność. Przy zapisie sprawdzimy jeszcze raz.</div>';
    return `<div class="trm-card trm-dzien-edytor" id="trm-dzien-edytor" style="margin-top:12px"><div class="trm-row"><h3 style="margin:0">Zmień ten dzień: ${esc(w.prac)}, ${esc(ladnaData(w.data, true))}</h3><div class="trm-spacer"></div><button class="trm-x" aria-label="Zamknij" onclick="TRM.ustDzienWybierz(null)">×</button></div>
      <div class="trm-pomoc">Stały harmonogram tego dnia tygodnia: <b>${esc(staly)}</b>${wyj.length ? ' · <b>ten dzień ma już wyjątek</b>' : ''}. Zmiana dotyczy tylko tej daty.</div>
      <div class="trm-radio" style="margin-top:8px" role="radiogroup" aria-label="Tryb dnia">
        <label><input type="radio" name="trm-dz-tryb" value="godziny" ${tryb === 'godziny' ? 'checked' : ''} onchange="TRM.ust.dzienTryb='godziny';TRM.widokZmien('ustawienia');TRM.ustDzienZmiana(true)"><span>Inne godziny tego dnia</span></label>
        <label><input type="radio" name="trm-dz-tryb" value="wolne" ${tryb === 'wolne' ? 'checked' : ''} onchange="TRM.ust.dzienTryb='wolne';TRM.widokZmien('ustawienia');TRM.ustDzienZmiana(true)"><span>Dzień wolny</span></label></div>
      ${tryb === 'godziny' ? `<div class="trm-row" style="margin-top:8px"><div class="fix"><label>Od</label><input type="time" id="trm-dz-a-od" value="${esc(a.od || '')}" oninput="TRM.ustDzienZmiana()"></div><div class="fix"><label>Do</label><input type="time" id="trm-dz-a-do" value="${esc(a.do || '')}" oninput="TRM.ustDzienZmiana()"></div><div class="fix"><label>Po przerwie od</label><input type="time" id="trm-dz-b-od" value="${esc(b.od || '')}" oninput="TRM.ustDzienZmiana()"></div><div class="fix"><label>do</label><input type="time" id="trm-dz-b-do" value="${esc(b.do || '')}" oninput="TRM.ustDzienZmiana()"></div></div>` : ''}
      <div id="trm-dz-podglad" style="margin-top:8px">${podHtml}</div>
      <div class="trm-stopka">${wyj.length ? `<button class="trm-btn fix" onclick="TRM.ustDzienUsun()">Przywróć stały harmonogram</button>` : ''}<button class="trm-btn link fix" onclick="TRM.ustGrafikOsoba('${esc(w.prac).replace(/'/g, "\\'")}')">Edytuj stały harmonogram</button><div class="trm-spacer"></div><button class="trm-btn primary" onclick="TRM.ustDzienZapisz(false)">Zapisz ten dzień</button></div></div>`;
  }
  TRM.ustDzienWybierz = (p, data) => { TRM.ust.dzien = p ? { prac: p, data } : null; TRM.ust.dzienTryb = null; TRM.ust.dzienPodglad = null; renderUstawienia(); const k = el('trm-dzien-edytor'); if (k) k.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
  const dzienDane = () => {
    const w = TRM.ust.dzien; if (!w) return null;
    const tryb = (document.querySelector('input[name="trm-dz-tryb"]:checked') || {}).value || TRM.ust.dzienTryb || 'godziny';
    const przedzialy = []; ['a', 'b'].forEach(x => { const o = el(`trm-dz-${x}-od`), d = el(`trm-dz-${x}-do`); if (o && d && o.value && d.value && o.value < d.value) przedzialy.push({ od: o.value, do: d.value }); });
    return { pracownik_grafik: w.prac, data: w.data, wolne: tryb === 'wolne', przedzialy };
  };
  let dzienT = null, dzienReq = 0;
  TRM.ustDzienZmiana = (natychmiast) => { clearTimeout(dzienT); dzienT = setTimeout(ustDzienPodglad, natychmiast ? 0 : 400); };
  async function ustDzienPodglad() {
    const dane = dzienDane(); if (!dane) return;
    if (!dane.wolne && !dane.przedzialy.length) { TRM.ust.dzienPodglad = null; const k = el('trm-dz-podglad'); if (k) k.innerHTML = '<div class="muted small">Podaj godziny albo zaznacz „Dzień wolny”.</div>'; return; }
    const req = ++dzienReq; TRM.ust.dzienPodglad = { stan: 'czekam' }; const k = el('trm-dz-podglad'); if (k) k.innerHTML = '<div class="muted small">⏳ Sprawdzamy wizyty tego dnia…</div>';
    const d = await api('trm_grafik_dzien_zapisz', { ...dane, podglad: true });
    if (req !== dzienReq) return;
    TRM.ust.dzienPodglad = d.status === 'success' ? { stan: 'ok', dotkniete: d.dotkniete || [] } : { stan: 'blad', message: d.message };
    if (TRM.widok === 'ustawienia' && TRM.ust.tab === 'grafik' && el('trm-dzien-edytor')) { const box = el('trm-dz-podglad'); const tmp = document.createElement('div'); tmp.innerHTML = dzienEdytorHtml(TRM.ust.dzien); if (box) box.innerHTML = tmp.querySelector('#trm-dz-podglad').innerHTML; }
  }
  TRM.ustDzienZapisz = async (wymus) => {
    const dane = dzienDane(); if (!dane) return;
    const d = await api('trm_grafik_dzien_zapisz', { ...dane, wymus: !!wymus });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    if (d.wymaga_decyzji) { if (window.confirm(d.message + '\n\n' + d.dotkniete.slice(0, 10).map(x => `${x.start.slice(11, 16)}–${x.koniec.slice(11, 16)} ${x.klient_nazwa} — ${x.kategoria}`).join('\n') + '\n\nZapisać ten dzień mimo to? Wizyty trafią do spraw „Do działania”.')) return TRM.ustDzienZapisz(true); return; }
    TRM.dane.grafik = d.grafik; toast('success', 'Zapisano wyjątek dnia', `${dane.pracownik_grafik}, ${ladnaData(dane.data, true)}` + (d.dotkniete && d.dotkniete.length ? ` · ${d.dotkniete.length} wizyt do rozwiązania` : ''));
    TRM.ust.dzienPodglad = null; renderUstawienia();
  };
  TRM.ustDzienUsun = async () => {
    const w = TRM.ust.dzien; if (!w) return;
    const d = await api('trm_grafik_dzien_usun', { pracownik_grafik: w.prac, data: w.data });
    if (d.status !== 'success') return toast('error', 'Nie przywrócono', d.message);
    TRM.dane.grafik = d.grafik; toast('success', 'Przywrócono stały harmonogram', `${w.prac}, ${ladnaData(w.data, true)}`); TRM.ust.dzienTryb = null; TRM.ust.dzienPodglad = null; renderUstawienia();
  };
  TRM.ustTydzien = (n) => { TRM.ust.tydzienOd = n === 0 ? poniedzialek(dzisStr()) : dodajDni(TRM.ust.tydzienOd || poniedzialek(dzisStr()), 7 * n); renderUstawienia(); };
  TRM.ustGrafikOsoba = (p) => { TRM.ust.prac = p; renderUstawienia(); const k = el('trm-grafik-osoba'); if (k) k.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  TRM.ustZapiszGrafik = async (wymus) => {
    const g = zbierzGodziny('trm-gr'); const wzorce = []; Object.keys(g).forEach(dz => g[dz].forEach(p => wzorce.push({ dzien_tyg: Number(dz), od: p.od, do: p.do })));
    const d = await api('trm_grafik_zapisz', { pracownik_grafik: TRM.ust.prac, wzorce, wymus });
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message);
    if (d.wymaga_decyzji) { if (window.confirm(d.message + '\n\n' + d.dotkniete.slice(0, 10).map(x => `${x.start.slice(0, 16)} ${x.klient_nazwa} — ${x.kategoria}`).join('\n') + '\n\nZapisać grafik mimo to? (wizyty zostaną do rozwiązania)')) return TRM.ustZapiszGrafik(true); return; }
    TRM.dane.grafik = d.grafik; toast('success', 'Zapisano grafik', TRM.ust.prac); renderUstawienia();
  };
  TRM.ustGrafikZSalonu = async () => { const d = await api('trm_grafik_z_godzin_salonu', {}); if (d.status !== 'success') return toast('error', 'Nie skopiowano', d.message); TRM.dane.grafik = d.grafik; toast('success', 'Grafik uzupełniony z godzin salonu'); renderUstawienia(); };
  // Podgląd skutków blokady liczony automatycznie po zmianie formularza (raport T10): osobne stany
  // „czekam / błąd / 0 wizyt / N wizyt”, nigdy fałszywe „0” przy braku odpowiedzi. Zapis sprawdza ponownie na serwerze.
  function nieobPodgladHtml() {
    const stan = TRM.ust.nieobPodglad;
    if (!stan) return `<div class="trm-card muted small" style="display:flex;align-items:center;justify-content:center;min-height:140px;text-align:center">Wybierz kogo/czego dotyczy i zakres czasu — pokażemy, które wizyty obejmie ta blokada.</div>`;
    if (stan.stan === 'czekam') return `<div class="trm-card muted small" style="display:flex;align-items:center;justify-content:center;min-height:140px;text-align:center">⏳ Sprawdzamy wizyty w tym zakresie…</div>`;
    if (stan.stan === 'blad') return `<div class="trm-card" style="border-color:var(--t-warn-fg);background:var(--t-warn-bg)"><h3>⚠ Nie udało się sprawdzić wizyt</h3><div class="muted small">${esc(stan.message || 'brak odpowiedzi serwera')}</div><button class="trm-btn sm" style="margin-top:8px" onclick="TRM.nieobZmiana(true)">Sprawdź ponownie</button></div>`;
    const dot = stan.dotkniete || [];
    if (!dot.length) return `<div class="trm-card" style="border-color:#bfdcc9;background:var(--t-ok-bg)"><h3 style="color:var(--t-ok-fg)">✓ Ta blokada nie obejmuje żadnej zaplanowanej wizyty</h3><div class="muted small">Przy zapisie sprawdzimy to jeszcze raz — w międzyczasie ktoś mógł umówić nową wizytę.</div></div>`;
    return `<div class="trm-card" style="border-color:var(--t-warn-fg);background:var(--t-warn-bg)"><h3>⚠ Ta blokada dotknie ${dot.length} ${dot.length === 1 ? 'wizyty' : 'wizyt'}</h3>
      ${dot.slice(0, 12).map(x => `<div class="trm-dotknieta"><div><b>${esc(x.klient_nazwa || 'wizyta')}</b><br><span class="muted small">${esc(x.kategoria || '')} · ${esc(ladnaData((x.start || '').slice(0, 10), true))} ${esc((x.start || '').slice(11, 16))}–${esc((x.koniec || '').slice(11, 16))} · ${esc(x.pracownik || '')}</span></div></div>`).join('')}${dot.length > 12 ? `<div class="muted small">… i ${dot.length - 12} więcej</div>` : ''}
      <div class="muted small" style="margin-top:8px">Wizyty pozostaną w kalendarzu i trafią do spraw „Do działania” (zastępstwo, zmiana terminu, kontakt). Zapis niczego nie odwołuje.</div>
    </div>`;
  }
  let nieobT = null, nieobReq = 0;
  TRM.nieobZmiana = (natychmiast) => {
    clearTimeout(nieobT);
    const kogoEl = el('trm-nb-kogo'), od = (el('trm-nb-od') || {}).value, do_ = (el('trm-nb-do') || {}).value;
    if (!od || !do_ || (kogoEl && !kogoEl.value && (TRM.ust.nieobDotyczy || 'pracownik') !== 'salon')) { TRM.ust.nieobPodglad = null; nieobOdswiez(); return; }
    TRM.ust.nieobPodglad = { stan: 'czekam' }; nieobOdswiez();
    nieobT = setTimeout(async () => {
      const req = ++nieobReq, kogo = kogoEl ? kogoEl.value : '';
      let d; try { d = await api('trm_nieobecnosc_zapisz', { podglad: true, pracownik_nieob: kogo.startsWith('p:') ? kogo.slice(2) : null, zasob_id: kogo.startsWith('z:') ? Number(kogo.slice(2)) : null, od: od.replace('T', ' '), do: do_.replace('T', ' '), typ: (el('trm-nb-typ') || {}).value }); } catch (e) { d = null; }
      if (req !== nieobReq) return;
      TRM.ust.nieobPodglad = d && d.status === 'success' && d.podglad ? { stan: 'wynik', dotkniete: d.dotkniete || [] } : { stan: 'blad', message: d && d.message };
      nieobOdswiez();
    }, natychmiast ? 0 : 400);
  };
  function nieobOdswiez() { const p = el('trm-nb-podglad'); if (p) p.innerHTML = nieobPodgladHtml(); const b = el('trm-nb-zapisz'); if (b) { const s = TRM.ust.nieobPodglad; b.textContent = s && s.stan === 'wynik' && s.dotkniete.length ? 'Zapisz blokadę i przejdź do wizyt' : 'Zapisz blokadę'; } }
  // ─── Ustawienia → Powiadomienia e-mail (21.10.2026) ───────────────────────────────────────────
  // Decyzja o pisaniu do klientek należy do salonu, więc przełącznik stoi tutaj, a nie w naszym
  // panelu. Pokazujemy wprost dwie rzeczy, które łatwo przeoczyć: ile klientek ma w kartotece
  // adres (bez adresu nikt nic nie dostanie) i czy wysyłka jest w ogóle włączona po naszej stronie.
  function ustMaile() {
    const m = TRM.ust.maile;
    if (!m) return `<div class="trm-card"><div class="muted">⏳ Wczytuję ustawienia…</div></div>`;
    if (m.blad) return `<div class="trm-card"><div class="trm-note bad">Nie udało się wczytać ustawień: ${esc(m.blad)}</div></div>`;
    const u = m.ustawienia, p = m.pokrycie || {};
    const bezAdresu = Math.max(0, (p.wszystkie || 0) - (p.z_adresem || 0));
    const globalnie = m.tryb_globalny;
    return `<div class="trm-card">
      <h3>Powiadomienia e-mail dla klientek</h3>
      <div class="trm-pomoc" style="margin-bottom:12px">Dwie wiadomości: <b>potwierdzenie</b> zaraz po umówieniu wizyty i <b>przypomnienie</b> dzień wcześniej. Wysyłamy wyłącznie na adres z karty klientki — nigdy z innego źródła.</div>

      ${globalnie !== 'on' ? `<div class="trm-note warn" style="margin-bottom:12px">Wysyłka jest teraz wstrzymana po stronie Estelio (tryb: <b>${esc(globalnie)}</b>). Ustawienia możesz zapisać — zaczną działać, gdy wysyłka zostanie włączona.</div>` : ''}

      <label class="trm-switch-wiersz" style="display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer">
        <input type="checkbox" id="trm-m-on" ${u.wlaczone ? 'checked' : ''} style="width:20px;height:20px">
        <span><b>Wysyłaj powiadomienia o wizytach</b></span>
      </label>
      <div style="margin-left:30px">
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer"><input type="checkbox" id="trm-m-potw" ${u.potwierdzenia ? 'checked' : ''} style="width:18px;height:18px"> Potwierdzenie zaraz po umówieniu</label>
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer"><input type="checkbox" id="trm-m-przyp" ${u.przypomnienia ? 'checked' : ''} style="width:18px;height:18px"> Przypomnienie dzień przed wizytą</label>
        <div class="trm-field" style="max-width:260px"><label>O której wysyłać przypomnienie</label>
          <select id="trm-m-godz">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${u.godzina === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>
          <div class="trm-pomoc">Wieczorem dnia poprzedniego klientka ma czas odwołać rano, a Wy zdążycie obsadzić termin.</div>
        </div>
      </div>

      <div class="trm-note" style="margin:12px 0">
        <b>Do ilu klientek to dotrze:</b> ${p.z_adresem || 0} z ${p.wszystkie || 0} ma adres e-mail w kartotece${bezAdresu ? `, ${bezAdresu} nie ma go wcale` : ''}${p.bez_zgody ? `, ${p.bez_zgody} poprosiło o brak wiadomości` : ''}.
        Adres uzupełnia się w karcie klientki (Klienci → profil → Edytuj dane).
      </div>

      <div class="trm-row" style="gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div class="trm-field" style="flex:1 1 240px;margin:0"><label>Wyślij próbnie na adres</label><input id="trm-m-test" type="email" placeholder="twoj@adres.pl" value="${esc(m.salon && m.salon.email ? m.salon.email : '')}"></div>
        <button class="trm-btn fix" onclick="TRM.maileProba('potwierdzenie')">Próbka: potwierdzenie</button>
        <button class="trm-btn fix" onclick="TRM.maileProba('przypomnienie')">Próbka: przypomnienie</button>
      </div>
      <div class="trm-pomoc" style="margin-top:6px">Próbka idzie na wskazany adres z przykładową wizytą — żadna klientka jej nie dostanie.</div>

      <div class="trm-stopka"><span class="muted small fix">Nadawca: <b>${esc((m.salon && m.salon.nazwa) || 'Salon')}</b>${m.salon && m.salon.email ? ` · odpowiedzi trafią na ${esc(m.salon.email)}` : ''}</span><button class="trm-btn primary" onclick="TRM.maileZapisz()">Zapisz ustawienia</button></div>
    </div>

    <div class="trm-card" style="margin-top:12px">
      <h3>Dziennik wysyłek</h3>
      <div class="trm-pomoc" style="margin-bottom:10px">Każda wiadomość z datą, adresem i potwierdzeniem serwera pocztowego — to odpowiedź na „nie dostałam żadnego maila".</div>
      ${!m.dziennik ? '<div class="muted small">⏳ Wczytuję…</div>' : (!m.dziennik.length ? '<div class="muted small">Jeszcze nic nie wysłano.</div>' : `<table class="trm-table"><thead><tr><th>Kiedy</th><th>Klientka</th><th>Adres</th><th>Rodzaj</th><th>Wynik</th></tr></thead><tbody>
        ${m.dziennik.map(x => `<tr>
          <td>${esc(String(x.kiedy).replace('T', ' ').slice(0, 16))}</td>
          <td>${esc(x.klient || '—')}</td>
          <td>${esc(x.email)}</td>
          <td>${x.typ === 'przypomnienie' ? 'przypomnienie' : x.typ === 'proba' ? 'próbka' : 'potwierdzenie'}</td>
          <td>${x.status === 'wyslany' ? '<span style="color:#15803d;font-weight:600">✓ wysłane</span>' : `<span style="color:#b91c1c;font-weight:600">✕ błąd</span> <span class="muted small">${esc(String(x.blad || '').slice(0, 60))}</span>`}</td>
        </tr>`).join('')}</tbody></table>`)}
    </div>`;
  }
  TRM.maileWczytaj = async () => {
    TRM.ust.maile = null;
    const d = await api('trm_maile_ustawienia', {});
    if (!d || d.status !== 'success') { TRM.ust.maile = { blad: (d && d.message) || 'brak odpowiedzi' }; TRM.widokZmien('ustawienia'); return; }
    TRM.ust.maile = { ...d, dziennik: null };
    TRM.widokZmien('ustawienia');
    const dz = await api('trm_maile_dziennik', { limit: 20 });
    if (TRM.ust.maile) { TRM.ust.maile.dziennik = (dz && dz.wiersze) || []; TRM.widokZmien('ustawienia'); }
  };
  TRM.maileZapisz = async () => {
    const d = await api('trm_maile_ustawienia', {
      zapisz: true,
      wlaczone: el('trm-m-on').checked,
      potwierdzenia: el('trm-m-potw').checked,
      przypomnienia: el('trm-m-przyp').checked,
      godzina: Number(el('trm-m-godz').value),
    });
    if (!d || d.status !== 'success') return toast('error', 'Nie zapisano ustawień', (d && d.message) || '');
    toast('success', d.ustawienia.wlaczone ? 'Powiadomienia o wizytach włączone' : 'Powiadomienia wyłączone');
    TRM.maileWczytaj();
  };
  TRM.maileProba = async (typ) => {
    const adres = (el('trm-m-test') || {}).value || '';
    const d = await api('trm_maile_proba', { email: adres.trim(), typ });
    toast(d && d.status === 'success' ? 'success' : 'error', d && d.status === 'success' ? 'Próbka wysłana' : 'Nie wysłano próbki', (d && d.message) || '');
    if (d && d.status === 'success') TRM.maileWczytaj();
  };

  function ustNieob() {
    const n = TRM.dane.nieobecnosci || [], zas = TRM.dane.zasoby.filter(z => z.aktywny && !z.zarchiwizowano);
    const gab = zas.filter(z => z.typ === 'gabinet'), urz = zas.filter(z => z.typ === 'urzadzenie');
    const dot = TRM.ust.nieobDotyczy || 'pracownik';
    return `<div class="trm-grid2">
      <div class="trm-card"><h3>Nowa blokada</h3>
        <div class="trm-field"><label>Dotyczy</label><div class="trm-segment" style="width:100%">${[['pracownik', 'Pracownik'], ['gabinet', 'Gabinet'], ['urzadzenie', 'Urządzenie'], ['salon', 'Cały salon']].map(([k, n2]) => `<button type="button" style="flex:1" class="${dot === k ? 'active' : ''}" onclick="TRM.ust.nieobDotyczy='${k}';TRM.ust.nieobPodglad=null;TRM.widokZmien('ustawienia')">${n2}</button>`).join('')}</div></div>
        ${dot === 'pracownik' ? `<div class="trm-field"><label>Pracownik</label><select id="trm-nb-kogo" onchange="TRM.nieobZmiana()">${TRM.dane.pracownicy.map(p => `<option value="p:${esc(p)}">${esc(p)}</option>`).join('') || '<option value="">brak pracowników</option>'}</select></div>` : ''}
        ${dot === 'gabinet' ? `<div class="trm-field"><label>Gabinet</label><select id="trm-nb-kogo" onchange="TRM.nieobZmiana()">${gab.map(z => `<option value="z:${z.id}">${esc(z.nazwa)}</option>`).join('') || '<option value="">brak gabinetów</option>'}</select></div>` : ''}
        ${dot === 'urzadzenie' ? `<div class="trm-field"><label>Urządzenie</label><select id="trm-nb-kogo" onchange="TRM.nieobZmiana()">${urz.map(z => `<option value="z:${z.id}">${esc(z.nazwa)}</option>`).join('') || '<option value="">brak urządzeń</option>'}</select></div>` : ''}
        <div class="trm-field"><label>Powód</label><select id="trm-nb-typ" onchange="TRM.nieobZmiana()">${[['urlop', 'Urlop'], ['choroba', 'Choroba'], ['szkolenie', 'Szkolenie'], ['przerwa', 'Przerwa'], ['serwis', 'Serwis / awaria'], ['zamkniete', 'Salon zamknięty'], ['inne', 'Inne']].map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="trm-grid2"><div class="trm-field"><label>Od</label><input type="datetime-local" id="trm-nb-od" value="${TRM.data}T09:00" onchange="TRM.nieobZmiana()"></div><div class="trm-field"><label>Do</label><input type="datetime-local" id="trm-nb-do" value="${TRM.data}T17:00" onchange="TRM.nieobZmiana()"></div></div>
        <div class="trm-field"><label>Notatka dla zespołu (niepubliczna)</label><input id="trm-nb-opis" placeholder="np. przegląd techniczny" maxlength="500"></div>
        <button class="trm-btn primary" id="trm-nb-zapisz" style="margin-top:8px" onclick="TRM.ustDodajNieob()">Zapisz blokadę</button>
      </div>
      <div id="trm-nb-podglad">${nieobPodgladHtml()}</div>
    </div>
    <div class="trm-card" style="margin-top:12px"><h3>Zaplanowane i ostatnie</h3><table class="trm-table"><thead><tr><th>Kogo</th><th>Od</th><th>Do</th><th>Typ</th><th>Opis</th><th></th></tr></thead><tbody>${n.length ? n.map(x => `<tr><td>${x.pracownik ? esc(x.pracownik) : x.zasob_id ? esc((zasob(x.zasob_id) || {}).nazwa || 'zasób') : '<b>cały salon</b>'}</td><td>${esc(x.od.slice(0, 16))}</td><td>${esc(x.do.slice(0, 16))}</td><td>${esc(x.typ)}</td><td class="muted">${esc(x.opis || '')}</td><td><button class="trm-btn sm" onclick="TRM.ustUsunNieob(${x.id})">Usuń</button></td></tr>`).join('') : '<tr><td colspan="6" class="muted">brak</td></tr>'}</tbody></table></div>`;
  }
  TRM.ustDodajNieob = async () => {
    const kogoEl = el('trm-nb-kogo'), kogo = kogoEl ? kogoEl.value : '';
    const s = TRM.ust.nieobPodglad;
    if (!s || s.stan !== 'wynik') { TRM.nieobZmiana(true); return toast('warning', 'Poczekaj na sprawdzenie wizyt', 'Zapisz, gdy pokażemy, które wizyty obejmie blokada.'); }
    const znane = s.dotkniete.length;
    const btn = el('trm-nb-zapisz'); if (btn) btn.disabled = true;
    const body = { pracownik_nieob: kogo.startsWith('p:') ? kogo.slice(2) : null, zasob_id: kogo.startsWith('z:') ? Number(kogo.slice(2)) : null, od: el('trm-nb-od').value.replace('T', ' '), do: el('trm-nb-do').value.replace('T', ' '), typ: el('trm-nb-typ').value, opis: el('trm-nb-opis').value, wymus: znane > 0 };
    const d = await api('trm_nieobecnosc_zapisz', body);
    if (btn) btn.disabled = false;
    if (d.status !== 'success') return toast('error', 'Nie zapisano', d.message); // formularz zostaje wypełniony (T14)
    if (d.wymaga_decyzji) { // w międzyczasie doszła nowa wizyta — pokaż aktualny wynik, zapis dopiero po ponownym kliknięciu
      TRM.ust.nieobPodglad = { stan: 'wynik', dotkniete: d.dotkniete || [] }; nieobOdswiez();
      return toast('warning', 'Lista wizyt się zmieniła', `Teraz blokada obejmuje ${d.dotkniete.length} wizyt — sprawdź i kliknij zapis ponownie.`);
    }
    TRM.ust.nieobPodglad = null;
    await window.trm_odswiezDane();
    const ile = (d.dotkniete || []).length;
    toast('success', 'Zapisano blokadę', ile ? `${ile} wizyt do obsłużenia — otwieramy sprawy` : '');
    renderUstawienia();
    if (ile) TRM.otworzPowiadomienia();
  };
  TRM.ustUsunNieob = async (id) => { if (!window.confirm('Usunąć tę blokadę? Dostępność wróci do pełnej walidacji grafiku.')) return; const d = await api('trm_nieobecnosc_usun', { id }); if (d.status !== 'success') return toast('error', 'Nie usunięto', d.message); await window.trm_odswiezDane(); renderUstawienia(); };

  // skróty klawiaturowe (05): N = nowa wizyta, T = dzisiaj, strzałki, Esc — nie w polach
  document.addEventListener('keydown', (e) => {
    const sek = el('terminarz'); if (!sek || !sek.classList.contains('active')) return;
    const tag = (e.target && e.target.tagName) || ''; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target.isContentEditable) return;
    if (e.key === 'Escape') { if (drag) { trmDragAnuluj(); return; } if (TRM.bubla) { TRM.zamknijBuble(); return; } if (TRM.panel) { if (TRM.panel === 'nowa' && (TRM.nowa.pozycje.length || TRM.nowa.klient) && !window.confirm('Zamknąć panel? Niezapisane dane zostaną utracone.')) return; TRM.panelZamknij(); } }
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
