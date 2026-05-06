// routes/dokumenty.js
// Upload zdjęć dokumentów (RODO, regulamin) → optymalizacja → PDF
// POST /api/dokumenty/upload   — przyjmuje 1-6 zdjęć, zwraca URL do PDF
// GET  /api/dokumenty/:tenant_id/:filename — serwuje plik z kontrolą dostępu

const express = require('express');
const multer  = require('multer');
const Jimp = require('jimp');
const path    = require('path');
const fs      = require('fs');
const { randomUUID } = require('crypto');
const { PDFDocument } = require('pdf-lib');
const { validateTenantAccess } = require('./sessions');

// ─── Katalog uploads ──────────────────────────────────────────
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

// Walidacja tenant_id — chroni przed path traversal (np. ../../etc).
// Format: małe/duże litery, cyfry, myślniki — pasuje do slug'ów (boczki-salon-glowny-001).
const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function isValidTenantId(tid) {
  return typeof tid === 'string' && tid.length > 0 && tid.length < 100 && TENANT_ID_REGEX.test(tid);
}

function tenantDir(tenant_id) {
  if (!isValidTenantId(tenant_id)) throw new Error('Nieprawidłowy tenant_id');
  const dir = path.join(UPLOADS_ROOT, tenant_id);
  // Defense in depth — sprawdź że końcowy path jest WEWNĄTRZ UPLOADS_ROOT
  // (zabezpiecza nawet gdyby regex przepuścił coś dziwnego)
  const resolved = path.resolve(dir);
  const rootResolved = path.resolve(UPLOADS_ROOT);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error('Path traversal wykryty');
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Multer — pamięć (bufor), max 10 MB / plik, max 6 plików ─
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Dozwolone tylko pliki graficzne (JPEG, PNG, WebP).'), ok);
  },
});

// ─── Optymalizacja jednej strony przez jimp ───────────────────
// Wynik: JPEG grayscale, max 1240×1754 px (150 DPI A4), quality 75
async function optymalizujStrone(buffer) {
  const img = await Jimp.read(buffer);
  img.greyscale();
  // Skaluj tylko jeśli przekracza max wymiary (nie powiększaj)
  if (img.bitmap.width > 1240 || img.bitmap.height > 1754) {
    img.scaleToFit(1240, 1754);
  }
  img.quality(75);
  return img.getBufferAsync(Jimp.MIME_JPEG);
}

module.exports = (db) => {
  const router = express.Router();


  // ── POST /api/dokumenty/upload ──────────────────────────────
  // Body (multipart/form-data):
  //   tenant_id  — wymagany
  //   pages[]    — 1–6 plików graficznych (kolejność = kolejność stron)
  //
  // Odpowiedź: { status: 'success', url: '/api/dokumenty/[tenant]/[uuid].pdf' }
  router.post('/dokumenty/upload', (req, res) => {
    upload.array('pages', 6)(req, res, async (err) => {
      if (err) {
        const msg =
          err.code === 'LIMIT_FILE_COUNT' ? 'Maksymalnie 6 zdjęć naraz.' :
          err.code === 'LIMIT_FILE_SIZE'  ? 'Plik za duży (max 10 MB).' :
          err.message || 'Błąd przesyłania pliku.';
        return res.json({ status: 'error', message: msg });
      }
      await handleUpload(req, res);
    });
  });

  async function handleUpload(req, res) {
    const tenant_id = req.body.tenant_id;
    if (!tenant_id) return res.json({ status: 'error', message: 'Brak tenant_id.' });

    // Walidacja formatu tenant_id (chroni przed path traversal)
    if (!isValidTenantId(tenant_id)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowy format tenant_id.' });
    }

    // Walidacja sesji — czy session token uprawnia do TEGO tenanta
    const sessionToken = req.headers['x-session-token'] || req.body.session_token;
    if (sessionToken) {
      const v = validateTenantAccess(sessionToken, tenant_id);
      if (!v.valid) {
        return res.status(403).json({ status: 'error', message: 'Brak dostępu do tego tenanta.' });
      }
    }
    // Jeśli brak tokenu — middleware globalny w server.js zadba o ENFORCE_SESSION

    if (!req.files || req.files.length === 0) {
      return res.json({ status: 'error', message: 'Nie przesłano żadnego pliku.' });
    }

    try {
      // 1. Optymalizuj każdą stronę
      const zoptymalizowane = await Promise.all(
        req.files.map(f => optymalizujStrone(f.buffer))
      );

      // 2. Utwórz PDF
      const pdfDoc = await PDFDocument.create();
      for (const jpgBuf of zoptymalizowane) {
        const img   = await pdfDoc.embedJpg(jpgBuf);
        const page  = pdfDoc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const pdfBytes = await pdfDoc.save();

      // 3. Zapisz na dysk
      const dir      = tenantDir(tenant_id);
      const filename = `${randomUUID()}.pdf`;
      const filepath = path.join(dir, filename);
      fs.writeFileSync(filepath, pdfBytes);

      const url = `/api/dokumenty/${tenant_id}/${filename}`;
      return res.json({ status: 'success', url, pages: req.files.length });

    } catch (err) {
      console.error('[dokumenty upload]', err.message);
      return res.json({ status: 'error', message: 'Błąd przetwarzania pliku: ' + err.message });
    }
  }

  // ── GET /api/dokumenty/:tenant_id/:filename ─────────────────
  // Serwuje plik PDF — dostęp tylko dla zalogowanego tenanta którego pasuje
  // session token. Wcześniejsza wersja (przed 2026-05-06) sprawdzała tylko
  // tenant_id z URL vs query (oba klient-kontrolowane) — IDOR risk.
  router.get('/dokumenty/:tenant_id/:filename', (req, res) => {
    const { tenant_id, filename } = req.params;

    // Walidacja formatu tenant_id (chroni przed path traversal)
    if (!isValidTenantId(tenant_id)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowy tenant_id.' });
    }

    // Walidacja sesji — token musi uprawniać do TEGO tenanta
    const sessionToken = req.headers['x-session-token']
      || req.query.session_token  // fallback dla otwierania PDF z linku w nowej karcie
      || req.cookies?.session_token;
    if (!sessionToken) {
      return res.status(403).json({ status: 'error', message: 'Brak autoryzacji — zaloguj się.' });
    }
    const v = validateTenantAccess(sessionToken, tenant_id);
    if (!v.valid) {
      return res.status(403).json({
        status: 'error',
        message: v.reason === 'expired' ? 'Sesja wygasła — zaloguj się ponownie.' : 'Brak dostępu do tego pliku.'
      });
    }

    // Zabezpieczenie przed path traversal w nazwie pliku
    if (!/^[a-f0-9-]+\.pdf$/i.test(filename)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowa nazwa pliku.' });
    }

    const filepath = path.join(UPLOADS_ROOT, tenant_id, filename);
    // Defense in depth — sprawdź że ścieżka jest WEWNĄTRZ UPLOADS_ROOT
    const resolved = path.resolve(filepath);
    const rootResolved = path.resolve(UPLOADS_ROOT);
    if (!resolved.startsWith(rootResolved + path.sep)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowa ścieżka.' });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ status: 'error', message: 'Plik nie istnieje.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filepath);
  });

  return router;
};
