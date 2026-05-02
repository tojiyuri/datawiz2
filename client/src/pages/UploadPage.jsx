import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Upload, FilePlus2, ArrowUpRight, FileText, Zap, Layers } from 'lucide-react';

const capabilities = [
  { title: 'Auto-dashboard', desc: 'Drop a file, get a finished dashboard.' },
  { title: 'Plain-English charts', desc: 'Tell Wiz what you want to see.' },
  { title: 'Findings, ranked', desc: 'Concentration, outliers, trends — surfaced for you.' },
  { title: 'LODs & window functions', desc: 'Tableau-class calc primitives.' },
];

export default function UploadPage({ onUpload, loading }) {
  const navigate = useNavigate();
  const onDrop = useCallback((f) => { if (f[0]) onUpload(f[0]); }, [onUpload]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/tab-separated-values': ['.tsv'],
      'application/json': ['.json'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1, maxSize: 50 * 1024 * 1024, disabled: loading,
  });

  return (
    <div className="max-w-5xl mx-auto px-6 pt-16 pb-24 relative">
      {/* Hero — editorial, confident, single accent color */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mb-16"
      >
        <p className="eyebrow mb-5">Data Wiz · Visualization, automated</p>
        <h1 className="h-display text-wiz-text mb-6 max-w-3xl">
          Drop in your data.<br/>
          <span className="text-wiz-accent italic">Get answers,</span> not chores.
        </h1>
        <p className="text-lg text-wiz-text-secondary max-w-xl leading-relaxed">
          Upload a CSV and Wiz lays out a complete dashboard, ranks the most interesting findings, and waits for you to ask questions in plain English.
        </p>
      </motion.div>

      {/* Two CTAs — restrained, no rainbow */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-20">

        {/* Upload zone — primary action */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5 }}
          className="md:col-span-3"
        >
          <div
            {...getRootProps()}
            className={`
              relative h-full p-8 rounded-2xl cursor-pointer
              transition-all duration-300
              ${isDragActive
                ? 'bg-wiz-accent-soft border-2 border-wiz-accent'
                : 'bg-wiz-surface border-2 border-dashed border-wiz-border-light hover:border-wiz-border-strong'}
            `}
          >
            <input {...getInputProps()} />
            <div className="flex items-start justify-between gap-4 mb-8">
              <div className={`
                w-12 h-12 rounded-xl flex items-center justify-center
                transition-all duration-300
                ${isDragActive ? 'bg-wiz-accent text-wiz-bg' : 'bg-wiz-card border border-wiz-border'}
              `}>
                <Upload size={20} strokeWidth={1.75} className={isDragActive ? '' : 'text-wiz-text-secondary'} />
              </div>
              <span className="eyebrow">Step 1</span>
            </div>

            <h2 className="text-xl font-display font-semibold text-wiz-text mb-2 tracking-tight">
              {isDragActive ? 'Drop it here' : 'Upload a file'}
            </h2>
            <p className="text-wiz-text-secondary text-sm mb-8 leading-relaxed max-w-md">
              Drag a CSV, JSON, TSV, or Excel file anywhere on this card. Or click to browse.
            </p>

            <div className="flex items-center gap-2.5">
              <button className="btn-primary" type="button">
                <FileText size={14} strokeWidth={2}/>
                Browse files
              </button>
              <span className="text-xs text-wiz-tertiary font-mono">
                up to 50MB
              </span>
            </div>

            <div className="absolute bottom-6 right-6 flex gap-1.5">
              {['csv', 'json', 'xlsx', 'tsv'].map(ext => (
                <span key={ext} className="text-2xs font-mono text-wiz-tertiary px-2 py-1 rounded border border-wiz-border">
                  .{ext}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Build from scratch — secondary */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="md:col-span-2"
        >
          <button
            onClick={() => navigate('/create')}
            className="
              w-full h-full p-8 rounded-2xl text-left card card-lift
              flex flex-col
            "
          >
            <div className="flex items-start justify-between gap-4 mb-8">
              <div className="w-12 h-12 rounded-xl bg-wiz-card border border-wiz-border flex items-center justify-center">
                <FilePlus2 size={20} strokeWidth={1.75} className="text-wiz-text-secondary" />
              </div>
              <ArrowUpRight size={18} strokeWidth={1.5} className="text-wiz-tertiary" />
            </div>

            <h2 className="text-xl font-display font-semibold text-wiz-text mb-2 tracking-tight">
              No data yet?
            </h2>
            <p className="text-wiz-text-secondary text-sm leading-relaxed flex-1">
              Build a dataset from scratch with our templates — sales, surveys, inventory, and more.
            </p>

            <p className="mt-6 text-xs text-wiz-accent font-medium inline-flex items-center gap-1">
              Open builder <ArrowUpRight size={12} strokeWidth={2}/>
            </p>
          </button>
        </motion.div>
      </div>

      {/* Capabilities — two columns of plain text, no icons-as-decoration */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.6 }}
      >
        <p className="eyebrow mb-6">What it does</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-6">
          {capabilities.map((cap, i) => (
            <div key={i} className="flex items-baseline gap-3 group">
              <span className="text-wiz-accent font-mono text-sm">0{i + 1}</span>
              <div>
                <h3 className="text-base font-display font-semibold text-wiz-text mb-1 tracking-tight">{cap.title}</h3>
                <p className="text-sm text-wiz-text-secondary leading-relaxed">{cap.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
