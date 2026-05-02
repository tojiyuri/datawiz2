import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Send, X, ChevronDown, ChevronUp, RotateCcw, Wand2, AlertCircle, Loader2 } from 'lucide-react';
import * as api from '../utils/api';
import WizMascot, { deriveWizState } from './WizMascot';
import { emitWizCue, CUES } from '../utils/wizBus';

const STARTER_PROMPTS = [
  'Show me sales by region',
  'Plot revenue over time',
  'Top 5 customers by revenue',
  'Compare profit across categories',
];

/**
 * ConversationPanel — Wiz lives here.
 *
 * Wiz is animated: idle by default, working while waiting on the LLM,
 * celebrating after a successful spec change, confused on errors. The mascot
 * mirrors what the system is doing.
 *
 * The panel can be collapsed (Wiz floats as a small avatar) or expanded
 * (full chat thread). The send button shows latency stats from the LLM.
 */
export default function ConversationPanel({ open, onClose, datasetId, currentSpec, onSpecChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [aiStatus, setAiStatus] = useState({ mode: 'heuristic', llmAvailable: false });
  const [bubbleMessage, setBubbleMessage] = useState(null);
  const [lastInteractionAt, setLastInteractionAt] = useState(Date.now());
  const [idleSeconds, setIdleSeconds] = useState(0);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  // Bring focus to input on open
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);

  // Fetch AI status (LLM available?) on mount
  useEffect(() => {
    api.getAIStatus().then(setAiStatus).catch(() => {});
  }, []);

  // Track idle time (for sleeping mascot)
  useEffect(() => {
    const t = setInterval(() => {
      setIdleSeconds(Math.floor((Date.now() - lastInteractionAt) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [lastInteractionAt]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Compute Wiz's current state from conversation activity
  const lastMessage = messages[messages.length - 1];
  const wizState = useMemo(() => {
    if (busy) return 'working';
    if (lastMessage?.error || lastMessage?.intent === 'error') return 'confused';
    if (lastMessage?.intent === 'unclear') return 'confused';
    if (lastMessage?.role === 'ai' && lastMessage.intent &&
        ['create', 'change_chart', 'add_field', 'create_calc_field', 'create_lod', 'create_table_calc'].includes(lastMessage.intent)) {
      // Recently completed a successful action — celebrate briefly
      const since = Date.now() - (lastMessage.at || 0);
      if (since < 1500) return 'celebrating';
      return 'idle';
    }
    if (idleSeconds > 60 && messages.length > 0) return 'sleeping';
    return 'idle';
  }, [busy, lastMessage, idleSeconds, messages.length]);

  // Show speech bubble for the latest AI reply briefly when collapsed
  useEffect(() => {
    if (!lastMessage || lastMessage.role !== 'ai' || !lastMessage.text) {
      setBubbleMessage(null);
      return;
    }
    if (collapsed) {
      setBubbleMessage(lastMessage.text.slice(0, 70) + (lastMessage.text.length > 70 ? '…' : ''));
      const timer = setTimeout(() => setBubbleMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastMessage, collapsed]);

  // Emit panel open/close cues for the page-level Wiz to walk in/out
  useEffect(() => {
    if (open) emitWizCue(CUES.PANEL_OPENED);
    else emitWizCue(CUES.PANEL_CLOSED);
  }, [open]);

  const send = async (text) => {
    if (!text?.trim() || busy) return;
    setLastInteractionAt(Date.now());
    const userMsg = { role: 'user', text: text.trim(), at: Date.now() };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setBusy(true);
    emitWizCue(CUES.THINKING, { message: text.trim() });
    try {
      const r = await api.converseSheet(text.trim(), currentSpec, datasetId, messages.slice(-6).map(m => ({ role: m.role, content: m.text })));
      const aiMsg = {
        role: 'ai',
        text: r.reply,
        intent: r.intent,
        confidence: r.confidence,
        actions: r.actions || [],
        suggestions: r.suggestions || [],
        poweredBy: r.poweredBy,
        latencyMs: r.latencyMs,
        error: r.intent === 'error',
        at: Date.now(),
      };
      setMessages(m => [...m, aiMsg]);
      if (r.newSpec && r.intent !== 'unclear' && r.intent !== 'error') {
        onSpecChange(r.newSpec);
        // Distinguish "first chart on a blank canvas" from "tweak existing chart"
        const wasBlank = !currentSpec || (!currentSpec.columns?.length && !currentSpec.rows?.length);
        emitWizCue(wasBlank ? CUES.CHART_BUILT : CUES.CHART_UPDATED, { intent: r.intent });
      } else if (r.intent === 'error' || aiMsg.error) {
        emitWizCue(CUES.ERROR, { message: r.reply });
      }
      setLastInteractionAt(Date.now());
    } catch (err) {
      setMessages(m => [...m, {
        role: 'ai',
        text: 'I hit a snag. Try again?',
        error: true,
        at: Date.now(),
      }]);
      emitWizCue(CUES.ERROR, { message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setInput('');
    setLastInteractionAt(Date.now());
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 250 }}
        className="fixed bottom-4 right-4 z-50 w-[440px] max-w-[calc(100vw-2rem)] rounded-2xl bg-wiz-surface/95 backdrop-blur-xl border border-wiz-accent/20 shadow-2xl shadow-wiz-accent/10 flex flex-col overflow-hidden"
        style={{ maxHeight: collapsed ? 'auto' : '78vh' }}
      >
        {/* ─── HEADER WITH WIZ ──────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-wiz-border/30 bg-gradient-to-r from-wiz-accent/[0.10] via-wiz-violet/[0.06] to-transparent">
          <div className="relative">
            <WizMascot
              state={collapsed ? wizState : 'idle'}
              size={collapsed ? 56 : 44}
              message={bubbleMessage}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[14px] font-bold font-display text-wiz-text leading-none">Ask Wiz</h3>
              {aiStatus.llmAvailable ? (
                <span
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[8px] font-mono uppercase tracking-wider font-bold ${
                    aiStatus.location === 'local'
                      ? 'bg-gradient-to-r from-wiz-violet/20 to-wiz-violet/10 border-wiz-violet/30 text-wiz-violet'
                      : 'bg-gradient-to-r from-wiz-emerald/20 to-wiz-emerald/10 border-wiz-emerald/30 text-wiz-emerald'
                  }`}
                  title={`Powered by ${aiStatus.model || aiStatus.provider} (${aiStatus.location || 'cloud'})`}
                >
                  <Sparkles size={7} />
                  {aiStatus.location === 'local' ? `Local · ${shortModel(aiStatus.model)}` : 'Live'}
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-wiz-amber/10 border border-wiz-amber/30 text-[8px] font-mono uppercase tracking-wider text-wiz-amber font-bold" title="Set LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY, or LLM_PROVIDER=ollama with Ollama running">
                  Heuristic
                </span>
              )}
            </div>
            <p className="text-[10px] text-wiz-muted font-mono mt-0.5">
              {busy ? <span className="text-wiz-accent">working on it…</span> :
                wizState === 'sleeping' ? <span>idle · ask me anything</span> :
                wizState === 'confused' ? <span className="text-wiz-amber">need clarification</span> :
                wizState === 'celebrating' ? <span className="text-wiz-emerald">done!</span> :
                <span>your data viz partner</span>}
            </p>
          </div>
          <button onClick={reset} title="Clear conversation" className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text transition-colors">
            <RotateCcw size={12} />
          </button>
          <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand' : 'Collapse'} className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text transition-colors">
            {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-wiz-bg/40 text-wiz-muted hover:text-wiz-text transition-colors">
            <X size={13} />
          </button>
        </div>

        {!collapsed && (
          <>
            {/* ─── BIG WIZ ON FIRST OPEN ────────────────────────── */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center pt-6 pb-3 px-4 bg-gradient-to-b from-wiz-accent/[0.04] to-transparent">
                <WizMascot state={wizState} size={140} />
                <p className="mt-3 text-sm font-display font-semibold text-wiz-text text-center">
                  Hey there! I'm Wiz 👋
                </p>
                <p className="mt-1 text-[11px] text-wiz-muted text-center max-w-[280px]">
                  Tell me what you want to see and I'll build the chart for you.
                  {!aiStatus.llmAvailable && (
                    <span className="block mt-1.5 text-[10px] text-wiz-amber">
                      I'm in heuristic mode. Add an Anthropic API key to .env for full LLM capabilities.
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* ─── MESSAGE THREAD ───────────────────────────────── */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ minHeight: messages.length ? 200 : 0, maxHeight: '50vh' }}>
              {messages.map((m, i) => (
                <Message key={i} msg={m} onSuggestion={(s) => send(s)} />
              ))}
              {busy && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2"
                >
                  <div className="mt-1 flex-shrink-0">
                    <WizMascot state="thinking" size={28} />
                  </div>
                  <div className="px-3 py-2 rounded-2xl bg-wiz-bg/50 border border-wiz-border/30">
                    <div className="flex items-center gap-1.5">
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                        className="w-1.5 h-1.5 rounded-full bg-wiz-accent"
                      />
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}
                        className="w-1.5 h-1.5 rounded-full bg-wiz-accent"
                      />
                      <motion.span
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}
                        className="w-1.5 h-1.5 rounded-full bg-wiz-accent"
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* ─── STARTER PROMPTS ──────────────────────────────── */}
            {messages.length === 0 && (
              <div className="px-4 pb-2">
                <p className="text-[10px] font-mono text-wiz-muted uppercase tracking-wider mb-1.5">Try saying</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTER_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => send(p)}
                      className="px-2.5 py-1.5 rounded-lg bg-wiz-bg/40 border border-wiz-border/30 text-[11px] text-wiz-text-secondary hover:text-wiz-accent hover:border-wiz-accent/40 transition-colors"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─── INPUT ────────────────────────────────────────── */}
            <div className="border-t border-wiz-border/30 p-3 bg-wiz-bg/30">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send(input)}
                  placeholder={busy ? 'Wiz is working...' : 'Ask Wiz to build something...'}
                  disabled={busy}
                  className="flex-1 px-3 py-2 rounded-lg bg-wiz-bg/60 border border-wiz-border/40 text-[12px] text-wiz-text placeholder-wiz-muted/60 focus:outline-none focus:border-wiz-accent/50 disabled:opacity-50"
                />
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || busy}
                  className="p-2 rounded-lg bg-gradient-to-br from-wiz-accent to-wiz-accent-deep text-white disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-wiz-accent/20 hover:shadow-wiz-accent/40 transition-shadow"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Single message bubble ──────────────────────────────────────────────────

function Message({ msg, onSuggestion }) {
  if (msg.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex justify-end"
      >
        <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-br-md bg-wiz-accent text-white text-[12px]">
          {msg.text}
        </div>
      </motion.div>
    );
  }

  // AI message
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2">
      <div className="mt-0.5 flex-shrink-0">
        <WizMascot
          state={msg.error ? 'confused' : (msg.intent === 'unclear' ? 'thinking' : 'idle')}
          size={28}
        />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className={`px-3 py-2 rounded-2xl rounded-tl-md text-[12px] ${msg.error ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200' : 'bg-wiz-bg/50 border border-wiz-border/30 text-wiz-text'}`}>
          {msg.error && <AlertCircle size={11} className="inline mr-1 text-rose-400" />}
          {msg.text}
        </div>
        {msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.actions.map((a, i) => (
              <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-wiz-emerald/10 border border-wiz-emerald/30 text-wiz-emerald">
                ✓ {a}
              </span>
            ))}
          </div>
        )}
        {msg.suggestions && msg.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.suggestions.slice(0, 3).map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggestion(s)}
                className="text-[10px] px-2 py-1 rounded-md bg-wiz-violet/10 border border-wiz-violet/30 text-wiz-violet hover:bg-wiz-violet/20"
              >
                <Wand2 size={9} className="inline mr-0.5" />{s}
              </button>
            ))}
          </div>
        )}
        {(msg.poweredBy || msg.latencyMs != null) && (
          <p className="text-[8px] font-mono text-wiz-muted/60">
            {msg.poweredBy === 'anthropic' ? 'Wiz · Claude' :
              msg.poweredBy === 'ollama' ? 'Wiz · Ollama (local)' :
              msg.poweredBy === 'llm' ? 'Wiz · LLM' :
              'Wiz · heuristic'}
            {msg.latencyMs != null && ` · ${msg.latencyMs}ms`}
            {msg.confidence != null && ` · ${Math.round(msg.confidence * 100)}% confident`}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// Shorten "qwen2.5:14b" → "qwen2.5:14b" (kept as-is; ":" version tag is the
// useful bit). For very long model names, keep up to 14 chars then ellipsize.
function shortModel(model) {
  if (!model) return '';
  if (model.length <= 14) return model;
  return model.slice(0, 13) + '…';
}
