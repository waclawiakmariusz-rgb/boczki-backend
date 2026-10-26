'use strict';
window.depositDemo=window.EstelioDeposit.mount(document.querySelector('.estelio-deposit-settings'),window.DepositDemoModel.createAdapter(new URLSearchParams(location.search).get('stan')||''));
