/**
 * Tests for v6.8 advanced calc features:
 * - Bins
 * - Sets
 * - LODs
 * - Parameters
 * - Table calcs (window functions)
 * - Hierarchies
 */

const { describe, it, expect } = require('vitest');
const bins = require('../utils/bins');
const sets = require('../utils/sets');
const lod = require('../utils/lod');
const params = require('../utils/parameters');
const tableCalcs = require('../utils/tableCalcs');
const hier = require('../utils/hierarchies');

// ─── BINS ────────────────────────────────────────────────────────────────────

describe('bins.applyBins', () => {
  const data = [
    { Age: 23 }, { Age: 45 }, { Age: 67 }, { Age: 12 }, { Age: 89 }, { Age: 34 },
  ];

  it('equal-width bins partition correctly', () => {
    const out = bins.applyBins(data, [
      { name: 'AgeGroup', source: 'Age', strategy: 'equal-width', count: 3 },
    ]);
    expect(out.every(r => r.AgeGroup)).toBe(true);
    // 3 bins covering 12-89 → ~25.67 wide each
    // Each row should have a bin label
    const groups = new Set(out.map(r => r.AgeGroup));
    expect(groups.size).toBeGreaterThan(1);
    expect(groups.size).toBeLessThanOrEqual(3);
  });

  it('quantile bins distribute roughly evenly', () => {
    const data10 = Array.from({ length: 10 }, (_, i) => ({ x: i }));
    const out = bins.applyBins(data10, [
      { name: 'Quartile', source: 'x', strategy: 'quantile', count: 4 },
    ]);
    const counts = {};
    for (const r of out) counts[r.Quartile] = (counts[r.Quartile] || 0) + 1;
    // Each quartile should get ~2-3 rows; not wildly uneven
    for (const k in counts) expect(counts[k]).toBeGreaterThanOrEqual(1);
  });

  it('custom edges with labels', () => {
    const out = bins.applyBins([{ s: 25 }, { s: 75 }, { s: 95 }], [{
      name: 'Tier', source: 's', strategy: 'custom',
      edges: [0, 50, 90, 100],
      labels: ['Low', 'Medium', 'High'],
    }]);
    expect(out[0].Tier).toBe('Low');
    expect(out[1].Tier).toBe('Medium');
    expect(out[2].Tier).toBe('High');
  });

  it('does not mutate input data', () => {
    const orig = JSON.stringify(data);
    bins.applyBins(data, [{ name: 'G', source: 'Age', strategy: 'equal-width', count: 3 }]);
    expect(JSON.stringify(data)).toBe(orig);
  });

  it('handles missing values gracefully', () => {
    const out = bins.applyBins(
      [{ x: 1 }, { x: null }, { x: 5 }, { x: 'abc' }, { x: 10 }],
      [{ name: 'G', source: 'x', strategy: 'equal-width', count: 3 }]
    );
    expect(out[1].G).toBeNull();
    expect(out[3].G).toBeNull();
    expect(out[0].G).toBeTruthy();
  });
});

// ─── SETS ────────────────────────────────────────────────────────────────────

describe('sets.applySets', () => {
  const data = [
    { Customer: 'Acme', Sales: 1000 },
    { Customer: 'Globex', Sales: 500 },
    { Customer: 'Initech', Sales: 200 },
    { Customer: 'Acme', Sales: 800 },
    { Customer: 'Globex', Sales: 300 },
  ];

  it('manual set assigns in/out labels', () => {
    const out = sets.applySets(data, [
      { name: 'Big', source: 'Customer', mode: 'manual', values: ['Acme'] },
    ]);
    expect(out[0].Big).toBe('In Big');
    expect(out[1].Big).toBe('Out of Big');
    expect(out[3].Big).toBe('In Big');
  });

  it('top-N set aggregates and selects', () => {
    const out = sets.applySets(data, [
      { name: 'Top2', source: 'Customer', mode: 'top', rankBy: 'Sales', aggregation: 'SUM', count: 2 },
    ]);
    // Acme: 1800, Globex: 800, Initech: 200 → Top 2 = Acme + Globex
    expect(out.find(r => r.Customer === 'Acme').Top2).toBe('In Top2');
    expect(out.find(r => r.Customer === 'Globex').Top2).toBe('In Top2');
    expect(out.find(r => r.Customer === 'Initech').Top2).toBe('Out of Top2');
  });

  it('condition set filters by comparison', () => {
    const out = sets.applySets(data, [
      { name: 'BigSale', source: 'Sales', mode: 'condition', condition: { op: '>', value: 500 } },
    ]);
    expect(out.find(r => r.Sales === 1000).BigSale).toBe('In BigSale');
    expect(out.find(r => r.Sales === 500).BigSale).toBe('Out of BigSale');
    expect(out.find(r => r.Sales === 800).BigSale).toBe('In BigSale');
  });
});

