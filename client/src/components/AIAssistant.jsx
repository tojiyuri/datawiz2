import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageCircle } from 'lucide-react';
import WizMascot from './WizMascot';

const pageMessages = {
  upload: [
    "Hey there! I'm Wiz 👋 Drop a file or build one from scratch!",
    "I'll analyze your data instantly — types, patterns, quality issues.",
    "New here? Try the 'Build From Scratch' option for sample templates.",
  ],
  create: [
    "Welcome to the dataset builder! Pick a template or start blank.",
    "Set the right column type — Number, Category, Date, or Text.",
    "Your data will get smart chart suggestions once you click 'Create & Analyze'.",
  ],
  analysis: [
    "Here's your data profile! Click any column card for detailed stats.",
    "I detected column types automatically and computed correlations.",
    "Strong correlations (>0.7) make great scatter plots — check the table below!",
  ],
  dashboard: [
    "I picked the best charts using my memory of past visualizations!",
    "Charts with a ⚡ badge were boosted by similar charts you liked before.",
    "Click 👍 or 👎 on any chart — I'll remember it for next time too.",
    "Each chart has a Lightbulb 💡 with a real insight from YOUR data.",
  ],
  cleaning: [
    "Let me help clean your data! I've spotted quality issues automatically.",
    "Try the ✨ Auto-Clean button — it fixes common issues in one click!",
    "After cleaning, download the structured CSV.",
  ],
  nlp: [
    "Type what you want in plain English — I'll figure out the chart type!",
    "Try: 'heatmap of sales by region and product' or 'box plot of price by category'",
    "I support 20+ chart types including radar, treemap, and waterfall.",
  ],
  learning: [
    "This is my brain! See what charts I've learned to favor.",
    "Switch to 'Visualization Memory' to see every chart I remember.",
    "Every 👍 boosts a chart's weight AND saves it to memory.",
    "I use memories from similar past datasets to score new recommendations.",
  ],
  sheets: [
    "Welcome to your Workbook — Tableau-style sheet & dashboard builder!",
    "Click 'New Sheet' to drag fields onto Columns/Rows shelves.",
    "Save sheets, then arrange them into custom dashboards.",
  ],
};


export default function AIAssistant({ currentPage }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [currentMsg, setCurrentMsg] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);
  const timeoutRef = useRef(null);

  const messages = pageMessages[currentPage] || pageMessages.upload;

  useEffect(() => {
    if (!hasGreeted) {
      const t = setTimeout(() => { setIsOpen(true); setHasGreeted(true); }, 1500);
      return () => clearTimeout(t);
    }
  }, [hasGreeted]);

  useEffect(() => { setCurrentMsg(0); }, [currentPage]);

  useEffect(() => {
    if (!isOpen) return;
    const msg = messages[currentMsg] || messages[0];
    setIsTyping(true); setDisplayedText('');
    let i = 0;
    const interval = setInterval(() => {
      if (i <= msg.length) { setDisplayedText(msg.slice(0, i)); i++; }
      else { clearInterval(interval); setIsTyping(false); }
    }, 25);
    return () => clearInterval(interval);
  }, [isOpen, currentMsg, currentPage]);

  useEffect(() => {
    if (!isOpen || isTyping) return;
    timeoutRef.current = setTimeout(() => setCurrentMsg(prev => (prev + 1) % messages.length), 5000);
    return () => clearTimeout(timeoutRef.current);
  }, [isOpen, isTyping, currentMsg, messages.length]);

  const nextMessage = () => { clearTimeout(timeoutRef.current); setCurrentMsg(prev => (prev + 1) % messages.length); };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      <AnimatePresence>
        {isOpen && !isMinimized && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.85 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="glass rounded-2xl p-4 max-w-[280px] shadow-2xl shadow-black/40 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-wiz-accent font-bold tracking-wider uppercase">Wiz Assistant</span>
              <div className="flex gap-1">
                <button onClick={() => setIsMinimized(true)} className="p-0.5 rounded hover:bg-wiz-faint/30 text-wiz-dim hover:text-wiz-muted transition-colors text-xs">—</button>
                <button onClick={() => setIsOpen(false)} className="p-0.5 rounded hover:bg-wiz-faint/30 text-wiz-dim hover:text-wiz-muted transition-colors"><X size={12}/></button>
              </div>
            </div>
            <p className="text-[13px] text-wiz-text-secondary leading-relaxed font-body min-h-[48px]">
              {displayedText}
              {isTyping && <span className="inline-block w-[2px] h-[14px] bg-wiz-accent ml-0.5 animate-pulse-soft align-text-bottom"/>}
            </p>
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-1.5">
                {messages.map((_, i) => (
                  <button key={i} onClick={() => { clearTimeout(timeoutRef.current); setCurrentMsg(i); }}
                    className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${i === currentMsg ? 'bg-wiz-accent w-4' : 'bg-wiz-faint hover:bg-wiz-dim'}`}/>
                ))}
              </div>
              <button onClick={nextMessage} className="text-[10px] text-wiz-accent font-semibold hover:text-wiz-accent-light transition-colors">Next tip →</button>
            </div>
            <div className="absolute -bottom-2 right-8 w-4 h-4 rotate-45 glass" style={{borderTop:'none',borderLeft:'none'}}/>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button onClick={() => { if (isMinimized) { setIsMinimized(false); setIsOpen(true); } else setIsOpen(!isOpen); }}
        className="relative group" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}
        animate={!isOpen ? { y: [0, -6, 0] } : {}} transition={!isOpen ? { duration: 3, repeat: Infinity, ease: 'easeInOut' } : {}}>
        <div className={`absolute inset-0 rounded-full transition-all duration-500 ${isOpen ? 'bg-wiz-accent/20 scale-125 blur-md' : 'bg-wiz-accent/10 scale-110 blur-sm group-hover:bg-wiz-accent/25 group-hover:scale-130'}`}/>
        {isMinimized && (
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-wiz-rose flex items-center justify-center z-10">
            <MessageCircle size={8} className="text-white"/>
          </motion.div>
        )}
        <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-wiz-accent-deep/20 to-wiz-emerald-deep/10 border-2 border-wiz-accent/30 flex items-center justify-center overflow-hidden group-hover:border-wiz-accent/50 transition-all shadow-lg shadow-wiz-accent-deep/20">
          <WizMascot state={isTyping ? "speaking" : (isOpen ? "idle" : "celebrating")} size={56} />
        </div>
      </motion.button>

      <style>{`@keyframes wiggle { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-15deg); } 75% { transform: rotate(15deg); } }`}</style>
    </div>
  );
}
