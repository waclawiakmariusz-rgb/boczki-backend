#!/usr/bin/env node
// Zrzut dowolnej strony (bez logowania do aplikacji) przez Chrome headless + CDP.
// Do stron publicznych: blog, pomoc, zamów, regulamin. Do ekranów aplikacji używaj narzedzia/proba-ekranu.js.
//
//   node narzedzia/zrzut-strony.js <url> <plik-wyjsciowy.png|jpg> [--viewport 1280x900] [--pelna] [--czekaj 1200] [--jakosc 82]
//
//   --pelna     zrzut całej strony (wysokość dokumentu), nie tylko okna
//   --jakosc    dla .jpg (domyślnie 82); .png bez kompresji stratnej
//   --skala     deviceScaleFactor (domyślnie 1; 2 = ostrzejsze, większy plik)
//   --js "..."  wykonaj wyrażenie JS przed zrzutem (np. kliknięcie filtra)
//
// Zapis wyłącznie do pliku lokalnego; żadnych zapisów na serwerze — to tylko GET strony.
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const poz = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--pelna'].includes(argv[i - 1])));
const opcja = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flaga = n => argv.includes('--' + n);
const [URL_STRONY, PLIK] = poz;
if (!URL_STRONY || !PLIK) { console.error('Użycie: node narzedzia/zrzut-strony.js <url> <plik.png|jpg> [--viewport 1280x900] [--pelna] [--czekaj ms] [--jakosc 82] [--skala 1] [--js "..."]'); process.exit(2); }
const [W, H] = opcja('viewport', '1280x900').split('x').map(Number);
const SKALA = Number(opcja('skala', '1')) || 1;
const CZEKAJ = Number(opcja('czekaj', '1200')) || 1200;
const JAKOSC = Number(opcja('jakosc', '82')) || 82;
const FORMAT = /\.jpe?g$/i.test(PLIK) ? 'jpeg' : 'png';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const PROFIL = path.join(os.tmpdir(), 'est-zrzut-' + Date.now());
const PORT = 9950 + Math.floor(Math.random() * 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = u => new Promise((res, rej) => http.get(u, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--lang=pl-PL', '--remote-debugging-port=' + PORT, '--window-size=' + W + ',' + H, '--user-data-dir=' + PROFIL, 'about:blank'], { stdio: 'ignore' });
  let t = null; for (let i = 0; i < 60 && !t; i++) { await sleep(250); try { t = await getJson('http://127.0.0.1:' + PORT + '/json'); } catch (e) {} }
  if (!t) throw new Error('Chrome nie wystartował (' + CHROME + ')');
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: e }); return r.result && r.result.result ? r.result.result.value : null; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SKALA, mobile: W < 500 });
  await send('Page.navigate', { url: URL_STRONY });
  await sleep(CZEKAJ);
  if (opcja('js')) { await ev(opcja('js')); await sleep(400); }
  let clip;
  if (flaga('pelna')) {
    const h = await ev('Math.ceil(Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: SKALA, mobile: W < 500 });
    await sleep(300);
    clip = { x: 0, y: 0, width: W, height: h, scale: 1 };
  }
  const sh = await send('Page.captureScreenshot', { format: FORMAT, ...(FORMAT === 'jpeg' ? { quality: JAKOSC } : {}), ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  fs.mkdirSync(path.dirname(path.resolve(PLIK)), { recursive: true });
  fs.writeFileSync(PLIK, Buffer.from(sh.result.data, 'base64'));
  const kb = Math.round(fs.statSync(PLIK).size / 1024);
  console.log(`zapisano ${PLIK} (${kb} KB, ${W}x${clip ? clip.height : H}${SKALA !== 1 ? ' @' + SKALA + 'x' : ''})`);
  ws.close(); ch.kill();
  await sleep(200);
  try { fs.rmSync(PROFIL, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('BŁĄD: ' + e.message); process.exit(1); });
