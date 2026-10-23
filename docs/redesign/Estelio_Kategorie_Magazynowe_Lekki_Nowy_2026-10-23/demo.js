(function(){
  const mode=new URLSearchParams(location.search).get('stan') || '';
  const can=mode!=='podglad';
  window.categoriesDemo=EstelioCategories.mount(document.querySelector('.est-categories'),{
    adapter:createCategoryDemo({mode}),permissions:{create:can,rename:can,move:can,remove:can},
    removalDescription:'Podgląd demonstracyjny: można usunąć tylko kategorię bez podkategorii. Dane wrócą po odświeżeniu strony. Zasady produkcyjne musi potwierdzić Claude w kodzie Estelio.'
  });
})();
