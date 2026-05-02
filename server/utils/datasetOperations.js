/**
 * Dataset Operations: Union (append) and Join (merge on key)
 *
 * The "multi-table data model" gap from the audit. Power BI's whole pricing
 * tier is built on this — but the core operation is straightforward when
 * you have datasets in memory.
 *
 * Trade-offs:
 *  - In-memory only. For datasets >1M rows joined against each other, this
 *    will be slow. Real BI tools push joins to the database.
 *  - No relationship cardinality enforcement (no "one-to-many" warnings).
 *  - No automatic schema mapping — column names must match exactly for union.
 *
 * Both ops produce a NEW dataset that's stored independently, so the user
 * can chart against the joined view directly.
 */

/**
 * UNION (append) two or more datasets row-wise.
 *
 * Modes:
 *  - 'strict': all datasets must have identical columns. Errors otherwise.
 *  - 'intersect': output keeps only columns present in ALL inputs.
 *  - 'union': output keeps every column. Missing values become null.
 */
function unionDatasets(datasets, mode = 'union') {
  if (!Array.isArray(datasets) || datasets.length < 2) {
    throw new Error('Union requires at least 2 datasets.');
  }

  const allColumnSets = datasets.map(d => new Set(Object.keys(d.data[0] || {})));

  let outColumns;
  if (mode === 'strict') {
    const firstCols = [...allColumnSets[0]].sort().join('|');
    for (let i = 1; i < datasets.length; i++) {
      const cols = [...allColumnSets[i]].sort().join('|');
      if (cols !== firstCols) {
        throw new Error(`Strict union failed: dataset ${i} columns don't match dataset 0.`);
      }
    }
    outColumns = [...allColumnSets[0]];
  } else if (mode === 'intersect') {
    outColumns = [...allColumnSets[0]].filter(col => allColumnSets.every(s => s.has(col)));
    if (!outColumns.length) {
      throw new Error('Intersect union failed: no columns are common to all datasets.');
    }
  } else {
    // 'union' — combine all columns
    const all = new Set();
    allColumnSets.forEach(s => s.forEach(col => all.add(col)));
    outColumns = [...all];
  }

  // Concatenate rows, projecting onto the chosen column set
  const rows = [];
  let sourceTag = 0;
  for (const ds of datasets) {
    const tag = ds.fileName || ds.name || `source_${sourceTag++}`;
    for (const row of ds.data) {
      const out = {};
      outColumns.forEach(c => { out[c] = row[c] != null ? row[c] : null; });
      out._source = tag; // helpful provenance column
      rows.push(out);
    }
  }

  return {
    rows,
    columns: [...outColumns, '_source'],
    sourceCount: datasets.length,
    mode,
  };
}

/**
 * JOIN two datasets on a key. Returns a new array of merged rows.
 *
 * Types:
 *  - 'inner': only rows with matches in both
 *  - 'left':  all rows from left, with matches from right (or nulls)
 *  - 'right': all rows from right, with matches from left (or nulls)
 *  - 'full':  every row from both, matched where possible
 *
 * Conflict policy: if a column exists on both sides, right's value wins
 * unless the user supplied a custom prefix for one side.
 */
function joinDatasets(left, right, options) {
  const {
    leftKey,
    rightKey,
    type = 'inner',
    leftPrefix = '',
    rightPrefix = '',
  } = options || {};

  if (!leftKey || !rightKey) {
    throw new Error('Both leftKey and rightKey are required for join.');
  }
  if (!['inner', 'left', 'right', 'full'].includes(type)) {
    throw new Error(`Invalid join type: ${type}. Use inner, left, right, or full.`);
  }

  const leftRows = left.data || [];
  const rightRows = right.data || [];

  // Verify keys exist
  if (leftRows.length && !(leftKey in leftRows[0])) {
    throw new Error(`Left dataset has no column "${leftKey}".`);
  }
  if (rightRows.length && !(rightKey in rightRows[0])) {
    throw new Error(`Right dataset has no column "${rightKey}".`);
  }

  // Build hash on the RIGHT. (Simpler semantics; performance is fine for typical sizes.)
  const rightHash = new Map();
  for (const row of rightRows) {
    const k = row[rightKey];
    if (k == null) continue;
    if (!rightHash.has(k)) rightHash.set(k, []);
    rightHash.get(k).push(row);
  }

  // Helper to merge two rows with prefix conflict resolution
  const merge = (leftRow, rightRow) => {
    const merged = {};
    if (leftRow) {
      for (const k of Object.keys(leftRow)) {
        merged[leftPrefix ? `${leftPrefix}${k}` : k] = leftRow[k];
      }
    }
    if (rightRow) {
      for (const k of Object.keys(rightRow)) {
        const finalKey = rightPrefix ? `${rightPrefix}${k}` : k;
        if (!leftPrefix && !rightPrefix && merged[finalKey] !== undefined && k !== rightKey) {
          merged[`${k}_right`] = rightRow[k];
        } else {
          merged[finalKey] = rightRow[k];
        }
      }
    }
    return merged;
  };

  const out = [];
  const matchedRightKeys = new Set();

  // Phase 1: iterate left, probe right
  for (const leftRow of leftRows) {
    const k = leftRow[leftKey];
    const matches = (k != null && rightHash.get(k)) || [];

    if (matches.length === 0) {
      // Unmatched left → emit only for LEFT or FULL joins
      if (type === 'left' || type === 'full') {
        out.push(merge(leftRow, null));
      }
    } else {
      for (const rightRow of matches) {
        out.push(merge(leftRow, rightRow));
      }
      matchedRightKeys.add(k);
    }
  }

  // Phase 2: for RIGHT or FULL joins, append unmatched rights
  if (type === 'right' || type === 'full') {
    for (const rightRow of rightRows) {
      const k = rightRow[rightKey];
      if (k == null || !matchedRightKeys.has(k)) {
        out.push(merge(null, rightRow));
      }
    }
  }

  // Build column list from union across all output rows (rows may have
  // different shapes when one side is null in outer joins)
  const colSet = new Set();
  for (const row of out) Object.keys(row).forEach(k => colSet.add(k));
  const columns = [...colSet];

  return {
    rows: out,
    columns,
    type,
    leftKey,
    rightKey,
    leftRowCount: leftRows.length,
    rightRowCount: rightRows.length,
    outputRowCount: out.length,
  };
}

module.exports = { unionDatasets, joinDatasets };
