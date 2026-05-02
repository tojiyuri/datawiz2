import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { GitBranch, ChevronRight, Sparkles, ArrowLeft, Hash, Activity, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

/**
 * DecompositionTreePage — interactive root-cause drill-down.
 *
 * Pick a measure (Sales). See total. Click a dimension to split (Region).
 * See child breakdown. Click a child to make it a new sub-root and split
 * again by another dim (Product). And so on.
 *
 * Tree state lives in component state — the server is stateless. Every
 * expand emits a fresh request with the current path.
 */
export default function DecompositionTreePage({ dataset, analysis }) {
  const navigate = useNavigate();
  const [measure, setMeasure] = useState('');
  const [agg, setAgg] = useState('sum');
  const [loading, setLoading] = useState(false);
  // The tree is represented as a list of "levels" — each level shows children
  // grouped by a single dimension. Clicking a child commits a new path
  // segment and pushes a new level.
  const [levels, setLevels] = useState([]);   // [{ path, dimension, parentValue, children, suggestions }]
  const [rootValue, setRootValue] = useState(null);

  const numericCols = useMemo(() =>
    (analysis?.columns || []).filter(c => {
      if (c.type !== 'numeric' && c.type !== 'integer') return false;
      const nameL = (c.name || '').toLowerCase();
      if (/^id$|_id$|^uuid|guid|postal|zip$/.test(nameL)) return false;
      return true;
    }), [analysis]);

  const start = async (m) => {
    if (!m || !dataset?.id) return;
    setMeasure(m);
    setLoading(true);
    setLevels([]);
    setRootValue(null);
    try {
      const r = await api.decompRoot(dataset.id, { measure: m, agg, path: [] });
      setRootValue(r.root);
      setLevels([{ path: [], suggestions: r.suggestions, awaitingDim: true }]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load root');
    } finally {
      setLoading(false);
    }
  };

  /** Expand the deepest level by a chosen dimension. */
  const expandBy = async (levelIdx, dimension) => {
    setLoading(true);
    try {
      const path = levels[levelIdx].path;
      const r = await api.decompExpand(dataset.id, {
        path, dimension, measure, agg, maxChildren: 10,
      });
      // Replace this level with the expanded version
      const newLevel = {
        path,
        dimension,
        parentValue: r.parentValue,
        children: r.children,
        truncated: r.truncated,
        truncatedShown: r.truncatedShown,
        totalGroups: r.totalGroups,
        childSuggestions: r.childSuggestions || {},
      };
      setLevels(prev => [...prev.slice(0, levelIdx), newLevel]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Expand failed');
    } finally {
      setLoading(false);
    }
  };

  /** User clicks a child cell — push a new level prompting for next dim. */
  const drillInto = (levelIdx, child) => {
    // Trim everything below this level, then push a new "awaiting dim" level
    // for the chosen child.
    setLevels(prev => [
      ...prev.slice(0, levelIdx + 1),
      {
        path: child.path,
        suggestions: prev[levelIdx].childSuggestions?.[child.value] || [],
        awaitingDim: true,
        parentChip: child,
      },
    ]);
  };

  /** User clicks a breadcrumb to go back to that level. */
  const truncateTo = (levelIdx) => {
    setLevels(prev => prev.slice(0, levelIdx + 1));
  };

  if (!dataset || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-text-tertiary">
        <GitBranch size={40} strokeWidth={1.25} className="mb-4 opacity-40"/>
        <p className="text-sm font-body mb-3">No dataset loaded.</p>
        <button onClick={() => navigate('/')} className="btn-secondary text-xs">Upload a file</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs text-wiz-tertiary hover:text-wiz-text mb-3 font-mono">
        <ArrowLeft size={12} /> Back
      </button>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <p className="eyebrow mb-3">Decomposition Tree</p>
        <h1 className="h1 mb-2">
          Show me <span className="italic text-wiz-accent">where it comes from</span>.
        </h1>
        <p className="text-base text-wiz-text-secondary max-w-2xl">
          Pick a number. Click a dimension to break it down. Click a value to drill further. Each split shows what's actually driving the total.
        </p>
      </motion.div>

      {/* Measure picker */}
      <div className="card p-4 mb-6">
        <p className="eyebrow mb-2">Measure</p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {numericCols.map(c => (
            <button
              key={c.name}
              onClick={() => start(c.name)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors
                ${measure === c.name
                  ? 'bg-wiz-accent text-wiz-bg border-wiz-accent'
                  : 'bg-wiz-surface text-wiz-text-secondary border-wiz-border hover:border-wiz-border-strong'}
              `}
            >
              <Hash size={11} strokeWidth={1.75}/>
              {c.name}
            </button>
          ))}
        </div>
        {measure && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-wiz-text-tertiary">Aggregation:</p>
            {['sum', 'avg', 'count', 'min', 'max'].map(a => (
              <button
                key={a}
                onClick={() => { setAgg(a); start(measure); }}
                className={`px-2 py-0.5 rounded text-xs font-mono uppercase tracking-wider ${
                  agg === a ? 'text-wiz-accent' : 'text-wiz-text-tertiary hover:text-wiz-text-secondary'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Root value */}
      {rootValue && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4"
        >
          <div className="flex items-baseline gap-3">
            <p className="eyebrow">Total {agg.toUpperCase()} of {measure}</p>
            <p className="text-xs text-wiz-text-tertiary font-mono">across {rootValue.count.toLocaleString()} rows</p>
          </div>
          <p className="h1 mt-1">{fmtNumber(rootValue.value)}</p>
        </motion.div>
      )}

      {/* Breadcrumb path */}
      {levels.length > 0 && levels.some(l => l.path.length > 0) && (
        <div className="flex items-center flex-wrap gap-1 mb-4 text-xs text-wiz-text-tertiary">
          <span>Path:</span>
          {levels.map((l, i) => (
            l.path.length > 0 && (
              <button
                key={i}
                onClick={() => truncateTo(i)}
                className="px-2 py-0.5 rounded bg-wiz-surface text-wiz-text-secondary hover:text-wiz-accent font-mono"
              >
                {l.path[l.path.length - 1].dim} = {l.path[l.path.length - 1].value}
              </button>
            )
          )).filter(Boolean).reduce((acc, el, i) => {
            if (i > 0) acc.push(<ChevronRight key={`sep${i}`} size={11} className="opacity-40" />);
            acc.push(el);
            return acc;
          }, [])}
        </div>
      )}

      {/* Levels */}
      <div className="space-y-4">
        <AnimatePresence>
          {levels.map((level, idx) => (
            <Level
              key={idx}
              level={level}
              measure={measure}
              isLast={idx === levels.length - 1}
              loading={loading && idx === levels.length - 1}
              onPickDim={(dim) => expandBy(idx, dim)}
              onDrillInto={(child) => drillInto(idx, child)}
              allColumns={analysis.columns}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Level({ level, measure, isLast, loading, onPickDim, onDrillInto, allColumns }) {
  // "Awaiting dim" means we have a path but haven't picked a split yet.
  // Show suggestions + a manual picker.
  if (level.awaitingDim) {
    const candidateCols = allColumns.filter(c => {
      const used = new Set(level.path.map(p => p.dim));
      if (used.has(c.name)) return false;
      if (c.name === measure) return false;
      const nameL = (c.name || '').toLowerCase();
      if (/^id$|_id$|^uuid|guid$/.test(nameL)) return false;
      return c.type === 'categorical' || c.type === 'string';
    });

    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        className="card p-4"
      >
        <div className="flex items-center gap-2 mb-3">
          <p className="eyebrow">Split by</p>
          {loading && <Loader2 size={11} className="animate-spin text-wiz-accent"/>}
        </div>

        {/* AI-suggested dims */}
        {level.suggestions?.length > 0 && (
          <div className="mb-3 pb-3 border-b border-wiz-border">
            <p className="text-2xs text-wiz-tertiary uppercase tracking-wider mb-2 flex items-center gap-1">
              <Sparkles size={10} strokeWidth={2} className="text-wiz-accent"/>
              Suggested splits
            </p>
            <div className="space-y-1.5">
              {level.suggestions.map((s, i) => (
                <button
                  key={s.dim}
                  onClick={() => onPickDim(s.dim)}
                  disabled={loading}
                  className="w-full text-left px-3 py-2 rounded-md bg-wiz-surface hover:bg-wiz-card border border-wiz-border hover:border-wiz-accent transition-colors group disabled:opacity-50"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-wiz-text">{s.dim}</span>
                    <span className="text-2xs font-mono text-wiz-tertiary">score {s.score.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-wiz-text-tertiary mt-0.5">{s.reason}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* All other dims */}
        <p className="text-2xs text-wiz-tertiary uppercase tracking-wider mb-2">All dimensions</p>
        <div className="flex flex-wrap gap-1.5">
          {candidateCols.map(c => (
            <button
              key={c.name}
              onClick={() => onPickDim(c.name)}
              disabled={loading}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-wiz-surface text-wiz-text-secondary border border-wiz-border hover:border-wiz-border-strong disabled:opacity-50"
            >
              {c.name}
            </button>
          ))}
        </div>
      </motion.div>
    );
  }

  // Otherwise: show children of an expanded split
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="card p-4"
    >
      <div className="flex items-baseline justify-between mb-3">
        <p className="eyebrow">By {level.dimension}</p>
        <p className="text-2xs text-wiz-text-tertiary font-mono">
          {level.truncatedShown || level.children.length} of {level.totalGroups}
          {level.truncated && ' (truncated)'}
        </p>
      </div>
      <div className="space-y-1.5">
        {level.children.map(c => {
          const sharePct = c.share != null ? Math.abs(c.share * 100) : 0;
          return (
            <button
              key={c.value}
              onClick={() => onDrillInto(c)}
              className="w-full text-left group"
            >
              <div className="px-3 py-2 rounded-md hover:bg-wiz-card transition-colors">
                <div className="flex items-baseline gap-3 mb-1">
                  <span className="text-sm font-medium text-wiz-text flex-1 truncate">{c.value}</span>
                  <span className="text-xs text-wiz-text-tertiary font-mono tabular-nums">
                    {c.count.toLocaleString()} rows
                  </span>
                  <span className="text-base font-display font-semibold text-wiz-accent tabular-nums w-24 text-right">
                    {fmtNumber(c.measureValue)}
                  </span>
                  {c.share != null && (
                    <span className="text-xs text-wiz-text-tertiary font-mono tabular-nums w-12 text-right">
                      {(c.share * 100).toFixed(1)}%
                    </span>
                  )}
                  <ChevronRight size={13} className="text-wiz-tertiary group-hover:text-wiz-accent" />
                </div>
                <div className="h-1 bg-wiz-card rounded-full overflow-hidden ml-0">
                  <div
                    className="h-full bg-wiz-accent rounded-full transition-all"
                    style={{ width: `${sharePct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function fmtNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  if (Math.abs(v) >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 10_000) return (v / 1000).toFixed(1) + 'K';
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, '');
}
