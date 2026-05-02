import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, X, Plus, ChevronDown, ChevronUp, TrendingUp, Hash, Tag, Search } from 'lucide-react';
import * as api from '../utils/api';

// Single filter row
function FilterRow({ filter, columns, datasetId, onChange, onRemove }) {
  const [options, setOptions] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const col = columns.find(c => c.name === filter.field);
  const isNumeric = col?.type === 'numeric' && col?.subtype !== 'identifier' && col?.subtype !== 'year';
  const isCategorical = col?.type === 'categorical' || col?.type === 'temporal' || col?.subtype === 'year';

  useEffect(() => {
    if (!filter.field || !datasetId) return;
    api.getFilterOptions(datasetId, filter.field).then(setOptions).catch(() => setOptions(null));
  }, [filter.field, datasetId]);

  const set = (patch) => onChange({ ...filter, ...patch });

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      className="rounded-xl bg-wiz-bg/40 border border-wiz-border/30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-wiz-border/20">
        <button onClick={() => setExpanded(!expanded)} className="p-0.5 text-wiz-muted hover:text-wiz-text">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <Filter size={11} className="text-wiz-emerald" />
        <span className="text-[11px] font-mono text-wiz-text flex-1 truncate font-semibold">{filter.field || 'New filter'}</span>
        <span className="text-[9px] font-mono text-wiz-dim uppercase">{filter.op}</span>
        <button onClick={onRemove} className="p-1 rounded hover:bg-wiz-rose/20 text-wiz-dim hover:text-wiz-rose transition-colors">
          <X size={11} />
        </button>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="p-3 space-y-2">
              {/* Field picker */}
              <div>
                <label className="text-[9px] font-mono text-wiz-dim uppercase tracking-wider">Field</label>
                <select value={filter.field || ''} onChange={(e) => set({ field: e.target.value, value: undefined })}
                  className="w-full mt-1 bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40">
                  <option value="">— Select field —</option>
                  {columns.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type.slice(0,3)})</option>)}
                </select>
              </div>
              {/* Op picker */}
              {filter.field && (
                <div>
                  <label className="text-[9px] font-mono text-wiz-dim uppercase tracking-wider">Operator</label>
                  <select value={filter.op || 'in'} onChange={(e) => set({ op: e.target.value, value: undefined })}
                    className="w-full mt-1 bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40">
                    {isCategorical && <>
                      <option value="in">Is one of</option>
                      <option value="not_in">Is not one of</option>
                      <option value="contains">Contains</option>
                      <option value="top_n">Top N</option>
                      <option value="bottom_n">Bottom N</option>
                    </>}
                    {isNumeric && <>
                      <option value="between">Between</option>
                      <option value=">">Greater than</option>
                      <option value="<">Less than</option>
                      <option value=">=">Greater or equal</option>
                      <option value="<=">Less or equal</option>
                      <option value="=">Equals</option>
                      <option value="top_n">Top N</option>
                    </>}
                  </select>
                </div>
              )}
              {/* Value editor */}
              {filter.field && filter.op && (
                <div>
                  <label className="text-[9px] font-mono text-wiz-dim uppercase tracking-wider">Value</label>
                  {(filter.op === 'top_n' || filter.op === 'bottom_n') && (
                    <div className="mt-1 space-y-1.5">
                      <input type="number" min="1" max="100" value={filter.value || 10}
                        onChange={(e) => set({ value: Math.max(1, Number(e.target.value) || 10) })}
                        className="w-full bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40" />
                      <select value={filter.by || ''} onChange={(e) => set({ by: e.target.value })}
                        className="w-full bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40">
                        <option value="">Rank by (default: count)</option>
                        {columns.filter(c => c.type === 'numeric').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  )}
                  {filter.op === 'between' && (
                    <div className="mt-1 grid grid-cols-2 gap-1.5">
                      <input type="number" placeholder="Min" value={filter.value?.[0] ?? ''}
                        onChange={(e) => set({ value: [Number(e.target.value), filter.value?.[1] ?? options?.range?.max ?? 0] })}
                        className="bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40" />
                      <input type="number" placeholder="Max" value={filter.value?.[1] ?? ''}
                        onChange={(e) => set({ value: [filter.value?.[0] ?? options?.range?.min ?? 0, Number(e.target.value)] })}
                        className="bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40" />
                    </div>
                  )}
                  {(filter.op === 'in' || filter.op === 'not_in') && (
                    <div className="mt-1 max-h-[140px] overflow-y-auto bg-wiz-surface/60 border border-wiz-border/40 rounded-lg p-1">
                      {options?.values?.length ? options.values.map(v => {
                        const checked = Array.isArray(filter.value) && filter.value.includes(v);
                        return (
                          <label key={v} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-wiz-bg/40 cursor-pointer">
                            <input type="checkbox" checked={checked}
                              onChange={() => {
                                const cur = Array.isArray(filter.value) ? filter.value : [];
                                set({ value: checked ? cur.filter(x => x !== v) : [...cur, v] });
                              }}
                              className="accent-wiz-emerald" />
                            <span className="text-[11px] font-mono text-wiz-text-secondary truncate">{v}</span>
                          </label>
                        );
                      }) : <p className="text-[10px] font-mono text-wiz-dim p-2">Loading values…</p>}
                    </div>
                  )}
                  {(['>','<','>=','<=','=','contains'].includes(filter.op)) && (
                    <input type={filter.op === 'contains' ? 'text' : 'number'} value={filter.value ?? ''}
                      onChange={(e) => set({ value: filter.op === 'contains' ? e.target.value : Number(e.target.value) })}
                      placeholder={filter.op === 'contains' ? 'Search text...' : '0'}
                      className="w-full mt-1 bg-wiz-surface/60 border border-wiz-border/40 rounded-lg px-2 py-1.5 text-[11px] text-wiz-text font-mono outline-none focus:border-wiz-emerald/40" />
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FilterPanel({ filters, onChange, columns, datasetId }) {
  const addFilter = () => onChange([...filters, { field: '', op: 'in', value: undefined }]);
  const updateFilter = (idx, patch) => onChange(filters.map((f, i) => i === idx ? patch : f));
  const removeFilter = (idx) => onChange(filters.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono text-wiz-emerald uppercase tracking-wider font-bold flex items-center gap-1.5">
          <Filter size={10} />Filters ({filters.length})
        </p>
        <button onClick={addFilter} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-wiz-emerald/10 hover:bg-wiz-emerald/20 text-wiz-emerald text-[10px] font-semibold transition-colors">
          <Plus size={10} />Add
        </button>
      </div>
      <AnimatePresence>
        {filters.map((f, i) => (
          <FilterRow key={i} filter={f} columns={columns} datasetId={datasetId}
            onChange={(p) => updateFilter(i, p)}
            onRemove={() => removeFilter(i)} />
        ))}
      </AnimatePresence>
      {filters.length === 0 && (
        <p className="text-[10px] text-wiz-dim italic font-body px-1">No filters · click +Add to limit data</p>
      )}
    </div>
  );
}
