/**
 * Tests for v6.13 visualization depth:
 *   - Reference lines (avg, percentile, literal)
 *   - Reference bands
 *   - Dual axis routing
 *   - Trellis / small multiples
 */

const { describe, it, expect } = require('vitest');
const overlays = require('../utils/referenceOverlays');
const { buildChartFromSheet } = require('../utils/sheetSpecBuilder');

// ─── REFERENCE OVERLAYS UNIT TESTS ───────────────────────────────────────────

describe('referenceOverlays.computeReferenceValue', () => {
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  it('passes literal numbers through', () => {
    expect(overlays.computeReferenceValue(42, values)).toBe(42);
  });

  it('parses numeric strings', () => {
    expect(overlays.computeReferenceValue('42', values)).toBe(42);
    expect(overlays.computeReferenceValue('-3.5', values)).toBe(-3.5);
  });

  it('computes mean from "avg"', () => {
    expect(overlays.computeReferenceValue('avg', values)).toBe(55);
  });

  it('computes median from "median"', () => {
    expect(overlays.computeReferenceValue('median', values)).toBe(55);
  });

  it('computes p25, p75, p95', () => {
    expect(overlays.computeReferenceValue('p25', values)).toBeCloseTo(32.5, 1);
    expect(overlays.computeReferenceValue('p75', values)).toBeCloseTo(77.5, 1);
    expect(overlays.computeReferenceValue('p95', values)).toBeCloseTo(95.5, 1);
  });

  it('computes min and max', () => {
    expect(overlays.computeReferenceValue('min', values)).toBe(10);
    expect(overlays.computeReferenceValue('max', values)).toBe(100);
  });

  it('returns null for unknown keywords', () => {
    expect(overlays.computeReferenceValue('frobnicate', values)).toBe(null);
  });

  it('returns null for empty values', () => {
    expect(overlays.computeReferenceValue('avg', [])).toBe(null);
  });
});

describe('referenceOverlays.resolveReferenceLines', () => {
  const data = [{ y: 10 }, { y: 20 }, { y: 30 }, { y: 40 }, { y: 50 }];

  it('resolves multiple lines', () => {
    const result = overlays.resolveReferenceLines(
      [
        { label: 'Avg', value: 'avg', axis: 'y' },
        { label: 'Target', value: 100, axis: 'y' },
      ],
      data,
      'y'
    );
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe(30);
    expect(result[1].value).toBe(100);
  });

  it('drops lines with unresolvable values', () => {
    const result = overlays.resolveReferenceLines(
      [{ label: 'Bad', value: 'frobnicate', axis: 'y' }],
      data,
      'y'
    );
    expect(result).toEqual([]);
  });
});

describe('referenceOverlays.resolveReferenceBands', () => {
  const data = [{ y: 10 }, { y: 20 }, { y: 30 }, { y: 40 }, { y: 50 }];

  it('resolves bands and normalizes from < to', () => {
    const result = overlays.resolveReferenceBands(
      [{ label: 'IQR', from: 'p75', to: 'p25', axis: 'y' }], // intentionally swapped
      data,
      'y'
    );
    expect(result).toHaveLength(1);
    expect(result[0].from).toBeLessThan(result[0].to);
  });
});

// ─── PIPELINE INTEGRATION TESTS ──────────────────────────────────────────────

function makeDataset() {
  const data = [];
  for (let i = 0; i < 100; i++) {
    data.push({
      Region: ['East', 'West', 'North', 'South'][i % 4],
      Month: ['Jan', 'Feb', 'Mar'][i % 3],
      Sales: 100 + i * 5,
      Margin: 5 + (i % 30),
    });
  }
  return {
    data,
    analysis: {
      columns: [
        { name: 'Region', type: 'categorical' },
        { name: 'Month', type: 'categorical' },
        { name: 'Sales', type: 'numeric' },
        { name: 'Margin', type: 'numeric' },
      ],
    },
  };
}

describe('reference lines integration with chart pipeline', () => {
  it('attaches resolved lines to the chart spec', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Region', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      referenceLines: [{ label: 'Avg', value: 'avg', axis: 'y' }],
    }, ds);
    expect(r.spec.referenceLines).toBeDefined();
    expect(r.spec.referenceLines).toHaveLength(1);
    expect(typeof r.spec.referenceLines[0].value).toBe('number');
  });

  it('attaches reference bands too', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Region', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      referenceBands: [{ label: 'IQR', from: 'p25', to: 'p75', axis: 'y' }],
    }, ds);
    expect(r.spec.referenceBands).toBeDefined();
    expect(r.spec.referenceBands[0].from).toBeLessThan(r.spec.referenceBands[0].to);
  });
});

describe('dual axis routing', () => {
  it('routes to dual_axis when flag is set and there are 2 measures', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Region', type: 'categorical' }],
      rows: [
        { name: 'Sales', type: 'numeric', aggregation: 'sum' },
        { name: 'Margin', type: 'numeric', aggregation: 'avg' },
      ],
      dualAxis: true,
    }, ds);
    expect(r.spec.type).toBe('dual_axis');
    expect(r.spec.y).toBe('Sales');
    expect(r.spec.y2).toBe('Margin');
  });

  it('does NOT route to dual_axis with only 1 measure', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Region', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      dualAxis: true,
    }, ds);
    expect(r.spec.type).toBe('bar');
  });

  it('does NOT route to dual_axis without the flag', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Region', type: 'categorical' }],
      rows: [
        { name: 'Sales', type: 'numeric', aggregation: 'sum' },
        { name: 'Margin', type: 'numeric', aggregation: 'avg' },
      ],
      dualAxis: false,
    }, ds);
    expect(r.spec.type).toBe('grouped_bar_multi');     // existing multi-measure behavior
  });
});

describe('trellis / small multiples', () => {
  it('produces one facet per distinct value', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Month', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      trellis: { facetBy: 'Region' },
    }, ds);
    expect(r.spec.type).toBe('trellis');
    expect(r.spec.facets.length).toBe(4);     // 4 regions
    expect(r.spec.facets.every(f => f.spec.type === 'bar')).toBe(true);
  });

  it('caps at trellis.max', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Month', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      trellis: { facetBy: 'Region', max: 2 },
    }, ds);
    expect(r.spec.facets.length).toBe(2);
    expect(r.spec.truncated).toBe(true);
  });

  it('computes shared y-domain across facets', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Month', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      trellis: { facetBy: 'Region' },
    }, ds);
    expect(Array.isArray(r.spec.sharedYDomain)).toBe(true);
    expect(r.spec.sharedYDomain[0]).toBe(0);
    expect(r.spec.sharedYDomain[1]).toBeGreaterThan(0);
  });

  it('warns and skips when facet column does not exist', () => {
    const ds = makeDataset();
    const r = buildChartFromSheet({
      chartType: 'bar',
      columns: [{ name: 'Month', type: 'categorical' }],
      rows: [{ name: 'Sales', type: 'numeric', aggregation: 'sum' }],
      trellis: { facetBy: 'NonExistent' },
    }, ds);
    expect(r.warnings.some(w => w.includes('NonExistent'))).toBe(true);
    // Falls through to normal chart
    expect(r.spec.type).toBe('bar');
  });
});
