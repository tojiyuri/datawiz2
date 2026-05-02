/**
 * formulaEngine - Safe formula parser/evaluator for calculated fields.
 *
 * Supports Tableau-like syntax:
 *   - Field references: [Field Name] or just FieldName for simple identifiers
 *   - Aggregates: SUM([Sales]), AVG([Profit]), COUNT([X]), MIN, MAX, MEDIAN
 *   - Math: + - * / % ^ , parens
 *   - Comparison: = != < > <= >=  (also == is accepted)
 *   - Logical: AND, OR, NOT
 *   - IF cond THEN val ELSE val END
 *   - CASE [field] WHEN val THEN val ... ELSE val END
 *   - Functions: ROUND, ABS, FLOOR, CEIL, SQRT, LOG, LN, EXP, MIN2(a,b), MAX2(a,b)
 *   - String: CONCAT(a,b,...), UPPER(s), LOWER(s), LEN(s), CONTAINS(s, sub)
 *
 * Implementation: hand-written recursive-descent parser (no eval, no Function ctor, safe).
 *
 * Two evaluation contexts:
 *   - Row-level: returns a value per row (for non-aggregate formulas)
 *   - Aggregate: collapses to a single number (when SUM/AVG/etc are used)
 */

// ─── TOKENIZER ───
const TOKEN_TYPES = {
  NUMBER: 'number', STRING: 'string', IDENT: 'ident', FIELD: 'field',
  LPAREN: '(', RPAREN: ')', COMMA: ',', LBRACKET: '[', RBRACKET: ']',
  PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', PERCENT: '%', CARET: '^',
  EQ: '=', NEQ: '!=', LT: '<', GT: '>', LTE: '<=', GTE: '>=',
  EOF: 'eof',
};

const KEYWORDS = new Set(['IF','THEN','ELSE','END','CASE','WHEN','AND','OR','NOT','TRUE','FALSE','NULL']);
const AGG_FUNCS = new Set(['SUM','AVG','COUNT','MIN','MAX','MEDIAN','COUNTD','STDEV']);
const ROW_FUNCS = new Set(['ROUND','ABS','FLOOR','CEIL','SQRT','LOG','LN','EXP','POW','MIN2','MAX2','CONCAT','UPPER','LOWER','LEN','CONTAINS','LEFT','RIGHT','SUBSTR','REPLACE','TRIM','ISNULL','COALESCE','TODAY','YEAR','MONTH','DAY','DATEPART','DATEDIFF']);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }

    // Numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(input[i+1]))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: 'number', value: parseFloat(input.slice(i, j)) });
      i = j; continue;
    }

    // String literals
    if (c === '"' || c === "'") {
      const quote = c; let j = i + 1; let str = '';
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < input.length) { str += input[j+1]; j += 2; }
        else { str += input[j]; j++; }
      }
      if (j >= input.length) throw new Error(`Unterminated string at position ${i}`);
      tokens.push({ type: 'string', value: str });
      i = j + 1; continue;
    }

    // [Field Name]
    if (c === '[') {
      const close = input.indexOf(']', i + 1);
      if (close < 0) throw new Error(`Unclosed [ at position ${i}`);
      tokens.push({ type: 'field', value: input.slice(i + 1, close) });
      i = close + 1; continue;
    }

    // Identifiers / keywords
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      const word = input.slice(i, j);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) tokens.push({ type: upper.toLowerCase(), value: upper });
      else tokens.push({ type: 'ident', value: word });
      i = j; continue;
    }

    // Multi-char operators
    if (c === '!' && input[i+1] === '=') { tokens.push({ type: '!=' }); i += 2; continue; }
    if (c === '<' && input[i+1] === '=') { tokens.push({ type: '<=' }); i += 2; continue; }
    if (c === '>' && input[i+1] === '=') { tokens.push({ type: '>=' }); i += 2; continue; }
    if (c === '=' && input[i+1] === '=') { tokens.push({ type: '=' }); i += 2; continue; }

    // Single-char operators
    const single = { '(':'(', ')':')', ',':',', '+':'+', '-':'-', '*':'*', '/':'/', '%':'%', '^':'^', '=':'=', '<':'<', '>':'>' };
    if (single[c]) { tokens.push({ type: single[c] }); i++; continue; }

    throw new Error(`Unexpected character '${c}' at position ${i}`);
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

