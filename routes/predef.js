'use strict';
const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  // ─── Auto-create tables ────────────────────────────────────────────────────
  db.query(`
    CREATE TABLE IF NOT EXISTS Predef_kategorie (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nazwa VARCHAR(100) NOT NULL,
      ikona VARCHAR(10) DEFAULT '💅',
      kolejnosc INT DEFAULT 0
    )
  `, (err) => {
    if (err) { console.error('[predef] Błąd tworzenia Predef_kategorie:', err.message); return; }

    db.query(`
      CREATE TABLE IF NOT EXISTS Predef_zabiegi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        kategoria_id INT NOT NULL,
        nazwa VARCHAR(150) NOT NULL,
        domyslna_cena DECIMAL(10,2) DEFAULT 0
      )
    `, (err2) => {
      if (err2) { console.error('[predef] Błąd tworzenia Predef_zabiegi:', err2.message); return; }

      // Seed only if empty
      db.query('SELECT COUNT(*) AS cnt FROM Predef_kategorie', (err3, rows) => {
        if (err3 || rows[0].cnt > 0) return;

        const seed = [
          { nazwa: 'Stylizacja paznokci', ikona: '💅', kolejnosc: 1, zabiegi: [
            'Manicure hybrydowy','Manicure klasyczny','Pedicure hybrydowy','Pedicure klasyczny',
            'Żel na naturalną płytkę','Żel na tipsy','Akryl','Stylizacja French','Zdobienia'
          ]},
          { nazwa: 'Masaż', ikona: '💆', kolejnosc: 2, zabiegi: [
            'Masaż klasyczny','Masaż relaksacyjny','Masaż sportowy','Masaż głęboki',
            'Masaż gorącymi kamieniami','Masaż aromaterapeutyczny','Drenaż limfatyczny',
            'Masaż twarzy','Masaż 4 rąk'
          ]},
          { nazwa: 'Urządzenia Hi-Tech', ikona: '🔬', kolejnosc: 3, zabiegi: [
            'Karboksyterapia','Mikrodermabrazja','Peeling kawitacyjny','Ultradźwięki',
            'Mezoterapia bezigłowa','Elektrostymulacja','Radiofrekwencja','Oczyszczanie wodorowe','Oxybrazja'
          ]},
          { nazwa: 'Depilacja laserowa', ikona: '✨', kolejnosc: 4, zabiegi: [
            'Depilacja laserowa - pachy','Depilacja laserowa - bikini','Depilacja laserowa - łydki',
            'Depilacja laserowa - uda','Depilacja laserowa - plecy','Depilacja laserowa - twarz',
            'Depilacja laserowa - ręce','Depilacja laserowa - klatka piersiowa'
          ]},
          { nazwa: 'Brwi i rzęsy', ikona: '👁️', kolejnosc: 5, zabiegi: [
            'Laminowanie rzęs','Laminowanie brwi','Henna brwi','Henna rzęs','Lifting rzęs',
            'Przedłużanie rzęs 1:1','Przedłużanie rzęs objętościowe','Regulacja brwi','Stylizacja brwi'
          ]},
          { nazwa: 'Kosmetologia', ikona: '🌸', kolejnosc: 6, zabiegi: [
            'Oczyszczanie twarzy','Peeling chemiczny','Mezoterapia igłowa','Osocze bogatopłytkowe',
            'Mikronakłuwanie','Pielęgnacja przeciwzmarszczkowa','Maseczka algowa','Zabieg nawilżający','Lifting twarzy'
          ]},
          { nazwa: 'Makijaż', ikona: '💄', kolejnosc: 7, zabiegi: [
            'Makijaż dzienny','Makijaż wieczorowy','Makijaż ślubny','Makijaż okolicznościowy',
            'Makijaż permanentny brwi','Makijaż permanentny ust','Makijaż permanentny oczu'
          ]},
        ];

        let done = 0;
        seed.forEach(kat => {
          db.query(
            'INSERT INTO Predef_kategorie (nazwa, ikona, kolejnosc) VALUES (?, ?, ?)',
            [kat.nazwa, kat.ikona, kat.kolejnosc],
            (e, result) => {
              if (e) { console.error('[predef] seed kategoria error:', e.message); return; }
              const katId = result.insertId;
              if (!kat.zabiegi.length) return;
              const vals = kat.zabiegi.map(n => [katId, n, 0]);
              db.query(
                'INSERT INTO Predef_zabiegi (kategoria_id, nazwa, domyslna_cena) VALUES ?',
                [vals],
                (e2) => { if (e2) console.error('[predef] seed zabiegi error:', e2.message); }
              );
              done++;
              if (done === seed.length) console.log('[predef] Seed domyślnych kategorii zakończony.');
            }
          );
        });
      });
    });
  });

  // ─── Auth helper ──────────────────────────────────────────────────────────
  function requireAdmin(req, res) {
    if (req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
      res.status(401).json({ status: 'error', message: 'Brak dostępu.' });
      return false;
    }
    return true;
  }

  // ─── PUBLIC: GET /api/predef/zabiegi ─────────────────────────────────────
  router.get('/predef/zabiegi', (req, res) => {
    db.query(
      'SELECT id, nazwa, ikona FROM Predef_kategorie ORDER BY kolejnosc, id',
      (err, kats) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        if (!kats.length) return res.json({ status: 'success', kategorie: [] });

        db.query(
          'SELECT id, kategoria_id, nazwa, domyslna_cena FROM Predef_zabiegi ORDER BY id',
          (err2, zabiegi) => {
            if (err2) return res.status(500).json({ status: 'error', message: err2.message });

            const map = {};
            kats.forEach(k => { map[k.id] = { ...k, zabiegi: [] }; });
            zabiegi.forEach(z => {
              if (map[z.kategoria_id]) map[z.kategoria_id].zabiegi.push({
                id: z.id,
                nazwa: z.nazwa,
                domyslna_cena: parseFloat(z.domyslna_cena) || 0,
              });
            });

            res.json({ status: 'success', kategorie: Object.values(map) });
          }
        );
      }
    );
  });

  // ─── ADMIN: POST /api/predef/kategorie ───────────────────────────────────
  router.post('/predef/kategorie', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { nazwa, ikona = '💅' } = req.body;
    if (!nazwa) return res.status(400).json({ status: 'error', message: 'Pole nazwa jest wymagane.' });
    db.query(
      'INSERT INTO Predef_kategorie (nazwa, ikona) VALUES (?, ?)',
      [nazwa, ikona],
      (err, result) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        res.json({ status: 'success', id: result.insertId });
      }
    );
  });

  // ─── ADMIN: DELETE /api/predef/kategorie/:id ─────────────────────────────
  router.delete('/predef/kategorie/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ status: 'error', message: 'Nieprawidłowe id.' });
    db.query('DELETE FROM Predef_zabiegi WHERE kategoria_id = ?', [id], (err) => {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      db.query('DELETE FROM Predef_kategorie WHERE id = ?', [id], (err2) => {
        if (err2) return res.status(500).json({ status: 'error', message: err2.message });
        res.json({ status: 'success' });
      });
    });
  });

  // ─── ADMIN: POST /api/predef/zabiegi ─────────────────────────────────────
  router.post('/predef/zabiegi', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { kategoria_id, nazwa, domyslna_cena = 0 } = req.body;
    if (!kategoria_id || !nazwa) return res.status(400).json({ status: 'error', message: 'Pola kategoria_id i nazwa są wymagane.' });
    db.query(
      'INSERT INTO Predef_zabiegi (kategoria_id, nazwa, domyslna_cena) VALUES (?, ?, ?)',
      [kategoria_id, nazwa, domyslna_cena],
      (err, result) => {
        if (err) return res.status(500).json({ status: 'error', message: err.message });
        res.json({ status: 'success', id: result.insertId });
      }
    );
  });

  // ─── ADMIN: DELETE /api/predef/zabiegi/:id ───────────────────────────────
  router.delete('/predef/zabiegi/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ status: 'error', message: 'Nieprawidłowe id.' });
    db.query('DELETE FROM Predef_zabiegi WHERE id = ?', [id], (err) => {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      res.json({ status: 'success' });
    });
  });

  return router;
};
