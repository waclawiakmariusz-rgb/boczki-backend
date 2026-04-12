// routes/dokumenty.js
// Upload zdjęć dokumentów (RODO, regulamin) → optymalizacja → PDF
// POST /api/dokumenty/upload   — przyjmuje 1-6 zdjęć, zwraca URL do PDF
// GET  /api/dokumenty/:tenant_id/:filename — serwuje plik z kontrolą dostępu

const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const path    = require('path');
const fs      = require('fs');
const { randomUUID } = require('crypto');
const { PDFDocument } = require('pdf-lib');

// ─── Katalog uploads ──────────────────────────────────────────
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

function tenantDir(tenant_id) {
  const dir = path.join(UPLOADS_ROOT, tenant_id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Multer — pamięć (bufor), max 10 MB / plik, max 6 plików ─
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('Dozwolone tylko pliki graficzne (JPEG, PNG, WebP).'), ok);
  },
});

// ─── Optymalizacja jednej strony przez sharp ──────────────────
// Wynik: JPEG grayscale, max 1654×2339 px (200 DPI A4), quality 75
async function optymalizujStrone(buffer) {
  return sharp(buffer)
    .rotate()                          // auto-orientacja z EXIF
    .grayscale()
    .resize(1654, 2339, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 75, mozjpeg: true })
    .toBuffer();
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
      for (const jpegBuf of zoptymalizowane) {
        const img   = await pdfDoc.embedJpg(jpegBuf);
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
  // Serwuje plik PDF — dostęp tylko dla właściwego tenanta
  // tenant_id przekazywany jako query param: ?tenant_id=...
  router.get('/dokumenty/:tenant_id/:filename', (req, res) => {
    const { tenant_id, filename } = req.params;
    const requested_tenant = req.query.tenant_id;

    // Kontrola dostępu — tenant może widzieć tylko swoje pliki
    if (!requested_tenant || requested_tenant !== tenant_id) {
      return res.status(403).json({ status: 'error', message: 'Brak dostępu.' });
    }

    // Zabezpieczenie przed path traversal
    if (!/^[a-f0-9-]+\.pdf$/i.test(filename)) {
      return res.status(400).json({ status: 'error', message: 'Nieprawidłowa nazwa pliku.' });
    }

    const filepath = path.join(UPLOADS_ROOT, tenant_id, filename);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ status: 'error', message: 'Plik nie istnieje.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filepath);
  });

  return router;
};
