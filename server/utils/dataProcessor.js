/**
 * DataProcessor v3 - Detects types AND subtypes for smarter chart recommendations.
 *
 * Subtypes (in addition to base types):
 *  - 'year'         → numeric/temporal column with values like 2023, 2024
 *  - 'month_name'   → temporal column with January, February, etc.
 *  - 'month_num'    → numeric 1-12
 *  - 'day_of_week'  → temporal Mon, Tue, etc.
 *  - 'identifier'   → numeric/text with sequential or unique IDs (don't aggregate)
 *  - 'coordinate'   → numeric latitude/longitude (don't aggregate as a metric)
 */

const STATS_SAMPLE_SIZE = 10000;

const IMAGE_URL_RE = /^(https?:\/\/.*\.(jpe?g|png|gif|webp|svg|bmp)(\?.*)?$)|^(data:image\/)/i;
const TEXT_LENGTH_THRESHOLD = 30;
const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','must','can','this','that','these','those','i','you','he','she','it','we','they','what','which','who','whom','whose','if','then','than','so','as']);

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_ABBR = ['jan','feb','mar','apr','may','jun','jul','aug','sep','sept','oct','nov','dec'];
const DAY_NAMES = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const DAY_ABBR = ['mon','tue','tues','wed','thu','thur','thurs','fri','sat','sun'];

