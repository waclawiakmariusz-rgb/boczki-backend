'use strict';
window.suggestionsDemo=EstelioSuggestions.mount(document.querySelector('.estelio-suggestions'),EstelioSuggestionsDemo.create(new URLSearchParams(location.search).get('stan')||''));
