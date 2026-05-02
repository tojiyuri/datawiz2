import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Wrench, Database, AlertTriangle, AlertCircle, Info, CheckCircle2, Zap, Download, ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

const sev = {
  high: { icon: AlertTriangle, color: '#FB7185', bg: 'bg-rose-500/10', text: 'text-rose-400', label: 'HIGH' },
  medium: { icon: AlertCircle, color: '#FBBF24', bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'MED' },
  low: { icon: Info, color: '#38BDF8', bg: 'bg-sky-500/10', text: 'text-sky-400', label: 'LOW' },
};
const fixL = { fill_mean:'Fill Mean', fill_median:'Fill Median', fill_mode:'Fill Mode', fill_zero:'Fill 0', fill_custom:'Custom', drop_rows:'Drop Rows', trim_whitespace:'Trim', lowercase:'Lowercase', uppercase:'Uppercase', titlecase:'Title Case', cap_outliers:'Cap Outliers', remove_outliers:'Remove Outliers', remove_duplicate_rows:'Remove Dupes', drop_column:'Drop Column' };

export default function CleaningPage({ dataset, analysis, onAnalysisUpdate }) {
  const [issues, setIssues] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(null);
  const [autoLog, setAutoLog] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (dataset?.id) { setLoading(true); api.getIssues(dataset.id).then(r=>{setIssues(r.issues||[]);setSummary(r.summary);}).catch(()=>{}).finally(()=>setLoading(false)); }
  }, [dataset, analysis]);

  const fix = async (action, column) => {
    setApplying(`${action}-${column}`);
    try { const r = await api.applyClean(dataset.id, action, column); toast.success(`${fixL[action]||action}: ${r.affectedCount} affected`); onAnalysisUpdate(r.analysis); } catch { toast.error('Fix failed'); }
    finally { setApplying(null); }
  };

  const autoClean = async () => {
    setApplying('auto');
    try { const r = await api.autoClean(dataset.id); setAutoLog(r.log); onAnalysisUpdate(r.analysis); toast.success(`Auto-clean: ${r.log.length} operations done`); } catch { toast.error('Auto-clean failed'); }
    finally { setApplying(null); }
  };

  if (!dataset||!analysis) return <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-muted"><Database size={48} className="mb-4 opacity-30"/><p className="text-sm">No dataset loaded.</p><button onClick={()=>navigate('/')} className="mt-3 text-wiz-accent text-sm font-semibold hover:underline">Upload</button></div>;

  const q = analysis.summary?.qualityScore||0;
  const qc = q>90?'#34D399':q>70?'#FBBF24':'#FB7185';

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="flex items-start justify-between mb-6">
        <div><h2 className="text-xl font-extrabold font-display text-wiz-text mb-1 flex items-center gap-2"><Wrench size={20} className="text-wiz-accent"/>Data Cleaning</h2><p className="text-sm text-wiz-muted font-body">Detect and fix quality issues to structure your dataset</p></div>
        <div className="flex items-center gap-3">
          <a href={api.getDownloadUrl(dataset.id)} download className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-wiz-muted hover:text-wiz-emerald text-[11px] font-semibold transition-all btn-press"><Download size={13}/>CSV</a>
          <motion.button onClick={()=>navigate('/dashboard')} whileHover={{scale:1.04}} whileTap={{scale:0.96}} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-wiz-accent-deep to-wiz-accent text-white text-[11px] font-semibold shadow-lg shadow-wiz-accent/20 btn-press">Dashboard <ArrowRight size={13}/></motion.button>
        </div>
      </motion.div>

      {/* Quality + Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <motion.div initial={{opacity:0,scale:0.9}} animate={{opacity:1,scale:1}} className="p-4 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40 col-span-2 md:col-span-1 flex flex-col items-center justify-center">
          <div className="relative w-24 h-24 mb-2">
            <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
              <path d="M18 2.5a15.5 15.5 0 010 31 15.5 15.5 0 010-31" fill="none" stroke="rgba(30,41,59,0.4)" strokeWidth="2.5"/>
              <motion.path d="M18 2.5a15.5 15.5 0 010 31 15.5 15.5 0 010-31" fill="none" stroke={qc} strokeWidth="2.5" strokeLinecap="round"
                initial={{strokeDasharray:'0, 100'}} animate={{strokeDasharray:`${q}, 100`}} transition={{duration:1.5,ease:'easeOut',delay:0.3}}/>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-extrabold font-display" style={{color:qc}}>{q}%</span></div>
          </div>
          <p className="text-[10px] text-wiz-muted font-mono uppercase">Quality</p>
        </motion.div>
        {[{l:'Issues',v:issues.length,c:issues.length?'#FBBF24':'#34D399'},{l:'High',v:summary?.high||0,c:'#FB7185'},{l:'Medium',v:summary?.medium||0,c:'#FBBF24'},{l:'Low',v:summary?.low||0,c:'#38BDF8'}].map((s,i)=>
          <motion.div key={i} initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:0.1+i*0.06}} className="p-4 rounded-2xl bg-wiz-surface/50 border border-wiz-border/40">
            <p className="text-[10px] text-wiz-muted font-mono uppercase tracking-wider mb-1">{s.l}</p>
            <p className="text-2xl font-extrabold font-display" style={{color:s.c}}>{s.v}</p>
          </motion.div>
        )}
      </div>

      {/* Auto-Clean */}
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.2}} className="flex items-center gap-4 mb-6 p-5 rounded-2xl glass">
        <div className="flex-1"><h3 className="text-sm font-bold font-display text-wiz-text flex items-center gap-2"><Zap size={16} className="text-wiz-amber"/>One-Click Auto-Clean</h3><p className="text-xs text-wiz-muted mt-1 font-body">Removes duplicates → Trims whitespace → Fills nulls → Standardizes casing</p></div>
        <motion.button onClick={autoClean} disabled={applying==='auto'} whileHover={{scale:1.04}} whileTap={{scale:0.96}}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-wiz-accent-deep to-wiz-accent text-white text-xs font-semibold shadow-xl shadow-wiz-accent/20 disabled:opacity-50 btn-press shrink-0">
          {applying==='auto'?<div className="spinner w-4 h-4"/>:<Sparkles size={15}/>}Auto-Clean
        </motion.button>
      </motion.div>

      {/* Auto-Clean Log */}
      <AnimatePresence>{autoLog?.length>0 && <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0}} className="mb-6 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/15">
        <h4 className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-1.5"><CheckCircle2 size={14}/>Auto-Clean Complete</h4>
        {autoLog.map((l,i)=><div key={i} className="flex items-center justify-between text-xs py-1"><span className="text-wiz-text-secondary font-body">{l.action}</span><span className="text-wiz-muted font-mono">{l.affected} rows</span></div>)}
      </motion.div>}</AnimatePresence>

      {/* No issues */}
      {!issues.length && !loading && <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}} className="text-center py-16">
        <div className="w-20 h-20 rounded-3xl bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-center mx-auto mb-5"><CheckCircle2 size={32} className="text-emerald-400"/></div>
        <h3 className="text-base font-bold font-display text-wiz-text mb-1">Dataset is clean!</h3>
        <p className="text-xs text-wiz-muted font-body">No quality issues found. Ready for visualization.</p>
      </motion.div>}

      {loading && <div className="flex justify-center py-16"><div className="spinner w-10 h-10"/></div>}

      {/* Issues */}
      {issues.length>0 && <div>
        <h3 className="text-sm font-bold font-display text-wiz-text mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-wiz-amber"/>Issues ({issues.length})</h3>
        <div className="space-y-3">
          {issues.map((issue,i) => {
            const s = sev[issue.severity]||sev.low; const SIcon = s.icon;
            return (
              <motion.div key={i} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.04}}
                className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 p-4 card-lift">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${s.bg}`}><SIcon size={16} style={{color:s.color}}/></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold ${s.bg} ${s.text}`}>{s.label}</span>
                      {issue.column!=='_all_'&&<span className="text-xs font-mono text-wiz-accent-light">{issue.column}</span>}
                      <span className="text-[10px] font-mono text-wiz-dim px-1.5 py-0.5 rounded-md bg-wiz-bg/40">{issue.type.replace(/_/g,' ')}</span>
                    </div>
                    <p className="text-sm text-wiz-text font-body">{issue.message}</p>
                  </div>
                </div>
                {issue.fixes?.length>0 && <div className="mt-3 pt-3 border-t border-wiz-border/20 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-wiz-dim font-mono mr-1">Fix:</span>
                  {issue.fixes.map((f,j)=>{const ap=applying===`${f}-${issue.column}`;return(
                    <motion.button key={j} onClick={()=>fix(f,issue.column)} disabled={!!applying} whileHover={{scale:1.05}} whileTap={{scale:0.95}}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all btn-press ${ap?'bg-wiz-accent/15 border-wiz-accent/25 text-wiz-accent-light':'bg-wiz-bg/40 border-wiz-border/30 text-wiz-muted hover:border-wiz-accent/25 hover:text-wiz-accent-light'}`}>
                      {ap?<div className="spinner w-2.5 h-2.5"/>:<RefreshCw size={10}/>}{fixL[f]||f}
                    </motion.button>
                  );})}
                </div>}
              </motion.div>
            );
          })}
        </div>
      </div>}

      <div className="mt-8 p-4 rounded-2xl glass text-center">
        <p className="text-xs text-wiz-muted font-body">Current: <span className="text-wiz-text font-semibold">{analysis.summary?.rows?.toLocaleString()}</span> rows × <span className="text-wiz-text font-semibold">{analysis.summary?.columns}</span> cols · Quality: <span className="font-bold" style={{color:qc}}>{q}%</span></p>
      </div>
    </div>
  );
}
