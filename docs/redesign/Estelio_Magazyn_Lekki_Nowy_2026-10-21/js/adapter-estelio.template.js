/* Do not invent endpoints. Map the current Estelio services to this interface. */
(function (g) {
  'use strict';
  g.createInventoryEstelioAdapter = function (services) {
    for (const key of ['load', 'save', 'resolve', 'cancel']) {
      if (typeof services[key] !== 'function') throw new Error(`Brak integracji magazynu: ${key}`);
    }
    return {
      isDemo: false,
      load: context => services.load(context),
      save: operation => services.save(operation),
      resolve: operation => services.resolve(operation),
      cancel: context => services.cancel(context)
    };
  };
})(globalThis);
