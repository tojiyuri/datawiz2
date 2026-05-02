import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Shield, Loader2, Copy, Check, Download, KeyRound, LogOut, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../utils/api';

export default function SettingsPage() {
  const { user, logout } = useAuth();

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-display font-bold text-wiz-text mb-1">Account settings</h1>
      <p className="text-sm text-wiz-muted mb-8">{user?.email}</p>

      <div className="space-y-6">
        <TwoFactorSection />
        <PasswordSection />
        <SessionsSection />
      </div>
    </div>
  );
}

// ─── 2FA ──────────────────────────────────────────────────────────────────

function TwoFactorSection() {
  const [enabled, setEnabled] = useState(null);
  const [setupData, setSetupData] = useState(null);     // { qr, otpauth, secret }
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null); // shown ONCE after enable
  const [busy, setBusy] = useState(false);
  const [disablePwd, setDisablePwd] = useState('');
  const [showDisable, setShowDisable] = useState(false);

  useEffect(() => { refresh(); }, []);
  const refresh = async () => {
    try {
      const r = await api.get2FAStatus();
      setEnabled(r.enabled);
    } catch (_) { setEnabled(false); }
  };

  const handleSetup = async () => {
    setBusy(true);
    try {
      const r = await api.setup2FA();
      setSetupData(r);
    } catch (err) { toast.error(err.response?.data?.error || 'Setup failed'); }
    finally { setBusy(false); }
  };

  const handleEnable = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.enable2FA(verifyCode.trim());
      setBackupCodes(r.backupCodes);
      setSetupData(null);
      setEnabled(true);
      toast.success('2FA enabled');
    } catch (err) { toast.error(err.response?.data?.error || 'Invalid code'); }
    finally { setBusy(false); }
  };

  const handleDisable = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.disable2FA(disablePwd);
      setEnabled(false);
      setShowDisable(false);
      setDisablePwd('');
      toast.success('2FA disabled');
    } catch (err) { toast.error(err.response?.data?.error || 'Disable failed'); }
    finally { setBusy(false); }
  };

  const downloadBackupCodes = () => {
    const blob = new Blob([
      'Data Wiz — 2FA backup codes\n',
      'Each code can be used once.\n\n',
      ...backupCodes.map(c => c + '\n'),
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'datawiz-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (enabled === null) return <Section title="Two-factor authentication"><Loader2 className="animate-spin text-wiz-muted" size={16} /></Section>;

  // Backup codes view (shown once after enable)
  if (backupCodes) {
    return (
      <Section title="Save your backup codes">
        <p className="text-xs text-amber-300 mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          ⚠️ <strong>This is the only time these codes will be shown.</strong> Save them somewhere safe (password manager, printed copy). Each code can be used once if you lose your authenticator.
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-wiz-bg/40 rounded-lg p-4 mb-4">
          {backupCodes.map((c, i) => (
            <div key={i} className="text-wiz-text">{c}</div>
          ))}
        </div>
        <div className="flex gap-2">
          <button onClick={downloadBackupCodes} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-wiz-border/40 text-sm text-wiz-text hover:bg-wiz-bg/40">
            <Download size={14} /> Download .txt
          </button>
          <button onClick={() => setBackupCodes(null)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-wiz-accent text-white text-sm">
            <Check size={14} /> I've saved them
          </button>
        </div>
      </Section>
    );
  }

  if (setupData) {
    return (
      <Section title="Set up two-factor authentication">
        <ol className="text-xs text-wiz-muted space-y-1 mb-4 list-decimal list-inside">
          <li>Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)</li>
          <li>Scan the QR code below</li>
          <li>Enter the 6-digit code your app shows to confirm</li>
        </ol>
        <div className="bg-white p-3 rounded-lg inline-block mb-4">
          <img src={setupData.qr} alt="2FA QR code" width={180} height={180} />
        </div>
        <p className="text-[10px] font-mono text-wiz-muted/70 mb-4 break-all">
          Or enter manually: <span className="text-wiz-text">{setupData.secret}</span>
        </p>
        <form onSubmit={handleEnable} className="flex gap-2">
          <input type="text" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)}
            placeholder="000000" maxLength={6} inputMode="numeric"
            className="flex-1 px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-wiz-text font-mono text-center tracking-[0.3em]" />
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-wiz-accent text-white text-sm font-semibold disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : 'Verify'}
          </button>
          <button type="button" onClick={() => setSetupData(null)} className="px-3 py-2 rounded-lg border border-wiz-border/40 text-sm text-wiz-muted">
            Cancel
          </button>
        </form>
      </Section>
    );
  }

  return (
    <Section
      title="Two-factor authentication"
      icon={<Shield size={16} className={enabled ? 'text-emerald-400' : 'text-wiz-muted'} />}
    >
      {enabled ? (
        <>
          <p className="text-sm text-emerald-300 mb-3">✓ 2FA is enabled on this account.</p>
          {!showDisable ? (
            <button onClick={() => setShowDisable(true)} className="text-xs text-rose-300 hover:underline">
              Disable 2FA
            </button>
          ) : (
            <form onSubmit={handleDisable} className="space-y-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5">
              <p className="text-xs text-wiz-muted">Confirm your password to disable 2FA:</p>
              <input type="password" value={disablePwd} onChange={(e) => setDisablePwd(e.target.value)}
                placeholder="Current password" autoComplete="current-password"
                className="w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text" />
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-semibold disabled:opacity-50">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : 'Disable 2FA'}
                </button>
                <button type="button" onClick={() => { setShowDisable(false); setDisablePwd(''); }}
                  className="px-3 py-1.5 rounded-lg border border-wiz-border/40 text-xs text-wiz-muted">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-wiz-muted mb-3">
            Add a second sign-in step using an authenticator app. Strongly recommended for admin accounts.
          </p>
          <button onClick={handleSetup} disabled={busy}
            className="px-4 py-2 rounded-lg bg-wiz-accent text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            Enable 2FA
          </button>
        </>
      )}
    </Section>
  );
}

// ─── PASSWORD ─────────────────────────────────────────────────────────────

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (next.length < 8) return toast.error('New password must be at least 8 characters');
    if (next !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      toast.success('Password changed. All other sessions signed out.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <Section title="Change password" icon={<KeyRound size={16} className="text-wiz-muted" />}>
      <form onSubmit={handleSubmit} className="space-y-2 max-w-sm">
        <input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          className="w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text" />
        <input type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text" />
        <input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className="w-full px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-sm text-wiz-text" />
        <button type="submit" disabled={busy}
          className="px-4 py-2 rounded-lg bg-wiz-accent text-white text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin inline" /> : 'Change password'}
        </button>
      </form>
    </Section>
  );
}

// ─── SESSIONS ─────────────────────────────────────────────────────────────

function SessionsSection() {
  const [busy, setBusy] = useState(false);

  const handleLogoutAll = async () => {
    if (!confirm('Sign out everywhere? You\'ll need to sign in again on all devices.')) return;
    setBusy(true);
    try {
      await api.logoutEverywhere();
      toast.success('All sessions revoked. You\'re signed out.');
      // The current session is also revoked — auth will detect this on next API call
      window.location.href = '/login';
    } catch (err) { toast.error('Failed'); setBusy(false); }
  };

  return (
    <Section title="Sessions" icon={<LogOut size={16} className="text-wiz-muted" />}>
      <p className="text-sm text-wiz-muted mb-3">
        Sign out of all devices and revoke all refresh tokens. Use this if you think your account is compromised.
      </p>
      <button onClick={handleLogoutAll} disabled={busy}
        className="px-4 py-2 rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
        Sign out everywhere
      </button>
    </Section>
  );
}

function Section({ title, icon, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-wiz-surface/60 border border-wiz-border/30 p-5">
      <h2 className="text-sm font-semibold text-wiz-text mb-4 flex items-center gap-2">
        {icon}{title}
      </h2>
      {children}
    </motion.div>
  );
}
