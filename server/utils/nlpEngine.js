class NLPEngine {
  static parseQuery(query, columns) {
    const q = query.toLowerCase().trim();
    const num = columns.filter(c => c.type === 'numeric');
    const cat = columns.filter(c => c.type === 'categorical');
    const time = columns.filter(c => c.type === 'temporal');
    const chartType = this.detectChart(q);
    const mentioned = this.findColumns(q, columns);
    const agg = this.detectAgg(q);
    const groupBy = this.findGroupBy(q, columns);
    const spec = this.buildSpec(chartType, mentioned, groupBy, agg, { num, cat, time, columns });
    return { ...spec, query, confidence: Math.min(0.3 + (mentioned.length >= 1 ? 0.25 : 0) + (mentioned.length >= 2 ? 0.15 : 0) + (groupBy ? 0.15 : 0) + (chartType !== 'bar' ? 0.15 : 0), 1), interpretation: `${spec.type.toUpperCase()} | X: ${spec.x} | Y: ${spec.y} | Agg: ${agg}` };
  }
  static detectChart(q) {
    const map = { line: /\b(line|trend|over time|growth|decline|time.?series)\b/, pie: /\b(pie|proportion|share|percentage|breakdown)\b/, donut: /\b(donut|doughnut|ring)\b/, scatter: /\b(scatter|correlation|vs|versus|relationship)\b/, bubble: /\b(bubble)\b/, area: /\b(area|cumulative|fill|volume)\b/, histogram: /\b(histogram|frequency|distribution.?of)\b/, heatmap: /\b(heatmap|heat.?map|matrix|intensity)\b/, treemap: /\b(treemap|tree.?map|hierarchy)\b/, radar: /\b(radar|spider|profile|multi.*dimension)\b/, waterfall: /\b(waterfall|cascade|bridge)\b/, funnel: /\b(funnel|conversion|pipeline|stages)\b/, box_plot: /\b(box.?plot|whisker|quartile)\b/, stacked_bar: /\b(stacked.?bar|stacked.?column)\b/, grouped_bar: /\b(grouped|side.?by.?side|clustered)\b/, horizontal_bar: /\b(horizontal|sideways)\b/, combo: /\b(combo|dual.?axis|combined)\b/, bar: /\b(bar|column|compare|ranking|top|bottom|highest|lowest)\b/ };
    for (const [t, p] of Object.entries(map)) if (p.test(q)) return t;
    return 'bar';
  }
  static findColumns(q, columns) {
    const found = [];
    for (const col of [...columns].sort((a, b) => b.name.length - a.name.length)) {
      const name = col.name.toLowerCase().replace(/[_-]/g, ' ');
      if ([name, ...name.split(' ').filter(w => w.length > 2)].some(v => q.includes(v)) && !found.some(f => f.name === col.name)) found.push(col);
    }
    return found;
  }
  static detectAgg(q) { if (/\b(average|avg|mean)\b/.test(q)) return 'avg'; if (/\b(sum|total)\b/.test(q)) return 'sum'; if (/\b(count|how many)\b/.test(q)) return 'count'; if (/\b(max|highest|top)\b/.test(q)) return 'max'; if (/\b(min|lowest|bottom)\b/.test(q)) return 'min'; return 'sum'; }
  static findGroupBy(q, columns) {
    const m = q.match(/\bby\s+(\w[\w\s]*?)(?:\s*$|\s+(?:and|over|in|for|from|with))/);
    if (!m) return null;
    for (const col of [...columns].sort((a, b) => b.name.length - a.name.length)) {
      const n = col.name.toLowerCase().replace(/[_-]/g, ' ');
      if (m[1].trim().includes(n) || n.includes(m[1].trim())) return col;
      for (const w of n.split(' ')) if (w.length > 2 && m[1].includes(w)) return col;
    }
    return null;
  }
  static buildSpec(type, mentioned, groupBy, agg, ctx) {
    const { num, cat, time, columns } = ctx;
    const mN = mentioned.filter(c => c.type === 'numeric'), mC = mentioned.filter(c => c.type === 'categorical'), mT = mentioned.filter(c => c.type === 'temporal');
    let x, y, extra = {};
    switch (type) {
      case 'pie': case 'donut': case 'treemap': case 'funnel': x = groupBy || mC[0] || cat[0]; y = mN[0] || num[0]; extra = { category: x?.name, value: y?.name }; break;
      case 'line': case 'area': case 'stacked_area': x = mT[0] || groupBy || time[0] || cat[0]; y = mN[0] || num[0]; break;
      case 'multi_line': case 'combo': x = mT[0] || groupBy || time[0] || cat[0]; y = mN[0] || num[0]; extra = { y2: (mN[1] || num[1])?.name }; break;
      case 'scatter': case 'bubble': x = mN[0] || num[0]; y = mN[1] || num[1] || num[0]; if (type === 'bubble' && num.length >= 3) extra = { size: (mN[2] || num[2])?.name }; break;
      case 'heatmap': x = mC[0] || cat[0]; y = mC[1] || cat[1] || cat[0]; extra = { value: (mN[0] || num[0])?.name }; break;
      case 'histogram': x = mN[0] || num[0]; y = null; break;
      case 'radar': x = 'metric'; y = 'value'; extra = { metrics: num.slice(0, 6).map(c => c.name) }; break;
      case 'box_plot': x = groupBy || mC[0] || cat[0]; y = mN[0] || num[0]; break;
      default: x = groupBy || mC[0] || cat[0] || time[0]; y = mN[0] || num[0]; break;
    }
    if (!x) x = columns[0]; if (!y && type !== 'histogram') y = num[0] || columns[1] || columns[0];
    return { type, title: `${y?.name || 'Values'} ${x ? `by ${x.name}` : ''}`.trim(), x: x?.name || columns[0]?.name, y: y?.name || columns[0]?.name, aggregation: agg, ...extra };
  }
  static generateSuggestions(columns) {
    const n = columns.filter(c => c.type === 'numeric'), ca = columns.filter(c => c.type === 'categorical'), t = columns.filter(c => c.type === 'temporal');
    const s = [];
    if (ca[0] && n[0]) { s.push(`Show ${n[0].name} by ${ca[0].name}`); s.push(`Pie chart of ${n[0].name} by ${ca[0].name}`); s.push(`Horizontal bar ranking of ${n[0].name}`); }
    if (t[0] && n[0]) { s.push(`Trend of ${n[0].name} over time`); s.push(`Area chart of ${n[0].name}`); }
    if (n.length >= 2) { s.push(`Scatter plot ${n[0].name} vs ${n[1].name}`); s.push(`Combo chart of ${n[0].name} and ${n[1].name}`); }
    if (n.length >= 3) s.push(`Radar chart comparing all metrics`);
    if (ca.length >= 2 && n[0]) s.push(`Heatmap of ${n[0].name} by ${ca[0].name} and ${ca[1].name}`);
    if (n[0]) s.push(`Histogram of ${n[0].name} distribution`);
    if (ca[0] && n[0]) s.push(`Box plot of ${n[0].name} by ${ca[0].name}`);
    if (ca[0] && n[0]) s.push(`Funnel chart of ${n[0].name}`);
    return s.slice(0, 8);
  }
}
module.exports = NLPEngine;
