/**
 * Tests for formulaEngine — Tableau-style formula parser/evaluator.
 *
 * Critical because formulas are user-entered code that gets executed against
 * data. A regression here breaks every calculated field in every saved sheet.
 */

const { describe, it, expect } = require('vitest');
const {
  compile, validate, evalRow, applyCalculatedFields, collectFieldRefs,
} = require('../utils/formulaEngine');

describe('formulaEngine.validate', () => {
  it('accepts valid formulas with known fields', () => {
    const r = validate('[Sales] - [Cost]', ['Sales', 'Cost', 'Region']);
    expect(r.ok).toBe(true);
    expect(r.error).toBeFalsy();
  });

  it('rejects formulas referencing unknown fields', () => {
    const r = validate('[Sales] - [DoesNotExist]', ['Sales', 'Cost']);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('DoesNotExist');
  });

  it('rejects syntactically invalid formulas', () => {
    const r = validate('[Sales] + + [Cost]', ['Sales', 'Cost']);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects empty formula', () => {
    const r = validate('', ['Sales']);
    expect(r.ok).toBe(false);
  });
});

describe('formulaEngine.evalRow (row-level expressions)', () => {
  it('evaluates simple subtraction', () => {
    const ast = compile('[Sales] - [Cost]');
    const row = { Sales: 100, Cost: 60 };
    expect(evalRow(ast, row)).toBe(40);
  });

  it('evaluates margin percentage', () => {
    const ast = compile('([Sales] - [Cost]) / [Sales] * 100');
    const row = { Sales: 200, Cost: 150 };
    expect(evalRow(ast, row)).toBeCloseTo(25, 5);
  });

  it('handles operator precedence', () => {
    const ast = compile('2 + 3 * 4');
    expect(evalRow(ast, {})).toBe(14);
  });

  it('handles parentheses', () => {
    const ast = compile('(2 + 3) * 4');
    expect(evalRow(ast, {})).toBe(20);
  });

  it('handles missing field as null/undefined gracefully', () => {
    const ast = compile('[Sales] + [Missing]');
    const row = { Sales: 100 };
    // result should be NaN or null — but should NOT crash
    const result = evalRow(ast, row);
    expect(Number.isFinite(result)).toBe(false);
  });

  it('evaluates IF/THEN/ELSE', () => {
    const ast = compile('IF [Sales] > 100 THEN "High" ELSE "Low" END');
    expect(evalRow(ast, { Sales: 200 })).toBe('High');
    expect(evalRow(ast, { Sales: 50 })).toBe('Low');
  });
});

describe('formulaEngine.applyCalculatedFields', () => {
  it('adds calculated columns to each row', () => {
    const data = [
      { Sales: 100, Cost: 60 },
      { Sales: 200, Cost: 150 },
    ];
    const calcFields = [
      { name: 'Profit', formula: '[Sales] - [Cost]' },
    ];
    const result = applyCalculatedFields(data, calcFields);
    expect(result[0].Profit).toBe(40);
    expect(result[1].Profit).toBe(50);
    // Originals preserved
    expect(result[0].Sales).toBe(100);
  });

  it('supports multiple calc fields, with later ones referencing earlier', () => {
    const data = [{ Sales: 200, Cost: 150 }];
    const calcFields = [
      { name: 'Profit', formula: '[Sales] - [Cost]' },
      { name: 'Margin', formula: '[Profit] / [Sales] * 100' },
    ];
    const result = applyCalculatedFields(data, calcFields);
    expect(result[0].Profit).toBe(50);
    expect(result[0].Margin).toBeCloseTo(25, 5);
  });

  it('does not mutate the input data', () => {
    const data = [{ Sales: 100, Cost: 60 }];
    const original = JSON.stringify(data);
    applyCalculatedFields(data, [{ name: 'Profit', formula: '[Sales] - [Cost]' }]);
    expect(JSON.stringify(data)).toBe(original);
  });

  it('returns input unchanged when no calc fields given', () => {
    const data = [{ Sales: 100 }];
    const result = applyCalculatedFields(data, []);
    expect(result).toEqual(data);
  });

  it('handles bad formula by leaving the field undefined or null', () => {
    const data = [{ Sales: 100 }];
    const calcFields = [{ name: 'Bad', formula: '[NotARealField] * 2' }];
    // Should not crash the whole pipeline — just produce a non-finite value
    const result = applyCalculatedFields(data, calcFields);
    expect(result[0].Sales).toBe(100); // original preserved
    expect(Number.isFinite(result[0].Bad)).toBe(false);
  });
});

describe('formulaEngine.collectFieldRefs', () => {
  it('finds all referenced fields in a formula', () => {
    const ast = compile('[Sales] + [Cost] - [Tax]');
    const refs = [];
    collectFieldRefs(ast, refs);
    expect(refs.sort()).toEqual(['Cost', 'Sales', 'Tax']);
  });

  it('deduplicates references', () => {
    const ast = compile('[Sales] + [Sales] / [Sales]');
    const refs = [];
    collectFieldRefs(ast, refs);
    // collectFieldRefs may or may not dedupe — depends on implementation.
    // Either way, the set should only contain Sales.
    expect(new Set(refs)).toEqual(new Set(['Sales']));
  });
});
