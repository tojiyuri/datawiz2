/**
 * Tests for jsonImporter — the v6.5 migration that pulls legacy JSON state
 * into SQLite. Has to handle malformed inputs (the bare-array shape that
 * caused the v6.4 save bug) gracefully without crashing the server start.
 */

const { describe, it, expect, beforeEach } = require('vitest');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const sheetStore = require('../utils/sheetStore');
const importer = require('../utils/jsonImporter');

const dataDir = path.join(process.env.DATAWIZ_TEST_DIR, '..');
// jsonImporter looks for files at server/data/*.json. Since tests run with
// DATAWIZ_TEST_DIR set, we have to write files relative to the importer's
// expected path. The importer hardcodes its DATA_DIR. So we test by writing
// directly to that path, then cleaning up.
const importerDataDir = path.join(__dirname, '../data');

function writeFile(name, content) {
  const fp = path.join(importerDataDir, name);
  fs.writeFileSync(fp, typeof content === 'string' ? content : JSON.stringify(content));
  return fp;
}

function findBackup(prefix) {
  return fs.readdirSync(importerDataDir).filter(f => f.startsWith(prefix) && f.includes('.imported-'));
}

beforeEach(() => {
  // Clear any leftover backups from previous tests
  fs.readdirSync(importerDataDir)
    .filter(f => f.includes('.imported-'))
    .forEach(f => fs.unlinkSync(path.join(importerDataDir, f)));
  // Clear DB tables
  const db = getDb();
  db.prepare('DELETE FROM sheets').run();
  db.prepare('DELETE FROM dashboards').run();
  db.prepare('DELETE FROM learning_weights').run();
  db.prepare('DELETE FROM learning_history').run();
});

describe('jsonImporter.importSheets', () => {
  it('imports legacy {sheets: [...]} shape', () => {
    writeFile('sheets.json', {
      version: '1.0',
      sheets: [
        { id: 'sh_legacy', datasetId: 'ds_old', name: 'Old Sheet', spec: { chartType: 'bar' }, createdAt: '2026-04-15T00:00:00.000Z', updatedAt: '2026-04-15T00:00:00.000Z' },
      ],
    });

    const count = importer.importSheets();
    expect(count).toBe(1);

    const sheets = sheetStore.listSheets('ds_old');
    expect(sheets.length).toBe(1);
    expect(sheets[0].name).toBe('Old Sheet');

    // Original file archived as .bak
    expect(fs.existsSync(path.join(importerDataDir, 'sheets.json'))).toBe(false);
    expect(findBackup('sheets.json').length).toBe(1);
  });

  it('handles bare-array shape (v6.4 bug) without crashing', () => {
    writeFile('sheets.json', '[]');
    const count = importer.importSheets();
    expect(count).toBe(0);
    // File should still be archived
    expect(findBackup('sheets.json').length).toBe(1);
  });

  it('handles malformed JSON without crashing', () => {
    writeFile('sheets.json', 'not valid json{{{');
    expect(() => importer.importSheets()).not.toThrow();
  });

  it('returns 0 when no file exists', () => {
    expect(importer.importSheets()).toBe(0);
  });

  it('skips sheets missing required fields (id, datasetId)', () => {
    writeFile('sheets.json', {
      sheets: [
        { id: 'sh_good', datasetId: 'ds_a', name: 'Good', spec: {} },
        { datasetId: 'ds_a', name: 'No ID' },     // missing id
        { id: 'sh_bad', name: 'No dataset' },     // missing datasetId
      ],
    });
    const count = importer.importSheets();
    expect(count).toBe(1);
  });
});

describe('jsonImporter.importDashboards', () => {
  it('imports legacy dashboards', () => {
    writeFile('dashboards.json', {
      dashboards: [
        { id: 'db_legacy', datasetId: 'ds_old', name: 'Legacy DB', tiles: [{ sheetId: 's1' }] },
      ],
    });
    const count = importer.importDashboards();
    expect(count).toBe(1);
    const dashboards = sheetStore.listDashboards('ds_old');
    expect(dashboards.length).toBe(1);
    expect(dashboards[0].tiles[0].sheetId).toBe('s1');
  });
});

describe('jsonImporter.importLearning', () => {
  it('imports weights and history', () => {
    writeFile('learning.json', {
      weights: { bar: 1.3, line: 0.7 },
      contextWeights: { 'num1-cat1': { bar: 1.5 } },
      history: [{ type: 'accept', chartType: 'bar', ctxKey: 'num1-cat1', timestamp: 1234 }],
      stats: { totalRecommendations: 100, totalAccepts: 25 },
    });
    const count = importer.importLearning();
    expect(count).toBeGreaterThanOrEqual(2); // weights imported

    const db = getDb();
    const bar = db.prepare('SELECT weight FROM learning_weights WHERE chart_type = ?').get('bar');
    expect(bar.weight).toBeCloseTo(1.3);
  });
});

describe('jsonImporter.importAll', () => {
  it('runs all importers without throwing on missing files', () => {
    expect(() => importer.importAll()).not.toThrow();
  });

  it('is idempotent — second call does not double-import', () => {
    writeFile('sheets.json', {
      sheets: [{ id: 'sh_idem', datasetId: 'ds', name: 'X', spec: {} }],
    });
    importer.importAll();
    importer.importAll();          // second call — files are already archived
    expect(sheetStore.listSheets('ds').length).toBe(1);
  });
});
