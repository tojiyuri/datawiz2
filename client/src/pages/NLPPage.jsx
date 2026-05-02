import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Search, Database, X, Clock, Wand2, Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';
import ChartRenderer from '../components/ChartRenderer';
import * as api from '../utils/api';

export default function NLPPage({ dataset, analysis }) {
  const [query, setQuery] = useState('');
  const [charts, setCharts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { if (dataset?.id) api.getSuggestions(dataset.id).then(r => setSuggestions(r.suggestions||[])).catch(()=>{}); }, [dataset]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async () => {
    if (!query.trim()||!dataset?.id) return;
    setLoading(true); const q = query.trim(); setQuery('');
    try {
      const r = await api.queryNLP(dataset.id, q);
      setCharts(p => [{ ...r.spec, chartData:r.chartData, stackKeys:r.stackKeys, id:Date.now() }, ...p]);
      setHistory(p => [q,...p.filter(h=>h!==q)].slice(0,10));
    } catch { toast.error('Query failed'); } finally { setLoading(false); }
  };

  if (!dataset||!analysis) return <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-muted"><Database size={48} className="mb-4 opacity-30"/><p className="text-sm">No dataset loaded.</p><button onClick={()=>navigate('/')} className="mt-3 text-wiz-accent text-sm font-semibold hover:underline">Upload</button></div>;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} className="mb-5">
        <h2 className="text-xl font-extrabold font-display text-wiz-text mb-1 flex items-center gap-2"><Sparkles size={20} className="text-wiz-accent"/>Prompt-to-Visualization</h2>
        <p className="text-sm text-wiz-muted font-body">Describe what you want to see — supports 15+ chart types</p>
      </motion.div>

      {/* Prompt Bar */}
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.1}}
        className={`flex items-center gap-3 px-5 py-1.5 rounded-2xl border-2 glass transition-all duration-300 ${loading?'border-wiz-accent/40 glow-sm':'border-transparent focus-within:border-wiz-accent/40 focus-within:glow-sm'}`}>
        <Search size={18} className="text-wiz-dim shrink-0"/>
        <input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} placeholder='Try: "heatmap of sales by region and product" or "radar chart comparing all metrics"' className="flex-1 bg-transparent border-none outline-none text-sm text-wiz-text placeholder:text-wiz-faint py-3 font-body" disabled={loading}/>
        <motion.button onClick={submit} disabled={loading||!query.trim()} whileHover={{scale:1.04}} whileTap={{scale:0.96}}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shrink-0 btn-press ${loading?'bg-wiz-accent/40 text-white/50':query.trim()?'bg-gradient-to-r from-wiz-accent-deep to-wiz-accent text-white shadow-lg shadow-wiz-accent/20':'bg-wiz-card text-wiz-dim cursor-not-allowed'}`}>
          {loading?<div className="spinner w-3.5 h-3.5"/>:<Wand2 size={14}/>}Generate
        </motion.button>
      </motion.div>

      {/* Suggestions */}
      {suggestions.length>0 && charts.length===0 && <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} className="mt-4 mb-6">
        <p className="text-[10px] text-wiz-dim font-mono uppercase tracking-wider mb-2 flex items-center gap-1.5"><Lightbulb size={10} className="text-wiz-amber"/>Suggested queries</p>
        <div className="flex flex-wrap gap-2">{suggestions.map((s,i)=><motion.button key={i} initial={{opacity:0,scale:0.9}} animate={{opacity:1,scale:1}} transition={{delay:0.25+i*0.04}} onClick={()=>{setQuery(s);inputRef.current?.focus();}} className="px-3 py-1.5 rounded-xl glass text-xs text-wiz-muted hover:text-wiz-accent-light hover:border-wiz-accent/20 transition-all font-body btn-press">{s}</motion.button>)}</div>
      </motion.div>}

      {/* History */}
      {history.length>0 && <div className="mt-3 mb-5 flex items-center gap-2 overflow-x-auto pb-1"><Clock size={12} className="text-wiz-dim shrink-0"/>{history.slice(0,5).map((h,i)=><button key={i} onClick={()=>{setQuery(h);inputRef.current?.focus();}} className="px-2.5 py-1 rounded-lg bg-wiz-card/50 border border-wiz-border/30 text-[10px] text-wiz-muted hover:text-wiz-accent-light font-mono whitespace-nowrap shrink-0 transition-colors">{h}</button>)}</div>}

      {/* Empty */}
      {!charts.length && <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.4}} className="text-center py-16">
        <div className="w-20 h-20 rounded-3xl bg-wiz-accent/5 border border-wiz-accent/10 flex items-center justify-center mx-auto mb-5"><Sparkles size={32} className="text-wiz-accent/30"/></div>
        <p className="text-base font-display font-semibold text-wiz-muted mb-2">Your charts will appear here</p>
        <p className="text-xs text-wiz-dim max-w-sm mx-auto font-body">Bar, line, scatter, pie, donut, histogram, heatmap, radar, treemap, box plot, waterfall, funnel, combo & more</p>
      </motion.div>}

      {/* Charts */}
      <AnimatePresence><div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-4">
        {charts.map(ch=>(
          <motion.div key={ch.id} initial={{opacity:0,scale:0.92,y:20}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:0.95}} transition={{type:'spring',stiffness:300,damping:25}}
            className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 overflow-hidden group card-lift">
            <div className="flex items-start justify-between px-5 py-3.5 border-b border-wiz-border/30">
              <div className="flex-1 min-w-0"><p className="text-sm font-bold font-display text-wiz-text truncate">"{ch.query}"</p><p className="text-[10px] font-mono text-wiz-muted mt-0.5">{ch.x} × {ch.y} → {ch.type.replace('_',' ')} {ch.confidence?`· ${Math.round(ch.confidence*100)}%`:''}</p></div>
              <div className="flex items-center gap-2 ml-3"><span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-wiz-emerald/10 text-wiz-emerald">NLP</span><button onClick={()=>setCharts(p=>p.filter(c=>c.id!==ch.id))} className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-wiz-bg/60 text-wiz-muted hover:text-wiz-rose transition-all"><X size={12}/></button></div>
            </div>
            <div className="px-3 py-4"><ChartRenderer spec={ch} chartData={ch.chartData} stackKeys={ch.stackKeys} height={280}/></div>
          </motion.div>
        ))}
      </div></AnimatePresence>
    </div>
  );
}
