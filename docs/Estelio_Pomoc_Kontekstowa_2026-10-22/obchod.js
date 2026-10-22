// Obchód wszystkich podpiętych ekranów: czy przycisk istnieje, czy chmurka ma treść,
// czy nie wychodzi poza ekran i czy nie sypie błędami. Jeden przebieg = jeden raport.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s=''; r.on('data',d=>s+=d); r.on('end',()=>{ try { res(JSON.parse(s)); } catch(e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

// sekcja aplikacji → kontekst pomocy, który ma się w niej pojawić
const EKRANY = [
  ['pulpit', 'pulpit'],
  ['magazyn', 'magazyn.stan'],
  ['inwentaryzacja', 'magazyn.inwentaryzacja'],
  ['nowy', 'magazyn.przyjecie'],
  ['co-zamowic', 'magazyn.co-zamowic'],
  ['rap_add', 'magazyn.pro.produkt.nowy'],
  ['slownik', 'kosmetyki.slownik'],
  ['sprzedaz', 'sprzedaz.rejestracja'],
  ['dzisiejsza-sprzedaz', 'sprzedaz.dzisiejsza'],
  ['historia', 'sprzedaz.historia'],
  ['zadatki-lista', 'sprzedaz.zadatki'],
  ['podsumowanie', 'sprzedaz.podsumowanie'],
  ['klient-profil', 'klient.profil.podsumowanie'],
  ['urodziny', 'klienci.urodziny'],
  ['ranking-klientow', 'klienci.ranking'],
  ['leady', 'klienci.leady'],
  ['retencja', 'retencja'],
  ['tickety', 'zgloszenia'],
  ['logi', 'dziennik'],
];

(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;

  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9523','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-ob-' + Date.now(),'about:blank'], { stdio:'ignore' });
  let t=null; for (let i=0;i<40&&!t;i++){ await sleep(250); try { t=await getJson('http://127.0.0.1:9523/json'); } catch(e){} }
  const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl); await new Promise((a,b)=>{ws.onopen=a;ws.onerror=b;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=m=>{const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d);pend.delete(d.id);} else if(d.method==='Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception||{}).description||'').split('\n')[0]);};
  const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async e=>{const r=await send('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:e}); return r.result&&r.result.result?r.result.result.value:null;};
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate',{url:B+'/index.html'}); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module'])); localStorage.removeItem('boczki_theme');`);
  await send('Page.reload',{ignoreCache:true}); await sleep(8000);

  console.log('EKRAN'.padEnd(22) + 'PRZYCISK  TYTUŁ CHMURKI'.padEnd(42) + 'SŁÓW  POZA EKRANEM');
  console.log('-'.repeat(92));
  let ok = 0, zle = [];
  for (const [sekcja, ctx] of EKRANY) {
    await ev(`pokaz('${sekcja}', null)`); await sleep(900);
    if (sekcja === 'klient-profil') { await ev(`typeof otworzProfil === 'function' ? otworzProfil('1002') : null`); await sleep(2500); }
    const jest = await ev(`!!document.querySelector('#${sekcja} .pk-slot[data-pomoc="${ctx}"] .pk-btn')`);
    if (!jest) { console.log(sekcja.padEnd(22) + 'BRAK'); zle.push(sekcja + ': brak przycisku'); continue; }
    await ev(`document.querySelector('#${sekcja} .pk-slot[data-pomoc="${ctx}"] .pk-btn').click()`); await sleep(500);
    const w = JSON.parse(await ev(`(function(){const k=document.querySelector('.pk-karta'); if(!k) return JSON.stringify({brak:true});
      const r=k.getBoundingClientRect(), W=document.documentElement.clientWidth, H=document.documentElement.clientHeight;
      const tekst=(k.querySelector('.pk-opis')||{}).textContent||'';
      const lista=[...k.querySelectorAll('.pk-lista li')].map(x=>x.textContent).join(' ');
      const tip=(k.querySelector('.pk-wskazowka')||{}).textContent||'';
      return JSON.stringify({ tytul:(k.querySelector('.pk-tytul')||{}).textContent||'',
        slow:(tekst+' '+lista+' '+tip).trim().split(/\\s+/).filter(Boolean).length,
        poza: Math.max(0, Math.round(r.right-W)) + Math.max(0, Math.round(-r.left)) + Math.max(0, Math.round(r.bottom-H)) + Math.max(0, Math.round(-r.top)),
        link:(k.querySelector('.pk-link')||{}).getAttribute?.('href')||'' });})()`) || '{}');
    if (w.brak) { console.log(sekcja.padEnd(22) + 'jest      (chmurka się nie otworzyła)'); zle.push(sekcja + ': brak chmurki'); continue; }
    const ogolny = /ogólnie/i.test(w.tytul);
    console.log(sekcja.padEnd(22) + 'jest      ' + String(w.tytul).slice(0, 40).padEnd(42) + String(w.slow).padEnd(6) + (w.poza ? 'TAK (' + w.poza + 'px)' : 'nie'));
    if (w.poza) zle.push(sekcja + ': chmurka poza ekranem');
    if (w.slow > 80) zle.push(sekcja + ': ' + w.slow + ' słów');
    if (ogolny) zle.push(sekcja + ': pomoc nadrzędna, nie własna');
    ok++;
    await ev(`POMOC.zamknij()`); await sleep(200);
  }
  console.log('-'.repeat(92));
  console.log('ekranów z działającą pomocą: ' + ok + '/' + EKRANY.length);
  console.log(zle.length ? 'DO POPRAWY:\n   ' + zle.join('\n   ') : 'bez zastrzeżeń');
  console.log('BLEDY JS:', errs.length ? errs.slice(0, 4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{console.error('BLAD:',e.message);process.exit(1);});
