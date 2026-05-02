import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hash, Tag, Layers, Calculator, Sliders, GitBranch, ChevronDown, Plus, Trash2, X, AlertCircle, Minus, Square, Grid3x3, Columns2 } from 'lucide-react';

/**
 * Single panel exposing all v6.8 advanced calc features:
 *   - Parameters
 *   - Bins
 *   - Sets
 *   - LODs (FIXED only)
 *   - Table calcs
 *   - Hierarchies
 *
 * Each section is collapsible. Adds/edits propagate via onChange callbacks.
 *
 * Props:
 *   columns           — list of {name, type} for the dataset
 *   parameters, bins, sets, lods, tableCalcs, hierarchies — current arrays
 *   onChange(key, newArray) — single setter callback
 */
export default function AdvancedCalcsPanel({
  columns = [],
  parameters = [], bins = [], sets = [], lods = [], tableCalcs = [], hierarchies = [],
  // v6.13 visualization depth
  referenceLines = [], referenceBands = [], trellis = null, dualAxis = false,
  onChange,
}) {
  const [openSection, setOpenSection] = useState('parameters');

  const numericCols = useMemo(() =>
    columns.filter(c => c.type === 'numeric' || c.type === 'integer'), [columns]);
  const categoricalCols = useMemo(() =>
    columns.filter(c => c.type === 'categorical' || c.type === 'string'), [columns]);

  const sections = [
    {
      id: 'parameters', label: 'Parameters', icon: Sliders,
      count: parameters.length, color: 'wiz-amber',
      content: <ParametersSection parameters={parameters} onChange={(arr) => onChange('parameters', arr)} />,
    },
    {
      id: 'bins', label: 'Bins', icon: Hash,
      count: bins.length, color: 'wiz-emerald',
      content: <BinsSection bins={bins} numericCols={numericCols} onChange={(arr) => onChange('bins', arr)} />,
    },
    {
      id: 'sets', label: 'Sets', icon: Tag,
      count: sets.length, color: 'wiz-violet',
      content: <SetsSection sets={sets} columns={columns} numericCols={numericCols} onChange={(arr) => onChange('sets', arr)} />,
    },
    {
      id: 'lods', label: 'LOD', icon: Layers,
      count: lods.length, color: 'wiz-rose',
      content: <LODsSection lods={lods} columns={columns} numericCols={numericCols} categoricalCols={categoricalCols} onChange={(arr) => onChange('lods', arr)} />,
    },
    {
      id: 'tableCalcs', label: 'Table calcs', icon: Calculator,
      count: tableCalcs.length, color: 'wiz-accent',
      content: <TableCalcsSection tableCalcs={tableCalcs} onChange={(arr) => onChange('tableCalcs', arr)} />,
    },
    {
      id: 'hierarchies', label: 'Hierarchies', icon: GitBranch,
      count: hierarchies.length, color: 'wiz-sky',
      content: <HierarchiesSection hierarchies={hierarchies} categoricalCols={categoricalCols} onChange={(arr) => onChange('hierarchies', arr)} />,
    },
    {
      id: 'referenceLines', label: 'Reference lines', icon: Minus,
      count: referenceLines.length, color: 'wiz-accent',
      content: <ReferenceLinesSection lines={referenceLines} onChange={(arr) => onChange('referenceLines', arr)} />,
    },
    {
      id: 'referenceBands', label: 'Reference bands', icon: Square,
      count: referenceBands.length, color: 'wiz-accent',
      content: <ReferenceBandsSection bands={referenceBands} onChange={(arr) => onChange('referenceBands', arr)} />,
    },
    {
      id: 'trellis', label: 'Trellis (small multiples)', icon: Grid3x3,
      count: trellis?.facetBy ? 1 : 0, color: 'wiz-teal',
      content: <TrellisSection trellis={trellis} categoricalCols={categoricalCols} onChange={(t) => onChange('trellis', t)} />,
    },
    {
      id: 'dualAxis', label: 'Dual axis', icon: Columns2,
      count: dualAxis ? 1 : 0, color: 'wiz-teal',
      content: <DualAxisSection dualAxis={dualAxis} onChange={(v) => onChange('dualAxis', v)} />,
    },
  ];

  return (
    <div className="space-y-1.5">
      {sections.map((s) => {
        const Icon = s.icon;
        const isOpen = openSection === s.id;
        return (
          <div key={s.id} className="rounded-xl bg-wiz-bg/40 border border-wiz-border/30 overflow-hidden">
            <button
              onClick={() => setOpenSection(isOpen ? null : s.id)}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-wiz-bg/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Icon size={13} className={`text-${s.color}`} />
                <span className="text-[12px] font-semibold text-wiz-text">{s.label}</span>
                {s.count > 0 && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-${s.color}/20 text-${s.color}`}>
                    {s.count}
                  </span>
                )}
              </div>
              <ChevronDown size={13} className={`text-wiz-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 pt-1 border-t border-wiz-border/20">
                    {s.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

// ─── PARAMETERS ──────────────────────────────────────────────────────────────

function ParametersSection({ parameters, onChange }) {
  const add = () => {
    const name = prompt('Parameter name:');
    if (!name) return;
    onChange([...parameters, {
      name, dataType: 'number', value: 100, min: 0, max: 1000, step: 10, control: 'slider',
    }]);
  };
  const update = (i, patch) => {
    const next = [...parameters]; next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i) => onChange(parameters.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Parameters are user-controllable values usable in formulas (e.g. <code>@Threshold</code>) and filters.
        <span className="block mt-1 text-wiz-accent/80">Drag a slider to see the chart update live (what-if analysis).</span>
      </p>
      {parameters.map((p, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={p.name} onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
            <select value={p.dataType} onChange={(e) => update(i, { dataType: e.target.value })}
              className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
              <option value="number">number</option>
              <option value="string">string</option>
              <option value="boolean">boolean</option>
            </select>
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose"><Trash2 size={11} /></button>
          </div>
          {p.dataType === 'number' && (
            <div className="flex items-center gap-1.5">
              <input type="number" value={p.value} onChange={(e) => update(i, { value: parseFloat(e.target.value) })}
                className="w-16 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono" />
              <input type="range" min={p.min ?? 0} max={p.max ?? 1000} step={p.step ?? 1} value={p.value ?? 0}
                onChange={(e) => update(i, { value: parseFloat(e.target.value) })}
                className="flex-1 accent-wiz-accent" />
            </div>
          )}
          {p.dataType === 'string' && (
            <input value={p.value || ''} onChange={(e) => update(i, { value: e.target.value })}
              placeholder="value"
              className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
          )}
          {p.dataType === 'boolean' && (
            <label className="flex items-center gap-2 text-[11px] text-wiz-text">
              <input type="checkbox" checked={!!p.value} onChange={(e) => update(i, { value: e.target.checked })} />
              {p.value ? 'TRUE' : 'FALSE'}
            </label>
          )}
        </div>
      ))}
      <button onClick={add} className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-amber/50 hover:text-wiz-amber">
        <Plus size={11} /> Add parameter
      </button>
    </div>
  );
}

// ─── BINS ────────────────────────────────────────────────────────────────────

function BinsSection({ bins, numericCols, onChange }) {
  const add = () => {
    const name = prompt('Bin name (e.g. "Age Group"):');
    if (!name) return;
    onChange([...bins, { name, source: numericCols[0]?.name || '', strategy: 'equal-width', count: 5 }]);
  };
  const update = (i, patch) => { const n = [...bins]; n[i] = { ...n[i], ...patch }; onChange(n); };
  const remove = (i) => onChange(bins.filter((_, idx) => idx !== i));

  if (!numericCols.length && !bins.length) {
    return <Empty message="No numeric columns to bin." />;
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">Group continuous numeric values into ranges.</p>
      {bins.map((b, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={b.name} onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose"><Trash2 size={11} /></button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <select value={b.source} onChange={(e) => update(i, { source: e.target.value })}
              className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
              {numericCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select value={b.strategy} onChange={(e) => update(i, { strategy: e.target.value })}
              className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
              <option value="equal-width">equal-width</option>
              <option value="quantile">quantile</option>
              <option value="custom">custom</option>
            </select>
          </div>
          {b.strategy !== 'custom' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-wiz-muted">Count:</span>
              <input type="number" min={2} max={20} value={b.count}
                onChange={(e) => update(i, { count: parseInt(e.target.value) || 5 })}
                className="w-14 px-1.5 py-0.5 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono" />
            </div>
          )}
          {b.strategy === 'custom' && (
            <input
              placeholder="Edges, comma-separated: 0,18,35,50,65,100"
              value={(b.edges || []).join(', ')}
              onChange={(e) => update(i, {
                edges: e.target.value.split(',').map(s => parseFloat(s.trim())).filter(Number.isFinite)
              })}
              className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono"
            />
          )}
        </div>
      ))}
      <button onClick={add} disabled={!numericCols.length}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-emerald/50 hover:text-wiz-emerald disabled:opacity-50">
        <Plus size={11} /> Add bin
      </button>
    </div>
  );
}

// ─── SETS ────────────────────────────────────────────────────────────────────

function SetsSection({ sets, columns, numericCols, onChange }) {
  const add = () => {
    const name = prompt('Set name (e.g. "Top Customers"):');
    if (!name) return;
    onChange([...sets, { name, source: columns[0]?.name || '', mode: 'manual', values: [] }]);
  };
  const update = (i, patch) => { const n = [...sets]; n[i] = { ...n[i], ...patch }; onChange(n); };
  const remove = (i) => onChange(sets.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">Sets are dimension groups. Useful as filters or color encodings.</p>
      {sets.map((s, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={s.name} onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose"><Trash2 size={11} /></button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <select value={s.source} onChange={(e) => update(i, { source: e.target.value })}
              className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
              {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
            <select value={s.mode} onChange={(e) => update(i, { mode: e.target.value })}
              className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
              <option value="manual">manual list</option>
              <option value="top">top N</option>
              <option value="bottom">bottom N</option>
              <option value="condition">condition</option>
            </select>
          </div>
          {s.mode === 'manual' && (
            <input
              placeholder="Comma-separated values: Acme, Globex, ..."
              value={(s.values || []).join(', ')}
              onChange={(e) => update(i, { values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })}
              className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40"
            />
          )}
          {(s.mode === 'top' || s.mode === 'bottom') && (
            <div className="grid grid-cols-3 gap-1.5">
              <input type="number" min={1} value={s.count || 10}
                onChange={(e) => update(i, { count: parseInt(e.target.value) || 10 })}
                className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono" />
              <select value={s.aggregation || 'SUM'} onChange={(e) => update(i, { aggregation: e.target.value })}
                className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
                <option value="SUM">by SUM</option>
                <option value="AVG">by AVG</option>
                <option value="COUNT">by COUNT</option>
                <option value="MAX">by MAX</option>
              </select>
              <select value={s.rankBy || ''} onChange={(e) => update(i, { rankBy: e.target.value })}
                className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
                <option value="">of (field)</option>
                {numericCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}
          {s.mode === 'condition' && (
            <div className="flex items-center gap-1.5">
              <select value={s.condition?.op || '>'} onChange={(e) => update(i, { condition: { ...(s.condition || {}), op: e.target.value } })}
                className="px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
                <option value=">">{`>`}</option><option value=">=">{`>=`}</option>
                <option value="<">{`<`}</option><option value="<=">{`<=`}</option>
                <option value="=">=</option><option value="!=">≠</option>
                <option value="contains">contains</option>
              </select>
              <input
                placeholder="value"
                value={s.condition?.value ?? ''}
                onChange={(e) => update(i, { condition: { ...(s.condition || {}), value: e.target.value } })}
                className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40"
              />
            </div>
          )}
        </div>
      ))}
      <button onClick={add} disabled={!columns.length}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-violet/50 hover:text-wiz-violet disabled:opacity-50">
        <Plus size={11} /> Add set
      </button>
    </div>
  );
}

// ─── LODS ────────────────────────────────────────────────────────────────────

function LODsSection({ lods, columns, numericCols, categoricalCols, onChange }) {
  const add = () => {
    const name = prompt('LOD calc name (e.g. "Region Total"):');
    if (!name) return;
    const dim = categoricalCols[0]?.name || '';
    const meas = numericCols[0]?.name || '';
    onChange([...lods, {
      name,
      expression: `{FIXED [${dim}]: SUM([${meas}])}`,
    }]);
  };
  const update = (i, patch) => { const n = [...lods]; n[i] = { ...n[i], ...patch }; onChange(n); };
  const remove = (i) => onChange(lods.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Aggregate at a fixed granularity. Use in formulas to compute % of region, share of total, etc.
      </p>
      <div className="p-2 rounded-lg bg-wiz-amber/5 border border-wiz-amber/20 text-[10px] text-wiz-amber/90 flex gap-1.5">
        <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
        <span>Only <code>{`{FIXED}`}</code> is supported. <code>INCLUDE</code> and <code>EXCLUDE</code> coming later.</span>
      </div>
      {lods.map((l, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={l.name} onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose"><Trash2 size={11} /></button>
          </div>
          <textarea
            value={l.expression}
            onChange={(e) => update(i, { expression: e.target.value })}
            placeholder="{FIXED [Region]: SUM([Sales])}"
            rows={2}
            className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono resize-none"
          />
        </div>
      ))}
      <button onClick={add}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-rose/50 hover:text-wiz-rose">
        <Plus size={11} /> Add LOD calc
      </button>
    </div>
  );
}

// ─── TABLE CALCS ─────────────────────────────────────────────────────────────

const TABLE_CALC_PRESETS = [
  { label: 'Running total', expression: 'RUNNING_SUM([measure])' },
  { label: 'Moving avg (3)', expression: 'MOVING_AVG([measure], 3)' },
  { label: '% of total', expression: 'PERCENT_OF_TOTAL([measure])' },
  { label: 'Rank (desc)', expression: 'RANK([measure], "desc")' },
  { label: 'Period over period', expression: 'DIFFERENCE([measure])' },
  { label: 'YoY % change', expression: 'PERCENT_DIFFERENCE([measure])' },
  { label: 'Index (1, 2, 3...)', expression: 'INDEX()' },
  { label: 'Lookup prior row', expression: 'LOOKUP([measure], -1)' },
];

function TableCalcsSection({ tableCalcs, onChange }) {
  const add = (preset) => {
    const name = prompt('Table calc name:');
    if (!name) return;
    onChange([...tableCalcs, { name, expression: preset?.expression || 'RUNNING_SUM([measure])' }]);
  };
  const update = (i, patch) => { const n = [...tableCalcs]; n[i] = { ...n[i], ...patch }; onChange(n); };
  const remove = (i) => onChange(tableCalcs.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Compute values across rows after aggregation: running totals, ranks, % of total, etc.
        Replace <code>[measure]</code> with your aggregated column name.
      </p>
      {tableCalcs.map((c, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={c.name} onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose"><Trash2 size={11} /></button>
          </div>
          <input
            value={c.expression}
            onChange={(e) => update(i, { expression: e.target.value })}
            placeholder="RUNNING_SUM([Sales])"
            className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono"
          />
        </div>
      ))}
      <details className="text-[10px] text-wiz-muted">
        <summary className="cursor-pointer hover:text-wiz-text">Quick add</summary>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {TABLE_CALC_PRESETS.map((p) => (
            <button key={p.label} onClick={() => add(p)}
              className="text-left px-2 py-1 rounded bg-wiz-bg/40 hover:bg-wiz-accent/20 hover:text-wiz-accent text-[10px]">
              {p.label}
            </button>
          ))}
        </div>
      </details>
      <button onClick={() => add()}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-accent/50 hover:text-wiz-accent">
        <Plus size={11} /> Add table calc
      </button>
    </div>
  );
}

// ─── HIERARCHIES ─────────────────────────────────────────────────────────────

function HierarchiesSection({ hierarchies, categoricalCols, onChange }) {
  const add = () => {
    const name = prompt('Hierarchy name (e.g. "Geography"):');
    if (!name) return;
    onChange([...hierarchies, { name, levels: [] }]);
  };
  const update = (i, patch) => { const n = [...hierarchies]; n[i] = { ...n[i], ...patch }; onChange(n); };
  const remove = (i) => onChange(hierarchies.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Drill-down chains. Click chart values to drill in; breadcrumbs to drill out.
      </p>
      {hierarchies.map((h, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input value={h.name} onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40" />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose"><Trash2 size={11} /></button>
          </div>
          <div className="space-y-1">
            {(h.levels || []).map((lvl, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="text-[10px] text-wiz-muted font-mono w-4">{idx + 1}.</span>
                <select value={lvl}
                  onChange={(e) => {
                    const next = [...h.levels]; next[idx] = e.target.value;
                    update(i, { levels: next });
                  }}
                  className="flex-1 px-1.5 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40">
                  {categoricalCols.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
                <button onClick={() => update(i, { levels: h.levels.filter((_, j) => j !== idx) })}
                  className="p-0.5 text-wiz-muted hover:text-wiz-rose"><X size={11} /></button>
              </div>
            ))}
            <button onClick={() => update(i, { levels: [...(h.levels || []), categoricalCols[0]?.name || ''] })}
              disabled={!categoricalCols.length}
              className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded text-[10px] text-wiz-sky hover:bg-wiz-sky/10 disabled:opacity-50">
              <Plus size={10} /> Add level
            </button>
          </div>
        </div>
      ))}
      <button onClick={add}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-sky/50 hover:text-wiz-sky">
        <Plus size={11} /> Add hierarchy
      </button>
    </div>
  );
}

function Empty({ message }) {
  return <p className="text-[10px] text-wiz-muted/60 italic text-center py-2">{message}</p>;
}

// ─── REFERENCE LINES ─────────────────────────────────────────────────────────

const REF_VALUE_PRESETS = [
  { label: 'Average', value: 'avg' },
  { label: 'Median', value: 'median' },
  { label: '95th percentile', value: 'p95' },
  { label: '5th percentile', value: 'p5' },
  { label: 'Min', value: 'min' },
  { label: 'Max', value: 'max' },
];

function ReferenceLinesSection({ lines, onChange }) {
  const add = (preset) => {
    const label = preset?.label || 'New line';
    const value = preset?.value ?? 0;
    onChange([...lines, { label, value, axis: 'y' }]);
  };
  const update = (i, patch) => {
    const next = [...lines]; next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i) => onChange(lines.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Overlay horizontal lines on charts (average, target, percentiles).
      </p>
      {lines.map((l, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              value={l.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label"
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40"
            />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose">
              <Trash2 size={11}/>
            </button>
          </div>
          <input
            value={l.value}
            onChange={(e) => {
              // If string is numeric, store as number; else keep as keyword string
              const v = e.target.value;
              const n = parseFloat(v);
              update(i, { value: Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v.trim()) ? n : v });
            }}
            placeholder='avg, p95, or a number like 1000'
            className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono"
          />
        </div>
      ))}
      <details className="text-[10px] text-wiz-muted">
        <summary className="cursor-pointer hover:text-wiz-text">Quick add</summary>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {REF_VALUE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => add(p)}
              className="text-left px-2 py-1 rounded bg-wiz-bg/40 hover:bg-wiz-accent/20 hover:text-wiz-accent text-[10px]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </details>
      <button
        onClick={() => add()}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-accent/50 hover:text-wiz-accent"
      >
        <Plus size={11}/> Add reference line
      </button>
    </div>
  );
}

// ─── REFERENCE BANDS ─────────────────────────────────────────────────────────

const BAND_PRESETS = [
  { label: 'IQR (P25–P75)', from: 'p25', to: 'p75' },
  { label: 'Middle 90% (P5–P95)', from: 'p5', to: 'p95' },
  { label: 'Above average', from: 'avg', to: 'max' },
];

function ReferenceBandsSection({ bands, onChange }) {
  const add = (preset) => {
    const label = preset?.label || 'New band';
    const from = preset?.from ?? 0;
    const to = preset?.to ?? 100;
    onChange([...bands, { label, from, to, axis: 'y' }]);
  };
  const update = (i, patch) => {
    const next = [...bands]; next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i) => onChange(bands.filter((_, idx) => idx !== i));

  const parseValue = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? n : v;
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Shade a range on the chart (IQR, normal range, etc.).
      </p>
      {bands.map((b, i) => (
        <div key={i} className="p-2 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              value={b.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label"
              className="flex-1 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40"
            />
            <button onClick={() => remove(i)} className="p-1 text-wiz-muted hover:text-wiz-rose">
              <Trash2 size={11}/>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={b.from}
              onChange={(e) => update(i, { from: parseValue(e.target.value) })}
              placeholder='from (p25, 100)'
              className="px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono"
            />
            <input
              value={b.to}
              onChange={(e) => update(i, { to: parseValue(e.target.value) })}
              placeholder='to (p75, 500)'
              className="px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono"
            />
          </div>
        </div>
      ))}
      <details className="text-[10px] text-wiz-muted">
        <summary className="cursor-pointer hover:text-wiz-text">Quick add</summary>
        <div className="mt-1.5 grid grid-cols-1 gap-1">
          {BAND_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => add(p)}
              className="text-left px-2 py-1 rounded bg-wiz-bg/40 hover:bg-wiz-accent/20 hover:text-wiz-accent text-[10px]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </details>
      <button
        onClick={() => add()}
        className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-dashed border-wiz-border/50 text-[11px] text-wiz-muted hover:border-wiz-accent/50 hover:text-wiz-accent"
      >
        <Plus size={11}/> Add reference band
      </button>
    </div>
  );
}

// ─── TRELLIS / SMALL MULTIPLES ──────────────────────────────────────────────

function TrellisSection({ trellis, categoricalCols, onChange }) {
  if (!categoricalCols.length) {
    return <Empty message="No categorical columns to facet by." />;
  }
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        Split the chart into a grid of mini-charts, one per category.
      </p>
      <div className="space-y-1.5">
        <label className="text-[10px] text-wiz-muted block">Facet by</label>
        <select
          value={trellis?.facetBy || ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v ? { facetBy: v, max: trellis?.max ?? 12 } : null);
          }}
          className="w-full px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40"
        >
          <option value="">— None —</option>
          {categoricalCols.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        {trellis?.facetBy && (
          <div className="flex items-center gap-2 mt-2">
            <label className="text-[10px] text-wiz-muted">Max facets</label>
            <input
              type="number"
              min={2}
              max={50}
              value={trellis.max ?? 12}
              onChange={(e) => onChange({ ...trellis, max: parseInt(e.target.value) || 12 })}
              className="w-16 px-2 py-1 rounded bg-wiz-bg/60 text-[11px] text-wiz-text border border-wiz-border/40 font-mono"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DUAL AXIS ───────────────────────────────────────────────────────────────

function DualAxisSection({ dualAxis, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-wiz-muted italic">
        With exactly 2 measures on Rows, place the second on a right Y-axis with its own scale.
      </p>
      <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-wiz-surface/40 border border-wiz-border/30 cursor-pointer">
        <input
          type="checkbox"
          checked={!!dualAxis}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-wiz-accent"
        />
        <span className="text-[11px] text-wiz-text">
          Use dual axis
        </span>
      </label>
      <p className="text-[10px] text-wiz-muted/60">
        Useful when the two measures are on very different scales (revenue + margin, count + average, etc.).
      </p>
    </div>
  );
}

