// routes/powiadomienia-admina.js — powiadomienia dla właściciela Estelio o ruchu w ticketach (2026-10-26).
//
// ODRĘBNY KANAŁ od routes/mailer.js (decyzja właściciela): tamten moduł obsługuje komunikację z klientami
// i salonami (rejestracja, reset hasła, seria powitalna, maile o wizytach) i NIE wolno go tu dotykać.
// Ten plik ma własny transport, własne szablony i nie importuje niczego z mailera, więc awaria albo
// zmiana jednego kanału nie przenosi się na drugi.
//
// Konfiguracja (zmienne środowiskowe):
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS — jak dotąd (to samo konto nadawcze),
//   TICKETY_EMAIL — adres, na który mają przychodzić powiadomienia o ticketach;
//                   gdy brak → ADMIN_EMAIL → SMTP_USER (dokładnie tak, jak było w mailerze).
//
// Rodzaje: 'ticket' (nowe zgłoszenie), 'dopisek' (salon dopisał komentarz), 'ponownie' (ręcznie z panelu).
// Tematy bez emoji na początku — od 15.10.2026 maile z „🎫" nie docierały do skrzynki admina
// (przyczyna nieustalona; dziennik w routes/tickety.js ma ją pokazać).
const nodemailer = require('nodemailer');

const bez = (v) => String(v == null ? '' : v).replace(/^['"]|['"]$/g, '');
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function konfiguracja(env = process.env) {
  const host = bez(env.SMTP_HOST), user = bez(env.SMTP_USER), pass = bez(env.SMTP_PASS);
  const port = parseInt(bez(env.SMTP_PORT) || '465', 10);
  return {
    host, port, user, pass,
    adresat: bez(env.TICKETY_EMAIL) || bez(env.ADMIN_EMAIL) || user,
    appUrl: (bez(env.APP_URL) || 'https://estelio.com.pl').replace(/\/$/, ''),
    gotowa: !!(host && user && pass),
  };
}

const KAT = { blad: 'Błąd', prosba: 'Prośba o zmianę', pytanie: 'Pytanie', inne: 'Inne' };

// Treść maila: temat + HTML + tekst. Czysta funkcja — testowalna bez SMTP.
function tresc(rodzaj, t, env = process.env) {
  const k = konfiguracja(env);
  const salon = t.nazwa_salonu || t.tenant_id || '';
  const dopisek = rodzaj === 'dopisek';
  const temat = dopisek
    ? `[Estelio] Komentarz do zgłoszenia #${t.id}: ${t.tytul} — ${salon}${t.otwarte_ponownie ? ' (otwarte ponownie)' : ''}`
    : `[Estelio] ${rodzaj === 'ponownie' ? 'Ponownie: ' : 'Nowe '}zgłoszenie #${t.id} [${t.pilnosc || 'normalna'}]: ${t.tytul} — ${salon}`;
  const wiersze = [
    ['Salon', `${salon}${t.tenant_id && t.tenant_id !== salon ? ` (${t.tenant_id})` : ''}`],
    [dopisek ? 'Napisał(a)' : 'Zgłasza', `${t.pracownik || '—'}${t.rola ? ` · ${t.rola}` : ''}`],
  ];
  if (!dopisek) wiersze.push(['Kategoria', KAT[t.kategoria] || t.kategoria || 'inne'], ['Pilność', t.pilnosc || 'normalna']);
  wiersze.push([dopisek ? 'Treść komentarza' : 'Opis', t.opis || '']);
  const html = `<!DOCTYPE html><html lang="pl"><body style="margin:0; padding:24px; background:#f6f7f9; font-family:Arial, sans-serif; color:#1f2937;">
  <div style="max-width:600px; margin:0 auto; background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:24px;">
    <p style="margin:0 0 6px; font-size:12px; color:#6b7280; letter-spacing:1px; text-transform:uppercase;">Estelio · zgłoszenia salonów</p>
    <h2 style="margin:0 0 16px; font-size:18px;">${dopisek ? 'Komentarz do zgłoszenia' : (rodzaj === 'ponownie' ? 'Zgłoszenie (wysłane ponownie)' : 'Nowe zgłoszenie')} #${esc(t.id)} · ${esc(t.tytul)}</h2>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      ${wiersze.map(([a, b]) => `<tr><td style="padding:7px 0; color:#6b7280; width:140px; vertical-align:top; border-bottom:1px solid #f3f4f6;">${a}:</td><td style="padding:7px 0; border-bottom:1px solid #f3f4f6; white-space:pre-line;">${esc(b)}</td></tr>`).join('')}
    </table>
    <p style="margin:20px 0 0;"><a href="${k.appUrl}/admin.html" style="display:inline-block; background:#1f2937; color:#fff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:14px;">Otwórz panel admina → Tickety</a></p>
  </div></body></html>`;
  const text = `${temat}\n\n${wiersze.map(([a, b]) => `${a}: ${b}`).join('\n')}\n\nPanel admina: ${k.appUrl}/admin.html`;
  return { temat, html, text, adresat: k.adresat };
}

// Wysyłka. Rzuca przy braku konfiguracji albo błędzie SMTP — wołający (routes/tickety.js) łapie i zapisuje do dziennika.
async function wyslij(rodzaj, t, env = process.env) {
  const k = konfiguracja(env);
  if (!k.gotowa) throw new Error('Brak konfiguracji SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS).');
  const m = tresc(rodzaj, t, env);
  const transport = nodemailer.createTransport({ host: k.host, port: k.port, secure: k.port === 465, auth: { user: k.user, pass: k.pass } });
  return transport.sendMail({ from: `"Estelio — zgłoszenia" <${k.user}>`, to: k.adresat, subject: m.temat, html: m.html, text: m.text });
}

module.exports = { konfiguracja, tresc, wyslij };
