import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart3, KeyRound, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import * as api from '../utils/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) return toast.error('Missing reset token');
    if (password.length < 8) return toast.error('Password must be at least 8 characters');
    if (password !== confirm) return toast.error('Passwords don\'t match');
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mesh-bg noise min-h-screen flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-wiz-accent to-wiz-emerald flex items-center justify-center shadow-xl shadow-wiz-accent/25 mb-3">
            <BarChart3 size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-wiz-text">Data Wiz</h1>
        </div>

        <div className="rounded-2xl bg-wiz-surface/70 backdrop-blur-xl border border-wiz-border/30 p-6 shadow-2xl shadow-black/20">
          <div className="flex items-center gap-2 mb-3">
            <KeyRound className="text-wiz-accent" size={20} />
            <h2 className="text-lg font-display font-semibold text-wiz-text">
              {done ? 'Password reset' : 'Set a new password'}
            </h2>
          </div>

          {done ? (
            <>
              <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
                <CheckCircle2 size={16} /> Your password has been updated.
              </div>
              <p className="text-xs text-wiz-muted mb-4">
                All your existing sessions have been signed out for security. Sign in again with your new password.
              </p>
              <button onClick={() => navigate('/login')}
                className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold flex items-center justify-center gap-2">
                <ArrowRight size={16} /> Sign in
              </button>
            </>
          ) : !token ? (
            <p className="text-sm text-rose-300">
              Invalid reset link. Make sure you used the link from your email exactly.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Field label="New password" hint="At least 8 characters">
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="new-password" />
              </Field>
              <Field label="Confirm password">
                <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} autoComplete="new-password" />
              </Field>
              <button type="submit" disabled={busy}
                className="w-full px-4 py-3 mt-2 rounded-xl bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Reset password
              </button>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text focus:outline-none focus:border-wiz-accent/50';

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted block mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-wiz-muted/70 mt-1 italic">{hint}</div>}
    </div>
  );
}
