/**
 * Tests for datasetOperations (union and join).
 *
 * Joins are the trickiest logic in the codebase — there was a real bug in v6.4
 * where left joins dropped unmatched rows. These tests pin down all four join
 * types and the three union modes so that bug class can't come back silently.
 */

const { describe, it, expect } = require('vitest');
const { unionDatasets, joinDatasets } = require('../utils/datasetOperations');

const customers = {
  fileName: 'customers.csv',
  data: [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Carol' },
  ],
};

const orders = {
  fileName: 'orders.csv',
  data: [
    { customer_id: 1, amount: 100 },
    { customer_id: 1, amount: 50 },
    { customer_id: 2, amount: 200 },
    { customer_id: 99, amount: 999 },
  ],
};

describe('joinDatasets', () => {
  it('inner join: only matched rows on both sides', () => {
    const r = joinDatasets(customers, orders, {
      leftKey: 'id', rightKey: 'customer_id', type: 'inner',
    });
    // Alice has 2 orders, Bob has 1, Carol unmatched, customer_id=99 unmatched
    expect(r.rows.length).toBe(3);
    const names = r.rows.map(x => x.name).sort();
    expect(names).toEqual(['Alice', 'Alice', 'Bob']);
  });

  it('left join: keeps all left rows even when unmatched', () => {
    const r = joinDatasets(customers, orders, {
      leftKey: 'id', rightKey: 'customer_id', type: 'left',
    });
    expect(r.rows.length).toBe(4);
    // Carol should be present with no order amount
    const carol = r.rows.find(x => x.name === 'Carol');
    expect(carol).toBeDefined();
    expect(carol.amount).toBeUndefined();
  });

  it('right join: keeps all right rows even when unmatched', () => {
    const r = joinDatasets(customers, orders, {
      leftKey: 'id', rightKey: 'customer_id', type: 'right',
    });
    expect(r.rows.length).toBe(4);
    // The unmatched customer_id=99 row should be present
    const unmatched = r.rows.find(x => x.customer_id === 99);
    expect(unmatched).toBeDefined();
    expect(unmatched.name).toBeUndefined();
  });

  it('full outer join: every row from both sides', () => {
    const r = joinDatasets(customers, orders, {
      leftKey: 'id', rightKey: 'customer_id', type: 'full',
    });
    // Alice×2 + Bob + Carol(unmatched) + customer_id=99(unmatched) = 5
    expect(r.rows.length).toBe(5);
  });

  it('errors on missing key column', () => {
    expect(() => joinDatasets(customers, orders, {
      leftKey: 'nonexistent', rightKey: 'customer_id', type: 'inner',
    })).toThrow(/no column "nonexistent"/);
  });

  it('errors on invalid join type', () => {
    expect(() => joinDatasets(customers, orders, {
      leftKey: 'id', rightKey: 'customer_id', type: 'cross',
    })).toThrow(/invalid join type/i);
  });

  it('handles null keys without crashing', () => {
    const a = { data: [{ id: 1, x: 'a' }, { id: null, x: 'b' }] };
    const b = { data: [{ id: 1, y: 'A' }, { id: null, y: 'B' }] };
    const r = joinDatasets(a, b, { leftKey: 'id', rightKey: 'id', type: 'inner' });
    // Only the id=1 row should match — null keys never join
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].x).toBe('a');
  });

  it('produces 1 row per match for one-to-many', () => {
    // Alice has 2 orders → 2 rows in inner join
    const r = joinDatasets(customers, orders, {
      leftKey: 'id', rightKey: 'customer_id', type: 'inner',
    });
    const aliceRows = r.rows.filter(x => x.name === 'Alice');
    expect(aliceRows.length).toBe(2);
    expect(aliceRows.map(x => x.amount).sort()).toEqual([50, 100]);
  });

  it('performance: 50K × 100 inner join completes quickly', () => {
    const big = { data: Array.from({ length: 50000 }, (_, i) => ({ id: i, label: `L${i}` })) };
    const small = { data: Array.from({ length: 100 }, (_, i) => ({ ref: i * 500, val: i })) };
    const t0 = Date.now();
    const r = joinDatasets(big, small, { leftKey: 'id', rightKey: 'ref', type: 'inner' });
    const ms = Date.now() - t0;
    expect(r.rows.length).toBe(100);
    expect(ms).toBeLessThan(500); // generous — typical is <50ms
  });
});

describe('unionDatasets', () => {
  const ds1 = { fileName: 'jan', data: [{ Region: 'N', Sales: 100 }, { Region: 'S', Sales: 200 }] };
  const ds2 = { fileName: 'feb', data: [{ Region: 'N', Sales: 150 }, { Region: 'E', Sales: 80 }] };

  it('strict mode: succeeds when columns match', () => {
    const r = unionDatasets([ds1, ds2], 'strict');
    expect(r.rows.length).toBe(4);
    expect(r.columns).toContain('_source');
  });

  it('strict mode: errors on column mismatch', () => {
    const ds3 = { fileName: 'mar', data: [{ Region: 'N', Revenue: 100 }] };
    expect(() => unionDatasets([ds1, ds3], 'strict')).toThrow(/strict union failed/i);
  });

  it('intersect mode: keeps only common columns', () => {
    const a = { fileName: 'a', data: [{ Region: 'N', Sales: 100, Bonus: 5 }] };
    const b = { fileName: 'b', data: [{ Region: 'N', Sales: 200, Tax: 20 }] };
    const r = unionDatasets([a, b], 'intersect');
    expect(r.columns.sort()).toEqual(['Region', 'Sales', '_source'].sort());
    expect(r.rows[0]).not.toHaveProperty('Bonus');
    expect(r.rows[0]).not.toHaveProperty('Tax');
  });

  it('union mode: keeps all columns, missing become null', () => {
    const a = { fileName: 'a', data: [{ Region: 'N', Sales: 100, Bonus: 5 }] };
    const b = { fileName: 'b', data: [{ Region: 'N', Sales: 200, Tax: 20 }] };
    const r = unionDatasets([a, b], 'union');
    expect(r.rows.length).toBe(2);
    expect(r.rows[0].Tax).toBeNull();      // a row, Tax not present
    expect(r.rows[1].Bonus).toBeNull();    // b row, Bonus not present
  });

  it('errors on fewer than 2 datasets', () => {
    expect(() => unionDatasets([ds1], 'union')).toThrow(/at least 2/);
  });

  it('adds _source column with provenance', () => {
    const r = unionDatasets([ds1, ds2], 'union');
    const sources = new Set(r.rows.map(x => x._source));
    expect(sources).toEqual(new Set(['jan', 'feb']));
  });
});
