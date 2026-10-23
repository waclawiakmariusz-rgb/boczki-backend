(function () {
  'use strict';
  const initial = ['Anna', 'Barbara', 'Ewa', 'Julia', 'Karolina', 'Katarzyna', 'Maria', 'Zofia'];
  const mode = new URLSearchParams(location.search).get('stan');
  let data = mode === 'pusty' ? [] : initial.map((name, i) => ({ id: 'demo-' + i, name: name + ' Kowalska' }));
  if (mode === 'dluga-nazwa') data[0].name = 'Aleksandra Maria Kowalska-Nowak — przykładowa bardzo długa nazwa pracownika';
  let nextId = 8;
  const delay = () => new Promise(resolve => setTimeout(resolve, 350));
  const adapter = {
    async list() { await delay(); if (mode === 'blad-listy') throw new Error('DEMO'); return data.map(row => ({ ...row })); },
    async create({ name }) {
      await delay();
      if (mode === 'blad-zapisu') throw new Error('DEMO');
      if (data.some(row => row.name.toLocaleLowerCase('pl') === name.trim().toLocaleLowerCase('pl'))) throw Object.assign(new Error('DEMO'), { code: 'DUPLICATE' });
      const row = { id: 'demo-' + nextId++, name: name.trim() }; data.push(row); return { ...row };
    },
    async remove({ id }) {
      await delay();
      if (mode === 'blokada') throw Object.assign(new Error('DEMO'), { code: 'LINKED' });
      const index = data.findIndex(row => row.id === id);
      if (index < 0) throw Object.assign(new Error('DEMO'), { code: 'NOT_FOUND' });
      data.splice(index, 1);
    }
  };
  window.employeesDemo = EstelioEmployees.mount(document.querySelector('.est-employees'), {
    adapter,
    canAdd: mode !== 'podglad', canRemove: mode !== 'podglad',
    removeImpact: 'To podgląd demonstracyjny. Zmiana dotyczy wyłącznie tej otwartej strony; odświeżenie przywróci przykładowe dane.'
  });
})();
