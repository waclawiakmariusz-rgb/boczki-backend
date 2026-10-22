/* WYŁĄCZNIE PODGLĄD. Nie importować do produktu. Nie komunikuje się z serwerem. */
(function () {
  'use strict';
  const reference = { brandId: 'demo-bruno', productId: 'demo-firming', typeId: 'demo-creams', quantity: 6, expiryDate: '2027-12-31', netCents: 8000, grossCents: 9840 };
  const catalog = {
    brands: [{ id: 'demo-bruno', name: 'Bruno Vassari' }, { id: 'demo-estelio', name: 'Marka przykładowa' }],
    types: [{ id: 'demo-creams', name: 'Kremy' }, { id: 'demo-serums', name: 'Serum' }],
    products: [
      { id: 'demo-firming', brandId: 'demo-bruno', name: 'Firming Pack', typeId: 'demo-creams', netCents: 8000, grossCents: 9840 },
      { id: 'demo-serum', brandId: 'demo-bruno', name: 'Serum demonstracyjne', typeId: 'demo-serums', netCents: 10000, grossCents: 12300 },
      { id: 'demo-long', brandId: 'demo-estelio', name: 'Krem regenerujący o długiej nazwie — pojemność 200 ml', typeId: 'demo-creams', netCents: 5000, grossCents: 6150 }
    ]
  };
  const knownResults = new Map();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let saveCalls = 0;
  let app;
  const adapter = {
    async loadCatalog() { return catalog; },
    async save(payload, context) {
      saveCalls++;
      const scenario = document.querySelector('[data-demo-scenario]').value;
      const existing = knownResults.get(context.operationId);
      if (existing) return existing;
      await pause(850);
      const name = catalog.products.find(p => p.id === payload.productId)?.name;
      const result = { status: 'confirmed', receiptId: 'DEMO-' + saveCalls, message: `Podgląd: przyjęto ${payload.quantity} szt. ${name}. Magazyn Estelio nie został zmieniony.` };
      if (scenario === 'rejected') return { status: 'rejected', message: 'Przykładowa odmowa zapisu. Dane są zachowane; możesz je poprawić lub zmienić scenariusz na sukces.' };
      knownResults.set(context.operationId, result);
      if (scenario === 'unknown') return { status: 'unknown' };
      return result;
    },
    async checkResult({ operationId }) { await pause(450); return knownResults.get(operationId) || { status: 'unknown' }; },
    onSuccess() {
      app.reset();
      document.querySelector('[data-demo-status]').textContent = 'Symulacja zakończona. Formularz wyczyszczono; realny stan magazynu nie został zmieniony.';
    },
    onCancel() {
      app.reset();
      document.querySelector('[data-demo-status]').textContent = 'Podgląd: anulowano przyjęcie. W Estelio ta akcja użyje istniejącego powrotu do magazynu.';
    }
  };
  app = EstelioGoodsReceipt.mount(document.querySelector('[data-goods-receipt]'), adapter, { initialValues: reference });
  document.querySelector('[data-demo-reference]').addEventListener('click', () => {
    if (!app.reset(reference)) document.querySelector('[data-demo-status]').textContent = 'Najpierw rozstrzygnij wynik trwającej operacji.';
  });
  document.querySelector('[data-demo-empty]').addEventListener('click', () => {
    if (!app.reset()) document.querySelector('[data-demo-status]').textContent = 'Najpierw rozstrzygnij wynik trwającej operacji.';
  });
  // Jawny interfejs prób na fikcyjnych danych; nie jest częścią komponentu produkcyjnego.
  window.EstelioReceiptDemo = { app, adapter, catalog, reference, get saveCalls() { return saveCalls; } };
})();
