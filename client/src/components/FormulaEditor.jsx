import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calculator, CheckCircle2, AlertCircle, Hash, Tag, Clock, BookOpen, Plus } from 'lucide-react';
import * as api from '../utils/api';

const FUNCTION_HELP = {
  'Aggregates': [
    { fn: 'SUM([field])', desc: 'Sum of values' },
    { fn: 'AVG([field])', desc: 'Average' },
    { fn: 'COUNT([field])', desc: 'Count non-null' },
    { fn: 'COUNTD([field])', desc: 'Distinct count' },
    { fn: 'MIN([field])', desc: 'Minimum' },
    { fn: 'MAX([field])', desc: 'Maximum' },
    { fn: 'MEDIAN([field])', desc: 'Median' },
    { fn: 'STDEV([field])', desc: 'Standard deviation' },
  ],
  'Logical': [
    { fn: 'IF cond THEN x ELSE y END', desc: 'Conditional' },
    { fn: 'CASE [field] WHEN v1 THEN r1 ELSE r2 END', desc: 'Multi-branch' },
    { fn: 'AND, OR, NOT', desc: 'Combine conditions' },
    { fn: 'ISNULL([field])', desc: 'True if null' },
    { fn: 'COALESCE(a, b, c)', desc: 'First non-null' },
  ],
  'Math': [
    { fn: 'ROUND(x, n)', desc: 'Round to n decimals' },
    { fn: 'ABS, FLOOR, CEIL', desc: 'Absolute, floor, ceiling' },
    { fn: 'SQRT, LOG, LN, EXP', desc: 'Math functions' },
    { fn: 'POW(x, y)', desc: 'x to the power of y' },
  ],
  'Text': [
    { fn: 'CONCAT(a, b, ...)', desc: 'Join strings' },
    { fn: 'UPPER, LOWER, TRIM', desc: 'Case + trim' },
    { fn: 'CONTAINS([f], "x")', desc: 'Substring check' },
    { fn: 'LEFT/RIGHT([f], n)', desc: 'First/last n chars' },
  ],
  'Date': [
    { fn: 'YEAR([d]), MONTH, DAY', desc: 'Date parts' },
    { fn: 'DATEPART("week", [d])', desc: 'Custom date part' },
    { fn: 'DATEDIFF([d1], [d2])', desc: 'Days between' },
    { fn: 'TODAY()', desc: "Today's date" },
  ],
};

const EXAMPLES = [
  { name: 'Profit', formula: '[Sales] - [Cost]', desc: 'Simple difference' },
  { name: 'Margin %', formula: 'ROUND(([Sales] - [Cost]) / [Sales] * 100, 1)', desc: 'Percentage' },
  { name: 'Tier', formula: 'IF [Sales] > 1000 THEN "High" ELSEIF [Sales] > 500 THEN "Medium" ELSE "Low" END', desc: 'Bucketing (use nested IFs)' },
  { name: 'YoY Growth', formula: 'SUM([Sales]) / SUM([Sales_LY]) - 1', desc: 'Aggregate ratio' },
];