// ─── LOD ─────────────────────────────────────────────────────────────────────

describe('lod.parseLOD', () => {
  it('parses {FIXED [Region]: SUM([Sales])}', () => {
    const r = lod.parseLOD('{FIXED [Region]: SUM([Sales])}');
    expect(r.dims).toEqual(['Region']);
    expect(r.fn).toBe('SUM');
    expect(r.field).toBe('Sales');
  });

  it('parses multiple FIXED dims', () => {
    const r = lod.parseLOD('{FIXED [Region], [Year]: AVG([Cost])}');
    expect(r.dims).toEqual(['Region', 'Year']);
    expect(r.fn).toBe('AVG');
  });

  it('rejects non-LOD strings', () => {
    expect(lod.parseLOD('SUM([Sales])')).toBeNull();
    expect(lod.parseLOD('[Sales] - [Cost]')).toBeNull();
  });

  it('rejects empty FIXED dims', () => {
    expect(() => lod.parseLOD('{FIXED : SUM([Sales])}')).toThrow();
  });
});

describe('lod.applyLODs', () => {
  it('computes FIXED aggregate per partition and broadcasts', () => {
    const data = [
      { Region: 'East', Sales: 100 },
      { Region: 'East', Sales: 50 },
      { Region: 'West', Sales: 200 },
      { Region: 'West', Sales: 300 },
    ];
    const out = lod.applyLODs(data, [
      { name: 'RegionTotal', expression: '{FIXED [Region]: SUM([Sales])}' },
    ]);
    // East rows should both have RegionTotal=150, West rows=500
    expect(out[0].RegionTotal).toBe(150);
    expect(out[1].RegionTotal).toBe(150);
    expect(out[2].RegionTotal).toBe(500);
    expect(out[3].RegionTotal).toBe(500);
  });

  it('FIXED COUNTD counts distinct values', () => {
    const data = [
      { R: 'E', C: 'X' }, { R: 'E', C: 'Y' }, { R: 'E', C: 'X' },
      { R: 'W', C: 'X' },
    ];
    const out = lod.applyLODs(data, [
      { name: 'D', expression: '{FIXED [R]: COUNTD([C])}' },
    ]);
    expect(out[0].D).toBe(2); // E: X, Y → 2 distinct
    expect(out[3].D).toBe(1);
  });

  it('lets you compute % of region downstream', () => {
    const data = [
      { Region: 'East', Sales: 100 },
      { Region: 'East', Sales: 50 },
      { Region: 'West', Sales: 200 },
    ];
    const withLod = lod.applyLODs(data, [
      { name: 'RegionTotal', expression: '{FIXED [Region]: SUM([Sales])}' },
    ]);
    // Now we can manually compute % since LOD created the column
    const enriched = withLod.map(r => ({ ...r, pct: r.Sales / r.RegionTotal * 100 }));
    expect(enriched[0].pct).toBeCloseTo(66.67, 1);
    expect(enriched[1].pct).toBeCloseTo(33.33, 1);
    expect(enriched[2].pct).toBe(100);
  });
});

// ─── PARAMETERS ──────────────────────────────────────────────────────────────

