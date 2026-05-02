import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import Header from './components/Header';
import AIAssistant from './components/AIAssistant';
import UploadPage from './pages/UploadPage';
import AnalysisPage from './pages/AnalysisPage';
import DashboardPage from './pages/DashboardPage';
import NLPPage from './pages/NLPPage';
import CleaningPage from './pages/CleaningPage';
import CreateDatasetPage from './pages/CreateDatasetPage';
import DataSourcesPage from './pages/DataSourcesPage';
import LearningPage from './pages/LearningPage';
import SheetsListPage from './pages/SheetsListPage';
import SheetBuilderPage from './pages/SheetBuilderPage';
import DashboardComposerPage from './pages/DashboardComposerPage';
import ExplorePage from './pages/ExplorePage';
import KeyDriversPage from './pages/KeyDriversPage';
import DecompositionTreePage from './pages/DecompositionTreePage';
import ReportsPage from './pages/ReportsPage';
import AuthPage from './pages/AuthPage';
import WelcomeModal from './components/WelcomeModal';
import GuidedTour, { useTour, isTourCompleted } from './components/GuidedTour';
import ResetPasswordPage from './pages/ResetPasswordPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import SettingsPage from './pages/SettingsPage';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import * as api from './utils/api';

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, loading, needsSetup } = useAuth();
  const location = useLocation();

  // Auth pages and password-flow pages are public (no auth required)
  const publicPaths = ['/login', '/signup', '/reset-password', '/verify-email'];
  const isAuthPath = publicPaths.includes(location.pathname);

  if (loading) {
    return (
      <div className="mesh-bg noise min-h-screen flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 rounded-full border-2 border-wiz-faint border-t-wiz-accent"
        />
      </div>
    );
  }

  // Not logged in → force auth page
  if (!user) {
    if (isAuthPath) {
      return (
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Routes>
      );
    }
    // Redirect to signup if no users yet, else login
    return <Navigate to={needsSetup ? '/signup' : '/login'} replace state={{ from: location.pathname }} />;
  }

  // Logged in but on login/signup → redirect home (allow other public paths through)
  if (location.pathname === '/login' || location.pathname === '/signup') {
    return <Navigate to="/" replace />;
  }
  if (location.pathname === '/reset-password') return <ResetPasswordPage />;
  if (location.pathname === '/verify-email') return <VerifyEmailPage />;

  return <AppShell />;
}

