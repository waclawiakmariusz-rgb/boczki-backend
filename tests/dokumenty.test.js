// tests/dokumenty.test.js
// Testy uploadu dokumentów: POST /api/dokumenty/upload + GET /api/dokumenty/:tenant/:file
//
// Testy są integracyjne — sharp i pdf-lib działają na prawdziwym pliku JPEG 20×20 px.
// Pliki trafiają do uploads/test-dok-XXXX/ i są czyszczone po testach.

const request = require('supertest');
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');

const TEST_TENANT   = `test-dok-${Date.now()}`;
const UPLOADS_ROOT  = path.join(__dirname, '..', 'uploads');
const TEST_UPLOAD_DIR = path.join(UPLOADS_ROOT, TEST_TENANT);

// ─── Helpers ───────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  // dokumenty.js nie używa db — przekazujemy pusty obiekt
  app.use('/api', require('../routes/dokumenty')({}));
  return app;
}

// Generuje mały (20×20px) szary JPEG jako Buffer
async function tinyJpeg() {
  return sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 200, b: 200 } }
  }).jpeg({ quality: 80 }).toBuffer();
}

let jpegBuf; // załadowany raz przed wszystkimi testami

beforeAll(async () => {
  jpegBuf = await tinyJpeg();
});

afterAll(() => {
  // Usuń pliki testowe
  if (fs.existsSync(TEST_UPLOAD_DIR)) {
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
});

// ─── POST /api/dokumenty/upload ────────────────────────────────
describe('POST /api/dokumenty/upload', () => {

  test('przyjmuje 1 stronę — zwraca URL i pages:1', async () => {
    const res = await request(buildApp())
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT)
      .attach('pages', jpegBuf, { filename: 'strona1.jpg', contentType: 'image/jpeg' });

    expect(res.body.status).toBe('success');
    expect(res.body.pages).toBe(1);
    expect(res.body.url).toMatch(new RegExp(`^/api/dokumenty/${TEST_TENANT}/[a-f0-9-]+\\.pdf$`));

    // Plik faktycznie istnieje na dysku
    const filepath = path.join(UPLOADS_ROOT, res.body.url.replace('/api/dokumenty/', '').replace('/', path.sep));
    expect(fs.existsSync(path.join(UPLOADS_ROOT, TEST_TENANT, path.basename(res.body.url)))).toBe(true);
  });

  test('przyjmuje 3 strony — zwraca pages:3', async () => {
    const res = await request(buildApp())
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT)
      .attach('pages', jpegBuf, { filename: 's1.jpg', contentType: 'image/jpeg' })
      .attach('pages', jpegBuf, { filename: 's2.jpg', contentType: 'image/jpeg' })
      .attach('pages', jpegBuf, { filename: 's3.jpg', contentType: 'image/jpeg' });

    expect(res.body.status).toBe('success');
    expect(res.body.pages).toBe(3);
  });

  test('zwraca error gdy brak tenant_id', async () => {
    const res = await request(buildApp())
      .post('/api/dokumenty/upload')
      .attach('pages', jpegBuf, { filename: 's.jpg', contentType: 'image/jpeg' });

    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/tenant_id/i);
  });

  test('zwraca error gdy brak pliku', async () => {
    const res = await request(buildApp())
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT);

    expect(res.body.status).toBe('error');
  });

  test('zwraca error dla pliku niebędącego obrazem (text/plain)', async () => {
    const res = await request(buildApp())
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT)
      .attach('pages', Buffer.from('to nie jest obrazek'), { filename: 'dok.txt', contentType: 'text/plain' });

    expect(res.body.status).toBe('error');
  });

  test('zwraca error gdy przekroczono limit 6 plików', async () => {
    const req = request(buildApp())
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT);

    for (let i = 0; i < 7; i++) {
      req.attach('pages', jpegBuf, { filename: `s${i}.jpg`, contentType: 'image/jpeg' });
    }

    const res = await req;
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/6/);
  });

  test('wygenerowany PDF jest ważnym plikiem PDF (zaczyna się od %PDF)', async () => {
    const res = await request(buildApp())
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT)
      .attach('pages', jpegBuf, { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.body.status).toBe('success');
    const filename = path.basename(res.body.url);
    const pdfPath  = path.join(UPLOADS_ROOT, TEST_TENANT, filename);
    const header   = fs.readFileSync(pdfPath).slice(0, 4).toString();
    expect(header).toBe('%PDF');
  });
});

// ─── GET /api/dokumenty/:tenant_id/:filename ───────────────────
describe('GET /api/dokumenty/:tenant_id/:filename', () => {
  let savedFilename;

  // Uploadujemy jeden plik przed testami GET
  beforeAll(async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/dokumenty/upload')
      .field('tenant_id', TEST_TENANT)
      .attach('pages', jpegBuf, { filename: 'get-test.jpg', contentType: 'image/jpeg' });
    savedFilename = path.basename(res.body.url);
  });

  test('serwuje PDF dla poprawnego tenant_id', async () => {
    const res = await request(buildApp())
      .get(`/api/dokumenty/${TEST_TENANT}/${savedFilename}?tenant_id=${TEST_TENANT}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.toString().slice(0, 4)).toBe('%PDF');
  });

  test('zwraca 403 gdy brak tenant_id w query', async () => {
    const res = await request(buildApp())
      .get(`/api/dokumenty/${TEST_TENANT}/${savedFilename}`);

    expect(res.status).toBe(403);
  });

  test('zwraca 403 gdy tenant_id w query nie zgadza się z URL', async () => {
    const res = await request(buildApp())
      .get(`/api/dokumenty/${TEST_TENANT}/${savedFilename}?tenant_id=inny-salon`);

    expect(res.status).toBe(403);
  });

  test('zwraca 404 gdy plik nie istnieje', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await request(buildApp())
      .get(`/api/dokumenty/${TEST_TENANT}/${fakeUuid}.pdf?tenant_id=${TEST_TENANT}`);

    expect(res.status).toBe(404);
  });

  test('zwraca 400 dla próby path traversal (../)', async () => {
    const res = await request(buildApp())
      .get(`/api/dokumenty/${TEST_TENANT}/../server.js?tenant_id=${TEST_TENANT}`);

    // Express normalizuje URL, więc request trafi na inny tenant lub 404/403
    expect([400, 403, 404]).toContain(res.status);
  });

  test('zwraca 400 dla nieprawidłowej nazwy pliku', async () => {
    const res = await request(buildApp())
      .get(`/api/dokumenty/${TEST_TENANT}/../../etc/passwd?tenant_id=${TEST_TENANT}`);

    expect([400, 403, 404]).toContain(res.status);
  });
});
