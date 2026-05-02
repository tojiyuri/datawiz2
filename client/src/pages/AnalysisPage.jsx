import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Hash, Tag, Clock, Type, ChevronDown, ChevronRight, Database,
  AlertCircle, Wand2, Loader2, Zap, ArrowUpRight, Activity,
  GitBranch, Mail, Sparkles, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

const typeMeta = {
  numeric:     { icon: Hash,   label: 'NUM' },
  categorical: { icon: Tag,    label: 'CAT' },
  temporal:    { icon: Clock,  label: 'TIME' },
  text:        { icon: Type,   label: 'TXT' },
  unknown:     { icon: AlertCircle, label: '?' },
};

export default function AnalysisPage({ dataset, analysis }) {
  const [openCol, setOpenCol] = useState(null);
  const [preview, setPreview] = useState(null);
  const [generatingDashboard, setGeneratingDashboard] = useState(false);
  const [exploring, setExploring] = useState(false);
  const navigate = useNavigate();

  // Inline help banner — shown once, persists dismissal in localStorage.
  // Different key from the tour so users who skip the tour still see this hint.
  const [showHelpBanner, setShowHelpBanner] = useState(() => {
    try { return localStorage.getItem('wizAnalysisHelpDismissed_v1') !== '1'; }
    catch { return true; }
  });
  const dismissHelpBanner = () => {
    setShowHelpBanner(false);
    try { localStorage.setItem('wizAnalysisHelpDismissed_v1', '1'); } catch (_) {}
  };

  useEffect(() => {
    if (dataset?.id) api.getDatasetData(dataset.id, 1, 20).then(setPreview).catch(() => {});
  }, [dataset]);

  if (!dataset || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-text-tertiary">
        <Database size={40} strokeWidth={1.25} className="mb-4 opacity-40"/>
        <p className="text-sm font-body mb-3">No dataset loaded.</p>
        <button onClick={() => navigate('/')} className="btn-secondary text-xs">Upload a file</button>
      </div>
    );
  }

  const { summary, columns, correlations } = analysis;

  const handleAutoDashboard = async () => {
    if (generatingDashboard) return;
    setGeneratingDashboard(true);
    const t = toast.loading('Generating dashboard…');
    try {
      const r = await api.generateAutoDashboard(dataset.id);
      toast.success(`Created dashboard with ${r.tiles?.length || 0} charts`, { id: t });
      navigate(`/dashboards/${r.dashboard.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate dashboard', { id: t });
    } finally {
      setGeneratingDashboard(false);
    }
  };

  const handleExplore = async () => {
    if (exploring) return;
    setExploring(true);
    const t = toast.loading('Scanning data for interesting findings…');
    try {
      const r = await api.exploreDataset(dataset.id);
      toast.success(`Found ${r.findings?.length || 0} insights`, { id: t });
      navigate(`/explore/${dataset.id}`, { state: { findings: r.findings, scanStats: r.scanStats } });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Explore failed', { id: t });
    } finally {
      setExploring(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 pt-10 pb-16">

      {/* ─── Editorial header ────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12"
      >
        <p className="eyebrow mb-3">Dataset overview</p>
        <h1 className="h1 mb-3">
          <span className="italic text-wiz-accent">{dataset.fileName}</span>
        </h1>
        <p className="text-base text-wiz-text-secondary font-body">
          {summary.rows.toLocaleString()} rows
          <span className="text-wiz-dim mx-2">·</span>
          {summary.columns} columns
          <span className="text-wiz-dim mx-2">·</span>
          quality {summary.qualityScore}%
        </p>

        {/* Inline help — shown once, dismissible. Tells the user what's
            possible without forcing the tour. The four buttons below are the
            primary entry points; this banner is for users who landed here
            without the welcome modal (e.g., uploading a second dataset). */}
        {showHelpBanner && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-5 px-4 py-3 rounded-lg bg-wiz-accent-soft border border-wiz-accent/30 flex items-start gap-3"
          >
            <Sparkles size={14} strokeWidth={2} className="text-wiz-accent shrink-0 mt-0.5"/>
            <div className="flex-1 text-sm text-wiz-text-secondary leading-relaxed">
              <span className="text-wiz-text font-medium">Best first move:</span> click <span className="font-medium text-wiz-text">Auto-generate dashboard</span> to see Wiz lay out the whole dataset, or <span className="font-medium text-wiz-text">What's interesting?</span> to get a ranked list of findings. Drilling deeper? Try <span className="font-medium text-wiz-text">Key drivers</span> or the <span className="font-medium text-wiz-text">Decomposition tree</span>.
            </div>
            <button
              onClick={dismissHelpBanner}
              className="shrink-0 text-wiz-text-tertiary hover:text-wiz-text"
              aria-label="Dismiss"
            >
              <X size={14} strokeWidth={1.75}/>
            </button>
          </motion.div>
        )}

        {/* CTAs — primary + secondary, no rainbow */}
        <div className="flex items-center gap-2 mt-6 flex-wrap">
          <button onClick={handleAutoDashboard} disabled={generatingDashboard} className="btn-primary" data-tour-id="auto-dashboard-btn">
            {generatingDashboard ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14} strokeWidth={2}/>}
            Auto-generate dashboard
          </button>
          <button onClick={handleExplore} disabled={exploring} className="btn-secondary" data-tour-id="explore-btn">
            {exploring ? <Loader2 size={14} className="animate-spin"/> : <Zap size={14} strokeWidth={1.75}/>}
            What's interesting?
          </button>
          <button onClick={() => navigate('/drivers')} className="btn-secondary" data-tour-id="drivers-btn">
            <Activity size={14} strokeWidth={1.75}/>
            Key drivers
          </button>
          <button onClick={() => navigate('/decomp')} className="btn-secondary" data-tour-id="decomp-btn">
            <GitBranch size={14} strokeWidth={1.75}/>
            Decomposition tree
          </button>
          <button onClick={() => navigate('/reports')} className="btn-secondary">
            <Mail size={14} strokeWidth={1.75}/>
            Schedule report
          </button>
        </div>
      </motion.div>

      {/* ─── Stat ribbon — minimal, mono, no colors ─────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 mb-12 border-y border-wiz-border">
        {[
          { l: 'Rows', v: summary.rows.toLocaleString() },
          { l: 'Columns', v: summary.columns },
          { l: 'Numeric', v: summary.numericColumns },
          { l: 'Categorical', v: summary.categoricalColumns },
          { l: 'Temporal', v: summary.temporalColumns },
          { l: 'Quality', v: `${summary.qualityScore}%`, accent: summary.qualityScore < 70 },
        ].map((c, i, arr) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={`py-5 px-4 ${i < arr.length - 1 ? 'border-r border-wiz-border' : ''}`}
          >
            <p className="eyebrow mb-1.5">{c.l}</p>
            <p className={`text-2xl font-display font-semibold tracking-tight ${c.accent ? 'text-wiz-warning' : 'text-wiz-text'}`}>
              {c.v}
            </p>
          </motion.div>
        ))}
      </div>

      {/* ─── Column profiles ─────────────────────────────────────── */}
      <section className="mb-14">
        <div className="flex items-baseline justify-between mb-5">
          <h2 className="h3">Columns</h2>
          <p className="text-xs text-wiz-text-tertiary font-mono">click to expand</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {columns.map((col, i) => {
            const meta = typeMeta[col.type] || typeMeta.unknown;
            const Icon = meta.icon;
            const open = openCol === i;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                className={`
                  card cursor-pointer overflow-hidden
                  ${open ? 'border-wiz-accent/50' : ''}
                `}
                onClick={() => setOpenCol(open ? null : i)}
              >
                <div className="flex items-center justify-between px-4 py-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={15} strokeWidth={1.5} className="text-wiz-text-tertiary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-wiz-text truncate">{col.name}</p>
                      <p className="text-2xs text-wiz-text-tertiary font-mono mt-0.5">
                        {col.stats.count} values
                        {col.stats.nullCount > 0 && (
                          <span className="text-wiz-warning ml-1.5">{col.stats.nullCount} null</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-2xs font-mono text-wiz-text-tertiary uppercase tracking-wider">{meta.label}</span>
                    {open
                      ? <ChevronDown size={13} className="text-wiz-text-tertiary"/>
                      : <ChevronRight size={13} className="text-wiz-text-tertiary"/>}
                  </div>
                </div>

                {open && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="border-t border-wiz-border px-4 py-3.5"
                  >
                    {col.type === 'numeric' && (
                      <div className="grid grid-cols-3 gap-x-6 gap-y-2 font-mono text-xs">
                        {[
                          ['Mean', col.stats.mean],
                          ['Median', col.stats.median],
                          ['Std Dev', col.stats.stdDev],
                          ['Min', col.stats.min],
                          ['Max', col.stats.max],
                          ['Range', col.stats.range],
                          ['Q1', col.stats.q1],
                          ['Q3', col.stats.q3],
                          ['Outliers', col.stats.outlierCount],
                        ].map(([l, v]) => (
                          <div key={l}>
                            <p className="text-2xs text-wiz-text-tertiary uppercase tracking-wider">{l}</p>
                            <p className="text-wiz-text mt-0.5">{v}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {col.type === 'categorical' && (
                      <div>
                        <p className="text-xs text-wiz-text-tertiary mb-3">{col.stats.unique} unique values</p>
                        {col.stats.topCategories?.slice(0, 5).map((c, j) => (
                          <div key={j} className="flex items-center gap-3 mb-2 last:mb-0">
                            <span className="text-xs text-wiz-text font-mono w-24 truncate">{c.name}</span>
                            <div className="flex-1 h-1 bg-wiz-card rounded-full overflow-hidden">
                              <div
                                className="h-full bg-wiz-accent rounded-full"
                                style={{ width: `${c.percentage}%` }}
                              />
                            </div>
                            <span className="text-2xs text-wiz-text-tertiary font-mono w-10 text-right">{c.percentage}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {col.type === 'temporal' && (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
                        {[
                          ['Earliest', col.stats.earliest?.split('T')[0] || 'N/A'],
                          ['Latest', col.stats.latest?.split('T')[0] || 'N/A'],
                          ['Span', `${col.stats.spanDays}d`],
                          ['Unique', col.stats.unique],
                        ].map(([l, v]) => (
                          <div key={l}>
                            <p className="text-2xs text-wiz-text-tertiary uppercase tracking-wider">{l}</p>
                            <p className="text-wiz-text mt-0.5">{v}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ─── Correlations ─────────────────────────────────────────── */}
      {correlations?.length > 0 && (
        <section className="mb-14">
          <h2 className="h3 mb-5">Correlations</h2>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-wiz-border">
                  <th className="text-left px-4 py-3 eyebrow">Column A</th>
                  <th className="text-left px-4 py-3 eyebrow">Column B</th>
                  <th className="text-right px-4 py-3 eyebrow">r</th>
                  <th className="text-left px-4 py-3 eyebrow">Strength</th>
                </tr>
              </thead>
              <tbody>
                {correlations.slice(0, 8).map((c, i) => (
                  <tr key={i} className="border-b border-wiz-border last:border-0 hover:bg-wiz-card transition-colors">
                    <td className="px-4 py-3 text-sm text-wiz-text">{c.column1}</td>
                    <td className="px-4 py-3 text-sm text-wiz-text">{c.column2}</td>
                    <td className={`px-4 py-3 text-sm font-mono text-right ${c.correlation > 0 ? 'text-wiz-success' : 'text-wiz-danger'}`}>
                      {c.correlation > 0 ? '+' : ''}{c.correlation}
                    </td>
                    <td className="px-4 py-3 text-xs text-wiz-text-tertiary uppercase tracking-wider font-mono">{c.strength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── Preview ──────────────────────────────────────────────── */}
      {preview?.data && (
        <section>
          <h2 className="h3 mb-5">Preview</h2>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-wiz-surface z-10">
                  <tr className="border-b border-wiz-border">
                    {columns.map((c, i) => (
                      <th key={i} className="text-left px-3 py-2.5 eyebrow whitespace-nowrap">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.map((r, ri) => (
                    <tr key={ri} className="border-b border-wiz-border last:border-0 hover:bg-wiz-card transition-colors">
                      {columns.map((c, ci) => (
                        <td key={ci} className="px-3 py-2.5 text-wiz-text-secondary font-mono text-xs whitespace-nowrap max-w-[200px] truncate">
                          {String(r[c.name] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
