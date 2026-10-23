/* Demo only: no server calls or persistence. NOT a production inventory engine. */
(function (g) {
  'use strict';
  const copy = x => JSON.parse(JSON.stringify(x));
  g.createInventoryDemoAdapter = function (scenario = 'filled') {
    const categories = [
      {id: 'm-carbo', label: 'Karboksyterapia', path: ['Inwentaryzacja miesięczna']},
      {id: 'm-lipo', label: 'Lipoliza iniekcyjna', path: ['Inwentaryzacja miesięczna']},
      {id: 'm-stym', label: 'Stymulatory', path: ['Inwentaryzacja miesięczna']},
      {id: 'w-hig', label: 'Higieniczne', path: ['Inwentaryzacja tygodniowa']},
      {id: 'w-plyn', label: 'Płyny', path: ['Inwentaryzacja tygodniowa']},
      {id: 'w-zab', label: 'Zabiegowe', path: ['Inwentaryzacja tygodniowa']}
    ];
    let product = {name: 'Rękawiczki nitrylowe, rozmiar M', categoryId: 'w-hig', quantity: '12', unit: 'szt.', minimum: '5', expiry: null, price: null};
    if (scenario === 'empty') product = {name: '', categoryId: '', quantity: '0', unit: '', minimum: '5', expiry: null, price: null};
    let version = 1;
    const operations = new Map();
    return {
      isDemo: true,
      async load() {
        return copy({product, categories, version, canSave: true, rules: {quantityPrecision: 6, allowNegativeStock: false}});
      },
      async save(request) {
        const fingerprint = JSON.stringify({mode: request.mode, productId: request.productId, expectedVersion: request.expectedVersion, values: request.values, changes: request.changes});
        if (operations.has(request.operationId)) {
          const old = operations.get(request.operationId);
          return old.fingerprint === fingerprint ? copy(old.result) : {status: 'rejected', message: 'Klucz operacji został już użyty z innymi danymi.'};
        }
        if (request.mode === 'edit' && request.expectedVersion !== version) return {status: 'conflict'};
        product = copy(request.values);
        version += 1;
        const result = {status: 'confirmed', product: copy(product), productId: request.productId || 'DEMO-PRODUCT-1', version};
        operations.set(request.operationId, {fingerprint, result});
        return copy(result);
      },
      async resolve({operationId}) {
        return operations.has(operationId) ? copy(operations.get(operationId).result) : {status: 'unknown'};
      },
      async cancel() { return {message: 'Anulowano podgląd. Nie zmieniono danych Estelio.'}; }
    };
  };
})(globalThis);
