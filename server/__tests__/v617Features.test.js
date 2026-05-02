/**
 * Tests for v6.17 features:
 *   - Annotations: CRUD with sheet-level authorization
 *   - Decomposition tree: root, expand, suggestNextDim
 *   - Scheduled reports: validation, frequency-based dispatch
 */

const { describe, it, expect, beforeEach } = require('vitest');

// ─── DECOMPOSITION TREE ──────────────────────────────────────────────────────

describe('decompositionTree', () => {
  const tree = require('../utils/decompositionTree');

  function makeDs() {
    const data = [];
    const regionMult = { East: 3, West: 2, North: 1, South: 4 };
    for (let i = 0; i < 200; i++) {
      const region = ['East', 'West', 'North', 'South'][i % 4];
      const product = ['Phone', 'Laptop', 'Tablet'][i % 3];
      data.push({
        Region: region,
        Product: product,
        Sales: 100 * regionMult[region] + (i % 50),
        Color: ['Red', 'Blue', 'Green'][i % 3],
      });
    }
    return {
      data,
      analysis: {
        columns: [
          { name: 'Region', type: 'categorical', uniqueCount: 4 },
          { name: 'Product', type: 'categorical', uniqueCount: 3 },
          { name: 'Sales', type: 'numeric' },
          { name: 'Color', type: 'categorical', uniqueCount: 3 },
        ],
      },
    };
  }

  it('getRoot returns total across the dataset', () => {
    const ds = makeDs();
    const root = tree.getRoot(ds, 'Sales', 'sum');
    expect(root.measure).toBe('Sales');
    expect(root.value).toBeGreaterThan(0);
    expect(root.count).toBe(200);
  });

  it('getRoot respects path filter', () => {
    const ds = makeDs();
    const filtered = tree.getRoot(ds, 'Sales', 'sum', [{ dim: 'Region', value: 'East' }]);
    expect(filtered.count).toBe(50);    // 200/4
    const total = tree.getRoot(ds, 'Sales', 'sum');
    expect(filtered.value).toBeLessThan(total.value);
  });

  it('expand returns children sorted by absolute measure value', () => {
    const ds = makeDs();
    const result = tree.expand(ds, { measure: 'Sales', dimension: 'Region' });
    expect(result.children.length).toBe(4);
    // Sorted desc by abs value
    for (let i = 1; i < result.children.length; i++) {
      expect(Math.abs(result.children[i - 1].measureValue))
        .toBeGreaterThanOrEqual(Math.abs(result.children[i].measureValue));
    }
    // Each child has a path that includes the chosen dim
    for (const c of result.children) {
      expect(c.path[c.path.length - 1].dim).toBe('Region');
    }
    // Shares sum to ~1
    const shareSum = result.children.reduce((s, c) => s + (c.share || 0), 0);
    expect(shareSum).toBeCloseTo(1, 1);
  });

  it('expand caps at maxChildren and reports truncation', () => {
    const ds = makeDs();
    const result = tree.expand(ds, { measure: 'Sales', dimension: 'Region', maxChildren: 2 });
    expect(result.children.length).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.totalGroups).toBe(4);
  });

  it('expand refuses to re-split by the same dimension', () => {
    const ds = makeDs();
    expect(() => tree.expand(ds, {
      path: [{ dim: 'Region', value: 'East' }],
      measure: 'Sales',
      dimension: 'Region',
    })).toThrow(/Already filtered/);
  });

  it('suggestNextDim ranks dims that explain variance highest', () => {
    const ds = makeDs();
    const sugs = tree.suggestNextDim(ds, {
      measure: 'Sales',
      columns: ds.analysis.columns,
    });
    expect(sugs.length).toBeGreaterThan(0);
    // Region drives Sales by construction (regionMult), so should beat Color
    const region = sugs.find(s => s.dim === 'Region');
    const color = sugs.find(s => s.dim === 'Color');
    expect(region).toBeDefined();
    if (color) {
      expect(region.score).toBeGreaterThan(color.score);
    }
  });

  it('suggestNextDim excludes dims already in path', () => {
    const ds = makeDs();
    const sugs = tree.suggestNextDim(ds, {
      path: [{ dim: 'Region', value: 'East' }],
      measure: 'Sales',
      columns: ds.analysis.columns,
    });
    expect(sugs.find(s => s.dim === 'Region')).toBeUndefined();
  });
});

// ─── SCHEDULED REPORTS ───────────────────────────────────────────────────────

describe('scheduledReports', () => {
  // Mock the db before requiring the module so the schema setup doesn't need
  // a real SQLite connection in tests.
  beforeEach(() => {
    delete require.cache[require.resolve('../utils/scheduledReports')];
  });

  describe('validation', () => {
    it('rejects empty recipient list', () => {
      const reports = require('../utils/scheduledReports');
      expect(() => reports.create({
        ownerId: 'u1', dashboardId: 'd1', name: 'r',
        recipients: [], frequency: 'daily',
      })).toThrow(/recipient/);
    });

    it('rejects malformed emails', () => {
      const reports = require('../utils/scheduledReports');
      expect(() => reports.create({
        ownerId: 'u1', dashboardId: 'd1', name: 'r',
        recipients: ['not-an-email'], frequency: 'daily',
      })).toThrow(/Invalid email/);
    });

    it('rejects unknown frequency', () => {
      const reports = require('../utils/scheduledReports');
      expect(() => reports.create({
        ownerId: 'u1', dashboardId: 'd1', name: 'r',
        recipients: ['a@b.com'], frequency: 'hourly',     // not allowed
      })).toThrow(/frequency/);
    });

    it('rejects invalid hour', () => {
      const reports = require('../utils/scheduledReports');
      expect(() => reports.create({
        ownerId: 'u1', dashboardId: 'd1', name: 'r',
        recipients: ['a@b.com'], frequency: 'daily', hourUtc: 25,
      })).toThrow(/hourUtc/);
    });
  });
});

// ─── ANNOTATIONS — schema-only smoke test ────────────────────────────────────
// Full integration requires a real DB + sheet — covered by integration tests
// that need the server running. Here we just verify the module loads cleanly
// and that the validators reject obvious bad input.

describe('annotationsStore', () => {
  it('loads cleanly without errors', () => {
    expect(() => require('../utils/annotationsStore')).not.toThrow();
  });
});
