/**
 * VisualizationMemory - Long-term episodic memory for charts.
 *
 * Stores every chart Data Wiz has ever generated, with:
 *   - chart spec (type, x, y, aggregation, etc.)
 *   - dataset shape fingerprint (column types, counts)
 *   - column name signatures (for cross-dataset transfer)
 *   - feedback history (accepts, dismisses)
 *   - source dataset name + when it was created
 *
 * On every new dataset:
 *   1. Computes similarity between current dataset and past memories
 *   2. Boosts charts that performed well in similar contexts
 *   3. Returns "you've made this before" suggestions
 *
 * Persisted to disk, capped at 1000 entries (oldest first eviction).
 */
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '../data/memory.json');
const MAX_MEMORIES = 1000;

const INITIAL = {
  version: '1.0',
  memories: [],
  stats: { totalRecorded: 0, totalAccepts: 0, totalDismisses: 0, datasetsTouched: 0 },
  updatedAt: new Date().toISOString(),
};

function ensureDir() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(INITIAL, null, 2));
      return JSON.parse(JSON.stringify(INITIAL));
    }
    const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    if (!data.memories) data.memories = [];
    if (!data.stats) data.stats = { ...INITIAL.stats };
    return data;
  } catch (err) {
    console.error('Memory load error:', err.message);
    return JSON.parse(JSON.stringify(INITIAL));
  }
}

function save(state) {
  try {
    ensureDir();
    state.updatedAt = new Date().toISOString();
    // Cap memories at MAX
    if (state.memories.length > MAX_MEMORIES) {
      state.memories = state.memories.slice(-MAX_MEMORIES);
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(state));
  } catch (err) { console.error('Memory save error:', err.message); }
}

// Fingerprint a dataset by column types and semantic hints
function fingerprint(columns) {
  const num = columns.filter(c => c.type === 'numeric');
  const cat = columns.filter(c => c.type === 'categorical');
  const time = columns.filter(c => c.type === 'temporal');
  return {
    numCount: num.length,
    catCount: cat.length,
    timeCount: time.length,
    columnNames: columns.map(c => c.name.toLowerCase()),
    columnTypes: columns.reduce((acc, c) => { acc[c.name.toLowerCase()] = c.type; return acc; }, {}),
    semantics: columns.map(c => c.semantic).filter(Boolean),
    rowCountBucket: bucketRows(columns[0]?.stats?.count || 0),
  };
}

function bucketRows(n) {
  if (n < 50) return 'tiny';
  if (n < 500) return 'small';
  if (n < 5000) return 'medium';
  if (n < 50000) return 'large';
  return 'huge';
}

