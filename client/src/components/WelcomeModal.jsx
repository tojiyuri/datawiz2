import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Upload, X, ArrowRight, Loader2, Wand2, Zap, Activity } from 'lucide-react';

/**
 * WelcomeModal — first-run experience.
 *
 * Shown the first time a user lands on the app (gated by localStorage flag).
 * Two paths:
 *   1. "Try with sample data" — loads a baked-in CSV, runs the full pipeline,
 *      drops the user on the Analysis page already populated with insights.
 *      Lowest possible activation cost — they see the tool working in <5s.
 *   2. "Upload my own" — closes the modal, user uses the upload page normally.
 *
 * Critical UX choice: we DON'T list features here. Telling someone "we have
 * Holt-Winters forecasting" before they've seen a chart is the wrong order.
 * Show the thing working first, then they'll care about how it works.
 */
export default function WelcomeModal({ open, onClose, onUseSample, loadingSample }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={loadingSample ? undefined : onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl card-elevated p-8"
            onClick={(e) => e.stopPropagation()}
          >
            {!loadingSample && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-md text-wiz-text-tertiary hover:text-wiz-text hover:bg-wiz-card transition-colors"
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            )}

            <div className="mb-6">
              <p className="eyebrow mb-2">Welcome to Data Wiz</p>
              <h2 className="text-3xl font-display font-semibold tracking-tight text-wiz-text mb-3">
                Let's get you to a chart in <span className="italic text-wiz-accent">five seconds</span>.
              </h2>
              <p className="text-base text-wiz-text-secondary leading-relaxed">
                Pick a path. You can always switch later.
              </p>
            </div>

            {/* Two-card layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

              {/* Sample data — primary path */}
              <button
                onClick={onUseSample}
                disabled={loadingSample}
                className="
                  group relative text-left p-5 rounded-xl
                  bg-wiz-accent text-wiz-bg
                  border-2 border-wiz-accent
                  hover:bg-wiz-accent-light hover:border-wiz-accent-light
                  transition-all duration-200
                  disabled:opacity-70 disabled:cursor-wait
                "
              >
                <div className="flex items-start justify-between mb-4">
                  <Sparkles size={22} strokeWidth={1.75} className="opacity-90" />
                  {loadingSample
                    ? <Loader2 size={16} className="animate-spin" />
                    : <ArrowRight size={16} strokeWidth={2} className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />}
                </div>
                <h3 className="text-lg font-display font-semibold tracking-tight mb-1.5">
                  Try with sample data
                </h3>
                <p className="text-sm leading-relaxed opacity-85 mb-3">
                  Real e-commerce dataset. 1,200 rows. You'll see auto-dashboards, key drivers, and Wiz find interesting things.
                </p>
                <p className="text-2xs font-mono uppercase tracking-wider opacity-70">
                  ~3 seconds to first chart
                </p>
              </button>

              {/* Upload own — secondary */}
              <button
                onClick={onClose}
                disabled={loadingSample}
                className="
                  group text-left p-5 rounded-xl
                  bg-wiz-surface text-wiz-text
                  border-2 border-wiz-border
                  hover:border-wiz-border-strong
                  transition-all duration-200
                  disabled:opacity-50
                "
              >
                <div className="flex items-start justify-between mb-4">
                  <Upload size={22} strokeWidth={1.75} className="text-wiz-text-tertiary" />
                  <ArrowRight size={16} strokeWidth={2} className="opacity-0 group-hover:opacity-50 group-hover:translate-x-0.5 transition-all text-wiz-text-tertiary" />
                </div>
                <h3 className="text-lg font-display font-semibold tracking-tight mb-1.5">
                  Upload my own
                </h3>
                <p className="text-sm leading-relaxed text-wiz-text-secondary mb-3">
                  CSV, JSON, or Excel. Up to 100MB. Wiz figures out the columns and starts asking questions.
                </p>
                <p className="text-2xs font-mono uppercase tracking-wider text-wiz-text-tertiary">
                  Bring your own data
                </p>
              </button>
            </div>

            {/* Tiny capability strip — answers "is this just a chart maker?" */}
            <div className="mt-6 pt-5 border-t border-wiz-border flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-wiz-text-tertiary">
              <span className="flex items-center gap-1.5"><Wand2 size={11} strokeWidth={1.75} className="text-wiz-accent"/> Auto-dashboards</span>
              <span className="flex items-center gap-1.5"><Zap size={11} strokeWidth={1.75} className="text-wiz-accent"/> Findings ranked by interestingness</span>
              <span className="flex items-center gap-1.5"><Activity size={11} strokeWidth={1.75} className="text-wiz-accent"/> Key driver analysis</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