export default function FormulaEditor({ open, onClose, onSave, datasetId, columns, initialField }) {
  const [name, setName] = useState(initialField?.name || '');
  const [formula, setFormula] = useState(initialField?.formula || '');
  const [validation, setValidation] = useState(null);
  const [activeTab, setActiveTab] = useState('functions');
  const textareaRef = useRef(null);

  useEffect(() => {
    setName(initialField?.name || '');
    setFormula(initialField?.formula || '');
    setValidation(null);
  }, [initialField, open]);

  // Live validation (debounced)
  useEffect(() => {
    if (!formula.trim()) { setValidation(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.validateFormula(formula, datasetId);
        setValidation(r);
      } catch { setValidation({ ok: false, error: 'Validation failed' }); }
    }, 300);
    return () => clearTimeout(t);
  }, [formula, datasetId]);

  const insertText = (text) => {
    const ta = textareaRef.current;
    if (!ta) { setFormula(formula + text); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const newVal = formula.slice(0, start) + text + formula.slice(end);
    setFormula(newVal);
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + text.length, start + text.length); }, 0);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (!validation?.ok) return;
    onSave({ name: name.trim(), formula: formula.trim() });
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={onClose}>
        <motion.div initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 5 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className="bg-wiz-surface border border-wiz-border/50 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl"
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-wiz-border/40">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center">
                <Calculator size={15} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold font-display text-wiz-text">{initialField ? 'Edit Calculated Field' : 'New Calculated Field'}</h3>
                <p className="text-[10px] text-wiz-muted font-mono">Tableau-style formulas · live validation</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-wiz-bg/60 text-wiz-muted hover:text-wiz-text transition-colors"><X size={16} /></button>
          </div>

          <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
            {/* LEFT: Editor */}
            <div className="col-span-7 p-5 flex flex-col gap-3 overflow-y-auto">
              <div>
                <label className="text-[10px] font-mono text-wiz-muted uppercase tracking-wider mb-1.5 block">Field Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Profit Margin"
                  className="w-full bg-wiz-bg/60 border border-wiz-border/40 rounded-xl px-3 py-2 text-sm text-wiz-text font-mono outline-none focus:border-amber-500/40" />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="text-[10px] font-mono text-wiz-muted uppercase tracking-wider mb-1.5 block flex items-center justify-between">
                  Formula
                  <span className="text-wiz-dim normal-case tracking-normal text-[9px] font-body">Use [Field Name] for fields</span>
                </label>
                <textarea ref={textareaRef} value={formula} onChange={(e) => setFormula(e.target.value)}
                  placeholder='e.g. [Sales] - [Cost]&#10;e.g. ROUND(SUM([Profit]) / SUM([Sales]) * 100, 2)&#10;e.g. IF [Region] = "North" THEN [Sales] * 1.1 ELSE [Sales] END'
                  spellCheck={false}
                  className="flex-1 min-h-[160px] bg-wiz-bg/60 border border-wiz-border/40 rounded-xl px-3 py-2.5 text-[13px] text-wiz-text font-mono outline-none focus:border-amber-500/40 resize-none leading-relaxed" />
              </div>
              {/* Validation feedback */}
              <div className="min-h-[40px]">
                {!formula.trim() ? (
                  <p className="text-[10px] text-wiz-dim font-mono italic">Start typing your formula above</p>
                ) : validation?.ok ? (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                    <span className="text-[11px] text-emerald-300 font-mono">Valid formula{validation.isAggregate ? ' · uses aggregates' : ' · row-level'}</span>
                  </div>
                ) : validation ? (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25">
                    <AlertCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-rose-300 font-mono">
                      {validation.error || (validation.missing?.length ? `Unknown fields: ${validation.missing.join(', ')}` : 'Invalid')}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-wiz-bg/40 border border-wiz-border/30">
                    <div className="spinner w-3 h-3" />
                    <span className="text-[11px] text-wiz-muted font-mono">Validating...</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={onClose} className="px-4 py-2 rounded-xl bg-wiz-bg/40 border border-wiz-border/40 text-wiz-muted hover:text-wiz-text text-[11px] font-semibold transition-all">Cancel</button>
                <button onClick={handleSave} disabled={!name.trim() || !validation?.ok}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20">
                  {initialField ? 'Update Field' : 'Create Field'}
                </button>
              </div>
            </div>

            {/* RIGHT: Reference panel */}
            <div className="col-span-5 border-l border-wiz-border/40 flex flex-col bg-wiz-bg/30 min-h-0">
              <div className="flex items-center px-3 pt-3 gap-1 border-b border-wiz-border/30">
                {[{id:'fields',label:'Fields',icon:Tag},{id:'functions',label:'Functions',icon:BookOpen},{id:'examples',label:'Examples',icon:Plus}].map(t => {
                  const Icon = t.icon; const active = activeTab === t.id;
                  return (
                    <button key={t.id} onClick={() => setActiveTab(t.id)}
                      className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold transition-all border-b-2 ${active ? 'text-wiz-text border-amber-500' : 'text-wiz-muted border-transparent hover:text-wiz-text-secondary'}`}>
                      <Icon size={11} />{t.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {activeTab === 'fields' && (
                  <>
                    <p className="text-[9px] font-mono text-wiz-dim uppercase tracking-wider px-1">Click a field to insert</p>
                    {columns?.map((c, i) => {
                      const Icon = c.type === 'numeric' ? Hash : c.type === 'temporal' ? Clock : Tag;
                      const color = c.type === 'numeric' ? '#FBBF24' : c.type === 'temporal' ? '#38BDF8' : '#818CF8';
                      return (
                        <button key={i} onClick={() => insertText(`[${c.name}]`)}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-wiz-bg/40 border border-wiz-border/30 hover:border-wiz-accent/30 hover:bg-wiz-accent/5 transition-all text-left">
                          <Icon size={11} style={{ color }} />
                          <span className="text-[11px] font-mono text-wiz-text flex-1 truncate">{c.name}</span>
                          <span className="text-[8px] font-mono opacity-60" style={{ color }}>{c.type.slice(0, 3).toUpperCase()}</span>
                        </button>
                      );
                    })}
                  </>
                )}
                {activeTab === 'functions' && (
                  Object.entries(FUNCTION_HELP).map(([cat, fns]) => (
                    <div key={cat}>
                      <p className="text-[9px] font-mono text-amber-400 uppercase tracking-wider px-1 mb-1 mt-2 first:mt-0">{cat}</p>
                      {fns.map((f, i) => (
                        <button key={i} onClick={() => insertText(f.fn)}
                          className="w-full px-2 py-1.5 rounded-lg hover:bg-wiz-bg/40 transition-all text-left mb-0.5 group">
                          <p className="text-[11px] font-mono text-wiz-text-secondary group-hover:text-wiz-text">{f.fn}</p>
                          <p className="text-[10px] text-wiz-dim font-body">{f.desc}</p>
                        </button>
                      ))}
                    </div>
                  ))
                )}
                {activeTab === 'examples' && (
                  EXAMPLES.map((ex, i) => (
                    <button key={i} onClick={() => { setName(ex.name); setFormula(ex.formula); }}
                      className="w-full px-3 py-2 rounded-lg bg-wiz-bg/40 border border-wiz-border/30 hover:border-amber-500/30 transition-all text-left">
                      <p className="text-[11px] font-bold font-display text-wiz-text">{ex.name}</p>
                      <p className="text-[10px] font-mono text-wiz-text-secondary mt-0.5">{ex.formula}</p>
                      <p className="text-[10px] text-wiz-dim font-body mt-0.5">{ex.desc}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