// Jaccard similarity between two arrays of strings
function jaccard(a, b) {
  const setA = new Set(a), setB = new Set(b);
  const inter = [...setA].filter(x => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

// Compute similarity between current dataset and a memory's dataset
function similarity(currFp, memFp) {
  if (!memFp) return 0;

  // Shape similarity: numCount, catCount, timeCount match
  const shapeScore =
    (currFp.numCount === memFp.numCount ? 0.25 : currFp.numCount > 0 && memFp.numCount > 0 ? 0.15 : 0) +
    (currFp.catCount === memFp.catCount ? 0.20 : currFp.catCount > 0 && memFp.catCount > 0 ? 0.10 : 0) +
    (currFp.timeCount === memFp.timeCount ? 0.15 : 0);

  // Column name overlap (how many column names match)
  const nameSim = jaccard(currFp.columnNames, memFp.columnNames || []) * 0.30;

  // Semantic overlap (currency/percent/date hints)
  const semSim = jaccard(currFp.semantics, memFp.semantics || []) * 0.10;

  return Math.min(1, shapeScore + nameSim + semSim);
}

// ─── PUBLIC API ─────────────────────────────────────────────────

/**
 * Record that a chart was generated for a dataset.
 * If we've seen this exact (chartType, x, y) in this dataset → bump count.
 * Otherwise create a new memory entry.
 */
function recordChart(spec, columns, datasetId, datasetName) {
  const state = load();
  const fp = fingerprint(columns);

  // Find existing memory for same chart on same dataset
  const existing = state.memories.find(m =>
    m.datasetId === datasetId &&
    m.chartType === spec.type &&
    m.x === spec.x && m.y === spec.y
  );

  if (existing) {
    existing.viewedCount = (existing.viewedCount || 0) + 1;
    existing.lastSeenAt = new Date().toISOString();
  } else {
    state.memories.push({
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      datasetId,
      datasetName: datasetName || 'untitled',
      chartType: spec.type,
      title: spec.title,
      x: spec.x, y: spec.y, y2: spec.y2,
      stack: spec.stack, size: spec.size,
      category: spec.category, value: spec.value,
      aggregation: spec.aggregation,
      tags: spec.tags || [],
      fingerprint: fp,
      accepts: 0,
      dismisses: 0,
      viewedCount: 1,
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    state.stats.totalRecorded = (state.stats.totalRecorded || 0) + 1;
  }
  save(state);
}

/**
 * Record positive/negative feedback on a specific chart.
 */
function recordFeedback(spec, columns, datasetId, action) {
  const state = load();
  const memEntry = state.memories.find(m =>
    m.datasetId === datasetId &&
    m.chartType === spec.type &&
    m.x === spec.x && m.y === spec.y
  );
  if (memEntry) {
    if (action === 'accept') {
      memEntry.accepts = (memEntry.accepts || 0) + 1;
      state.stats.totalAccepts = (state.stats.totalAccepts || 0) + 1;
    } else {
      memEntry.dismisses = (memEntry.dismisses || 0) + 1;
      state.stats.totalDismisses = (state.stats.totalDismisses || 0) + 1;
    }
    save(state);
  }
}

/**
 * Compute boosts for chart types based on memory of similar datasets.
 *
 * For each past memory:
 *   - Compute similarity to current dataset
 *   - If similar (>0.3) and well-rated (more accepts than dismisses), boost that chart type
 *   - Penalize chart types that were dismissed in similar contexts
 *
 * Returns: { boosts: { 'bar': 1.2, 'line': 0.9, ... }, similarMemoriesCount: N }
 */
function getMemoryBoosts(columns) {
  const state = load();
  const fp = fingerprint(columns);
  const typeStats = {}; // chartType -> { totalScore, totalWeight }
  let similarCount = 0;

  for (const mem of state.memories) {
    const sim = similarity(fp, mem.fingerprint);
    if (sim < 0.3) continue;
    similarCount++;

    const accepts = mem.accepts || 0;
    const dismisses = mem.dismisses || 0;
    const total = accepts + dismisses;
    let perfScore;
    if (total === 0) {
      perfScore = 0;       // no signal — viewed but not rated
    } else {
      perfScore = (accepts - dismisses) / total; // -1 to +1
    }

    const weight = sim;
    if (!typeStats[mem.chartType]) typeStats[mem.chartType] = { totalScore: 0, totalWeight: 0, count: 0 };
    typeStats[mem.chartType].totalScore += perfScore * weight;
    typeStats[mem.chartType].totalWeight += weight;
    typeStats[mem.chartType].count += 1;
  }

  const boosts = {};
  for (const [type, st] of Object.entries(typeStats)) {
    const avg = st.totalWeight > 0 ? st.totalScore / st.totalWeight : 0;
    // Map avg [-1, +1] to multiplier [0.7, 1.4]
    boosts[type] = 1 + avg * 0.4;
    boosts[type] = Math.max(0.7, Math.min(1.4, boosts[type]));
  }

  return { boosts, similarMemoriesCount: similarCount };
}

/**
 * Get top N most relevant past visualizations for the current dataset.
 * Used to surface "you've made charts like this before" cards on the dashboard.
 */
function getTopMemories(columns, limit = 5) {
  const state = load();
  const fp = fingerprint(columns);

  return state.memories
    .map(m => ({
      ...m,
      similarity: similarity(fp, m.fingerprint),
      score: (m.accepts || 0) - (m.dismisses || 0) + (m.viewedCount || 0) * 0.1,
    }))
    .filter(m => m.similarity >= 0.3)
    .sort((a, b) => b.similarity * 0.6 + b.score * 0.4 - (a.similarity * 0.6 + a.score * 0.4))
    .slice(0, limit);
}

/**
 * Get all memories for a specific dataset, sorted by recency.
 */
function getDatasetMemories(datasetId) {
  const state = load();
  return state.memories
    .filter(m => m.datasetId === datasetId)
    .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
}

/**
 * Aggregate stats for the AI Brain page.
 */
function getStats() {
  const state = load();
  const memories = state.memories;
  const datasets = new Set(memories.map(m => m.datasetId));

  // Most accepted chart types
  const typeAccepts = {};
  memories.forEach(m => {
    typeAccepts[m.chartType] = (typeAccepts[m.chartType] || 0) + (m.accepts || 0);
  });
  const topTypes = Object.entries(typeAccepts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    stats: {
      ...state.stats,
      currentMemories: memories.length,
      datasetsTouched: datasets.size,
    },
    topAcceptedTypes: topTypes.map(([type, count]) => ({ type, count })),
    recentMemories: memories.slice(-15).reverse().map(m => ({
      id: m.id, chartType: m.chartType, title: m.title,
      datasetName: m.datasetName,
      accepts: m.accepts || 0, dismisses: m.dismisses || 0,
      viewedCount: m.viewedCount || 1,
      createdAt: m.createdAt,
    })),
    updatedAt: state.updatedAt,
  };
}

function reset() {
  save(JSON.parse(JSON.stringify(INITIAL)));
}

function deleteMemory(id) {
  const state = load();
  const before = state.memories.length;
  state.memories = state.memories.filter(m => m.id !== id);
  save(state);
  return before > state.memories.length;
}

module.exports = {
  recordChart, recordFeedback,
  getMemoryBoosts, getTopMemories, getDatasetMemories,
  getStats, reset, deleteMemory,
};
