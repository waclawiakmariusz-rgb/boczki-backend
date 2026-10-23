(function (scope) {
  'use strict';
  function index(nodes) {
    if (!Array.isArray(nodes)) throw new Error('INVALID_TREE');
    const byId = new Map(), children = new Map([[null, []]]);
    for (const node of nodes) {
      if (!node || typeof node.id !== 'string' || !node.id || typeof node.name !== 'string' || !node.name.trim() || !(node.parentId === null || typeof node.parentId === 'string') || byId.has(node.id)) throw new Error('INVALID_TREE');
      byId.set(node.id, node); children.set(node.id, []);
    }
    for (const node of nodes) {
      if (node.parentId !== null && !byId.has(node.parentId)) throw new Error('INVALID_TREE');
      const visited = new Set([node.id]); let parent = node.parentId;
      while (parent !== null) {
        if (visited.has(parent)) throw new Error('INVALID_TREE');
        visited.add(parent); parent = byId.get(parent).parentId;
      }
      children.get(node.parentId).push(node);
    }
    return { byId, children };
  }
  function path(nodes, id) {
    if (id === null) return [];
    const { byId } = index(nodes); if (!byId.has(id)) throw new Error('NOT_FOUND');
    const result = []; let current = id;
    while (current !== null) { const row = byId.get(current); result.unshift(row); current = row.parentId; }
    return result;
  }
  function descendants(nodes, id) {
    const { byId, children } = index(nodes); if (!byId.has(id)) throw new Error('NOT_FOUND');
    const found = new Set(), queue = [...children.get(id)];
    while (queue.length) { const node = queue.shift(); found.add(node.id); queue.push(...children.get(node.id)); }
    return found;
  }
  function canMove(nodes, id, parentId) {
    const { byId } = index(nodes);
    return byId.has(id) && (parentId === null || byId.has(parentId)) && id !== parentId && !descendants(nodes, id).has(parentId);
  }
  function fold(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLocaleLowerCase('pl'); }
  function search(nodes, query) {
    const { byId } = index(nodes), term = fold(query.trim()), matches = new Set(), visible = new Set();
    for (const node of nodes) {
      if (!term || fold(path(nodes, node.id).map(row => row.name).join(' / ')).includes(term)) {
        matches.add(node.id); let id = node.id;
        while (id !== null) { visible.add(id); id = byId.get(id).parentId; }
      }
    }
    return { matches, visible };
  }
  const api = Object.freeze({ index, path, descendants, canMove, fold, search });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.EstelioCategoryModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