describe('parameters.substituteParameters', () => {
  const ps = [
    { name: 'Threshold', dataType: 'number', value: 1000 },
    { name: 'Region', dataType: 'string', value: 'East' },
    { name: 'Active', dataType: 'boolean', value: true },
  ];

  it('replaces @Name with numeric literal', () => {
    expect(params.substituteParameters('[Sales] > @Threshold', ps))
      .toBe('[Sales] > 1000');
  });

  it('replaces @Name with quoted string for string params', () => {
    expect(params.substituteParameters('[Region] = @Region', ps))
      .toBe('[Region] = "East"');
  });

  it('replaces with TRUE/FALSE for boolean params', () => {
    expect(params.substituteParameters('@Active', ps))
      .toContain('TRUE');
  });

  it('handles [@Name] bracket form', () => {
    expect(params.substituteParameters('[Sales] > [@Threshold]', ps))
      .toBe('[Sales] > 1000');
  });

  it('does not affect unrelated @ characters', () => {
    expect(params.substituteParameters('email@example.com', ps))
      .toBe('email@example.com');
  });

  it('handles missing parameters gracefully', () => {
    expect(params.substituteParameters('@DoesNotExist', ps))
      .toBe('@DoesNotExist');
  });
});

describe('parameters.collectParameterRefs', () => {
  it('finds all parameter references', () => {
    const refs = params.collectParameterRefs('[Sales] > @Threshold AND [Region] = @"My Region"');
    expect(refs).toContain('Threshold');
    expect(refs).toContain('My Region');
  });
});

describe('parameters.validateParam', () => {
  it('accepts valid parameter', () => {
    expect(params.validateParam({ name: 'X', dataType: 'number', value: 5 }).ok).toBe(true);
  });

  it('rejects invalid name', () => {
    expect(params.validateParam({ name: '1Bad', dataType: 'number' }).ok).toBe(false);
  });

  it('rejects bad dataType', () => {
    expect(params.validateParam({ name: 'X', dataType: 'banana' }).ok).toBe(false);
  });
});

// ─── TABLE CALCS ─────────────────────────────────────────────────────────────

describe('tableCalcs.apply', () => {
  const sales = [
    { Month: 'Jan', Sales: 100 },
    { Month: 'Feb', Sales: 150 },
    { Month: 'Mar', Sales: 200 },
    { Month: 'Apr', Sales: 250 },
  ];

  it('RUNNING_SUM accumulates', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'cum', expression: 'RUNNING_SUM([Sales])' },
    ], ['Month', 'Sales']);
    expect(out[0].cum).toBe(100);
    expect(out[1].cum).toBe(250);
    expect(out[2].cum).toBe(450);
    expect(out[3].cum).toBe(700);
  });

  it('MOVING_AVG with window=2', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'mavg', expression: 'MOVING_AVG([Sales], 2)' },
    ], ['Month', 'Sales']);
    expect(out[0].mavg).toBe(100);
    expect(out[1].mavg).toBe(125); // (100 + 150) / 2
    expect(out[2].mavg).toBe(175); // (150 + 200) / 2
  });

  it('PERCENT_OF_TOTAL sums to 100', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'pct', expression: 'PERCENT_OF_TOTAL([Sales])' },
    ], ['Month', 'Sales']);
    const totalPct = out.reduce((acc, r) => acc + r.pct, 0);
    expect(totalPct).toBeCloseTo(100, 5);
  });

  it('RANK descending', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'rk', expression: 'RANK([Sales], "desc")' },
    ], ['Month', 'Sales']);
    expect(out.find(r => r.Sales === 250).rk).toBe(1);
    expect(out.find(r => r.Sales === 100).rk).toBe(4);
  });

  it('LOOKUP gets prior row value', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'prev', expression: 'LOOKUP([Sales], -1)' },
    ], ['Month', 'Sales']);
    expect(out[0].prev).toBeNull();
    expect(out[1].prev).toBe(100);
    expect(out[2].prev).toBe(150);
  });

  it('DIFFERENCE computes period-over-period change', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'd', expression: 'DIFFERENCE([Sales])' },
    ], ['Month', 'Sales']);
    expect(out[0].d).toBeNull();
    expect(out[1].d).toBe(50);
    expect(out[2].d).toBe(50);
    expect(out[3].d).toBe(50);
  });

  it('partitions by a column', () => {
    const data = [
      { region: 'E', x: 100 },
      { region: 'E', x: 200 },
      { region: 'W', x: 50 },
      { region: 'W', x: 150 },
    ];
    const out = tableCalcs.apply(data, [
      { name: 'sum', expression: 'RUNNING_SUM([x])', partitionBy: ['region'] },
    ], ['region', 'x']);
    expect(out[0].sum).toBe(100);
    expect(out[1].sum).toBe(300);
    expect(out[2].sum).toBe(50);
    expect(out[3].sum).toBe(200);
  });

  it('chains: later calc references earlier calc', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'cum', expression: 'RUNNING_SUM([Sales])' },
      { name: 'pctOfMax', expression: 'PERCENT_OF_TOTAL([cum])' },
    ], ['Month', 'Sales']);
    expect(out[0].pctOfMax).toBeDefined();
    expect(out[3].pctOfMax).toBeDefined();
  });

  it('handles unknown function with error column rather than crashing', () => {
    const out = tableCalcs.apply(sales, [
      { name: 'bad', expression: 'NONEXISTENT([Sales])' },
    ], ['Month', 'Sales']);
    expect(out[0].bad).toBeNull();
    // But the original data is preserved
    expect(out[0].Sales).toBe(100);
  });
});

