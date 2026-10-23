(function (g) {
  'use strict';
  const M = g.EstelioInventoryModel;
  let instance = 0;
  function mount(root, adapter, options = {}) {
    if (!root || !adapter?.load || !adapter?.save) throw new Error('Wymagany formularz i adapter magazynu.');
    const mode = options.mode === 'edit' ? 'edit' : 'create';
    if (mode === 'edit' && !options.productId) throw new Error('Edycja wymaga productId.');
    const prefix = `ei-${++instance}`;
    const $ = selector => root.querySelector(selector);
    const form = $('[data-form]');
    const inputs = Object.fromEntries(M.fields.map(key => [key, $(`[data-field="${key}"]`)]));
    const trigger = $('[data-category-trigger]'), picker = $('[data-picker]');
    const search = $('[data-search]'), list = $('[data-options]');
    const abort = new AbortController(), signal = abort.signal;
    let snapshot = null, baseline = null, phase = 'loading', disposed = false;
    let results = [], activeIndex = -1, pending = null, loadSequence = 0, discardCallback = null, lastFocus = null;
    const context = {mode, productId: options.productId ?? null};
    const on = (node, event, fn) => node.addEventListener(event, fn, {signal});
    function text(selector, value) { $(selector).textContent = value; }
    function read() { return Object.fromEntries(M.fields.map(key => [key, inputs[key].value])); }
    function dirty() { return baseline && M.fields.some(key => read()[key] !== baseline[key]); }
    function notice(message, tone = 'info') {
      const el = $('[data-notice]'); el.textContent = message; el.dataset.tone = tone; el.hidden = !message;
      el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    }
    function lock() {
      const editable = phase === 'ready' && snapshot?.canSave === true;
      Object.values(inputs).forEach(input => input.disabled = !editable);
      trigger.disabled = !editable;
      $('[data-save]').disabled = !editable;
      $('[data-cancel]').disabled = ['saving', 'unknown', 'loading'].includes(phase);
      form.setAttribute('aria-busy', String(phase === 'saving' || phase === 'loading'));
      text('[data-save-label]', phase === 'saving' ? 'Zapisywanie…' : phase === 'saved' ? 'Produkt dodany' : mode === 'edit' ? 'Zapisz zmiany' : 'Dodaj produkt');
      $('[data-resolve]').hidden = phase !== 'unknown';
      $('[data-reload]').hidden = phase !== 'conflict';
    }
    function paintProduct(product) {
      for (const key of M.fields) inputs[key].value = product[key] ?? '';
      baseline = read();
      showCategory();
      clearErrors();
    }
    function showCategory() {
      const cat = snapshot.categories.find(c => c.id === inputs.categoryId.value);
      const label = cat ? [...cat.path, cat.label].join(' › ') : inputs.categoryId.value ? (snapshot.currentCategoryLabel || 'Kategoria niedostępna — zachowano przypisanie') : 'Wybierz kategorię';
      text('[data-category-value]', label);
    }
    function clearErrors() {
      for (const key of M.fields) {
        const error = $(`[data-error="${key}"]`);
        error.hidden = true; error.textContent = '';
        (key === 'categoryId' ? trigger : inputs[key]).removeAttribute('aria-invalid');
      }
    }
    function showErrors(errors) {
      clearErrors();
      for (const [key, message] of Object.entries(errors || {})) {
        const error = $(`[data-error="${key}"]`);
        if (!error) continue;
        error.textContent = String(message); error.hidden = false;
        (key === 'categoryId' ? trigger : inputs[key]).setAttribute('aria-invalid', 'true');
      }
      const first = M.fields.find(key => errors[key]);
      if (first) (first === 'categoryId' ? trigger : inputs[first]).focus();
    }
    async function load() {
      const sequence = ++loadSequence;
      phase = 'loading'; lock(); closePicker(false);
      $('[data-retry]').hidden = true;
      notice('Wczytywanie danych magazynu…');
      try {
        const response = await adapter.load(context);
        if (disposed || sequence !== loadSequence) return;
        if (!response || !Array.isArray(response.categories) || !response.product) throw new Error('Niepełny model danych.');
        const ids = new Set();
        for (const c of response.categories) {
          if (typeof c.id !== 'string' || !c.id || ids.has(c.id) || !Array.isArray(c.path)) throw new Error('Nieprawidłowy model kategorii.');
          ids.add(c.id);
        }
        snapshot = response; paintProduct(response.product); phase = 'ready'; lock();
        notice(response.canSave !== true ? 'Masz dostęp do podglądu. Brak uprawnienia do zapisu produktu.' : '');
        if (options.initialCategoryOpen && response.canSave === true) openPicker();
      } catch (_) {
        if (disposed || sequence !== loadSequence) return;
        phase = 'failed'; lock(); notice('Nie udało się pobrać danych magazynu. Spróbuj ponownie.', 'error');
        $('[data-retry]').hidden = false;
      }
    }
    function renderOptions() {
      results = M.filterCategories(snapshot.categories, search.value);
      list.replaceChildren();
      const groups = new Map();
      results.forEach((cat, index) => {
        const groupKey = JSON.stringify(cat.path);
        if (!groups.has(groupKey)) {
          const group = document.createElement('div'); group.className = 'ei-option-group'; group.setAttribute('role', 'group');
          const label = document.createElement('div'); label.className = 'ei-group-label'; label.id = `${prefix}-group-${groups.size}`;
          label.textContent = cat.path.join(' › ') || 'Kategorie główne';
          label.prepend(trigger.querySelector('svg').cloneNode(true));
          group.setAttribute('aria-labelledby', label.id); group.append(label); list.append(group); groups.set(groupKey, group);
        }
        const item = document.createElement('div');
        item.id = `${prefix}-option-${index}`; item.className = 'ei-option'; item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(cat.id === inputs.categoryId.value)); item.dataset.index = String(index);
        item.textContent = cat.label;
        if (cat.id === inputs.categoryId.value) {
          const mark = document.createElement('span'); mark.className = 'ei-option-mark'; mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true'); item.append(mark);
        }
        groups.get(groupKey).append(item);
      });
      $('[data-no-results]').hidden = results.length > 0;
      text('[data-result-count]', `Liczba wyników: ${results.length}`);
      const selected = results.findIndex(c => c.id === inputs.categoryId.value);
      setActive(results.length ? Math.max(0, selected) : -1, false);
    }
    function setActive(index, scroll = true) {
      activeIndex = index;
      list.querySelectorAll('[role="option"]').forEach((node, i) => node.classList.toggle('is-active', i === index));
      if (index < 0) search.removeAttribute('aria-activedescendant');
      else {
        const node = list.querySelector(`[data-index="${index}"]`);
        search.setAttribute('aria-activedescendant', node.id);
        if (scroll) node.scrollIntoView({block: 'nearest'});
      }
    }
    function positionPicker() {
      if (picker.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const view = g.visualViewport;
      const top = view?.offsetTop || 0, bottom = top + (view?.height || g.innerHeight);
      const below = bottom - rect.bottom - 16, above = rect.top - top - 16;
      const flip = below < 260 && above > below;
      picker.classList.toggle('ei-above', flip);
      picker.style.maxHeight = `${Math.max(140, Math.min(460, flip ? above : below))}px`;
    }
    function openPicker() {
      if (phase !== 'ready' || snapshot?.canSave !== true) return;
      search.value = ''; picker.hidden = false; trigger.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-expanded', 'true');
      renderOptions(); positionPicker(); search.focus({preventScroll: true});
    }
    function closePicker(focus = true) {
      if (picker.hidden) return;
      picker.hidden = true; trigger.setAttribute('aria-expanded', 'false'); search.setAttribute('aria-expanded', 'false'); search.removeAttribute('aria-activedescendant');
      if (focus && !trigger.disabled) trigger.focus();
    }
    function choose(index) {
      const cat = results[index]; if (!cat) return;
      inputs.categoryId.value = cat.id; showCategory();
      $('[data-error="categoryId"]').hidden = true; trigger.removeAttribute('aria-invalid'); closePicker();
    }
    function askDiscard(callback) {
      closePicker(false); lastFocus = document.activeElement; discardCallback = callback;
      const dlg = $('[data-discard]'); dlg.showModal(); $('[data-keep]').focus();
    }
    function dismissDiscard() {
      $('[data-discard]').close(); discardCallback = null;
      if (lastFocus?.isConnected) lastFocus.focus();
    }
    async function cancel() {
      if (['saving', 'unknown', 'loading'].includes(phase)) return;
      const execute = async () => {
        try {
          const result = await adapter.cancel?.(context);
          if (disposed) return;
          if (snapshot) paintProduct(snapshot.product); else baseline = null;
          phase = 'cancelled'; lock(); notice(result?.message || 'Anulowano zmiany.');
        } catch (_) { if (!disposed) notice('Nie udało się wrócić do magazynu. Dane formularza zostały zachowane.', 'error'); }
      };
      if (dirty()) askDiscard(execute); else await execute();
    }
    function canonical(product) {
      return M.validate(Object.fromEntries(M.fields.map(key => [key, String(product[key] ?? '')])), snapshot.categories, snapshot.rules, mode === 'edit' ? snapshot.product : null).value;
    }
    function acceptResult(result) {
      if (result?.status === 'confirmed' && result.product) {
        snapshot.product = result.product; snapshot.version = result.version;
        paintProduct(result.product); pending = null; phase = mode === 'create' ? 'saved' : 'ready'; lock();
        notice(adapter.isDemo ? 'Zapisano w podglądzie. Rzeczywisty magazyn Estelio nie został zmieniony.' : mode === 'edit' ? 'Zapisano zmiany produktu.' : 'Dodano produkt do magazynu.', 'success');
        if (options.onSaved) { try { options.onSaved(result); } catch (_) { notice('Produkt zapisano. Nie udało się przejść do następnego widoku.', 'success'); } }
      } else if (result?.status === 'rejected') {
        pending = null; phase = 'ready'; lock(); notice(result.message || 'Nie zapisano produktu. Sprawdź dane.', 'error');
        if (result.errors) showErrors(result.errors);
      } else if (result?.status === 'conflict') {
        pending = null; phase = 'conflict'; lock(); notice('Dane zostały zmienione przez inną osobę. Twoje wpisy pozostają widoczne. Wczytaj aktualne dane przed ponowną edycją.', 'error');
      } else {
        phase = 'unknown'; lock(); notice('Nie można potwierdzić wyniku zapisu. Nie wysyłaj ponownie formularza. Użyj „Sprawdź wynik zapisu”.', 'error');
      }
    }
    async function save(event) {
      event.preventDefault();
      if (phase !== 'ready' || snapshot?.canSave !== true) return;
      closePicker(false);
      const {value, errors} = M.validate(read(), snapshot.categories, snapshot.rules, mode === 'edit' ? snapshot.product : null);
      if (inputs.expiry.validity.badInput) errors.expiry = 'Uzupełnij poprawną datę lub wyczyść to pole.';
      if (Object.keys(errors).length) { showErrors(errors); notice('Sprawdź oznaczone pola.', 'error'); return; }
      clearErrors();
      const changes = mode === 'edit' ? M.patch(canonical(snapshot.product), value) : value;
      if (mode === 'edit' && !Object.keys(changes).length) { notice('Nie wprowadzono zmian.'); return; }
      const operationId = g.crypto?.randomUUID?.() || `ei-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pending = {...context, expectedVersion: snapshot.version, operationId, values: value, changes};
      phase = 'saving'; lock(); notice('Zapisywanie produktu…');
      try { const result = await adapter.save(pending); if (!disposed) acceptResult(result); }
      catch (_) { if (!disposed) acceptResult({status: 'unknown'}); }
    }
    async function resolve() {
      if (phase !== 'unknown' || !pending) return;
      const btn = $('[data-resolve]'); btn.disabled = true;
      try {
        if (!adapter.resolve) { notice('Brak podłączenia weryfikacji wyniku. Zachowaj formularz i przekaż administratorowi identyfikator operacji: ' + pending.operationId, 'error'); return; }
        const result = await adapter.resolve({operationId: pending.operationId, ...context});
        if (!disposed) acceptResult(result);
      } catch (_) { if (!disposed) notice('Wynik nadal nieznany. Nie ponawiaj zapisu. Sprawdź ponownie za chwilę.', 'error'); }
      finally { if (!disposed) btn.disabled = false; }
    }
    for (const key of M.fields) {
      const error = $(`[data-error="${key}"]`); error.id = `${prefix}-error-${key}`;
      const field = key === 'categoryId' ? trigger : inputs[key];
      field.setAttribute('aria-describedby', error.id);
      const help = inputs[key].closest('.ei-field')?.querySelector('.ei-help');
      if (help?.textContent.trim()) { help.id = `${prefix}-help-${key}`; field.setAttribute('aria-describedby', `${help.id} ${error.id}`); }
    }
    $('[data-category-label]').id = `${prefix}-category-label`;
    $('[data-category-value]').id = `${prefix}-category-value`;
    trigger.setAttribute('aria-labelledby', `${prefix}-category-label ${prefix}-category-value`);
    picker.id = `${prefix}-picker`; list.id = `${prefix}-list`;
    trigger.setAttribute('aria-controls', picker.id); search.setAttribute('aria-controls', list.id);
    const dialogTitle = $('[data-discard] h2'); dialogTitle.id = `${prefix}-discard-title`; $('[data-discard]').setAttribute('aria-labelledby', dialogTitle.id);
    if (mode === 'edit') {
      text('[data-title]', 'Edytuj produkt w magazynie'); text('[data-breadcrumb]', 'Edycja produktu');
      text('[data-subtitle]', 'Zaktualizuj dane istniejącego produktu.'); text('[data-quantity-label]', 'Obecna ilość');
      text('[data-quantity-help]', 'Aktualny stan zapisany w magazynie.');
      $('[data-save] svg').setAttribute('hidden', '');
    }
    $('[data-demo-label]').hidden = !adapter.isDemo; $('[data-demo-nav]').hidden = !adapter.isDemo;
    on(form, 'submit', save);
    on(trigger, 'click', () => picker.hidden ? openPicker() : closePicker());
    on(trigger, 'keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); openPicker(); } });
    on(search, 'input', renderOptions);
    on(search, 'keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closePicker(); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(activeIndex); }
      else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); if (results.length) setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
      } else if ((event.ctrlKey || event.metaKey) && ['Home', 'End'].includes(event.key)) {
        event.preventDefault(); if (results.length) setActive(event.key === 'Home' ? 0 : results.length - 1);
      }
    });
    on(list, 'pointerdown', event => { if (event.target.closest('[role="option"]')) event.preventDefault(); });
    on(list, 'click', event => { const node = event.target.closest('[data-index]'); if (node) choose(Number(node.dataset.index)); });
    on(list, 'pointermove', event => { const node = event.target.closest('[data-index]'); if (node && Number(node.dataset.index) !== activeIndex) setActive(Number(node.dataset.index), false); });
    on(document, 'pointerdown', event => { if (!picker.hidden && !root.querySelector('[data-category-wrapper]').contains(event.target)) closePicker(false); });
    on(document, 'focusin', event => { if (!picker.hidden && !root.querySelector('[data-category-wrapper]').contains(event.target)) closePicker(false); });
    on(g, 'resize', positionPicker);
    if (g.visualViewport) { on(g.visualViewport, 'resize', positionPicker); on(g.visualViewport, 'scroll', positionPicker); }
    document.addEventListener('scroll', positionPicker, {signal, capture: true, passive: true});
    on($('[data-cancel]'), 'click', cancel);
    on($('[data-retry]'), 'click', load);
    on($('[data-resolve]'), 'click', resolve);
    on($('[data-reload]'), 'click', () => askDiscard(load));
    on($('[data-keep]'), 'click', dismissDiscard);
    on($('[data-discard]'), 'cancel', event => { event.preventDefault(); dismissDiscard(); });
    on($('[data-discard-confirm]'), 'click', () => { const fn = discardCallback; dismissDiscard(); if (fn) fn(); });
    on(form, 'input', event => {
      const key = event.target.dataset.field;
      if (key) { $(`[data-error="${key}"]`).hidden = true; inputs[key].removeAttribute('aria-invalid'); }
    });
    on(g, 'beforeunload', event => { if (dirty() || ['saving', 'unknown'].includes(phase)) { event.preventDefault(); event.returnValue = ''; } });
    const ready = load();
    return {
      ready,
      hasUnsavedChanges: () => Boolean(dirty() || ['saving', 'unknown'].includes(phase)),
      getState: () => ({phase, mode, operationId: pending?.operationId ?? null}),
      destroy() { disposed = true; loadSequence++; abort.abort(); if ($('[data-discard]').open) $('[data-discard]').close(); closePicker(false); }
    };
  }
  g.EstelioInventoryForm = {mount};
})(globalThis);
