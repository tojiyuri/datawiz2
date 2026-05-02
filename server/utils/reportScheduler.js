/**
 * Report scheduler.
 *
 * Wakes up every CHECK_INTERVAL_MS, finds due reports, and sends them.
 * Uses the existing nodemailer setup (same module that sends auth emails).
 *
 * Email content: a textual summary built from the dashboard's chart data,
 * plus a link back to the live dashboard. We do not server-render chart
 * images — that would require headless Chromium, which is a deployment
 * burden out of scope for this iteration. Most teams that ask for
 * "scheduled reports" actually want the email-as-notification + click-to-see
 * pattern, not embedded images that always look bad in email clients.
 */

const scheduledReports = require('./scheduledReports');
const sheetStore = require('./sheetStore');
const datasetStore = require('./datasetStore');
const { buildChartFromSheet } = require('./sheetSpecBuilder');
const statInsights = require('./statInsights');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;   // poll every 10 minutes

let mailer = null;
function loadMailer() {
  if (mailer) return mailer;
  try {
    // The auth flow already uses nodemailer; reuse the same configured transport.
    const { sendEmail } = require('../routes/auth');
    if (typeof sendEmail === 'function') mailer = sendEmail;
  } catch (_) {}
  return mailer;
}

let timer = null;

/**
 * Build the email body for a given report. Returns { subject, html, text }.
 */
async function buildEmail(report) {
  const dashboard = sheetStore.getDashboard(report.dashboardId, report.ownerId);
  if (!dashboard) {
    return null;
  }

  const ds = datasetStore.get(dashboard.datasetId, report.ownerId);
  if (!ds) {
    return null;
  }

  // For each tile, render the chart on the server and compute a quick summary.
  // We don't ship images — the email is a digest. The link gets users to the
  // live dashboard if they want to dig in.
  const tileSummaries = [];
  for (const tile of (dashboard.tiles || []).slice(0, 8)) {     // cap at 8 tiles in email
    const sheet = sheetStore.getSheet(tile.sheetId, report.ownerId);
    if (!sheet) continue;
    try {
      const result = buildChartFromSheet(sheet.spec, ds);
      const summary = summarizeChart(sheet, result);
      if (summary) tileSummaries.push(summary);
    } catch (err) {
      // Skip individual tile failures — better to send a partial email
      // than to fail the whole report.
    }
  }

  const baseUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const dashboardLink = `${baseUrl}/dashboards/${dashboard.id}`;

  const subject = `${report.name} — ${dashboard.name}`;
  const text = textBody(report, dashboard, tileSummaries, dashboardLink);
  const html = htmlBody(report, dashboard, tileSummaries, dashboardLink);
  return { subject, text, html };
}

function summarizeChart(sheet, result) {
  if (!result?.chartData) return null;
  const data = result.chartData;
  const spec = result.spec;

  // Extract a one-line factual summary using statInsights when possible
  let summary = '';
  try {
    const yKey = spec?.y;
    if (Array.isArray(data) && data.length && yKey) {
      const values = data.map(r => Number(r[yKey])).filter(v => Number.isFinite(v));
      if (values.length) {
        const total = values.reduce((a, b) => a + b, 0);
        const avg = total / values.length;
        const top = data.reduce((m, r) => (Number(r[yKey]) > Number(m[yKey] || 0) ? r : m), data[0]);
        const xKey = spec?.x;
        summary = xKey
          ? `Total ${yKey}: ${fmt(total)} across ${values.length} ${xKey}. Top: ${top[xKey]} at ${fmt(top[yKey])}.`
          : `Total ${yKey}: ${fmt(total)} (avg ${fmt(avg)}).`;
      }
    }
  } catch (_) {}

  return { name: sheet.name, type: spec?.type, summary };
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'K';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function textBody(report, dashboard, summaries, link) {
  const lines = [
    `Scheduled report: ${report.name}`,
    `Dashboard: ${dashboard.name}`,
    `Sent: ${new Date().toISOString().slice(0, 10)}`,
    '',
    '── HIGHLIGHTS ──',
    '',
  ];
  for (const s of summaries) {
    lines.push(`• ${s.name}`);
    if (s.summary) lines.push(`  ${s.summary}`);
    lines.push('');
  }
  lines.push('');
  lines.push(`See the full live dashboard: ${link}`);
  lines.push('');
  lines.push('— Data Wiz');
  return lines.join('\n');
}

function htmlBody(report, dashboard, summaries, link) {
  const tileHtml = summaries.map(s => `
    <div style="margin: 16px 0; padding: 14px; border-left: 3px solid #E9A521; background: #faf7f2;">
      <div style="font-weight: 600; font-size: 14px; color: #15130F;">${escapeHtml(s.name)}</div>
      ${s.summary ? `<div style="margin-top: 4px; font-size: 13px; color: #605B51;">${escapeHtml(s.summary)}</div>` : ''}
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; color: #15130F;">
  <div style="border-bottom: 1px solid #E5E1D8; padding-bottom: 16px; margin-bottom: 24px;">
    <h1 style="font-size: 22px; margin: 0 0 4px; font-weight: 600;">${escapeHtml(report.name)}</h1>
    <p style="margin: 0; color: #605B51; font-size: 13px;">${escapeHtml(dashboard.name)} · ${new Date().toUTCString().slice(0, 16)}</p>
  </div>
  ${tileHtml}
  <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #E5E1D8;">
    <a href="${link}" style="display: inline-block; padding: 10px 20px; background: #E9A521; color: #0A0908; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">Open dashboard →</a>
  </div>
  <div style="margin-top: 24px; color: #8B8579; font-size: 11px;">
    Sent by Data Wiz · You're receiving this because someone scheduled this report for you.
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/**
 * Send a single report. Returns { ok, error? }.
 */
async function sendReport(report) {
  const send = loadMailer();
  if (!send) {
    return { ok: false, error: 'Mail transport not configured. Set SMTP_* env vars.' };
  }

  let email;
  try {
    email = await buildEmail(report);
  } catch (err) {
    return { ok: false, error: 'Failed to build email: ' + err.message };
  }
  if (!email) {
    return { ok: false, error: 'Dashboard or dataset not accessible' };
  }

  try {
    for (const recipient of report.recipients) {
      await send({ to: recipient, subject: email.subject, text: email.text, html: email.html });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * One tick of the scheduler — find due reports, send them.
 */
async function tick() {
  let due = [];
  try {
    due = scheduledReports.findDue();
  } catch (err) {
    console.error('[scheduler] findDue error:', err.message);
    return;
  }
  if (!due.length) return;

  console.log(`[scheduler] ${due.length} report(s) due`);
  for (const report of due) {
    const result = await sendReport(report);
    scheduledReports.markSent(report.id, result.ok, result.error);
    if (result.ok) {
      console.log(`[scheduler] sent ${report.id} → ${report.recipients.length} recipient(s)`);
    } else {
      console.warn(`[scheduler] failed ${report.id}: ${result.error}`);
    }
  }
}

function start() {
  if (timer) return;
  // Don't run on startup — wait for the first interval to avoid sending
  // a flood of "missed" reports if the server's been down.
  timer = setInterval(() => {
    tick().catch(err => console.error('[scheduler] tick error:', err));
  }, CHECK_INTERVAL_MS);
  console.log('[scheduler] started; checking every', CHECK_INTERVAL_MS / 60000, 'min');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, sendReport, _buildEmail: buildEmail };
