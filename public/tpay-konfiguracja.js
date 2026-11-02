// Konfiguracja konta Tpay salonu (dodatek „Link do płatności”) — Administracja → Płatności online.
// Renderuje kartę do #tpay-konfig. Widoczna tylko dla ról admin/megaadmin (serwer odmawia innym — karta to pokazuje).
// Sekrety nigdy nie wracają z serwera w całości: pola haseł pokazują tylko maskę, puste pole przy zapisie = bez zmiany.
// Dodatkowo: tpayKonfig.ustawTrybLinku() przełącza formularz „Link do płatności” między trybem API a trybem ekspert.
(function () {
  'use strict';
  const stan = { api: null, dane: null };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tenantId = () => localStorage.getItem('boczki_tenant_id') || '';
  const kto = () => (typeof currentUser !== 'undefined' ? currentUser : '');

  async function get(url) { const r = await fetch(url); return r.json(); }
  async function post(url, body) { const r = await fetch(url, { method: 'POST', body: JSON.stringify(body) }); return r.json(); }

  /** Czy salon ma skonfigurowane API (wynik z zgody_status; pamiętany na czas sesji, odświeżany po zapisie). */
  async function czyApi(wymus) {
    if (stan.api !== null && !wymus) return stan.api;
    try { const d = await get(API_URL + '?action=zgody_status'); stan.api = !!(d && d.tpay_api); } catch (e) { stan.api = false; }
    return stan.api;
  }

  /** Formularz „Link do płatności”: w trybie API pole z linkiem z panelu chowa się pod „Tryb ekspert”. */
  async function ustawTrybLinku() {
    const info = $('zg-tryb-api-info'), det = $('zg-ekspert'), kw = $('zg_kwota');
    if (!info || !det) return;
    const api = await czyApi();
    info.style.display = api ? '' : 'none';
    det.open = !api;
    det.style.display = api ? '' : '';
    const sum = det.querySelector('summary');
    if (sum) sum.textContent = api ? 'Tryb ekspert: wklej gotowy link z panelu tpay (bez śledzenia płatności)' : 'Link do płatności z panelu tpay';
    if (kw) kw.placeholder = 'np. 100';
    // etykieta kwoty: przy linku tworzonym przez API Tpay kwota jest wymagana (nie da się jej potem zmienić — płacąca wybiera tylko formę płatności)
    const lab = kw && kw.parentElement ? kw.parentElement.querySelector('label') : null;
    if (lab) lab.textContent = api ? 'Kwota (zł, wymagana):' : 'Kwota (zł, opcjonalnie):';
  }

  function karta(html) { const k = $('tpay-konfig'); if (k) k.innerHTML = html; }

  function render(d) {
    stan.dane = d;
    const brakKlucza = !d.klucz_ok;
    const off = d.tryb === 'off';
    const skonfig = !!d.skonfigurowano;
    karta(`
      <div class="card tpk-karta">
        <div class="tpk-naglowek">
          <div>
            <div class="tpk-tytul">Konto Tpay salonu</div>
            <div class="tpk-pod">Dane z Panelu Akceptanta Tpay. Zapisane są zaszyfrowane kluczem salonu i nigdy nie wracają do przeglądarki w całości.</div>
          </div>
          <span class="tpk-status ${skonfig ? 'ok' : 'brak'}">${skonfig ? 'Skonfigurowane' : 'Brak konfiguracji — działa tryb ręczny'}</span>
        </div>
        ${brakKlucza ? '<div class="tpk-ostrz">Serwer nie ma klucza szyfrującego. Zapis i płatności przez API są wyłączone do czasu ustawienia klucza przez Estelio. Tryb ręczny działa.</div>' : ''}
        ${off ? '<div class="tpk-ostrz">Płatności przez API są chwilowo wyłączone na serwerze (wyłącznik awaryjny). Tryb ręczny działa.</div>' : ''}
        ${d.tryb === 'atrapa' ? '<div class="tpk-info">Środowisko testowe: połączenie z Tpay jest udawane, żadne żądanie nie wychodzi na zewnątrz.</div>' : ''}
        <div class="tpk-siatka">
          <label>Client ID <small>Integracja → API</small><input id="tpk-client-id" value="${esc(d.client_id)}" autocomplete="off"></label>
          <label>Client Secret <small>${d.client_secret_mask ? 'zapisany, puste = bez zmiany' : 'Integracja → API'}</small><input id="tpk-secret" type="password" placeholder="${esc(d.client_secret_mask || 'wklej z panelu')}" autocomplete="new-password"></label>
          <label>Kod zabezpieczający <small>${d.security_code_mask ? 'zapisany, puste = bez zmiany' : 'Powiadomienia → Zabezpieczenia'}</small><input id="tpk-code" type="password" placeholder="${esc(d.security_code_mask || 'wklej z panelu')}" autocomplete="new-password"></label>
          <label>ID sprzedawcy (Merchant ID) <small>liczba, przychodzi w powiadomieniach</small><input id="tpk-merchant" value="${esc(d.merchant_id)}" inputmode="numeric" autocomplete="off"></label>
        </div>
        <details class="tpk-zaaw" ${d.sandbox ? 'open' : ''}>
          <summary>Ustawienia zaawansowane</summary>
          <label class="tpk-check"><input type="checkbox" id="tpk-sandbox" ${d.sandbox ? 'checked' : ''}> Konto testowe (sandbox)</label>
          <label>Adres API <small>domyślnie produkcja</small><input id="tpk-api-base" value="${esc(d.api_base || 'https://api.tpay.com')}" autocomplete="off"></label>
        </details>
        ${skonfig ? `<div class="tpk-webhook"><span>Adres powiadomień (webhook) salonu — tylko do wglądu i dla wsparcia:</span><code>${esc(d.webhook_url)}</code><div class="tpk-pod">W panelu Tpay zaznacz „Zezwól na nadpisanie” w ustawieniach powiadomień. Estelio podaje ten adres przy każdej transakcji.</div></div>` : ''}
        <div class="tpk-akcje">
          <button type="button" class="tpk-btn tpk-btn-glowny" id="tpk-zapisz" ${brakKlucza ? 'disabled' : ''}>Zapisz konfigurację</button>
          <button type="button" class="tpk-btn" id="tpk-sprawdz" ${skonfig && !brakKlucza && !off ? '' : 'disabled'}>Sprawdź połączenie</button>
          ${skonfig ? '<button type="button" class="tpk-btn tpk-btn-usun" id="tpk-usun">Usuń konfigurację</button>' : ''}
          <span class="tpk-wynik" id="tpk-wynik"></span>
        </div>
        ${skonfig && d.updated_at ? `<div class="tpk-pod">Ostatnia zmiana: ${esc(String(d.updated_at).replace('T', ' ').slice(0, 16))}${d.updated_by ? ' · ' + esc(d.updated_by) : ''}</div>` : ''}
      </div>`);
    const w = $('tpk-wynik');
    const pokaz = (txt, zle) => { w.textContent = txt; w.className = 'tpk-wynik ' + (zle ? 'zle' : 'ok'); };
    $('tpk-zapisz').onclick = async () => {
      const body = {
        client_id: $('tpk-client-id').value.trim(), client_secret: $('tpk-secret').value, security_code: $('tpk-code').value,
        merchant_id: $('tpk-merchant').value.trim(), sandbox: $('tpk-sandbox').checked ? 1 : 0, api_base: $('tpk-api-base').value.trim(), user_log: kto(),
      };
      $('tpk-zapisz').disabled = true; pokaz('Zapisuję…');
      try {
        const r = await post(API_URL + '/tpay/konfiguracja', body);
        if (r.status !== 'success') { pokaz(r.message || 'Błąd zapisu.', true); $('tpk-zapisz').disabled = false; return; }
        stan.api = null;
        await zaladuj();
        const w2 = $('tpk-wynik'); if (w2) { w2.textContent = 'Zapisano. Sprawdź połączenie, zanim wyślesz pierwszy link.'; w2.className = 'tpk-wynik ok'; }
      } catch (e) { pokaz('Błąd sieci.', true); $('tpk-zapisz').disabled = false; }
    };
    $('tpk-sprawdz').onclick = async () => {
      $('tpk-sprawdz').disabled = true; pokaz('Łączę z Tpay…');
      try {
        const r = await post(API_URL + '/tpay/sprawdz', { user_log: kto() });
        pokaz(r.status === 'success' ? ('Połączenie OK. ' + (r.info || '')) : (r.message || 'Błąd połączenia.'), r.status !== 'success');
      } catch (e) { pokaz('Błąd sieci.', true); }
      $('tpk-sprawdz').disabled = false;
    };
    const usun = $('tpk-usun');
    if (usun) usun.onclick = async () => {
      if (!confirm('Usunąć konfigurację Tpay?\n\nNowe linki będą znów wymagały wklejenia adresu z panelu Tpay. Istniejące transakcje zostają w historii.')) return;
      try { const r = await post(API_URL + '/tpay/konfiguracja', { usun: 1, user_log: kto() }); if (r.status !== 'success') { pokaz(r.message || 'Błąd.', true); return; } stan.api = null; await zaladuj(); }
      catch (e) { pokaz('Błąd sieci.', true); }
    };
  }

  async function zaladuj() {
    const k = $('tpay-konfig');
    if (!k) return;
    if (typeof hasFeature === 'function' && !hasFeature('platnosc_link')) { k.innerHTML = ''; return; }
    try {
      const d = await get(API_URL + '/tpay/konfiguracja?tenant_id=' + encodeURIComponent(tenantId()));
      if (d.status === 'success') return render(d);
      if (d.code === 'UPRAWNIENIA') { karta(`<div class="card tpk-karta"><div class="tpk-tytul">Konto Tpay salonu</div><div class="tpk-pod">${esc(d.message)}</div></div>`); return; }
      karta(`<div class="card tpk-karta"><div class="tpk-tytul">Konto Tpay salonu</div><div class="tpk-ostrz">${esc(d.message || 'Nie udało się pobrać konfiguracji.')}</div></div>`);
    } catch (e) { karta('<div class="card tpk-karta"><div class="tpk-ostrz">Brak połączenia z serwerem.</div></div>'); }
  }

  window.tpayKonfig = { zaladuj, ustawTrybLinku, czyApi, get api() { return stan.api === true; } };
})();
