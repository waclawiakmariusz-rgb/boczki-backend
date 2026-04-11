// routes/mailer.js
// Moduł wysyłania maili przez nodemailer

const nodemailer = require('nodemailer');

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,  // np. twojmail@gmail.com
      pass: process.env.SMTP_PASS,  // App Password (16 znaków z myaccount.google.com/apppasswords)
    },
  });
}

const FROM = () => `"Boczki na bok" <${process.env.SMTP_USER}>`;
const ADMIN_EMAIL = () => process.env.ADMIN_EMAIL || process.env.SMTP_USER;
const APP_URL = () => process.env.APP_URL || 'https://boczkinabok.pl';

// ─── Wyślij link rejestracyjny do klienta ────────────────────
async function wyslijLinkRejestracji({ email, imie, token, nazwa_salonu }) {
  const link = `${APP_URL()}/rejestracja.html?token=${token}`;
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: email,
    subject: '🎀 Twój link rejestracyjny — Boczki na bok',
    html: `
      <div style="font-family:'Poppins',Arial,sans-serif; max-width:560px; margin:0 auto; background:#fdf8f5; border-radius:20px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#ff758c,#ff7eb3); padding:36px 40px; text-align:center;">
          <div style="font-size:40px; margin-bottom:10px;">🎀</div>
          <h1 style="color:white; margin:0; font-size:22px; font-weight:800;">Boczki na bok</h1>
          <p style="color:rgba(255,255,255,0.85); margin:6px 0 0; font-size:14px;">System zarządzania salonem</p>
        </div>
        <div style="padding:40px;">
          <p style="font-size:16px; font-weight:700; color:#2d3748; margin-bottom:8px;">Cześć ${imie || 'miło Cię poznać'}! 👋</p>
          <p style="font-size:14px; color:#718096; line-height:1.7; margin-bottom:24px;">
            Dziękujemy za zakup dostępu do systemu <strong>Boczki na bok</strong>.
            Kliknij poniższy przycisk, aby założyć profil swojego salonu<br>
            ${nazwa_salonu ? `<strong>${nazwa_salonu}</strong>` : ''}.
          </p>
          <div style="text-align:center; margin:32px 0;">
            <a href="${link}" style="background:linear-gradient(135deg,#ff758c,#ff7eb3); color:white; padding:16px 36px; border-radius:16px; text-decoration:none; font-weight:700; font-size:15px; display:inline-block; box-shadow:0 8px 20px rgba(255,117,140,0.35);">
              🚀 Załóż profil salonu
            </a>
          </div>
          <div style="background:#f8fafc; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
            <p style="font-size:12px; color:#a0aec0; margin:0 0 6px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Lub skopiuj link ręcznie</p>
            <p style="font-size:12px; color:#4a5568; word-break:break-all; margin:0; font-family:monospace;">${link}</p>
          </div>
          <p style="font-size:12px; color:#a0aec0; line-height:1.6;">
            ⚠️ Ten link jest jednorazowy i wygaśnie wkrótce.<br>
            Jeśli nie rejestrowałeś/-aś salonu, zignoruj tę wiadomość.
          </p>
        </div>
        <div style="background:#f1f5f9; padding:20px 40px; text-align:center;">
          <p style="font-size:12px; color:#a0aec0; margin:0;">© Boczki na bok · System zarządzania salonem</p>
        </div>
      </div>
    `
  });
}

