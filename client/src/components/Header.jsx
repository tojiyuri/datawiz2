import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Table2, LayoutDashboard, Sparkles, RotateCcw, Wrench,
  FilePlus2, Brain, Layers, Database, LogOut, Shield, Settings,
} from 'lucide-react';

const datasetTabs = [
  { id: 'analysis', label: 'Analysis', icon: Table2 },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sheets', label: 'Workbook', icon: Layers },
  { id: 'cleaning', label: 'Cleaning', icon: Wrench },
  { id: 'nlp', label: 'Prompt', icon: Sparkles },
];

const noDatasetTabs = [
  { id: 'sources', label: 'Sources', icon: Database },
  { id: 'create', label: 'Build', icon: FilePlus2 },
  { id: 'learning', label: 'AI Brain', icon: Brain },
];

export default function Header({ dataset, activeTab, onTabChange, onReset, user, onLogout }) {
  const tabs = dataset ? datasetTabs : noDatasetTabs;
  return (
    <header className="sticky top-0 z-40 bg-wiz-bg/85 backdrop-blur-md border-b border-wiz-border">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-6 px-6 py-3.5">

        {/* Wordmark — serif, confident, no gradient */}
        <button
          onClick={() => onTabChange('upload')}
          className="flex items-baseline gap-2 cursor-pointer shrink-0 group"
        >
          <span className="text-2xl font-display font-semibold text-wiz-text tracking-tightest leading-none">
            <span className="text-wiz-accent">D</span>ata Wiz
          </span>
          <span className="hidden md:inline text-2xs font-mono text-wiz-tertiary tracking-wider">v6.21</span>
        </button>

        {/* Tabs — minimal, monochrome with single accent on active */}
        <nav className="flex items-center gap-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <motion.button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.12, ease: [0.34, 1.56, 0.64, 1] }}
                className={`
                  relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                  transition-colors duration-150
                  ${active
                    ? 'text-wiz-accent'
                    : 'text-wiz-text-tertiary hover:text-wiz-text-secondary'}
                `}
              >
                <Icon size={14} className={active ? 'opacity-100' : 'opacity-70'} strokeWidth={active ? 2.25 : 1.75} />
                <span>{tab.label}</span>
                {active && (
                  <motion.span
                    layoutId="activeTabBar"
                    className="absolute -bottom-[14px] left-1/2 -translate-x-1/2 w-8 h-[2px] bg-wiz-accent rounded-full"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
              </motion.button>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="flex items-center gap-3 shrink-0">
          {dataset && (
            <>
              <div className="hidden md:flex items-baseline gap-2">
                <p className="text-sm text-wiz-text-secondary font-medium truncate max-w-[160px]">{dataset.fileName}</p>
                <p className="text-2xs text-wiz-tertiary font-mono">
                  {dataset.rowCount?.toLocaleString()}<span className="text-wiz-dim">×</span>{dataset.columnCount}
                </p>
              </div>
              <button
                onClick={onReset}
                className="btn-ghost text-2xs"
                title="Reset and upload new dataset"
              >
                <RotateCcw size={12} strokeWidth={1.75}/>
                <span className="hidden sm:inline">New</span>
              </button>
            </>
          )}
          {user && <UserMenu user={user} onLogout={onLogout} />}
        </div>
      </div>
    </header>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const initials = (user.name || user.email || '?')
    .split(/\s+/)
    .map(s => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="
          w-9 h-9 rounded-full
          bg-wiz-card border border-wiz-border-light
          flex items-center justify-center
          text-xs font-medium text-wiz-text
          hover:border-wiz-accent transition-colors
        "
        title={user.email}
      >
        {initials}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-64 card-elevated overflow-hidden z-50"
          >
            <div className="px-4 py-3 border-b border-wiz-border">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-wiz-text truncate">{user.name || 'No name set'}</p>
                {user.role === 'admin' && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium text-wiz-accent bg-wiz-accent-soft border border-wiz-accent/30">
                    <Shield size={9} strokeWidth={2}/> admin
                  </span>
                )}
              </div>
              <p className="text-xs text-wiz-tertiary truncate">{user.email}</p>
            </div>
            <button
              onClick={() => { setOpen(false); navigate('/settings'); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-wiz-text-secondary hover:text-wiz-text hover:bg-wiz-card transition-colors"
            >
              <Settings size={14} strokeWidth={1.75}/> Settings & 2FA
            </button>
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-wiz-text-secondary hover:text-wiz-danger hover:bg-wiz-card transition-colors"
            >
              <LogOut size={14} strokeWidth={1.75}/> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
