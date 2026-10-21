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

// 2026-10-10: wersja tekstowa każdego maila (nodemailer `text`) — klienci pocztowi bez HTML i filtry
// antyspamowe (brak części text/plain podnosi punktację spamu). Prosta konwersja: przyciski i linki
// zostają jako adresy, reszta tagów wylatuje.
function htmlDoTekstu(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => {
      const t = txt.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const adres = href.replace(/^mailto:/i, '');
      return t && t !== adres ? `${t}: ${adres}` : adres;
    })
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

// Wspólne pola maili do KLIENTA: odpowiedź trafia na skrzynkę kontaktową, zawsze jest część tekstowa.
function mailDoKlienta({ to, subject, html, bcc }) {
  const m = { from: FROM(), to, replyTo: ADMIN_EMAIL(), subject, html, text: htmlDoTekstu(html) };
  if (bcc) m.bcc = bcc;
  return m;
}

// Blok kontaktowy powtarzany na końcu maili do klienta.
function blokKontakt() {
  return `
      <p style="font-size:12px; color:#a89e96; line-height:1.7; margin-top:16px;">
        Masz pytanie? Odpisz na tę wiadomość albo napisz na
        <a href="mailto:${ADMIN_EMAIL()}" style="color:#b87080; text-decoration:none;">${ADMIN_EMAIL()}</a>
        — odpowiada człowiek, nie automat.
      </p>`;
}

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
      <p style="font-size:11px; color:#a89e96; margin:6px 0 0;">
        <a href="${APP_URL()}" style="color:#a89e96; text-decoration:none;">${APP_URL().replace(/^https?:\/\//, '')}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${ADMIN_EMAIL()}" style="color:#a89e96; text-decoration:none;">${ADMIN_EMAIL()}</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Wyślij link rejestracyjny do klienta ────────────────────
// `warunki` (opcjonalne, z webhooka Stripe): { kwota_grosze, cena_grosze, trial_dni, voucher } —
// mail jest jedynym potwierdzeniem zakupu przy trialu (faktury za 0 zł nie ma), więc mówi wprost,
// ile pobrano dziś, co dalej z opłatą i że można zrezygnować. Bez `warunki` (link z panelu admina)
// blok warunków jest pomijany — nie zgadujemy.
async function wyslijLinkRejestracji({ email, imie, token, nazwa_salonu, dniWaznosci, warunki }) {
  const link = `${APP_URL()}/rejestracja.html?token=${token}`;
  // Ważność w treści maila = faktyczna ważność tokenu (webhook: trial+7, min. 30; admin: wybrana)
  const dni = parseInt(dniWaznosci, 10) > 0 ? parseInt(dniWaznosci, 10) : 7;
  const transport = createTransport();

  let blokWarunki = '';
  if (warunki && typeof warunki === 'object') {
    const kwota = parseInt(warunki.kwota_grosze, 10);
    const cena = parseInt(warunki.cena_grosze, 10);
    const trial = parseInt(warunki.trial_dni, 10);
    const zl = (g) => (g / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') + ' zł';
    const voucher = String(warunki.voucher || '').trim();
    let opis;
    if (Number.isFinite(kwota) && kwota > 0) {
      opis = `Pobraliśmy dziś <strong style="color:#1c1a18;">${zl(kwota)}</strong>${voucher ? ` (kod <strong>${voucher}</strong>)` : ''}. Faktura przyjdzie osobnym mailem.`
        + (Number.isFinite(cena) && cena > 0 ? ` Kolejne opłaty: ${zl(cena)} miesięcznie, pobierane automatycznie.` : '');
    } else if (voucher) {
      opis = `Dziś <strong style="color:#1c1a18;">0 zł</strong> — korzystasz z okresu próbnego z kodu <strong>${voucher}</strong>.`
        + (Number.isFinite(cena) && cena > 0 ? ` Po jego zakończeniu abonament ${zl(cena)} miesięcznie pobierze się automatycznie z zapisanej karty.` : '');
    } else {
      opis = `Dziś <strong style="color:#1c1a18;">0 zł</strong> — pierwsze ${Number.isFinite(trial) && trial > 0 ? trial : 14} dni masz za darmo.`
        + (Number.isFinite(cena) && cena > 0 ? ` Potem abonament ${zl(cena)} miesięcznie pobierze się automatycznie z zapisanej karty.` : '');
    }
    blokWarunki = `
      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:10px; padding:14px 18px; margin-bottom:16px;">
        <p style="font-size:12px; font-weight:700; color:#c9a96e; margin:0 0 5px; text-transform:uppercase; letter-spacing:0.5px;">Twoje warunki</p>
        <p style="font-size:13px; color:#5c5046; margin:0; line-height:1.7;">
          ${opis} Zrezygnować możesz w każdej chwili w panelu rozliczeniowym — bez umowy na czas określony.
        </p>
      </div>`;
  }

  const html = emailWrapper('✨', 'Estelio', 'System zarządzania salonem', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">Cześć${imie ? ' ' + imie : ''}! 👋</p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:20px;">
        Dziękujemy za wybór <strong style="color:#1c1a18;">Estelio</strong>. Został jeden krok:
        załóż profil salonu${nazwa_salonu ? ` <strong style="color:#1c1a18;">${nazwa_salonu}</strong>` : ''}.
        Kreator prowadzi za rękę i zajmuje około 5 minut — dane z zamówienia są już wpisane.
      </p>
      ${emailBtn(link, 'Załóż profil salonu →')}
      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:14px 18px; margin-bottom:16px;">
        <p style="font-size:11px; color:#a89e96; margin:0 0 4px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Lub skopiuj link ręcznie</p>
        <p style="font-size:11px; color:#5c5046; word-break:break-all; margin:0; font-family:monospace;">${link}</p>
      </div>
      ${blokWarunki}
      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:14px 18px; margin-bottom:16px;">
        <p style="font-size:12px; font-weight:700; color:#1c1a18; margin:0 0 8px;">Co Cię czeka w kreatorze</p>
        <ol style="font-size:13px; color:#7a6e66; margin:0; padding-left:18px; line-height:1.9;">
          <li>Dane salonu i Twój login z hasłem</li>
          <li>Pracownicy z 4-cyfrowymi PIN-ami (Ty jako Manager)</li>
          <li>Usługi — z gotowego katalogu albo własne</li>
          <li>Gotowe: logujesz się i zaczynasz pracę</li>
        </ol>
      </div>
      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:10px; padding:14px 18px; margin-bottom:20px;">
        <p style="font-size:12px; font-weight:700; color:#c9a96e; margin:0 0 5px; text-transform:uppercase; letter-spacing:0.5px;">Panel rozliczeniowy</p>
        <p style="font-size:12px; color:#7a6e66; margin:0; line-height:1.7;">
          Faktury, abonament i kartę znajdziesz po rejestracji pod adresem
          <a href="${APP_URL()}/billing.html" style="color:#b87080; text-decoration:none; font-weight:600;">${APP_URL()}/billing.html</a> — logujesz się tymi samymi danymi co do systemu.
        </p>
      </div>
      <p style="font-size:12px; color:#a89e96; line-height:1.7;">
        ⚠️ Link jest jednorazowy i ważny przez ${dni} dni (do rejestracji wystarczy raz).<br>
        Jeśli to nie Ty zamawiałaś/-eś Estelio, zignoruj tę wiadomość — nic się nie stanie.
      </p>
      ${blokKontakt()}
    `);

  await transport.sendMail(mailDoKlienta({
    to: email,
    subject: nazwa_salonu ? `Załóż profil salonu ${nazwa_salonu} — Twój link do Estelio` : 'Twój link rejestracyjny — Estelio',
    html,
  }));
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

  await transport.sendMail(mailDoKlienta({
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
      ${blokKontakt()}
    `)
  }));
}

