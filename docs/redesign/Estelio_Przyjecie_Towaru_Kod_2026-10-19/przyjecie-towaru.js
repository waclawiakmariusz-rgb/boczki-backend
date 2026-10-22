/* Samodzielny komponent bez zależności, danych demo i adresów API. */
(function (global) {
  'use strict';
  const instances = new WeakMap();
  let sequence = 0;
  const currency = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
  const plainMoney = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

  function parseMoney(value) {
    const raw = String(value ?? '').trim();
    if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d{0,2})?$/.test(raw)) return null;
    const [whole, decimal = ''] = raw.replace(/[ \u00a0\u202f]/g, '').replace(',', '.').split('.');
    const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  }
  function parseQuantity(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
  }
  // null = puste pole, undefined = niepoprawna data. Bez konwersji strefy czasowej.
  function parseDate(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    let y, m, d;
    const pl = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (pl) [, d, m, y] = pl;
    else if (iso) [, y, m, d] = iso;
    else return undefined;
    const year = Number(y), month = Number(m), day = Number(d);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return undefined;
    return `${y}-${m}-${d}`;
  }
  const displayDate = iso => iso ? iso.split('-').reverse().join('.') : '';
  const money = cents => currency.format(cents / 100);
  const decimalMoney = cents => plainMoney.format(cents / 100);
  const totalCents = (quantity, cents) => quantity !== null && cents !== null && Number.isSafeInteger(quantity * cents) ? quantity * cents : null;

  function mount(root, adapter, config = {}) {
    if (!root || !root.matches('[data-goods-receipt]')) throw new Error('Brak kontenera [data-goods-receipt].');
    if (!adapter || typeof adapter.loadCatalog !== 'function' || typeof adapter.save !== 'function') {
      throw new Error('Podłącz loadCatalog i save istniejącego Estelio. Komponent nie ma domyślnego zapisu.');
    }
    const existing = instances.get(root);
    if (existing && !existing.destroy()) throw new Error('Poprzednie przyjęcie nadal oczekuje na rozstrzygnięcie zapisu.');
    const prefix = `egr${++sequence}-`;
    // Unikalne identyfikatory także po ponownym zamontowaniu fragmentu.
    const ids = new Map();
    root.querySelectorAll('[id]').forEach(el => { ids.set(el.id, prefix + el.id); el.id = prefix + el.id; });
    [root, ...root.querySelectorAll('[for], [aria-labelledby], [aria-describedby]')].forEach(el => {
      ['for', 'aria-labelledby', 'aria-describedby'].forEach(attr => {
        if (el.hasAttribute(attr)) el.setAttribute(attr, el.getAttribute(attr).split(' ').map(id => ids.get(id) || id).join(' '));
      });
    });
    const $ = s => root.querySelector(s);
    const form = $('form'), editable = $('[data-editable]'), dialog = $('dialog');
    const fields = Object.fromEntries(['brandId', 'productId', 'typeId', 'quantity', 'expiryDate', 'net', 'gross'].map(name => [name, form.elements.namedItem(name)]));
    const controller = new AbortController();
    const listen = (el, event, callback) => el.addEventListener(event, callback, { signal: controller.signal });
    let catalog = { brands: [], products: [], types: [] };
    let loaded = false, disposed = false, mode = 'loading', baseline = '', pending = null, catalogRequest = 0, toastTimer;
    const rawValues = () => Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
    const isDirty = () => JSON.stringify(rawValues()) !== baseline;
    const isBlocked = () => mode === 'saving' || mode === 'unknown' || mode === 'checking';
    const currentProduct = () => catalog.products.find(p => p.id === fields.productId.value && p.brandId === fields.brandId.value);
    const setText = (selector, text) => { $(selector).textContent = text; };

    function errorFor(field) { return root.querySelector('[id="' + field.getAttribute('aria-describedby') + '"]'); }
    function setError(name, message) {
      const field = fields[name];
      if (!field) return;
      const error = errorFor(field);
      error.textContent = message || ''; error.hidden = !message;
      if (message) field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid');
    }
    function clearErrors() { Object.keys(fields).forEach(name => setError(name, '')); }
    function feedback(message) { $('[data-feedback]').textContent = message || ''; $('[data-feedback]').hidden = !message; }
    function announce(message) { $('[data-announcement]').textContent = message; }
    function toast(message) {
      clearTimeout(toastTimer);
      $('[data-toast]').textContent = message; $('[data-toast]').hidden = false;
      toastTimer = setTimeout(() => { $('[data-toast]').hidden = true; }, 7000);
    }
    function optionList(select, list, placeholder) {
      const option = document.createElement('option'); option.value = ''; option.textContent = placeholder;
      select.replaceChildren(option);
      for (const item of list) {
        const el = document.createElement('option'); el.value = item.id; el.textContent = item.name; select.append(el);
      }
    }
    function fillModels() {
      const list = catalog.products.filter(p => p.brandId === fields.brandId.value);
      optionList(fields.productId, list, !fields.brandId.value ? 'Najpierw wybierz markę' : list.length ? 'Wybierz model' : 'Brak modeli tej marki');
      fields.productId.disabled = !fields.brandId.value || !list.length;
    }
    function setMode(next) {
      mode = next;
      const locked = isBlocked();
      editable.disabled = locked || !loaded;
      $('[data-submit]').disabled = locked || !loaded || mode === 'saved';
      $('[data-cancel]').disabled = locked;
      $('[data-submit-label]').textContent = mode === 'saving' ? 'Przyjmowanie…' : mode === 'saved' ? 'Przyjęto towar' : 'Przyjmij towar';
      $('.egr-spinner').hidden = mode !== 'saving';
      form.setAttribute('aria-busy', String(mode === 'saving' || mode === 'checking'));
      $('[data-recovery]').hidden = mode !== 'unknown' && mode !== 'checking';
      $('[data-check-result]').hidden = typeof adapter.checkResult !== 'function';
      $('[data-check-result]').disabled = mode === 'checking';
      $('[data-check-result]').textContent = mode === 'checking' ? 'Sprawdzanie…' : 'Sprawdź wynik';
    }
    function renderSummary() {
      const product = currentProduct();
      const brand = catalog.brands.find(b => b.id === fields.brandId.value);
      const type = catalog.types.find(t => t.id === fields.typeId.value);
      const quantity = parseQuantity(fields.quantity.value), gross = parseMoney(fields.gross.value);
      const total = totalCents(quantity, gross);
      setText('[data-summary="product"]', product?.name || 'Wybierz produkt');
      setText('[data-summary="brand"]', brand?.name || '—');
      setText('[data-summary="type"]', type?.name || '—');
      setText('[data-summary="quantity"]', quantity === null ? '—' : String(quantity));
      setText('[data-summary="unit"]', gross === null ? '—' : money(gross));
      setText('[data-summary="total"]', total === null ? '—' : money(total));
      setText('[data-summary="equation"]', total === null ? 'Uzupełnij ilość i cenę brutto.' : `${quantity} szt. × ${money(gross)}`);
      $('[data-step="-1"]').disabled = quantity === null || quantity <= 1;
      $('[data-step="1"]').disabled = quantity === Number.MAX_SAFE_INTEGER;
    }
    function reset(values = {}) {
      if (isBlocked() || disposed) return false;
      fields.brandId.value = values.brandId || '';
      fillModels(); fields.productId.value = values.productId || '';
      fields.typeId.value = values.typeId || '';
      fields.quantity.value = values.quantity == null ? '' : String(values.quantity);
      fields.expiryDate.value = displayDate(parseDate(values.expiryDate)) || values.expiryDate || '';
      fields.net.value = Number.isSafeInteger(values.netCents) ? decimalMoney(values.netCents) : values.net || '';
      fields.gross.value = Number.isSafeInteger(values.grossCents) ? decimalMoney(values.grossCents) : values.gross || '';
      clearErrors(); feedback(''); pending = null; setMode(loaded ? 'idle' : 'loading'); renderSummary();
      baseline = JSON.stringify(rawValues());
      return true;
    }
    function validate() {
      clearErrors();
      const value = rawValues();
      const payload = {
        kind: config.receiptKind ?? 'Detal', brandId: value.brandId, productId: value.productId, typeId: value.typeId,
        quantity: parseQuantity(value.quantity), expiryDate: parseDate(value.expiryDate),
        netCents: parseMoney(value.net), grossCents: parseMoney(value.gross)
      };
      const errors = {};
      if (!catalog.brands.some(b => b.id === payload.brandId)) errors.brandId = 'Wybierz markę produktu.';
      if (!currentProduct()) errors.productId = 'Wybierz model należący do tej marki.';
      if (!catalog.types.some(t => t.id === payload.typeId)) errors.typeId = 'Wybierz typ produktu.';
      if (payload.quantity === null) errors.quantity = 'Wpisz liczbę całkowitą większą od zera.';
      if (payload.expiryDate === undefined) errors.expiryDate = 'Wpisz prawidłową datę w formacie dd.mm.rrrr.';
      else if (config.expiryRequired && payload.expiryDate === null) errors.expiryDate = 'Podaj datę ważności.';
      for (const key of ['net', 'gross']) {
        if (payload[key + 'Cents'] === null) errors[key] = 'Podaj kwotę, np. 98,40. Maksymalnie dwa miejsca po przecinku.';
        else if (config.allowZeroPrice === false && payload[key + 'Cents'] === 0) errors[key] = 'Cena musi być większa od zera.';
      }
      if (payload.quantity !== null && payload.grossCents !== null && totalCents(payload.quantity, payload.grossCents) === null) errors.quantity = 'Łączna wartość jest za duża. Sprawdź liczbę sztuk i cenę.';
      if (!Object.keys(errors).length && typeof adapter.validate === 'function') {
        Object.assign(errors, adapter.validate({ ...payload }) || {});
      }
      Object.entries(errors).forEach(([name, message]) => setError(name, message));
      const first = Object.keys(fields).find(name => errors[name]);
      if (Object.keys(errors).length) {
        if (first) fields[first].focus();
        feedback(errors._form || 'Sprawdź oznaczone pola. Dane nie zostały wysłane.');
        return null;
      }
      return payload;
    }
    async function success(result) {
      // Błąd nawigacji po sukcesie nie może zmienić potwierdzonego zapisu w „błąd zapisu”.
      const operation = pending;
      pending = null; feedback(''); setMode('saved'); baseline = JSON.stringify(rawValues());
      toast(result.message || `Przyjęto ${operation.payload.quantity} szt. ${operation.productName}.`);
      if (typeof adapter.onSuccess === 'function') {
        try { await adapter.onSuccess(result, { payload: { ...operation.payload }, operationId: operation.id }); }
        catch (_) { feedback('Towar został przyjęty, ale odświeżenie widoku nie powiodło się. Nie powtarzaj zapisu.'); }
      }
    }
    function rejected(result) {
      pending = null; setMode('idle'); feedback(result.message || 'Nie można przyjąć towaru. Sprawdź dane i spróbuj ponownie.');
      Object.entries(result.fieldErrors || {}).forEach(([name, message]) => setError(name, message));
      const first = Object.keys(fields).find(name => result.fieldErrors?.[name]);
      if (first) fields[first].focus(); else $('[data-submit]').focus();
    }
    function unknown() {
      setMode('unknown');
      feedback('Nie udało się potwierdzić przyjęcia. Sprawdź, czy towar został dodany, zanim ponowisz zapis.');
      if (typeof adapter.checkResult === 'function') $('[data-check-result]').focus();
    }
    async function handleResult(result) {
      if (result?.status === 'confirmed') await success(result);
      else if (result?.status === 'rejected') rejected(result);
      else unknown();
    }
    async function submit(event) {
      event.preventDefault();
      if (disposed || !loaded || isBlocked() || mode === 'saved') return;
      feedback('');
      let payload;
      try { payload = validate(); }
      catch (_) { feedback('Nie udało się sprawdzić danych. Przyjęcie nie zostało wysłane.'); return; }
      if (!payload) return;
      const id = global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pending = { id, payload: { ...payload }, productName: currentProduct().name };
      setMode('saving');
      let result;
      try { result = await adapter.save({ ...payload }, { operationId: id }); }
      catch (_) { result = { status: 'unknown' }; }
      await handleResult(result);
    }
    async function checkResult() {
      if (mode !== 'unknown' || !pending || typeof adapter.checkResult !== 'function') return;
      setMode('checking');
      let result;
      try { result = await adapter.checkResult({ operationId: pending.id, payload: { ...pending.payload } }); }
      catch (_) { result = { status: 'unknown' }; }
      await handleResult(result);
    }
    async function cancel() {
      if (isBlocked()) return;
      try {
        if (typeof adapter.onCancel === 'function') await adapter.onCancel();
        else { feedback('Podłącz powrót do istniejącego widoku magazynu w adapter.onCancel.'); return; }
      } catch (_) { feedback('Nie udało się wrócić do magazynu. Dane formularza zostały zachowane.'); }
    }
    async function loadCatalog() {
      const request = ++catalogRequest;
      loaded = false; setMode('loading');
      $('[data-catalog-status]').hidden = false;
      setText('[data-catalog-status]', 'Pobieranie listy produktów…'); $('[data-reload-catalog]').hidden = true;
      try {
        const data = await adapter.loadCatalog();
        if (disposed || request !== catalogRequest) return;
        for (const name of ['brands', 'products', 'types']) {
          if (!Array.isArray(data[name])) throw new Error('Niepoprawny katalog');
          const ids = new Set();
          data[name].forEach(item => {
            if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || ids.has(item.id)) throw new Error('Niepoprawna pozycja katalogu');
            ids.add(item.id);
          });
        }
        if (data.products.some(p => !data.brands.some(b => b.id === p.brandId) || (p.typeId && !data.types.some(t => t.id === p.typeId)))) throw new Error('Niepoprawne powiązanie katalogu');
        catalog = data; loaded = true;
        for (const field of Object.values(fields)) field.disabled = false;
        optionList(fields.brandId, data.brands, 'Wybierz markę');
        optionList(fields.typeId, data.types, 'Wybierz typ');
        $('[data-catalog-status]').hidden = Boolean(data.products.length);
        setText('[data-catalog-status]', data.products.length ? '' : 'Brak produktów w katalogu. Uzupełnij istniejący słownik produktów Estelio.');
        reset(config.initialValues || {});
      } catch (_) {
        if (disposed || request !== catalogRequest) return;
        setText('[data-catalog-status]', 'Nie udało się pobrać produktów. Spróbuj ponownie.');
        // Przycisk ponowienia znajduje się w fieldsecie — włączamy go po błędzie.
        editable.disabled = false;
        for (const field of Object.values(fields)) field.disabled = true;
        $('[data-reload-catalog]').hidden = false;
      }
    }
    listen(form, 'submit', submit);
    listen(fields.brandId, 'change', () => {
      fillModels(); fields.typeId.value = ''; fields.net.value = ''; fields.gross.value = '';
      ['brandId', 'productId', 'typeId', 'net', 'gross'].forEach(name => setError(name, '')); renderSummary();
    });
    listen(fields.productId, 'change', () => {
      const p = currentProduct();
      fields.typeId.value = p?.typeId || '';
      fields.net.value = Number.isSafeInteger(p?.netCents) ? decimalMoney(p.netCents) : '';
      fields.gross.value = Number.isSafeInteger(p?.grossCents) ? decimalMoney(p.grossCents) : '';
      ['productId', 'typeId', 'net', 'gross'].forEach(name => setError(name, '')); renderSummary();
    });
    for (const [name, field] of Object.entries(fields)) {
      listen(field, 'input', () => { setError(name, ''); if (mode === 'saved') setMode('idle'); renderSummary(); });
      listen(field, 'change', () => { if (mode === 'saved') setMode('idle'); renderSummary(); });
    }
    for (const name of ['net', 'gross']) listen(fields[name], 'blur', () => {
      const cents = parseMoney(fields[name].value); if (cents !== null) fields[name].value = decimalMoney(cents);
    });
    root.querySelectorAll('[data-step]').forEach(button => listen(button, 'click', () => {
      const quantity = parseQuantity(fields.quantity.value), direction = Number(button.dataset.step);
      if (quantity === null && fields.quantity.value.trim()) { setError('quantity', 'Najpierw wpisz prawidłową liczbę sztuk.'); fields.quantity.focus(); return; }
      const next = quantity === null ? 1 : quantity + direction;
      if (next < 1 || !Number.isSafeInteger(next)) return;
      fields.quantity.value = String(next); setError('quantity', ''); if (mode === 'saved') setMode('idle'); renderSummary();
    }));
    listen($('[data-open-date]'), 'click', () => {
      const native = $('[data-native-date]'); native.value = parseDate(fields.expiryDate.value) || '';
      try { if (!native.showPicker) throw new Error('Picker unavailable'); native.showPicker(); }
      catch (_) { fields.expiryDate.focus(); announce('Wpisz datę w formacie dzień, miesiąc, rok, na przykład 31.12.2027.'); }
    });
    listen($('[data-native-date]'), 'change', event => {
      fields.expiryDate.value = displayDate(event.target.value); setError('expiryDate', '');
      if (mode === 'saved') setMode('idle'); fields.expiryDate.focus();
    });
    listen($('[data-cancel]'), 'click', () => { if (isDirty()) dialog.showModal(); else cancel(); });
    listen($('[data-keep]'), 'click', () => { dialog.close(); $('[data-cancel]').focus(); });
    listen($('[data-discard]'), 'click', () => { dialog.close(); cancel(); });
    listen(dialog, 'cancel', () => { $('[data-cancel]').focus(); });
    listen($('[data-check-result]'), 'click', checkResult);
    listen($('[data-reload-catalog]'), 'click', () => {
      for (const field of Object.values(fields)) field.disabled = false;
      loadCatalog();
    });
    const api = {
      reset, isDirty,
      getState: () => ({ mode, values: rawValues(), hasBlockingOperation: isBlocked(), operationId: pending?.id || null }),
      destroy: () => {
        if (isBlocked()) return false;
        disposed = true; ++catalogRequest; controller.abort(); clearTimeout(toastTimer);
        if (dialog.open) dialog.close(); instances.delete(root); return true;
      }
    };
    instances.set(root, api);
    api.ready = loadCatalog();
    return api;
  }
  const api = Object.freeze({ mount, parseMoney, parseQuantity, parseDate, totalCents });
  global.EstelioGoodsReceipt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
