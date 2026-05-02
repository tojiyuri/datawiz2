/**
 * Parameters.
 *
 * User-configurable variables that show up in formulas, filters, and bins.
 * They render as a control in the UI (slider, dropdown, input) and update
 * any consumer when the value changes.
 *
 * Parameter shape:
 *   {
 *     name: "Threshold",          // Used in formulas as @Threshold or [@Threshold]
 *     dataType: "number",         // 'number' | 'string' | 'date' | 'boolean'
 *     control: "slider",          // 'slider' | 'dropdown' | 'input' | 'toggle'
 *     value: 1000,                // Current value
 *     min: 0, max: 5000, step: 100,         // For slider/numeric
 *     allowedValues: ["Low", "Med", "High"], // For dropdown
 *     defaultValue: 1000,
 *   }
 *
 * Substitution:
 *   - In formulas: @ParamName resolves to the value
 *   - In filters: { type: 'compare', value: '@ParamName' } pulls from params
 *
 * The substituteParameters function rewrites a formula expression by
 * replacing @paramName tokens with the literal value.
 */

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_ ]*$/;

function validateParam(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'Invalid parameter object' };
  if (!p.name || !NAME_PATTERN.test(p.name)) {
    return { ok: false, error: 'Name must be alphanumeric (letters/digits/underscore/space, must start with letter)' };
  }
  if (!['number', 'string', 'date', 'boolean'].includes(p.dataType)) {
    return { ok: false, error: 'dataType must be number, string, date, or boolean' };
  }
  if (p.dataType === 'number' && p.value !== undefined && !Number.isFinite(parseFloat(p.value))) {
    return { ok: false, error: 'Numeric parameter has non-numeric value' };
  }
  if (p.allowedValues && !Array.isArray(p.allowedValues)) {
    return { ok: false, error: 'allowedValues must be an array' };
  }
  return { ok: true };
}

/**
 * Build a quick map { name → value } from a params array. Used by callers
 * that want to look up parameters during evaluation without walking the array.
 */
function paramMap(params) {
  const map = {};
  for (const p of params || []) {
    if (!p?.name) continue;
    map[p.name] = coerceValue(p.value, p.dataType);
  }
  return map;
}

function coerceValue(value, dataType) {
  if (value == null || value === '') return null;
  switch (dataType) {
    case 'number': {
      const n = typeof value === 'number' ? value : parseFloat(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'date':
      // Pass through as ISO string — consumers can parse with Date()
      return String(value);
    case 'string':
    default:
      return String(value);
  }
}

/**
 * Substitute @paramName references in a formula expression with their
 * literal values. Handles three forms:
 *   @Threshold        → 1000
 *   [@Threshold]      → 1000   (Tableau-style bracket form for names with spaces)
 *   @"Threshold"      → 1000   (quoted form)
 *
 * Strings get quoted properly. Booleans become TRUE/FALSE. Numbers as-is.
 */
function substituteParameters(expression, params) {
  if (!expression || !params || !params.length) return expression;
  const map = paramMap(params);

  let result = expression;
  // Sort by name length descending so "Threshold2" matches before "Threshold"
  const names = Object.keys(map).sort((a, b) => b.length - a.length);

  for (const name of names) {
    const value = map[name];
    const literal = formatAsLiteral(value, params.find(p => p.name === name)?.dataType);

    // [@Name] form
    const bracketed = new RegExp(`\\[@${escapeRegex(name)}\\]`, 'g');
    result = result.replace(bracketed, literal);

    // @"Name" form (quoted, allows spaces)
    const quoted = new RegExp(`@"${escapeRegex(name)}"`, 'g');
    result = result.replace(quoted, literal);

    // @Name form — only matches name without spaces/special chars
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      // Negative lookbehind to avoid email addresses, etc. — match only
      // when @name is preceded by a non-word char or string start.
      const bare = new RegExp(`(^|[^\\w@])@${escapeRegex(name)}\\b`, 'g');
      result = result.replace(bare, (_, prefix) => `${prefix}${literal}`);
    }
  }

  return result;
}

function formatAsLiteral(value, dataType) {
  if (value == null) return 'NULL';
  if (dataType === 'string') return `"${String(value).replace(/"/g, '\\"')}"`;
  if (dataType === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (dataType === 'date') return `"${value}"`;
  // numeric or unspecified
  return String(value);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find parameter references in an expression. Returns array of names.
 */
function collectParameterRefs(expression) {
  if (!expression) return [];
  const refs = new Set();
  const patterns = [
    /\[@([^\]]+)\]/g,           // [@Name]
    /@"([^"]+)"/g,              // @"Name"
    /(?:^|[^\w@])@([A-Za-z_][A-Za-z0-9_]*)\b/g,  // @Name
  ];
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(expression)) !== null) {
      refs.add(m[1]);
    }
  }
  return Array.from(refs);
}

module.exports = {
  validateParam,
  paramMap,
  coerceValue,
  substituteParameters,
  collectParameterRefs,
};
