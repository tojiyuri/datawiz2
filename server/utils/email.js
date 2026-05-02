/**
 * Email service.
 *
 * Three providers, selectable via EMAIL_PROVIDER env var:
 *   - console (default for dev): logs the email to stdout. No setup needed.
 *   - smtp:    real email via nodemailer + SMTP credentials
 *   - disabled: drops emails silently (useful for tests)
 *
 * The same code paths run in dev and prod — only the adapter changes.
 */

let nodemailer = null;
let transporter = null;

const PROVIDER = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
const FROM = process.env.EMAIL_FROM || 'Data Wiz <noreply@example.com>';

function getTransporter() {
  if (transporter) return transporter;
  if (PROVIDER !== 'smtp') return null;

  if (!nodemailer) {
    try { nodemailer = require('nodemailer'); }
    catch (err) {
      console.error('[email] nodemailer not installed. Run: npm install nodemailer');
      return null;
    }
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('[email] EMAIL_PROVIDER=smtp but SMTP credentials are missing. Falling back to console.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * Send an email. Returns { ok: true } on success, { ok: false, error } otherwise.
 */
async function send({ to, subject, text, html }) {
  if (!to || !subject || (!text && !html)) {
    return { ok: false, error: 'Missing required fields' };
  }

  if (PROVIDER === 'disabled') {
    return { ok: true, dropped: true };
  }

  if (PROVIDER === 'console') {
    // Pretty-printed dev log so you can copy/paste reset links
    console.log('\n' + '─'.repeat(72));
    console.log(`📧 [email/console] To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   From:    ${FROM}`);
    console.log('─'.repeat(72));
    console.log(text || stripHtml(html));
    console.log('─'.repeat(72) + '\n');
    return { ok: true, provider: 'console' };
  }

  if (PROVIDER === 'smtp') {
    const t = getTransporter();
    if (!t) {
      // Fall back to console if SMTP isn't configured
      return send({ to, subject, text, html });
    }
    try {
      const info = await t.sendMail({ from: FROM, to, subject, text, html });
      return { ok: true, messageId: info.messageId, provider: 'smtp' };
    } catch (err) {
      console.error('[email] SMTP send failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: `Unknown EMAIL_PROVIDER: ${PROVIDER}` };
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

// ─── PRESET TEMPLATES ────────────────────────────────────────────────────────

function verifyEmailMessage({ name, link }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return {
    subject: 'Verify your Data Wiz email',
    text: `${greeting}

Welcome to Data Wiz. Please verify your email by clicking the link below:

${link}

This link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
    html: `<p>${greeting}</p>
<p>Welcome to Data Wiz. Please verify your email by clicking the button below:</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#818CF8;color:white;text-decoration:none;border-radius:6px">Verify email</a></p>
<p style="color:#888;font-size:12px">Or paste this URL: ${link}</p>
<p style="color:#888;font-size:12px">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
  };
}

function passwordResetMessage({ name, link }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return {
    subject: 'Reset your Data Wiz password',
    text: `${greeting}

Someone (hopefully you) requested a password reset for your Data Wiz account.

Click here to set a new password:
${link}

This link expires in 1 hour. If you didn't request a reset, you can ignore this email — your password won't change.`,
    html: `<p>${greeting}</p>
<p>Someone (hopefully you) requested a password reset for your Data Wiz account. Click below to set a new one:</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#818CF8;color:white;text-decoration:none;border-radius:6px">Reset password</a></p>
<p style="color:#888;font-size:12px">Or paste this URL: ${link}</p>
<p style="color:#888;font-size:12px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>`,
  };
}

function shareNotificationMessage({ ownerName, ownerEmail, resourceName, resourceType, link }) {
  return {
    subject: `${ownerName || ownerEmail} shared a ${resourceType} with you`,
    text: `${ownerName || ownerEmail} (${ownerEmail}) shared a ${resourceType} with you on Data Wiz: "${resourceName}"

View it here: ${link}`,
    html: `<p><strong>${ownerName || ownerEmail}</strong> shared a ${resourceType} with you:</p>
<p style="font-size:18px"><strong>${resourceName}</strong></p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#818CF8;color:white;text-decoration:none;border-radius:6px">Open ${resourceType}</a></p>`,
  };
}

module.exports = {
  send,
  verifyEmailMessage,
  passwordResetMessage,
  shareNotificationMessage,
  PROVIDER,
};