// ─── PARSER (recursive descent) ───
//
// expr     := orExpr
// orExpr   := andExpr (OR andExpr)*
// andExpr  := notExpr (AND notExpr)*
// notExpr  := NOT notExpr | compExpr
// compExpr := addExpr ((= | != | < | > | <= | >=) addExpr)?
// addExpr  := mulExpr ((+|-) mulExpr)*
// mulExpr  := powExpr ((* | / | %) powExpr)*
// powExpr  := unary (^ unary)?
// unary    := - unary | + unary | primary
// primary  := NUMBER | STRING | FIELD | TRUE | FALSE | NULL
//             | IF expr THEN expr ELSE expr END
//             | CASE expr WHEN expr THEN expr (WHEN ...)+ ELSE expr END
//             | IDENT '(' args ')'
//             | IDENT
//             | '(' expr ')'

function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = (type) => {
    if (tokens[pos].type !== type) throw new Error(`Expected ${type}, got ${tokens[pos].type}`);
    return tokens[pos++];
  };
  const accept = (type) => tokens[pos].type === type ? tokens[pos++] : null;

  function expr() { return orExpr(); }
  function orExpr() {
    let left = andExpr();
    while (peek().type === 'or') { pos++; left = { kind: 'or', left, right: andExpr() }; }
    return left;
  }
  function andExpr() {
    let left = notExpr();
    while (peek().type === 'and') { pos++; left = { kind: 'and', left, right: notExpr() }; }
    return left;
  }
  function notExpr() {
    if (peek().type === 'not') { pos++; return { kind: 'not', operand: notExpr() }; }
    return compExpr();
  }
  function compExpr() {
    const left = addExpr();
    const op = ['=','!=','<','>','<=','>='].includes(peek().type) ? peek().type : null;
    if (op) { pos++; return { kind: 'compare', op, left, right: addExpr() }; }
    return left;
  }
  function addExpr() {
    let left = mulExpr();
    while (peek().type === '+' || peek().type === '-') {
      const op = peek().type; pos++;
      left = { kind: 'binop', op, left, right: mulExpr() };
    }
    return left;
  }
  function mulExpr() {
    let left = powExpr();
    while (peek().type === '*' || peek().type === '/' || peek().type === '%') {
      const op = peek().type; pos++;
      left = { kind: 'binop', op, left, right: powExpr() };
    }
    return left;
  }
  function powExpr() {
    const left = unary();
    if (peek().type === '^') { pos++; return { kind: 'binop', op: '^', left, right: unary() }; }
    return left;
  }
  function unary() {
    if (peek().type === '-') { pos++; return { kind: 'neg', operand: unary() }; }
    if (peek().type === '+') { pos++; return unary(); }
    return primary();
  }
  function primary() {
    const t = peek();
    if (t.type === 'number') { pos++; return { kind: 'num', value: t.value }; }
    if (t.type === 'string') { pos++; return { kind: 'str', value: t.value }; }
    if (t.type === 'field') { pos++; return { kind: 'field', name: t.value }; }
    if (t.type === 'true') { pos++; return { kind: 'bool', value: true }; }
    if (t.type === 'false') { pos++; return { kind: 'bool', value: false }; }
    if (t.type === 'null') { pos++; return { kind: 'null' }; }
    if (t.type === 'if') {
      pos++;
      const cond = expr();
      consume('then'); const thenE = expr();
      consume('else'); const elseE = expr();
      consume('end');
      return { kind: 'if', cond, then: thenE, else: elseE };
    }
    if (t.type === 'case') {
      pos++;
      const subject = expr();
      const branches = [];
      while (peek().type === 'when') {
        pos++;
        const match = expr();
        consume('then');
        const value = expr();
        branches.push({ match, value });
      }
      let elseE = null;
      if (accept('else')) elseE = expr();
      consume('end');
      return { kind: 'case', subject, branches, else: elseE };
    }
    if (t.type === 'ident') {
      const name = t.value.toUpperCase();
      pos++;
      // Function call
      if (peek().type === '(') {
        pos++;
        const args = [];
        if (peek().type !== ')') {
          args.push(expr());
          while (accept(',')) args.push(expr());
        }
        consume(')');
        if (AGG_FUNCS.has(name)) return { kind: 'agg', fn: name, arg: args[0] };
        return { kind: 'call', fn: name, args };
      }
      // Bare identifier — treat as field reference (for simple field names without [])
      return { kind: 'field', name: t.value };
    }
    if (t.type === '(') { pos++; const e = expr(); consume(')'); return e; }
    throw new Error(`Unexpected token ${t.type}`);
  }

  const ast = expr();
  if (peek().type !== 'eof') throw new Error(`Unexpected trailing token ${peek().type}`);
  return ast;
}

