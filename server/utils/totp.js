/**
 * 2FA via TOTP (Time-based One-Time Password, RFC 6238).
 *
 * Compatible with Google Authenticator, Authy, 1Password, Microsoft Authenticator.
 *
 * Flow:
 *   1. User clicks "Enable 2FA" → generateSecret() → store unverified secret
 *      + show QR code (otpauth://...)
 *   2. User scans QR, enters first code → verifyAndEnable() → secret marked verified
 *   3. Login: after password check, if totp_enabled, prompt for code
 *   4. Backup codes: 10 single-use codes generated at enable time, hashed in DB
 */

const crypto = require('crypto');

let otplib = null;
let qrcode = null;

function loadDeps() {
  if (!otplib) {
    try { otplib = require('otplib'); }
    catch (err) {
      throw new Error('2FA libraries not installed. Run: npm install otplib qrcode');
    }
  }
  if (!qrcode) {
    try { qrcode = require('qrcode'); }
    catch (err) {
      throw new Error('qrcode library not installed. Run: npm install qrcode');
    }
  }
  // Configure otplib once
  otplib.authenticator.options = {
    window: 1,         // accept ±30 seconds clock skew
    step: 30,
    digits: 6,
  };
}

function generateSecret() {
  loadDeps();
  return otplib.authenticator.generateSecret();
}

/**
 * Build the otpauth URL that authenticator apps consume.
 * accountName: user's email
 * issuer: app name (shows in the authenticator)
 */
function buildOtpauthUrl(accountName, secret, issuer = 'Data Wiz') {
  loadDeps();
  return otplib.authenticator.keyuri(accountName, issuer, secret);
}

/**
 * Generate a QR code data URL for display in the UI.
 */
async function generateQrCode(otpauthUrl) {
  loadDeps();
  return qrcode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', width: 240 });
}

/**
 * Verify a 6-digit code against a secret. Returns true/false.
 */
function verifyCode(code, secret) {
  loadDeps();
  if (!code || !secret) return false;
  try {
    return otplib.authenticator.check(String(code).replace(/\s/g, ''), secret);
  } catch (err) {
    return false;
  }
}

/**
 * Generate backup codes — 10 strings of format "abcd-efgh" (8 chars + dash).
 * Returns the raw codes (to show user once) and the hashes (to store).
 */
async function generateBackupCodes(bcrypt, count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const left = crypto.randomBytes(2).toString('hex');
    const right = crypto.randomBytes(2).toString('hex');
    codes.push(`${left}-${right}`);
  }
  const hashes = await Promise.all(codes.map(c => bcrypt.hash(c, 10)));
  return { codes, hashes };
}

/**
 * Verify a backup code against a list of hashes. Returns the index of the
 * matched hash (so the caller can mark it as used) or -1.
 */
async function verifyBackupCode(bcrypt, code, hashes) {
  if (!code || !hashes || !hashes.length) return -1;
  const normalized = code.trim().toLowerCase();
  for (let i = 0; i < hashes.length; i++) {
    if (!hashes[i]) continue; // already used
    try {
      if (await bcrypt.compare(normalized, hashes[i])) return i;
    } catch (_) {}
  }
  return -1;
}

module.exports = {
  generateSecret,
  buildOtpauthUrl,
  generateQrCode,
  verifyCode,
  generateBackupCodes,
  verifyBackupCode,
};
