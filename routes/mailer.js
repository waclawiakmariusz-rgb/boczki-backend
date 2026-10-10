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
function mailDoKlienta({ to, subject, html }) {
  return { from: FROM(), to, replyTo: ADMIN_EMAIL(), subject, html, text: htmlDoTekstu(html) };
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

module.exports = { wyslijLinkRejestracji, powiadomAdmina, wyslijResetHasla, wyslijWitamy, wyslijPotwierdzeniZgloszenia, wyslijKontakt, wyslijOstrzezenieOPlatnosci, powiadomAdminaOFailedPayment, powiadomAdminaOZakupie, powiadomAdminaORejestracji };
