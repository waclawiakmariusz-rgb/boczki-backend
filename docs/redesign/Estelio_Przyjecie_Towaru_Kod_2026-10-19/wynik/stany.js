// Stany wizualne ekranu „Przyjęcie towaru” po redesignie — zrzuty + pomiary, nie wrażenia.
// Viewporty: 1663×946 (jak makieta), 390×844 (telefon), 800×550 (niski), 400×275@2 (= 800×550 przy zoomie 200%).
// Stany: pusty, referencyjny (6 × 98,40), po „+” (7 × 98,40), tryb ciemny, w trakcie zapisu (fetch wstrzymany),
// pytanie przy Anuluj (confirm przechwycony). Pomiar: nic nie wychodzi poza kontener, brak poziomego przewijania.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2] || '.';
const PROFIL = os.tmpdir() + '/est-st-' + Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9543','--window-size=1663,946','--lang=pl-PL','--user-data-dir=' + PROFIL,'about:blank'], { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:9543/json'); } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception || {}).description || '').split('\n')[0]); };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); if (r.result && r.result.exceptionDetails) throw new Error('EVAL: ' + (r.result.exceptionDetails.exception || {}).description); return r.result && r.result.result ? r.result.result.value : null; };
  const zrzut = async nazwa => { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + nazwa, Buffer.from(sh.result.data, 'base64')); };
  const viewport = (w, h, dsf = 1) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: w < 500 });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: B + '/index.html' }); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module','konsultacje']));`);
  await send('Page.reload', { ignoreCache: true }); await sleep(8000);
  await ev(`(function(){ window.__st = { alerty: [], confirmy: [], posty: [] }; window.alert = m => window.__st.alerty.push(String(m)); window.confirm = m => { window.__st.confirmy.push(String(m)); return false; };
    const f = window.fetch; window.__fetchDelay = 0;
    window.fetch = function(url, opt) { try { if (opt && opt.method === 'POST' && opt.body) { const b = JSON.parse(opt.body); if (b.action === 'add') { window.__st.posty.push(b); return new Promise(res => setTimeout(() => res(new Response(JSON.stringify({status:'success'}), {status:200, headers:{'Content-Type':'application/json'}})), window.__fetchDelay)); } } } catch(e){} return f.apply(this, arguments); }; })()`);
  await ev(`pokaz('nowy', document.querySelector("button[onclick*=\\"'nowy'\\"]"))`); await sleep(2000);

  const POMIAR = `(function(){ const mc=document.querySelector('.main-content'); const sek=document.getElementById('nowy'); const W=sek.getBoundingClientRect().width;
    const el=[...sek.querySelectorAll('.egr-card, .egr-field input, .egr-field select, .egr-form-footer button, .egr-stepper, h1')];
    const poza=el.filter(e=>{ const r=e.getBoundingClientRect(); return r.width>0 && (r.right - sek.getBoundingClientRect().left > W + 1 || r.left < sek.getBoundingClientRect().left - 1); }).map(e=>(e.id||e.className||e.tagName)+':'+Math.round(e.getBoundingClientRect().right));
    const form=sek.querySelector('.egr-form').getBoundingClientRect(), sum=sek.querySelector('.egr-summary').getBoundingClientRect();
    return JSON.stringify({ kontener: Math.round(W), form: Math.round(form.width)+'x'+Math.round(form.height), podsumowanie: Math.round(sum.width)+'x'+Math.round(sum.height), gornaKrawedzRowna: Math.abs(form.top-sum.top)<1, obok: sum.left > form.right, poziomyScroll: mc.scrollWidth > mc.clientWidth + 1, poza,
      suma: sek.querySelector('[data-podsumowanie="suma"]').textContent, dzialanie: sek.querySelector('[data-podsumowanie="dzialanie"]').textContent, submit: sek.querySelector('button[type="submit"]').textContent.trim(), submitDisabled: sek.querySelector('button[type="submit"]').disabled, minusDisabled: sek.querySelector('[data-krok="-1"]').disabled,
      h1: getComputedStyle(sek.querySelector('h1')).fontSize, poleWys: Math.round(document.getElementById('n_netto').getBoundingClientRect().height), tloSekcji: getComputedStyle(sek).backgroundColor, font: getComputedStyle(sek).fontFamily.split(',')[0] }); })()`;
  const wiersz = (opis, p) => console.log(opis.padEnd(34) + ' kontener ' + String(p.kontener).padStart(4) + ' | form ' + p.form.padEnd(9) + ' | podsum ' + p.podsumowanie.padEnd(8) + ' | obok:' + (p.obok?'tak':'nie') + ' równe:' + (p.gornaKrawedzRowna?'tak':'nie') + ' | poza:' + (p.poza.length? 'TAK '+p.poza.join(','):'nie') + ' | scrollX:' + (p.poziomyScroll?'TAK':'nie') + ' | suma: ' + p.suma + ' | h1 ' + p.h1 + ' pole ' + p.poleWys + 'px');

  const ustawRef = async () => { await ev(`(function(){ const f=document.getElementById('n_firma'); f.selectedIndex=1; f.dispatchEvent(new Event('change')); const m=document.getElementById('n_model'); m.selectedIndex=1; m.dispatchEvent(new Event('change'));
    const s=(id,v)=>{ const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); }; s('n_ilosc','6'); s('n_netto','80.00'); s('n_brutto','98.40'); s('n_waznosc','2027-12-31'); })()`); await sleep(300); };
  const wyczysc = async () => { await ev(`(function(){ const f=document.getElementById('nowy').querySelector('form'); f.reset(); document.getElementById('n_model').innerHTML='<option value=\"\">--</option>'; document.getElementById('n_model').disabled=true; generujNazwe(); })()`); await sleep(300); };

  // 1. Desktop referencyjny
  await viewport(1663, 946);
  let p = JSON.parse(await ev(POMIAR)); wiersz('1663x946 pusty', p); console.log('   tło sekcji:', p.tloSekcji, '| czcionka:', p.font, '| minus wyłączony:', p.minusDisabled, '| działanie:', p.dzialanie);
  await zrzut('stan-01-desktop-pusty.png');
  await ustawRef(); p = JSON.parse(await ev(POMIAR)); wiersz('1663x946 referencyjny 6x98,40', p); console.log('   podsumowanie:', await ev(`document.querySelector('#nowy .egr-summary').innerText.replace(/\\s+/g,' ').trim()`));
  await zrzut('stan-02-desktop-referencyjny.png');
  await ev(`document.querySelector('#nowy [data-krok="1"]').click()`); await sleep(200);
  p = JSON.parse(await ev(POMIAR)); wiersz('1663x946 po „+” (7 szt.)', p); console.log('   ilość w polu:', await ev(`document.getElementById('n_ilosc').value`), '| POST-ów po klikaniu +:', await ev(`window.__st.posty.length`));
  await ev(`document.querySelector('#nowy [data-krok="-1"]').click()`); await sleep(100);
  console.log('   po „−”: ilość', await ev(`document.getElementById('n_ilosc').value`), 'suma', await ev(`document.querySelector('[data-podsumowanie="suma"]').textContent`));
  await ev(`(function(){ const e=document.getElementById('n_brutto'); e.value=''; e.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(100);
  console.log('   pusta cena brutto → suma:', await ev(`document.querySelector('[data-podsumowanie="suma"]').textContent`), '| brutto za szt.:', await ev(`document.querySelector('[data-podsumowanie="brutto"]').textContent`));
  await ev(`(function(){ const e=document.getElementById('n_brutto'); e.value='98.40'; e.dispatchEvent(new Event('input',{bubbles:true})); })()`); await sleep(100);

  // 2. W trakcie zapisu — fetch wstrzymany 1500 ms, zrzut w połowie
  await ev(`window.__fetchDelay = 1500; window.__st.posty = [];`);
  await ev(`document.querySelector('#nowy button[type="submit"]').click()`); await sleep(400);
  p = JSON.parse(await ev(POMIAR)); console.log('w trakcie zapisu:'.padEnd(34), 'przycisk „' + p.submit + '” disabled:', p.submitDisabled, '| szerokość przycisku:', await ev(`Math.round(document.querySelector('#nowy button[type="submit"]').getBoundingClientRect().width)`), 'px');
  await zrzut('stan-03-desktop-w-trakcie-zapisu.png'); await sleep(1600);
  p = JSON.parse(await ev(POMIAR)); console.log('po zapisie:'.padEnd(34), 'przycisk „' + p.submit + '” disabled:', p.submitDisabled, '| alert:', JSON.stringify(await ev(`window.__st.alerty`)), '| POST-ów:', await ev(`window.__st.posty.length`), '| suma po resecie:', p.suma);
  await ev(`window.__fetchDelay = 0;`);

  // 3. Anuluj: pusty → bez pytania; wypełniony → pytanie (confirm zwraca false → zostajemy)
  await ev(`pokaz('nowy', document.querySelector("button[onclick*=\\"'nowy'\\"]")); window.__st.confirmy=[];`); await sleep(1200); await wyczysc();
  await ev(`document.querySelector('#nowy [data-anuluj]').click()`); await sleep(400);
  console.log('Anuluj przy pustym:'.padEnd(34), 'pytań:', await ev(`window.__st.confirmy.length`), '| aktywna sekcja:', await ev(`(document.querySelector('.section.active')||{}).id`));
  await ev(`pokaz('nowy', document.querySelector("button[onclick*=\\"'nowy'\\"]")); window.__st.confirmy=[];`); await sleep(1200); await ustawRef();
  await ev(`document.querySelector('#nowy [data-anuluj]').click()`); await sleep(400);
  console.log('Anuluj przy wypełnionym:'.padEnd(34), 'pytanie:', JSON.stringify(await ev(`window.__st.confirmy[0]||null`)), '| aktywna:', await ev(`(document.querySelector('.section.active')||{}).id`), '| ilość nadal:', await ev(`document.getElementById('n_ilosc').value`));

  // 4. Tryb ciemny
  await ev(`document.body.classList.add('dark-mode')`); await sleep(500);
  p = JSON.parse(await ev(POMIAR)); wiersz('1663x946 tryb ciemny', p);
  console.log('   karta:', await ev(`getComputedStyle(document.querySelector('#nowy .egr-form')).backgroundColor`), '| pole:', await ev(`getComputedStyle(document.getElementById('n_netto')).backgroundColor`), '| tekst h1:', await ev(`getComputedStyle(document.querySelector('#nowy h1')).color`));
  await zrzut('stan-04-desktop-ciemny.png');
  await ev(`document.body.classList.remove('dark-mode')`); await sleep(300);

  // 5. Telefon 390×844
  await viewport(390, 844); await sleep(600);
  p = JSON.parse(await ev(POMIAR)); wiersz('390x844 referencyjny', p);
  await zrzut('stan-05-telefon-390.png');
  await ev(`document.querySelector('.main-content').scrollTo({top: 99999, behavior: 'auto'})`); await sleep(300);
  await zrzut('stan-06-telefon-390-dol.png');
  console.log('   stopka na telefonie: submit szer.', await ev(`Math.round(document.querySelector('#nowy button[type="submit"]').getBoundingClientRect().width)`), 'px, kontener', p.kontener, 'px');

  // 6. Niski ekran 800×550
  await viewport(800, 550); await sleep(600); await ev(`document.querySelector('.main-content').scrollTo({top: 0, behavior: 'auto'})`);
  p = JSON.parse(await ev(POMIAR)); wiersz('800x550 referencyjny', p);
  await zrzut('stan-07-niski-800x550.png');

  // 7. Zoom 200% przy 800×550 = 400×275 CSS px
  await viewport(400, 275, 2); await sleep(600);
  p = JSON.parse(await ev(POMIAR)); wiersz('800x550 @200% (400x275 css)', p);
  await zrzut('stan-08-zoom200.png');

  console.log('BLEDY JS:', errs.length ? errs.slice(0, 5) : 'brak');
  ws.close(); ch.kill(); await sleep(800);
  // Profil headless potrafi ważyć >100 MB — 102 takie katalogi zapchały dziś dysk. Sprzątamy po sobie.
  try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('BLAD:', e.message); try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
