/**
 * Tests for the auto-visualization pipeline:
 *   - autoDashboard: blueprint generation
 *   - statInsights: stat-driven insight generation
 *   - autoExplore: ranked finding discovery
 */

const { describe, it, expect } = require('vitest');
const autoDashboard = require('../utils/autoDashboard');
const statInsights = require('../utils/statInsights');
const autoExplore = require('../utils/autoExplore');

// ─── autoDashboard ──────────────────────────────────────────────────────────

describe('autoDashboard.generate', () => {
  it('returns empty array when no columns', () => {
    expect(autoDashboard.generate({ analysis: { columns: [] } })).toEqual([]);
  });

  it('picks revenue-named columns as primary measure', () => {
    const m = autoDashboard.pickPrimaryMeasure([
      { name: 'OrderId', type: 'numeric', stats: { range: 1000 } },
      { name: 'Revenue', type: 'numeric', stats: { range: 50000 } },
      { name: 'Quantity', type: 'numeric', stats: { range: 100 } },
    ]);
    expect(m.name).toBe('Revenue');
  });

  it('prefers mid-cardinality dimensions', () => {
    const d = autoDashboard.pickPrimaryDimension([
      { name: 'CustomerId', type: 'categorical', uniqueCount: 5000 },
      { name: 'Region', type: 'categorical', uniqueCount: 5 },
      { name: 'IsActive', type: 'categorical', uniqueCount: 2 },
    ]);
    expect(d.name).toBe('Region');
  });

  it('produces 4-6 blueprints for a typical sales dataset', () => {
    const blueprints = autoDashboard.generate({
      analysis: {
        columns: [
          { name: 'OrderDate', type: 'temporal', subtype: 'date' },
          { name: 'Region', type: 'categorical', uniqueCount: 4 },
          { name: 'Customer', type: 'categorical', uniqueCount: 50 },
          { name: 'Sales', type: 'numeric', stats: { range: 5000 } },
          { name: 'Cost', type: 'numeric', stats: { range: 3000 } },
        ],
      },
    });
    expect(blueprints.length).toBeGreaterThanOrEqual(4);
    expect(blueprints.length).toBeLessThanOrEqual(6);
    // Should include at least KPI, time trend, and breakdown
    const focuses = blueprints.map(b => b.insightFocus);
    expect(focuses).toContain('kpi');
    expect(focuses).toContain('trend');
  });

  it('skips trend chart when no date column', () => {
    const blueprints = autoDashboard.generate({
      analysis: {
        columns: [
          { name: 'Region', type: 'categorical', uniqueCount: 4 },
          { name: 'Sales', type: 'numeric', stats: { range: 5000 } },
        ],
      },
    });
    expect(blueprints.find(b => b.insightFocus === 'trend')).toBeUndefined();
  });

  it('returns empty when no measures available', () => {
    const blueprints = autoDashboard.generate({
      analysis: {
        columns: [
          { name: 'Region', type: 'categorical', uniqueCount: 4 },
          { name: 'Customer', type: 'categorical', uniqueCount: 50 },
        ],
      },
    });
    expect(blueprints.length).toBe(0);
  });
});

// ─── statInsights ───────────────────────────────────────────────────────────

describe('statInsights.distributionInsight', () => {
  it('flags dominant category', () => {
    const r = statInsights._distributionInsight({
      chartData: [
        { Region: 'East', Sales: 6000 },
        { Region: 'West', Sales: 1500 },
        { Region: 'North', Sales: 1500 },
        { Region: 'South', Sales: 1000 },
      ],
      dimKey: 'Region',
      valueKey: 'Sales',
    });
    expect(r.headline).toContain('East');
    expect(r.headline).toContain('60.0%');
  });

  it('returns top-3 share when no single dominator', () => {
    const r = statInsights._distributionInsight({
      chartData: Array.from({ length: 10 }, (_, i) => ({ City: `C${i}`, Sales: 100 - i * 5 })),
      dimKey: 'City',
      valueKey: 'Sales',
    });
    // None over 40%, so falls back to top-3
    expect(r.headline.toLowerCase()).toContain('top 3');
  });
});

describe('statInsights.trendInsight', () => {
  it('detects upward trend with magnitude', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ Month: `2024-${i+1}`, Sales: 100 + i * 20 }));
    const r = statInsights._trendInsight({ chartData: data, dateKey: 'Month', valueKey: 'Sales' });
    expect(r.statistic.direction).toBe('rising');
    expect(r.statistic.r2).toBeGreaterThan(0.95);
    expect(r.statistic.pctChange).toBeGreaterThan(100);
  });

  it('detects flat trend', () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ Month: `2024-${i+1}`, Sales: 100 + (Math.random() - 0.5) }));
    const r = statInsights._trendInsight({ chartData: data, dateKey: 'Month', valueKey: 'Sales' });
    expect(r.statistic.direction).toBe('flat');
  });

  it('returns null with too few points', () => {
    const r = statInsights._trendInsight({
      chartData: [{ x: 1, y: 5 }, { x: 2, y: 10 }],
      dateKey: 'x',
      valueKey: 'y',
    });
    expect(r).toBeNull();
  });
});

