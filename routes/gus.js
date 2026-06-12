// routes/gus.js
// Pobieranie danych firmy po NIP — autouzupełnianie formularza zamówienia.
//
// Źródło: API Wykazu podatników VAT (biała lista) Ministerstwa Finansów —
// REST, bez klucza API. Obejmuje podmioty zarejestrowane do VAT (czynne
// i zwolnione po VAT-R). Firmy bez rejestracji VAT mogą nie zostać
// znalezione — wtedy klient wypełnia formularz ręcznie (graceful degradation).
//
// Architektura pod rozbudowę: pobierzDaneFirmy() to pojedynczy provider.
// Gdy będzie klucz GUS BIR1 (env GUS_API_KEY), dokłada się drugi provider
// (pełne pokrycie REGON) i fallback — bez zmian w endpointcie i frontendzie.

const express = require('express');
const https = require('https');
const { makePublicLimiter } = require('./sessions');

// Walidacja NIP: 10 cyfr + suma kontrolna
function walidujNip(nip) {
  if (!/^\d{10}$/.test(nip)) return false;
  const wagi = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const suma = wagi.reduce((acc, w, i) => acc + w * Number(nip[i]), 0);
  const kontrolna = suma % 11;
  return kontrolna !== 10 && kontrolna === Number(nip[9]);
}

// "UL. KWIATOWA 12/3, 00-001 WARSZAWA" -> { ulica, kod_pocztowy, miasto }
function parsujAdres(adres) {
  if (!adres) return { ulica: '', kod_pocztowy: '', miasto: '' };
  const przecinek = adres.lastIndexOf(',');
  const ulica = przecinek > -1 ? adres.slice(0, przecinek).trim() : adres.trim();
  const reszta = przecinek > -1 ? adres.slice(przecinek + 1).trim() : '';
  const m = reszta.match(/^(\d{2}-\d{3})\s+(.+)$/);
  return {
    ulica,
    kod_pocztowy: m ? m[1] : '',
    miasto: m ? m[2].trim() : reszta,
  };
}

// Provider: biała lista MF. Zwraca { nazwa, adres } albo null gdy nie znaleziono.
function pobierzDaneFirmy(nip) {
  const dzis = new Date().toISOString().slice(0, 10);
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'wl-api.mf.gov.pl',
        path: `/api/search/nip/${nip}?date=${dzis}`,
        headers: { 'Accept': 'application/json' },
        timeout: 8000,
      },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(`MF API HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            const json = JSON.parse(data);
            const s = json.result && json.result.subject;
            if (!s) return resolve(null);
            resolve({
              nazwa: s.name || '',
              adres: s.workingAddress || s.residenceAddress || '',
            });
          } catch (e) {
            reject(new Error('MF API parse error: ' + data.slice(0, 200)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('MF API timeout')));
    req.on('error', reject);
  });
}

module.exports = (db) => {
  const router = express.Router();

  // GET /api/gus?nip=... — dane firmy do autouzupełnienia formularza (publiczne)
  const limiterGus = makePublicLimiter({ max: 20, message: 'Za dużo zapytań o NIP.' });
  router.get('/gus', limiterGus, async (req, res) => {
    const nip = String(req.query.nip || '').replace(/[\s-]/g, '');
    if (!walidujNip(nip)) {
      return res.json({ status: 'error', message: 'Nieprawidłowy NIP — sprawdź, czy ma 10 cyfr.' });
    }
    try {
      const firma = await pobierzDaneFirmy(nip);
      if (!firma || !firma.nazwa) {
        return res.json({ status: 'error', message: 'Nie znaleziono firmy o tym NIP w wykazie podatników VAT. Uzupełnij dane ręcznie.' });
      }
      const adres = parsujAdres(firma.adres);
      return res.json({
        status: 'success',
        nazwa: firma.nazwa,
        ulica: adres.ulica,
        kod_pocztowy: adres.kod_pocztowy,
        miasto: adres.miasto,
      });
    } catch (e) {
      console.error('[gus] Błąd pobierania danych dla NIP:', e.message);
      return res.json({ status: 'error', message: 'Nie udało się pobrać danych. Uzupełnij formularz ręcznie.' });
    }
  });

  return router;
};
