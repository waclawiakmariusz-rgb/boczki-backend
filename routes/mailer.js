// routes/mailer.js
// Moduł wysyłania maili przez nodemailer — SMTP Hostinger

const nodemailer = require('nodemailer');

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Brak konfiguracji SMTP (SMTP_HOST, SMTP_USER, SMTP_PASS).');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true dla 465 (SSL), false dla 587 (TLS/STARTTLS)
    auth: { user, pass },
  });
}

// Stripuje apostrofy/cudzysłowy które Hostinger dodaje do env varów
function stripQuotes(val) {
  return (val || '').replace(/^['"]|['"]$/g, '');
}

const FROM        = () => `"Estelio" <${stripQuotes(process.env.SMTP_USER)}>`;
const ADMIN_EMAIL = () => stripQuotes(process.env.ADMIN_EMAIL) || stripQuotes(process.env.SMTP_USER);
const APP_URL     = () => stripQuotes(process.env.APP_URL || 'https://estelio.com.pl').replace(/\/$/, '');

// Paleta Estelio
// --dark:   #1c1a18   (header tło)
// --dark2:  #2a2420   (header gradient)
// --rose:   #b87080   (akcent, przyciski)
// --gold:   #c9a96e   (złoty akcent)
// --cream:  #f4efe6   (tło emaila)
// --cream2: #ede6d8   (border kart)
// --ink:    #2c2420   (główny tekst)
// --muted:  #7a6e66   (pomocniczy tekst)

// ─── Przycisk CTA kompatybilny z Gmail/Outlook ───────────────
// Gmail blokuje background na <a> — wymagana tabela z bgcolor na <td>
function emailBtn(link, tekst) {
  return `
    <table border="0" cellspacing="0" cellpadding="0" style="margin:28px auto;">
      <tr>
        <td bgcolor="#b87080" style="border-radius:10px; background-color:#b87080;">
          <a href="${link}" target="_blank"
             style="display:inline-block; padding:14px 34px; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; font-family:Georgia,serif; letter-spacing:0.3px; border-radius:10px;">
            ${tekst}
          </a>
        </td>
      </tr>
    </table>`;
}

// ─── Szablon bazowy emaila ────────────────────────────────────
function emailWrapper(icon, tytul, podtytul, tresc) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tytul}</title>
</head>
<body style="margin:0; padding:24px; background:#f4efe6; font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #ede6d8; box-shadow:0 4px 24px rgba(28,26,24,0.08);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1c1a18 0%,#2a2420 100%); padding:36px 40px; text-align:center;">
      <div style="font-size:28px; margin-bottom:10px;">${icon}</div>
      <h1 style="color:#c9a96e; margin:0; font-size:26px; font-weight:400; letter-spacing:2px; font-family:Georgia,'Times New Roman',serif;">Estelio</h1>
      <p style="color:rgba(255,255,255,0.55); margin:6px 0 0; font-size:12px; letter-spacing:0.5px; text-transform:uppercase;">${podtytul}</p>
    </div>

    <!-- Treść -->
    <div style="padding:36px 40px;">
      ${tresc}
    </div>

    <!-- Footer -->
    <div style="background:#f4efe6; border-top:1px solid #ede6d8; padding:18px 40px; text-align:center;">
      <p style="font-size:11px; color:#a89e96; margin:0;">© Estelio · System zarządzania salonem beauty</p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Wyślij link rejestracyjny do klienta ────────────────────
async function wyslijLinkRejestracji({ email, imie, token, nazwa_salonu }) {
  const link = `${APP_URL()}/rejestracja.html?token=${token}`;
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: email,
    subject: 'Twój link rejestracyjny — Estelio',
    html: emailWrapper('✨', 'Estelio', 'System zarządzania salonem', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">Cześć${imie ? ' ' + imie : ''}! 👋</p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:24px;">
        Dziękujemy za wybór systemu <strong style="color:#1c1a18;">Estelio</strong>.
        Kliknij poniższy przycisk, aby założyć profil swojego salonu
        ${nazwa_salonu ? `<strong style="color:#1c1a18;">${nazwa_salonu}</strong>` : ''}.
      </p>
      ${emailBtn(link, 'Załóż profil salonu →')}
      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:14px 18px; margin-bottom:20px;">
        <p style="font-size:11px; color:#a89e96; margin:0 0 4px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Lub skopiuj link ręcznie</p>
        <p style="font-size:11px; color:#5c5046; word-break:break-all; margin:0; font-family:monospace;">${link}</p>
      </div>
      <p style="font-size:12px; color:#a89e96; line-height:1.7;">
        ⚠️ Ten link jest jednorazowy i wygaśnie po 24 godzinach.<br>
        Jeśli nie rejestrowałeś/-aś salonu, zignoruj tę wiadomość.
      </p>
    `)
  });
}

// ─── Powiadomienie admina o nowym zgłoszeniu ──────────────────
async function powiadomAdmina({ imie, nazwa_salonu, email, telefon, miasto, wiadomosc }) {
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: ADMIN_EMAIL(),
    subject: `Nowe zgłoszenie: ${nazwa_salonu} (${imie})`,
    html: emailWrapper('📋', 'Estelio', 'Panel administratora', `
      <h2 style="font-size:16px; color:#1c1a18; margin-top:0; font-weight:700;">Nowe zgłoszenie rejestracji</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr><td style="padding:8px 0; color:#7a6e66; width:140px; border-bottom:1px solid #f4efe6;">Imię / kontakt:</td><td style="padding:8px 0; font-weight:600; color:#1c1a18; border-bottom:1px solid #f4efe6;">${imie}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Nazwa salonu:</td><td style="padding:8px 0; font-weight:600; color:#1c1a18; border-bottom:1px solid #f4efe6;">${nazwa_salonu}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">E-mail:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><a href="mailto:${email}" style="color:#b87080; text-decoration:none;">${email}</a></td></tr>
        ${telefon ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Telefon:</td><td style="padding:8px 0; color:#1c1a18; border-bottom:1px solid #f4efe6;">${telefon}</td></tr>` : ''}
        ${miasto ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Miasto:</td><td style="padding:8px 0; color:#1c1a18; border-bottom:1px solid #f4efe6;">${miasto}</td></tr>` : ''}
        ${wiadomosc ? `<tr><td style="padding:8px 0; color:#7a6e66; vertical-align:top;">Wiadomość:</td><td style="padding:8px 0; color:#1c1a18;">${wiadomosc}</td></tr>` : ''}
      </table>
      ${emailBtn(`${APP_URL()}/admin.html`, 'Przejdź do panelu admina →')}
    `)
  });
}

// ─── Reset hasła ─────────────────────────────────────────────
async function wyslijResetHasla({ email, login, token }) {
  const link = `${APP_URL()}/reset-hasla.html?token=${token}`;
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: email,
    subject: 'Reset hasła — Estelio',
    html: emailWrapper('🔑', 'Estelio', 'Reset hasła', `
      <p style="font-size:15px; color:#1c1a18; margin-bottom:8px;">Cześć <strong>${login}</strong> 👋</p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:24px;">
        Otrzymaliśmy prośbę o reset hasła do Twojego konta w systemie Estelio.<br>
        Kliknij poniższy przycisk, aby ustawić nowe hasło.
      </p>
      ${emailBtn(link, 'Ustaw nowe hasło →')}
      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:14px 18px; margin-bottom:20px;">
        <p style="font-size:11px; color:#a89e96; margin:0 0 4px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Lub skopiuj link ręcznie</p>
        <p style="font-size:11px; color:#5c5046; word-break:break-all; margin:0; font-family:monospace;">${link}</p>
      </div>
      <p style="font-size:12px; color:#a89e96; line-height:1.7;">
        ⏱ Link jest ważny przez <strong style="color:#7a6e66;">1 godzinę</strong>.<br>
        Jeśli to nie Ty wysłałeś/-aś tę prośbę — zignoruj wiadomość. Hasło pozostanie bez zmian.
      </p>
    `)
  });
}

// ─── Welcome email po zakończeniu rejestracji ────────────────
async function wyslijWitamy({ email, imie, nazwa_salonu, login, haslo }) {
  const link = `${APP_URL()}/zaloguj`;
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: email,
    subject: `Witaj w Estelio — Twój salon jest gotowy! 🎉`,
    html: emailWrapper('🎉', 'Estelio', 'System zarządzania salonem', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">
        Witaj${imie ? ' ' + imie : ''}! 🎀
      </p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:20px;">
        Salon <strong style="color:#1c1a18;">${nazwa_salonu}</strong> został pomyślnie zarejestrowany w systemie Estelio.
        Poniżej znajdziesz swoje dane do logowania — zachowaj je w bezpiecznym miejscu.
      </p>

      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:12px; padding:20px 24px; margin-bottom:24px;">
        <p style="margin:0 0 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#c9a96e;">Twoje dane logowania</p>
        <table style="width:100%; font-size:14px; border-collapse:collapse;">
          <tr>
            <td style="padding:6px 0; color:#7a6e66; width:80px;">Login:</td>
            <td style="padding:6px 0; font-weight:700; color:#1c1a18; font-family:monospace; font-size:15px;">${login}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#7a6e66;">Hasło:</td>
            <td style="padding:6px 0; font-weight:700; color:#1c1a18; font-family:monospace; font-size:15px;">${haslo}</td>
          </tr>
        </table>
      </div>

      ${emailBtn(link, 'Przejdź do systemu →')}

      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:16px 18px; margin-bottom:8px;">
        <p style="font-size:12px; font-weight:700; color:#1c1a18; margin:0 0 8px;">Co dalej?</p>
        <ul style="font-size:13px; color:#7a6e66; margin:0; padding-left:18px; line-height:1.9;">
          <li>Zaloguj się i uzupełnij listę pracowników</li>
          <li>Dodaj zabiegi i ceny usług</li>
          <li>Zarejestruj pierwszych klientów</li>
        </ul>
      </div>

      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:10px; padding:14px 18px; margin-top:8px;">
        <p style="font-size:12px; font-weight:700; color:#c9a96e; margin:0 0 5px; text-transform:uppercase; letter-spacing:0.5px;">Panel rozliczeniowy</p>
        <p style="font-size:12px; color:#7a6e66; margin:0; line-height:1.7;">
          Faktury, status subskrypcji i historię płatności znajdziesz w panelu rozliczeniowym:<br>
          <a href="${APP_URL()}/billing.html" style="color:#b87080; text-decoration:none; font-weight:600;">${APP_URL()}/billing.html</a><br>
          <span style="opacity:.8;">Logujesz się tymi samymi danymi co do systemu Estelio.</span>
        </p>
      </div>

      <p style="font-size:12px; color:#a89e96; line-height:1.7; margin-top:16px;">
        Masz pytania? Odpisz na tego maila lub napisz na
        <a href="mailto:${ADMIN_EMAIL()}" style="color:#b87080; text-decoration:none;">${ADMIN_EMAIL()}</a>.
      </p>
    `)
  });
}

