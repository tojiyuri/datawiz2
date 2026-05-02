import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, Database, TrendingUp, Lightbulb, ThumbsUp, ThumbsDown, Brain, AlertTriangle, RefreshCw, History, Zap, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import ChartRenderer from '../components/ChartRenderer';
import * as api from '../utils/api';

const PRIO = {
  high:   { color: '#FB7185', bg: 'bg-rose-500/10',   border: 'border-rose-500/25',   text: 'text-rose-400',   label: 'HIGH' },
  medium: { color: '#FBBF24', bg: 'bg-amber-500/10',  border: 'border-amber-500/25',  text: 'text-amber-400',  label: 'MED' },
  low:    { color: '#38BDF8', bg: 'bg-sky-500/10',    border: 'border-sky-500/25',    text: 'text-sky-400',    label: 'LOW' },
};

const INSIGHT_ICONS = {
  trend: '📈', forecast: '🔮', correlation: '🔗', predictor: '🎯',
  top: '⭐', bottom: '⬇️', risk: '⚠️', anomaly: '🚨',
  shape: '📊', center: '📍', hotspot: '🔥', coldspot: '❄️',
  'geo-top': '📍', 'geo-spread': '🌍', words: '💬',
};

export default function DashboardPage({ dataset, analysis, onReset }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [dismissed, setDismissed] = useState(new Set());
  const [recsCollapsed, setRecsCollapsed] = useState(false);
  const navigate = useNavigate();

  const fetchDashboard = () => {
    if (!dataset?.id) return;
    setLoading(true); setError(null);
    api.getDashboard(dataset.id)
      .then(d => { setDashboard(d); if (d.warning) toast(d.warning, { icon: '⚠️' }); })
      .catch(err => {
        const data = err.response?.data || {};
        setError({ message: data.error || err.message, expired: data.expired });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDashboard(); }, [dataset?.id]);

  const giveFeedback = async (i, chart, action) => {
    if (!dataset?.id) return;
    setFeedback(p => ({ ...p, [i]: action }));
    if (action === 'dismiss') setDismissed(p => new Set([...p, i]));
    try {
      await api.sendFeedback(dataset.id, chart.type, action, {
        type: chart.type, x: chart.x, y: chart.y, y2: chart.y2,
        stack: chart.stack, size: chart.size, category: chart.category, value: chart.value,
      });
      toast.success(action === 'accept' ? '👍 Boosted this chart type' : '👎 I\'ll suggest others next time');
    } catch { toast.error('Feedback failed'); }
  };

  if (!dataset || !analysis) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-muted">
      <Database size={48} className="mb-4 opacity-30" />
      <p className="text-sm">No dataset loaded.</p>
      <button onClick={() => navigate('/')} className="mt-3 text-wiz-accent text-sm font-semibold hover:underline">Upload a file</button>
    </div>
  );

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="spinner w-12 h-12 mb-4" />
      <p className="text-sm text-wiz-muted font-mono">Analyzing your data like a data scientist...</p>
      <p className="text-[10px] text-wiz-dim font-mono mt-2">Forecasting · Anomaly detection · Pattern matching</p>
    </div>
  );

  if (error) return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle size={28} className="text-rose-400" />
        </div>
        <h2 className="text-xl font-extrabold font-display text-wiz-text mb-2">
          {error.expired ? 'Dataset Expired' : 'Failed to Load Dashboard'}
        </h2>
        <p className="text-wiz-muted text-sm font-body mb-6 max-w-md mx-auto">
          {error.expired
            ? 'Your dataset is no longer available — server may have restarted. Please re-upload.'
            : error.message}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={fetchDashboard} className="flex items-center gap-1.5 px-4 py-2 rounded-xl glass text-wiz-muted hover:text-wiz-accent hover:border-wiz-accent/30 text-xs font-semibold transition-all btn-press">
            <RefreshCw size={13} />Retry
          </button>
          <button onClick={() => { onReset?.(); navigate('/'); }} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-wiz-accent-deep to-wiz-accent text-white text-xs font-semibold btn-press">
            Upload New File
          </button>
        </div>
      </motion.div>
    </div>
  );

  if (!dashboard) return null;

  const visibleCharts = dashboard.charts.filter((_, i) => !dismissed.has(i));
  const memCount = dashboard.memory?.similarMemoriesCount || 0;
  const recalled = dashboard.memory?.recalled || [];
  const execRecs = dashboard.recommendations || [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold font-display text-wiz-text mb-1 flex items-center gap-2">
            <LayoutDashboard size={20} className="text-wiz-accent" />Auto-Generated Dashboard
          </h2>
          <p className="text-sm text-wiz-muted font-body">
            <span className="text-wiz-text font-mono">{dashboard.fileName}</span>
            {memCount > 0 && <span className="ml-2 text-wiz-accent-light">· using {memCount} similar memories</span>}
          </p>
        </div>
        <button onClick={() => navigate('/learning')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-wiz-muted hover:text-wiz-accent hover:border-wiz-accent/30 text-[11px] font-semibold transition-all btn-press">
          <Brain size={13} />AI Brain
        </button>
      </motion.div>

      {/* ─── EXECUTIVE RECOMMENDATIONS PANEL ─── */}
      {execRecs.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="mb-6 rounded-2xl bg-gradient-to-br from-wiz-accent/[0.06] via-wiz-emerald/[0.03] to-transparent border border-wiz-accent/20 overflow-hidden">
          <button onClick={() => setRecsCollapsed(!recsCollapsed)} className="w-full px-5 py-4 flex items-center justify-between hover:bg-wiz-accent/[0.03] transition-colors">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-wiz-accent to-wiz-emerald flex items-center justify-center shrink-0">
                <Sparkles size={16} className="text-white" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-bold font-display text-wiz-text">Expert Insights & Predictions</h3>
                <p className="text-[10px] text-wiz-muted font-mono">{execRecs.length} actionable findings · forecasting · anomaly detection · risk analysis</p>
              </div>
            </div>
            {recsCollapsed ? <ChevronDown size={16} className="text-wiz-muted" /> : <ChevronUp size={16} className="text-wiz-muted" />}
          </button>

          <AnimatePresence>
            {!recsCollapsed && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-4 pt-0">
                  {execRecs.map((rec, i) => {
                    const p = PRIO[rec.priority] || PRIO.low;
                    return (
                      <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.06 }}
                        className={`p-3.5 rounded-xl ${p.bg} border ${p.border} card-lift`}>
                        <div className="flex items-start gap-2.5">
                          <div className="text-xl shrink-0 mt-0.5" style={{ filter: 'saturate(1.2)' }}>{rec.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${p.text} ${p.bg}`}>{p.label}</span>
                              <h4 className="text-xs font-bold font-display text-wiz-text">{rec.title}</h4>
                            </div>
                            <p className="text-[11px] text-wiz-text-secondary font-body leading-relaxed">{rec.text}</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ─── KEY METRICS ─── */}
      {dashboard.keyMetrics?.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {dashboard.keyMetrics.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: 0.2 + i * 0.06 }}
              className="p-5 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40 card-lift">
              <p className="text-[10px] text-wiz-muted font-mono uppercase tracking-wider mb-2">{m.name}</p>
              <p className="text-3xl font-extrabold font-display text-wiz-text mb-1 tracking-tight">
                {typeof m.value === 'number' ? m.value >= 1e6 ? `${(m.value / 1e6).toFixed(1)}M` : m.value >= 1e3 ? `${(m.value / 1e3).toFixed(1)}K` : m.value.toLocaleString() : m.value}
              </p>
              <p className="text-[10px] font-mono text-wiz-dim">avg {m.mean} · range {m.min}–{m.max}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* ─── MEMORY RECALL ─── */}
      {recalled.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="mb-6 p-4 rounded-2xl bg-gradient-to-br from-wiz-accent/[0.04] to-wiz-emerald/[0.02] border border-wiz-accent/15">
          <h3 className="text-xs font-bold font-display text-wiz-accent-light mb-3 flex items-center gap-2">
            <History size={13} />From your visualization memory
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {recalled.map((r, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.04 }}
                className="p-3 rounded-xl bg-wiz-bg/60 border border-wiz-border/30 hover:border-wiz-accent/20 transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-wiz-accent/10 text-wiz-accent-light uppercase">{r.chartType.replace('_', ' ')}</span>
                  <span className="text-[9px] font-mono text-wiz-emerald">{r.similarity}% match</span>
                </div>
                <p className="text-[11px] text-wiz-text font-medium truncate font-body">{r.title}</p>
                <p className="text-[9px] font-mono text-wiz-dim mt-0.5 truncate">from {r.datasetName}</p>
                <div className="flex items-center gap-2 mt-1.5 text-[9px] font-mono">
                  {r.accepts > 0 && <span className="text-wiz-emerald">👍 {r.accepts}</span>}
                  {r.dismisses > 0 && <span className="text-wiz-rose">👎 {r.dismisses}</span>}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ─── CHARTS ─── */}
      {visibleCharts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-wiz-muted font-body">No charts to display. Try a dataset with at least one numeric column.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {visibleCharts.map((chart, originalIdx) => {
            const i = dashboard.charts.indexOf(chart);
            const fb = feedback[i];
            const memBoost = chart.memoryBoost && chart.memoryBoost !== 1;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + originalIdx * 0.05 }}
                className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 overflow-hidden card-lift group">
                <div className="px-5 py-4 border-b border-wiz-border/30">
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <h4 className="text-sm font-bold font-display text-wiz-text truncate">{chart.title}</h4>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {memBoost && (
                        <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold flex items-center gap-1 ${chart.memoryBoost > 1 ? 'bg-wiz-accent/10 text-wiz-accent-light' : 'bg-wiz-dim/10 text-wiz-dim'}`} title="Boosted/penalized by memory">
                          <Zap size={9} />{(chart.memoryBoost).toFixed(2)}×
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-wiz-accent/10 text-wiz-accent-light uppercase">{chart.type.replace('_', ' ')}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-wiz-muted font-body">{chart.reason}</p>
                  {/* STRUCTURED INSIGHTS */}
                  {chart.insights?.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      {chart.insights.map((ins, j) => (
                        <div key={j} className="flex items-start gap-2 p-2 rounded-lg bg-wiz-bg/40 border border-wiz-border/20">
                          <span className="text-[12px] shrink-0 mt-0.5">{INSIGHT_ICONS[ins.type] || '💡'}</span>
                          <p className="text-[10px] text-wiz-muted leading-relaxed font-body">{ins.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="px-3 py-4">
                  <ChartRenderer spec={chart} chartData={chart.chartData} stackKeys={chart.stackKeys} height={280} />
                </div>
                <div className="px-4 py-2 border-t border-wiz-border/20 bg-wiz-bg/20 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-wiz-dim">Useful?</span>
                  <div className="flex items-center gap-1.5">
                    <motion.button onClick={() => giveFeedback(i, chart, 'accept')} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      className={`p-1.5 rounded-lg transition-all ${fb === 'accept' ? 'bg-wiz-emerald/20 text-wiz-emerald' : 'text-wiz-dim hover:bg-wiz-emerald/10 hover:text-wiz-emerald'}`}>
                      <ThumbsUp size={12} />
                    </motion.button>
                    <motion.button onClick={() => giveFeedback(i, chart, 'dismiss')} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
                      className={`p-1.5 rounded-lg transition-all ${fb === 'dismiss' ? 'bg-wiz-rose/20 text-wiz-rose' : 'text-wiz-dim hover:bg-wiz-rose/10 hover:text-wiz-rose'}`}>
                      <ThumbsDown size={12} />
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-8 p-4 rounded-2xl glass text-center">
        <p className="text-xs text-wiz-muted font-body">
          <TrendingUp size={12} className="inline mr-1.5 text-wiz-accent" />
          {visibleCharts.length} of {dashboard.charts.length} visualizations · {dashboard.summary.rows.toLocaleString()} rows
          {memCount > 0 && <span> · learned from {memCount} past charts</span>}
        </p>
      </motion.div>
    </div>
  );
}