describe('statInsights.correlationInsight', () => {
  it('detects strong positive correlation', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ x: i, y: i * 2 + Math.random() }));
    const r = statInsights._correlationInsight({ chartData: data, xKey: 'x', yKey: 'y' });
    expect(r.statistic.r).toBeGreaterThan(0.9);
    expect(r.statistic.strength).toBe('strong');
    expect(r.statistic.direction).toBe('positive');
  });

  it('detects strong negative correlation', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ x: i, y: -i * 2 + Math.random() }));
    const r = statInsights._correlationInsight({ chartData: data, xKey: 'x', yKey: 'y' });
    expect(r.statistic.r).toBeLessThan(-0.9);
    expect(r.statistic.direction).toBe('negative');
  });

  it('flags lack of relationship', () => {
    // Random uncorrelated data
    const data = Array.from({ length: 50 }, () => ({ x: Math.random() * 100, y: Math.random() * 100 }));
    const r = statInsights._correlationInsight({ chartData: data, xKey: 'x', yKey: 'y' });
    expect(Math.abs(r.statistic.r)).toBeLessThan(0.4);
  });
});

describe('statInsights.spreadInsight', () => {
  it('reports skewed distribution with outliers', () => {
    const r = statInsights._spreadInsight({
      valueKey: 'Income',
      columnStats: {
        median: 50000, mean: 75000, stdDev: 30000,
        skewness: 2.1, outlierCount: 8, count: 100,
        iqr: 35000, q1: 35000, q3: 70000,
      },
    });
    expect(r.headline).toContain('right-skewed');
    expect(r.headline).toContain('outlier');
    expect(r.severity).toBe('notable');
  });

  it('reports symmetric without outliers', () => {
    const r = statInsights._spreadInsight({
      valueKey: 'Score',
      columnStats: {
        median: 75, mean: 75, stdDev: 10,
        skewness: 0.05, outlierCount: 0, count: 100,
        iqr: 14, q1: 68, q3: 82,
      },
    });
    expect(r.headline).toContain('symmetric');
    expect(r.headline).not.toContain('outlier');
  });
});

// ─── autoExplore ────────────────────────────────────────────────────────────

describe('autoExplore.explore', () => {
  it('returns empty for empty dataset', () => {
    const r = autoExplore.explore({ data: [], analysis: { columns: [] } });
    expect(r.findings).toEqual([]);
  });

  it('finds correlations between numeric columns', () => {
    // Strongly correlated x and y
    const data = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 1.5, z: Math.random() }));
    const r = autoExplore.explore({
      data,
      analysis: {
        columns: [
          { name: 'x', type: 'numeric', stats: { range: 49 } },
          { name: 'y', type: 'numeric', stats: { range: 73.5 } },
          { name: 'z', type: 'numeric', stats: { range: 1 } },
        ],
      },
    }, { maxFindings: 5 });
    const corr = r.findings.find(f => f.type === 'correlation');
    expect(corr).toBeDefined();
    expect(corr.evidence.r).toBeGreaterThan(0.9);
  });

  it('finds trends on time-series data', () => {
    const data = Array.from({ length: 30 }, (_, i) => ({
      Date: new Date(2024, 0, 1 + i).toISOString().slice(0, 10),
      Sales: 100 + i * 10 + Math.random() * 5,
    }));
    const r = autoExplore.explore({
      data,
      analysis: {
        columns: [
          { name: 'Date', type: 'temporal', subtype: 'date' },
          { name: 'Sales', type: 'numeric', stats: { range: 240 } },
        ],
      },
    });
    const trend = r.findings.find(f => f.type === 'trend');
    expect(trend).toBeDefined();
    expect(trend.evidence.direction).toBe('increasing');
  });

  it('caps findings at maxFindings', () => {
    const cols = ['a','b','c','d','e','f'].map(n => ({ name: n, type: 'numeric', stats: { range: 100 } }));
    const data = Array.from({ length: 50 }, (_, i) => Object.fromEntries(cols.map(c => [c.name, i + Math.random()])));
    const r = autoExplore.explore({ data, analysis: { columns: cols } }, { maxFindings: 3 });
    expect(r.findings.length).toBeLessThanOrEqual(3);
  });

  it('every finding has chartSpec ready to render', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 1.5 }));
    const r = autoExplore.explore({
      data,
      analysis: {
        columns: [
          { name: 'x', type: 'numeric', stats: { range: 49 } },
          { name: 'y', type: 'numeric', stats: { range: 73.5 } },
        ],
      },
    });
    for (const f of r.findings) {
      expect(f.chartSpec).toBeDefined();
      expect(f.chartSpec.chartType).toBeDefined();
    }
  });

  it('returns scan stats', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 1.5 }));
    const r = autoExplore.explore({
      data,
      analysis: {
        columns: [
          { name: 'x', type: 'numeric', stats: { range: 49 } },
          { name: 'y', type: 'numeric', stats: { range: 73.5 } },
        ],
      },
    });
    expect(r.scanStats).toBeDefined();
    expect(r.scanStats.columnsScanned).toBeGreaterThan(0);
    expect(typeof r.scanStats.durationMs).toBe('number');
  });
});
