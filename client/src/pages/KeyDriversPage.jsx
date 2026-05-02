import { useState, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hash, Tag, Loader2, ArrowLeft, Activity, AlertCircle, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

/**
 * KeyDriversPage — pick a target column, see what drives it.
 *
 * The most useful single view in BI: which fields most influence outcome X?
 * Answers come from real statistics (Pearson, ANOVA, mutual information) —
 * not LLM summarisation.
 *
 * The page deliberately does NOT make causal claims. We show "associated
 * with" not "causes." That distinction is the difference between a credible
 * tool and a misleading one.
 */
export default function KeyDriversPage({ dataset, analysis }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const columns = analysis?.columns || [];

  // Numeric & categorical columns — drop IDs and hi-cardinality
  const usefulTargets = useMemo(() =>
    columns.filter(c => {
      const nameL = (c.name || '').toLowerCase();
      if (/^id$|_id$|^uuid|guid|postal|zip$/.test(nameL)) return false;
      if (c.type === 'numeric' || c.type === 'integer') return true;
      if (c.type === 'categorical' && (!c.uniqueCount || c.uniqueCount <= 50)) return true;
      return false;
    }), [columns]);

  const run = async () => {
    if (!target || !dataset?.id) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await api.analyzeDrivers(dataset.id, target);
      setResult(r);
      if (!r.drivers?.length) {
        toast('No clear drivers found.', { icon: '🤷' });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Driver analysis failed');
    } finally {
      setRunning(false);
    }
  };

  if (!dataset || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-text-tertiary">
        <Activity size={40} strokeWidth={1.25} className="mb-4 opacity-40"/>
        <p className="text-sm font-body mb-3">No dataset loaded.</p>
        <button onClick={() => navigate('/')} className="btn-secondary text-xs">Upload a file</button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 pt-8 pb-16">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs text-wiz-tertiary hover:text-wiz-text mb-3 font-mono">
        <ArrowLeft size={12} /> Back
      </button>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <p className="eyebrow mb-3">Key Driver Analysis</p>
        <h1 className="h1 mb-2">
          What <span className="italic text-wiz-accent">drives</span> a number?
        </h1>
        <p className="text-base text-wiz-text-secondary max-w-2xl">
          Pick a column to predict. Wiz scans every other column and ranks them by how strongly they predict your target.
        </p>
      </motion.div>

      {/* Target picker */}
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="card p-5 mb-8">
        <p className="eyebrow mb-3">Target column</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {usefulTargets.map(c => {
            const Icon = c.type === 'numeric' || c.type === 'integer' ? Hash : Tag;
            const active = target === c.name;
            return (
              <button
                key={c.name}
                onClick={() => setTarget(c.name)}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                  transition-colors duration-150 border
                  ${active
                    ? 'bg-wiz-accent text-wiz-bg border-wiz-accent'
                    : 'bg-wiz-surface text-wiz-text-secondary border-wiz-border hover:border-wiz-border-strong'}
                `}
              >
                <Icon size={11} strokeWidth={1.75}/>
                {c.name}
              </button>
            );
          })}
        </div>
        {usefulTargets.length === 0 && (
          <p className="text-xs text-wiz-text-tertiary italic">No suitable columns found in this dataset.</p>
        )}
        <button
          onClick={run}
          disabled={!target || running}
          className="btn-primary"
        >
          {running ? <Loader2 size={14} className="animate-spin"/> : <Activity size={14} strokeWidth={2}/>}
          Find drivers
        </button>
      </motion.div>

      {/* Results */}
      {result && result.drivers && result.drivers.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="h3">Top drivers of <span className="italic text-wiz-accent">{result.target}</span></h2>
            {result.scanStats && (
              <p className="text-xs text-wiz-text-tertiary font-mono">
                scanned {result.scanStats.columnsScanned} columns in {result.scanStats.durationMs}ms
              </p>
            )}
          </div>

          <div className="space-y-2">
            {result.drivers.map((d, i) => (
              <DriverCard key={d.feature} driver={d} index={i} maxScore={result.drivers[0].importance}/>
            ))}
          </div>

          <div className="mt-8 px-4 py-3 rounded-lg bg-wiz-card border border-wiz-border text-xs text-wiz-text-tertiary">
            <strong className="text-wiz-text-secondary">Note:</strong> These are statistical associations, not causal claims.
            A strong driver is correlated with the target — it doesn't mean changing it would change the outcome.
          </div>
        </motion.div>
      )}

      {result && (!result.drivers || result.drivers.length === 0) && (
        <div className="card p-6 text-center">
          <AlertCircle size={20} strokeWidth={1.5} className="mx-auto mb-2 text-wiz-tertiary"/>
          <p className="text-sm text-wiz-text-secondary">No clear drivers found for <span className="font-medium">{result.target}</span>.</p>
          <p className="text-xs text-wiz-text-tertiary mt-1">Try a different target — sometimes the data is too noisy or balanced.</p>
        </div>
      )}
    </div>
  );
}

// ─── Driver card ─────────────────────────────────────────────────────────────

function DriverCard({ driver, index, maxScore }) {
  const [open, setOpen] = useState(false);
  const widthPct = maxScore ? Math.max(2, (driver.importance / maxScore) * 100) : 0;

  const directionLabel = driver.direction === 'positive' ? '+' : driver.direction === 'negative' ? '−' : '·';
  const directionColor =
    driver.direction === 'positive' ? 'text-wiz-success' :
    driver.direction === 'negative' ? 'text-wiz-danger' : 'text-wiz-text-tertiary';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="card overflow-hidden"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 hover:bg-wiz-card transition-colors"
      >
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-mono text-wiz-text-tertiary w-6">#{index + 1}</span>
          <span className="text-sm font-medium text-wiz-text flex-1">{driver.feature}</span>
          <span className="text-xs font-mono text-wiz-text-tertiary uppercase tracking-wider">
            {driver.method}
          </span>
          <span className={`text-base font-display font-semibold ${directionColor} w-4 text-center`}>
            {directionLabel}
          </span>
          <span className="text-base font-display font-semibold text-wiz-accent tabular-nums w-12 text-right">
            {driver.importance.toFixed(0)}
          </span>
          <ChevronDown size={13} className={`text-wiz-tertiary transition-transform ${open ? 'rotate-180' : ''}`}/>
        </div>
        {/* Importance bar */}
        <div className="h-1 bg-wiz-card rounded-full overflow-hidden ml-9 mr-20">
          <div
            className="h-full bg-wiz-accent rounded-full transition-all duration-500"
            style={{ width: `${widthPct}%` }}
          />
        </div>
        <p className="text-xs text-wiz-text-secondary mt-2 ml-9">{driver.summary}</p>
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="border-t border-wiz-border bg-wiz-card/40"
        >
          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 font-mono text-xs">
            {driver.r != null && (
              <div><p className="eyebrow text-wiz-tertiary">Correlation r</p><p className="text-wiz-text mt-0.5">{driver.r.toFixed(3)}</p></div>
            )}
            {driver.F != null && (
              <div><p className="eyebrow text-wiz-tertiary">F-statistic</p><p className="text-wiz-text mt-0.5">{driver.F.toFixed(2)}</p></div>
            )}
            {driver.etaSquared != null && (
              <div><p className="eyebrow text-wiz-tertiary">η² (var explained)</p><p className="text-wiz-text mt-0.5">{(driver.etaSquared * 100).toFixed(1)}%</p></div>
            )}
            {driver.normalisedMI != null && (
              <div><p className="eyebrow text-wiz-tertiary">Normalised MI</p><p className="text-wiz-text mt-0.5">{driver.normalisedMI.toFixed(3)}</p></div>
            )}
            {driver.sampleSize != null && (
              <div><p className="eyebrow text-wiz-tertiary">Sample size</p><p className="text-wiz-text mt-0.5">{driver.sampleSize.toLocaleString()}</p></div>
            )}
            {driver.groupCount != null && (
              <div><p className="eyebrow text-wiz-tertiary">Groups</p><p className="text-wiz-text mt-0.5">{driver.groupCount}</p></div>
            )}
          </div>

          {driver.contributors && driver.contributors.length > 0 && (
            <div className="px-4 pb-4">
              <p className="eyebrow mb-2">Top contributing levels</p>
              <div className="space-y-1.5">
                {driver.contributors.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-3 text-xs">
                    <span className="text-wiz-text font-medium w-32 truncate">{c.level}</span>
                    <span className="text-wiz-text-tertiary font-mono w-12 text-right tabular-nums">n={c.n}</span>
                    <span className="text-wiz-text-secondary font-mono w-20 text-right tabular-nums">{c.groupMean}</span>
                    <span className={`font-mono tabular-nums ${c.delta > 0 ? 'text-wiz-success' : 'text-wiz-danger'}`}>
                      {c.delta > 0 ? '+' : ''}{c.delta}
                      {c.deltaPct != null && (
                        <span className="opacity-60 ml-1">({c.deltaPct > 0 ? '+' : ''}{c.deltaPct}%)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
