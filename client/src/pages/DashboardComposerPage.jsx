import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutGrid, Plus, Save, X, Database, FileText, Maximize2, Minimize2, Trash2, Move, Undo2, Redo2, Download, Filter, RotateCcw, ImageDown, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import ChartRenderer from '../components/ChartRenderer';
import InsightFeed from '../components/InsightFeed';
import ShareDialog from '../components/ShareDialog';
import * as api from '../utils/api';

const GRID_COLS = 12;
const ROW_HEIGHT = 60;

function findFreeSpot(tiles, w = 6, h = 4) {
  let maxY = 0;
  tiles.forEach(t => { if (t.y + t.h > maxY) maxY = t.y + t.h; });
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLS - w; x++) {
      const overlap = tiles.some(t => !(x + w <= t.x || x >= t.x + t.w || y + h <= t.y || y >= t.y + t.h));
      if (!overlap) return { x, y, w, h };
    }
  }
  return { x: 0, y: maxY, w, h };
}

let dragSheet = null;

export default function DashboardComposerPage({ dataset, analysis }) {
  const params = useParams();
  const navigate = useNavigate();
  const editingId = params.id !== 'new' ? params.id : null;

  const [name, setName] = useState('Untitled Dashboard');
  const [tiles, setTiles] = useState([]);
  const [renderedTiles, setRenderedTiles] = useState({});
  const [allSheets, setAllSheets] = useState([]);
  const [savingId, setSavingId] = useState(editingId);

  // Cross-filtering: when user clicks a bar/segment in tile A, all OTHER tiles get re-rendered with that filter
  const [crossFilter, setCrossFilter] = useState(null);  // { sourceTileId, field, value }

  // Undo/redo: store last 30 tile-arrangement states
  const historyRef = useRef([[]]);   // stack of past tile snapshots
  const futureRef = useRef([]);      // redo stack
  const skipHistoryRef = useRef(false);

  // Resize via drag
  const [resizing, setResizing] = useState(null); // { idx, startX, startY, startW, startH }
  const [shareOpen, setShareOpen] = useState(false);
  const gridRef = useRef(null);

  // ─── HISTORY ───
  const pushHistory = (newTiles) => {
    if (skipHistoryRef.current) { skipHistoryRef.current = false; return; }
    historyRef.current = [...historyRef.current, newTiles].slice(-30);
    futureRef.current = [];
  };
  const undo = () => {
    if (historyRef.current.length < 2) return;
    const cur = historyRef.current[historyRef.current.length - 1];
    futureRef.current = [cur, ...futureRef.current];
    historyRef.current = historyRef.current.slice(0, -1);
    skipHistoryRef.current = true;
    setTiles(historyRef.current[historyRef.current.length - 1]);
    toast('Undone', { icon: '↶', duration: 1200 });
  };
  const redo = () => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[0];
    futureRef.current = futureRef.current.slice(1);
    historyRef.current = [...historyRef.current, next];
    skipHistoryRef.current = true;
    setTiles(next);
    toast('Redone', { icon: '↷', duration: 1200 });
  };

  // Wrapper for setTiles that records history
  const updateTiles = (newTilesOrFn) => {
    setTiles(prev => {
      const next = typeof newTilesOrFn === 'function' ? newTilesOrFn(prev) : newTilesOrFn;
      pushHistory(next);
      return next;
    });
  };

  // Keyboard: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Y = redo
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── LOAD ───
  useEffect(() => {
    if (editingId) {
      api.getCustomDashboard(editingId).then(r => {
        setName(r.dashboard.name);
        const loaded = r.dashboard.tiles || [];
        skipHistoryRef.current = true;
        setTiles(loaded);
        historyRef.current = [loaded];
        const rendered = {};
        (r.tiles || []).forEach(t => {
          if (t.sheet) rendered[t.sheetId] = { sheet: t.sheet, chartSpec: t.chartSpec, chartData: t.chartData, stackKeys: t.stackKeys };
        });
        setRenderedTiles(rendered);
        setSavingId(r.dashboard.id);
      }).catch(() => toast.error('Failed to load dashboard'));
    }
  }, [editingId]);

  useEffect(() => {
    if (dataset?.id) api.listSheets(dataset.id).then(r => setAllSheets(r.sheets || []));
  }, [dataset?.id]);

  // ─── RENDER TILES (with cross-filtering) ───
  // When crossFilter changes, re-render all tiles EXCEPT the source one.
  useEffect(() => {
    tiles.forEach(t => {
      const isSource = crossFilter && crossFilter.sourceTileId === t.sheetId;
      const needsRefresh = !renderedTiles[t.sheetId] || (crossFilter && !isSource);
      if (!needsRefresh) return;

      // Get sheet spec — use already-loaded sheet if available, else fetch
      const cached = renderedTiles[t.sheetId];
      const sheetSpec = cached?.sheet?.spec;

      if (sheetSpec) {
        const augmented = isSource ? sheetSpec : {
          ...sheetSpec,
          crossFilter: crossFilter ? { field: crossFilter.field, value: crossFilter.value } : null,
        };
        api.renderSheet(dataset.id, augmented).then(r => {
          setRenderedTiles(prev => ({ ...prev, [t.sheetId]: { ...cached, chartSpec: r.spec, chartData: r.chartData, stackKeys: r.stackKeys } }));
        }).catch(() => {});
      } else {
        api.getSheet(t.sheetId).then(r => {
          if (r.sheet) {
            setRenderedTiles(prev => ({ ...prev, [t.sheetId]: { sheet: r.sheet, chartSpec: r.chartSpec, chartData: r.chartData, stackKeys: r.stackKeys } }));
          }
        }).catch(() => {});
      }
    });
  }, [tiles, crossFilter, dataset?.id]);

  // ─── ACTIONS ───
  const handleAddSheet = (sheet, w = 6, h = 4) => {
    if (tiles.some(t => t.sheetId === sheet.id)) {
      toast('Already in dashboard', { icon: 'ℹ️' });
      return;
    }
    const spot = findFreeSpot(tiles, w, h);
    updateTiles([...tiles, { sheetId: sheet.id, ...spot }]);
  };
  const removeTile = (idx) => updateTiles(tiles.filter((_, i) => i !== idx));
  const resizeTile = (idx, dw, dh) => updateTiles(tiles.map((t, i) => {
    if (i !== idx) return t;
    return { ...t, w: Math.max(2, Math.min(GRID_COLS, t.w + dw)), h: Math.max(2, t.h + dh) };
  }));

  const handleSave = async () => {
    if (!tiles.length) { toast.error('Add at least one sheet'); return; }
    if (!dataset?.id) { toast.error('No dataset loaded — re-upload your file.'); return; }
    try {
      if (savingId) {
        await api.updateDashboard(savingId, { name, tiles });
        toast.success('Dashboard updated');
      } else {
        const r = await api.saveDashboard(name, dataset.id, tiles);
        if (!r?.dashboard?.id) throw new Error('Server did not return a dashboard id');
        setSavingId(r.dashboard.id);
        toast.success('Dashboard saved');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Save failed';
      console.error('[saveDashboard] error:', err);
      toast.error('Save failed: ' + msg, { duration: 6000 });
    }
  };

  const handleGridDrop = (e) => {
    e.preventDefault();
    if (dragSheet) { handleAddSheet(dragSheet); dragSheet = null; }
  };

  // ─── CROSS-FILTER ───
  // Click handler passed to ChartRenderer — when user clicks a category, set filter
  const handleChartClick = (sheetId, chartData) => {
    if (!chartData) return;
    const data = chartData.activePayload?.[0]?.payload;
    if (!data) return;
    const sheet = renderedTiles[sheetId]?.sheet;
    if (!sheet) return;
    // The first dim on the columns shelf is the field to filter on
    const field = sheet.spec.columns?.[0]?.name || sheet.spec.rows?.[0]?.name;
    if (!field) return;
    const value = data[field];
    if (value == null) return;

    // Toggle: if already filtered on same value, clear; else set
    if (crossFilter && crossFilter.sourceTileId === sheetId && crossFilter.value === value) {
      setCrossFilter(null);
      toast('Cross-filter cleared', { icon: '🔓' });
    } else {
      setCrossFilter({ sourceTileId: sheetId, field, value });
      toast(`Filtering by ${field} = "${value}"`, { icon: '🔗' });
    }
  };

  // ─── DRAG RESIZE ───
  const startResize = (e, idx) => {
    e.stopPropagation();
    e.preventDefault();
    const tile = tiles[idx];
    setResizing({ idx, startX: e.clientX, startY: e.clientY, startW: tile.w, startH: tile.h });
  };
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      if (!gridRef.current) return;
      const grid = gridRef.current.getBoundingClientRect();
      const cellW = grid.width / GRID_COLS;
      const dxCells = Math.round((e.clientX - resizing.startX) / cellW);
      const dyCells = Math.round((e.clientY - resizing.startY) / ROW_HEIGHT);
      const newW = Math.max(2, Math.min(GRID_COLS, resizing.startW + dxCells));
      const newH = Math.max(2, resizing.startH + dyCells);
      setTiles(prev => prev.map((t, i) => i === resizing.idx ? { ...t, w: newW, h: newH } : t));
    };
    const onUp = () => {
      pushHistory(tiles);
      setResizing(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing, tiles]);

  // ─── EXPORT ───
  const exportJSON = () => {
    const payload = { name, tiles, exportedAt: new Date().toISOString(), datasetId: dataset?.id };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${name.replace(/\s+/g, '_')}.dashboard.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported dashboard JSON');
  };

  const exportPNG = async () => {
    if (!gridRef.current) return;
    toast('Rendering PNG...', { icon: '🖼️' });
    try {
      // Use html-to-image dynamically; if not available, use a fallback approach with SVG snapshot
      // We'll inline a minimal solution: serialize each chart as it is rendered (recharts uses SVG)
      const node = gridRef.current;
      const rect = node.getBoundingClientRect();

      // Build an SVG that contains a foreignObject with the cloned HTML
      const cloned = node.cloneNode(true);
      const w = Math.ceil(rect.width), h = Math.ceil(rect.height);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="background:#0C1220;width:${w}px;height:${h}px;color:white;font-family:system-ui,sans-serif">${cloned.outerHTML}</div>
        </foreignObject>
      </svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w * 2; canvas.height = h * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.fillStyle = '#0C1220';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(b => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = `${name.replace(/\s+/g, '_')}.png`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast.success('PNG exported');
        });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        // Fallback: just download the SVG
        const a = document.createElement('a');
        a.href = url; a.download = `${name.replace(/\s+/g, '_')}.svg`;
        a.click();
        toast.success('SVG exported (PNG conversion failed in this browser)');
      };
      img.src = url;
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    }
  };

  if (!dataset) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-wiz-muted">
      <Database size={48} className="mb-4 opacity-30" />
      <p className="text-sm">No dataset loaded.</p>
      <button onClick={() => navigate('/')} className="mt-3 text-wiz-accent text-sm font-semibold hover:underline">Upload a file</button>
    </div>
  );

  const maxY = tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  const gridHeight = Math.max(8, maxY + 4) * ROW_HEIGHT;
  const canUndo = historyRef.current.length > 1;
  const canRedo = futureRef.current.length > 0;

  return (
    <div className="max-w-[1500px] mx-auto px-4 py-4">
      {/* Header bar */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <LayoutGrid size={18} className="text-wiz-emerald shrink-0" />
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="text-base font-bold font-display text-wiz-text bg-transparent outline-none border-b border-transparent hover:border-wiz-border focus:border-wiz-emerald transition-colors flex-1 min-w-0" />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Undo/Redo */}
          <div className="flex items-center bg-wiz-bg/40 rounded-xl p-0.5 border border-wiz-border/30">
            <button onClick={undo} disabled={!canUndo} title="Undo (Cmd+Z)" className="p-1.5 rounded-lg disabled:opacity-30 hover:bg-wiz-bg/60 text-wiz-muted hover:text-wiz-text transition-colors"><Undo2 size={13} /></button>
            <button onClick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)" className="p-1.5 rounded-lg disabled:opacity-30 hover:bg-wiz-bg/60 text-wiz-muted hover:text-wiz-text transition-colors"><Redo2 size={13} /></button>
          </div>
          {/* Export */}
          <button onClick={exportPNG} title="Export PNG" className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-wiz-bg/40 border border-wiz-border/30 text-wiz-muted hover:text-wiz-text hover:border-wiz-border-light text-[11px] font-semibold transition-all">
            <ImageDown size={12} />PNG
          </button>
          <button onClick={exportJSON} title="Export JSON" className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-wiz-bg/40 border border-wiz-border/30 text-wiz-muted hover:text-wiz-text hover:border-wiz-border-light text-[11px] font-semibold transition-all">
            <Download size={12} />JSON
          </button>
          <button onClick={() => navigate('/sheets')} className="px-3 py-1.5 rounded-xl glass text-wiz-muted hover:text-wiz-text text-[11px] font-semibold transition-all btn-press">All</button>
          {savingId && (
            <motion.button onClick={() => setShareOpen(true)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-wiz-border/40 text-wiz-text hover:border-wiz-emerald/40 text-[11px] font-semibold transition-all">
              <Share2 size={13} />Share
            </motion.button>
          )}
          <motion.button onClick={handleSave} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-wiz-emerald-deep to-wiz-emerald text-white text-[11px] font-semibold shadow-lg shadow-wiz-emerald/20 btn-press">
            <Save size={13} />{savingId ? 'Update' : 'Save'}
          </motion.button>
        </div>
      </motion.div>

      {/* Cross-filter banner */}
      <AnimatePresence>
        {crossFilter && (
          <motion.div initial={{ opacity: 0, y: -10, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <Filter size={13} className="text-amber-400" />
            <span className="text-[11px] text-amber-200 font-mono">
              Cross-filter active: <span className="font-bold">{crossFilter.field}</span> = <span className="font-bold">"{crossFilter.value}"</span> · all tiles updated except source
            </span>
            <button onClick={() => setCrossFilter(null)} className="ml-auto p-1 rounded hover:bg-amber-500/20 text-amber-400 transition-colors">
              <X size={11} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Insight Feed */}
      {savingId && tiles.length > 0 && <InsightFeed dashboardId={savingId} refreshKey={tiles.length + (crossFilter ? 1 : 0)} />}

      <div className="grid grid-cols-12 gap-3">
        {/* LEFT: saved sheets sidebar */}
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="col-span-3 rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 flex flex-col overflow-hidden" style={{ minHeight: '600px' }}>
          <div className="px-3 py-2.5 border-b border-wiz-border/30 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono text-wiz-muted uppercase tracking-wider">Saved Sheets</p>
              <p className="text-[9px] font-mono text-wiz-dim">{allSheets.length} available</p>
            </div>
            <button onClick={() => navigate('/sheet/new')} title="New sheet" className="p-1.5 rounded-lg bg-wiz-accent/10 text-wiz-accent-light hover:bg-wiz-accent/20 transition-colors"><Plus size={13} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {allSheets.length === 0 ? (
              <div className="text-center py-8">
                <FileText size={24} className="mx-auto mb-2 text-wiz-dim" />
                <p className="text-[10px] text-wiz-dim font-body mb-2">No sheets to compose with</p>
                <button onClick={() => navigate('/sheet/new')} className="text-[10px] text-wiz-accent font-semibold hover:underline">Create one →</button>
              </div>
            ) : (
              allSheets.map(s => {
                const inDashboard = tiles.some(t => t.sheetId === s.id);
                return (
                  <div key={s.id}
                    draggable={!inDashboard}
                    onDragStart={() => { dragSheet = s; }}
                    className={`p-2.5 rounded-xl border transition-all select-none ${inDashboard ? 'bg-wiz-emerald/5 border-wiz-emerald/20 opacity-60' : 'bg-wiz-bg/40 border-wiz-border/30 hover:border-wiz-emerald/30 cursor-grab active:cursor-grabbing'}`}
                    onClick={() => !inDashboard && handleAddSheet(s)}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-wiz-accent/15 text-wiz-accent-light uppercase">{s.spec?.chartType?.replace('_', ' ') || 'sheet'}</span>
                      {inDashboard && <span className="text-[8px] text-wiz-emerald font-mono">✓ added</span>}
                    </div>
                    <p className="text-[11px] font-semibold text-wiz-text truncate">{s.name}</p>
                  </div>
                );
              })
            )}
          </div>
          <div className="px-3 py-2 border-t border-wiz-border/30 bg-wiz-bg/30">
            <p className="text-[9px] font-mono text-wiz-dim">Drag onto canvas · click bars to cross-filter</p>
          </div>
        </motion.div>

        {/* RIGHT: grid canvas */}
        <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
          className="col-span-9 rounded-2xl bg-wiz-surface/40 border border-wiz-border/40 p-3 overflow-auto"
          onDragOver={(e) => e.preventDefault()} onDrop={handleGridDrop}>
          {tiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: '500px' }}>
              <div className="w-20 h-20 rounded-3xl bg-wiz-emerald/5 border border-wiz-emerald/10 flex items-center justify-center mb-5">
                <LayoutGrid size={32} className="text-wiz-emerald/30" />
              </div>
              <p className="text-base font-display font-semibold text-wiz-muted mb-2">Empty Canvas</p>
              <p className="text-xs text-wiz-dim font-body">Drag sheets from the left, or click them to add</p>
            </div>
          ) : (
            <div ref={gridRef} className="relative" style={{ height: gridHeight, display: 'grid',
              gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
              gridAutoRows: `${ROW_HEIGHT}px`,
              gap: '8px' }}>
              {tiles.map((tile, idx) => {
                const data = renderedTiles[tile.sheetId];
                const isSource = crossFilter?.sourceTileId === tile.sheetId;
                return (
                  <motion.div
                    key={tile.sheetId + '-' + idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    layout
                    className={`bg-wiz-card/60 border rounded-xl overflow-hidden flex flex-col hover:border-wiz-emerald/30 transition-all group relative ${isSource ? 'border-amber-500/40 ring-2 ring-amber-500/20' : 'border-wiz-border/40'}`}
                    style={{ gridColumn: `${tile.x + 1} / span ${tile.w}`, gridRow: `${tile.y + 1} / span ${tile.h}` }}>
                    {/* Header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-wiz-border/30 bg-wiz-bg/30">
                      <h4 className="text-[11px] font-bold font-display text-wiz-text truncate flex items-center gap-1.5">
                        <Move size={10} className="text-wiz-dim shrink-0" />
                        {data?.sheet?.name || 'Loading...'}
                        {isSource && <span className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-amber-500/20 text-amber-300">FILTER SRC</span>}
                      </h4>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => resizeTile(idx, -1, 0)} title="Narrower" className="p-1 rounded hover:bg-wiz-bg/60 text-wiz-dim hover:text-wiz-text transition-colors text-[9px] font-mono">←</button>
                        <button onClick={() => resizeTile(idx, 1, 0)} title="Wider" className="p-1 rounded hover:bg-wiz-bg/60 text-wiz-dim hover:text-wiz-text transition-colors text-[9px] font-mono">→</button>
                        <button onClick={() => resizeTile(idx, 0, -1)} title="Shorter" className="p-1 rounded hover:bg-wiz-bg/60 text-wiz-dim hover:text-wiz-text transition-colors text-[9px] font-mono">↑</button>
                        <button onClick={() => resizeTile(idx, 0, 1)} title="Taller" className="p-1 rounded hover:bg-wiz-bg/60 text-wiz-dim hover:text-wiz-text transition-colors text-[9px] font-mono">↓</button>
                        <button onClick={() => removeTile(idx)} title="Remove" className="p-1 rounded hover:bg-wiz-rose/10 text-wiz-dim hover:text-wiz-rose transition-colors"><X size={10} /></button>
                      </div>
                    </div>
                    {/* Chart area */}
                    <div className="flex-1 min-h-0 p-2" onClick={(e) => {
                      // Bubble through to recharts which fires its own onClick
                    }}>
                      {data?.chartData ? (
                        <div className="h-full" onClick={(e) => {
                          // Find the activePayload by looking at recharts internals via the tooltip element
                          // Simpler: re-bind through ChartRenderer's onClick passthrough
                        }}>
                          <ChartRenderer
                            spec={data.chartSpec}
                            chartData={data.chartData}
                            stackKeys={data.stackKeys}
                            height="100%"
                            onClick={(payload) => handleChartClick(tile.sheetId, payload)}
                          />
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-wiz-dim text-[10px] font-mono">
                          {data ? 'No data' : 'Loading...'}
                        </div>
                      )}
                    </div>
                    {/* Auto-generated insight footer (only on auto-dashboards) */}
                    {tile.insight?.text && (
                      <div className="px-3 pb-2 -mt-1">
                        <p className="text-[10px] font-body text-wiz-text-secondary leading-snug">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                            tile.insight.severity === 'warning' ? 'bg-wiz-amber' :
                            tile.insight.severity === 'critical' ? 'bg-wiz-rose' :
                            'bg-wiz-emerald'
                          }`} />
                          {tile.insight.text}
                        </p>
                      </div>
                    )}
                    {/* Resize handle (bottom-right corner) */}
                    <div onMouseDown={(e) => startResize(e, idx)}
                      className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(52,211,153,0.6) 50%)' }} />
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {tiles.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 p-3 rounded-xl glass text-center">
          <p className="text-[11px] text-wiz-muted font-body">
            <LayoutGrid size={11} className="inline mr-1.5 text-wiz-emerald" />
            {tiles.length} tile{tiles.length === 1 ? '' : 's'} · drag corner ⌟ to resize · click bars to cross-filter · ⌘Z undo
          </p>
        </motion.div>
      )}
      <ShareDialog
        resourceType="dashboard"
        resourceId={savingId}
        resourceName={name}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
