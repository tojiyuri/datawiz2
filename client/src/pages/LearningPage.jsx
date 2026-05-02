import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Brain, TrendingUp, TrendingDown, RotateCcw, BarChart3, Activity, Lightbulb, History, Trash2, Database } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

export default function LearningPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('learning');

  const load = async () => {
    setLoading(true);
    try { setStats(await api.getStats()); }
    catch { toast.error('Failed to load stats'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleReset = async (target) => {
    const msg = target === 'memory' ? 'Reset visualization memory? All past charts will be forgotten.'
              : target === 'learning' ? 'Reset learning weights? Chart preferences will go back to defaults.'
              : 'Reset everything? Both memory and learning will be wiped.';
    if (!confirm(msg)) return;
    try { await api.resetState(target); toast.success('Reset complete'); load(); }
    catch { toast.error('Reset failed'); }
  };

  const handleDeleteMemory = async (memId) => {
    try { await api.deleteMemory(memId); load(); }
    catch { toast.error('Delete failed'); }
  };

  if (loading || !stats) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="spinner w-10 h-10 mb-4" />
      <p className="text-sm text-wiz-muted font-mono">Loading AI brain...</p>
    </div>
  );

  const { learning: L = {}, memory: M = {} } = stats;
  const acceptRate = L.stats?.totalFeedback ? Math.round((L.stats.totalAccepts / L.stats.totalFeedback) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold font-display text-wiz-text mb-1 flex items-center gap-2"><Brain size={20} className="text-wiz-accent" />AI Brain</h2>
          <p className="text-sm text-wiz-muted font-body">Watch the AI learn from every visualization. Each chart trains it for the next.</p>
        </div>
      </motion.div>

      {/* Tab switcher */}
      <div className="inline-flex items-center bg-wiz-bg/60 backdrop-blur-sm rounded-xl p-1 border border-wiz-border/50 gap-1 mb-6">
        {[
          { id: 'learning', label: 'Learning Weights', icon: Brain },
          { id: 'memory', label: 'Visualization Memory', icon: History },
        ].map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${active ? 'bg-wiz-accent text-white' : 'text-wiz-muted hover:text-wiz-text'}`}>
              <Icon size={12} />{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'learning' && <>
        {/* Learning Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { l: 'Recommendations', v: L.stats?.totalRecommendations || 0, c: '#818CF8', i: BarChart3 },
            { l: 'Total Feedback', v: L.stats?.totalFeedback || 0, c: '#FBBF24', i: Activity },
            { l: 'Accept Rate', v: `${acceptRate}%`, c: '#34D399', i: TrendingUp },
            { l: 'Contexts Learned', v: L.contextsLearned || 0, c: '#FB7185', i: Brain },
          ].map((c, i) => {
            const Icon = c.i;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="p-4 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40 card-lift">
                <div className="flex items-center justify-between mb-2"><p className="text-[10px] text-wiz-muted font-mono uppercase tracking-wider">{c.l}</p><Icon size={14} style={{ color: c.c }} /></div>
                <p className="text-2xl font-extrabold font-display" style={{ color: c.c }}>{c.v}</p>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="p-5 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40">
            <h3 className="text-sm font-bold font-display text-wiz-text mb-3 flex items-center gap-2"><TrendingUp size={15} className="text-wiz-emerald" />Most Boosted Charts</h3>
            {L.topPreferred?.length ? <div className="space-y-2">{L.topPreferred.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-wiz-bg/40">
                <span className="text-xs font-mono text-wiz-text">{p.type.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-wiz-faint/30 rounded-full overflow-hidden"><div className="h-full bg-wiz-emerald rounded-full" style={{ width: `${Math.min(100, (p.weight - 0.5) * 100)}%` }} /></div>
                  <span className="text-[10px] font-mono text-wiz-emerald font-semibold w-10 text-right">{p.weight.toFixed(2)}×</span>
                </div>
              </div>
            ))}</div> : <p className="text-xs text-wiz-dim font-body">No preferences yet — give some feedback!</p>}
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="p-5 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40">
            <h3 className="text-sm font-bold font-display text-wiz-text mb-3 flex items-center gap-2"><TrendingDown size={15} className="text-wiz-rose" />Least Preferred</h3>
            {L.leastPreferred?.length ? <div className="space-y-2">{L.leastPreferred.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-wiz-bg/40">
                <span className="text-xs font-mono text-wiz-text">{p.type.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-wiz-faint/30 rounded-full overflow-hidden"><div className="h-full bg-wiz-rose rounded-full" style={{ width: `${Math.min(100, (p.weight - 0.5) * 100)}%` }} /></div>
                  <span className="text-[10px] font-mono text-wiz-rose font-semibold w-10 text-right">{p.weight.toFixed(2)}×</span>
                </div>
              </div>
            ))}</div> : <p className="text-xs text-wiz-dim font-body">No data yet</p>}
          </motion.div>
        </div>

        <div className="flex items-center justify-end">
          <button onClick={() => handleReset('learning')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-wiz-muted hover:text-wiz-rose hover:border-wiz-rose/30 text-[11px] font-semibold transition-all btn-press">
            <RotateCcw size={13} />Reset Learning
          </button>
        </div>
      </>}

      {tab === 'memory' && <>
        {/* Memory Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { l: 'Charts Remembered', v: M.stats?.currentMemories || 0, c: '#818CF8', i: History },
            { l: 'Datasets Touched', v: M.stats?.datasetsTouched || 0, c: '#34D399', i: Database },
            { l: 'Total Accepts', v: M.stats?.totalAccepts || 0, c: '#FBBF24', i: TrendingUp },
            { l: 'Total Recorded', v: M.stats?.totalRecorded || 0, c: '#A78BFA', i: BarChart3 },
          ].map((c, i) => {
            const Icon = c.i;
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="p-4 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40 card-lift">
                <div className="flex items-center justify-between mb-2"><p className="text-[10px] text-wiz-muted font-mono uppercase tracking-wider">{c.l}</p><Icon size={14} style={{ color: c.c }} /></div>
                <p className="text-2xl font-extrabold font-display" style={{ color: c.c }}>{c.v}</p>
              </motion.div>
            );
          })}
        </div>

        {/* Top accepted types */}
        {M.topAcceptedTypes?.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-5 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40">
            <h3 className="text-sm font-bold font-display text-wiz-text mb-3 flex items-center gap-2"><TrendingUp size={15} className="text-wiz-emerald" />Most Accepted Chart Types</h3>
            <div className="flex flex-wrap gap-2">
              {M.topAcceptedTypes.map((t, i) => (
                <span key={i} className="px-3 py-1.5 rounded-xl bg-wiz-emerald/10 border border-wiz-emerald/20 text-xs font-mono text-wiz-emerald">
                  {t.type.replace(/_/g, ' ')} <span className="text-wiz-emerald-deep ml-1.5 font-bold">×{t.count}</span>
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Recent memories list */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="p-5 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40 mb-4">
          <h3 className="text-sm font-bold font-display text-wiz-text mb-3 flex items-center gap-2"><History size={15} className="text-wiz-accent" />Recent Visualizations</h3>
          {M.recentMemories?.length ? (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {M.recentMemories.map((m, i) => (
                <motion.div key={m.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.02 }}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-wiz-bg/30 hover:bg-wiz-bg/50 group transition-colors">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-wiz-accent/10 text-wiz-accent-light uppercase shrink-0">{m.chartType.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-wiz-text font-body truncate">{m.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-[10px] font-mono text-wiz-dim hidden md:inline">{m.datasetName}</span>
                    {m.accepts > 0 && <span className="text-[10px] font-mono text-wiz-emerald">👍 {m.accepts}</span>}
                    {m.dismisses > 0 && <span className="text-[10px] font-mono text-wiz-rose">👎 {m.dismisses}</span>}
                    <span className="text-[10px] font-mono text-wiz-faint">×{m.viewedCount}</span>
                    <button onClick={() => handleDeleteMemory(m.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-wiz-rose/10 text-wiz-dim hover:text-wiz-rose transition-all"><Trash2 size={11} /></button>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : <p className="text-xs text-wiz-dim font-body">No memories yet — generate some charts on the Dashboard!</p>}
        </motion.div>

        <div className="flex items-center justify-end">
          <button onClick={() => handleReset('memory')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-wiz-muted hover:text-wiz-rose hover:border-wiz-rose/30 text-[11px] font-semibold transition-all btn-press">
            <RotateCcw size={13} />Reset Memory
          </button>
        </div>
      </>}

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-6 p-4 rounded-xl bg-wiz-accent/5 border border-wiz-accent/15 flex items-start gap-2">
        <Lightbulb size={14} className="text-wiz-accent mt-0.5 shrink-0" />
        <p className="text-[11px] text-wiz-muted font-body">
          <b>How memory works:</b> Every chart you generate is fingerprinted by dataset shape (numeric/categorical/time columns) and stored. When you upload a new dataset, the AI computes similarity with past memories and boosts charts that worked well in similar contexts. Plain feedback (👍/👎) trains both global weights AND memory.
        </p>
      </motion.div>
    </div>
  );
}
