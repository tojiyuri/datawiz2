/**
 * filterEngine - Apply declarative filter specs to data.
 *
 * Filter spec shape:
 *   { field: 'ColName', op: 'in'|'not_in'|'='|'!='|'<'|'>'|'<='|'>='|'between'|'contains'|'top_n'|'bottom_n'|'formula',
 *     value: any (or [min,max] for between, or N for top_n, or formula string)
 *     by?: 'ColName'  (for top_n: rank groups by this measure)
 *     agg?: 'sum'|'avg'  (for top_n: aggregation on `by`)
 *   }
 */
const { compile, evalRow } = require('./formulaEngine');

function applyFilters(data, filters = []) {
  if (!filters?.length) return data;
  let out = data;
  for (const f of filters) {
    if (!f || !f.field && f.op !== 'formula') continue;

    if (f.op === 'top_n' || f.op === 'bottom_n') {
      // Compute rank groups
      const N = Number(f.value) || 10;
      const by = f.by || f.field;
      const agg = f.agg || 'sum';
      const groups = {};
      out.forEach(r => {
        const k = String(r[f.field] ?? 'Unknown');
        const v = Number(r[by]);
        if (!groups[k]) groups[k] = { sum: 0, count: 0, vals: [] };
        if (!isNaN(v)) { groups[k].sum += v; groups[k].count++; groups[k].vals.push(v); }
      });
      const ranked = Object.entries(groups).map(([k, g]) => ({
        k,
        score: agg === 'avg' ? (g.count ? g.sum / g.count : 0)
              : agg === 'count' ? g.count
              : agg === 'min' ? Math.min(...g.vals)
              : agg === 'max' ? Math.max(...g.vals)
              : g.sum,
      })).sort((a, b) => f.op === 'top_n' ? b.score - a.score : a.score - b.score);
      const keep = new Set(ranked.slice(0, N).map(r => r.k));
      out = out.filter(r => keep.has(String(r[f.field] ?? 'Unknown')));
      continue;
    }

    if (f.op === 'formula') {
      try {
        const ast = compile(f.value);
        out = out.filter(r => !!evalRow(ast, r));
      } catch { /* ignore bad formula */ }
      continue;
    }

    out = out.filter(row => {
      const v = row[f.field];
      switch (f.op) {
        case 'in':       return Array.isArray(f.value) && f.value.map(String).includes(String(v));
        case 'not_in':   return !(Array.isArray(f.value) && f.value.map(String).includes(String(v)));
        case '=':        return String(v) === String(f.value);
        case '!=':       return String(v) !== String(f.value);
        case '<':        return Number(v) < Number(f.value);
        case '>':        return Number(v) > Number(f.value);
        case '<=':       return Number(v) <= Number(f.value);
        case '>=':       return Number(v) >= Number(f.value);
        case 'between':  return Array.isArray(f.value) && Number(v) >= Number(f.value[0]) && Number(v) <= Number(f.value[1]);
        case 'contains': return v != null && String(v).toLowerCase().includes(String(f.value).toLowerCase());
        case 'not_null': return v != null && v !== '';
        case 'is_null':  return v == null || v === '';
        default: return true;
      }
    });
  }
  return out;
}

// Get distinct values for a field (used to populate filter dropdowns)
function getDistinctValues(data, field, max = 200) {
  const set = new Set();
  for (const r of data) {
    const v = r[field];
    if (v != null && v !== '') set.add(String(v));
    if (set.size >= max) break;
  }
  return [...set].sort();
}

// Get min/max for a numeric field
function getNumericRange(data, field) {
  let min = Infinity, max = -Infinity;
  for (const r of data) {
    const v = Number(r[field]);
    if (!isNaN(v)) { if (v < min) min = v; if (v > max) max = v; }
  }
  return min === Infinity ? { min: 0, max: 0 } : { min, max };
}

module.exports = { applyFilters, getDistinctValues, getNumericRange };