// ─── EVALUATOR ───
function isAggregate(ast) {
  if (!ast) return false;
  if (ast.kind === 'agg') return true;
  if (ast.kind === 'call') return ast.args.some(isAggregate);
  if (ast.kind === 'binop' || ast.kind === 'compare') return isAggregate(ast.left) || isAggregate(ast.right);
  if (ast.kind === 'and' || ast.kind === 'or') return isAggregate(ast.left) || isAggregate(ast.right);
  if (ast.kind === 'not' || ast.kind === 'neg') return isAggregate(ast.operand);
  if (ast.kind === 'if') return isAggregate(ast.cond) || isAggregate(ast.then) || isAggregate(ast.else);
  if (ast.kind === 'case') return isAggregate(ast.subject) || ast.branches.some(b => isAggregate(b.match) || isAggregate(b.value)) || isAggregate(ast.else);
  return false;
}

// Eval at row level (no aggregates). row is an object.
function evalRow(ast, row) {
  if (ast == null) return null;
  switch (ast.kind) {
    case 'num': return ast.value;
    case 'str': return ast.value;
    case 'bool': return ast.value;
    case 'null': return null;
    case 'field': {
      const v = row[ast.name];
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      return isNaN(n) ? v : n;
    }
    case 'neg': { const v = evalRow(ast.operand, row); return v == null ? null : -v; }
    case 'not': return !evalRow(ast.operand, row);
    case 'and': return evalRow(ast.left, row) && evalRow(ast.right, row);
    case 'or':  return evalRow(ast.left, row) || evalRow(ast.right, row);
    case 'binop': {
      const a = evalRow(ast.left, row), b = evalRow(ast.right, row);
      if (a == null || b == null) return null;
      switch (ast.op) {
        case '+': return (typeof a === 'string' || typeof b === 'string') ? String(a) + String(b) : Number(a) + Number(b);
        case '-': return Number(a) - Number(b);
        case '*': return Number(a) * Number(b);
        case '/': return Number(b) === 0 ? null : Number(a) / Number(b);
        case '%': return Number(b) === 0 ? null : Number(a) % Number(b);
        case '^': return Math.pow(Number(a), Number(b));
      }
      return null;
    }
    case 'compare': {
      const a = evalRow(ast.left, row), b = evalRow(ast.right, row);
      switch (ast.op) {
        case '=':  return a == b;
        case '!=': return a != b;
        case '<':  return Number(a) < Number(b);
        case '>':  return Number(a) > Number(b);
        case '<=': return Number(a) <= Number(b);
        case '>=': return Number(a) >= Number(b);
      }
      return false;
    }
    case 'if': return evalRow(ast.cond, row) ? evalRow(ast.then, row) : evalRow(ast.else, row);
    case 'case': {
      const subj = evalRow(ast.subject, row);
      for (const br of ast.branches) {
        if (subj == evalRow(br.match, row)) return evalRow(br.value, row);
      }
      return ast.else ? evalRow(ast.else, row) : null;
    }
    case 'call': {
      const args = ast.args.map(a => evalRow(a, row));
      return callRowFunc(ast.fn, args);
    }
    case 'agg': throw new Error(`Aggregate ${ast.fn} can't be used in row context`);
  }
  return null;
}

