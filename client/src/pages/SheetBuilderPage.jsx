import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Tag, Clock, Type, X, Save, Database, BarChart3, LineChart as LineIcon, PieChart, ScatterChart as Scatter, AreaChart, Map, TrendingUp, Activity, Grid3x3, Trash2, ChevronRight, Layers, Sparkles, Download, Calculator, Filter, Plus, Pencil, Wand2, Lightbulb, Share2, Sliders } from 'lucide-react';
import toast from 'react-hot-toast';
import ChartRenderer from '../components/ChartRenderer';
import FormulaEditor from '../components/FormulaEditor';
import FilterPanel from '../components/FilterPanel';
import ConversationPanel from '../components/ConversationPanel';
import WizPlayground from '../components/WizPlayground';
import ShareDialog from '../components/ShareDialog';
import AdvancedCalcsPanel from '../components/AdvancedCalcsPanel';
import * as api from '../utils/api';

const FIELD_ICONS = {
  numeric: { icon: Hash, color: '#34D399', label: 'NUM' },          // measure
  categorical: { icon: Tag, color: '#818CF8', label: 'CAT' },        // dimension
  temporal: { icon: Clock, color: '#FBBF24', label: 'TIME' },        // dimension
  text: { icon: Type, color: '#64748B', label: 'TXT' },              // dimension
  image: { icon: Type, color: '#A78BFA', label: 'IMG' },             // dimension
};

const CHART_TYPES = [
  { id: 'bar', label: 'Bar', icon: BarChart3 },
  { id: 'horizontal_bar', label: 'H. Bar', icon: BarChart3 },
  { id: 'line', label: 'Line', icon: LineIcon },
  { id: 'area', label: 'Area', icon: AreaChart },
  { id: 'scatter', label: 'Scatter', icon: Scatter },
  { id: 'pie', label: 'Pie', icon: PieChart },
  { id: 'donut', label: 'Donut', icon: PieChart },
  { id: 'heatmap', label: 'Heatmap', icon: Grid3x3 },
  { id: 'histogram', label: 'Histogram', icon: BarChart3 },
  { id: 'treemap', label: 'Treemap', icon: Grid3x3 },
  { id: 'radar', label: 'Radar', icon: Activity },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'forecast', label: 'Forecast', icon: TrendingUp },
];

const AGGREGATIONS = ['sum', 'avg', 'count', 'min', 'max', 'median'];

// Drag state via module-level holder (simpler than DnD lib)
let dragField = null;

