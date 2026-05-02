import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, TrendingUp, TrendingDown, AlertCircle, BarChart3, ScatterChart, Activity, Loader2, Zap, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

/**
 * InsightsFeed — proactive findings panel.
 *
 * Calls /api/analysis/:id/explore on mount to scan the dataset for findings.
 * Each finding renders as a card with:
 *   - Type icon (trend / outlier / concentration / correlation)
 *   - One-sentence headline (statistical, not editorial)
 *   - "Explore" button that creates a sheet from the finding's spec
 *
 * Severity is reflected in border accent color:
 *   - info: subtle wiz-border (default)
 *   - notable: amber
 *   - critical: rose (rare)
 *
 * The panel can be collapsed via the parent.
 */
export default function InsightsFeed({ dataset, onSheetCreated, compact = false }) {
  const navigate = useNavigate();
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!dataset?.id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.exploreDataset(dataset.id, { maxFindings: compact ? 5 : 10 });
      setFindings(r.findings || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [dataset?.id]);

  const exploreFinding = async (finding) => {
    if (!dataset?.id) return;
    try {
      const spec = finding.chartSpec || finding.spec;
      if (!spec) {
        toast.error('Finding has no chart spec to explore');
        return;
      }
      const r = await api.saveSheet(finding.title, dataset.id, spec);
      toast.success(`Created sheet: ${finding.title}`);
      if (onSheetCreated) onSheetCreated(r.sheet);
      else navigate(`/sheets/${r.sheet.id}`);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create sheet';
      toast.error(msg);
    }
  };

  if (!dataset?.id) return null;

  return (
    <div className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-wiz-border/30 bg-gradient-to-r from-wiz-accent/[0.08] to-transparent flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-wiz-accent" />
          <h3 className="text-[13px] font-display font-bold text-wiz-text">What's interesting?</h3>
          {findings.length > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-wiz-accent/15 text-wiz-accent">
              {findings.length} findings
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] font-mono text-wiz-muted hover:text-wiz-accent flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
          {loading ? 'scanning...' : 'rescan'}
        </button>
      </div>

      {loading && findings.length === 0 && (
        <div className="px-4 py-8 text-center">
          <Loader2 size={20} className="animate-spin mx-auto text-wiz-accent/60 mb-2" />
          <p className="text-[11px] text-wiz-muted">Wiz is scanning your data for patterns...</p>
        </div>
      )}

      {error && (
        <div className="px-4 py-4 flex items-start gap-2 text-rose-300">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
          <p className="text-[11px]">{error}</p>
        </div>
      )}

      {!loading && !error && findings.length === 0 && (
        <div className="px-4 py-6 text-center">
          <p className="text-[11px] text-wiz-muted">
            No standout patterns found. Try uploading data with more variety.
          </p>
        </div>
      )}

      {findings.length > 0 && (
        <div className="divide-y divide-wiz-border/20">
          {findings.map((f, i) => (
            <FindingRow key={i} finding={f} onExplore={() => exploreFinding(f)} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding, onExplore, index }) {
  const Icon = iconForType(finding.type);
  const accent = severityColor(finding.insight?.severity);

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`px-4 py-2.5 hover:bg-wiz-bg/30 group transition-colors flex items-start gap-3 border-l-2 ${accent.border}`}
    >
      <div className={`mt-0.5 ${accent.icon}`}>
        <Icon size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-wiz-text leading-snug">{finding.insight?.headline}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[8px] font-mono uppercase tracking-wider text-wiz-muted/70">
            {finding.type}
          </span>
          {finding.score != null && (
            <span className="text-[8px] font-mono text-wiz-muted/60">
              · score {finding.score.toFixed(2)}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onExplore}
        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold text-wiz-accent hover:bg-wiz-accent/15"
        title="Create a sheet exploring this finding"
      >
        Explore <ChevronRight size={10} />
      </button>
    </motion.div>
  );
}

function iconForType(type) {
  switch (type) {
    case 'trend':         return TrendingUp;
    case 'outliers':      return AlertCircle;
    case 'concentration': return BarChart3;
    case 'correlation':   return ScatterChart;
    default:              return Activity;
  }
}

function severityColor(severity) {
  if (severity === 'critical') return { border: 'border-l-rose-500/50', icon: 'text-rose-400' };
  if (severity === 'notable')  return { border: 'border-l-amber-500/50', icon: 'text-amber-400' };
  return { border: 'border-l-wiz-accent/30', icon: 'text-wiz-accent' };
}
