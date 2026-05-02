import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

// Initialize Sentry if VITE_SENTRY_DSN is set. Dynamic import keeps the bundle
// small when Sentry is unused, and ensures the app boots even if @sentry/react
// isn't installed.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0.0,
      replaysOnErrorSampleRate: 1.0,
    });
  }).catch(() => { /* @sentry/react not installed — no-op */ });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="bottom-left" toastOptions={{ style: { background: '#111827', color: '#F1F5F9', border: '1px solid #1E293B', borderRadius: '14px', fontFamily: '"DM Sans"', fontSize: '13px', padding: '12px 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }, success: { iconTheme: { primary: '#34D399', secondary: '#111827' } }, error: { iconTheme: { primary: '#FB7185', secondary: '#111827' } } }} />
    </BrowserRouter>
  </React.StrictMode>
);