function FieldChip({ field, onDragStart, draggable = true, onClick }) {
  const t = FIELD_ICONS[field.type] || FIELD_ICONS.text;
  const Icon = t.icon;
  const isCalc = field.isCalculated;
  return (
    <div draggable={draggable} onDragStart={(e) => { dragField = field; onDragStart?.(field); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${isCalc ? 'bg-amber-500/[0.06] border-amber-500/25' : 'bg-wiz-bg/40 border-wiz-border/30'} border hover:border-wiz-accent/30 cursor-grab active:cursor-grabbing transition-all group select-none`}
      title={isCalc ? `${field.name} (calculated: ${field.formula})` : `${field.name} (${field.type})`}>
      {isCalc ? <span className="text-[11px] font-bold text-amber-400" style={{ width: 11, fontFamily: 'serif', fontStyle: 'italic' }}>ƒ</span> : <Icon size={11} style={{ color: t.color }} />}
      <span className="text-[11px] font-mono text-wiz-text truncate flex-1">{field.name}</span>
      <span className="text-[8px] font-mono font-bold opacity-60" style={{ color: isCalc ? '#FBBF24' : t.color }}>{isCalc ? 'CALC' : t.label}</span>
    </div>
  );
}

function Shelf({ label, fields, onDrop, onRemove, onAggChange, accept = ['any'], multi = false, dimensionsOnly = false, measuresOnly = false }) {
  const [over, setOver] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setOver(false);
    if (dragField) {
      // Filter rules
      const isMeasure = dragField.type === 'numeric';
      if (dimensionsOnly && isMeasure) { toast.error('This shelf accepts dimensions only'); return; }
      if (measuresOnly && !isMeasure) { toast.error('This shelf accepts measures only'); return; }
      onDrop(dragField);
      dragField = null;
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div className="text-[10px] font-mono text-wiz-muted uppercase tracking-wider w-16 shrink-0">{label}</div>
      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={handleDrop}
        className={`flex-1 min-h-[34px] rounded-lg border-2 border-dashed px-1.5 py-1 flex items-center gap-1.5 flex-wrap transition-all ${over ? 'border-wiz-accent bg-wiz-accent/5' : 'border-wiz-border/40 bg-wiz-bg/30'}`}>
        {fields.length === 0 && (
          <span className="text-[10px] text-wiz-dim font-mono italic px-1">Drop {dimensionsOnly ? 'dimension' : measuresOnly ? 'measure' : 'field'} here</span>
        )}
        {fields.map((f, i) => (
          <ShelfPill key={i} field={f} onRemove={() => onRemove(i)} onAggChange={onAggChange ? (a) => onAggChange(i, a) : null} />
        ))}
      </div>
    </div>
  );
}

function ShelfPill({ field, onRemove, onAggChange }) {
  const t = FIELD_ICONS[field.type] || FIELD_ICONS.text;
  const Icon = t.icon;
  const isMeasure = field.type === 'numeric';
  return (
    <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg shrink-0" style={{ background: `${t.color}15`, border: `1px solid ${t.color}30` }}>
      {isMeasure && onAggChange && (
        <select value={field.aggregation || 'sum'} onChange={(e) => onAggChange(e.target.value)}
          className="text-[9px] font-mono font-bold bg-transparent border-none outline-none cursor-pointer uppercase pr-0.5" style={{ color: t.color }}>
          {AGGREGATIONS.map(a => <option key={a} value={a} style={{ background: '#0C1220' }}>{a}</option>)}
        </select>
      )}
      <Icon size={10} style={{ color: t.color }} />
      <span className="text-[11px] font-mono text-wiz-text">{field.name}</span>
      <button onClick={onRemove} className="p-0.5 rounded hover:bg-wiz-rose/20 text-wiz-dim hover:text-wiz-rose transition-colors"><X size={10} /></button>
    </motion.div>
  );
}

export default function SheetBuilderPage({ dataset, analysis }) {
  const params = useParams();
  const navigate = useNavigate();
  const [sheetName, setSheetName] = useState('Untitled Sheet');
  const [chartType, setChartType] = useState('bar');
  const [colShelf, setColShelf] = useState([]);
  const [rowShelf, setRowShelf] = useState([]);
  const [colorField, setColorField] = useState(null);
  const [sizeField, setSizeField] = useState(null);
  const [chartData, setChartData] = useState(null);
  const [chartSpec, setChartSpec] = useState(null);
  const [insights, setInsights] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState([]);
  const [calculatedFields, setCalculatedFields] = useState([]);
  // v6.8 advanced calc features
  const [bins, setBins] = useState([]);
  const [sets, setSets] = useState([]);
  const [lods, setLods] = useState([]);
  const [parameters, setParameters] = useState([]);
  const [tableCalcsArr, setTableCalcsArr] = useState([]);
  const [hierarchies, setHierarchies] = useState([]);
  const [drill, setDrill] = useState(null);
  // v6.13 — visualization depth
  const [referenceLines, setReferenceLines] = useState([]);
  const [referenceBands, setReferenceBands] = useState([]);
  const [trellis, setTrellis] = useState(null);
  const [dualAxis, setDualAxis] = useState(false);
  const [formulaEditor, setFormulaEditor] = useState({ open: false, editing: null });
  const [sidebarTab, setSidebarTab] = useState('fields');
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  // Free-roaming Wiz toggle — opt-in, persisted across sessions.
  // Disabled by default to avoid surprise; users discover it via the toggle button.
  const [wizRoaming, setWizRoaming] = useState(() => {
    try { return localStorage.getItem('wizRoaming') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('wizRoaming', wizRoaming ? '1' : '0'); } catch {}
  }, [wizRoaming]);
  const [shareOpen, setShareOpen] = useState(false);
  const [suggestedCalcs, setSuggestedCalcs] = useState([]);
  const editingId = params.id !== 'new' ? params.id : null;
  const [savingId, setSavingId] = useState(editingId);

  // Load existing sheet if editing
  useEffect(() => {
    if (editingId) {
      api.getSheet(editingId).then(r => {
        if (r.sheet) {
          setSheetName(r.sheet.name);
          setChartType(r.sheet.spec.chartType);
          setColShelf(r.sheet.spec.columns || []);
          setRowShelf(r.sheet.spec.rows || []);
          setColorField(r.sheet.spec.color || null);
          setSizeField(r.sheet.spec.size || null);
          setFilters(r.sheet.spec.filters || []);
          setCalculatedFields(r.sheet.spec.calculatedFields || []);
          setBins(r.sheet.spec.bins || []);
          setSets(r.sheet.spec.sets || []);
          setLods(r.sheet.spec.lods || []);
          setParameters(r.sheet.spec.parameters || []);
          setTableCalcsArr(r.sheet.spec.tableCalcs || []);
          setHierarchies(r.sheet.spec.hierarchies || []);
          setReferenceLines(r.sheet.spec.referenceLines || []);
          setReferenceBands(r.sheet.spec.referenceBands || []);
          setTrellis(r.sheet.spec.trellis || null);
          setDualAxis(!!r.sheet.spec.dualAxis);
          setSavingId(r.sheet.id);
        }
      }).catch(() => toast.error('Failed to load sheet'));
    }
  }, [editingId]);

  // Load AI-suggested calc fields based on dataset patterns
  useEffect(() => {
    if (!dataset?.id) return;
    api.suggestCalcFields(dataset.id)
      .then(r => setSuggestedCalcs(r.suggestions || []))
      .catch(() => {});
  }, [dataset?.id]);

  // Existing columns + synthesized columns from calculated fields
  const allColumnsWithCalc = useMemo(() => {
    const baseCols = analysis?.columns || [];
    const calcCols = calculatedFields.map(cf => {
      // Heuristic: if formula contains numeric ops or aggs, mark as numeric
      const isNumeric = /SUM|AVG|COUNT|MIN|MAX|MEDIAN|ROUND|ABS|FLOOR|CEIL|SQRT|\+|\-|\*|\//i.test(cf.formula) && !/IF.*THEN.*"/.test(cf.formula);
      return { name: cf.name, type: isNumeric ? 'numeric' : 'categorical', isCalculated: true, formula: cf.formula };
    });
    return [...baseCols, ...calcCols];
  }, [analysis, calculatedFields]);

  const dimensions = useMemo(() => allColumnsWithCalc.filter(c => c.type !== 'numeric' || c.subtype === 'identifier' || c.subtype === 'year'), [allColumnsWithCalc]);
  const measures = useMemo(() => allColumnsWithCalc.filter(c => c.type === 'numeric' && c.subtype !== 'identifier' && c.subtype !== 'year' && c.subtype !== 'coordinate'), [allColumnsWithCalc]);

  const allFields = useMemo(() => allColumnsWithCalc, [allColumnsWithCalc]);

  const filteredDims = dimensions.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));
  const filteredMeas = measures.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  // Re-render whenever shelves/filters/CFs change. Debounced so dragging a
  // parameter slider doesn't fire a render storm — chart updates ~5 times/sec
  // during a drag, then a final render when motion stops.
  useEffect(() => {
    if (!dataset?.id || (!colShelf.length && !rowShelf.length)) {
      setChartData(null); setInsights([]); setWarnings([]); return;
    }
    const timeout = setTimeout(() => {
      setLoading(true);
      const aggregations = {};
      rowShelf.forEach(f => { if (f.type === 'numeric' && f.aggregation) aggregations[f.name] = f.aggregation; });
      const spec = { chartType, columns: colShelf, rows: rowShelf, color: colorField, size: sizeField, aggregations, filters, calculatedFields, bins, sets, lods, parameters, tableCalcs: tableCalcsArr, hierarchies, drill, referenceLines, referenceBands, trellis, dualAxis };
      api.renderSheet(dataset.id, spec)
        .then(r => {
          setChartData(r.chartData);
          setChartSpec(r.spec);
          setInsights(r.insights || []);
          setWarnings(r.warnings || []);
        })
        .catch(err => toast.error(err.response?.data?.error || 'Render failed'))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timeout);
  }, [dataset?.id, chartType, colShelf, rowShelf, colorField, sizeField, filters, calculatedFields, bins, sets, lods, parameters, tableCalcsArr, hierarchies, drill, referenceLines, referenceBands, trellis, dualAxis]);

  const updateShelfAgg = (shelfSetter) => (idx, agg) => shelfSetter(arr => arr.map((f, i) => i === idx ? { ...f, aggregation: agg } : f));

  const handleSave = async () => {
    if (!colShelf.length && !rowShelf.length) { toast.error('Add at least one field'); return; }
    if (!dataset?.id) { toast.error('No dataset loaded — re-upload your file.'); return; }
    const aggregations = {};
    rowShelf.forEach(f => { if (f.type === 'numeric' && f.aggregation) aggregations[f.name] = f.aggregation; });
    const spec = { chartType, columns: colShelf, rows: rowShelf, color: colorField, size: sizeField, aggregations, filters, calculatedFields, bins, sets, lods, parameters, tableCalcs: tableCalcsArr, hierarchies, drill, referenceLines, referenceBands, trellis, dualAxis };
    try {
      if (savingId) {
        await api.updateSheet(savingId, { name: sheetName, spec });
        toast.success('Sheet updated');
      } else {
        const r = await api.saveSheet(sheetName, dataset.id, spec);
        if (!r?.sheet?.id) throw new Error('Server did not return a sheet id');
        setSavingId(r.sheet.id);
        toast.success('Sheet saved');
      }
    } catch (err) {
      // Surface the actual error so users can see what went wrong
      const msg = err.response?.data?.error || err.message || 'Save failed';
      console.error('[saveSheet] error:', err);
      toast.error('Save failed: ' + msg, { duration: 6000 });
    }
  };

  if (!dataset || !analysis) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-muted">
      <Database size={48} className="mb-4 opacity-30" />
      <p className="text-sm">No dataset loaded.</p>
      <button onClick={() => navigate('/')} className="mt-3 text-wiz-accent text-sm font-semibold hover:underline">Upload a file</button>
    </div>
  );

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-4">
      {/* Header bar */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Layers size={18} className="text-wiz-accent shrink-0" />
          <input value={sheetName} onChange={(e) => setSheetName(e.target.value)}
            className="text-base font-bold font-display text-wiz-text bg-transparent outline-none border-b border-transparent hover:border-wiz-border focus:border-wiz-accent transition-colors flex-1 min-w-0" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <motion.button onClick={() => setAiPanelOpen(o => !o)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold transition-all shadow-lg ${aiPanelOpen ? 'bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white shadow-wiz-accent/30' : 'bg-wiz-accent/10 border border-wiz-accent/30 text-wiz-accent-light hover:bg-wiz-accent/15'}`}>
            <Sparkles size={13} />Ask Wiz
          </motion.button>
          <button onClick={() => navigate('/sheets')} className="px-3 py-1.5 rounded-lg glass text-wiz-muted hover:text-wiz-text text-[11px] font-semibold transition-all btn-press">All Sheets</button>
          {savingId && (
            <motion.button onClick={() => setShareOpen(true)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-wiz-border/40 text-wiz-text hover:border-wiz-accent/40 text-[11px] font-semibold transition-all">
              <Share2 size={13} />Share
            </motion.button>
          )}
          <motion.button onClick={handleSave} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-wiz-accent-deep to-wiz-accent text-white text-[11px] font-semibold shadow-lg shadow-wiz-accent/20 btn-press">
            <Save size={13} />{savingId ? 'Update' : 'Save Sheet'}
          </motion.button>
        </div>
      </motion.div>

      <div className="grid grid-cols-12 gap-3 h-[calc(100vh-180px)] min-h-[600px]">
        {/* LEFT: Sidebar with Tabs */}
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="col-span-3 rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 flex flex-col overflow-hidden">
          {/* Tab switcher */}
          <div className="flex items-center px-1.5 pt-1.5 gap-0.5 border-b border-wiz-border/30">
            {[
              { id: 'fields', label: 'Fields', icon: Tag, count: allFields.length },
              { id: 'filters', label: 'Filters', icon: Filter, count: filters.length },
              { id: 'formulas', label: 'Formulas', icon: Calculator, count: calculatedFields.length },
              { id: 'advanced', label: 'Advanced', icon: Sliders, count: bins.length + sets.length + lods.length + parameters.length + tableCalcsArr.length + hierarchies.length },
            ].map(t => {
              const Icon = t.icon; const active = sidebarTab === t.id;
              return (
                <button key={t.id} onClick={() => setSidebarTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-2 text-[10px] font-semibold transition-all rounded-t-lg ${active ? 'bg-wiz-bg/60 text-wiz-text border-b-2 border-wiz-accent' : 'text-wiz-muted hover:text-wiz-text-secondary border-b-2 border-transparent'}`}>
                  <Icon size={11} />{t.label}{t.count > 0 && <span className="opacity-60">({t.count})</span>}
                </button>
              );
            })}
          </div>

          {sidebarTab === 'fields' && (
            <>
              <div className="px-3 py-2.5 border-b border-wiz-border/30">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fields..."
                  className="w-full bg-wiz-bg/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-accent/40" />
              </div>
              <div className="flex-1 overflow-y-auto px-2 py-2">
                <div className="mb-3">
                  <p className="text-[9px] font-mono text-wiz-emerald font-bold tracking-wider uppercase px-1 mb-1.5 flex items-center gap-1"><Tag size={9} />Dimensions ({filteredDims.length})</p>
                  <div className="space-y-1">
                    {filteredDims.map((f, i) => <FieldChip key={i} field={f} />)}
                    {!filteredDims.length && <p className="text-[10px] text-wiz-dim italic px-1.5">No dimensions</p>}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-mono text-wiz-amber font-bold tracking-wider uppercase px-1 mb-1.5 flex items-center gap-1"><Hash size={9} />Measures ({filteredMeas.length})</p>
                  <div className="space-y-1">
                    {filteredMeas.map((f, i) => <FieldChip key={i} field={f} />)}
                    {!filteredMeas.length && <p className="text-[10px] text-wiz-dim italic px-1.5">No numeric fields</p>}
                  </div>
                </div>
              </div>
              <div className="px-3 py-2 border-t border-wiz-border/30 bg-wiz-bg/30">
                <p className="text-[9px] font-mono text-wiz-dim">Drag fields onto shelves →</p>
              </div>
            </>
          )}

          {sidebarTab === 'filters' && (
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <FilterPanel filters={filters} onChange={setFilters} columns={allColumnsWithCalc} datasetId={dataset?.id} />
            </div>
          )}

          {sidebarTab === 'formulas' && (
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
              {/* AI-suggested calc fields */}
              {suggestedCalcs.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] font-mono text-wiz-accent-light uppercase tracking-wider font-bold flex items-center gap-1.5 mb-1.5">
                    <Sparkles size={10} />AI Suggestions
                  </p>
                  <div className="space-y-1.5">
                    {suggestedCalcs.filter(s => !calculatedFields.find(cf => cf.name === s.name)).map((s, i) => (
                      <button key={i}
                        onClick={() => {
                          setCalculatedFields(arr => [...arr, { name: s.name, formula: s.formula }]);
                          toast.success(`Added ${s.name}`);
                        }}
                        className="w-full text-left p-2.5 rounded-xl bg-wiz-accent/[0.06] border border-wiz-accent/20 hover:border-wiz-accent/40 hover:bg-wiz-accent/[0.1] transition-all group">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] font-mono font-bold text-wiz-accent-light flex items-center gap-1">
                            <Lightbulb size={9} className="text-wiz-accent" />{s.name}
                          </span>
                          <span className="text-[8px] text-wiz-dim font-mono">{Math.round(s.confidence * 100)}%</span>
                        </div>
                        <p className="text-[10px] font-mono text-wiz-text-secondary truncate" title={s.formula}>{s.formula}</p>
                        <p className="text-[10px] text-wiz-dim font-body mt-0.5 italic">{s.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-mono text-amber-400 uppercase tracking-wider font-bold flex items-center gap-1.5">
                  <Calculator size={10} />Calculated Fields
                </p>
                <button onClick={() => setFormulaEditor({ open: true, editing: null })}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-semibold transition-colors">
                  <Plus size={10} />New
                </button>
              </div>
              {calculatedFields.length === 0 ? (
                <div className="py-6 text-center">
                  <Calculator size={28} className="mx-auto mb-2 text-wiz-dim opacity-40" />
                  <p className="text-[11px] font-display font-semibold text-wiz-muted mb-1">No formulas yet</p>
                  <p className="text-[10px] text-wiz-dim font-body mb-3">{suggestedCalcs.length > 0 ? 'Click a suggestion above ↑' : 'Create fields like Profit = Sales − Cost'}</p>
                  <button onClick={() => setFormulaEditor({ open: true, editing: null })}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-semibold transition-colors">
                    <Plus size={10} />Create custom formula
                  </button>
                </div>
              ) : calculatedFields.map((cf, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/20 group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono font-bold text-amber-300 truncate">ƒ {cf.name}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setFormulaEditor({ open: true, editing: cf })} className="p-1 rounded hover:bg-amber-500/20 text-amber-400">
                        <Pencil size={10} />
                      </button>
                      <button onClick={() => setCalculatedFields(arr => arr.filter((_, j) => j !== i))} className="p-1 rounded hover:bg-rose-500/20 text-wiz-dim hover:text-rose-400">
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] font-mono text-wiz-text-secondary truncate" title={cf.formula}>{cf.formula}</p>
                </div>
              ))}
            </div>
          )}

          {sidebarTab === 'advanced' && (
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <AdvancedCalcsPanel
                columns={analysis?.columns || []}
                parameters={parameters}
                bins={bins}
                sets={sets}
                lods={lods}
                tableCalcs={tableCalcsArr}
                hierarchies={hierarchies}
                referenceLines={referenceLines}
                referenceBands={referenceBands}
                trellis={trellis}
                dualAxis={dualAxis}
                onChange={(key, val) => {
                  if (key === 'parameters') setParameters(val);
                  else if (key === 'bins') setBins(val);
                  else if (key === 'sets') setSets(val);
                  else if (key === 'lods') setLods(val);
                  else if (key === 'tableCalcs') setTableCalcsArr(val);
                  else if (key === 'hierarchies') setHierarchies(val);
                  else if (key === 'referenceLines') setReferenceLines(val);
                  else if (key === 'referenceBands') setReferenceBands(val);
                  else if (key === 'trellis') setTrellis(val);
                  else if (key === 'dualAxis') setDualAxis(val);
                }}
              />
            </div>
          )}
        </motion.div>

        {/* CENTER: Shelves + Canvas */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="col-span-7 flex flex-col gap-3 min-h-0">
          {/* Shelves */}
          <div className="rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 p-3 space-y-2">
            <Shelf label="Columns" fields={colShelf} onDrop={f => setColShelf(arr => [...arr, f.type === 'numeric' ? { ...f, aggregation: 'sum' } : f])} onRemove={(i) => setColShelf(arr => arr.filter((_, j) => j !== i))} onAggChange={updateShelfAgg(setColShelf)} />
            <Shelf label="Rows" fields={rowShelf} onDrop={f => setRowShelf(arr => [...arr, f.type === 'numeric' ? { ...f, aggregation: 'sum' } : f])} onRemove={(i) => setRowShelf(arr => arr.filter((_, j) => j !== i))} onAggChange={updateShelfAgg(setRowShelf)} />
            <div className="grid grid-cols-2 gap-2">
              <Shelf label="Color" fields={colorField ? [colorField] : []} onDrop={f => setColorField(f)} onRemove={() => setColorField(null)} dimensionsOnly />
              <Shelf label="Size" fields={sizeField ? [sizeField] : []} onDrop={f => setSizeField({ ...f, aggregation: 'sum' })} onRemove={() => setSizeField(null)} measuresOnly />
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 p-4 flex flex-col min-h-0 relative overflow-hidden">
            {loading && <div className="absolute top-3 right-3 z-10"><div className="spinner w-5 h-5" /></div>}
            {!chartData ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-wiz-accent/5 border border-wiz-accent/10 flex items-center justify-center mb-4">
                  <Sparkles size={28} className="text-wiz-accent/40" />
                </div>
                <p className="text-sm font-display font-semibold text-wiz-muted mb-1">Drop fields onto Columns and Rows</p>
                <p className="text-[11px] text-wiz-dim font-body">Then pick a chart type below</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0" data-wiz-chart>
                  <ChartRenderer spec={chartSpec || { type: chartType, x: colShelf[0]?.name, y: rowShelf[0]?.name }} chartData={chartData} stackKeys={chartData?._stackKeys || (Array.isArray(chartData) ? chartData._stackKeys : null)} height="100%" />
                </div>
                {warnings.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {warnings.map((w, i) => (
                      <div key={i} className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-300 font-body flex items-center gap-1.5">
                        <span>⚠</span>{w}
                      </div>
                    ))}
                  </div>
                )}
                {insights.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-wiz-border/30">
                    <div className="flex flex-wrap gap-1.5">
                      {insights.slice(0, 3).map((ins, i) => (
                        <div key={i} className="px-2.5 py-1 rounded-lg bg-wiz-bg/40 border border-wiz-border/20 text-[10px] text-wiz-muted font-body">
                          💡 {ins.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* RIGHT: Chart type selector */}
        <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="col-span-2 rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-wiz-border/30">
            <p className="text-[10px] font-mono text-wiz-muted uppercase tracking-wider">Chart Type</p>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 grid grid-cols-2 gap-1.5 content-start">
            {CHART_TYPES.map(ct => {
              const Icon = ct.icon;
              const active = chartType === ct.id;
              return (
                <motion.button key={ct.id} onClick={() => setChartType(ct.id)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl transition-all ${active ? 'bg-wiz-accent/15 border border-wiz-accent/40 text-wiz-accent-light' : 'bg-wiz-bg/40 border border-wiz-border/30 text-wiz-muted hover:border-wiz-border-light hover:text-wiz-text'}`}>
                  <Icon size={15} />
                  <span className="text-[9px] font-semibold font-body">{ct.label}</span>
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Formula Editor Modal */}
      <FormulaEditor
        open={formulaEditor.open}
        onClose={() => setFormulaEditor({ open: false, editing: null })}
        onSave={(cf) => {
          if (formulaEditor.editing) {
            const oldName = formulaEditor.editing.name;
            setCalculatedFields(arr => arr.map(x => x.name === oldName ? cf : x));
          } else {
            setCalculatedFields(arr => [...arr, cf]);
          }
          toast.success(formulaEditor.editing ? `Updated ${cf.name}` : `Created ${cf.name}`);
        }}
        datasetId={dataset?.id}
        columns={analysis?.columns || []}
        initialField={formulaEditor.editing}
      />

      {/* AI Conversation Panel */}
      <ConversationPanel
        open={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
        datasetId={dataset?.id}
        currentSpec={{ chartType, columns: colShelf, rows: rowShelf, color: colorField, size: sizeField, filters, calculatedFields, bins, sets, lods, parameters, tableCalcs: tableCalcsArr, hierarchies }}
        onSpecChange={(spec) => {
          // Apply spec changes from conversation to local state
          if (spec.chartType) setChartType(spec.chartType);
          if (Array.isArray(spec.columns)) setColShelf(spec.columns);
          if (Array.isArray(spec.rows)) setRowShelf(spec.rows);
          if ('color' in spec) setColorField(spec.color);
          if ('size' in spec) setSizeField(spec.size);
          if (Array.isArray(spec.filters)) setFilters(spec.filters);
          if (Array.isArray(spec.calculatedFields)) setCalculatedFields(spec.calculatedFields);
          if (Array.isArray(spec.bins)) setBins(spec.bins);
          if (Array.isArray(spec.sets)) setSets(spec.sets);
          if (Array.isArray(spec.lods)) setLods(spec.lods);
          if (Array.isArray(spec.parameters)) setParameters(spec.parameters);
          if (Array.isArray(spec.tableCalcs)) setTableCalcsArr(spec.tableCalcs);
          if (Array.isArray(spec.hierarchies)) setHierarchies(spec.hierarchies);
        }}
      />
      <ShareDialog
        resourceType="sheet"
        resourceId={savingId}
        resourceName={sheetName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      {/* Page-level free-roaming Wiz — walks to charts, points at things,
          reacts to cues from the conversation engine. Optional but enabled
          by default in v6.10. Set to false if it feels like too much. */}
      <WizPlayground enabled={true} />
    </div>
  );
}
