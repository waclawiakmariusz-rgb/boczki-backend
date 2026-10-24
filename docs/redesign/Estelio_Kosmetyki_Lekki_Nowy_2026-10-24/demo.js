'use strict';
window.cosmeticsDemo=EstelioCosmetics.mount(document.querySelector('.estelio-cosmetics'),EstelioCosmeticsDemo.create(new URLSearchParams(location.search).get('stan')||''));
