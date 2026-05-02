import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Treemap as RTreemap,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, ZAxis, ReferenceLine, ReferenceArea,
} from 'recharts';

const C = ['#818CF8','#34D399','#FBBF24','#FB7185','#38BDF8','#A78BFA','#F472B6','#2DD4BF','#F97316','#06B6D4','#E879F9','#4ADE80'];
const tt = { background:'rgba(17,24,39,0.95)', border:'1px solid rgba(30,41,59,0.6)', borderRadius:'12px', color:'#F1F5F9', fontSize:'12px', fontFamily:'"Inter"', boxShadow:'0 12px 40px rgba(0,0,0,0.5)', backdropFilter:'blur(8px)', padding:'10px 14px' };
const ax = { fontSize:10, fill:'#8B8579', fontFamily:'"JetBrains Mono"' };
const gr = { strokeDasharray:'3 3', stroke:'rgba(42,38,32,0.7)' };

const REF_COLORS = {
  warn: '#D88E3C', ok: '#7DAD52', danger: '#C8553D', accent: '#E9A521', info: '#6E8FB5',
};

/**
 * Build the recharts <ReferenceLine> / <ReferenceArea> children for a spec.
 * The server has already resolved 'avg' / 'p95' / etc. into concrete numeric
 * values, so this function just maps the resolved overlays to recharts JSX.
 */
function renderOverlays(spec, yAxisId = undefined) {
  const out = [];
  // Bands first so lines render on top
  for (const b of spec.referenceBands || []) {
    if (b.axis !== 'y' && b.axis !== 'x') continue;
    const props = b.axis === 'y'
      ? { y1: b.from, y2: b.to }
      : { x1: b.from, x2: b.to };
    out.push(
      <ReferenceArea
        key={`band-${b.label}`}
        {...props}
        {...(yAxisId ? { yAxisId } : {})}
        fill={b.fill || REF_COLORS.accent}
        fillOpacity={0.1}
        stroke={b.fill || REF_COLORS.accent}
        strokeOpacity={0.3}
        strokeDasharray="2 4"
        ifOverflow="extendDomain"
        label={b.label ? {
          value: b.label,
          position: b.axis === 'y' ? 'insideTopRight' : 'insideTopLeft',
          fill: b.fill || REF_COLORS.accent,
          fontSize: 10,
          fontFamily: 'Inter',
        } : undefined}
      />
    );
  }
  for (const l of spec.referenceLines || []) {
    if (l.axis !== 'y' && l.axis !== 'x') continue;
    const stroke = l.stroke || REF_COLORS.accent;
    const props = l.axis === 'y' ? { y: l.value } : { x: l.value };
    out.push(
      <ReferenceLine
        key={`ref-${l.label}-${l.value}`}
        {...props}
        {...(yAxisId ? { yAxisId } : {})}
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        ifOverflow="extendDomain"
        label={l.label ? {
          value: l.label,
          position: l.axis === 'y' ? 'insideTopRight' : 'insideTopLeft',
          fill: stroke,
          fontSize: 10,
          fontFamily: 'Inter',
          fontWeight: 500,
        } : undefined}
      />
    );
  }
  return out;
}

/**
 * Trellis / small multiples — grid of mini-charts, one per facet value.
 *
 * Each facet rendered with the same chart type, axis range, and styling so
 * the eye can compare them honestly. Auto-arranges into a responsive grid
 * (2-4 cols depending on facet count).
 */
function TrellisChart({ spec, height, onClick }) {
  const facets = spec.facets || [];
  if (!facets.length) {
    return <div className="flex items-center justify-center h-32 text-wiz-muted text-sm">No facets</div>;
  }

  // Choose columns based on facet count
  const cols = facets.length <= 4 ? 2 : facets.length <= 9 ? 3 : 4;
  const rows = Math.ceil(facets.length / cols);
  const facetHeight = Math.max(140, Math.floor((height - 16 - rows * 28) / rows));

  return (
    <div
      className="w-full overflow-auto"
      style={{ height, padding: 4 }}
    >
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {facets.map((f, i) => (
          <div key={f.facetValue + i} className="flex flex-col">
            <div className="text-xs font-medium text-wiz-text-secondary px-1 mb-1 truncate font-display">
              {f.facetValue}
            </div>
            <div style={{ height: facetHeight }}>
              <ChartRenderer
                spec={{
                  ...f.spec,
                  // Force shared y-domain across facets so comparison is honest
                  ...(spec.sharedYDomain ? { yDomain: spec.sharedYDomain } : {}),
                }}
                chartData={f.chartData}
                stackKeys={f.stackKeys}
                height={facetHeight}
                onClick={onClick}
              />
            </div>
          </div>
        ))}
      </div>
      {spec.truncated && (
        <p className="text-xs text-wiz-muted mt-2 px-1 italic">
          Showing top {facets.length} of more facets — increase trellis.max to see more.
        </p>
      )}
    </div>
  );
}


