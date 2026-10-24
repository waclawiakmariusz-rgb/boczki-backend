/* Czyste funkcje prezentacji. Bez reguł zakupów i bez wywołań API. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EstelioSuggestionsModel=api;})(globalThis,function(){'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function normalize(s){return String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/Ł/g,'L').toLocaleLowerCase('pl-PL').trim();}
function filterRules(rules,query){const terms=normalize(query).split(/\s+/).filter(Boolean);return rules.filter(r=>{const text=normalize([r.source.label,r.target.label,r.note].join(' '));return terms.every(t=>text.includes(t));});}
function filterOptions(options,query){const q=normalize(query);return options.filter(x=>normalize(x.label).includes(q));}
function payload(draft){return {source:{id:draft.source.id??null,label:String(draft.source.label??'').trim()},target:{id:draft.target.id??null,label:String(draft.target.label??'').trim()},note:String(draft.note??'').trim()};}
function emptyDraft(){return {source:{id:null,label:''},target:{id:null,label:''},note:''};}
function isDirty(draft){const p=payload(draft);return !!(p.source.label||p.target.label||p.note);}
return {clone,normalize,filterRules,filterOptions,payload,emptyDraft,isDirty};});