class DataProcessor {
  static sample(arr, n = STATS_SAMPLE_SIZE) {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  static detectColumnType(values, columnName = '') {
    const sample = values.filter(v => v !== null && v !== undefined && v !== '').slice(0, 200);
    if (sample.length === 0) return { type: 'unknown' };

    const colLower = columnName.toLowerCase();
    const sampleStr = sample.map(v => String(v).toLowerCase().trim());

    // ─── IMAGE URLs (highest priority) ───
    const imgCount = sample.filter(v => IMAGE_URL_RE.test(String(v))).length;
    if (imgCount / sample.length > 0.7) return { type: 'image' };

    // ─── COORDINATE detection (latitude/longitude) ───
    if (/lat|latitude|lng|long|longitude/i.test(colLower)) {
      const numCount = sample.filter(v => !isNaN(Number(v))).length;
      if (numCount / sample.length > 0.8) {
        return { type: 'numeric', subtype: 'coordinate' };
      }
    }

    // ─── MONTH NAMES ("January", "Jan", "March") ───
    const monthMatchCount = sampleStr.filter(v => MONTH_NAMES.includes(v) || MONTH_ABBR.includes(v)).length;
    if (monthMatchCount / sample.length > 0.8) {
      return { type: 'temporal', subtype: 'month_name' };
    }

    // ─── DAY OF WEEK names ───
    const dayMatchCount = sampleStr.filter(v => DAY_NAMES.includes(v) || DAY_ABBR.includes(v)).length;
    if (dayMatchCount / sample.length > 0.8) {
      return { type: 'temporal', subtype: 'day_of_week' };
    }

    // ─── NUMERIC detection ───
    const numCount = sample.filter(v => !isNaN(Number(v)) && String(v).trim() !== '').length;
    if (numCount / sample.length > 0.8) {
      const nums = sample.map(Number).filter(n => !isNaN(n));
      const allInt = nums.every(n => Number.isInteger(n));
      const minV = Math.min(...nums), maxV = Math.max(...nums);

      // YEAR detection — column name is the strongest signal
      // If column is literally called "year" or "yr", treat as temporal regardless of allInt
      if (/^year$|^yr$/i.test(colLower)) {
        // Even if some values are weird, if most are in 1800-2200 range, it's a year column
        const yearLike = nums.filter(n => n >= 1800 && n <= 2200).length;
        if (yearLike / nums.length > 0.7) return { type: 'temporal', subtype: 'year' };
      }
      // No name match — but values look like years and span fits
      if (allInt && minV >= 1900 && maxV <= 2100 && (maxV - minV) <= 100) {
        return { type: 'temporal', subtype: 'year' };
      }

      // MONTH NUMBER (1-12)
      if (allInt && /^month$|^mo$/i.test(colLower) && minV >= 1 && maxV <= 12) {
        return { type: 'temporal', subtype: 'month_num' };
      }

      // QUARTER (1-4 with name "quarter" or "q")
      if (allInt && /^q$|^quarter$|^qtr$/i.test(colLower) && minV >= 1 && maxV <= 4) {
        return { type: 'temporal', subtype: 'quarter' };
      }

      // IDENTIFIER detection (column name "id", "_id", or sequential unique integers)
      const idPatternMatch = /(_id$|^id$|^.+_id$|^id_|number$|^code$|^key$|index$)/i.test(colLower);
      const uniqueRatio = new Set(sample).size / sample.length;
      if (idPatternMatch && uniqueRatio > 0.9) {
        return { type: 'numeric', subtype: 'identifier' };
      }
      // Sequential integers — require BOTH high uniqueness AND truly sequential (sorted ≈ original within tolerance)
      // This avoids classifying random-but-unique numbers (like Sales values) as IDs
      if (allInt && uniqueRatio > 0.95 && sample.length > 20) {
        const sorted = [...sample].sort((a, b) => a - b);
        // Check if sorted values increase by ~1 each (sequential ID pattern)
        let seqLike = true, gaps = 0;
        for (let k = 1; k < sorted.length; k++) {
          if (sorted[k] - sorted[k-1] > 5) gaps++;
        }
        if (gaps / sorted.length < 0.05) {
          return { type: 'numeric', subtype: 'identifier' };
        }
      }

      return { type: 'numeric' };
    }

    // ─── TEMPORAL: ISO/standard date patterns ───
    const datePatterns = [/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/, /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/, /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i];
    const dateCount = sample.filter(v => datePatterns.some(p => p.test(String(v)))).length;
    if (dateCount / sample.length > 0.6) return { type: 'temporal' };

    // ─── GEOGRAPHIC ───
    const geoCount = sample.filter(v => isLikelyGeographic(String(v))).length;
    const isGeoColumn = geoCount / sample.length > 0.5;

    // ─── TEXT ───
    const avgLen = sample.reduce((s, v) => s + String(v).length, 0) / sample.length;
    const wordCounts = sample.map(v => String(v).split(/\s+/).length);
    const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
    const unique = new Set(sample.map(String));
    const uniqueRatio = unique.size / sample.length;

    if (avgLen > TEXT_LENGTH_THRESHOLD && avgWords > 3 && uniqueRatio > 0.5) return { type: 'text' };

    // High uniqueness with medium length → identifier
    if (uniqueRatio > 0.9 && avgLen > 10 && !isGeoColumn) return { type: 'text', subtype: 'identifier' };

    // ─── CATEGORICAL ───
    if (uniqueRatio < 0.3 || unique.size <= 50 || isGeoColumn) return { type: 'categorical' };

    return { type: 'text' };
  }

  static computeStats(values, type, columnName, subtype) {
    const sampledValues = type === 'numeric' ? values : this.sample(values, STATS_SAMPLE_SIZE);
    const clean = sampledValues.filter(v => v !== null && v !== undefined && v !== '');
    const nullCount = values.filter(v => v === null || v === undefined || v === '').length;
    const nullPct = (nullCount / values.length) * 100;
    const R = (n, p = 2) => n == null || isNaN(n) ? n : Math.round(n * Math.pow(10, p)) / Math.pow(10, p);

    if (type === 'numeric') {
      const nums = clean.map(Number).filter(v => !isNaN(v));
      if (!nums.length) return { count: 0, nullCount, nullPercentage: nullPct, subtype };
      const sorted = [...nums].sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
      const stdDev = Math.sqrt(variance);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      const lowerFence = q1 - 1.5 * iqr;
      const upperFence = q3 + 1.5 * iqr;
      const outliers = nums.filter(v => v < lowerFence || v > upperFence);
      const skewness = stdDev > 0 ? nums.reduce((s, v) => s + ((v - mean) / stdDev) ** 3, 0) / nums.length : 0;

      const min = sorted[0], max = sorted[sorted.length - 1], range = max - min;
      const binCount = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(nums.length))));
      const binWidth = range / binCount;
      const histogram = [];
      if (binWidth > 0) {
        for (let i = 0; i < binCount; i++) {
          const start = min + i * binWidth, end = i === binCount - 1 ? max : start + binWidth;
          histogram.push({ bin: `${R(start)}-${R(end)}`, count: nums.filter(v => v >= start && v < end + (i === binCount - 1 ? 1e-9 : 0)).length, range: [R(start), R(end)] });
        }
      }