function callRowFunc(fn, args) {
  switch (fn) {
    case 'ROUND': return args[0] == null ? null : Math.round(args[0] * Math.pow(10, args[1] || 0)) / Math.pow(10, args[1] || 0);
    case 'ABS': return args[0] == null ? null : Math.abs(args[0]);
    case 'FLOOR': return args[0] == null ? null : Math.floor(args[0]);
    case 'CEIL': return args[0] == null ? null : Math.ceil(args[0]);
    case 'SQRT': return args[0] == null || args[0] < 0 ? null : Math.sqrt(args[0]);
    case 'LOG': return args[0] == null || args[0] <= 0 ? null : Math.log10(args[0]);
    case 'LN': return args[0] == null || args[0] <= 0 ? null : Math.log(args[0]);
    case 'EXP': return args[0] == null ? null : Math.exp(args[0]);
    case 'POW': return args[0] == null ? null : Math.pow(args[0], args[1]);
    case 'MIN2': return args.filter(a => a != null).reduce((m, v) => Math.min(m, v), Infinity);
    case 'MAX2': return args.filter(a => a != null).reduce((m, v) => Math.max(m, v), -Infinity);
    case 'CONCAT': return args.map(a => a == null ? '' : String(a)).join('');
    case 'UPPER': return args[0] == null ? null : String(args[0]).toUpperCase();
    case 'LOWER': return args[0] == null ? null : String(args[0]).toLowerCase();
    case 'LEN': return args[0] == null ? 0 : String(args[0]).length;
    case 'CONTAINS': return args[0] != null && args[1] != null && String(args[0]).includes(String(args[1]));
    case 'LEFT': return args[0] == null ? null : String(args[0]).slice(0, args[1] || 0);
    case 'RIGHT': return args[0] == null ? null : String(args[0]).slice(-(args[1] || 0));
    case 'SUBSTR': return args[0] == null ? null : String(args[0]).substr(args[1] || 0, args[2]);
    case 'REPLACE': return args[0] == null ? null : String(args[0]).split(args[1]).join(args[2] || '');
    case 'TRIM': return args[0] == null ? null : String(args[0]).trim();
    case 'ISNULL': return args[0] == null;
    case 'COALESCE': return args.find(a => a != null) ?? null;
    case 'TODAY': return new Date().toISOString().slice(0, 10);
    case 'YEAR': { const d = new Date(args[0]); return isNaN(d) ? null : d.getFullYear(); }
    case 'MONTH': { const d = new Date(args[0]); return isNaN(d) ? null : d.getMonth() + 1; }
    case 'DAY': { const d = new Date(args[0]); return isNaN(d) ? null : d.getDate(); }
    case 'DATEPART': { const d = new Date(args[1]); if (isNaN(d)) return null;
      switch (String(args[0]).toLowerCase()) {
        case 'year': return d.getFullYear();
        case 'month': return d.getMonth() + 1;
        case 'day': return d.getDate();
        case 'quarter': return Math.floor(d.getMonth() / 3) + 1;
        case 'weekday': return d.getDay();
      }
      return null;
    }
    case 'DATEDIFF': { const d1 = new Date(args[0]), d2 = new Date(args[1]); return isNaN(d1)||isNaN(d2) ? null : Math.floor((d2 - d1) / 86400000); }
  }
  throw new Error(`Unknown function: ${fn}`);
}

// Evaluate an aggregate-containing AST against a list of rows
function evalAggregate(ast, rows) {
  if (ast.kind === 'agg') {
    const vals = rows.map(r => evalRow(ast.arg, r)).filter(v => v != null && !isNaN(Number(v))).map(Number);
    switch (ast.fn) {
      case 'SUM': return vals.reduce((s, v) => s + v, 0);
      case 'AVG': return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      case 'COUNT': return rows.map(r => evalRow(ast.arg, r)).filter(v => v != null).length;
      case 'COUNTD': return new Set(rows.map(r => evalRow(ast.arg, r)).filter(v => v != null)).size;
      case 'MIN': return vals.length ? Math.min(...vals) : null;
      case 'MAX': return vals.length ? Math.max(...vals) : null;
      case 'MEDIAN': {
        const s = [...vals].sort((a,b) => a-b);
        if (!s.length) return null;
        return s.length % 2 ? s[(s.length-1)/2] : (s[s.length/2-1] + s[s.length/2]) / 2;
      }
      case 'STDEV': {
        if (vals.length < 2) return 0;
        const m = vals.reduce((s,v)=>s+v,0) / vals.length;
        return Math.sqrt(vals.reduce((s,v)=>s+(v-m)**2,0) / (vals.length-1));
      }
    }
    return null;
  }
  if (ast.kind === 'binop') {
    const a = evalAggregate(ast.left, rows), b = evalAggregate(ast.right, rows);
    if (a == null || b == null) return null;
    switch (ast.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? null : a / b;
      case '%': return b === 0 ? null : a % b;
      case '^': return Math.pow(a, b);
    }
  }
  if (ast.kind === 'neg') { const v = evalAggregate(ast.operand, rows); return v == null ? null : -v; }
  if (ast.kind === 'compare') {
    const a = isAggregate(ast.left) ? evalAggregate(ast.left, rows) : evalRow(ast.left, rows[0] || {});
    const b = isAggregate(ast.right) ? evalAggregate(ast.right, rows) : evalRow(ast.right, rows[0] || {});
    switch (ast.op) {
      case '=': return a == b;
      case '!=': return a != b;
      case '<': return Number(a) < Number(b);
      case '>': return Number(a) > Number(b);
      case '<=': return Number(a) <= Number(b);
      case '>=': return Number(a) >= Number(b);
    }
    return false;
  }
  if (ast.kind === 'and') {
    const a = isAggregate(ast.left) ? evalAggregate(ast.left, rows) : evalRow(ast.left, rows[0] || {});
    if (!a) return false;
    return isAggregate(ast.right) ? evalAggregate(ast.right, rows) : evalRow(ast.right, rows[0] || {});
  }
  if (ast.kind === 'or') {
    const a = isAggregate(ast.left) ? evalAggregate(ast.left, rows) : evalRow(ast.left, rows[0] || {});
    if (a) return a;
    return isAggregate(ast.right) ? evalAggregate(ast.right, rows) : evalRow(ast.right, rows[0] || {});
  }
  if (ast.kind === 'not') {
    return !(isAggregate(ast.operand) ? evalAggregate(ast.operand, rows) : evalRow(ast.operand, rows[0] || {}));
  }
  if (ast.kind === 'call') {
    const args = ast.args.map(a => isAggregate(a) ? evalAggregate(a, rows) : evalRow(a, rows[0] || {}));
    return callRowFunc(ast.fn, args);
  }
  if (ast.kind === 'if') {
    const cond = isAggregate(ast.cond) ? evalAggregate(ast.cond, rows) : evalRow(ast.cond, rows[0] || {});
    return cond
      ? (isAggregate(ast.then) ? evalAggregate(ast.then, rows) : evalRow(ast.then, rows[0] || {}))
      : (isAggregate(ast.else) ? evalAggregate(ast.else, rows) : evalRow(ast.else, rows[0] || {}));
  }
  if (ast.kind === 'case') {
    const subj = isAggregate(ast.subject) ? evalAggregate(ast.subject, rows) : evalRow(ast.subject, rows[0] || {});
    for (const br of ast.branches) {
      const m = isAggregate(br.match) ? evalAggregate(br.match, rows) : evalRow(br.match, rows[0] || {});
      if (subj == m) return isAggregate(br.value) ? evalAggregate(br.value, rows) : evalRow(br.value, rows[0] || {});
    }
    if (ast.else) return isAggregate(ast.else) ? evalAggregate(ast.else, rows) : evalRow(ast.else, rows[0] || {});
    return null;
  }
  // Constant
  return evalRow(ast, rows[0] || {});
}

