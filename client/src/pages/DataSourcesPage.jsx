import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Database, Globe, GitMerge, Link2, ArrowRight, CheckCircle2, AlertCircle,
  Plus, Eye, EyeOff, Loader2, FileWarning, Info,
} from 'lucide-react';
import * as api from '../utils/api';

const TABS = [
  { id: 'sql', label: 'SQL Database', icon: Database, blurb: 'Postgres, MySQL, SQLite' },
  { id: 'api', label: 'REST API', icon: Globe, blurb: 'Any JSON endpoint' },
  { id: 'union', label: 'Union', icon: GitMerge, blurb: 'Stack datasets row-wise' },
  { id: 'join', label: 'Join', icon: Link2, blurb: 'Merge on a key' },
];

export default function DataSourcesPage({ onCreated }) {
  const [tab, setTab] = useState('sql');
  const [caps, setCaps] = useState(null);

  useEffect(() => {
    api.getConnectionCapabilities().then(setCaps).catch(() => {});
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-bold text-wiz-text mb-2">Data Sources</h1>
        <p className="text-sm text-wiz-muted">Connect to databases, APIs, or combine existing datasets.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border transition-all whitespace-nowrap ${
                active
                  ? 'bg-gradient-to-br from-wiz-accent/15 to-wiz-accent/5 border-wiz-accent/40 text-wiz-text'
                  : 'bg-wiz-surface/50 border-wiz-border/30 text-wiz-muted hover:text-wiz-text hover:border-wiz-border/50'
              }`}
            >
              <Icon size={16} className={active ? 'text-wiz-accent' : ''} />
              <div className="text-left">
                <div className="text-sm font-semibold leading-tight">{t.label}</div>
                <div className="text-[10px] font-mono opacity-70">{t.blurb}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl bg-wiz-surface/60 border border-wiz-border/30 p-6">
        {tab === 'sql' && <SqlTab onCreated={onCreated} caps={caps} />}
        {tab === 'api' && <ApiTab onCreated={onCreated} caps={caps} />}
        {tab === 'union' && <UnionTab onCreated={onCreated} />}
        {tab === 'join' && <JoinTab onCreated={onCreated} />}
      </div>

      {caps && <CapabilitiesNote caps={caps} />}
    </motion.div>
  );
}

// ─── SQL TAB ─────────────────────────────────────────────────────────────────

function SqlTab({ onCreated, caps }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState({
    type: 'postgres',
    host: 'localhost',
    port: 5432,
    user: '',
    password: '',
    database: '',
    file: '', // for sqlite
    ssl: false,
  });
  const [query, setQuery] = useState('SELECT * FROM your_table LIMIT 1000');
  const [showPwd, setShowPwd] = useState(false);
  const [test, setTest] = useState(null); // { ok, version, tables } or null
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const driverInstalled = caps?.sql?.[config.type] ?? true; // optimistic before caps load

  const handleTypeChange = (t) => {
    setConfig(c => ({
      ...c,
      type: t,
      port: t === 'postgres' ? 5432 : t === 'mysql' ? 3306 : c.port,
    }));
    setTest(null);
  };

  const handleTest = async () => {
    setBusy(true); setTest(null);
    try {
      const r = await api.testSqlConnection(config);
      setTest(r);
      if (r.ok) toast.success('Connection successful');
      else toast.error('Connection failed');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const r = await api.importFromSql(config, query);
      toast.success(`Imported ${r.rowCount.toLocaleString()} rows`);
      if (onCreated) onCreated(
        { id: r.datasetId, fileName: r.fileName, rowCount: r.rowCount, columnCount: r.columnCount },
        r.analysis,
      );
      navigate('/analysis');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  };

  return (
    <div className="space-y-4">
      {/* Driver check */}
      {!driverInstalled && (
        <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          <FileWarning size={14} className="mt-0.5 flex-shrink-0" />
          <div>
            Driver for <strong>{config.type}</strong> isn't installed. Run <code className="font-mono px-1 bg-wiz-bg rounded">npm install</code> in the project root.
          </div>
        </div>
      )}

      {/* DB type selector */}
      <div>
        <label className="text-xs font-mono uppercase text-wiz-muted block mb-2">Database type</label>
        <div className="flex gap-2">
          {['postgres', 'mysql', 'sqlite'].map(t => (
            <button
              key={t}
              onClick={() => handleTypeChange(t)}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm capitalize ${
                config.type === t
                  ? 'bg-wiz-accent/15 border-wiz-accent/50 text-wiz-text'
                  : 'bg-wiz-bg/40 border-wiz-border/30 text-wiz-muted hover:text-wiz-text'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Connection fields */}
      {config.type === 'sqlite' ? (
        <Field label="Database file path" hint="Absolute path to .db / .sqlite file">
          <input
            value={config.file}
            onChange={e => setConfig(c => ({ ...c, file: e.target.value }))}
            placeholder="/Users/you/data/sample.db"
            className={inputCls}
          />
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Host" colSpan={2}>
              <input value={config.host} onChange={e => setConfig(c => ({ ...c, host: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Port">
              <input type="number" value={config.port} onChange={e => setConfig(c => ({ ...c, port: parseInt(e.target.value) || 0 }))} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="User">
              <input value={config.user} onChange={e => setConfig(c => ({ ...c, user: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={config.password}
                  onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
                  className={inputCls + ' pr-9'}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-wiz-muted hover:text-wiz-text"
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
          </div>
          <Field label="Database">
            <input value={config.database} onChange={e => setConfig(c => ({ ...c, database: e.target.value }))} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-wiz-muted">
            <input type="checkbox" checked={config.ssl} onChange={e => setConfig(c => ({ ...c, ssl: e.target.checked }))} />
            Use SSL (required for cloud-hosted databases)
          </label>
        </>
      )}

      {/* Test result */}
      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-wiz-bg border border-wiz-border/40 text-sm text-wiz-text hover:border-wiz-accent/40 disabled:opacity-50 flex items-center gap-2"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          Test connection
        </button>
      </div>

      {test && (
        <div className={`p-3 rounded-lg border text-xs ${
          test.ok
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
        }`}>
          {test.ok ? (
            <>
              <div className="flex items-center gap-2 font-semibold mb-1">
                <CheckCircle2 size={14} /> Connected · {test.version}
              </div>
              {test.tables?.length > 0 && (
                <div className="font-mono text-[11px] opacity-80">
                  {test.tables.length} tables: {test.tables.slice(0, 8).join(', ')}{test.tables.length > 8 ? '…' : ''}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5" />
              <span>{test.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Query */}
      <Field label="Query" hint="Only SELECT statements allowed. Auto-wrapped with LIMIT 200,000 if no LIMIT specified.">
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          rows={5}
          className={inputCls + ' font-mono text-[12px] leading-relaxed resize-y'}
        />
      </Field>

      <button
        onClick={handleImport}
        disabled={importing || !test?.ok || !query.trim()}
        className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
        {importing ? 'Importing…' : 'Run query & import as dataset'}
      </button>
    </div>
  );
}

// ─── API TAB ─────────────────────────────────────────────────────────────────

function ApiTab({ onCreated }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState({
    url: '',
    method: 'GET',
    auth: { type: 'none' },
    jsonPath: '',
    pageParam: '',
  });
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const setAuthField = (k, v) => setConfig(c => ({ ...c, auth: { ...c.auth, [k]: v } }));

  const handleTest = async () => {
    setBusy(true); setTest(null);
    try {
      const r = await api.testApiEndpoint(config);
      setTest(r);
      if (r.ok) toast.success('Endpoint reachable');
      else toast.error('Endpoint failed');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const r = await api.importFromApi(config);
      toast.success(`Imported ${r.rowCount.toLocaleString()} rows from ${r.pagesFetched} page(s)`);
      if (r.capped) toast(`Capped at 50K rows`, { icon: '⚠️' });
      if (onCreated) onCreated(
        { id: r.datasetId, fileName: r.fileName, rowCount: r.rowCount, columnCount: r.columnCount },
        r.analysis,
      );
      navigate('/analysis');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  };

  return (
    <div className="space-y-4">
      <Field label="URL">
        <input
          value={config.url}
          onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          placeholder="https://api.example.com/v1/users"
          className={inputCls + ' font-mono text-[12px]'}
        />
      </Field>

      <Field label="Authentication">
        <select
          value={config.auth.type}
          onChange={e => setConfig(c => ({ ...c, auth: { type: e.target.value } }))}
          className={inputCls}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth (user/pass)</option>
          <option value="header">Custom header</option>
          <option value="query">Query parameter</option>
        </select>
      </Field>

      {config.auth.type === 'bearer' && (
        <Field label="Token">
          <input
            type="password"
            value={config.auth.token || ''}
            onChange={e => setAuthField('token', e.target.value)}
            placeholder="sk_..."
            className={inputCls + ' font-mono text-[12px]'}
          />
        </Field>
      )}
      {config.auth.type === 'basic' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username"><input value={config.auth.username || ''} onChange={e => setAuthField('username', e.target.value)} className={inputCls} /></Field>
          <Field label="Password"><input type="password" value={config.auth.password || ''} onChange={e => setAuthField('password', e.target.value)} className={inputCls} /></Field>
        </div>
      )}
      {config.auth.type === 'header' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Header name"><input value={config.auth.headerName || ''} onChange={e => setAuthField('headerName', e.target.value)} placeholder="X-API-Key" className={inputCls} /></Field>
          <Field label="Header value"><input type="password" value={config.auth.headerValue || ''} onChange={e => setAuthField('headerValue', e.target.value)} className={inputCls} /></Field>
        </div>
      )}
      {config.auth.type === 'query' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Param name"><input value={config.auth.paramName || ''} onChange={e => setAuthField('paramName', e.target.value)} placeholder="api_key" className={inputCls} /></Field>
          <Field label="Param value"><input type="password" value={config.auth.paramValue || ''} onChange={e => setAuthField('paramValue', e.target.value)} className={inputCls} /></Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="JSON path" hint="If response wraps data, e.g. data.users">
          <input
            value={config.jsonPath}
            onChange={e => setConfig(c => ({ ...c, jsonPath: e.target.value }))}
            placeholder="data"
            className={inputCls + ' font-mono text-[12px]'}
          />
        </Field>
        <Field label="Page param" hint="Optional pagination param name">
          <input
            value={config.pageParam}
            onChange={e => setConfig(c => ({ ...c, pageParam: e.target.value }))}
            placeholder="page"
            className={inputCls + ' font-mono text-[12px]'}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={busy || !config.url}
          className="px-4 py-2 rounded-lg bg-wiz-bg border border-wiz-border/40 text-sm hover:border-wiz-accent/40 disabled:opacity-50 flex items-center gap-2"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          Test endpoint
        </button>
      </div>

      {test && (
        <div className={`p-3 rounded-lg border text-xs ${
          test.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
        }`}>
          {test.ok ? (
            <>
              <div className="flex items-center gap-2 font-semibold mb-1">
                <CheckCircle2 size={14} /> {test.status} OK · {test.shape}
              </div>
              {test.sample?.length > 0 && (
                <pre className="font-mono text-[10px] opacity-80 max-h-32 overflow-auto bg-wiz-bg/40 p-2 rounded mt-1">
                  {JSON.stringify(test.sample, null, 2)}
                </pre>
              )}
            </>
          ) : (
            <div className="flex items-start gap-2"><AlertCircle size={14} className="mt-0.5" /><span>{test.error}</span></div>
          )}
        </div>
      )}

      <button
        onClick={handleImport}
        disabled={importing || !test?.ok}
        className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {importing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
        {importing ? 'Fetching…' : 'Fetch & import as dataset'}
      </button>
    </div>
  );
}

// ─── UNION TAB ───────────────────────────────────────────────────────────────

function UnionTab({ onCreated }) {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [mode, setMode] = useState('union');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listDatasets?.().then(setDatasets).catch(() => setDatasets([])); }, []);

  const toggle = (id) => setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const handleRun = async () => {
    if (selectedIds.length < 2) return toast.error('Select at least 2 datasets');
    setBusy(true);
    try {
      const r = await api.unionDatasets(selectedIds, mode);
      toast.success(`Unioned ${selectedIds.length} datasets → ${r.rowCount.toLocaleString()} rows`);
      if (onCreated) onCreated(
        { id: r.datasetId, fileName: r.fileName, rowCount: r.rowCount, columnCount: r.columnCount },
        r.analysis,
      );
      navigate('/analysis');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <DatasetPicker datasets={datasets} selectedIds={selectedIds} onToggle={toggle} multi />

      <Field label="Mode">
        <div className="grid grid-cols-3 gap-2">
          {[
            { id: 'union', label: 'Union (all columns)', desc: 'Missing values become null' },
            { id: 'intersect', label: 'Intersect', desc: 'Only shared columns' },
            { id: 'strict', label: 'Strict', desc: 'Columns must match exactly' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`p-3 rounded-lg border text-left ${
                mode === m.id ? 'bg-wiz-accent/15 border-wiz-accent/40' : 'bg-wiz-bg/40 border-wiz-border/30 hover:border-wiz-border/50'
              }`}
            >
              <div className="text-xs font-semibold text-wiz-text">{m.label}</div>
              <div className="text-[10px] font-mono text-wiz-muted mt-0.5">{m.desc}</div>
            </button>
          ))}
        </div>
      </Field>

      <button
        onClick={handleRun}
        disabled={busy || selectedIds.length < 2}
        className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
        Union {selectedIds.length || 0} datasets
      </button>
    </div>
  );
}

// ─── JOIN TAB ────────────────────────────────────────────────────────────────

function JoinTab({ onCreated }) {
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState([]);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [leftKey, setLeftKey] = useState('');
  const [rightKey, setRightKey] = useState('');
  const [type, setType] = useState('inner');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listDatasets?.().then(setDatasets).catch(() => setDatasets([])); }, []);

  const leftDs = datasets.find(d => d.id === leftId);
  const rightDs = datasets.find(d => d.id === rightId);
  const leftCols = leftDs?.analysis?.columns?.map(c => c.name) || [];
  const rightCols = rightDs?.analysis?.columns?.map(c => c.name) || [];

  const handleRun = async () => {
    if (!leftId || !rightId || !leftKey || !rightKey) return toast.error('Pick datasets and keys');
    setBusy(true);
    try {
      const r = await api.joinDatasets({ leftDatasetId: leftId, rightDatasetId: rightId, leftKey, rightKey, type });
      toast.success(`Joined → ${r.rowCount.toLocaleString()} rows`);
      if (onCreated) onCreated(
        { id: r.datasetId, fileName: r.fileName, rowCount: r.rowCount, columnCount: r.columnCount },
        r.analysis,
      );
      navigate('/analysis');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Left dataset">
          <select value={leftId} onChange={e => { setLeftId(e.target.value); setLeftKey(''); }} className={inputCls}>
            <option value="">— Choose —</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.fileName}</option>)}
          </select>
        </Field>
        <Field label="Right dataset">
          <select value={rightId} onChange={e => { setRightId(e.target.value); setRightKey(''); }} className={inputCls}>
            <option value="">— Choose —</option>
            {datasets.map(d => <option key={d.id} value={d.id}>{d.fileName}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Left key">
          <select value={leftKey} onChange={e => setLeftKey(e.target.value)} disabled={!leftId} className={inputCls}>
            <option value="">— Choose column —</option>
            {leftCols.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Right key">
          <select value={rightKey} onChange={e => setRightKey(e.target.value)} disabled={!rightId} className={inputCls}>
            <option value="">— Choose column —</option>
            {rightCols.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Join type">
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: 'inner', label: 'Inner', desc: 'Matched only' },
            { id: 'left', label: 'Left', desc: 'All left + matches' },
            { id: 'right', label: 'Right', desc: 'All right + matches' },
            { id: 'full', label: 'Full', desc: 'Everything' },
          ].map(j => (
            <button
              key={j.id}
              onClick={() => setType(j.id)}
              className={`p-2 rounded-lg border text-center ${
                type === j.id ? 'bg-wiz-accent/15 border-wiz-accent/40' : 'bg-wiz-bg/40 border-wiz-border/30'
              }`}
            >
              <div className="text-xs font-semibold capitalize">{j.label}</div>
              <div className="text-[9px] font-mono text-wiz-muted mt-0.5">{j.desc}</div>
            </button>
          ))}
        </div>
      </Field>

      <button
        onClick={handleRun}
        disabled={busy || !leftId || !rightId || !leftKey || !rightKey}
        className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
        Run {type} join
      </button>
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text placeholder-wiz-muted/50 focus:outline-none focus:border-wiz-accent/50';

function Field({ label, hint, colSpan, children }) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <label className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted block mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-wiz-muted/70 mt-1 italic">{hint}</div>}
    </div>
  );
}

function DatasetPicker({ datasets, selectedIds, onToggle, multi }) {
  if (!datasets.length) {
    return (
      <div className="p-4 rounded-lg bg-wiz-bg/40 border border-wiz-border/30 text-center">
        <FileWarning size={20} className="mx-auto mb-2 text-wiz-muted" />
        <p className="text-xs text-wiz-muted">No datasets uploaded yet. Upload at least 2 datasets first.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted block mb-1.5">
        Select datasets {multi ? '(2+)' : ''}
      </label>
      <div className="max-h-48 overflow-y-auto rounded-lg bg-wiz-bg/40 border border-wiz-border/30 divide-y divide-wiz-border/20">
        {datasets.map(d => (
          <label key={d.id} className="flex items-center gap-3 px-3 py-2 hover:bg-wiz-bg/40 cursor-pointer">
            <input
              type={multi ? 'checkbox' : 'radio'}
              checked={selectedIds.includes(d.id)}
              onChange={() => onToggle(d.id)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-wiz-text truncate">{d.fileName}</div>
              <div className="text-[10px] font-mono text-wiz-muted">{d.rowCount?.toLocaleString() || '?'} rows · {d.columnCount || '?'} cols</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function CapabilitiesNote({ caps }) {
  const missingDrivers = Object.entries(caps.sql || {}).filter(([_, ok]) => !ok).map(([k]) => k);
  return (
    <div className="mt-6 p-4 rounded-xl bg-wiz-surface/40 border border-wiz-border/30 text-xs">
      <div className="flex items-center gap-2 text-wiz-muted font-mono uppercase tracking-wider text-[10px] mb-2">
        <Info size={12} /> Capabilities
      </div>
      <div className="grid md:grid-cols-2 gap-2 text-wiz-muted">
        <div>
          <strong className="text-wiz-text">Installed drivers: </strong>
          {Object.entries(caps.sql || {}).filter(([_, ok]) => ok).map(([k]) => k).join(', ') || 'none'}
        </div>
        <div>
          <strong className="text-wiz-text">File formats: </strong>
          {(caps.fileFormats || []).join(' · ')}
        </div>
      </div>
      {missingDrivers.length > 0 && (
        <div className="mt-2 text-amber-300/80">
          Run <code className="font-mono px-1 bg-wiz-bg rounded">npm install</code> to enable: {missingDrivers.join(', ')}
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-wiz-muted hover:text-wiz-text">Not supported (and why)</summary>
        <div className="mt-2 space-y-1 pl-2 text-[11px]">
          {Object.entries(caps.notSupported || {}).map(([k, v]) => (
            <div key={k}><strong className="text-wiz-text capitalize">{k}: </strong>{v}</div>
          ))}
        </div>
      </details>
    </div>
  );
}