function BoxPlotShape({ data, height }) {
  if (!data?.length) return <div className="flex items-center justify-center h-32 text-wiz-muted text-sm">No data</div>;
  const maxVal = Math.max(...data.map(d => d.max));
  const w = Math.min(50, Math.max(30, 400 / data.length));
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${data.length * (w + 20) + 40} ${height}`}>
      {data.map((d, i) => {
        const cx = 30 + i * (w + 20) + w / 2;
        const sc = (v) => height - 40 - (v / (maxVal || 1)) * (height - 60);
        return (<g key={i}><line x1={cx} y1={sc(d.min)} x2={cx} y2={sc(d.max)} stroke="#475569" strokeWidth="1" strokeDasharray="3 2"/><line x1={cx-w/4} y1={sc(d.min)} x2={cx+w/4} y2={sc(d.min)} stroke="#64748B" strokeWidth="2"/><line x1={cx-w/4} y1={sc(d.max)} x2={cx+w/4} y2={sc(d.max)} stroke="#64748B" strokeWidth="2"/><rect x={cx-w/2} y={sc(d.q3)} width={w} height={Math.max(1, sc(d.q1)-sc(d.q3))} fill="#818CF8" fillOpacity="0.25" stroke="#818CF8" strokeWidth="1.5" rx="4"/><line x1={cx-w/2} y1={sc(d.median)} x2={cx+w/2} y2={sc(d.median)} stroke="#C7D2FE" strokeWidth="2.5"/><text x={cx} y={height-6} textAnchor="middle" fill="#64748B" fontSize="10" fontFamily="JetBrains Mono">{d.category}</text></g>);
      })}
    </svg>
  );
}

// ─── HEATMAP (custom SVG) ───
function HeatmapChart({ data, height }) {
  if (!data?.length) return null;
  const xV = [...new Set(data.map(d => d.x))], yV = [...new Set(data.map(d => d.y))];
  const maxV = Math.max(...data.map(d => Math.abs(d.value)), 1);
  const cw = Math.max(40, Math.min(70, 500/xV.length)), ch = Math.max(28, Math.min(40, (height-50)/yV.length));
  return (
    <svg width="100%" height={Math.max(height, yV.length*ch+60)} viewBox={`0 0 ${xV.length*cw+100} ${yV.length*ch+60}`}>
      {data.map((d, i) => { const xi = xV.indexOf(d.x), yi = yV.indexOf(d.y); const int = Math.abs(d.value)/maxV; return (<g key={i}><rect x={80+xi*cw} y={10+yi*ch} width={cw-2} height={ch-2} fill={`rgba(129,140,248,${0.08+int*0.85})`} rx="4"/><text x={80+xi*cw+cw/2} y={10+yi*ch+ch/2+4} textAnchor="middle" fill={int>0.5?'#F1F5F9':'#94A3B8'} fontSize="10" fontFamily="JetBrains Mono">{d.value}</text></g>); })}
      {xV.map((v, i) => <text key={`x${i}`} x={80+i*cw+cw/2} y={yV.length*ch+30} textAnchor="middle" fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">{v}</text>)}
      {yV.map((v, i) => <text key={`y${i}`} x={75} y={10+i*ch+ch/2+4} textAnchor="end" fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">{v}</text>)}
    </svg>
  );
}

// ─── FUNNEL (custom SVG) ───
function FunnelChart({ data, height }) {
  if (!data?.length) return null;
  const maxV = data[0]?.value || 1;
  const stepH = Math.min(50, (height-20)/data.length);
  return (
    <svg width="100%" height={height} viewBox={`0 0 500 ${data.length*stepH+20}`}>
      {data.map((d, i) => { const w = Math.max(60, (d.value/maxV)*400); return (<g key={i}><rect x={(500-w)/2} y={i*stepH+5} width={w} height={stepH-6} fill={C[i%C.length]} fillOpacity="0.7" rx="6"/><text x={250} y={i*stepH+stepH/2+5} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600" fontFamily="DM Sans">{d.name}: {d.value}</text></g>); })}
    </svg>
  );
}

// ─── MAP (geographic - bubble-style, no SVG world map) ───
function MapChart({ data, height }) {
  if (!data?.length) return null;
  const maxV = Math.max(...data.map(d => d.value), 1);
  // Render as a stylized region grid with intensity colors + a globe icon header
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return (
    <div className="px-4 py-2" style={{ minHeight: height }}>
      <div className="flex items-center gap-2 mb-3 text-[10px] font-mono text-wiz-dim">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#34D399" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        GEOGRAPHIC DISTRIBUTION · {sorted.length} regions
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {sorted.slice(0, 24).map((r, i) => {
          const intensity = r.value / maxV;
          return (
            <div key={i} className="relative rounded-xl p-3 overflow-hidden border border-wiz-border/30 transition-all hover:border-wiz-emerald/30" style={{ background: `linear-gradient(135deg, rgba(52,211,153,${intensity*0.18}) 0%, rgba(129,140,248,${intensity*0.08}) 100%)` }}>
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold font-display text-wiz-text truncate">{r.region}</div>
                  <div className="text-[10px] font-mono text-wiz-muted mt-0.5">{r.value.toLocaleString()}</div>
                </div>
                <div className="ml-2 w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-mono font-bold shrink-0" style={{ background: `rgba(52,211,153,${0.25 + intensity*0.5})`, color: intensity > 0.5 ? '#fff' : '#34D399' }}>
                  {Math.round(intensity * 100)}%
                </div>
              </div>
              <div className="mt-2 h-1 rounded-full bg-wiz-faint/30 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${intensity*100}%`, background: 'linear-gradient(90deg, #34D399, #818CF8)' }}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SUNBURST (concentric rings, custom SVG) ───
