import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // On mount: check if user has a valid session
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.getAuthStatus();
        if (cancelled) return;
        setNeedsSetup(status.needsSetup);

        // Try to fetch current user — may fail if no token
        try {
          const r = await api.getMe();
          if (!cancelled) setUser(r.user);
        } catch (_) {
          // Not logged in — that's fine
        }
      } catch (err) {
        // Server unreachable
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api.login(email, password);
    if (r.twoFactorRequired) {
      // Don't set user yet — caller must complete 2FA
      return { twoFactorRequired: true, pendingToken: r.pendingToken };
    }
    setUser(r.user);
    setNeedsSetup(false);
    return { user: r.user };
  }, []);

  const completeTwoFactor = useCallback(async (pendingToken, code, backupCode) => {
    const r = await api.loginTwoFactor(pendingToken, code, backupCode);
    setUser(r.user);
    setNeedsSetup(false);
    return r.user;
  }, []);

  const signup = useCallback(async (email, password, name) => {
    const r = await api.signup(email, password, name);
    setUser(r.user);
    setNeedsSetup(false);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch (_) {}
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.getMe();
      setUser(r.user);
    } catch (_) {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, needsSetup, login, completeTwoFactor, signup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
