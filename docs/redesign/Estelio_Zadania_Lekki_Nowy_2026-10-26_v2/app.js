'use strict';
// Lokalny prototyp. Dane syntetyczne w pamięci; brak połączenia z Estelio/API.
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const areas = ['Klient', 'Magazyn', 'Kosmetyk', 'Sprzedaż', 'Inne'];
const groups = [['overdue','Po terminie'], ['today','Na dziś'], ['planned','Zaplanowane'], ['none','Bez terminu']];
const DEMO_NOW = '2026-10-26T12:00';
const contacts = {
 anna: {name:'Anna Kowalska', phone:'000 000 101', kind:'client'},
 ewa: {name:'Ewa Kowalska', phone:'', kind:'client'},
 lead104: {name:'Lead 104', phone:'000 000 102', kind:'lead'}
};
let tasks, nextId, openId = null, expanded = new Set(), leadStatus = 'nowy', editorSnapshot = '', lastFocus;
let state = {kind:'all', mine:false, area:'all', query:'', demo:'normal'};
let toastTimer;
function seed() {
 let id=1, output=[];
 const distributions = {phone:[3,2,6,3], task:[2,2,6,5]};
 for (const type of ['phone','task']) distributions[type].forEach((count,g) => {
  for(let i=0;i<count;i++) {
   const area=type==='phone'?'Klient':['Inne','Kosmetyk','Magazyn','Sprzedaż'][i%4];
   output.push({id:id++, type, title:type==='phone'?`Skontaktować się z klientką — sprawa ${id-1}`:`Sprawdzić listę materiałów — zadanie ${id-1}`, phone:type==='phone'?'000 000 101':'', contact:type==='phone'?'anna':'', areas:[area], assigned:i===0?['ola']:['alicja'], priority:'Normalny', description:'Przykładowe zadanie do przetestowania nowego widoku.', products:'', clients:[], repeat:'', due:g===0?`2026-10-${24+i}T${g===0&&i===2?'09':'10'}:00`:g===1?`2026-10-26T${16+i}:00`:g===2?`2026-10-${27+i%4}T10:00`:'', comments:[], history:[], done:false, archived:false});
  }
 });
 output[0].title='Potwierdzić termin — Anna Kowalska'; output[0].areas=['Klient','Sprzedaż']; output[0].due='2026-10-24T20:00';
 Object.assign(output[1],{title:'Lead 104 — zapytać o konsultację',contact:'lead104',phone:'000 000 102',areas:['Sprzedaż'],due:'2026-10-25T16:00',description:'Pytała o konsultację. Prosi o kontakt po 16:00.',comments:[{author:'Alicja',text:'Wysłałam informację o dostępnych terminach.',time:'26.10.2026, 09:12'}]});
 Object.assign(output[11],{title:'Ustalić dogodny termin — Ewa Kowalska',contact:'ewa',phone:''});
 output.find(t=>t.type==='task'&&groupOf(t)==='today').title='Nagrać rolkę po dzisiejszym zabiegu';
 const cosmetic=output.find(t=>t.type==='task'&&groupOf(t)==='planned');cosmetic.title='Sprawdzić terminy ważności kosmetyków';cosmetic.areas=['Kosmetyk'];
 return output;
}
function groupOf(t) { if(!t.due)return 'none'; if(t.due<DEMO_NOW)return 'overdue'; return t.due.slice(0,10)==='2026-10-26'?'today':'planned'; }
function isActive(t){return !t.done&&!t.archived;}
function eligible(t){return isActive(t)&&(!state.mine||t.assigned.includes('ola'))&&(state.area==='all'||t.areas.includes(state.area))&&[t.title,t.phone,contacts[t.contact]?.name,...t.areas].join(' ').toLocaleLowerCase('pl').includes(state.query.toLocaleLowerCase('pl'));}
function dateLabel(t) {
 if(!t.due)return 'Bez terminu';
 const [date,time]=t.due.split('T');const [y,m,d]=date.split('-');
 return `${date==='2026-10-26'?'Dziś':d+'.'+m} · ${time||'cały dzień'}${groupOf(t)==='overdue'?' · po terminie':''}`;
}
function chip(area){return `<span class="chip area-${escapeHTML(area)}">${escapeHTML(area)}</span>`;}
function notify(message){$('#toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').textContent='',5000);}
function render() {
 const active=state.demo==='empty'?[]:tasks.filter(isActive), base=state.demo==='empty'?[]:tasks.filter(eligible);
 const isPending=['loading','error'].includes(state.demo);
 $('#total-title').textContent=isPending?'Zadania zespołu':`Masz ${active.length} aktywnych zadań`;
 $('#summary').textContent=isPending?(state.demo==='loading'?'Pobieranie danych…':'Dane są chwilowo niedostępne'):`${active.filter(t=>t.type==='phone').length} telefonów · ${active.filter(t=>groupOf(t)==='overdue').length} po terminie · ${active.filter(t=>groupOf(t)==='today').length} na dziś`;
 for(const kind of ['all','phone','task'])$('#count-'+kind).textContent=isPending?'—':base.filter(t=>kind==='all'||t.type===kind).length;
 const visible=base.filter(t=>state.kind==='all'||t.type===state.kind);
 $('#scope').textContent=isPending?'':`${state.mine?'Przypisane do mnie':state.kind==='phone'?'Telefony':state.kind==='task'?'Do zrobienia':'Wszystkie aktywne'}${state.area!=='all'?' · '+state.area:''} · ${visible.length} z ${active.length} zadań`;
 $('#clear').hidden=!(state.mine||state.area!=='all'||state.query||state.kind!=='all');
 const list=$('#list'); list.setAttribute('aria-busy',String(state.demo==='loading'));
 if(state.demo==='loading'){list.innerHTML='<p class="hint" role="status">Ładowanie zadań…</p>'+Array(4).fill('<div class="skeleton" aria-hidden="true"></div>').join('');return;}
 if(state.demo==='error'){list.innerHTML=emptyHTML('Nie udało się pobrać zadań','Spróbuj ponownie za chwilę.','retry','Spróbuj ponownie');return;}
 if(!visible.length){list.innerHTML=emptyHTML(!active.length?'Brak aktywnych zadań':state.mine?'Nie masz zadań dla tego widoku':'Brak zadań dla tych filtrów',!active.length?'Możesz dodać pierwsze zadanie.':state.mine?`W zespole jest ${active.length} aktywnych zadań.`:'Zmień filtry lub wpisane wyszukiwanie.',!active.length?'new':'clear',!active.length?'+ Nowe zadanie':state.mine?'Pokaż zadania zespołu':'Wyczyść filtry');return;}
 list.innerHTML=groups.map(([key,label])=>{
  const rows=visible.filter(t=>groupOf(t)===key).sort((a,b)=>(a.due||'z').localeCompare(b.due||'z')||(['Pilny','Ważny','Normalny'].indexOf(a.priority)-['Pilny','Ważny','Normalny'].indexOf(b.priority))||a.id-b.id);
  if(!rows.length)return '';
  const shown=expanded.has(key)?rows:rows.slice(0,4);
  return `<section class="group" aria-labelledby="group-${key}"><div class="group-header"><h3 id="group-${key}" tabindex="-1">${label} · ${rows.length}</h3>${rows.length>4?`<button class="text-button" data-action="expand" data-group="${key}">${expanded.has(key)?'Zwiń listę':'Pokaż pozostałe '+(rows.length-4)}</button>`:''}</div>${shown.map(rowHTML).join('')}</section>`;
 }).join('');
}
function emptyHTML(title,description,action,label){return `<div class="empty"><span class="round" aria-hidden="true">◎</span><h2>${title}</h2><p>${description}</p><button class="primary" data-action="${action}">${label}</button></div>`;}
function rowHTML(t){
 const a=[...t.areas].sort((a,b)=>areas.indexOf(a)-areas.indexOf(b));
 return `<article class="task task-${t.type}" data-id="${t.id}"><span class="round" aria-hidden="true">${t.type==='phone'?phoneSVG():'✓'}</span><div class="task-main"><button class="task-title" data-action="details" aria-expanded="${openId===t.id}">${escapeHTML(t.title)}</button><div class="metadata">${t.type==='phone'?`<button class="call" data-action="${t.phone?'call':'edit'}">${t.phone?'Zadzwoń · '+escapeHTML(t.phone):'Brak numeru — dodaj'}</button>`:''}${a.length?chip(a[0]):''}${a.length>1?`<button class="chip" data-action="details" aria-label="Pokaż wszystkie obszary">+${a.length-1}</button>`:''}<span class="date ${groupOf(t)==='overdue'?'overdue':''}">${dateLabel(t)}</span>${t.priority!=='Normalny'?`<span class="chip">${escapeHTML(t.priority)}</span>`:''}</div>${t.contact==='lead104'||t.comments.length?`<div class="extra-meta">${t.contact==='lead104'?'<span>Lead · kampania Jesień</span>':''}${t.comments.length?`<button class="text-button" data-action="comments">Komentarze (${t.comments.length})</button>`:''}</div>`:''}</div><div class="actions"><button class="done" data-action="done">Zrobione</button>${t.type==='phone'?'<button class="later" data-action="later">Oddzwonić później ⌄</button>':''}<button class="menu" data-action="menu" aria-label="Opcje zadania: ${escapeHTML(t.title)}">⋮</button></div>${openId===t.id?detailsHTML(t):''}</article>`;
}
function phoneSVG(){return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 3l4-1 3 6-3 2 6 6 2-3 6 3-1 4c-1 3-6 2-11-2S0 6 4 3z"/></svg>';}
function detailsHTML(t){
 return `<div class="details-panel"><div><h3>Szczegóły ${t.type==='phone'?'telefonu':'zadania'}</h3><p class="detail-notes">${escapeHTML(t.description||'Brak opisu.')}</p><p>${t.areas.map(chip).join(' ')}<br>Przypisane: ${t.assigned.map(x=>x==='ola'?'Ola (ja)':'Alicja').join(', ')||'brak'}<br>Priorytet: ${escapeHTML(t.priority)}</p>${t.products?`<p>Produkty: ${escapeHTML(t.products)}</p>`:''}${t.clients.length?`<p>Dodatkowe klientki: ${t.clients.map(c=>escapeHTML(contacts[c]?.name)).join(', ')}</p>`:''}${t.repeat?`<p>Powtarzanie: ${t.repeat==='week'?'co tydzień':'co miesiąc'} (podgląd)</p>`:''}${t.contact==='lead104'?`<p>Lead 104 · kampania Jesień<br>Status w demo: <strong>${escapeHTML(leadStatus)}</strong></p>`:''}<h3>Komentarze</h3>${t.comments.map(c=>`<p><small>${escapeHTML(c.author)} · ${escapeHTML(c.time)}</small><br>${escapeHTML(c.text)}</p>`).join('')||'<p>Brak komentarzy.</p>'}<form class="comment-form" data-id="${t.id}"><input name="comment" required maxlength="1000" placeholder="Dodaj komentarz" aria-label="Nowy komentarz"><button type="submit">Dodaj</button></form>${t.history.length?`<h3 style="margin-top:20px">Historia</h3>${t.history.map(h=>`<p>${escapeHTML(h)}</p>`).join('')}`:''}</div>${t.type==='phone'?`<form class="result-form" data-id="${t.id}"><h3>Wynik rozmowy</h3><fieldset class="results"><legend class="sr-only">Wybierz wynik</legend>${[['booked','Umówiona'],['missed','Nie odebrała'],['declined','Nie zainteresowana']].map(([v,l])=>`<label><input type="radio" name="result" value="${v}" required>${l}</label>`).join('')}</fieldset><label><span class="sr-only">Notatka z rozmowy</span><textarea name="note" rows="3" maxlength="2000" placeholder="Notatka z rozmowy (opcjonalnie)"></textarea></label><div class="later-controls" hidden><label>Kolejny kontakt<select name="next"><option value="tomorrow">Jutro 10:00</option><option value="custom">Wybierz termin</option><option value="keep">Zachowaj obecny termin</option></select></label><input name="custom-date" type="datetime-local" value="2026-10-27T10:00" aria-label="Własny termin kolejnego kontaktu" hidden></div><p class="result-hint hint">Wybierz wynik, aby zobaczyć skutek zapisu.</p><button class="primary" type="submit">Zapisz i zamknij</button></form>`:''}</div>`;
}
function resetFilters(){state={...state,kind:'all',mine:false,area:'all',query:''};$('input[name=kind][value=all]').checked=true;$('#mine').checked=false;$('#area').value='all';$('#search').value='';expanded.clear();render();}
function showSmall(title,html){lastFocus=document.activeElement;$('#small-title').textContent=title;$('#small-body').innerHTML=html;$('#small-dialog').showModal();}
function closeSmall(){ $('#small-dialog').close();if(lastFocus?.isConnected)lastFocus.focus();}
function changeDeadline(t,date){t.due=date;t.history.push('Ola · 26.10.2026, 12:00 · Zmieniono termin na '+dateLabel(t));closeSmall();render();notify('Termin został zmieniony w podglądzie. Zadanie pozostaje aktywne.');}
function finish(t){t.done=true;t.history.push('Ola · 26.10.2026, 12:00 · Zadanie wykonane');openId=null;render();$('#total-title').tabIndex=-1;$('#total-title').focus();notify('Zadanie oznaczone jako zrobione w podglądzie.');}
function editorData(){return JSON.stringify([...new FormData($('#task-form')).entries()]);}
function openEditor(t=null){
 lastFocus=document.activeElement;const f=$('#task-form');f.reset();$('#more').open=false;
 f.elements.id.value=t?.id||'';f.elements.type.value=t?.type||(state.kind==='phone'?'phone':'task');
 for(const key of ['title','contact','phone','priority','description','products','repeat'])f.elements[key].value=t?.[key]??(key==='priority'?'Normalny':'');
 f.elements.date.value=t?.due.slice(0,10)||'';f.elements.time.value=t?.due.slice(11)||'';
 $$('input[name=areas]',f).forEach(x=>x.checked=(t?.areas||(f.elements.type.value==='phone'?['Klient']:['Inne'])).includes(x.value));
 for(const key of ['assigned','clients'])$$(`input[name=${key}]`,f).forEach(x=>x.checked=(t?.[key]||[]).includes(x.value));
 $('#editor-title').textContent=t?'Edytuj zadanie':'Nowe zadanie';$('#phone-fields').hidden=f.elements.type.value!=='phone';
 if(t&&(t.assigned.length||t.description||t.products||t.repeat||t.clients.length))$('#more').open=true;
 editorSnapshot=editorData();$('#editor').showModal();
}
function closeEditor(){if(editorData()!==editorSnapshot&&!confirm('Odrzucić niezapisane zmiany?'))return;$('#editor').close();if(lastFocus?.isConnected)lastFocus.focus();}
function openLater(t){showSmall('Oddzwonić później',`<button data-deadline="2026-10-26T14:00">Dziś za 2 godziny · 14:00</button><button data-deadline="2026-10-27T10:00">Jutro · 10:00</button><form id="deadline-form"><label>Wybierz termin<input name="due" type="datetime-local" required value="2026-10-27T10:00"></label><button type="submit" class="primary">Zapisz termin</button></form>`);$$('[data-deadline]').forEach(b=>b.onclick=()=>changeDeadline(t,b.dataset.deadline));$('#deadline-form').onsubmit=e=>{e.preventDefault();changeDeadline(t,new FormData(e.target).get('due'));};}
function openMenu(t){showSmall('Opcje zadania',`<button data-option="edit">Edytuj zadanie</button>${t.type==='phone'?'<button data-option="result">Zapisz wynik rozmowy</button><button data-option="copy">Kopiuj numer</button>':''}<button data-option="archive">Archiwizuj zadanie</button>`);$$('[data-option]').forEach(b=>b.onclick=async()=>{
  const action=b.dataset.option;closeSmall();
  if(action==='edit')openEditor(t);
  if(action==='result'){openId=t.id;render();$(`[data-id="${t.id}"] .result-form input`)?.focus();}
  if(action==='copy'){if(!t.phone)return notify('Brak numeru — dodaj go w edycji zadania.');try{await navigator.clipboard.writeText(t.phone);notify('Skopiowano przykładowy numer.');}catch{showSmall('Numer do skopiowania',`<label>Zaznacz i skopiuj<input readonly value="${escapeHTML(t.phone)}"></label>`);$('#small-body input').select();}}
  if(action==='archive'&&confirm('Archiwizować zadanie w podglądzie?')){t.archived=true;render();notify('Zadanie zarchiwizowane w podglądzie.');}
 });}
function bind(){
 $('#area-options').innerHTML=areas.map(a=>`<label><input type="checkbox" name="areas" value="${a}">${a}</label>`).join('');
 $$('input[name=kind]').forEach(x=>x.onchange=()=>{state.kind=x.value;render();});
 $('#mine').onchange=e=>{state.mine=e.target.checked;render();};$('#area').onchange=e=>{state.area=e.target.value;render();};$('#search').oninput=e=>{state.query=e.target.value;render();};$('#clear').onclick=resetFilters;
 $('#theme').onclick=()=>{$('body').classList.toggle('dark');$('#theme').textContent=$('body').classList.contains('dark')?'Tryb jasny':'Tryb ciemny';};
 $('#collapse').onclick=()=>{const body=$('#widget-body');body.hidden=!body.hidden;$('#collapse').setAttribute('aria-expanded',!body.hidden);$('#collapse').setAttribute('aria-label',body.hidden?'Rozwiń zadania':'Zwiń zadania');$('#collapse').textContent=body.hidden?'⌄':'⌃';};
 $('#new-task').onclick=()=>openEditor();$('#demo-state').onchange=e=>{state.demo=e.target.value;render();};
 $('#reset').onclick=()=>{if(!confirm('Przywrócić dane przykładowe? Zmiany w podglądzie zostaną usunięte.'))return;init();notify('Przywrócono dane przykładowe.');};
 $('#templates').onclick=()=>showSmall('Szablony cykliczne (1)','<h3>Przegląd materiałów w salonie</h3><p>Co poniedziałek · 10:00 · przypisana Alicja</p><p class="hint">Podgląd istniejącego szablonu. Generowanie zadań i zarządzanie szablonami wymaga podłączenia modułu Estelio.</p>');
 $$('[data-close]').forEach(x=>x.onclick=closeEditor);$('#editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
 $('[data-small-close]').onclick=closeSmall;
 $('#task-form').addEventListener('change',e=>{
  const f=e.currentTarget;
  if(e.target.name==='type')$('#phone-fields').hidden=f.elements.type.value!=='phone';
  if(e.target.name==='contact'&&contacts[e.target.value])f.elements.phone.value=contacts[e.target.value].phone;
 });
 $$('[data-quick]').forEach(b=>b.onclick=()=>{const f=$('#task-form'),q=b.dataset.quick;f.elements.date.value=q==='none'?'':q==='today'?'2026-10-26':q==='tomorrow'?'2026-10-27':'2026-11-02';f.elements.time.value=q==='none'?'':q==='today'?'16:00':q==='week'?(f.elements.time.value||'10:00'):'10:00';});
 $('#task-form').onsubmit=e=>{
  e.preventDefault();const f=e.target, data=new FormData(f),title=data.get('title').trim();
  if(!title){f.elements.title.setCustomValidity('Wpisz tytuł zadania.');f.elements.title.reportValidity();return;}f.elements.title.setCustomValidity('');
  const phone=data.get('phone').trim();if(phone&&!/^[+\d\s()-]{3,30}$/.test(phone)){f.elements.phone.setCustomValidity('Wpisz numer zawierający cyfry, opcjonalnie +, spacje lub nawiasy.');f.elements.phone.reportValidity();return;}f.elements.phone.setCustomValidity('');
  const selected=data.getAll('areas');if(!selected.length){notify('Wybierz co najmniej jeden obszar.');$('input[name=areas]',f).focus();return;}
  let t=tasks.find(x=>x.id===Number(data.get('id')));const fresh=!t;
  if(!t)t={id:nextId++,comments:[],history:[],done:false,archived:false};
  Object.assign(t,{type:data.get('type'),title,phone,contact:data.get('contact'),areas:selected,assigned:data.getAll('assigned'),clients:data.getAll('clients'),priority:data.get('priority'),description:data.get('description'),products:data.get('products'),repeat:data.get('repeat'),due:data.get('date')?data.get('date')+'T'+(data.get('time')||'23:59'):''});
  if(fresh)tasks.push(t);state.demo='normal';$('#demo-state').value='normal';$('#editor').close();resetFilters();render();notify('Zapisano zadanie w podglądzie. Zmiany pozostają do odświeżenia strony.');
 };
 $('#task-form').oninput=e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');};
 $('#list').onclick=e=>{
  const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,t=tasks.find(t=>t.id===Number(b.closest('[data-id]')?.dataset.id));
  if(action==='new')return openEditor();if(action==='clear')return resetFilters();if(action==='retry'){state.demo='normal';$('#demo-state').value='normal';return render();}
  if(action==='expand'){expanded.has(b.dataset.group)?expanded.delete(b.dataset.group):expanded.add(b.dataset.group);render();return;}
  if(!t)return;
  if(action==='details'||action==='comments'){openId=action==='comments'?t.id:openId===t.id?null:t.id;render();const target=action==='comments'?'.comment-form input':'.task-title';$(`[data-id="${t.id}"] ${target}`)?.focus();}
  if(action==='edit')openEditor(t);if(action==='done')finish(t);if(action==='later')openLater(t);if(action==='menu')openMenu(t);
  if(action==='call')notify('Podgląd: numer jest fikcyjny. W Estelio ten przycisk uruchomi połączenie tel:.');
 };
 $('#list').onchange=e=>{
  const f=e.target.closest('.result-form');if(!f)return;const result=new FormData(f).get('result'),t=tasks.find(t=>t.id===Number(f.dataset.id));
  $('.later-controls',f).hidden=result!=='missed';$('input[name="custom-date"]',f).hidden=$('select[name=next]',f).value!=='custom';
  const canChange=['nowy','kontakt'].includes(leadStatus);
  $('.result-hint',f).textContent=result==='missed'?'Zadanie pozostanie aktywne. Status leada nie zmieni się.':`Zadanie zostanie zakończone.${t.contact==='lead104'?(canChange?' Status leada: '+(result==='booked'?'umówiony.':'odrzucony.'):' Obecny status leada pozostanie bez zmian.'):''}${result==='booked'?' To nie utworzy wizyty w terminarzu.':''}`;
 };
 $('#list').onsubmit=e=>{
  e.preventDefault();const f=e.target,data=new FormData(f),t=tasks.find(t=>t.id===Number(f.dataset.id));if(!t)return;
  if(f.classList.contains('comment-form')){const value=data.get('comment').trim();if(!value)return;t.comments.push({author:'Ola',text:value,time:'26.10.2026, 12:00'});render();$(`[data-id="${t.id}"] .comment-form input`)?.focus();notify('Dodano komentarz.');return;}
  if(!f.classList.contains('result-form'))return;const result=data.get('result');if(!result)return;
  if(result==='missed'&&data.get('next')==='custom'&&!data.get('custom-date')){notify('Wybierz termin kolejnego kontaktu.');return;}
  const names={booked:'Umówiona',missed:'Nie odebrała',declined:'Nie zainteresowana'};
  t.history.push('Ola · 26.10.2026, 12:00 · '+names[result]+(data.get('note').trim()?' — '+data.get('note').trim():''));
  if(result==='missed'){if(data.get('next')==='tomorrow')t.due='2026-10-27T10:00';if(data.get('next')==='custom')t.due=data.get('custom-date');}
  else{t.done=true;if(t.contact==='lead104'&&['nowy','kontakt'].includes(leadStatus))leadStatus=result==='booked'?'umówiony':'odrzucony';}
  openId=null;render();notify(result==='missed'?'Zapisano próbę kontaktu. Zadanie pozostaje aktywne.':'Zapisano wynik i zakończono zadanie w podglądzie.');
 };
}
function init(){tasks=seed();nextId=Math.max(...tasks.map(t=>t.id))+1;openId=null;expanded.clear();leadStatus='nowy';state.demo='normal';$('#demo-state').value='normal';resetFilters();}
bind();init();