// ─── Powiadomienie admina o nowym zgłoszeniu ──────────────────
async function powiadomAdmina({ imie, nazwa_salonu, email, telefon, miasto, wiadomosc }) {
  const transport = createTransport();
  const adminUrl = `${APP_URL()}/admin.html`;

  await transport.sendMail({
    from: FROM(),
    to: ADMIN_EMAIL(),
    subject: `📋 Nowe zgłoszenie: ${nazwa_salonu} (${imie})`,
    html: `
      <div style="font-family:Arial,sans-serif; max-width:520px; margin:0 auto;">
        <h2 style="color:#ff758c;">📋 Nowe zgłoszenie rejestracji</h2>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr><td style="padding:8px 0; color:#666; width:140px;">Imię / kontakt:</td><td style="padding:8px 0; font-weight:700;">${imie}</td></tr>
          <tr><td style="padding:8px 0; color:#666;">Nazwa salonu:</td><td style="padding:8px 0; font-weight:700;">${nazwa_salonu}</td></tr>
          <tr><td style="padding:8px 0; color:#666;">E-mail:</td><td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
          ${telefon ? `<tr><td style="padding:8px 0; color:#666;">Telefon:</td><td style="padding:8px 0;">${telefon}</td></tr>` : ''}
          ${miasto ? `<tr><td style="padding:8px 0; color:#666;">Miasto:</td><td style="padding:8px 0;">${miasto}</td></tr>` : ''}
          ${wiadomosc ? `<tr><td style="padding:8px 0; color:#666; vertical-align:top;">Wiadomość:</td><td style="padding:8px 0;">${wiadomosc}</td></tr>` : ''}
        </table>
        <div style="margin-top:24px; text-align:center;">
          <a href="${adminUrl}" style="background:#ff758c; color:white; padding:12px 28px; border-radius:12px; text-decoration:none; font-weight:700; font-size:14px;">
            → Przejdź do panelu admina
          </a>
        </div>
      </div>
    `
  });
}

// ─── Reset hasła ─────────────────────────────────────────────
async function wyslijResetHasla({ email, login, token }) {
  const link = `${APP_URL()}/reset-hasla.html?token=${token}`;
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: email,
    subject: '🔑 Reset hasła — Boczki na bok',
    html: `
      <div style="font-family:'Poppins',Arial,sans-serif; max-width:560px; margin:0 auto; background:#fdf8f5; border-radius:20px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#ff758c,#ff7eb3); padding:36px 40px; text-align:center;">
          <div style="font-size:40px; margin-bottom:10px;">🔑</div>
          <h1 style="color:white; margin:0; font-size:22px; font-weight:800;">Reset hasła</h1>
          <p style="color:rgba(255,255,255,0.85); margin:6px 0 0; font-size:14px;">Boczki na bok</p>
        </div>
        <div style="padding:40px;">
          <p style="font-size:15px; color:#2d3748; margin-bottom:8px;">Cześć <strong>${login}</strong> 👋</p>
          <p style="font-size:14px; color:#718096; line-height:1.7; margin-bottom:24px;">
            Otrzymaliśmy prośbę o reset hasła do Twojego konta.<br>
            Kliknij poniższy przycisk, aby ustawić nowe hasło.
          </p>
          <div style="text-align:center; margin:32px 0;">
            <a href="${link}" style="background:linear-gradient(135deg,#ff758c,#ff7eb3); color:white; padding:16px 36px; border-radius:16px; text-decoration:none; font-weight:700; font-size:15px; display:inline-block; box-shadow:0 8px 20px rgba(255,117,140,0.35);">
              🔑 Ustaw nowe hasło
            </a>
          </div>
          <div style="background:#f8fafc; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
            <p style="font-size:12px; color:#a0aec0; margin:0 0 6px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Lub skopiuj link ręcznie</p>
            <p style="font-size:12px; color:#4a5568; word-break:break-all; margin:0; font-family:monospace;">${link}</p>
          </div>
          <p style="font-size:12px; color:#a0aec0; line-height:1.6;">
            ⏱ Link jest ważny przez <strong>1 godzinę</strong>.<br>
            Jeśli to nie Ty wysłałeś/-aś tę prośbę — zignoruj tę wiadomość. Hasło pozostanie bez zmian.
          </p>
        </div>
        <div style="background:#f1f5f9; padding:20px 40px; text-align:center;">
          <p style="font-size:12px; color:#a0aec0; margin:0;">© Boczki na bok · System zarządzania salonem</p>
        </div>
      </div>
    `
  });
}

module.exports = { wyslijLinkRejestracji, powiadomAdmina, wyslijResetHasla };