// ─── PUBLIC API ───
function compile(formula) {
  const tokens = tokenize(formula);
  const ast = parse(tokens);
  return ast;
}

function validate(formula, columnNames) {
  try {
    const ast = compile(formula);
    // Walk AST and check all referenced fields exist
    const refs = collectFieldRefs(ast);
    const colSet = new Set(columnNames);
    const missing = refs.filter(r => !colSet.has(r));
    return { ok: missing.length === 0, ast, missing, isAggregate: isAggregate(ast) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function collectFieldRefs(ast, out = []) {
  if (!ast) return out;
  if (ast.kind === 'field') out.push(ast.name);
  if (ast.kind === 'agg') collectFieldRefs(ast.arg, out);
  if (ast.kind === 'call') ast.args.forEach(a => collectFieldRefs(a, out));
  if (ast.kind === 'binop' || ast.kind === 'compare' || ast.kind === 'and' || ast.kind === 'or') {
    collectFieldRefs(ast.left, out); collectFieldRefs(ast.right, out);
  }
  if (ast.kind === 'not' || ast.kind === 'neg') collectFieldRefs(ast.operand, out);
  if (ast.kind === 'if') { collectFieldRefs(ast.cond, out); collectFieldRefs(ast.then, out); collectFieldRefs(ast.else, out); }
  if (ast.kind === 'case') {
    collectFieldRefs(ast.subject, out);
    ast.branches.forEach(b => { collectFieldRefs(b.match, out); collectFieldRefs(b.value, out); });
    if (ast.else) collectFieldRefs(ast.else, out);
  }
  return out;
}

// Apply calculated fields to data: returns NEW rows with extra computed columns.
function applyCalculatedFields(data, calcFields) {
  if (!calcFields?.length) return data;
  // Compile all formulas first
  const compiled = calcFields.map(cf => {
    try { return { ...cf, ast: compile(cf.formula), isAgg: false }; }
    catch (err) { return { ...cf, error: err.message, ast: null }; }
  });
  // Only evaluate row-level (non-aggregate) formulas here. Aggregates are evaluated at chart-build time.
  const rowLevel = compiled.filter(cf => cf.ast && !isAggregate(cf.ast));
  if (!rowLevel.length) return data;
  return data.map(row => {
    const newRow = { ...row };
    for (const cf of rowLevel) {
      try { newRow[cf.name] = evalRow(cf.ast, newRow); }
      catch { newRow[cf.name] = null; }
    }
    return newRow;
  });
}

module.exports = {
  compile, validate, evalRow, evalAggregate, isAggregate,
  applyCalculatedFields, collectFieldRefs,
};
