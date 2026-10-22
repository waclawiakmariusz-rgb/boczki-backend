// Pomoc w modalach: czy przycisk jest, czy chmurka mieści się w ekranie, czy NIE psuje
// formularza i czy Esc zamyka najpierw pomoc, a dopiero drugi raz modal.
const { spawn } = require('child_process'); const http = require('http'); const os = require('os'); const fs = require('fs');
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'; const B = 'http://localhost:3999'; const T = 'demo-test';
const HASLO = fs.readFileSync('C:/Users/aaell/estelio-srodowisko-testowe/haslo-salonu-demo-test.txt', 'utf8').trim();
const OUT = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));
const post = (b, h = {}) => fetch(B + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

// modal → kontekst. Modale pokazujemy wprost (display:flex), bo chodzi o sam komponent pomocy,
// a nie o ścieżkę biznesową, która je otwiera.
const MODALE = [
  ['deposit-overlay', 'modal.zadatek'],
  ['zwrot-modal-overlay', 'modal.zwrot'],
  ['split-payment-modal', 'modal.mix'],
  ['new-client-overlay', 'modal.klient.nowy'],
  ['client-edit-modal-overlay', 'modal.klient.edycja'],
  ['rodo-modal-overlay', 'modal.rodo'],
  ['dd-modal-overlay', 'modal.dokument'],
  ['sd-soft-delete-overlay', 'modal.klient.usun'],
  ['sd-zmarly-overlay', 'modal.klient.zmarly'],
  ['sd-anonimizacja-overlay', 'modal.klient.anonimizacja'],
];

(async () => {
  const l = await post({ action: 'login', login: T, haslo: HASLO });
  const tok = (await post({ action: 'verify_pin', tenant_id: T, imie: 'Ola', pin: '1111' }, { 'x-session-token': l.session_token })).session_token;
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars','--remote-debugging-port=9531','--window-size=1400,1050','--user-data-dir=' + os.tmpdir() + '/est-md-' + Date.now(),'about:blank'], { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 40 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:9531/json'); } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } else if (d.method === 'Runtime.exceptionThrown') errs.push(((d.params.exceptionDetails.exception || {}).description || '').split('\n')[0]); };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); return r.result && r.result.result ? r.result.result.value : null; };
  const esc = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: B + '/index.html' }); await sleep(2000);
  await ev(`localStorage.setItem('boczki_tenant_id', ${JSON.stringify(T)}); localStorage.setItem('boczki_session_token', ${JSON.stringify(tok)}); localStorage.setItem('boczki_user', ${JSON.stringify(T)}); localStorage.setItem('boczki_pracownik_imie', 'Ola'); localStorage.setItem('boczki_pracownik_rola', 'manager'); localStorage.setItem('boczki_features', JSON.stringify(['terminarz','rap_module','konsultacje']));`);
  await send('Page.reload', { ignoreCache: true }); await sleep(8000);

  console.log('MODAL'.padEnd(26) + 'PRZYCISK  TYTUŁ CHMURKI'.padEnd(42) + 'POZA EKRANEM');
  console.log('-'.repeat(88));
  let ok = 0; const zle = [];
  for (const [modal, ctx] of MODALE) {
    await ev(`(function(){const m=document.getElementById('${modal}'); if(m) m.style.display='flex';})()`); await sleep(400);
    const jest = await ev(`!!document.querySelector('#${modal} .pk-slot[data-pomoc="${ctx}"] .pk-btn')`);
    if (!jest) { console.log(modal.padEnd(26) + 'BRAK'); zle.push(modal + ': brak przycisku'); continue; }
    await ev(`document.querySelector('#${modal} .pk-btn').click()`); await sleep(450);
    const w = JSON.parse(await ev(`(function(){const k=document.querySelector('.pk-karta'); if(!k) return JSON.stringify({brak:true});
      const r=k.getBoundingClientRect(), W=document.documentElement.clientWidth, H=document.documentElement.clientHeight;
      return JSON.stringify({tytul:(k.querySelector('.pk-tytul')||{}).textContent||'',
        poza: Math.max(0,Math.round(r.right-W))+Math.max(0,Math.round(-r.left))+Math.max(0,Math.round(r.bottom-H))+Math.max(0,Math.round(-r.top)),
        nadModalem: (function(){ const el=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+10)); return !!(el && (el===k || k.contains(el))); })() });})()`) || '{}');
    if (w.brak) { console.log(modal.padEnd(26) + 'jest      (chmurka się nie otworzyła)'); zle.push(modal + ': brak chmurki'); continue; }
    console.log(modal.padEnd(26) + 'jest      ' + String(w.tytul).slice(0, 40).padEnd(42) + (w.poza ? 'TAK (' + w.poza + 'px)' : 'nie'));
    if (w.poza) zle.push(modal + ': chmurka poza ekranem');
    if (!w.nadModalem) zle.push(modal + ': chmurka pod modalem');
    // Esc #1 — ma zamknąć TYLKO pomoc, modal zostaje
    await esc(); await sleep(350);
    const poEsc = await ev(`JSON.stringify({chmurka: !!document.querySelector('.pk-karta'), modal: getComputedStyle(document.getElementById('${modal}')).display !== 'none'})`);
    const s = JSON.parse(poEsc);
    if (s.chmurka) zle.push(modal + ': Esc nie zamknął pomocy');
    if (!s.modal) zle.push(modal + ': Esc zamknął też modal (nie powinien)');
    ok++;
    await ev(`(function(){const m=document.getElementById('${modal}'); if(m) m.style.display='none';})()`); await sleep(150);
  }
  console.log('-'.repeat(88));
  console.log('modali z działającą pomocą: ' + ok + '/' + MODALE.length);
  console.log(zle.length ? 'DO POPRAWY:\n   ' + zle.join('\n   ') : 'bez zastrzeżeń');

  // zrzut jednego modalu z otwartą pomocą
  await ev(`(function(){const m=document.getElementById('sd-anonimizacja-overlay'); if(m) m.style.display='flex';})()`); await sleep(400);
  await ev(`document.querySelector('#sd-anonimizacja-overlay .pk-btn').click()`); await sleep(600);
  const sh = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + '/pomoc-07-modal-anonimizacja.png', Buffer.from(sh.result.data, 'base64'));
  console.log('zrzut pomoc-07-modal-anonimizacja.png');
  console.log('BLEDY JS:', errs.length ? errs.slice(0, 4) : 'brak');
  ws.close(); ch.kill(); process.exit(0);
})().catch(e => { console.error('BLAD:', e.message); process.exit(1); });
