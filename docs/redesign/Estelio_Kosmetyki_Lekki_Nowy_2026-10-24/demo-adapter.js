/* Adapter pamięciowy WYŁĄCZNIE do demonstracji. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./model.js'):root.EstelioCosmeticsModel);if(typeof module==='object'&&module.exports)module.exports=api;else root.EstelioCosmeticsDemo=api;})(globalThis,function(M){'use strict';
const rows=[['Aliness','Berberine sulphate',7000],['Aliness','Biotyna',3500],['Aliness','CDP Choline',9500],['Aliness','Cynk chelatowany',3200],['Aliness','Czerwona koniczyna',5500],['Aliness','Green Coffee',5000],['APIS','Dermasoft',5900],['Boczki na Bok','szczotka do ciała',8000],['Bruno Vassari','Brightness Reveal Cream',40900],['Bruno Vassari','Firming Pack',21000],['Bruno Vassari','Illuminating Eye Contour',26000],['Bruno Vassari','Illuminating Pack',21000],['Bruno Vassari','SPF 40 Everyday Protection',15900]];
const initialBrands=['APIS','Aliness','Boczki na Bok','Bruno Vassari','Dermagenetic','Flerage','LPG','Monduniq','Purles','Radicale','SIMON OURIAN M.D.','Vagheggi','estGen'];
function create(scenario=''){
let products=rows.map((x,i)=>({id:'p'+(i+1),version:1,brand:x[0],name:x[1],priceCents:x[2]}));if(scenario==='pusto')products=[];
let version=1,next=14,loads=0;const ops=new Map(),readonly=scenario==='tylko-odczyt';
const fail=(code,message)=>Object.assign(Error(message),{code});
function snapshot(){const brands=[...new Set([...initialBrands,...products.map(p=>p.brand)])].sort((a,b)=>a.localeCompare(b,'pl'));return M.clone({products,brands,version,canCreate:!readonly,canEdit:!readonly,canDelete:!readonly});}
function operate(type,body,ctx,fn){const key=ctx.operationId;if(!key)throw Error('Brak operationId');const f=JSON.stringify({type,body}),cached=ops.get(key);if(cached){if(cached.f!==f)throw fail('CONFLICT','Klucz innej operacji');return {...snapshot(),changedId:cached.id};}if(readonly)throw fail('FORBIDDEN','Brak uprawnień');if(scenario==='blad-zapisu')throw fail('SAVE_FAILED','Błąd zapisu');if(scenario==='timeout')throw fail('UNCERTAIN','Niepewny wynik');if(ctx.version!==version)throw fail('CONFLICT','Nieaktualna wersja');const id=fn();version++;ops.set(key,{f,id});return {...snapshot(),changedId:id};}
function fields(d){const v=M.validate(d);if(!v.valid)throw Object.assign(Error('Popraw pola'),{fields:v.errors});return {brand:d.brand.trim(),name:d.name.trim(),priceCents:M.parsePrice(d.price)};}
return {async load(){if(scenario==='blad-odczytu'&&loads++===0)throw Error('Błąd odczytu');return snapshot();},validate:M.validate,
 async createProduct(d,ctx){return operate('create',d,ctx,()=>{const values=fields(d),id='p'+next++;products.push({id,version:1,...values});return id;});},
 async updateProduct(id,d,ctx){return operate('update',{id,d},ctx,()=>{const i=products.findIndex(p=>p.id===id);if(i<0)throw fail('NOT_FOUND','Brak produktu');products[i]={...products[i],...fields(d),version:products[i].version+1};return id;});},
 async deleteProduct(id,ctx){return operate('delete',id,ctx,()=>{if(scenario==='powiazany')throw fail('IN_USE','Produkt ma powiązania');if(!products.some(p=>p.id===id))throw fail('NOT_FOUND','Brak produktu');products=products.filter(p=>p.id!==id);return id;});}
};}
return {create};});
