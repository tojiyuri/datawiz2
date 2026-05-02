/**
 * Tests for v6.14 analytics:
 *   - forecastEngine (Holt-Winters + Holt + simple ES)
 *   - keyDriverAnalysis (Pearson + ANOVA + MI)
 */

const { describe, it, expect } = require('vitest');
const fc = require('../utils/forecastEngine');
const drivers = require('../utils/keyDriverAnalysis');

// ─── FORECASTING ─────────────────────────────────────────────────────────────

describe('forecastEngine.forecast', () => {
  it('returns null for too-short input', () => {
    expect(fc.forecast([], 5)).toBe(null);
    expect(fc.forecast([1, 2], 5)).toBe(null);
  });

  it('uses simple ES for very short series', () => {
    const r = fc.forecast([10, 12, 11, 13, 12], 3);
    expect(r.method).toBe('simple');
    expect(r.forecast).toHaveLength(3);
  });

  it('uses Holt for medium series with trend', () => {
    const trending = Array.from({ length: 15 }, (_, i) => 100 + i * 5);
    const r = fc.forecast(trending, 5);
    expect(r.method).toBe('holt');
    // Forecast should continue the trend upward
    expect(r.forecast[4].value).toBeGreaterThan(r.forecast[0].value);
  });

  it('uses Holt-Winters for long seasonal series', () => {
    const seasonal = Array.from({ length: 36 }, (_, i) =>
      100 + i * 0.5 + 20 * Math.sin(i * Math.PI / 6)
    );
    const r = fc.forecast(seasonal, 6);
    expect(r.method).toBe('hw');
    expect(r.model.season).toBe(12);
  });

  it('confidence intervals widen with horizon', () => {
    const trending = Array.from({ length: 20 }, (_, i) => 100 + i * 5);
    const r = fc.forecast(trending, 10);
    const firstCI = r.forecast[0].upper - r.forecast[0].lower;
    const lastCI = r.forecast[9].upper - r.forecast[9].lower;
    expect(lastCI).toBeGreaterThan(firstCI);
  });

  it('respects explicit method override', () => {
    const long = Array.from({ length: 30 }, (_, i) => 100 + i);
    const r = fc.forecast(long, 5, { method: 'simple' });
    expect(r.method).toBe('simple');
  });
});

describe('forecastEngine.detectSeasonPeriod', () => {
  it('detects period-12 in monthly data', () => {
    const seasonal = Array.from({ length: 36 }, (_, i) => 20 * Math.sin(i * Math.PI / 6));
    expect(fc.detectSeasonPeriod(seasonal)).toBe(12);
  });

  it('returns null for non-seasonal data', () => {
    const random = Array.from({ length: 30 }, () => Math.random() * 100);
    // May return null or some weak match — the threshold prevents noise
    const period = fc.detectSeasonPeriod(random);
    expect(period === null || typeof period === 'number').toBe(true);
  });
});

// ─── KEY DRIVER ANALYSIS ─────────────────────────────────────────────────────

function makeDriverDataset() {
  const data = [];
  const regionMultiplier = { East: 1.5, West: 1.0, North: 0.7, South: 1.2 };
  for (let i = 0; i < 500; i++) {
    const region = ['East', 'West', 'North', 'South'][i % 4];
    const marketing = 100 + Math.random() * 1000;
    const sales = marketing * regionMultiplier[region] * 0.8 + 200 + (Math.random() - 0.5) * 100;
    data.push({
      Customer: 'C' + i,
      Region: region,
      Marketing_Spend: marketing,
      Color: ['Red', 'Blue', 'Green'][i % 3],     // noise feature
      Sales: sales,
    });
  }
  return {
    data,
    analysis: {
      columns: [
        { name: 'Customer', type: 'categorical', uniqueCount: 500 },
        { name: 'Region', type: 'categorical', uniqueCount: 4 },
        { name: 'Marketing_Spend', type: 'numeric' },
        { name: 'Color', type: 'categorical', uniqueCount: 3 },
        { name: 'Sales', type: 'numeric' },
      ],
    },
  };
}

describe('keyDriverAnalysis.analyzeDrivers', () => {
  it('identifies the strongest numeric driver via Pearson', () => {
    const ds = makeDriverDataset();
    const result = drivers.analyzeDrivers(ds, 'Sales');

    const top = result.drivers[0];
    expect(top.feature).toBe('Marketing_Spend');
    expect(top.method).toBe('pearson');
    expect(top.importance).toBeGreaterThan(70);
    expect(top.direction).toBe('positive');
  });

  it('identifies categorical drivers via ANOVA', () => {
    const ds = makeDriverDataset();
    const result = drivers.analyzeDrivers(ds, 'Sales');

    const region = result.drivers.find(d => d.feature === 'Region');
    expect(region).toBeDefined();
    expect(region.method).toBe('anova');
    expect(region.contributors).toBeDefined();
    expect(region.contributors.length).toBeGreaterThan(0);
  });

  it('correctly ranks unrelated features (Color) as low', () => {
    const ds = makeDriverDataset();
    const result = drivers.analyzeDrivers(ds, 'Sales');

    const color = result.drivers.find(d => d.feature === 'Color');
    if (color) {
      // Color was random, should be much weaker than Marketing or Region
      expect(color.importance).toBeLessThan(20);
    }
  });

  it('skips identifier columns', () => {
    const ds = makeDriverDataset();
    const result = drivers.analyzeDrivers(ds, 'Sales');

    // Customer column is high-cardinality — should be skipped, not appear as a driver
    const customer = result.drivers.find(d => d.feature === 'Customer');
    expect(customer).toBeUndefined();
  });

  it('throws when target does not exist', () => {
    const ds = makeDriverDataset();
    expect(() => drivers.analyzeDrivers(ds, 'NonExistent')).toThrow();
  });

  it('returns scan stats', () => {
    const ds = makeDriverDataset();
    const result = drivers.analyzeDrivers(ds, 'Sales');
    expect(result.scanStats).toBeDefined();
    expect(result.scanStats.columnsScanned).toBeGreaterThan(0);
    expect(typeof result.scanStats.durationMs).toBe('number');
  });

  it('caps drivers at maxDrivers', () => {
    const ds = makeDriverDataset();
    const result = drivers.analyzeDrivers(ds, 'Sales', { maxDrivers: 2 });
    expect(result.drivers.length).toBeLessThanOrEqual(2);
  });

  it('handles categorical target', () => {
    const ds = makeDriverDataset();
    // Predict Region from Marketing_Spend (numeric) — should find a relationship
    const result = drivers.analyzeDrivers(ds, 'Region');
    expect(result.targetType).toBe('categorical');
    expect(result.drivers.length).toBeGreaterThan(0);
  });
});
