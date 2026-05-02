import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Plus, Trash2, Send, ToggleLeft, ToggleRight, Loader2, Calendar, Clock, ArrowLeft, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

const FREQ_LABELS = {
  daily: 'Every day',
  weekly: 'Mondays',
  monday: 'Mondays',
  first_of_month: '1st of month',
};

export default function ReportsPage({ dataset }) {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    Promise.all([
      api.listReports(),
      api.listDashboards(dataset?.id).then(r => r.dashboards || []),
    ]).then(([reps, dashes]) => {
      setReports(reps);
      setDashboards(dashes);
    }).catch(err => {
      toast.error(err.response?.data?.error || 'Failed to load reports');
    }).finally(() => setLoading(false));
  }, [dataset?.id]);

  const handleCreate = async (form) => {
    try {
      const created = await api.createReport(form);
      setReports(prev => [created, ...prev]);
      setShowForm(false);
      toast.success(`Report "${created.name}" scheduled`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Create failed');
    }
  };

  const handleToggle = async (report) => {
    try {
      const updated = await api.updateReport(report.id, { enabled: !report.enabled });
      setReports(prev => prev.map(r => r.id === report.id ? updated : r));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this scheduled report?')) return;
    try {
      await api.deleteReport(id);
      setReports(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleTest = async (id) => {
    const t = toast.loading('Sending test…');
    try {
      const r = await api.testReport(id);
      toast.success(`Sent to ${r.recipients.length} recipient(s)`, { id: t });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Test send failed', { id: t });
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 pt-8 pb-16">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-xs text-wiz-tertiary hover:text-wiz-text mb-3 font-mono">
        <ArrowLeft size={12} /> Back
      </button>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <p className="eyebrow mb-3">Scheduled Reports</p>
        <h1 className="h1 mb-2">
          Get the dashboard <span className="italic text-wiz-accent">in your inbox</span>.
        </h1>
        <p className="text-base text-wiz-text-secondary max-w-2xl">
          Pick a dashboard, pick a cadence, pick recipients. Wiz emails them a digest with the key numbers and a link to the live view.
        </p>
      </motion.div>

      {/* Add button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)} className="btn-primary mb-6">
          <Plus size={14} strokeWidth={2}/> New scheduled report
        </button>
      )}

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 overflow-hidden"
          >
            <CreateReportForm
              dashboards={dashboards}
              onSubmit={handleCreate}
              onCancel={() => setShowForm(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-wiz-accent"/></div>
      ) : reports.length === 0 ? (
        <div className="card p-8 text-center">
          <Mail size={28} strokeWidth={1.25} className="mx-auto mb-3 text-wiz-text-tertiary opacity-60"/>
          <p className="text-sm text-wiz-text-secondary mb-1">No scheduled reports yet.</p>
          <p className="text-xs text-wiz-text-tertiary">Create one to email a dashboard digest on a schedule.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => (
            <ReportCard
              key={r.id}
              report={r}
              onToggle={() => handleToggle(r)}
              onDelete={() => handleDelete(r.id)}
              onTest={() => handleTest(r.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, onToggle, onDelete, onTest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card p-4 ${report.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-base font-display font-semibold text-wiz-text truncate">{report.name}</h3>
            {!report.enabled && (
              <span className="text-2xs text-wiz-text-tertiary uppercase tracking-wider font-mono">paused</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-wiz-text-secondary font-mono mb-2">
            <span className="flex items-center gap-1"><Calendar size={11}/> {FREQ_LABELS[report.frequency] || report.frequency}</span>
            <span className="flex items-center gap-1"><Clock size={11}/> {String(report.hourUtc).padStart(2, '0')}:00 UTC</span>
            <span>{report.recipients.length} recipient{report.recipients.length === 1 ? '' : 's'}</span>
          </div>
          {report.lastSentAt && (
            <p className="text-2xs text-wiz-text-tertiary font-mono">
              Last sent: {new Date(report.lastSentAt).toLocaleString()}
              {report.lastStatus === 'error' && (
                <span className="text-wiz-danger ml-2 inline-flex items-center gap-1">
                  <AlertCircle size={9} strokeWidth={2}/> {report.lastError}
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={onTest} className="btn-ghost text-2xs" title="Send a test now">
            <Send size={11} strokeWidth={1.75}/> Test
          </button>
          <button onClick={onToggle} className="btn-ghost text-2xs" title={report.enabled ? 'Pause' : 'Resume'}>
            {report.enabled
              ? <ToggleRight size={13} strokeWidth={1.75} className="text-wiz-accent"/>
              : <ToggleLeft size={13} strokeWidth={1.75}/>}
          </button>
          <button onClick={onDelete} className="btn-ghost text-2xs text-wiz-text-tertiary hover:text-wiz-danger">
            <Trash2 size={11} strokeWidth={1.75}/>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function CreateReportForm({ dashboards, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    dashboardId: dashboards[0]?.id || '',
    name: '',
    recipients: '',
    frequency: 'weekly',
    hourUtc: 8,
  });

  const submit = (e) => {
    e.preventDefault();
    const recipients = form.recipients.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    if (!recipients.length) {
      toast.error('Add at least one recipient email');
      return;
    }
    onSubmit({
      dashboardId: form.dashboardId,
      name: form.name || `${dashboards.find(d => d.id === form.dashboardId)?.name || 'Dashboard'} digest`,
      recipients,
      frequency: form.frequency,
      hourUtc: parseInt(form.hourUtc),
    });
  };

  if (!dashboards.length) {
    return (
      <div className="card p-6 text-center">
        <Mail size={20} strokeWidth={1.5} className="mx-auto mb-3 text-wiz-text-tertiary opacity-60"/>
        <p className="text-sm text-wiz-text-secondary mb-1">You need a dashboard first.</p>
        <p className="text-xs text-wiz-text-tertiary mb-4">A scheduled report sends a digest of one dashboard. Build one to schedule it.</p>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="btn-secondary text-xs"
        >
          Go build a dashboard
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-3">
      <div>
        <label className="eyebrow block mb-1.5">Dashboard</label>
        <select
          value={form.dashboardId}
          onChange={(e) => setForm({ ...form, dashboardId: e.target.value })}
          className="input"
        >
          {dashboards.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div>
        <label className="eyebrow block mb-1.5">Report name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Weekly sales digest"
          className="input"
          maxLength={100}
        />
      </div>

      <div>
        <label className="eyebrow block mb-1.5">Recipients</label>
        <textarea
          value={form.recipients}
          onChange={(e) => setForm({ ...form, recipients: e.target.value })}
          placeholder="alice@example.com, bob@example.com"
          rows={2}
          className="input resize-none"
        />
        <p className="text-2xs text-wiz-text-tertiary mt-1">Separate multiple emails with commas, spaces, or new lines.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="eyebrow block mb-1.5">Frequency</label>
          <select
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            className="input"
          >
            <option value="daily">Every day</option>
            <option value="weekly">Mondays</option>
            <option value="first_of_month">1st of month</option>
          </select>
        </div>
        <div>
          <label className="eyebrow block mb-1.5">Hour (UTC)</label>
          <input
            type="number"
            min={0} max={23}
            value={form.hourUtc}
            onChange={(e) => setForm({ ...form, hourUtc: e.target.value })}
            className="input"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button type="submit" className="btn-primary">
          <Plus size={14} strokeWidth={2}/> Create
        </button>
      </div>
    </form>
  );
}
