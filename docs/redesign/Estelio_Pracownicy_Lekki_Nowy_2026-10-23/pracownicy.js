(function (global) {
  'use strict';
  let instance = 0;
  const trash = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';

  /** Adapter must be supplied explicitly. This component never calls an API by itself. */
  function mount(root, options) {
    if (!root || root.dataset.empMounted) throw new Error('Brak kontenera lub podwójny mount.');
    const { adapter, canAdd = true, canRemove = true, removeImpact = '', helpUrl = '', maxNameLength } = options || {};
    if (!adapter || typeof adapter.list !== 'function' || (canAdd && typeof adapter.create !== 'function') || (canRemove && typeof adapter.remove !== 'function')) throw new Error('Podaj pełny adapter danych.');
    if (canRemove && !removeImpact.trim()) throw new Error('Podaj zweryfikowany opis skutku usuwania.');
    root.dataset.empMounted = 'true';
    const q = selector => root.querySelector(selector);
    const form = q('[data-add-form]'), input = q('[data-name]'), add = q('[data-add-button]');
    const list = q('[data-list]'), count = q('[data-count]'), state = q('[data-list-state]'), retry = q('[data-retry]');
    const status = q('[data-status]'), error = q('[data-field-error]'), dialog = q('[data-dialog]');
    const confirm = q('[data-confirm]'), cancel = q('[data-cancel]'), removeError = q('[data-remove-error]');
    const help = q('[data-help]'), helpToggle = q('[data-help-toggle]');
    const controller = new AbortController();
    const listen = (element, type, fn) => element.addEventListener(type, fn, { signal: controller.signal });
    let rows = [], busy = false, pending = null, trigger = null, generation = 0, destroyed = false;
    const uid = 'emp-' + (++instance);
    error.id = uid + '-error'; input.setAttribute('aria-describedby', error.id);
    help.id = uid + '-help'; helpToggle.setAttribute('aria-controls', help.id);
    if (Number.isInteger(maxNameLength) && maxNameLength > 0) input.maxLength = maxNameLength;
    q('.emp-add-card').hidden = !canAdd;
    if (!canAdd) q('.emp-grid').style.gridTemplateColumns = 'minmax(0,1fr)';
    q('[data-remove-impact]').textContent = removeImpact;
    if (helpUrl) {
      const url = new URL(helpUrl, location.href);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Nieprawidłowy link pomocy.');
      const link = q('[data-help-link]'); link.href = url.href; link.hidden = false;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
    }
    function fieldError(text) {
      error.textContent = text; error.hidden = !text;
      input.setAttribute('aria-invalid', String(Boolean(text)));
    }
    function lock(value) {
      busy = value; input.disabled = value; add.disabled = value;
      list.querySelectorAll('button').forEach(button => { button.disabled = value; });
      confirm.disabled = value; cancel.disabled = value;
      root.setAttribute('aria-busy', String(value));
    }
    function setHelp(open, restore = false) {
      help.hidden = !open; helpToggle.setAttribute('aria-expanded', String(open));
      if (restore) helpToggle.focus();
    }
    function render() {
      list.replaceChildren();
      for (const row of rows) {
        const li = document.createElement('li'); li.className = 'emp-row';
        const avatar = document.createElement('span'); avatar.className = 'emp-avatar'; avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = Array.from(row.name.trim())[0]?.toLocaleUpperCase('pl') || '•';
        const name = document.createElement('span'); name.className = 'emp-name'; name.textContent = row.name;
        li.append(avatar, name);
        if (canRemove && row.canRemove !== false) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'emp-delete'; button.dataset.recordId = String(row.id);
          button.setAttribute('aria-label', 'Usuń pracownika: ' + row.name);
          button.innerHTML = trash + '<span>Usuń</span>'; // static trusted icon only; names use textContent
          button.disabled = busy;
          button.onclick = () => {
            if (busy) return;
            pending = row; trigger = button; removeError.hidden = true; removeError.textContent = '';
            q('[data-remove-question]').textContent = 'Czy chcesz usunąć ' + row.name + ' z listy pracowników?';
            setHelp(false); dialog.showModal(); cancel.focus();
          };
          li.append(button);
        }
        list.append(li);
      }
      count.textContent = String(rows.length); count.hidden = false;
    }
    async function load() {
      const version = ++generation;
      state.textContent = rows.length ? 'Odświeżanie listy…' : 'Wczytywanie pracowników…';
      retry.hidden = true; list.setAttribute('aria-busy', 'true');
      try {
        const result = await adapter.list();
        if (destroyed || version !== generation) return false;
        if (!Array.isArray(result) || result.some(r => !r || !['string', 'number'].includes(typeof r.id) || typeof r.name !== 'string') || new Set(result.map(r => String(r.id))).size !== result.length) throw new Error('Invalid adapter data');
        rows = result; render();
        state.textContent = rows.length ? '' : (canAdd ? 'Nie ma jeszcze pracowników. Dodaj pierwszą osobę w formularzu.' : 'Nie ma jeszcze pracowników.');
        return true;
      } catch (err) {
        if (destroyed || version !== generation) return false;
        state.textContent = rows.length ? 'Nie udało się odświeżyć listy. Widoczne dane mogą być nieaktualne.' : 'Nie udało się wczytać listy pracowników.';
        retry.hidden = false; return false;
      } finally {
        if (!destroyed && version === generation) list.setAttribute('aria-busy', 'false');
      }
    }
    listen(form, 'submit', async event => {
      event.preventDefault(); if (busy || !canAdd) return;
      if (!input.value.trim()) { fieldError('Wpisz imię i nazwisko.'); input.focus(); return; }
      // No business normalization here: adapter preserves the existing backend contract.
      const name = input.value;
      fieldError(''); status.textContent = ''; lock(true); add.textContent = 'Dodawanie…';
      let succeeded = false;
      try {
        await adapter.create({ name });
        if (destroyed) return;
        succeeded = true; input.value = ''; status.textContent = 'Dodano pracownika.';
        await load();
      } catch (err) {
        if (destroyed) return;
        const messages = { DUPLICATE: 'Taka osoba jest już na liście.', FORBIDDEN: 'Nie masz uprawnień do dodawania pracowników.', UNKNOWN_RESULT: 'Nie udało się potwierdzić wyniku. Sprawdź odświeżoną listę przed ponowną próbą.' };
        fieldError(messages[err.code] || 'Nie udało się dodać pracownika. Sprawdź listę przed ponowną próbą.');
        await load();
      } finally {
        if (!destroyed) { lock(false); add.textContent = '＋ Dodaj pracownika'; input.focus(); if (succeeded) fieldError(''); }
      }
    });
    function dismiss() {
      if (!busy) {
        dialog.close();
        const current = [...list.querySelectorAll('button')].find(button => button.dataset.recordId === String(pending?.id));
        (current || (trigger?.isConnected ? trigger : q('[data-list-heading]'))).focus();
        pending = null;
      }
    }
    listen(cancel, 'click', dismiss);
    listen(dialog, 'cancel', event => { event.preventDefault(); dismiss(); });
    listen(dialog, 'click', event => {
      const r = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dismiss();
    });
    listen(q('[data-remove-form]'), 'submit', async event => {
      event.preventDefault(); if (busy || !pending || !canRemove) return;
      const row = pending, index = rows.findIndex(item => item.id === row.id);
      lock(true); confirm.textContent = 'Usuwanie…'; removeError.hidden = true;
      q('[data-remove-status]').textContent = 'Usuwanie pracownika…';
      let removed = false;
      try {
        await adapter.remove({ id: row.id });
        if (destroyed) return;
        removed = true; status.textContent = 'Usunięto pracownika.';
        await load();
      } catch (err) {
        if (destroyed) return;
        if (err.code === 'NOT_FOUND') { removed = true; status.textContent = 'Lista pracowników została zaktualizowana.'; await load(); }
        else {
          const messages = { LINKED: 'Nie można usunąć tej osoby ze względu na istniejące powiązania.', FORBIDDEN: 'Nie masz uprawnień do usunięcia tej osoby.', UNKNOWN_RESULT: 'Nie udało się potwierdzić wyniku. Sprawdź odświeżoną listę przed ponowną próbą.' };
          removeError.textContent = messages[err.code] || 'Nie udało się potwierdzić usunięcia. Sprawdź listę przed ponowną próbą.';
          removeError.hidden = false; await load();
          if (!rows.some(item => item.id === row.id)) { removed = true; status.textContent = 'Lista została odświeżona. Sprawdź aktualny stan.'; }
        }
      } finally {
        if (!destroyed) {
          lock(false); confirm.textContent = 'Usuń'; q('[data-remove-status]').textContent = '';
          if (removed) {
            pending = null; dialog.close();
            const actions = [...list.querySelectorAll('button')];
            (actions[Math.min(index, actions.length - 1)] || q('[data-list-heading]')).focus();
          } else cancel.focus();
        }
      }
    });
    listen(retry, 'click', () => { if (!busy) load(); });
    listen(helpToggle, 'click', () => setHelp(help.hidden));
    listen(q('[data-help-close]'), 'click', () => setHelp(false, true));
    listen(root, 'keydown', event => { if (event.key === 'Escape' && !help.hidden) { setHelp(false, true); event.stopPropagation(); } });
    listen(document, 'pointerdown', event => { if (!q('.emp-help-wrap').contains(event.target)) setHelp(false); });
    return { ready: load(), refresh: () => busy ? Promise.resolve(false) : load(), destroy() { destroyed = true; generation++; controller.abort(); if (dialog.open) dialog.close(); list.replaceChildren(); delete root.dataset.empMounted; } };
  }
  global.EstelioEmployees = Object.freeze({ mount });
})(window);
