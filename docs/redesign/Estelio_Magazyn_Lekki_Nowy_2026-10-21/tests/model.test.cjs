const {test} = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/model.js');
require('../js/demo-adapter.js');
const cats = [{id:'a',label:'Płyny',path:['Inwentaryzacja tygodniowa']},{id:'b',label:'Płyny',path:['Inwentaryzacja miesięczna']},{id:'x',label:'Archiwalna',path:[],active:false}];
const product = {name:'Produkt',categoryId:'a',quantity:'12',unit:'szt.',minimum:'5',expiry:'',price:''};
test('Pusta opcjonalna cena nie jest zerem',()=>{
 assert.deepEqual(M.decimal('',{optional:true,precision:2}),{value:null});
 assert.deepEqual(M.decimal('0,00',{optional:true,precision:2}),{value:'0'});
});
test('Polski przecinek i precyzja bez arytmetyki zmiennoprzecinkowej',()=>{
 assert.equal(M.decimal('0012,500').value,'12.5');
 assert.equal(M.decimal('9007199254740993,25',{precision:2}).value,'9007199254740993.25');
 assert.ok(M.decimal('1,234',{precision:2}).error);
});
test('Nie akceptuje częściowych liczb, notacji wykładniczej ani niejawnego zera',()=>{
 for(const v of ['','1e3','12abc','1,2.3','NaN','Infinity'])assert.ok(M.decimal(v).error,v);
});
test('Ujemny stan wymaga jawnej reguły adaptera',()=>{
 assert.ok(M.decimal('-1').error);assert.equal(M.decimal('-1',{negative:true}).value,'-1');
});
test('Daty bez przesunięć stref i niemożliwych dni',()=>{
 assert.equal(M.validDate('2024-02-29'),true);assert.equal(M.validDate('2026-02-29'),false);
 assert.equal(M.validDate('2026-13-01'),false);assert.equal(M.validDate(''),true);
});
test('Kategorie: wyszukiwanie po pełnej ścieżce i polskich znakach',()=>{
 assert.deepEqual(M.filterCategories(cats,'tygodniowa plyny').map(c=>c.id),['a']);
 assert.deepEqual(M.filterCategories(cats,'płyny').map(c=>c.id),['a','b']);
 assert.equal(M.filterCategories(cats,'archiwalna').length,0);
});
test('Prawidłowy produkt ma siedem pól; brak ceny i daty zachowuje null',()=>{
 const r=M.validate(product,cats);assert.deepEqual(r.errors,{});assert.equal(Object.keys(r.value).length,7);
 assert.equal(r.value.price,null);assert.equal(r.value.expiry,null);
});
test('Niedostępna kategoria tylko dla niezmienionej istniejącej relacji',()=>{
 assert.ok(M.validate({...product,categoryId:'x'},cats).errors.categoryId);
 assert.equal(M.validate({...product,categoryId:'x'},cats,{}, {...product,categoryId:'x'}).errors.categoryId,undefined);
 assert.ok(M.validate({...product,categoryId:'new-id'},cats).errors.categoryId);
});
test('Zmiana nazwy nie tworzy zmiany ilości',()=>{
 const a=M.validate(product,cats).value,b={...a,name:'Nowa nazwa'};
 assert.deepEqual(M.patch(a,b),{name:'Nowa nazwa'});
});
test('Usunięcie daty i ceny jest jawną zmianą na null',()=>{
 assert.deepEqual(M.patch({expiry:'2027-01-01',price:'49'}, {expiry:null,price:null}),{expiry:null,price:null});
});
test('DEMO: ponowienie tego samego klucza nie tworzy drugiego produktu',async()=>{
 const a=createInventoryDemoAdapter();const r={mode:'create',operationId:'op',values:product,changes:product};
 const first=await a.save(r),second=await a.save(r);
 assert.deepEqual(second,first);assert.equal((await a.load()).version,2);
 assert.equal((await a.save({...r,values:{...product,name:'Inna'}})).status,'rejected');
});
test('DEMO: konflikt wersji nie nadpisuje produktu',async()=>{
 const a=createInventoryDemoAdapter();const r={mode:'edit',productId:'1',expectedVersion:1,operationId:'one',values:product};
 await a.save(r);assert.equal((await a.save({...r,operationId:'two',values:{...product,quantity:'99'}})).status,'conflict');
 assert.equal((await a.load()).product.quantity,'12');
});
test('DEMO: sprawdzanie wyniku tylko odczytuje operację',async()=>{
 const a=createInventoryDemoAdapter();assert.equal((await a.resolve({operationId:'missing'})).status,'unknown');
 const r=await a.save({mode:'create',operationId:'one',values:product});
 assert.deepEqual(await a.resolve({operationId:'one'}),r);assert.equal((await a.load()).version,2);
});
