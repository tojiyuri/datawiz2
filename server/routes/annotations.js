/**
 * Annotation endpoints.
 *
 *   GET    /api/annotations/sheet/:sheetId    list all annotations for a sheet
 *   POST   /api/annotations                   create
 *   PATCH  /api/annotations/:id               update
 *   DELETE /api/annotations/:id               delete
 *
 * All endpoints require auth and enforce sheet-level authorization
 * (you can't access annotations on a sheet you can't see).
 */

const express = require('express');
const annotations = require('../utils/annotationsStore');

const router = express.Router();

router.get('/sheet/:sheetId', (req, res) => {
  try {
    const list = annotations.listForSheet(req.params.sheetId, req.user?.id);
    res.json({ annotations: list });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { sheetId, xValue, yValue, seriesKey, text, color } = req.body || {};
    const ann = annotations.create({
      sheetId, userId: req.user?.id,
      xValue, yValue, seriesKey, text, color,
    });
    res.status(201).json({ annotation: ann });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const ann = annotations.update(req.params.id, req.user?.id, req.body || {});
    res.json({ annotation: ann });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const ok = annotations.remove(req.params.id, req.user?.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