function AppShell() {
  const [dataset, setDataset] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const tour = useTour();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // First-run detection — show the welcome modal once, ever.
  // Gated on user being logged in (otherwise modal flashes during auth flow).
  useEffect(() => {
    if (!user) return;
    try {
      const seen = localStorage.getItem('wizFirstRunShown_v1');
      if (!seen) setShowWelcome(true);
    } catch (_) {}
  }, [user]);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try { localStorage.setItem('wizFirstRunShown_v1', '1'); } catch (_) {}
  }, []);

  /**
   * Load the baked-in sample CSV. Fetches the file from /sample-data.csv,
   * wraps it in a File object, and runs it through the existing upload
   * pipeline so server-side handling is identical to a real upload. Then
   * navigates to Analysis and starts the tour.
   */
  const handleUseSample = useCallback(async () => {
    setLoadingSample(true);
    try {
      const res = await fetch('/sample-data.csv');
      if (!res.ok) throw new Error('Sample data not available');
      const blob = await res.blob();
      const file = new File([blob], 'Sample E-Commerce Sales.csv', { type: 'text/csv' });
      const r = await api.uploadFile(file);
      setDataset({ id: r.datasetId, fileName: r.fileName, fileSize: r.fileSize, rowCount: r.rowCount, columnCount: r.columnCount });
      setAnalysis(r.analysis);
      dismissWelcome();
      navigate('/analysis');
      // Start the tour after a beat — let AnalysisPage mount + render its
      // tour-anchor buttons before we try to position tooltips on them.
      setTimeout(() => {
        if (!isTourCompleted()) tour.start();
      }, 600);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Could not load sample');
    } finally {
      setLoadingSample(false);
    }
  }, [navigate, dismissWelcome, tour]);

  const handleUpload = useCallback(async (file) => {
    setLoading(true);
    try {
      const r = await api.uploadFile(file);
      setDataset({ id: r.datasetId, fileName: r.fileName, fileSize: r.fileSize, rowCount: r.rowCount, columnCount: r.columnCount });
      setAnalysis(r.analysis);
      toast.success(`Loaded ${r.rowCount.toLocaleString()} rows × ${r.columnCount} columns`);
      navigate('/analysis');
      // First "real" dataset: also start the tour for users who skipped sample
      setTimeout(() => {
        if (!isTourCompleted()) tour.start();
      }, 600);
    } catch (err) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setLoading(false); }
  }, [navigate, tour]);

  const handleCreated = useCallback((ds, a) => {
    setDataset(ds); setAnalysis(a);
  }, []);

  const handleReset = useCallback(() => {
    if (dataset?.id) api.deleteDataset(dataset.id).catch(() => {});
    setDataset(null); setAnalysis(null); navigate('/');
  }, [dataset, navigate]);

  const updateAnalysis = useCallback((a) => {
    setAnalysis(a);
    if (a?.summary) setDataset(p => p ? { ...p, rowCount: a.summary.rows, columnCount: a.summary.columns } : p);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setDataset(null); setAnalysis(null);
    toast.success('Logged out');
  }, [logout]);

  // Map URL path to active tab. Group nested routes under a parent tab.
  const path = location.pathname;
  const activeTab = path === '/' ? 'upload'
    : path.startsWith('/sheet/') || path.startsWith('/composer/') ? 'sheets'
    : path.replace('/', '');

  return (
    <div className="mesh-bg noise min-h-screen flex flex-col relative">
      <Header
        dataset={dataset}
        activeTab={activeTab}
        onTabChange={(t) => navigate(t === 'upload' ? '/' : `/${t}`)}
        onReset={handleReset}
        user={user}
        onLogout={handleLogout}
      />

      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-wiz-bg/85 backdrop-blur-md"
          >
            {/* Concentric rings — the inner one rotates, outer pulses.
                Feels like Wiz casting a spell, not a generic spinner. */}
            <div className="relative w-16 h-16 mb-6">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border-2 border-wiz-border border-t-wiz-accent"
              />
              <motion.div
                animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-2 rounded-full bg-wiz-accent/20"
              />
              <motion.div
                animate={{ scale: [0.9, 1.0, 0.9] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-[14px] rounded-full bg-wiz-accent shadow-lg shadow-wiz-accent/40"
              />
            </div>
            <motion.p
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.3 }}
              className="text-wiz-text font-display text-base font-semibold tracking-tight"
            >
              Analyzing your data
            </motion.p>
            <motion.p
              initial={{ y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.3 }}
              className="text-wiz-text-tertiary text-xs mt-2 font-mono uppercase tracking-wider"
            >
              Detecting types · Computing stats · Finding patterns
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 overflow-y-auto relative z-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="page-enter"
          >
            <Routes>
              <Route path="/" element={<UploadPage onUpload={handleUpload} loading={loading} />} />
              <Route path="/create" element={<CreateDatasetPage onCreated={handleCreated} />} />
              <Route path="/sources" element={<DataSourcesPage onCreated={handleCreated} />} />
              <Route path="/analysis" element={<AnalysisPage dataset={dataset} analysis={analysis} />} />
              <Route path="/dashboard" element={<DashboardPage dataset={dataset} analysis={analysis} onReset={handleReset} />} />
              <Route path="/cleaning" element={<CleaningPage dataset={dataset} analysis={analysis} onAnalysisUpdate={updateAnalysis} />} />
              <Route path="/nlp" element={<NLPPage dataset={dataset} analysis={analysis} />} />
              <Route path="/learning" element={<LearningPage />} />
              <Route path="/sheets" element={<SheetsListPage dataset={dataset} analysis={analysis} />} />
              <Route path="/sheet/:id" element={<SheetBuilderPage dataset={dataset} analysis={analysis} />} />
              <Route path="/composer/:id" element={<DashboardComposerPage dataset={dataset} analysis={analysis} />} />
              <Route path="/explore/:datasetId" element={<ExplorePage />} />
              <Route path="/drivers" element={<KeyDriversPage dataset={dataset} analysis={analysis} />} />
              <Route path="/decomp" element={<DecompositionTreePage dataset={dataset} analysis={analysis} />} />
              <Route path="/reports" element={<ReportsPage dataset={dataset} />} />
              <Route path="/dashboards/:id" element={<DashboardComposerPage dataset={dataset} analysis={analysis} />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>

      <AIAssistant currentPage={activeTab} />

      {/* First-run welcome — shown once per user. Sample data path drops them
          straight onto Analysis with the tour primed. */}
      <WelcomeModal
        open={showWelcome}
        loadingSample={loadingSample}
        onClose={dismissWelcome}
        onUseSample={handleUseSample}
      />

      {/* Guided tour overlay — auto-opens after sample/upload on first run.
          Respects localStorage flag so it doesn't repeat. */}
      <GuidedTour open={tour.open} onClose={tour.stop} />
    </div>
  );
}
