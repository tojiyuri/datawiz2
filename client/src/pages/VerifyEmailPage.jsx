import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';
import * as api from '../utils/api';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [state, setState] = useState('verifying'); // verifying | done | error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setState('error'); setError('No token in link'); return; }
    let cancelled = false;
    api.confirmEmailVerification(token)
      .then(() => { if (!cancelled) setState('done'); })
      .catch((err) => {
        if (cancelled) return;
        setState('error');
        setError(err.response?.data?.error || 'Verification failed');
      });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="mesh-bg noise min-h-screen flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-wiz-accent to-wiz-emerald flex items-center justify-center shadow-xl shadow-wiz-accent/25 mb-3">
            <BarChart3 size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-wiz-text">Data Wiz</h1>
        </div>

        <div className="rounded-2xl bg-wiz-surface/70 backdrop-blur-xl border border-wiz-border/30 p-6 text-center">
          {state === 'verifying' && (
            <>
              <Loader2 size={32} className="animate-spin text-wiz-accent mx-auto mb-3" />
              <p className="text-sm text-wiz-text">Verifying your email…</p>
            </>
          )}
          {state === 'done' && (
            <>
              <CheckCircle2 size={40} className="text-emerald-400 mx-auto mb-3" />
              <h2 className="text-lg font-display font-semibold text-wiz-text mb-1">Email verified</h2>
              <p className="text-xs text-wiz-muted mb-5">Your email is now verified. Welcome to Data Wiz.</p>
              <button onClick={() => navigate('/')}
                className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold flex items-center justify-center gap-2">
                <ArrowRight size={16} /> Continue
              </button>
            </>
          )}
          {state === 'error' && (
            <>
              <XCircle size={40} className="text-rose-400 mx-auto mb-3" />
              <h2 className="text-lg font-display font-semibold text-wiz-text mb-1">Verification failed</h2>
              <p className="text-xs text-wiz-muted mb-5">{error}</p>
              <button onClick={() => navigate('/')}
                className="w-full px-4 py-2 rounded-xl border border-wiz-border/40 text-wiz-text">
                Back to app
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
