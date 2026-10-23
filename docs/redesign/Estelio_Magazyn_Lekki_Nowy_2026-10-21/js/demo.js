'use strict';
const demoConfig = document.body.dataset;
window.inventoryDemo = EstelioInventoryForm.mount(
  document.querySelector('[data-inventory-root]'),
  createInventoryDemoAdapter(demoConfig.scenario),
  {mode: demoConfig.mode, productId: demoConfig.mode === 'edit' ? 'DEMO-PRODUCT-1' : null, initialCategoryOpen: demoConfig.openCategory === 'true'}
);