      return {
        count: nums.length, sum: R(sum), mean: R(mean), median: R(sorted[Math.floor(sorted.length / 2)]),
        min, max, range: R(range), stdDev: R(stdDev), variance: R(variance),
        q1: R(q1), q3: R(q3), iqr: R(iqr), skewness: R(skewness),
        outlierCount: outliers.length, lowerFence: R(lowerFence), upperFence: R(upperFence),
        histogram, nullCount, nullPercentage: nullPct, subtype,
      };
    }

    if (type === 'categorical') {
      const freq = {};
      clean.forEach(v => { freq[String(v)] = (freq[String(v)] || 0) + 1; });
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
      const isGeo = clean.length && clean.slice(0, 50).filter(v => isLikelyGeographic(String(v))).length / Math.min(50, clean.length) > 0.5;
      return {
        count: clean.length, unique: Object.keys(freq).length,
        topCategories: sorted.slice(0, 15).map(([name, count]) => ({ name, count, percentage: Math.round((count / clean.length) * 10000) / 100 })),
        mode: sorted[0]?.[0] || null, modeFrequency: sorted[0]?.[1] || 0,
        isGeographic: isGeo,
        nullCount, nullPercentage: nullPct, subtype,
      };
    }

    if (type === 'temporal') {
      // For year subtype, treat numerically
      if (subtype === 'year') {
        const years = clean.map(Number).filter(v => !isNaN(v));
        const sorted = [...years].sort((a, b) => a - b);
        return {
          count: years.length, unique: new Set(years).size,
          earliest: sorted[0], latest: sorted[sorted.length - 1],
          spanYears: sorted.length >= 2 ? sorted[sorted.length - 1] - sorted[0] : 0,
          nullCount, nullPercentage: nullPct, subtype,
        };
      }
      // For month_name subtype, just count by month
      if (subtype === 'month_name' || subtype === 'day_of_week' || subtype === 'month_num') {
        return {
          count: clean.length, unique: new Set(clean.map(String)).size,
          nullCount, nullPercentage: nullPct, subtype,
        };
      }
      // Standard date
      const dates = clean.map(v => new Date(v)).filter(d => !isNaN(d.getTime())).sort((a, b) => a - b);
      return {
        count: clean.length,
        earliest: dates[0]?.toISOString(),
        latest: dates[dates.length - 1]?.toISOString(),
        spanDays: dates.length >= 2 ? Math.round((dates[dates.length - 1] - dates[0]) / 86400000) : 0,
        unique: new Set(clean.map(String)).size,
        nullCount, nullPercentage: nullPct, subtype,
      };
    }

    if (type === 'text') {
      const allWords = [];
      const lengths = [];
      clean.forEach(v => {
        const str = String(v);
        lengths.push(str.length);
        const words = str.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
        allWords.push(...words);
      });
      const wordFreq = {};
      allWords.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
      const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([word, count]) => ({ word, count }));
      const avgLen = lengths.reduce((s, n) => s + n, 0) / Math.max(1, lengths.length);
      const lengthHistogram = [];
      const sortedLens = [...lengths].sort((a, b) => a - b);
      const lmin = sortedLens[0] || 0, lmax = sortedLens[sortedLens.length - 1] || 0;
      const lRange = lmax - lmin;
      if (lRange > 0) {
        const lBins = 8;
        const lBinW = lRange / lBins;
        for (let i = 0; i < lBins; i++) {
          const start = lmin + i * lBinW, end = i === lBins - 1 ? lmax : start + lBinW;
          lengthHistogram.push({ bin: `${Math.round(start)}-${Math.round(end)}`, count: lengths.filter(L => L >= start && L < end + (i === lBins - 1 ? 1e-9 : 0)).length });
        }
      }
      return {
        count: clean.length, unique: new Set(clean.map(String)).size,
        avgLength: Math.round(avgLen),
        topWords, lengthHistogram,
        nullCount, nullPercentage: nullPct, subtype,
      };
    }

    if (type === 'image') {
      return {
        count: clean.length, unique: new Set(clean.map(String)).size,
        sampleUrls: clean.slice(0, 8).map(String),
        nullCount, nullPercentage: nullPct, subtype,
      };
    }

    return { count: clean.length, nullCount, nullPercentage: nullPct, subtype };
  }

  static computeCorrelations(data, numericColumns) {
    if (numericColumns.length < 2) return [];
    const sampled = this.sample(data, STATS_SAMPLE_SIZE);
    const results = [];
    for (let i = 0; i < numericColumns.length; i++) {
      for (let j = i + 1; j < numericColumns.length; j++) {
        const pairs = sampled.map(r => [Number(r[numericColumns[i]]), Number(r[numericColumns[j]])]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
        if (pairs.length < 5) continue;
        const n = pairs.length;
        const sx = pairs.reduce((s, [x]) => s + x, 0), sy = pairs.reduce((s, [, y]) => s + y, 0);
        const sxy = pairs.reduce((s, [x, y]) => s + x * y, 0);
        const sx2 = pairs.reduce((s, [x]) => s + x * x, 0), sy2 = pairs.reduce((s, [, y]) => s + y * y, 0);
        const den = Math.sqrt((n * sx2 - sx ** 2) * (n * sy2 - sy ** 2));
        const r = den === 0 ? 0 : (n * sxy - sx * sy) / den;
        results.push({ column1: numericColumns[i], column2: numericColumns[j], correlation: Math.round(r * 1000) / 1000, strength: Math.abs(r) > 0.7 ? 'strong' : Math.abs(r) > 0.4 ? 'moderate' : 'weak' });
      }
    }
    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }

  static detectIssues(data, columns) {
    const issues = [];
    const total = data.length;
    columns.forEach(col => {
      const vals = data.map(r => r[col.name]);
      const nulls = vals.filter(v => v === null || v === undefined || v === '').length;
      const nullPct = (nulls / total) * 100;
      if (nulls > 0) {
        issues.push({ type: 'missing_values', column: col.name, severity: nullPct > 30 ? 'high' : nullPct > 10 ? 'medium' : 'low', count: nulls, percentage: Math.round(nullPct * 100) / 100, message: `${nulls} missing values (${Math.round(nullPct)}%)`, fixes: col.type === 'numeric' ? ['fill_mean', 'fill_median', 'fill_zero', 'drop_rows'] : ['fill_mode', 'fill_custom', 'drop_rows'] });
      }
      if (col.type === 'categorical' || col.type === 'text') {
        const clean = vals.filter(v => v != null && v !== '');
        const wsCount = clean.filter(v => String(v) !== String(v).trim()).length;
        if (wsCount > 0) issues.push({ type: 'whitespace', column: col.name, severity: 'low', count: wsCount, message: `${wsCount} values with extra whitespace`, fixes: ['trim_whitespace'] });
        if (col.type === 'categorical') {
          const map = {};
          clean.forEach(v => { const l = String(v).toLowerCase().trim(); if (!map[l]) map[l] = new Set(); map[l].add(String(v)); });
          const inconsistent = Object.entries(map).filter(([, s]) => s.size > 1);
          if (inconsistent.length > 0) {
            const example = [...inconsistent[0][1]].join(', ');
            issues.push({ type: 'inconsistent_casing', column: col.name, severity: 'medium', count: inconsistent.length, message: `${inconsistent.length} groups with mixed casing (e.g. ${example})`, fixes: ['lowercase', 'uppercase', 'titlecase'] });
          }
        }
      }
      if (col.type === 'numeric' && col.stats?.outlierCount > 0) {
        const oc = col.stats.outlierCount;
        const sev = oc > total * 0.05 ? 'medium' : 'low';
        issues.push({ type: 'outliers', column: col.name, severity: sev, count: oc, message: `${oc} outliers detected (${Math.round((oc / total) * 100)}% of values)`, fixes: ['cap_outliers', 'remove_outliers'] });
      }
    });
    const dupCount = data.length - new Set(data.map(r => JSON.stringify(r))).size;
    if (dupCount > 0) issues.push({ type: 'duplicate_rows', column: '_all_', severity: dupCount > total * 0.1 ? 'medium' : 'low', count: dupCount, message: `${dupCount} duplicate rows`, fixes: ['remove_duplicate_rows'] });
    return issues;
  }

  static applyCleaningOperation(data, columns, op) {
    const { action, column, params = {} } = op;
    let result = [...data]; let affectedCount = 0; const col = columns.find(c => c.name === column);
    switch (action) {
      case 'fill_mean': case 'fill_median': case 'fill_zero': {
        const fillVal = action === 'fill_zero' ? 0 : action === 'fill_mean' ? col?.stats?.mean : col?.stats?.median;
        result = result.map(r => { if (r[column] == null || r[column] === '') { affectedCount++; return { ...r, [column]: fillVal }; } return r; });
        break;
      }
      case 'fill_mode': {
        result = result.map(r => { if (r[column] == null || r[column] === '') { affectedCount++; return { ...r, [column]: col?.stats?.mode }; } return r; });
        break;
      }
      case 'fill_custom': {
        const v = params.value ?? '';
        result = result.map(r => { if (r[column] == null || r[column] === '') { affectedCount++; return { ...r, [column]: v }; } return r; });
        break;
      }
      case 'drop_rows': {
        const before = result.length;
        result = result.filter(r => !(r[column] == null || r[column] === ''));
        affectedCount = before - result.length;
        break;
      }
      case 'trim_whitespace': {
        result = result.map(r => { if (r[column] != null) { const t = String(r[column]).trim(); if (t !== String(r[column])) { affectedCount++; return { ...r, [column]: t }; } } return r; });
        break;
      }
      case 'lowercase': case 'uppercase': case 'titlecase': {
        const fn = action === 'lowercase' ? s => s.toLowerCase() : action === 'uppercase' ? s => s.toUpperCase() : s => s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
        result = result.map(r => { if (r[column] != null) { const o = String(r[column]); const n = fn(o); if (n !== o) { affectedCount++; return { ...r, [column]: n }; } } return r; });
        break;
      }
      case 'cap_outliers': case 'remove_outliers': {
        if (col?.type === 'numeric' && col.stats) {
          const { lowerFence, upperFence } = col.stats;
          if (action === 'cap_outliers') {
            result = result.map(r => { const v = Number(r[column]); if (!isNaN(v)) { if (v < lowerFence) { affectedCount++; return { ...r, [column]: lowerFence }; } if (v > upperFence) { affectedCount++; return { ...r, [column]: upperFence }; } } return r; });
          } else {
            const before = result.length;
            result = result.filter(r => { const v = Number(r[column]); return isNaN(v) || (v >= lowerFence && v <= upperFence); });
            affectedCount = before - result.length;
          }
        }
        break;
      }
      case 'remove_duplicate_rows': {
        const seen = new Set(); const before = result.length;
        result = result.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
        affectedCount = before - result.length;
        break;
      }
      case 'drop_column': {
        result = result.map(r => { const { [column]: _, ...rest } = r; return rest; }); affectedCount = result.length;
        break;
      }
    }
    return { data: result, affectedCount, action, column };
  }

  static autoClean(data, columns) {
    const log = []; let cleaned = [...data];
    const seen = new Set(); const beforeDup = cleaned.length;
    cleaned = cleaned.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
    if (beforeDup - cleaned.length > 0) log.push({ action: 'Remove duplicates', affected: beforeDup - cleaned.length });
    columns.filter(c => c.type === 'categorical' || c.type === 'text').forEach(col => { let c = 0; cleaned.forEach(r => { if (r[col.name] != null) { const t = String(r[col.name]).trim(); if (t !== String(r[col.name])) { r[col.name] = t; c++; } } }); if (c) log.push({ action: `Trim whitespace in ${col.name}`, affected: c }); });
    columns.forEach(col => {
      if (col.type === 'numeric' && col.stats?.median != null) { let c = 0; cleaned.forEach(r => { if (r[col.name] == null || r[col.name] === '') { r[col.name] = col.stats.median; c++; } }); if (c) log.push({ action: `Fill nulls in ${col.name} with median`, affected: c }); }
      else if (col.type === 'categorical' && col.stats?.mode) { let c = 0; cleaned.forEach(r => { if (r[col.name] == null || r[col.name] === '') { r[col.name] = col.stats.mode; c++; } }); if (c) log.push({ action: `Fill nulls in ${col.name} with mode`, affected: c }); }
    });
    return { data: cleaned, log, originalCount: data.length, cleanedCount: cleaned.length };
  }

  static analyzeDataset(data) {
    if (!data || !data.length) return { error: 'Empty dataset' };
    const { getSemanticHint } = require('./knowledgeBase');
    const colNames = Object.keys(data[0]);
    const columns = colNames.map(name => {
      const values = data.map(r => r[name]);
      const detected = this.detectColumnType(values, name);
      const { type, subtype } = detected;
      const stats = this.computeStats(values, type, name, subtype);
      let semantic = getSemanticHint(name);
      if (!semantic && type === 'categorical' && stats?.isGeographic) semantic = 'geographic';
      return { name, type, subtype, semantic, stats };
    });
    const numCols = columns.filter(c => c.type === 'numeric' && c.subtype !== 'identifier' && c.subtype !== 'coordinate').map(c => c.name);
    const correlations = this.computeCorrelations(data, numCols);
    const issues = this.detectIssues(data, columns);
    const totalCells = data.length * columns.length;
    const nullCells = columns.reduce((s, c) => s + (c.stats.nullCount || 0), 0);
    return {
      summary: {
        rows: data.length, columns: columns.length,
        numericColumns: columns.filter(c => c.type === 'numeric').length,
        categoricalColumns: columns.filter(c => c.type === 'categorical').length,
        temporalColumns: columns.filter(c => c.type === 'temporal').length,
        textColumns: columns.filter(c => c.type === 'text').length,
        imageColumns: columns.filter(c => c.type === 'image').length,
        qualityScore: Math.round(((totalCells - nullCells) / totalCells) * 100),
        totalIssues: issues.length,
        highSeverityIssues: issues.filter(i => i.severity === 'high').length,
        sampledForStats: data.length > STATS_SAMPLE_SIZE,
      },
      columns, correlations, issues, preview: data.slice(0, 20),
    };
  }
}

