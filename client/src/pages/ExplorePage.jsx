import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertCircle, TrendingUp, TrendingDown, BarChart3, ScatterChart, Activity, Layers, ChevronRight, ArrowLeft, Loader2, Save, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

/**
 * ExplorePage — the "What's interesting?" view.
 *
 * Shows a feed of ranked findings from autoExploreEngine. Each finding
 * has a one-sentence factual summary, a severity badge, evidence numbers,
 * and a chart spec ready to open. Users can save any finding as a sheet.
 */

const FINDING_TYPE_META = {
  concentration: { icon: BarChart3, label: 'Concentration', color: 'text-wiz-amber' },
  outliers:      { icon: AlertCircle, label: 'Outliers', color: 'text-wiz-rose' },
  trend:         { icon: TrendingUp, label: 'Trend', color: 'text-wiz-emerald' },
  correlation:   { icon: ScatterChart, label: 'Correlation', color: 'text-wiz-violet' },
  group_difference: { icon: Layers, label: 'Group Difference', color: 'text-wiz-sky' },
};

const SEVERITY_STYLES = {
  warning: 'bg-wiz-amber/10 border-wiz-amber/30 text-wiz-amber',
  critical: 'bg-wiz-rose/10 border-wiz-rose/30 text-wiz-rose',
  info:    'bg-wiz-emerald/10 border-wiz-emerald/30 text-wiz-emerald',
};

export default function ExplorePage() {
  const { datasetId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Findings can come in via navigation state (from AnalysisPage) or be loaded fresh
  const [findings, setFindings] = useState(location.state?.findings || []);
  const [scanStats, setScanStats] = useState(location.state?.scanStats || null);
  const [loading, setLoading] = useState(!location.state?.findings);
  const [savingIdx, setSavingIdx] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!findings.length && datasetId) {
      setLoading(true);
      api.exploreDataset(datasetId)
        .then(r => { setFindings(r.findings || []); setScanStats(r.scanStats); })
        .catch(err => toast.error(err.response?.data?.error || 'Failed to load findings'))
        .finally(() => setLoading(false));
    }
  }, [datasetId]);

  const visible = useMemo(() => {
    if (filter === 'all') return findings;
    if (filter === 'warning') return findings.filter(f => f.severity === 'warning' || f.severity === 'critical');
    return findings.filter(f => f.type === filter);
  }, [findings, filter]);

  const types = useMemo(() => {
    const set = new Set(findings.map(f => f.type));
    return Array.from(set);
  }, [findings]);

  const handleOpen = (finding) => {
    // Navigate to a fresh sheet builder pre-populated with the finding's chart spec
    navigate('/sheets/new', { state: { initialSpec: finding.chartSpec, datasetId, initialName: finding.title } });
  };

  const handleSave = async (finding, idx) => {
    setSavingIdx(idx);
    try {
      const r = await api.saveFindingAsSheet(datasetId, finding);
      toast.success(`Saved "${r.sheet.name}"`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSavingIdx(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-wiz-accent mb-3" />
        <p className="text-sm text-wiz-muted font-body">Scanning your data for interesting findings…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-[11px] text-wiz-muted hover:text-wiz-text mb-3 font-mono">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold font-display text-wiz-text flex items-center gap-2 mb-1">
              <Zap size={22} className="text-wiz-violet" />
              What's interesting?
            </h1>
            <p className="text-sm text-wiz-muted font-body">
              {findings.length === 0 ? 'No notable findings yet — try a richer dataset.' :
                `Found ${findings.length} ${findings.length === 1 ? 'thing' : 'things'} worth knowing about.`}
              {scanStats && (
                <span className="text-[11px] text-wiz-muted/60 font-mono ml-2">
                  · scanned {scanStats.columnsScanned} columns, {scanStats.pairsScanned} pairs in {scanStats.durationMs}ms
                </span>
              )}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Filter chips */}
      {findings.length > 0 && types.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-5">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All ({findings.length})</FilterChip>
          {findings.some(f => f.severity === 'warning' || f.severity === 'critical') && (
            <FilterChip active={filter === 'warning'} onClick={() => setFilter('warning')}>
              Warnings ({findings.filter(f => f.severity === 'warning' || f.severity === 'critical').length})
            </FilterChip>
          )}
          {types.map(t => {
            const meta = FINDING_TYPE_META[t];
            if (!meta) return null;
            const count = findings.filter(f => f.type === t).length;
            return (
              <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)}>
                {meta.label} ({count})
              </FilterChip>
            );
          })}
        </div>
      )}

      {/* Findings feed */}
      {visible.length === 0 ? (
        <div className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/30 p-8 text-center">
          <p className="text-wiz-muted text-sm font-body">No findings match this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {visible.map((finding, i) => (
              <FindingCard
                key={`${finding.type}-${i}`}
                finding={finding}
                index={i}
                saving={savingIdx === i}
                onOpen={() => handleOpen(finding)}
                onSave={() => handleSave(finding, i)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider transition-colors ${
        active
          ? 'bg-wiz-accent text-white'
          : 'bg-wiz-surface/40 border border-wiz-border/30 text-wiz-muted hover:text-wiz-text'
      }`}
    >
      {children}
    </button>
  );
}

function FindingCard({ finding, index, saving, onOpen, onSave }) {
  const meta = FINDING_TYPE_META[finding.type] || { icon: Activity, label: 'Finding', color: 'text-wiz-muted' };
  const Icon = meta.icon;
  const sevStyle = SEVERITY_STYLES[finding.severity] || SEVERITY_STYLES.info;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-2xl bg-wiz-surface/50 border border-wiz-border/30 p-4 hover:border-wiz-accent/40 transition-colors group"
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-wiz-bg/40 ${meta.color}`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${sevStyle}`}>
              {finding.severity}
            </span>
            <span className="text-[9px] font-mono uppercase tracking-wider text-wiz-muted">
              {meta.label}
            </span>
            <span className="text-[9px] font-mono text-wiz-muted/60">
              score {Math.round(finding.score)}
            </span>
          </div>
          <h3 className="text-[13px] font-bold font-display text-wiz-text mb-1">
            {finding.title}
          </h3>
          <p className="text-[12px] text-wiz-text-secondary font-body leading-relaxed">
            {finding.text}
          </p>
          {finding.evidence && Object.keys(finding.evidence).length > 0 && (
            <details className="mt-2 group/evidence">
              <summary className="cursor-pointer text-[10px] font-mono text-wiz-muted hover:text-wiz-text-secondary">
                Evidence
              </summary>
              <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-wiz-muted">
                {Object.entries(finding.evidence).map(([k, v]) => (
                  <div key={k}>
                    <span className="text-wiz-muted/60">{k}:</span>{' '}
                    <span className="text-wiz-text-secondary">{formatEvidenceValue(v)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onOpen}
            title="Open in Sheet Builder"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-wiz-accent/15 hover:bg-wiz-accent/25 text-wiz-accent text-[10px] font-semibold"
          >
            <ExternalLink size={10} />Explore
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            title="Save as a sheet"
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-wiz-bg/40 hover:bg-wiz-bg/60 border border-wiz-border/30 text-wiz-muted hover:text-wiz-text text-[10px] font-semibold disabled:opacity-50"
          >
            {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
            Save
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function formatEvidenceValue(v) {
  if (v == null) return '–';
  if (typeof v === 'number') {
    if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(2);
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2).replace(/\.?0+$/, '');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
