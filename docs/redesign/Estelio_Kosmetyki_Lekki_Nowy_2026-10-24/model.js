/* Funkcje prezentacji; parser i ograniczenia ceny są przykładem demo. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EstelioCosmeticsModel=api;})(globalThis,function(){'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function normalize(x){return String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLocaleLowerCase('pl-PL').trim();}
function parsePrice(value){const s=String(value).trim();if(!/^\d{1,9}([,.]\d{1,2})?$/.test(s))return null;const [a,b='']=s.replace(',','.').split('.');return Number(a)*100+Number(b.padEnd(2,'0'));}
function priceInput(cents){if(!Number.isSafeInteger(cents)||cents<0)return '';return Math.floor(cents/100)+','+String(cents%100).padStart(2,'0');}
function priceLabel(cents){if(!Number.isSafeInteger(cents)||cents<0)return '—';return Math.floor(cents/100).toLocaleString('pl-PL')+','+String(cents%100).padStart(2,'0')+' zł';}
function filter(products,query){const terms=normalize(query).split(/\s+/).filter(Boolean);return products.filter(p=>{const t=normalize(p.brand+' '+p.name);return terms.every(term=>t.includes(term));});}
function paginate(items,page,size=6){if(!Number.isInteger(size)||size<1)throw Error('Niepoprawny rozmiar strony');const pages=Math.max(1,Math.ceil(items.length/size));page=Math.max(1,Math.min(Number.isInteger(page)?page:1,pages));const start=(page-1)*size;return {items:items.slice(start,start+size),page,pages,total:items.length,from:items.length?start+1:0,to:Math.min(start+size,items.length)};}
function validate(d){const errors={};if(!String(d.brand??'').trim())errors.brand='Wybierz firmę lub wpisz jej nazwę.';if(!String(d.name??'').trim())errors.name='Wpisz nazwę produktu.';if(parsePrice(d.price)===null)errors.price='Wpisz cenę, np. 260,00 (maksymalnie dwa miejsca po przecinku).';return {valid:!Object.keys(errors).length,errors};}
function canonical(d){return {brand:String(d.brand??'').trim(),name:String(d.name??'').trim(),price:parsePrice(d.price)??String(d.price??'').trim()};}
function sameDraft(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function payload(d){return {brand:String(d.brand??'').trim(),name:String(d.name??'').trim(),price:String(d.price??'').trim()};}
return {clone,normalize,parsePrice,priceInput,priceLabel,filter,paginate,validate,sameDraft,payload};});
