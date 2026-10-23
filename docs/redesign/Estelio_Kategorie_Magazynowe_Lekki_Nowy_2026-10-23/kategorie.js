(function (global) {
  'use strict';
  const M = global.EstelioCategoryModel;
  let instance = 0;
  function mount(root, options) {
    if (!root || root.dataset.catMounted) throw new Error('Invalid mount');
    const { adapter, permissions = {}, removalDescription = '', helpUrl = '' } = options || {};
    const rights = Object.fromEntries(['create', 'rename', 'move', 'remove'].map(key => [key, permissions[key] === true]));
    if (!M || !adapter || typeof adapter.list !== 'function') throw new Error('Adapter required');
    for (const key of Object.keys(rights)) if (rights[key] && typeof adapter[key] !== 'function') throw new Error('Missing adapter: ' + key);
    if (rights.remove && !removalDescription.trim()) throw new Error('Verified removal description required');
    let resolvedHelp = null;
    if (helpUrl) { resolvedHelp = new URL(helpUrl, location.href); if (!['http:', 'https:'].includes(resolvedHelp.protocol)) throw new Error('Invalid help URL'); }
    root.dataset.catMounted = 'true';
    const uid = 'cat-' + ++instance, q = s => root.querySelector(s), ac = new AbortController();
    const on = (el, event, fn) => el.addEventListener(event, fn, { signal: ac.signal });
    const tree = q('[data-tree]'), name = q('[data-name]'), error = q('[data-name-error]'), actions = q('[data-actions]');
    const picker = q('[data-picker]'), edit = q('[data-edit]'), remove = q('[data-remove]'), help = q('[data-help-dialog]');
    let nodes = [], expanded = new Set(), initialized = false, trusted = false, busy = false, dead = false, seq = 0;
    let parentId = null, activeId = null, origin = null, pickerMode = 'create', selected = null;
    q('[data-create-card]').hidden = !rights.create;
    if (!rights.create) q('.cat-grid').style.gridTemplateColumns = 'minmax(0,1fr)';
    error.id = uid + '-error'; name.setAttribute('aria-describedby', error.id);
    q('[data-parent-label]').id = uid + '-parent-label'; q('[data-parent-text]').id = uid + '-parent-value';
    q('[data-parent]').setAttribute('aria-labelledby', uid + '-parent-label ' + uid + '-parent-value');
    if (resolvedHelp) { const link = q('[data-help-link]'); link.href = resolvedHelp.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.hidden = false; }
    const create = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
    function path(id) { return id === null ? 'Poziom główny' : M.path(nodes, id).map(n => n.name).join(' / '); }
    function allowed(node, action) { return rights[action] && (!node.permissions || node.permissions[action] !== false); }
    function message(el, text) { el.textContent = text; el.hidden = !text; }
    function setLock(value) {
      busy = value;
      root.querySelectorAll('input,button').forEach(el => { el.disabled = value; });
      if (!value) {
        q('[data-add]').disabled = !trusted;
        q('[data-parent]').disabled = !trusted;
        root.querySelectorAll('.cat-more').forEach(el => { el.disabled = !trusted; });
      }
      root.setAttribute('aria-busy', String(value));
    }
    function closeActions(restore = false) {
      actions.hidden = true;
      if (origin) { origin.setAttribute('aria-expanded', 'false'); if (restore && origin.isConnected) origin.focus(); }
    }
    function focusOrigin() {
      const current = [...root.querySelectorAll('.cat-more')].find(b => b.dataset.id === activeId);
      (current || (origin?.isConnected ? origin : q('[data-tree-heading]'))).focus();
    }
    function dismiss(dialog) { if (!busy) { dialog.close(); if (dialog === picker && pickerMode === 'create') q('[data-parent]').focus(); else if (dialog === help) q('[data-help]').focus(); else focusOrigin(); } }
    function parentLabel() {
      const missing = parentId !== null && !nodes.some(n => n.id === parentId);
      q('[data-parent-text]').textContent = missing ? 'Wybierz miejsce ponownie' : path(parentId);
      q('[data-parent-hint]').textContent = missing ? 'Poprzednia kategoria nie jest już dostępna.' : parentId === null ? 'Kategoria pojawi się bezpośrednio na liście.' : 'Nowa kategoria będzie podkategorią wskazanej kategorii.';
    }
    function render() {
      closeActions(); tree.replaceChildren();
      const { children } = M.index(nodes), query = q('[data-search]').value, filtering = !!query.trim(), result = M.search(nodes, query);
      q('[data-count]').hidden = false; q('[data-count]').textContent = String(nodes.length);
      q('[data-count]').setAttribute('aria-label', 'Wszystkich kategorii: ' + nodes.length);
      q('[data-search-info]').textContent = filtering ? 'Dopasowania: ' + result.matches.size + '. Widoczne są także kategorie nadrzędne.' : '';
      function branch(parent, depth) {
        const ul = create('ul', depth ? 'cat-list cat-nested' + (depth > 3 ? ' cat-flat' : '') : 'cat-list');
        for (const node of children.get(parent)) {
          if (filtering && !result.visible.has(node.id)) continue;
          const li = create('li'), row = create('div', 'cat-row'), kids = children.get(node.id), open = filtering || expanded.has(node.id);
          if (kids.length) {
            const toggle = create('button', 'cat-toggle', open ? '⌄' : '›'); toggle.type = 'button';
            toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', (open ? 'Zwiń: ' : 'Rozwiń: ') + node.name);
            toggle.disabled = filtering; toggle.title = filtering ? 'Wyczyść wyszukiwanie, aby zwijać gałęzie.' : '';
            toggle.onclick = () => { open ? expanded.delete(node.id) : expanded.add(node.id); render(); [...tree.querySelectorAll('.cat-toggle')].find(b => b.dataset.id === node.id)?.focus(); };
            toggle.dataset.id = node.id; row.append(toggle);
          } else row.append(create('span', 'cat-leaf-space'));
          const icon = create('span', 'cat-folder'); icon.setAttribute('aria-hidden', 'true'); row.append(icon);
          const label = create('span', 'cat-row-name' + (!depth ? ' cat-root-name' : ''), node.name);
          if (depth > 3) label.append(create('span', 'cat-path', path(node.parentId)));
          row.append(label);
          if (kids.length) { const badge = create('span', 'cat-child-count', kids.length); badge.setAttribute('aria-label', 'Bezpośrednich podkategorii: ' + kids.length); row.append(badge); }
          if (['rename', 'move', 'remove'].some(action => allowed(node, action))) {
            const more = create('button', 'cat-more', '⋯'); more.type = 'button'; more.dataset.id = node.id; more.disabled = busy || !trusted;
            more.setAttribute('aria-label', 'Działania: ' + path(node.id)); more.setAttribute('aria-expanded', 'false');
            more.onclick = () => {
              if (busy || !trusted) return;
              if (!actions.hidden && activeId === node.id) { closeActions(true); return; }
              closeActions(); activeId = node.id; origin = more;
              actions.querySelectorAll('button').forEach(b => { b.hidden = !allowed(node, b.dataset.action); });
              actions.hidden = false; more.setAttribute('aria-expanded', 'true');
              const rect = more.getBoundingClientRect(), h = actions.offsetHeight, w = actions.offsetWidth;
              actions.style.left = Math.max(8, Math.min(rect.right - w, innerWidth - w - 8)) + 'px';
              actions.style.top = Math.max(8, rect.bottom + h + 8 < innerHeight ? rect.bottom + 4 : rect.top - h - 4) + 'px';
              actions.querySelector('button:not([hidden])').focus();
            };
            row.append(more);
          }
          li.append(row); if (kids.length && open) li.append(branch(node.id, depth + 1)); ul.append(li);
        }
        return ul;
      }
      tree.append(branch(null, 0));
      if (!nodes.length) tree.append(create('p', 'cat-description', 'Nie ma jeszcze kategorii.' + (rights.create ? ' Dodaj pierwszą w formularzu.' : '')));
      else if (filtering && !result.matches.size) tree.append(create('p', 'cat-description', 'Nie znaleziono kategorii. Zmień lub wyczyść wyszukiwanie.'));
      q('[data-expand]').disabled = filtering || busy; q('[data-collapse]').disabled = filtering || busy;
      parentLabel();
    }
    async function refresh() {
      const request = ++seq; trusted = false; closeActions(); setLock(busy);
      q('[data-load-state]').textContent = initialized ? 'Odświeżanie kategorii…' : 'Wczytywanie kategorii…'; q('[data-retry]').hidden = true;
      try {
        const next = await adapter.list(); if (dead || request !== seq) return false;
        M.index(next); nodes = next; trusted = true;
        if (!initialized) { const roots = nodes.filter(n => n.parentId === null); roots.slice(0, 2).forEach(n => expanded.add(n.id)); }
        initialized = true; q('[data-load-state]').textContent = ''; render(); return true;
      } catch (err) {
        if (!dead && request === seq) { q('[data-load-state]').textContent = 'Nie udało się odczytać poprawnej listy. Odśwież ją przed wprowadzaniem zmian.'; q('[data-retry]').hidden = false; }
        return false;
      } finally { if (!dead && request === seq) { setLock(busy); if (q('[data-search]').value.trim()) { q('[data-expand]').disabled = true; q('[data-collapse]').disabled = true; } } }
    }
    const errors = { DUPLICATE: 'Taka nazwa już istnieje w wybranym miejscu.', LINKED: 'Nie można usunąć tej kategorii ze względu na istniejące powiązania.', HAS_CHILDREN: 'Ta kategoria zawiera podkategorie. Nie została usunięta.', CYCLE: 'Kategorii nie można przenieść do niej samej ani jej podkategorii.', NOT_FOUND: 'Kategoria nie jest już dostępna. Sprawdź odświeżoną listę.', FORBIDDEN: 'Nie masz uprawnień do tej operacji.', STALE: 'Dane zmieniły się. Sprawdź aktualną listę i ponów wybór.' };
    async function commit(operation, targetError, success, done) {
      if (busy || !trusted) { message(targetError, 'Najpierw odśwież listę kategorii.'); return; }
      closeActions(); message(targetError, ''); q('[data-status]').textContent = 'Zapisywanie…'; setLock(true);
      try {
        await operation(); if (dead) return;
        await refresh(); if (dead) return;
        q('[data-status]').textContent = success; done();
      } catch (err) {
        if (dead) return;
        message(targetError, errors[err.code] || 'Nie udało się potwierdzić zapisu. Sprawdź odświeżoną listę przed ponowną próbą.');
        q('[data-status]').textContent = ''; await refresh();
      } finally {
        if (!dead) { setLock(false); if (q('[data-search]').value.trim()) { q('[data-expand]').disabled = true; q('[data-collapse]').disabled = true; } }
      }
    }
    function pickerChoices() {
      const box = q('[data-picker-options]'); box.replaceChildren();
      const term = q('[data-picker-search]').value, { children } = M.index(nodes), result = M.search(nodes, term);
      const excluded = pickerMode === 'move' && nodes.some(n => n.id === activeId) ? M.descendants(nodes, activeId) : new Set();
      if (pickerMode === 'move') excluded.add(activeId);
      function choice(node, depth, host) {
        const id = node ? node.id : null;
        const label = create('label', 'cat-choice'); label.style.marginLeft = Math.min(depth, 3) * 12 + 'px';
        const radio = create('input'); radio.type = 'radio'; radio.name = uid + '-destination'; radio.value = id === null ? '' : id; radio.checked = selected === id;
        radio.onchange = () => { selected = id; q('[data-picker-selection]').textContent = 'Wybrane miejsce: ' + path(selected); };
        label.append(radio);
        const text = create('span', '', node ? node.name : 'Poziom główny');
        if (!node) text.append(create('span', 'cat-path', 'Bez kategorii nadrzędnej'));
        else if (depth > 3 || term.trim()) text.append(create('span', 'cat-path', path(node.id)));
        label.append(text); host.append(label);
      }
      choice(null, 0, box);
      function descend(node, depth, group) {
        if (excluded.has(node.id)) return;
        if (!term.trim() || result.visible.has(node.id)) choice(node, depth, group);
        children.get(node.id).forEach(child => descend(child, depth + 1, group));
      }
      for (const node of children.get(null)) {
        if (excluded.has(node.id) || (term.trim() && !result.visible.has(node.id))) continue;
        const group = create('section', 'cat-choice-group'); group.append(create('h3', '', node.name)); descend(node, 0, group); box.append(group);
      }
      if (term.trim() && box.querySelectorAll('input').length === 1) box.append(create('p', 'cat-description', 'Brak pasujących kategorii. Możesz wybrać poziom główny.'));
      q('[data-picker-selection]').textContent = 'Wybrane miejsce: ' + (selected === null || nodes.some(n => n.id === selected) ? path(selected) : 'miejsce niedostępne — wybierz ponownie');
    }
    function openPicker(mode) {
      if (!trusted || busy) return;
      pickerMode = mode; const node = nodes.find(n => n.id === activeId);
      if (mode === 'move' && !node) return;
      selected = mode === 'create' ? parentId : node.parentId;
      q('[data-picker-title]').textContent = mode === 'move' ? 'Przenieś kategorię' : 'Wybierz miejsce kategorii';
      q('[data-picker-description]').textContent = mode === 'move' ? 'Przenosisz: ' + path(activeId) + '. Wybierz nowe miejsce.' : 'Wybierz kategorię nadrzędną lub poziom główny.';
      q('[data-picker-submit]').textContent = mode === 'move' ? 'Przenieś kategorię' : 'Wybierz miejsce';
      q('[data-picker-search]').value = ''; message(q('[data-picker-error]'), ''); pickerChoices(); picker.showModal(); q('[data-picker-search]').focus();
    }
    on(q('[data-create-form]'), 'submit', async event => {
      event.preventDefault(); if (!rights.create) return;
      if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); message(error, 'Wpisz nazwę kategorii.'); name.focus(); return; }
      if (parentId !== null && !nodes.some(n => n.id === parentId)) { message(error, 'Wybierz aktualną kategorię nadrzędną.'); return; }
      name.setAttribute('aria-invalid', 'false'); const payload = { name: name.value, parentId };
      await commit(() => adapter.create(payload), error, 'Dodano kategorię.', () => {
        if (parentId) { expanded.add(parentId); M.path(nodes, parentId).forEach(n => expanded.add(n.id)); }
        name.value = ''; q('[data-search]').value = ''; render();
      });
      if (!dead) name.focus();
    });
    on(q('[data-parent]'), 'click', () => openPicker('create'));
    on(q('[data-picker-search]'), 'input', pickerChoices);
    on(q('[data-picker-form]'), 'submit', async event => {
      event.preventDefault(); const e = q('[data-picker-error]');
      if (selected !== null && !nodes.some(n => n.id === selected)) { message(e, 'Wybierz aktualną kategorię.'); return; }
      if (pickerMode === 'create') { parentId = selected; parentLabel(); dismiss(picker); return; }
      if (!M.canMove(nodes, activeId, selected)) { message(e, errors.CYCLE); return; }
      if (nodes.find(n => n.id === activeId).parentId === selected) { message(e, 'To obecne miejsce tej kategorii. Wybierz inne.'); return; }
      const id = activeId, destination = selected;
      await commit(() => adapter.move({ id, parentId: destination }), e, 'Przeniesiono kategorię.', () => {
        if (destination !== null && nodes.some(n => n.id === destination)) M.path(nodes, destination).forEach(n => expanded.add(n.id));
        q('[data-search]').value = ''; render(); picker.close();
      }); if (!dead && !picker.open) focusOrigin();
    });
    on(actions, 'click', event => {
      const button = event.target.closest('[data-action]'); if (!button || busy) return;
      const node = nodes.find(n => n.id === activeId), action = button.dataset.action;
      if (!node || !allowed(node, action)) return; closeActions();
      if (action === 'move') openPicker('move');
      if (action === 'rename') { q('[data-edit-name]').value = node.name; q('[data-edit-path]').textContent = path(node.id); message(q('[data-edit-error]'), ''); edit.showModal(); q('[data-edit-name]').focus(); }
      if (action === 'remove') { q('[data-remove-name]').textContent = path(node.id); q('[data-remove-impact]').textContent = removalDescription; message(q('[data-remove-error]'), ''); remove.showModal(); q('[data-remove-cancel]').focus(); }
    });
    on(q('[data-edit-form]'), 'submit', async event => {
      event.preventDefault(); const value = q('[data-edit-name]').value, e = q('[data-edit-error]'), id = activeId;
      if (!value.trim()) { message(e, 'Wpisz nazwę kategorii.'); q('[data-edit-name]').focus(); return; }
      await commit(() => adapter.rename({ id, name: value }), e, 'Zmieniono nazwę kategorii.', () => edit.close()); if (!dead && !edit.open) focusOrigin();
    });
    on(q('[data-remove-form]'), 'submit', async event => {
      event.preventDefault(); const id = activeId;
      await commit(() => adapter.remove({ id }), q('[data-remove-error]'), 'Usunięto kategorię.', () => remove.close()); if (!dead && !remove.open) focusOrigin();
    });
    for (const [dialog, selector] of [[picker, '[data-picker-cancel]'], [edit, '[data-edit-cancel]'], [remove, '[data-remove-cancel]'], [help, '[data-help-close]']]) {
      root.querySelectorAll(selector).forEach(b => on(b, 'click', () => dismiss(dialog)));
      on(dialog, 'cancel', event => { event.preventDefault(); dismiss(dialog); });
      on(dialog, 'click', event => { const r = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dismiss(dialog); });
    }
    on(q('[data-help]'), 'click', () => { closeActions(); help.showModal(); q('[data-help-close]').focus(); });
    on(q('[data-search]'), 'input', render);
    on(q('[data-expand]'), 'click', () => { nodes.forEach(n => expanded.add(n.id)); render(); });
    on(q('[data-collapse]'), 'click', () => { expanded.clear(); render(); });
    on(q('[data-retry]'), 'click', () => { if (!busy) refresh(); });
    on(document, 'pointerdown', event => { if (!actions.contains(event.target) && event.target !== origin) closeActions(); });
    on(document, 'focusin', event => { if (!actions.hidden && !actions.contains(event.target) && event.target !== origin) closeActions(); });
    on(document, 'keydown', event => { if (event.key === 'Escape' && !actions.hidden) { closeActions(true); event.preventDefault(); } });
    on(window, 'resize', () => closeActions());
    document.addEventListener('scroll', () => closeActions(), { capture: true, signal: ac.signal });
    return { ready: refresh(), refresh: () => busy ? Promise.resolve(false) : refresh(), destroy() { dead = true; seq++; ac.abort(); root.querySelectorAll('dialog[open]').forEach(d => d.close()); tree.replaceChildren(); closeActions(); delete root.dataset.catMounted; } };
  }
  global.EstelioCategories = Object.freeze({ mount });
})(window);
