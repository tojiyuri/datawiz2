import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Upload, FileSpreadsheet, Hash, Tag, Clock, Type, Save, X, ChevronRight, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

const typeOpts = [
  { v: 'numeric', l: 'Number', icon: Hash, c: '#818CF8' },
  { v: 'categorical', l: 'Category', icon: Tag, c: '#34D399' },
  { v: 'temporal', l: 'Date', icon: Clock, c: '#FBBF24' },
  { v: 'text', l: 'Text', icon: Type, c: '#64748B' },
];

export default function CreateDatasetPage({ onCreated }) {
  const [name, setName] = useState('My Dataset');
  const [columns, setColumns] = useState([
    { name: 'Date', type: 'temporal' },
    { name: 'Product', type: 'categorical' },
    { name: 'Quantity', type: 'numeric' },
    { name: 'Revenue', type: 'numeric' },
  ]);
  const [rows, setRows] = useState([
    ['2024-01-15', 'Coffee', 3, 13.5],
    ['2024-01-15', 'Sandwich', 2, 16.0],
    ['', '', '', ''],
  ]);
  const [templates, setTemplates] = useState([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => { api.getTemplates().then(r => setTemplates(r.templates || [])).catch(() => {}); }, []);

  const addColumn = () => setColumns([...columns, { name: `Column ${columns.length + 1}`, type: 'text' }]) || setRows(rows.map(r => [...r, '']));
  const updateColumn = (i, patch) => setColumns(cols => cols.map((c, j) => j === i ? { ...c, ...patch } : c));
  const removeColumn = (i) => { setColumns(cols => cols.filter((_, j) => j !== i)); setRows(rs => rs.map(r => r.filter((_, j) => j !== i))); };
  const addRow = () => setRows([...rows, columns.map(() => '')]);
  const updateCell = (ri, ci, v) => setRows(rs => rs.map((r, i) => i === ri ? r.map((c, j) => j === ci ? v : c) : r));
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i));

  const useTemplate = (tpl) => {
    setName(tpl.name);
    setColumns(tpl.columns);
    setRows([...tpl.sampleRows, tpl.columns.map(() => '')]);
    setShowTemplates(false);
    toast.success(`Loaded "${tpl.name}" template`);
  };

  const handleSave = async () => {
    const validRows = rows.filter(r => r.some(c => c !== '' && c != null));
    if (!validRows.length) { toast.error('Add at least one row of data'); return; }
    if (!columns.length) { toast.error('Add at least one column'); return; }
    if (columns.some(c => !c.name?.trim())) { toast.error('All columns need names'); return; }
    setSaving(true);
    try {
      const r = await api.createDataset(name, columns, validRows);
      toast.success(`Created "${r.fileName}"`);
      onCreated({ id: r.datasetId, fileName: r.fileName, rowCount: r.rowCount, columnCount: r.columnCount, fileSize: 0 }, r.analysis);
      navigate('/analysis');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to create dataset'); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-extrabold font-display text-wiz-text mb-1 flex items-center gap-2"><FileSpreadsheet size={20} className="text-wiz-accent" />Build Your Dataset</h2>
          <p className="text-sm text-wiz-muted font-body">Create a custom dataset for your business — enter your data row by row</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowTemplates(!showTemplates)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass text-wiz-muted hover:text-wiz-amber hover:border-wiz-amber/30 text-[11px] font-semibold transition-all btn-press">
            <Sparkles size={13} />Templates
          </button>
          <motion.button onClick={handleSave} disabled={saving} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-wiz-accent-deep to-wiz-accent text-white text-[11px] font-semibold shadow-lg shadow-wiz-accent/20 disabled:opacity-50 btn-press">
            {saving ? <div className="spinner w-3.5 h-3.5" /> : <Save size={13} />}Create & Analyze
          </motion.button>
        </div>
      </motion.div>

      {/* Templates */}
      <AnimatePresence>
        {showTemplates && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6 overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((t) => (
                <motion.button key={t.id} onClick={() => useTemplate(t)} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                  className="text-left p-4 rounded-2xl glass hover:border-wiz-accent/30 transition-all card-lift">
                  <div className="flex items-start justify-between mb-2"><h4 className="text-sm font-bold font-display text-wiz-text">{t.name}</h4><ChevronRight size={14} className="text-wiz-muted" /></div>
                  <p className="text-xs text-wiz-muted mb-2 font-body">{t.description}</p>
                  <div className="flex flex-wrap gap-1">{t.columns.slice(0, 4).map((c, i) => <span key={i} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-wiz-bg/60 text-wiz-dim">{c.name}</span>)}{t.columns.length > 4 && <span className="text-[9px] text-wiz-dim font-mono">+{t.columns.length - 4}</span>}</div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dataset name */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
        <label className="text-[10px] text-wiz-dim font-mono uppercase tracking-wider">Dataset Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full bg-wiz-surface/50 border border-wiz-border/40 rounded-xl px-4 py-2.5 text-sm text-wiz-text font-body outline-none focus:border-wiz-accent/40 transition-all" />
      </motion.div>

      {/* Table */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 overflow-hidden">
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-xs">
            {/* Column headers (editable) */}
            <thead className="sticky top-0 bg-wiz-surface z-10">
              <tr className="border-b-2 border-wiz-border/40">
                <th className="w-10 p-2"><span className="text-[9px] text-wiz-dim font-mono">#</span></th>
                {columns.map((col, ci) => {
                  const t = typeOpts.find(o => o.v === col.type);
                  return (
                    <th key={ci} className="p-2 min-w-[160px]">
                      <div className="flex flex-col gap-1.5">
                        <input value={col.name} onChange={(e) => updateColumn(ci, { name: e.target.value })}
                          className="bg-wiz-bg/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-xs font-semibold text-wiz-text font-display outline-none focus:border-wiz-accent/40 w-full" />
                        <div className="flex items-center gap-1">
                          <select value={col.type} onChange={(e) => updateColumn(ci, { type: e.target.value })}
                            className="bg-wiz-bg/60 border border-wiz-border/40 rounded-md px-1.5 py-1 text-[10px] font-mono text-wiz-muted outline-none focus:border-wiz-accent/40 flex-1" style={{ color: t?.c }}>
                            {typeOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>
                          <button onClick={() => removeColumn(ci)} className="p-1 rounded hover:bg-wiz-rose/10 text-wiz-dim hover:text-wiz-rose transition-colors"><X size={11} /></button>
                        </div>
                      </div>
                    </th>
                  );
                })}
                <th className="w-10 p-2">
                  <button onClick={addColumn} className="p-1.5 rounded-lg bg-wiz-accent/10 text-wiz-accent-light hover:bg-wiz-accent/20 transition-colors" title="Add column"><Plus size={14} /></button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-wiz-border/20 hover:bg-wiz-card/20 group">
                  <td className="p-2 text-center text-[10px] text-wiz-dim font-mono">{ri + 1}</td>
                  {columns.map((col, ci) => (
                    <td key={ci} className="p-1">
                      <input value={row[ci] ?? ''} onChange={(e) => updateCell(ri, ci, e.target.value)}
                        type={col.type === 'temporal' ? 'date' : col.type === 'numeric' ? 'number' : 'text'}
                        placeholder={col.type === 'numeric' ? '0' : col.type === 'temporal' ? 'YYYY-MM-DD' : '...'}
                        className="w-full bg-transparent border border-transparent hover:border-wiz-border/30 focus:border-wiz-accent/40 rounded-md px-2 py-1.5 text-xs text-wiz-text font-mono outline-none transition-all" />
                    </td>
                  ))}
                  <td className="p-1">
                    <button onClick={() => removeRow(ri)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-wiz-rose/10 text-wiz-dim hover:text-wiz-rose transition-all"><Trash2 size={11} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-wiz-border/30 flex items-center justify-between bg-wiz-bg/30">
          <button onClick={addRow} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-wiz-emerald/10 text-wiz-emerald hover:bg-wiz-emerald/20 text-[11px] font-semibold transition-all"><Plus size={12} />Add Row</button>
          <p className="text-[10px] text-wiz-dim font-mono">{rows.length} rows × {columns.length} columns</p>
        </div>
      </motion.div>

      {/* Hint */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-4 p-3 rounded-xl bg-wiz-amber/5 border border-wiz-amber/15 flex items-start gap-2">
        <Sparkles size={14} className="text-wiz-amber mt-0.5 shrink-0" />
        <p className="text-[11px] text-wiz-muted font-body">Tip: Set the right column type for best chart suggestions. Numbers work for sums and trends; categories work for grouping; dates enable time-series analysis.</p>
      </motion.div>
    </div>
  );
}
