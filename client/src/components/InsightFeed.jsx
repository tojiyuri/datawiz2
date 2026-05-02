import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, TrendingUp, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react';
import * as api from '../utils/api';

export default function InsightFeed({ dashboardId, refreshKey }) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const load = async () => {
    if (!dashboardId) return;
    setLoading(true);
    try {
      const r = await api.getDashboardInsights(dashboardId);
      setInsights(r.insights || []);
      setIdx(0);
    } catch { setInsights([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [dashboardId, refreshKey]);

  if (dismissed || (!loading && insights.length === 0)) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className="mb-3 rounded-2xl bg-gradient-to-r from-wiz-accent/[0.06] via-wiz-emerald/[0.04] to-transparent border border-wiz-accent/20 overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-wiz-accent to-wiz-accent-deep flex items-center justify-center shadow-lg shadow-wiz-accent/20 shrink-0">
            <Sparkles size={13} className="text-white" />
          </div>
          {loading ? (
            <p className="text-[11px] text-wiz-muted font-mono italic">Wiz is analyzing your dashboard...</p>
          ) : insights.length > 0 ? (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <p className="text-[9px] font-mono text-wiz-accent-light uppercase tracking-wider font-bold">Insight {idx + 1} of {insights.length}</p>
                  <span className="text-[9px] text-wiz-dim font-mono">· {insights[idx].tileName}</span>
                </div>
                <p className="text-[12px] text-wiz-text font-body leading-snug truncate">
                  <span className="mr-1.5">{insights[idx].icon}</span>
                  {insights[idx].text}
                </p>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}
                  className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text disabled:opacity-30 transition-colors">
                  <ChevronLeft size={13} />
                </button>
                <span className="text-[10px] font-mono text-wiz-dim w-10 text-center">{idx + 1}/{insights.length}</span>
                <button onClick={() => setIdx(i => Math.min(insights.length - 1, i + 1))} disabled={idx === insights.length - 1}
                  className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text disabled:opacity-30 transition-colors">
                  <ChevronRight size={13} />
                </button>
                <button onClick={load} title="Refresh insights" className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text transition-colors ml-1">
                  <RefreshCw size={11} />
                </button>
                <button onClick={() => setDismissed(true)} className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text transition-colors">
                  <X size={11} />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
