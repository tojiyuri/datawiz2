/**
 * Scheduled report endpoints.
 *
 *   GET    /api/reports            list my reports
 *   POST   /api/reports            create a report
 *   GET    /api/reports/:id        get one
 *   PATCH  /api/reports/:id        update
 *   DELETE /api/reports/:id        delete
 *   POST   /api/reports/:id/test   send the report immediately to verify
 *                                   delivery (rate-limited so this can't be
 *                                   used as a free email blaster)
 */

const express = require('express');
const reports = require('../utils/scheduledReports');
const scheduler = require('../utils/reportScheduler');
const { perUserRateLimit } = require('../middleware/perUserRateLimit');

const router = express.Router();

// Test sends are heavily rate-limited per user — emails are expensive and
// could be abused as a spam channel.
const testSendLimit = perUserRateLimit({
  capacity: 3,
  refillPerSec: 3 / (60 * 60),    // 3 per hour
  name: 'report-test-send',
});

router.get('/', (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
  res.json({ reports: reports.listForOwner(req.user.id) });
});

router.post('/', (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
    const created = reports.create({ ownerId: req.user.id, ...req.body });
    res.status(201).json({ report: created });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
  const r = reports.get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json({ report: r });
});

router.patch('/:id', (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
    const r = reports.update(req.params.id, req.user.id, req.body || {});
    res.json({ report: r });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
  const ok = reports.remove(req.params.id, req.user.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

router.post('/:id/test', testSendLimit, async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Auth required' });
    const r = reports.get(req.params.id, req.user.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const result = await scheduler.sendReport(r);
    if (!result.ok) {
      return res.status(500).json({ error: result.error });
    }
    res.json({ sent: true, recipients: r.recipients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