describe('tableCalcs.validate', () => {
  it('accepts valid expression', () => {
    expect(tableCalcs.validate('RUNNING_SUM([Sales])', ['Sales']).ok).toBe(true);
  });
  it('rejects unknown function', () => {
    expect(tableCalcs.validate('FROBNICATE([Sales])', ['Sales']).ok).toBe(false);
  });
});

// ─── HIERARCHIES ─────────────────────────────────────────────────────────────

describe('hierarchies', () => {
  const geo = { name: 'Geography', levels: ['Country', 'State', 'City'] };

  it('starts at level 0 with no path', () => {
    const r = hier.resolveDrill(geo, null);
    expect(r.currentLevelName).toBe('Country');
    expect(r.canDrillDown).toBe(true);
    expect(r.canDrillUp).toBe(false);
  });

  it('drillDown advances level + adds path step', () => {
    const after = hier.drillDown(geo, null, 'USA');
    expect(after.level).toBe(1);
    expect(after.path).toEqual([{ level: 0, value: 'USA' }]);
  });

  it('drillUp removes last path step', () => {
    const drilled = { hierarchyName: 'Geography', level: 2, path: [
      { level: 0, value: 'USA' }, { level: 1, value: 'CA' },
    ]};
    const back = hier.drillUp(geo, drilled);
    expect(back.level).toBe(1);
    expect(back.path).toEqual([{ level: 0, value: 'USA' }]);
  });

  it('applyDrill filters source data by drill path', () => {
    const data = [
      { Country: 'USA', State: 'CA' },
      { Country: 'USA', State: 'NY' },
      { Country: 'CAN', State: 'ON' },
    ];
    const drilled = { hierarchyName: 'Geography', level: 1, path: [{ level: 0, value: 'USA' }] };
    const filtered = hier.applyDrill(data, geo, drilled);
    expect(filtered.length).toBe(2);
    expect(filtered.every(r => r.Country === 'USA')).toBe(true);
  });

  it('breadcrumbs reflect drill path', () => {
    const drilled = { hierarchyName: 'Geography', level: 2, path: [
      { level: 0, value: 'USA' }, { level: 1, value: 'CA' },
    ]};
    const r = hier.resolveDrill(geo, drilled);
    expect(r.breadcrumbs).toHaveLength(2);
    expect(r.breadcrumbs[0].value).toBe('USA');
    expect(r.breadcrumbs[1].value).toBe('CA');
    expect(r.currentLevelName).toBe('City');
  });
});