function SunburstChart({ data, height }) {
  if (!data?.length) return null;
  // Group by parent
  const parents = {};
  data.forEach(d => { if (!parents[d.parent]) parents[d.parent] = { name: d.parent, total: 0, children: [] }; parents[d.parent].total += d.value; parents[d.parent].children.push(d); });
  const parentArr = Object.values(parents).sort((a, b) => b.total - a.total);
  const totalAll = parentArr.reduce((s, p) => s + p.total, 0) || 1;
  const cx = 200, cy = height/2, rInner = 30, rMid = 80, rOuter = Math.min(140, height/2 - 10);

  let parentAngle = 0;
  const parentSlices = parentArr.map((p, i) => {
    const angle = (p.total / totalAll) * Math.PI * 2;
    const slice = { ...p, start: parentAngle, end: parentAngle + angle, color: C[i % C.length] };
    parentAngle += angle;
    return slice;
  });

  function arcPath(cx, cy, rIn, rOut, start, end) {
    const x1 = cx + rOut * Math.sin(start), y1 = cy - rOut * Math.cos(start);
    const x2 = cx + rOut * Math.sin(end), y2 = cy - rOut * Math.cos(end);
    const x3 = cx + rIn * Math.sin(end), y3 = cy - rIn * Math.cos(end);
    const x4 = cx + rIn * Math.sin(start), y4 = cy - rIn * Math.cos(start);
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4} Z`;
  }

  return (
    <svg width="100%" height={height} viewBox={`0 0 400 ${height}`}>
      {parentSlices.map((p, pi) => (
        <g key={pi}>
          <path d={arcPath(cx, cy, rInner, rMid, p.start, p.end)} fill={p.color} fillOpacity="0.7" stroke="#060A13" strokeWidth="1.5"/>
          {p.children.map((c, ci) => {
            const childAngle = (c.value / p.total) * (p.end - p.start);
            const childStart = p.start + p.children.slice(0, ci).reduce((s, x) => s + (x.value / p.total) * (p.end - p.start), 0);
            return <path key={ci} d={arcPath(cx, cy, rMid, rOuter, childStart, childStart + childAngle)} fill={p.color} fillOpacity={0.3 + ci * 0.1} stroke="#060A13" strokeWidth="1"/>;
          })}
          {(p.end - p.start) > 0.3 && <text x={cx + (rInner + rMid)/2 * Math.sin((p.start + p.end)/2)} y={cy - (rInner + rMid)/2 * Math.cos((p.start + p.end)/2)} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="600" fontFamily="DM Sans">{p.name.slice(0, 8)}</text>}
        </g>
      ))}
      <circle cx={cx} cy={cy} r={rInner} fill="#0C1220" stroke="rgba(30,41,59,0.6)"/>
      <text x={cx} y={cy+4} textAnchor="middle" fill="#94A3B8" fontSize="11" fontWeight="700" fontFamily="DM Sans">Total</text>
    </svg>
  );
}

// ─── GAUGE (KPI-style) ───
function GaugeChart({ data, height }) {
  if (!data?.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0);
  const top = data[0];
  const pct = total ? Math.min(100, (top.value / total) * 100) : 0;
  const cx = 150, cy = 110, r = 80;
  const startAngle = Math.PI * 0.75, endAngle = Math.PI * 2.25, range = endAngle - startAngle;
  const angle = startAngle + (pct / 100) * range;

  function arcPath(start, end) {
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }
  return (
    <svg width="100%" height={height} viewBox="0 0 300 200">
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke="rgba(30,41,59,0.6)" strokeWidth="14" strokeLinecap="round"/>
      <path d={arcPath(startAngle, angle)} fill="none" stroke={pct > 75 ? '#34D399' : pct > 40 ? '#FBBF24' : '#FB7185'} strokeWidth="14" strokeLinecap="round"/>
      <text x={cx} y={cy} textAnchor="middle" fill="#F1F5F9" fontSize="32" fontWeight="800" fontFamily="Bricolage Grotesque">{Math.round(pct)}%</text>
      <text x={cx} y={cy + 22} textAnchor="middle" fill="#64748B" fontSize="10" fontFamily="JetBrains Mono">{top?.name || ''}</text>
      <text x={cx} y={cy + 55} textAnchor="middle" fill="#94A3B8" fontSize="11" fontFamily="DM Sans">{top?.value?.toLocaleString() || 0} of {total.toLocaleString()}</text>
    </svg>
  );
}

// ─── WORD CLOUD ───
function WordCloudChart({ data, height }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  const min = Math.min(...data.map(d => d.count), 1);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-3" style={{ minHeight: height }}>
      {data.slice(0, 60).map((w, i) => {
        const intensity = (w.count - min) / (max - min || 1);
        const fontSize = 11 + intensity * 24;
        return (
          <span key={i} className="font-display font-bold transition-all hover:scale-110 cursor-default" style={{ fontSize: `${fontSize}px`, color: C[i % C.length], opacity: 0.55 + intensity * 0.45, lineHeight: 1.1 }} title={`${w.word}: ${w.count}`}>
            {w.word}
          </span>
        );
      })}
    </div>
  );
}

// ─── IMAGE GALLERY ───
function ImageGalleryChart({ data, height }) {
  if (!data?.length) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 px-3 py-2" style={{ minHeight: height, maxHeight: height + 100, overflowY: 'auto' }}>
      {data.map((img, i) => (
        <div key={i} className="aspect-square rounded-xl overflow-hidden border border-wiz-border/40 bg-wiz-bg/40 group relative">
          <img src={img.url} alt={img.label || ''} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" onError={(e) => {
            e.target.style.display = 'none';
            e.target.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center text-wiz-dim text-[9px] font-mono p-2 text-center">⊘ image<br/>not loaded</div>';
          }}/>
          {img.label && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-[9px] text-white font-mono truncate">{img.label}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── SANKEY (custom flow visualization) ───
function SankeyChart({ data, height }) {
  if (!data?.nodes?.length || !data?.links?.length) return null;
  const sources = [...new Set(data.links.map(l => l.source))];
  const targets = [...new Set(data.links.map(l => l.target))];
  const w = 500, mid = w / 2;
  const sourceTotal = sources.reduce((acc, s) => { acc[s] = data.links.filter(l => l.source === s).reduce((sum, l) => sum + l.value, 0); return acc; }, {});
  const targetTotal = targets.reduce((acc, t) => { acc[t] = data.links.filter(l => l.target === t).reduce((sum, l) => sum + l.value, 0); return acc; }, {});
  const totalFlow = Object.values(sourceTotal).reduce((s, v) => s + v, 0) || 1;
  const usableH = height - 40;
  const nodeGap = 4;

  let yOffset = 20;
  const sourcePos = sources.map((s, i) => {
    const h = (sourceTotal[s] / totalFlow) * (usableH - sources.length * nodeGap);
    const pos = { name: s, y: yOffset, h, color: C[i % C.length] };
    yOffset += h + nodeGap;
    return pos;
  });
  yOffset = 20;
  const targetPos = targets.map((t, i) => {
    const h = (targetTotal[t] / totalFlow) * (usableH - targets.length * nodeGap);
    const pos = { name: t, y: yOffset, h, color: C[(i + sources.length) % C.length] };
    yOffset += h + nodeGap;
    return pos;
  });

  // For each link, track how much of source/target has been consumed
  const sourceConsumed = {}, targetConsumed = {};
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${w + 60} ${height}`}>
      {data.links.map((l, i) => {
        const sp = sourcePos.find(p => p.name === l.source);
        const tp = targetPos.find(p => p.name === l.target);
        if (!sp || !tp) return null;
        const linkH = (l.value / totalFlow) * (usableH - sources.length * nodeGap);
        const sy = sp.y + (sourceConsumed[l.source] || 0);
        const ty = tp.y + (targetConsumed[l.target] || 0);
        sourceConsumed[l.source] = (sourceConsumed[l.source] || 0) + linkH;
        targetConsumed[l.target] = (targetConsumed[l.target] || 0) + linkH;
        const x1 = 110, x2 = w - 50;
        const path = `M ${x1} ${sy + linkH/2} C ${(x1+x2)/2} ${sy+linkH/2}, ${(x1+x2)/2} ${ty+linkH/2}, ${x2} ${ty+linkH/2}`;
        return <path key={i} d={path} stroke={sp.color} strokeWidth={Math.max(1, linkH)} fill="none" strokeOpacity="0.35"/>;
      })}
      {sourcePos.map((p, i) => (<g key={`s${i}`}><rect x={100} y={p.y} width={10} height={Math.max(2, p.h)} fill={p.color} rx="2"/><text x={95} y={p.y + p.h/2 + 3} textAnchor="end" fill="#94A3B8" fontSize="10" fontFamily="JetBrains Mono">{p.name}</text></g>))}
      {targetPos.map((p, i) => (<g key={`t${i}`}><rect x={w-50} y={p.y} width={10} height={Math.max(2, p.h)} fill={p.color} rx="2"/><text x={w-35} y={p.y + p.h/2 + 3} fill="#94A3B8" fontSize="10" fontFamily="JetBrains Mono">{p.name}</text></g>))}
    </svg>
  );
}