// ─── Potwierdzenie przyjęcia zgłoszenia (zamow.html) ─────────
async function wyslijPotwierdzeniZgloszenia({ email, imie, nazwa_salonu }) {
  const transport = createTransport();

  await transport.sendMail({
    from: FROM(),
    to: email,
    subject: `Otrzymaliśmy Twoje zgłoszenie — Estelio`,
    html: emailWrapper('📬', 'Estelio', 'Potwierdzenie zgłoszenia', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">
        Cześć${imie ? ' ' + imie : ''}! 👋
      </p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:20px;">
        Twoje zgłoszenie dla salonu <strong style="color:#1c1a18;">${nazwa_salonu}</strong> zostało przyjęte.
        Skontaktujemy się z Tobą wkrótce i wyślemy link do rejestracji systemu.
      </p>

      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:12px; padding:16px 20px; margin-bottom:24px;">
        <p style="font-size:13px; color:#5c4a3a; margin:0; line-height:1.9;">
          ✅ Zgłoszenie zapisane<br>
          ⏳ Oczekuj na email z linkiem aktywacyjnym (zazwyczaj do 24h)
        </p>
      </div>

      <p style="font-size:13px; color:#7a6e66; line-height:1.8;">
        Jeśli masz pytania — odpisz na tego maila lub skontaktuj się pod adresem
        <a href="mailto:${ADMIN_EMAIL()}" style="color:#b87080; text-decoration:none;">${ADMIN_EMAIL()}</a>.
      </p>
    `)
  });
}

// ─── Wiadomość z formularza kontaktowego ─────────────────────
async function wyslijKontakt({ imie, email, typ, wiadomosc }) {
  const transport = createTransport();
  const typLabel = typ === 'klient' ? 'Istniejący klient' : 'Zainteresowany';

  await transport.sendMail({
    from: FROM(),
    to: ADMIN_EMAIL(),
    replyTo: email,
    subject: `Kontakt z Estelio: ${imie} (${typLabel})`,
    html: emailWrapper('✉️', 'Estelio', 'Wiadomość z formularza kontaktowego', `
      <h2 style="font-size:16px; color:#1c1a18; margin-top:0; font-weight:700;">Nowa wiadomość z estelio.com.pl</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr><td style="padding:8px 0; color:#7a6e66; width:140px; border-bottom:1px solid #f4efe6;">Typ:</td><td style="padding:8px 0; font-weight:600; color:#1c1a18; border-bottom:1px solid #f4efe6;">${typLabel}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Imię:</td><td style="padding:8px 0; font-weight:600; color:#1c1a18; border-bottom:1px solid #f4efe6;">${imie}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">E-mail:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><a href="mailto:${email}" style="color:#b87080; text-decoration:none;">${email}</a></td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; vertical-align:top;">Wiadomość:</td><td style="padding:8px 0; color:#1c1a18; white-space:pre-line;">${wiadomosc}</td></tr>
      </table>
      ${emailBtn(`mailto:${email}`, 'Odpowiedz →')}
    `)
  });
}

module.exports = { wyslijLinkRejestracji, powiadomAdmina, wyslijResetHasla, wyslijWitamy, wyslijPotwierdzeniZgloszenia, wyslijKontakt };
