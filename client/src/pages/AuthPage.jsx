import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BarChart3, Eye, EyeOff, Loader2, ArrowRight, Sparkles, Shield, KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../utils/api';

export default function AuthPage({ mode = 'login' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, completeTwoFactor, signup, needsSetup, user, loading: authLoading } = useAuth();

  const effectiveMode = needsSetup ? 'signup' : mode;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  // 2FA state
  const [pendingToken, setPendingToken] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);

  // Forgot-password state
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Status — for showing Google OAuth button
  const [status, setStatus] = useState(null);
  useEffect(() => { api.getAuthStatus().then(setStatus).catch(() => {}); }, []);

  useEffect(() => {
    if (!authLoading && user) {
      const dest = location.state?.from || '/';
      navigate(dest, { replace: true });
    }
  }, [user, authLoading, navigate, location.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error('Email and password are required');
    if (effectiveMode === 'signup' && password.length < 8) {
      return toast.error('Password must be at least 8 characters');
    }
    setBusy(true);
    try {
      if (effectiveMode === 'signup') {
        await signup(email.trim(), password, name.trim() || null);
        toast.success(needsSetup ? 'Welcome! You are the admin.' : 'Account created');
      } else {
        const r = await login(email.trim(), password);
        if (r.twoFactorRequired) {
          setPendingToken(r.pendingToken);
        } else {
          toast.success('Welcome back');
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Auth failed');
    } finally {
      setBusy(false);
    }
  };

  const handleTwoFactorSubmit = async (e) => {
    e.preventDefault();
    if (!twoFactorCode) return toast.error('Enter your code');
    setBusy(true);
    try {
      if (useBackupCode) {
        await completeTwoFactor(pendingToken, null, twoFactorCode.trim());
      } else {
        await completeTwoFactor(pendingToken, twoFactorCode.trim());
      }
      toast.success('Welcome back');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!email) return toast.error('Enter your email');
    setBusy(true);
    try {
      await api.requestPasswordReset(email.trim());
      setForgotSent(true);
    } catch (err) {
      // Backend always returns 200 to prevent enumeration. If we hit this, it's a 5xx.
      toast.error('Could not send. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-wiz-accent" size={32} />
      </div>
    );
  }

  // ─── 2FA second step ─────────────────────────────────────────────────────
  if (pendingToken) {
    return (
      <Shell>
        <div className="rounded-2xl bg-wiz-surface/70 backdrop-blur-xl border border-wiz-border/30 p-6 shadow-2xl shadow-black/20">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="text-wiz-accent" size={20} />
            <h2 className="text-lg font-display font-semibold text-wiz-text">Two-factor authentication</h2>
          </div>
          <p className="text-xs text-wiz-muted mb-5">
            {useBackupCode ? 'Enter one of your backup codes.' : 'Open your authenticator app and enter the 6-digit code.'}
          </p>

          <form onSubmit={handleTwoFactorSubmit} className="space-y-3">
            <input
              type="text"
              required
              autoFocus
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              placeholder={useBackupCode ? 'abcd-efgh' : '000000'}
              className={inputCls + ' font-mono text-center text-lg tracking-[0.3em]'}
              maxLength={useBackupCode ? 9 : 6}
              inputMode={useBackupCode ? 'text' : 'numeric'}
            />

            <button type="submit" disabled={busy}
              className="w-full px-4 py-3 mt-2 rounded-xl bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              Verify
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-wiz-border/30 text-center space-y-1.5">
            <button onClick={() => { setUseBackupCode(b => !b); setTwoFactorCode(''); }}
              className="text-xs text-wiz-accent hover:underline block w-full">
              {useBackupCode ? 'Use authenticator code instead' : 'Use a backup code instead'}
            </button>
            <button onClick={() => { setPendingToken(null); setTwoFactorCode(''); }}
              className="text-xs text-wiz-muted hover:text-wiz-text block w-full">
              Cancel and start over
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  // ─── Forgot password flow ────────────────────────────────────────────────
  if (forgotMode) {
    return (
      <Shell>
        <div className="rounded-2xl bg-wiz-surface/70 backdrop-blur-xl border border-wiz-border/30 p-6">
          <div className="flex items-center gap-2 mb-2">
            <KeyRound className="text-wiz-accent" size={20} />
            <h2 className="text-lg font-display font-semibold text-wiz-text">Reset your password</h2>
          </div>
          {forgotSent ? (
            <>
              <p className="text-sm text-wiz-text mb-2">Check your email.</p>
              <p className="text-xs text-wiz-muted mb-5">
                If an account exists for <strong>{email}</strong>, we've sent a reset link.
                The link expires in 1 hour.
              </p>
              <p className="text-[11px] text-wiz-muted/70 italic mb-5">
                Dev tip: if EMAIL_PROVIDER=console, check your server console for the link.
              </p>
              <button onClick={() => { setForgotMode(false); setForgotSent(false); }}
                className="w-full px-4 py-2 rounded-xl border border-wiz-border/40 text-wiz-text hover:bg-wiz-bg/50">
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-wiz-muted mb-5">
                Enter your account email and we'll send a reset link.
              </p>
              <form onSubmit={handleForgotSubmit} className="space-y-3">
                <Field label="Email">
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
                </Field>
                <button type="submit" disabled={busy}
                  className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  Send reset link
                </button>
                <button type="button" onClick={() => setForgotMode(false)}
                  className="w-full text-xs text-wiz-muted hover:text-wiz-text">
                  Back to sign in
                </button>
              </form>
            </>
          )}
        </div>
      </Shell>
    );
  }

  // ─── Standard login/signup ──────────────────────────────────────────────
  return (
    <Shell>
      {needsSetup && (
        <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-wiz-accent/10 to-wiz-emerald/10 border border-wiz-accent/30">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} className="text-wiz-accent" />
            <span className="text-xs font-bold text-wiz-text">First-run setup</span>
          </div>
          <p className="text-[11px] text-wiz-muted">
            No users exist yet. The first account becomes the admin.
          </p>
        </div>
      )}

      <div className="rounded-2xl bg-wiz-surface/70 backdrop-blur-xl border border-wiz-border/30 p-6 shadow-2xl shadow-black/20">
        <h2 className="text-lg font-display font-semibold text-wiz-text mb-1">
          {effectiveMode === 'signup' ? 'Create your account' : 'Welcome back'}
        </h2>
        <p className="text-xs text-wiz-muted mb-5">
          {effectiveMode === 'signup'
            ? 'Set up an admin account to get started.'
            : 'Sign in to access your sheets and dashboards.'}
        </p>

        {/* Google OAuth button — only if configured */}
        {status?.googleOAuthEnabled && (
          <>
            <button
              type="button"
              onClick={() => { window.location.href = '/api/oauth/google/start'; }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-wiz-bg/40 border border-wiz-border/40 text-sm text-wiz-text hover:border-wiz-border/70 mb-3"
            >
              <GoogleIcon /> Continue with Google
            </button>
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-wiz-border/30" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted">or</span>
              <div className="flex-1 h-px bg-wiz-border/30" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {effectiveMode === 'signup' && (
            <Field label="Name (optional)">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className={inputCls} />
            </Field>
          )}

          <Field label="Email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className={inputCls} />
          </Field>

          <Field label="Password" hint={effectiveMode === 'signup' ? 'At least 8 characters' : null}>
            <div className="relative">
              <input type={showPwd ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={effectiveMode === 'signup' ? 'new-password' : 'current-password'} className={inputCls + ' pr-9'} />
              <button type="button" onClick={() => setShowPwd((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-wiz-muted hover:text-wiz-text" tabIndex={-1}>
                {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          {effectiveMode === 'login' && (
            <div className="text-right">
              <button type="button" onClick={() => setForgotMode(true)} className="text-[11px] text-wiz-accent hover:underline">
                Forgot password?
              </button>
            </div>
          )}

          <button type="submit" disabled={busy}
            className="w-full px-4 py-3 mt-2 rounded-xl bg-gradient-to-r from-wiz-accent to-wiz-accent-deep text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-wiz-accent/20 hover:shadow-wiz-accent/40 transition-shadow">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {effectiveMode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {!needsSetup && (
          <div className="mt-5 pt-4 border-t border-wiz-border/30 text-center">
            <span className="text-xs text-wiz-muted">
              {effectiveMode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            </span>
            <button onClick={() => navigate(effectiveMode === 'signup' ? '/login' : '/signup')} className="text-xs font-semibold text-wiz-accent hover:underline">
              {effectiveMode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-[10px] text-wiz-muted/60 font-mono">
        🔒 httpOnly cookies · bcrypt(12) · 2FA · brute-force lockout
      </p>
    </Shell>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text placeholder-wiz-muted/50 focus:outline-none focus:border-wiz-accent/50';

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-wiz-muted block mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[10px] text-wiz-muted/70 mt-1 italic">{hint}</div>}
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="mesh-bg noise min-h-screen flex items-center justify-center px-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-wiz-accent to-wiz-emerald flex items-center justify-center shadow-xl shadow-wiz-accent/25 mb-3">
            <BarChart3 size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-display font-bold text-wiz-text">Data Wiz</h1>
          <p className="text-[10px] text-wiz-muted font-mono tracking-[0.2em] uppercase mt-1">v6.7 · Production</p>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.997 10.997 0 0012 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.997 10.997 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
