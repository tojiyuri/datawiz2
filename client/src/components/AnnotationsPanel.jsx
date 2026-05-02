import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, Trash2, Loader2, X, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import * as api from '../utils/api';

/**
 * AnnotationsPanel — list, create, delete annotations for a sheet.
 *
 * Click "Add" to enter a draft mode where the user fills in text + clicks
 * the chart to drop the pin. The chart click handler is wired via the
 * parent — when the user clicks somewhere, the parent passes us the
 * (xValue, yValue, seriesKey) it received from recharts.
 *
 * This component receives:
 *   - sheetId: the sheet to load annotations for
 *   - draftPosition: when the user is mid-drop, the position they clicked
 *                    (set by parent on chart-click while creating is true)
 *   - onCreatingChange: parent listens for "is the user currently dropping?"
 *                       so it can put the chart in draft-pin-mode
 */
export default function AnnotationsPanel({
  sheetId, currentUserId,
  draftPosition, onCreatingChange,
}) {
  const [annotations, setAnnotations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sheetId) return;
    setLoading(true);
    api.listAnnotations(sheetId)
      .then(setAnnotations)
      .catch(err => {
        // 404 means the sheet was just created and has no annotations yet — that's fine
        if (err.response?.status !== 404) {
          toast.error(err.response?.data?.error || 'Failed to load annotations');
        }
        setAnnotations([]);
      })
      .finally(() => setLoading(false));
  }, [sheetId]);

  // Tell the parent when we enter/leave draft mode
  useEffect(() => {
    if (onCreatingChange) onCreatingChange(creating);
  }, [creating, onCreatingChange]);

  const startCreating = () => {
    setCreating(true);
    setDraftText('');
  };

  const cancelCreating = () => {
    setCreating(false);
    setDraftText('');
  };

  const handleSubmit = async () => {
    if (!draftText.trim()) {
      toast.error('Add some text first');
      return;
    }
    if (!draftPosition) {
      toast.error('Click a point on the chart to position this annotation');
      return;
    }
    setSubmitting(true);
    try {
      const created = await api.createAnnotation({
        sheetId,
        text: draftText.trim(),
        xValue: draftPosition.xValue,
        yValue: draftPosition.yValue,
        seriesKey: draftPosition.seriesKey,
      });
      setAnnotations(prev => [...prev, created]);
      setCreating(false);
      setDraftText('');
      toast.success('Annotation added');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create annotation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteAnnotation(id);
      setAnnotations(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow flex items-center gap-1.5">
          <MapPin size={11} strokeWidth={1.75}/>
          Annotations
          {annotations.length > 0 && (
            <span className="text-2xs text-wiz-text-tertiary font-mono">{annotations.length}</span>
          )}
        </p>
        {!creating && (
          <button onClick={startCreating} className="btn-ghost text-2xs">
            <MessageSquarePlus size={11} strokeWidth={1.75}/> Add
          </button>
        )}
      </div>

      {/* Draft (creating new) */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-3 p-2.5 rounded-md bg-wiz-accent-soft border border-wiz-accent/30 overflow-hidden"
          >
            <p className="text-xs text-wiz-text-secondary mb-2">
              {draftPosition
                ? `Pinned at ${draftPosition.xValue}${draftPosition.yValue != null ? ` · ${draftPosition.yValue}` : ''}`
                : 'Click a point on the chart to drop a pin →'}
            </p>
            <textarea
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="What happened here?"
              maxLength={1000}
              rows={2}
              className="w-full px-2 py-1.5 rounded bg-wiz-bg/60 text-xs text-wiz-text border border-wiz-border focus:border-wiz-accent focus:outline-none resize-none"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-2xs text-wiz-tertiary font-mono">{draftText.length}/1000</span>
              <div className="flex gap-1.5">
                <button onClick={cancelCreating} className="btn-ghost text-2xs">
                  <X size={11} strokeWidth={1.75}/> Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !draftText.trim() || !draftPosition}
                  className="btn-primary text-2xs disabled:opacity-50"
                >
                  {submitting ? <Loader2 size={11} className="animate-spin"/> : 'Save'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 size={14} className="animate-spin text-wiz-text-tertiary"/>
        </div>
      ) : annotations.length === 0 && !creating ? (
        <p className="text-xs text-wiz-text-tertiary italic text-center py-3">
          No annotations yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {annotations.map((a) => (
            <AnnotationItem
              key={a.id}
              annotation={a}
              isOwner={a.ownerId === currentUserId}
              onDelete={() => handleDelete(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotationItem({ annotation, isOwner, onDelete }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="group p-2.5 rounded-md bg-wiz-surface border border-wiz-border hover:border-wiz-border-strong"
    >
      <div className="flex items-start gap-2">
        <MapPin size={11} strokeWidth={2} className="text-wiz-accent mt-0.5 shrink-0"/>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-wiz-text leading-snug">{annotation.text}</p>
          <p className="text-2xs text-wiz-text-tertiary font-mono mt-1">
            {annotation.xValue}
            {annotation.yValue != null && <span className="opacity-60"> · {annotation.yValue}</span>}
            {annotation.seriesKey && <span className="opacity-60"> · {annotation.seriesKey}</span>}
            <span className="ml-2 opacity-50">{relativeTime(annotation.createdAt)}</span>
          </p>
        </div>
        {isOwner && (
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1 text-wiz-text-tertiary hover:text-wiz-danger"
            title="Delete annotation"
          >
            <Trash2 size={11} strokeWidth={1.75}/>
          </button>
        )}
      </div>
    </motion.div>
  );
}

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return new Date(iso).toLocaleDateString();
}
