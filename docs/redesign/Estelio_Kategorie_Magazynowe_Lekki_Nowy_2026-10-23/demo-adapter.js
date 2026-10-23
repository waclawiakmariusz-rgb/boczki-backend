(function (scope) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./kategorie-model.js') : scope.EstelioCategoryModel;
  function createDemo({ mode = '', delay = 200 } = {}) {
    let rows = [
      { id:'d',name:'Dokumenty',parentId:null },
      { id:'dk',name:'Dokumenty dla klienta',parentId:'d' },
      { id:'dl',name:'Dokumenty dla lokalu',parentId:'d' },
      { id:'dp',name:'Pierwsza wizyta',parentId:'d' },
      { id:'m',name:'Inwentaryzacja miesięczna',parentId:null },
      { id:'mj',name:'Materiały jednorazowe',parentId:'m' },
      { id:'mb',name:'Artykuły biurowe',parentId:'m' },
      { id:'mc',name:'Chemia gospodarcza',parentId:'m' },
      { id:'mp',name:'Preparaty zabiegowe',parentId:'m' },
      { id:'t',name:'Inwentaryzacja tygodniowa',parentId:null },
      { id:'tr',name:'Ręczniki',parentId:'t' },
      { id:'ts',name:'Środki do dezynfekcji',parentId:'t' }
    ];
    if (mode === 'pusty') rows = [];
    if (mode === 'glebokie') for (let i=0;i<7;i++) rows.push({id:'deep'+i,name:'Podkategoria z długą nazwą — poziom '+(i+1),parentId:i?'deep'+(i-1):'mp'});
    let next=1;
    const fail = code => { throw Object.assign(new Error(code),{code}); };
    const wait = () => new Promise(resolve => setTimeout(resolve,delay));
    const node = id => rows.find(n=>n.id===id) || fail('NOT_FOUND');
    function valid(name,parent,id) {
      if (!name.trim()) fail('EMPTY');
      if (parent!==null) node(parent);
      if (rows.some(n=>n.id!==id && n.parentId===parent && n.name.trim().toLocaleLowerCase('pl')===name.trim().toLocaleLowerCase('pl'))) fail('DUPLICATE');
      if(mode==='blad-zapisu') fail('DEMO_ERROR');
    }
    return {
      async list(){await wait();if(mode==='blad-listy') fail('DEMO_ERROR');return rows.map(n=>({...n}));},
      async create({name,parentId}){await wait();valid(name,parentId);const item={id:'new'+next++,name:name.trim(),parentId};rows.push(item);return {...item};},
      async rename({id,name}){await wait();const n=node(id);valid(name,n.parentId,id);n.name=name.trim();return {...n};},
      async move({id,parentId}){await wait();const n=node(id);if(!M.canMove(rows,id,parentId))fail('CYCLE');valid(n.name,parentId,id);n.parentId=parentId;return {...n};},
      async remove({id}){await wait();node(id);if(mode==='blokada')fail('LINKED');if(rows.some(n=>n.parentId===id))fail('HAS_CHILDREN');rows=rows.filter(n=>n.id!==id);}
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = createDemo;
  else scope.createCategoryDemo = createDemo;
})(typeof window !== 'undefined' ? window : globalThis);