// ─── FORECAST ───
function ForecastChart({ data, spec, height }) {
  if (!data?.length) return null;
  const lastHist = data.findLastIndex(d => d.isHistory);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top:12, right:20, bottom:24, left:10 }}>
        <defs>
          <linearGradient id="confBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.25}/>
            <stop offset="100%" stopColor="#A78BFA" stopOpacity={0.05}/>
          </linearGradient>
        </defs>
        <CartesianGrid {...gr}/>
        <XAxis dataKey={spec.x} tick={ax} angle={-30} textAnchor="end" height={56} interval="preserveStartEnd" tickLine={false}/>
        <YAxis tick={ax} tickLine={false} axisLine={false}/>
        <Tooltip contentStyle={tt}/>
        <Legend wrapperStyle={{fontSize:11}}/>
        {/* History line */}
        <Line type="monotone" dataKey={spec.y} stroke="#818CF8" strokeWidth={2.5} dot={false} name="Actual" connectNulls={false}/>
        {/* Forecast confidence band - rendered as upper area */}
        <Area type="monotone" dataKey="upper" stroke="none" fill="url(#confBand)" name="95% CI"/>
        <Area type="monotone" dataKey="lower" stroke="none" fill="#060A13" name=" "/>
        {/* Forecast line */}
        <Line type="monotone" dataKey="forecast" stroke="#A78BFA" strokeWidth={2.5} strokeDasharray="6 4" dot={{r:3,fill:'#A78BFA'}} name="Forecast"/>
        {lastHist >= 0 && data[lastHist] && <ReferenceLine x={data[lastHist][spec.x]} stroke="#FBBF24" strokeDasharray="3 3" label={{ value: 'now', fill: '#FBBF24', fontSize: 10 }}/>}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── MAIN RENDERER ───
