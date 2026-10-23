/* No network, DOM or business-side mutations. Decimal values stay strings. */
(function (g) {
  'use strict';
  const fields = ['name', 'categoryId', 'quantity', 'unit', 'minimum', 'expiry', 'price'];
  function decimal(value, {optional = false, precision = 6, negative = false} = {}) {
    const raw = String(value ?? '').trim();
    if (!raw) return optional ? {value: null} : {error: 'Uzupełnij wartość.'};
    if (!/^-?\d+(?:[.,]\d+)?$/.test(raw)) return {error: 'Wpisz liczbę, np. 12 lub 12,5.'};
    if (!negative && raw.startsWith('-')) return {error: 'Wartość nie może być ujemna.'};
    let [integer, fraction = ''] = raw.replace(',', '.').split('.');
    if (fraction.length > precision) return {error: `Maksymalnie ${precision} miejsc po przecinku.`};
    integer = integer.replace(/^(-?)0+(?=\d)/, '$1');
    fraction = fraction.replace(/0+$/, '');
    let result = integer + (fraction ? '.' + fraction : '');
    if (result === '-0') result = '0';
    return {value: result};
  }
  function validDate(s) {
    if (!s) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < 1000) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function normalize(value) {
    return String(value).toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
  }
  function filterCategories(categories, query) {
    const words = normalize(query).trim().split(/\s+/).filter(Boolean);
    return categories.filter(c => c.active !== false && c.selectable !== false && words.every(w => normalize([...c.path, c.label].join(' ')).includes(w)));
  }
  function validate(raw, categories, rules = {}, original = null) {
    const errors = {}, value = {};
    value.name = raw.name.trim();
    value.unit = raw.unit.trim();
    if (!value.name) errors.name = 'Podaj nazwę produktu.';
    if (!value.unit) errors.unit = 'Podaj jednostkę, np. szt. lub ml.';
    if (rules.maxName && value.name.length > rules.maxName) errors.name = `Maksymalnie ${rules.maxName} znaków.`;
    if (rules.maxUnit && value.unit.length > rules.maxUnit) errors.unit = `Maksymalnie ${rules.maxUnit} znaków.`;
    value.categoryId = raw.categoryId;
    const category = categories.find(c => c.id === raw.categoryId);
    const unchangedArchived = original && original.categoryId === raw.categoryId && raw.categoryId;
    if (!category && !unchangedArchived) errors.categoryId = 'Wybierz kategorię z listy.';
    else if (category && (category.active === false || category.selectable === false) && !unchangedArchived) errors.categoryId = 'Ta kategoria nie jest dostępna. Wybierz inną.';
    for (const key of ['quantity', 'minimum', 'price']) {
      const parsed = decimal(raw[key], {optional: key === 'price', precision: key === 'price' ? 2 : (rules.quantityPrecision ?? 6), negative: key === 'quantity' && rules.allowNegativeStock === true});
      if (parsed.error) errors[key] = parsed.error;
      else value[key] = parsed.value;
    }
    value.expiry = raw.expiry || null;
    if (!validDate(raw.expiry)) errors.expiry = 'Podaj poprawną datę.';
    return {value, errors};
  }
  function patch(before, after) {
    return Object.fromEntries(fields.filter(k => !Object.is(before[k], after[k])).map(k => [k, after[k]]));
  }
  const api = {fields, decimal, validDate, normalize, filterCategories, validate, patch};
  g.EstelioInventoryModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