// ─── Geographic detection helpers ───
const COUNTRIES = new Set(['usa','us','united states','uk','united kingdom','india','china','japan','germany','france','italy','spain','canada','australia','brazil','mexico','russia','south korea','indonesia','turkey','saudi arabia','argentina','south africa','egypt','nigeria','pakistan','bangladesh','vietnam','thailand','poland','sweden','norway','finland','denmark','netherlands','belgium','switzerland','austria','greece','portugal','ireland','singapore','malaysia','philippines','new zealand','sudan','south sudan','ethiopia','kenya','uganda','tanzania','ghana','morocco','algeria','tunisia','libya','iraq','iran','syria','lebanon','israel','jordan','yemen','afghanistan','myanmar','sri lanka','nepal','colombia','venezuela','peru','chile','ecuador','bolivia']);
const US_STATES = new Set(['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming','al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy']);
const IN_STATES = new Set(['maharashtra','gujarat','rajasthan','tamil nadu','karnataka','kerala','andhra pradesh','telangana','west bengal','uttar pradesh','bihar','punjab','haryana','delhi','goa','assam','odisha','madhya pradesh','jharkhand','chhattisgarh','uttarakhand','himachal pradesh']);
const MAJOR_CITIES = new Set(['mumbai','delhi','bangalore','bengaluru','hyderabad','chennai','kolkata','pune','ahmedabad','jaipur','new york','los angeles','chicago','houston','phoenix','philadelphia','san antonio','san diego','dallas','san jose','austin','seattle','boston','london','paris','tokyo','beijing','shanghai','sydney','toronto','dubai','singapore','hong kong','berlin','madrid','rome','khartoum','cairo','nairobi','lagos','johannesburg']);

function isLikelyGeographic(value) {
  const v = String(value).toLowerCase().trim();
  if (!v || v.length < 2 || v.length > 30) return false;
  return COUNTRIES.has(v) || US_STATES.has(v) || IN_STATES.has(v) || MAJOR_CITIES.has(v);
}

DataProcessor.isLikelyGeographic = isLikelyGeographic;
module.exports = DataProcessor;
