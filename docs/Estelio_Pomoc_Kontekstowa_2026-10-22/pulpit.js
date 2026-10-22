// Dymek pomocy na Pulpicie po usunięciu dwóch punktów listy: co dokładnie widzi
// użytkownik, czy lista zniknęła i czy karta nie została z puszczonym marginesem.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9536','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-pl-' + Date.now(),'about:blank'], { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:9536/json'); } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception || {}).description || '').split('\n')[0]); };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); return r.result && r.result.result ? r.result.result.value : null; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: B + '/index.html' }); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module','konsultacje']));`);
  await send('Page.reload', { ignoreCache: true }); await sleep(8000);

  await ev(`pokaz('pulpit', null)`); await sleep(1200);
  const jest = await ev(`!!document.querySelector('#pulpit .pk-slot[data-pomoc="pulpit"] .pk-btn')`);
  console.log('przycisk „?" na Pulpicie:', jest ? 'jest' : 'BRAK');
  if (!jest) { console.log('BLEDY JS:', errs.slice(0,3)); process.exit(1); }
  await ev(`document.querySelector('#pulpit .pk-slot[data-pomoc="pulpit"] .pk-btn').click()`); await sleep(500);

  const w = JSON.parse(await ev(`(function(){const k=document.querySelector('.pk-karta'); if(!k) return JSON.stringify({brak:true});
    const r=k.getBoundingClientRect(), W=document.documentElement.clientWidth, H=document.documentElement.clientHeight;
    const q=s=>k.querySelector(s);
    return JSON.stringify({
      eyebrow:(q('.pk-etykieta')||{}).textContent||'', tytul:(q('.pk-tytul')||{}).textContent||'',
      body:(q('.pk-opis')||{}).textContent||'',
      punkty:[].map.call(k.querySelectorAll('.pk-lista li'), function(e){return e.textContent.trim();}),
      listaWDom: !!q('.pk-lista'),
      tip:(q('.pk-wskazowka')||q('.pk-tip')||{}).textContent||null,
      link:(q('.pk-link')||q('a')||{}).textContent||null,
      wysokosc:Math.round(r.height), szerokosc:Math.round(r.width),
      poza: Math.max(0,Math.round(r.right-W))+Math.max(0,Math.round(-r.left))+Math.max(0,Math.round(r.bottom-H))+Math.max(0,Math.round(-r.top)),
      pustyOdstep: (function(){ const b=q('.pk-opis'); const nast=b&&b.nextElementSibling;
        return b ? { poBody: nast?nast.className:'(nic)', marginBottomBody: getComputedStyle(b).marginBottom } : null; })()
    });})()`) || '{}');
  if (w.brak) { console.log('chmurka sie nie otworzyla'); process.exit(1); }
  console.log('--- CO WIDZI UZYTKOWNIK ---');
  console.log('nadtytul :', w.eyebrow);
  console.log('tytul    :', w.tytul);
  console.log('tresc    :', w.body);
  console.log('punkty   :', w.punkty.length ? w.punkty : '(brak — tego chcielismy)');
  console.log('lista w DOM:', w.listaWDom ? 'JEST (zle)' : 'nie ma');
  console.log('wskazowka:', w.tip || '(brak)');
  console.log('link     :', w.link || '(brak)');
  console.log('karta    :', w.szerokosc + '×' + w.wysokosc + ' px, poza ekranem: ' + (w.poza ? w.poza + 'px' : 'nie'));
  console.log('po tresci:', JSON.stringify(w.pustyOdstep));

  const sh = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '/pomoc-08-pulpit-po-skroceniu.png', Buffer.from(sh.result.data, 'base64'));
  console.log('zrzut pomoc-08-pulpit-po-skroceniu.png');
  console.log('BLEDY JS:', errs.length ? errs.slice(0, 4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e => { console.error('BLAD:', e.message); process.exit(1); });