// ─── Welcome email po zakończeniu rejestracji ────────────────
// 2026-10-09: mail powitalny NIE zawiera hasła (wcześniej szło jawnym tekstem i leżało w skrzynce
// bezterminowo, a ekran sukcesu kreatora obiecywał, że hasła nie wyślemy). Zostaje login +
// informacja, jak odzyskać hasło. Parametr `haslo` celowo ignorowany, gdyby ktoś go jeszcze przekazał.
async function wyslijWitamy({ email, imie, nazwa_salonu, login }) {
  const link = `${APP_URL()}/zaloguj`;
  const transport = createTransport();

  await transport.sendMail(mailDoKlienta({
    to: email,
    subject: `Witaj w Estelio — salon ${nazwa_salonu || ''} jest gotowy! 🎉`.replace('  ', ' '),
    html: emailWrapper('🎉', 'Estelio', 'System zarządzania salonem', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">
        Witaj${imie ? ' ' + imie : ''}! 🎀
      </p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:20px;">
        Salon <strong style="color:#1c1a18;">${nazwa_salonu}</strong> jest zarejestrowany w Estelio — pracownicy
        z PIN-ami i usługi z kreatora już czekają. Poniżej login (hasła nie wysyłamy — ustawiłaś/-eś je w kreatorze).
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
            <td style="padding:6px 0; color:#1c1a18; font-size:13px;">ustawione przez Ciebie w kreatorze — ze względów bezpieczeństwa nie wysyłamy go mailem</td>
          </tr>
        </table>
        <p style="font-size:12px; color:#7a6e66; margin:12px 0 0; line-height:1.7;">
          Nie pamiętasz hasła? Na ekranie logowania kliknij „Nie pamiętam hasła" — wyślemy link do ustawienia nowego.
        </p>
      </div>

      ${emailBtn(link, 'Przejdź do systemu →')}

      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:16px 18px; margin-bottom:8px;">
        <p style="font-size:12px; font-weight:700; color:#1c1a18; margin:0 0 8px;">Pierwsze 15 minut — od tego warto zacząć</p>
        <ol style="font-size:13px; color:#7a6e66; margin:0; padding-left:18px; line-height:1.9;">
          <li><strong style="color:#1c1a18;">Zaloguj się</strong> loginem i hasłem, potem wybierz siebie z listy i wpisz swój PIN. Działa na komputerze i na telefonie — PIN jest osobisty, login wspólny dla salonu.</li>
          <li><strong style="color:#1c1a18;">Wpisz ceny usług</strong> — pozycje wybrane z katalogu mają na start 0 zł. Administracja → Zabiegi, ołówek przy pozycji.</li>
          <li><strong style="color:#1c1a18;">Dodaj pierwszą klientkę i pierwszą sprzedaż</strong> — Klienci → Nowy klient, potem Sprzedaż. Reszta (zadatki, karnety, magazyn) przyjdzie sama.</li>
          <li><strong style="color:#1c1a18;">Masz pytanie w trakcie pracy?</strong> Kliknij różowy dymek Esti w prawym dolnym rogu i zapytaj własnymi słowami — odpowiada z przewodnika.</li>
        </ol>
      </div>

      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:14px 18px; margin:8px 0;">
        <p style="font-size:12px; font-weight:700; color:#1c1a18; margin:0 0 6px;">Przewodniki — do przeczytania przy kawie</p>
        <p style="font-size:13px; color:#7a6e66; margin:0; line-height:1.8;">
          📖 Dla recepcji i kosmetologów, krok po kroku ze scenkami z salonu:
          <a href="${APP_URL()}/pomoc/" style="color:#b87080; text-decoration:none; font-weight:600;">${APP_URL()}/pomoc/</a><br>
          👑 Dla Ciebie jako managerki/właścicielki — liczby, kontrola, decyzje:
          <a href="${APP_URL()}/pomoc-manager/" style="color:#b87080; text-decoration:none; font-weight:600;">${APP_URL()}/pomoc-manager/</a>
        </p>
      </div>

      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:10px; padding:14px 18px; margin-top:8px;">
        <p style="font-size:12px; font-weight:700; color:#c9a96e; margin:0 0 5px; text-transform:uppercase; letter-spacing:0.5px;">Panel rozliczeniowy</p>
        <p style="font-size:12px; color:#7a6e66; margin:0; line-height:1.7;">
          Faktury, status subskrypcji i historię płatności znajdziesz w panelu rozliczeniowym:<br>
          <a href="${APP_URL()}/billing.html" style="color:#b87080; text-decoration:none; font-weight:600;">${APP_URL()}/billing.html</a><br>
          <span style="opacity:.8;">Logujesz się tymi samymi danymi co do systemu Estelio.</span>
        </p>
      </div>

      ${blokKontakt()}
    `)
  }));
}

// ─── Potwierdzenie przyjęcia zgłoszenia (zamow.html) ─────────
async function wyslijPotwierdzeniZgloszenia({ email, imie, nazwa_salonu }) {
  const transport = createTransport();

  await transport.sendMail(mailDoKlienta({
    to: email,
    subject: `Otrzymaliśmy Twoje zgłoszenie${nazwa_salonu ? ` — ${nazwa_salonu}` : ''} — Estelio`,
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

      ${blokKontakt()}
    `)
  }));
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

// ─── Wyślij ostrzeżenie o nieudanej płatności (do klienta) ────
async function wyslijOstrzezenieOPlatnosci({ email, nazwa_salonu, data_grace_until }) {
  if (!email) return;
  const transporter = createTransport();
  const dataStr = data_grace_until
    ? new Date(data_grace_until).toLocaleDateString('pl-PL')
    : 'wkrótce';
  return transporter.sendMail(mailDoKlienta({
    to: email,
    subject: `⚠️ Nie udało się pobrać opłaty za Estelio${nazwa_salonu ? ` — ${nazwa_salonu}` : ''}`,
    html: emailWrapper('💳', 'Problem z płatnością', 'Subskrypcja Estelio', `
      <h2 style="margin:0 0 14px; font-size:20px; color:#1c1a18;">Dzień dobry${nazwa_salonu ? `, ${nazwa_salonu}` : ''}!</h2>
      <p style="font-size:14px; color:#2c2420; line-height:1.7;">
        Nie udało się pobrać miesięcznej opłaty za Estelio z zapisanej karty. Nic się nie stało —
        to zwykle jedna z trzech rzeczy:
      </p>
      <ul style="font-size:14px; color:#2c2420; line-height:1.8; padding-left:18px;">
        <li>Wygasła karta płatnicza</li>
        <li>Brak środków na koncie</li>
        <li>Bank zablokował transakcję cykliczną</li>
      </ul>
      <p style="font-size:14px; color:#2c2420; line-height:1.7;">
        <strong>Salon nadal działa</strong> — masz czas do <strong>${dataStr}</strong>
        żeby odnowić płatność. Po tej dacie logowanie zostanie zablokowane do czasu
        opłacenia subskrypcji.
      </p>
      <p style="font-size:14px; color:#2c2420; line-height:1.7;">
        Co zrobić: otwórz panel rozliczeniowy (logujesz się tym samym loginem i hasłem co do systemu,
        bez PIN-u), kliknij „Zarządzaj płatnością" i podaj nową kartę. Opłata pobierze się sama,
        a dostęp pozostanie bez przerwy.
      </p>
      ${emailBtn(`${APP_URL()}/billing.html`, 'Otwórz panel rozliczeniowy →')}
      ${blokKontakt()}
    `)
  }));
}

// ─── Powiadom admina o nieudanej płatności klienta ────────────
async function powiadomAdminaOFailedPayment({ email, nazwa_salonu, kwota }) {
  const transporter = createTransport();
  return transporter.sendMail({
    from: FROM(),
    to: ADMIN_EMAIL(),
    subject: `⚠️ Nieudana płatność: ${nazwa_salonu || email}`,
    html: emailWrapper('🚨', 'Nieudana płatność', 'Powiadomienie admina', `
      <h2 style="margin:0 0 14px; font-size:18px; color:#1c1a18;">Stripe webhook: invoice.payment_failed</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:14px;">
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6; width:140px;">Salon:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><strong>${nazwa_salonu || '(nieznany)'}</strong></td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Email klienta:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><a href="mailto:${email}" style="color:#b87080;">${email}</a></td></tr>
        ${kwota ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Kwota:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;">${kwota}</td></tr>` : ''}
        <tr><td style="padding:8px 0; color:#7a6e66;">Status klienta:</td><td style="padding:8px 0; color:#dc2626; font-weight:700;">opóźniony (grace 7 dni)</td></tr>
      </table>
      <p style="font-size:13px; color:#7a6e66; margin-top:20px;">
        Klient został automatycznie powiadomiony emailem. Po 7 dniach (jeśli płatność nie przejdzie),
        logowanie do salonu zostanie zablokowane. Stripe ponowi próbę pobrania kilkukrotnie.
      </p>
      ${emailBtn('https://dashboard.stripe.com/payments', 'Otwórz Stripe Dashboard →')}
    `)
  });
}

// ─── Powiadom admina o nowym zakupie (Stripe checkout opłacony) ──
async function powiadomAdminaOZakupie({ imie, nazwa_salonu, email, telefon, miasto, kwota_grosze, voucher }) {
  const transporter = createTransport();
  const groszeNum = parseInt(kwota_grosze);
  const kwota = Number.isFinite(groszeNum) ? (groszeNum / 100).toFixed(2) + ' zł' : '(nieznana)';
  return transporter.sendMail({
    from: FROM(),
    to: ADMIN_EMAIL(),
    subject: `💰 Nowy zakup: ${nazwa_salonu || email} — ${kwota}`,
    html: emailWrapper('💰', 'Nowy zakup!', 'Powiadomienie admina', `
      <h2 style="margin:0 0 14px; font-size:18px; color:#1c1a18;">Ktoś właśnie kupił Estelio 🎉</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:14px;">
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6; width:140px;">Salon:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><strong>${nazwa_salonu || '(brak)'}</strong></td></tr>
        ${imie ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Imię:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;">${imie}</td></tr>` : ''}
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Email:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><a href="mailto:${email}" style="color:#b87080;">${email}</a></td></tr>
        ${telefon ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Telefon:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;">${telefon}</td></tr>` : ''}
        ${miasto ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Miasto:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;">${miasto}</td></tr>` : ''}
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Pobrana kwota:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6; font-weight:700; color:#16a34a;">${kwota}</td></tr>
        ${voucher ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Voucher:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6; font-weight:700; color:#c9a96e;">${voucher}</td></tr>` : ''}
      </table>
      <p style="font-size:13px; color:#7a6e66; margin-top:20px;">
        Link rejestracyjny został wysłany klientowi automatycznie. Faktura w Fakturowni.
        Gdy klient ukończy rejestrację salonu, dostaniesz osobne powiadomienie.
      </p>
      ${emailBtn(`${APP_URL()}/admin.html`, 'Otwórz panel admina →')}
    `)
  });
}

// ─── Powiadom admina o ukończonej rejestracji salonu ─────────
async function powiadomAdminaORejestracji({ nazwa_salonu, email, login, tenant_id }) {
  const transporter = createTransport();
  return transporter.sendMail({
    from: FROM(),
    to: ADMIN_EMAIL(),
    subject: `🎉 Nowy salon zarejestrowany: ${nazwa_salonu}`,
    html: emailWrapper('🎉', 'Nowy salon!', 'Powiadomienie admina', `
      <h2 style="margin:0 0 14px; font-size:18px; color:#1c1a18;">Salon ukończył rejestrację</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px; margin-top:14px;">
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6; width:140px;">Salon:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><strong>${nazwa_salonu}</strong></td></tr>
        ${email ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Email:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><a href="mailto:${email}" style="color:#b87080;">${email}</a></td></tr>` : ''}
        ${login ? `<tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Login:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6; font-family:monospace;">${login}</td></tr>` : ''}
        <tr><td style="padding:8px 0; color:#7a6e66;">Tenant ID:</td><td style="padding:8px 0; font-family:monospace; font-size:12px;">${tenant_id}</td></tr>
      </table>
      <p style="font-size:13px; color:#7a6e66; margin-top:20px;">
        Klient dostał welcome email z danymi logowania i linkiem do panelu rozliczeniowego.
        System jest dla niego w pełni aktywny.
      </p>
      ${emailBtn(`${APP_URL()}/admin.html`, 'Otwórz panel admina →')}
    `)
  });
}

// ─── Przypomnienia dla nowych klientów (routes/przypomnienia.js, 2026-10-10) ─────────
// Kopia (BCC) do ADMIN_EMAIL — właściciel widzi, co dostają klienci.

// etap 1 (3 dni): „link czeka"; etap 2 (10 dni): „wygaśnie za N dni"
async function wyslijPrzypomnienieLink({ email, imie, nazwa_salonu, token, dniDoWygasniecia, etap }) {
  const link = `${APP_URL()}/rejestracja.html?token=${token}`;
  const dni = parseInt(dniDoWygasniecia, 10);
  const salon = nazwa_salonu ? ` <strong style="color:#1c1a18;">${nazwa_salonu}</strong>` : '';
  const drugi = Number(etap) === 2;
  const transport = createTransport();
  const html = emailWrapper(drugi ? '⏳' : '✨', 'Estelio', 'System zarządzania salonem', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">Cześć${imie ? ' ' + imie : ''}! 👋</p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:20px;">
        ${drugi
          ? `Link do założenia salonu${salon} jest wciąż nieużyty${Number.isFinite(dni) && dni > 0 ? ` i <strong style="color:#1c1a18;">wygaśnie za ${dni} ${dni === 1 ? 'dzień' : 'dni'}</strong>` : ''}.
             Po tym terminie trzeba będzie poprosić o nowy — a rejestracja to naprawdę 5 minut.`
          : `Kilka dni temu wysłaliśmy Ci link do założenia salonu${salon}, a profil wciąż czeka.
             Nic straconego — link jest ważny${Number.isFinite(dni) && dni > 0 ? ` jeszcze ${dni} dni` : ''}. Kreator zajmuje około 5 minut, dane z zamówienia są już wpisane.`}
      </p>
      ${emailBtn(link, drugi ? 'Dokończ rejestrację →' : 'Załóż profil salonu →')}
      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:14px 18px; margin-bottom:16px;">
        <p style="font-size:11px; color:#a89e96; margin:0 0 4px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Lub skopiuj link ręcznie</p>
        <p style="font-size:11px; color:#5c5046; word-break:break-all; margin:0; font-family:monospace;">${link}</p>
      </div>
      <p style="font-size:13px; color:#7a6e66; line-height:1.8;">
        Coś Cię zatrzymało? Niejasny krok, brak czasu, pytanie o cenę? Odpisz jednym zdaniem — pomożemy
        albo założymy salon razem przez telefon.
      </p>
      ${blokKontakt()}
    `);
  await transport.sendMail(mailDoKlienta({
    to: email,
    bcc: ADMIN_EMAIL(),
    subject: drugi
      ? `Link do rejestracji${nazwa_salonu ? ` salonu ${nazwa_salonu}` : ''} wygaśnie${Number.isFinite(dni) && dni > 0 ? ` za ${dni} dni` : ' wkrótce'} — Estelio`
      : `Twój link do Estelio czeka — 5 minut i salon${nazwa_salonu ? ` ${nazwa_salonu}` : ''} działa`,
    html,
  }));
}

// 3 dni po rejestracji bez ani jednego logowania
async function wyslijPrzypomnienieStart({ email, nazwa_salonu, login }) {
  const transport = createTransport();
  const html = emailWrapper('🌸', 'Estelio', 'System zarządzania salonem', `
      <p style="font-size:16px; font-weight:700; color:#1c1a18; margin-bottom:8px;">Dzień dobry${nazwa_salonu ? `, ${nazwa_salonu}` : ''}! 👋</p>
      <p style="font-size:14px; color:#7a6e66; line-height:1.8; margin-bottom:20px;">
        Salon jest założony, ale widzimy, że nikt się jeszcze nie logował. To normalne — pierwszy raz
        zawsze jest „jutro". Dlatego podpowiadamy, od czego zacząć, żeby Estelio zaczęło pracować dla Ciebie.
      </p>
      <div style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:12px; padding:16px 20px; margin-bottom:20px;">
        <p style="margin:0 0 6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#c9a96e;">Twój login</p>
        <p style="margin:0; font-size:15px; font-weight:700; color:#1c1a18; font-family:monospace;">${login || '—'}</p>
        <p style="font-size:12px; color:#7a6e66; margin:8px 0 0; line-height:1.7;">Hasło ustawiłaś/-eś w kreatorze. Nie pamiętasz? Na ekranie logowania kliknij „Nie pamiętam hasła".</p>
      </div>
      ${emailBtn(`${APP_URL()}/zaloguj`, 'Zaloguj się do Estelio →')}
      <div style="background:#faf7f2; border:1px solid #ede6d8; border-radius:10px; padding:16px 18px; margin-bottom:8px;">
        <p style="font-size:12px; font-weight:700; color:#1c1a18; margin:0 0 8px;">Trzy rzeczy na pierwsze 15 minut</p>
        <ol style="font-size:13px; color:#7a6e66; margin:0; padding-left:18px; line-height:1.9;">
          <li>Zaloguj się, wybierz siebie z listy i wpisz swój PIN.</li>
          <li>Wpisz ceny usług (Administracja → Zabiegi) — pozycje z katalogu mają na start 0 zł.</li>
          <li>Dodaj pierwszą klientkę i pierwszą sprzedaż. Od tej chwili system zaczyna liczyć.</li>
        </ol>
      </div>
      <p style="font-size:13px; color:#7a6e66; line-height:1.8; margin-top:12px;">
        Wolisz, żeby ktoś Cię przeprowadził? Odpisz na tę wiadomość — umówimy 20 minut przez telefon
        i wystartujemy razem. Przewodnik krok po kroku:
        <a href="${APP_URL()}/pomoc/" style="color:#b87080; text-decoration:none; font-weight:600;">${APP_URL()}/pomoc/</a>
      </p>
      ${blokKontakt()}
    `);
  await transport.sendMail(mailDoKlienta({
    to: email,
    bcc: ADMIN_EMAIL(),
    subject: `Salon${nazwa_salonu ? ` ${nazwa_salonu}` : ''} czeka na pierwsze logowanie — pomożemy wystartować`,
    html,
  }));
}

// ─── Nowy ticket z salonu (routes/tickety.js, 2026-10-11) — do admina ─────────
async function powiadomAdminaOTickecie({ id, tenant_id, nazwa_salonu, pracownik, rola, kategoria, pilnosc, tytul, opis }) {
  const transporter = createTransport();
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const KAT = { blad: '🐞 Błąd', prosba: '💡 Prośba o zmianę', pytanie: '❓ Pytanie', inne: '📝 Inne', dopisek: '💬 Dopisek salonu do rozmowy' };
  const PIL = { niska: 'niska', normalna: 'normalna', wysoka: '⚠️ wysoka', krytyczna: '🚨 KRYTYCZNA' };
  const dopisek = kategoria === 'dopisek';
  const html = emailWrapper(dopisek ? '💬' : '🎫', dopisek ? 'Salon dopisał do zgłoszenia' : 'Nowe zgłoszenie', 'Panel administratora', `
      <h2 style="margin:0 0 14px; font-size:18px; color:#1c1a18;">#${id} · ${esc(tytul)}${dopisek && pilnosc === 'otwarte ponownie' ? ' <span style="font-size:13px; color:#b45309;">(otwarte ponownie)</span>' : ''}</h2>
      <table style="width:100%; border-collapse:collapse; font-size:14px;">
        <tr><td style="padding:8px 0; color:#7a6e66; width:130px; border-bottom:1px solid #f4efe6;">Salon:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;"><strong>${esc(nazwa_salonu || tenant_id)}</strong> <span style="color:#a89e96; font-size:12px;">(${esc(tenant_id)})</span></td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Zgłasza:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;">${esc(pracownik)}${rola ? ` · ${esc(rola)}` : ''}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Kategoria:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6;">${KAT[kategoria] || esc(kategoria)}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; border-bottom:1px solid #f4efe6;">Pilność:</td><td style="padding:8px 0; border-bottom:1px solid #f4efe6; ${pilnosc === 'krytyczna' ? 'color:#dc2626; font-weight:700;' : ''}">${PIL[pilnosc] || esc(pilnosc)}</td></tr>
        <tr><td style="padding:8px 0; color:#7a6e66; vertical-align:top;">Opis:</td><td style="padding:8px 0; color:#1c1a18; white-space:pre-line;">${esc(opis)}</td></tr>
      </table>
      ${emailBtn(`${APP_URL()}/admin.html`, 'Otwórz panel admina → Tickety')}
    `);
  return transporter.sendMail({
    from: FROM(), to: ADMIN_EMAIL(),
    subject: dopisek ? `💬 #${id} dopisek salonu${pilnosc === 'otwarte ponownie' ? ' (otwarte ponownie)' : ''}: ${tytul} — ${nazwa_salonu || tenant_id}` : `🎫 #${id} [${pilnosc}] ${tytul} — ${nazwa_salonu || tenant_id}`,
    html, text: htmlDoTekstu(html),
  });
}

// ─── Szablon jasny: prawdziwe logo zamiast ciemnego paska ────
// Używany przez serię powitalną (decyzja właściciela 2026-10-18: żadnych zastępczych napisów
// „Estelio", żadnego ciemnego nagłówka). Logo to ten sam plik co w aplikacji i na stronie:
// /img/estelio-logo.png. Gdy klient pocztowy blokuje obrazki, alt pokazuje nazwę — stąd też
// czytelny `alt` i wysokość ustawiona atrybutem, żeby układ nie skakał przed pobraniem grafiki.
function emailWrapperJasny(podtytul, tresc) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estelio</title>
</head>
<body style="margin:0; padding:24px; background:#f8f5f1; font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #ece4dc; box-shadow:0 4px 20px rgba(28,26,24,0.06);">

    <!-- Nagłówek: logo na jasnym tle -->
    <div style="background:#ffffff; padding:34px 40px 22px; text-align:center; border-bottom:1px solid #f1eae2;">
      <img src="${APP_URL()}/img/estelio-logo.png" alt="Estelio — Beauty Management" width="230" style="width:230px; max-width:76%; height:auto; display:block; margin:0 auto;">
      <p style="color:#a89e96; margin:14px 0 0; font-size:11px; letter-spacing:1.4px; text-transform:uppercase;">${podtytul}</p>
    </div>

    <!-- Treść -->
    <div style="padding:32px 40px 36px;">
      ${tresc}
    </div>

    <!-- Stopka -->
    <div style="background:#faf7f4; border-top:1px solid #f1eae2; padding:18px 40px; text-align:center;">
      <p style="font-size:11px; color:#a89e96; margin:0;">© Estelio · System zarządzania salonem beauty</p>
      <p style="font-size:11px; color:#a89e96; margin:6px 0 0;">
        <a href="${APP_URL()}" style="color:#a89e96; text-decoration:none;">${APP_URL().replace(/^https?:\/\//, '')}</a>
        &nbsp;·&nbsp;
        <a href="mailto:${ADMIN_EMAIL()}" style="color:#a89e96; text-decoration:none;">${ADMIN_EMAIL()}</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

// ─── Seria powitalna: jeden etap = jeden mail ────────────────
// Treść etapów trzyma routes/maile-wprowadzajace.js (SERIA) — tutaj tylko składanie i wysyłka.
// Mail prowadzi do rozdziału przewodnika /pomoc/ (ten ma zrzuty ekranu), nie tłumaczy wszystkiego sam.
// Kopia do właściciela (BCC), żeby widział dokładnie to, co dostają klientki.
// Bez licznika „N z M" — liczba wiadomości w serii należy do właściciela i może rosnąć
// (dochodzą kolejne maile edukacyjne), a klientka nie ma powodu oglądać numeracji.
// Podtytuł w nagłówku jest edytowalny per wiadomość; domyślnie „Pierwsze kroki w systemie".
function zbudujMailWprowadzajacy({ nazwa_salonu, mail }) {
  const link = `${APP_URL()}${mail.link_wlasny || ('/pomoc/#' + mail.kotwica)}`;
  const podtytul = mail.podtytul || 'Pierwsze kroki w systemie';

  // Sekcje merytoryczne: numerowany krążek + tytuł + akapit. Tabela, bo Outlook nie radzi sobie z flexem.
  const sekcje = (mail.sekcje || []).map(([tytul, opis], i) => `
      <table border="0" cellspacing="0" cellpadding="0" width="100%" style="margin-bottom:18px;">
        <tr>
          <td width="32" valign="top" style="padding-top:2px;">
            <div style="width:26px; height:26px; border-radius:50%; background:#f7f0f2; color:#b87080; font-size:12px; font-weight:700; text-align:center; line-height:26px; font-family:Georgia,serif;">${i + 1}</div>
          </td>
          <td valign="top" style="padding-left:12px;">
            <p style="margin:0 0 4px; font-size:14.5px; font-weight:700; color:#1c1a18; line-height:1.4;">${tytul}</p>
            <p style="margin:0; font-size:13.5px; color:#6f655e; line-height:1.75;">${opis}</p>
          </td>
        </tr>
      </table>`).join('');

  // Zrzut ekranu z przewodnika — ten sam plik, który klient zobaczy u siebie w /pomoc/.
  // Sama nazwa pliku = katalog /pomoc-zrzuty/ (przewodnik główny). Zrzut z innego przewodnika
  // podaje się ze ścieżką, np. '/pomoc-terminarz/trm-09-widok-dzien.png' — 20.10.2026 okazało się,
  // że sklejanie na sztywno dawało adres, pod którym nic nie leży, i mail miał dziurę zamiast obrazka.
  const sciezkaZrzutu = (p) => (String(p).startsWith('/') ? String(p) : '/pomoc-zrzuty/' + p);
  const zrzut = mail.zrzut ? `
      <table border="0" cellspacing="0" cellpadding="0" width="100%" style="margin:6px 0 24px;">
        <tr><td style="border:1px solid #ece4dc; border-radius:10px; padding:8px; background:#fcfaf8;">
          <a href="${link}" target="_blank" style="display:block; text-decoration:none;">
            <img src="${APP_URL()}${sciezkaZrzutu(mail.zrzut.plik)}" alt="${(mail.zrzut.podpis || '').replace(/"/g, '')}" width="476" style="width:100%; max-width:476px; height:auto; display:block; border-radius:6px;">
          </a>
        </td></tr>
        <tr><td style="padding:8px 4px 0;">
          <p style="margin:0; font-size:12px; color:#a89e96; line-height:1.6;">${mail.zrzut.podpis || ''}</p>
        </td></tr>
      </table>` : '';

  const uwaga = mail.uwaga ? `
      <table border="0" cellspacing="0" cellpadding="0" width="100%" style="margin:4px 0 22px;">
        <tr><td style="background:#fbf4f5; border-left:3px solid #d4a0ad; border-radius:0 8px 8px 0; padding:14px 18px;">
          <p style="margin:0 0 5px; font-size:11px; font-weight:700; color:#b87080; text-transform:uppercase; letter-spacing:0.6px;">${mail.uwaga.tytul}</p>
          <p style="margin:0; font-size:13px; color:#6f655e; line-height:1.75;">${mail.uwaga.tekst}</p>
        </td></tr>
      </table>` : '';

  return emailWrapperJasny(podtytul, `
      ${mail.preheader ? `<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">${mail.preheader}</div>` : ''}
      <p style="font-size:17px; font-weight:700; color:#1c1a18; margin:0 0 10px; line-height:1.4;">${mail.naglowek}</p>
      <p style="font-size:14px; color:#6f655e; line-height:1.8; margin:0 0 24px;">${mail.wstep}</p>
      ${zrzut}
      ${sekcje}
      ${uwaga}
      <table border="0" cellspacing="0" cellpadding="0" width="100%" style="margin:4px 0 0;">
        <tr><td style="background:#fdf9f3; border:1px solid #e8d8c4; border-radius:10px; padding:14px 18px;">
          <p style="font-size:11px; font-weight:700; color:#c9a96e; margin:0 0 5px; text-transform:uppercase; letter-spacing:0.6px;">Jedna rzecz na dziś</p>
          <p style="font-size:13.5px; color:#5c5046; margin:0; line-height:1.7;">${mail.dzis}</p>
        </td></tr>
      </table>
      ${emailBtn(link, mail.cta || 'Otwórz przewodnik')}
      <p style="font-size:12px; color:#a89e96; line-height:1.7; text-align:center; margin:0;">
        Rozdział w przewodniku ma zrzuty ekranu z działającego systemu — pokazuje dokładnie to, co widzisz u siebie.
      </p>
      ${blokKontakt()}
      <p style="font-size:11px; color:#c4bcb6; line-height:1.6; margin-top:18px; border-top:1px solid #f4efe6; padding-top:14px;">
        Wiadomość z serii pierwszych kroków${nazwa_salonu ? ` dla salonu ${nazwa_salonu}` : ''}.
        Nie chcesz ich dostawać? Odpisz jednym słowem „stop" — wyłączymy serię i nic więcej nie przyjdzie.
      </p>
    `);
}

// Zwraca to, co oddał serwer pocztowy: identyfikator wiadomości i jego odpowiedź („250 OK ...”).
// To jest dowód nadania, który trafia do dziennika wysyłek — gdy salon mówi „nie dostaliśmy maila",
// mamy datę, godzinę, adres i numer wiadomości u operatora.
async function wyslijMailWprowadzajacy({ email, nazwa_salonu, mail }) {
  const transport = createTransport();
  const html = zbudujMailWprowadzajacy({ nazwa_salonu, mail });
  // Temat bez emoji — w skrzynce firmowej wygląda poważniej i rzadziej ląduje w „Oferty".
  const wynik = await transport.sendMail(mailDoKlienta({ to: email, bcc: ADMIN_EMAIL(), subject: mail.temat, html }));
  return {
    messageId: (wynik && wynik.messageId) || null,
    odpowiedz: (wynik && wynik.response) || null,
    przyjete: (wynik && wynik.accepted) || [],
    odrzucone: (wynik && wynik.rejected) || [],
  };
}

module.exports = { wyslijLinkRejestracji, powiadomAdmina, wyslijResetHasla, wyslijWitamy, wyslijPotwierdzeniZgloszenia, wyslijKontakt, wyslijOstrzezenieOPlatnosci, powiadomAdminaOFailedPayment, powiadomAdminaOZakupie, powiadomAdminaORejestracji, wyslijPrzypomnienieLink, wyslijPrzypomnienieStart, powiadomAdminaOTickecie, wyslijMailWprowadzajacy, zbudujMailWprowadzajacy, wyslijMailWizyty, zbudujMailWizyty };

// ─── Powiadomienia o wizycie dla KLIENTEK salonu (21.10.2026) ────────────────────────────────
// Stylistyka serii wprowadzającej (jasny nagłówek z logo, karta z treścią, jeden przycisk),
// ale nadawcą i podpisem jest SALON, nie Estelio: klientka salonu nie zna naszej marki,
// a wiadomość od nieznanego nadawcy ląduje w spamie albo w koszu.
//   • nadawca:  „Boczki na bok" <kontakt@estelio.com.pl>   (nazwa salonu, adres techniczny nasz)
//   • odpowiedz: adres salonu z licencji — żeby odpowiedź klientki trafiła tam, gdzie ktoś ją przeczyta
//   • stopka:   nazwa, adres i telefon salonu + zdanie o rezygnacji
const DNI_TYG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const MIESIACE_PL = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
function dataPoPolsku(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DNI_TYG[d.getDay()]}, ${Number(m[3])} ${MIESIACE_PL[Number(m[2]) - 1]} ${m[1]}`;
}

function zbudujMailWizyty({ salon, wizyta, typ }) {
  const s = salon || {};
  const w = wizyta || {};
  const przypomnienie = typ === 'przypomnienie';
  const nazwaSalonu = s.nazwa || 'Salon';
  const zabiegi = (w.pozycje || []).map(p => {
    const nazwa = [p.kategoria, p.wariant].filter(Boolean).join(' · ');
    const kto = p.pracownik ? ` — ${p.pracownik}` : '';
    return `<tr>
        <td style="padding:6px 0; font-size:13.5px; color:#6f655e; white-space:nowrap; vertical-align:top;">${p.od || w.godzina}–${p.do_ || w.koniec}</td>
        <td style="padding:6px 0 6px 14px; font-size:13.5px; color:#1c1a18; font-weight:600;">${nazwa}<span style="font-weight:400; color:#6f655e;">${kto}</span></td>
      </tr>`;
  }).join('') || `<tr><td style="padding:6px 0; font-size:13.5px; color:#6f655e;">${w.godzina || ''}–${w.koniec || ''}</td><td style="padding:6px 0 6px 14px; font-size:13.5px;">wizyta</td></tr>`;

  const naglowek = przypomnienie ? 'Przypominamy o jutrzejszej wizycie' : 'Wizyta umówiona';
  const wstep = przypomnienie
    ? `Do zobaczenia jutro. Gdyby coś się zmieniło, daj nam znać najszybciej jak możesz — termin przejmie wtedy ktoś z listy oczekujących.`
    : `Dziękujemy za umówienie wizyty. Poniżej szczegóły — zachowaj tę wiadomość, żeby mieć je pod ręką.`;

  const kontakt = [s.telefon ? `tel. ${s.telefon}` : null, s.email ? s.email : null].filter(Boolean).join(' · ');

  const tresc = `
      <h2 style="margin:0 0 14px; font-size:21px; color:#1c1a18; font-weight:600; font-family:Georgia,'Times New Roman',serif;">${naglowek}</h2>
      <p style="margin:0 0 20px; font-size:14px; color:#6f655e; line-height:1.75;">${wstep}</p>

      <table border="0" cellspacing="0" cellpadding="0" width="100%" style="margin:0 0 22px; border:1px solid #ece4dc; border-radius:10px; background:#fcfaf8;">
        <tr><td style="padding:18px 20px;">
          <p style="margin:0 0 2px; font-size:11px; letter-spacing:1.2px; text-transform:uppercase; color:#a89e96;">Termin</p>
          <p style="margin:0 0 14px; font-size:19px; color:#1c1a18; font-weight:700; font-family:Georgia,serif;">${dataPoPolsku(w.dzien)}, godz. ${w.godzina || ''}</p>
          <table border="0" cellspacing="0" cellpadding="0" width="100%">${zabiegi}</table>
          ${s.adres ? `<p style="margin:14px 0 0; font-size:13px; color:#6f655e;">Miejsce: <b style="color:#1c1a18;">${nazwaSalonu}</b>, ${s.adres}</p>` : ''}
        </td></tr>
      </table>

      <p style="margin:0 0 6px; font-size:13.5px; color:#6f655e; line-height:1.75;">
        <b style="color:#1c1a18;">Nie możesz przyjść?</b> Odpisz na tę wiadomość${s.telefon ? ` albo zadzwoń: <b style="color:#1c1a18;">${s.telefon}</b>` : ''}.
        Im wcześniej wiemy, tym łatwiej znaleźć inny termin dla Ciebie i obsadzić ten.
      </p>`;

  const stopka = `
      <p style="font-size:11px; color:#a89e96; margin:0;">${nazwaSalonu}${s.adres ? ' · ' + s.adres : ''}</p>
      ${kontakt ? `<p style="font-size:11px; color:#a89e96; margin:6px 0 0;">${kontakt}</p>` : ''}
      <p style="font-size:11px; color:#a89e96; margin:10px 0 0;">Dostajesz tę wiadomość, bo masz umówioną wizytę w naszym salonie.
        Nie chcesz takich powiadomień? Odpisz jednym słowem „stop" albo powiedz nam przy najbliższej wizycie.</p>`;

  return emailWrapperJasnySalon(nazwaSalonu, przypomnienie ? 'Przypomnienie o wizycie' : 'Potwierdzenie wizyty', tresc, stopka);
}

// Ten sam jasny szablon co seria wprowadzająca, ale z podpisem salonu w stopce.
function emailWrapperJasnySalon(nazwaSalonu, podtytul, tresc, stopka) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${podtytul}</title>
</head>
<body style="margin:0; padding:24px; background:#f8f5f1; font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #ece4dc; box-shadow:0 4px 20px rgba(28,26,24,0.06);">

    <div style="background:#ffffff; padding:28px 40px 20px; text-align:center; border-bottom:1px solid #f1eae2;">
      <!-- Jasne logo Estelio nad nazwą salonu (prośba właściciela 21.10.2026). Klientka widzi
           przede wszystkim swój salon, ale wiadomość ma rozpoznawalny nagłówek systemu.
           Plik ten sam co w aplikacji; alt zostaje czytelny, gdy skrzynka blokuje grafikę. -->
      <img src="${APP_URL()}/img/estelio-logo.png" alt="Estelio" width="150" style="width:150px; max-width:52%; height:auto; display:block; margin:0 auto 16px;">
      <p style="margin:0; font-size:22px; color:#1c1a18; font-weight:600; font-family:Georgia,'Times New Roman',serif; letter-spacing:.3px;">${nazwaSalonu}</p>
      <p style="color:#a89e96; margin:10px 0 0; font-size:11px; letter-spacing:1.4px; text-transform:uppercase;">${podtytul}</p>
    </div>

    <div style="padding:30px 40px 34px;">
      ${tresc}
    </div>

    <div style="background:#faf7f4; border-top:1px solid #f1eae2; padding:18px 40px; text-align:center;">
      ${stopka}
    </div>

  </div>
</body>
</html>`;
}

async function wyslijMailWizyty({ email, salon, wizyta, typ }) {
  const transport = createTransport();
  const s = salon || {};
  const html = zbudujMailWizyty({ salon: s, wizyta, typ });
  const przypomnienie = typ === 'przypomnienie';
  const kiedy = `${dataPoPolsku((wizyta || {}).dzien)}, godz. ${(wizyta || {}).godzina || ''}`;
  const temat = przypomnienie ? `Przypomnienie o wizycie — ${kiedy}` : `Potwierdzenie wizyty — ${kiedy}`;
  // Nadawca podpisany salonem; odpowiedź leci do salonu, a gdy salon nie ma adresu — na naszą
  // skrzynkę kontaktową, żeby odpowiedź klientki nigdy nie trafiła w próżnię.
  const nazwa = String(s.nazwa || 'Salon').replace(/["<>\r\n]/g, ' ').trim();
  const wynik = await transport.sendMail({
    from: `"${nazwa}" <${stripQuotes(process.env.SMTP_USER)}>`,
    to: email,
    replyTo: s.email || ADMIN_EMAIL(),
    subject: temat,
    html,
    text: htmlDoTekstu(html),
  });
  return {
    messageId: (wynik && wynik.messageId) || null,
    odpowiedz: (wynik && wynik.response) || null,
    przyjete: (wynik && wynik.accepted) || [],
    odrzucone: (wynik && wynik.rejected) || [],
  };
}