export default function ChartRenderer({ spec, chartData, stackKeys, height = 280, onClick }) {
  const data = useMemo(() => chartData || [], [chartData]);
  if (!data || (Array.isArray(data) && !data.length) || (data.nodes && !data.nodes.length)) {
    return <div className="flex items-center justify-center h-32 text-wiz-muted text-sm font-body">No data</div>;
  }
  const cm = { data, margin: { top: 12, right: 20, bottom: 24, left: 10 }, onClick };
  const xP = { tick: ax, angle: -30, textAnchor: 'end', height: 56, interval: 0, tickLine: false, axisLine: { stroke: 'rgba(30,41,59,0.4)' } };
  // Pie/Donut click prop is set on the Pie itself
  const pieClick = onClick ? (data, idx) => onClick({ activePayload: [{ payload: data }] }) : undefined;

  // Render the chart based on spec.type
  const chart = renderChartByType(spec, data, cm, xP, pieClick, stackKeys, height, onClick);

  // Wrap in a fade-up so the chart enters smoothly when it first mounts or
  // when the spec changes. Keyed by chart type + dataKey so swapping chart
  // types triggers a re-entrance instead of a frame-by-frame morph.
  return (
    <motion.div
      key={`${spec.type}-${spec.x}-${spec.y}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      style={{ width: '100%', height: '100%' }}
    >
      {chart}
    </motion.div>
  );
}

function renderChartByType(spec, data, cm, xP, pieClick, stackKeys, height, onClick) {
  switch (spec.type) {
    case 'bar': return <ResponsiveContainer width="100%" height={height}><BarChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt} cursor={{fill:'rgba(129,140,248,0.04)'}}/><Bar dataKey={spec.y} radius={[6,6,0,0]} maxBarSize={44}>{data.map((_,i)=><Cell key={i} fill={C[i%C.length]} fillOpacity={0.8}/>)}</Bar>{renderOverlays(spec)}</BarChart></ResponsiveContainer>;
    case 'horizontal_bar': return <ResponsiveContainer width="100%" height={height}><BarChart {...cm} layout="vertical"><CartesianGrid {...gr}/><XAxis type="number" tick={ax} tickLine={false} axisLine={false}/><YAxis dataKey={spec.x} type="category" tick={ax} width={100} tickLine={false}/><Tooltip contentStyle={tt}/><Bar dataKey={spec.y} radius={[0,6,6,0]} maxBarSize={26}>{data.map((_,i)=><Cell key={i} fill={C[i%C.length]} fillOpacity={0.8}/>)}</Bar>{renderOverlays(spec)}</BarChart></ResponsiveContainer>;
    case 'grouped_bar': return <ResponsiveContainer width="100%" height={height}><BarChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Legend wrapperStyle={{fontSize:11}}/><Bar dataKey={spec.y} fill="#818CF8" radius={[5,5,0,0]} fillOpacity={0.8}/>{spec.y2&&<Bar dataKey={spec.y2} fill="#34D399" radius={[5,5,0,0]} fillOpacity={0.8}/>}</BarChart></ResponsiveContainer>;
    case 'grouped_bar_multi': return <ResponsiveContainer width="100%" height={height}><BarChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Legend wrapperStyle={{fontSize:11}}/>{(stackKeys||[spec.y]).map((k,i)=><Bar key={k} dataKey={k} fill={C[i%C.length]} radius={[5,5,0,0]} fillOpacity={0.85} maxBarSize={36}/>)}{renderOverlays(spec)}</BarChart></ResponsiveContainer>;
    case 'stacked_bar': return <ResponsiveContainer width="100%" height={height}><BarChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Legend wrapperStyle={{fontSize:11}}/>{(stackKeys||[]).map((k,i)=><Bar key={k} dataKey={k} stackId="a" fill={C[i%C.length]} fillOpacity={0.8}/>)}{renderOverlays(spec)}</BarChart></ResponsiveContainer>;
    case 'line': return <ResponsiveContainer width="100%" height={height}><LineChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Line type="monotone" dataKey={spec.y} stroke="#E9A521" strokeWidth={2.5} dot={{fill:'#E9A521',r:3}} activeDot={{r:6,fill:'#F5C45E'}}/>{renderOverlays(spec)}</LineChart></ResponsiveContainer>;
    case 'multi_line': return <ResponsiveContainer width="100%" height={height}><LineChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Legend wrapperStyle={{fontSize:11}}/>{stackKeys && stackKeys.length > 1 ? stackKeys.map((k,i)=><Line key={k} type="monotone" dataKey={k} stroke={C[i%C.length]} strokeWidth={2.5} dot={{r:3,fill:C[i%C.length]}}/>) : (<><Line type="monotone" dataKey={spec.y} stroke="#818CF8" strokeWidth={2.5} dot={{r:3}}/>{spec.y2&&<Line type="monotone" dataKey={spec.y2} stroke="#34D399" strokeWidth={2.5} dot={{r:3}}/>}</>)}{renderOverlays(spec)}</LineChart></ResponsiveContainer>;
    case 'area': return <ResponsiveContainer width="100%" height={height}><AreaChart {...cm}><defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E9A521" stopOpacity={0.3}/><stop offset="100%" stopColor="#E9A521" stopOpacity={0}/></linearGradient></defs><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Area type="monotone" dataKey={spec.y} stroke="#E9A521" fill="url(#ag)" strokeWidth={2}/>{renderOverlays(spec)}</AreaChart></ResponsiveContainer>;
    case 'stacked_area': return <ResponsiveContainer width="100%" height={height}><AreaChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Legend wrapperStyle={{fontSize:11}}/>{(stackKeys||[]).map((k,i)=><Area key={k} type="monotone" dataKey={k} stackId="1" stroke={C[i%C.length]} fill={C[i%C.length]} fillOpacity={0.3}/>)}{renderOverlays(spec)}</AreaChart></ResponsiveContainer>;
    case 'forecast': return <ForecastChart data={data} spec={spec} height={height}/>;
    case 'scatter': return <ResponsiveContainer width="100%" height={height}><ScatterChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} name={spec.x} tick={ax} type="number" tickLine={false}/><YAxis dataKey={spec.y} name={spec.y} tick={ax} type="number" tickLine={false} axisLine={false}/><Tooltip contentStyle={tt} cursor={{strokeDasharray:'3 3',stroke:'#334155'}}/><Scatter fill="#818CF8" fillOpacity={0.65} r={5}/></ScatterChart></ResponsiveContainer>;
    case 'bubble': return <ResponsiveContainer width="100%" height={height}><ScatterChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} tick={ax} type="number" tickLine={false}/><YAxis dataKey={spec.y} tick={ax} type="number" tickLine={false} axisLine={false}/><ZAxis dataKey={spec.size} range={[40,400]}/><Tooltip contentStyle={tt}/><Scatter fill="#818CF8" fillOpacity={0.55}/></ScatterChart></ResponsiveContainer>;
    case 'pie': return <ResponsiveContainer width="100%" height={height}><PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={height/3} stroke="#060A13" strokeWidth={2} onClick={pieClick} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>{data.map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}</Pie><Tooltip contentStyle={tt}/></PieChart></ResponsiveContainer>;
    case 'donut': return <ResponsiveContainer width="100%" height={height}><PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={height/3} innerRadius={height/5} stroke="#060A13" strokeWidth={2} onClick={pieClick} label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>{data.map((_,i)=><Cell key={i} fill={C[i%C.length]}/>)}</Pie><Tooltip contentStyle={tt}/></PieChart></ResponsiveContainer>;
    case 'histogram': return <ResponsiveContainer width="100%" height={height}><BarChart data={data} margin={{top:12,right:20,bottom:24,left:10}}><CartesianGrid {...gr}/><XAxis dataKey="bin" tick={ax} angle={-30} textAnchor="end" height={56} tickLine={false}/><YAxis tick={ax} tickLine={false} axisLine={false}/><Tooltip contentStyle={tt}/><Bar dataKey="count" radius={[5,5,0,0]}>{data.map((_,i)=><Cell key={i} fill={`rgba(129,140,248,${0.35+i/data.length*0.55})`}/>)}</Bar></BarChart></ResponsiveContainer>;
    case 'radar': return <ResponsiveContainer width="100%" height={height}><RadarChart data={data} cx="50%" cy="50%" outerRadius={height/3}><PolarGrid stroke="rgba(30,41,59,0.5)"/><PolarAngleAxis dataKey="metric" tick={{fontSize:10,fill:'#94A3B8'}}/><PolarRadiusAxis tick={{fontSize:9,fill:'#475569'}}/><Radar dataKey="normalized" stroke="#818CF8" fill="#818CF8" fillOpacity={0.2} strokeWidth={2}/><Tooltip contentStyle={tt}/></RadarChart></ResponsiveContainer>;
    case 'treemap': return <ResponsiveContainer width="100%" height={height}><RTreemap data={data} dataKey="value" nameKey="name" stroke="#060A13" strokeWidth={2} content={({x,y,width:w,height:h,name,value,index})=>(<g><rect x={x} y={y} width={w} height={h} fill={C[(index||0)%C.length]} fillOpacity={0.7} rx={5}/>{w>50&&h>25&&<text x={x+w/2} y={y+h/2-6} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600">{name}</text>}{w>40&&h>25&&<text x={x+w/2} y={y+h/2+10} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10">{value}</text>}</g>)}/></ResponsiveContainer>;
    case 'combo': return <ResponsiveContainer width="100%" height={height}><ComposedChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey={spec.x} {...xP}/><YAxis yAxisId="left" tick={ax} tickLine={false}/><YAxis yAxisId="right" orientation="right" tick={ax} tickLine={false}/><Tooltip contentStyle={tt}/><Legend wrapperStyle={{fontSize:11}}/><Bar yAxisId="left" dataKey={spec.y} fill="#818CF8" fillOpacity={0.65} radius={[5,5,0,0]} maxBarSize={38}/>{spec.y2&&<Line yAxisId="right" type="monotone" dataKey={spec.y2} stroke="#34D399" strokeWidth={2.5} dot={{r:3}}/>}</ComposedChart></ResponsiveContainer>;
    case 'waterfall': return <ResponsiveContainer width="100%" height={height}><BarChart {...cm}><CartesianGrid {...gr}/><XAxis dataKey="name" {...xP}/><YAxis tick={ax} tickLine={false}/><Tooltip contentStyle={tt}/><Bar dataKey="start" stackId="a" fill="transparent"/><Bar dataKey="value" stackId="a" radius={[5,5,0,0]}>{data.map((d,i)=><Cell key={i} fill={d.isTotal?'#38BDF8':d.value>=0?'#34D399':'#FB7185'} fillOpacity={0.8}/>)}</Bar></BarChart></ResponsiveContainer>;
    case 'box_plot': return <BoxPlotShape data={data} height={height}/>;
    case 'heatmap': return <HeatmapChart data={data} height={height}/>;
    case 'funnel': return <FunnelChart data={data} height={height}/>;
    case 'map': return <MapChart data={data} height={height}/>;
    case 'sunburst': return <SunburstChart data={data} height={height}/>;
    case 'gauge': return <GaugeChart data={data} height={height}/>;
    case 'word_cloud': return <WordCloudChart data={data} height={height}/>;
    case 'image_gallery': return <ImageGalleryChart data={data} height={height}/>;
    case 'sankey': return <SankeyChart data={data} height={height}/>;

    // ─── v6.13: Dual-axis ────────────────────────────────────────────────
    case 'dual_axis': {
      const leftKind = spec.leftKind || 'bar';
      const rightKind = spec.rightKind || 'line';
      return (
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart {...cm}>
            <CartesianGrid {...gr}/>
            <XAxis dataKey={spec.x} {...xP}/>
            <YAxis yAxisId="left" tick={ax} tickLine={false} axisLine={false}
                   label={{ value: spec.y, angle: -90, position: 'insideLeft', fill: '#E9A521', fontSize: 10, fontFamily: 'Inter' }}/>
            <YAxis yAxisId="right" orientation="right" tick={ax} tickLine={false} axisLine={false}
                   label={{ value: spec.y2, angle: 90, position: 'insideRight', fill: '#3FA89E', fontSize: 10, fontFamily: 'Inter' }}/>
            <Tooltip contentStyle={tt}/>
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'Inter' }}/>
            {leftKind === 'bar'
              ? <Bar yAxisId="left" dataKey={spec.y} fill="#E9A521" fillOpacity={0.7} radius={[5,5,0,0]} maxBarSize={38}/>
              : <Line yAxisId="left" type="monotone" dataKey={spec.y} stroke="#E9A521" strokeWidth={2.5} dot={{r:3, fill:'#E9A521'}}/>}
            {rightKind === 'bar'
              ? <Bar yAxisId="right" dataKey={spec.y2} fill="#3FA89E" fillOpacity={0.7} radius={[5,5,0,0]} maxBarSize={38}/>
              : <Line yAxisId="right" type="monotone" dataKey={spec.y2} stroke="#3FA89E" strokeWidth={2.5} dot={{r:3, fill:'#3FA89E'}}/>}
            {/* Reference overlays — yAxisId='left' since reference values are
                resolved from the primary measure on the server side */}
            {renderOverlays(spec, 'left')}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    // ─── v6.13: Trellis (small multiples) ────────────────────────────────
    case 'trellis':
      return <TrellisChart spec={spec} height={height} onClick={onClick}/>;

    default: return <div className="flex items-center justify-center h-32 text-wiz-muted text-sm">Chart: {spec.type}</div>;
  }
}
