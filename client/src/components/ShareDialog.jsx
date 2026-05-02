import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, UserPlus, Link2, Trash2, Copy, Check, Loader2, Globe, Lock } from 'lucide-react';
import * as api from '../utils/api';

/**
 * Reusable share dialog. Pass:
 *   - resourceType: 'sheet' | 'dashboard'
 *   - resourceId: the ID
 *   - resourceName: display name for context
 *   - open / onClose
 */
export default function ShareDialog({ resourceType, resourceId, resourceName, open, onClose }) {
  const [shares, setShares] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);

  // Share form
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('view');
  const [submitting, setSubmitting] = useState(false);

  // New link state
  const [creatingLink, setCreatingLink] = useState(false);
  const [newLink, setNewLink] = useState(null); // { id, token, url }

  const refresh = async () => {
    if (!resourceId) return;
    setLoading(true);
    try {
      const sharesRes = resourceType === 'sheet'
        ? await api.listSheetShares(resourceId)
        : await api.listDashboardShares(resourceId);
      setShares(sharesRes.users || []);
      // Links are a separate endpoint — best-effort
      // (the API returns them but for v6.7 we'll fetch on demand)
    } catch (err) {
      // 403 here means we're not the owner — that's expected for shared-with-me views
      setShares([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) refresh(); }, [open, resourceId]);

  const handleShare = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Email required');
    setSubmitting(true);
    try {
      if (resourceType === 'sheet') {
        await api.shareSheetWithUser(resourceId, email.trim(), role);
      } else {
        await api.shareDashboardWithUser(resourceId, email.trim(), role);
      }
      toast.success(`Shared with ${email}`);
      setEmail('');
      refresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Share failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (userId) => {
    try {
      if (resourceType === 'sheet') {
        await api.revokeSheetShare(resourceId, userId);
      } else {
        await api.revokeDashboardShare(resourceId, userId);
      }
      toast.success('Access removed');
      refresh();
    } catch (err) {
      toast.error('Failed to revoke');
    }
  };

  const handleCreateLink = async () => {
    setCreatingLink(true);
    try {
      const r = resourceType === 'sheet'
        ? await api.createSheetShareLink(resourceId)
        : await api.createDashboardShareLink(resourceId);
      const url = `${window.location.origin}/share/${r.token}`;
      setNewLink({ ...r, url });
      navigator.clipboard?.writeText(url).catch(() => {});
      toast.success('Link copied to clipboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create link');
    } finally {
      setCreatingLink(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-wiz-surface border border-wiz-border/40 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-wiz-border/30">
              <div>
                <h2 className="text-base font-display font-semibold text-wiz-text">
                  Share {resourceType}
                </h2>
                {resourceName && <p className="text-xs text-wiz-muted mt-0.5 truncate">{resourceName}</p>}
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-wiz-bg/60 text-wiz-muted">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
              {/* Add by email */}
              <section>
                <h3 className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted mb-2 flex items-center gap-1.5">
                  <UserPlus size={12} /> Share with someone
                </h3>
                <form onSubmit={handleShare} className="flex gap-2">
                  <input type="email" required placeholder="email@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text" />
                  <select value={role} onChange={(e) => setRole(e.target.value)}
                    className="px-2 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text">
                    <option value="view">View</option>
                    <option value="edit">Edit</option>
                  </select>
                  <button type="submit" disabled={submitting}
                    className="px-3 py-2 rounded-lg bg-wiz-accent text-white text-sm font-semibold disabled:opacity-50">
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : 'Share'}
                  </button>
                </form>
              </section>

              {/* Existing shares */}
              {loading ? (
                <Loader2 className="animate-spin text-wiz-muted mx-auto" size={16} />
              ) : shares.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted mb-2">People with access</h3>
                  <div className="space-y-1.5">
                    {shares.map((s) => (
                      <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg bg-wiz-bg/40 border border-wiz-border/20">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-wiz-text truncate">{s.name || s.email}</p>
                          <p className="text-[10px] text-wiz-muted truncate">{s.email}</p>
                        </div>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-wiz-bg/60 text-wiz-muted">
                          {s.role}
                        </span>
                        <button onClick={() => handleRevoke(s.userId)}
                          className="ml-2 p-1.5 rounded-lg text-wiz-muted hover:text-rose-400 hover:bg-rose-500/10">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Public link */}
              <section>
                <h3 className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted mb-2 flex items-center gap-1.5">
                  <Globe size={12} /> Anyone with the link
                </h3>
                {newLink ? (
                  <div className="p-3 rounded-lg bg-wiz-bg/40 border border-wiz-border/20">
                    <p className="text-[10px] text-amber-300 mb-2">⚠️ Save this link now — it won't be shown again.</p>
                    <div className="flex gap-1">
                      <input readOnly value={newLink.url}
                        className="flex-1 px-2 py-1.5 rounded text-[11px] font-mono bg-wiz-bg/60 border border-wiz-border/30 text-wiz-text" />
                      <button onClick={() => { navigator.clipboard?.writeText(newLink.url); toast.success('Copied'); }}
                        className="px-2 py-1.5 rounded bg-wiz-accent/20 text-wiz-accent">
                        <Copy size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={handleCreateLink} disabled={creatingLink}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-wiz-border/40 text-sm text-wiz-text hover:bg-wiz-bg/40 disabled:opacity-50">
                    {creatingLink ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                    Create public view link
                  </button>
                )}
              </section>

              <p className="text-[10px] text-wiz-muted/60 italic flex items-center gap-1">
                <Lock size={10} /> Only owners can share. Editors can modify but not re-share.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
