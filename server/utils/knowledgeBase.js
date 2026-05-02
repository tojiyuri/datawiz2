/**
 * KnowledgeBase v2 - Expanded with map, text, image, sankey, sunburst, gauge, forecast
 */

const RULES = [
  // ─── BAR FAMILY ───
  { id:'rule_bar', type:'bar', baseScore:90, intent:'comparison',
    conditions: { catCount:[1,2], numCount:[1,'+'], maxUniqueInCat:25 },
    useCase: 'Compare a numeric measure across categories. Best with 3-15 categories.',
    bestFor: ['comparison', 'ranking'] },

  { id:'rule_horizontal_bar', type:'horizontal_bar', baseScore:82, intent:'ranking',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], maxUniqueInCat:30 },
    useCase: 'Horizontal layout for long category names or many categories.',
    bestFor: ['long labels', 'top-N rankings'] },

  { id:'rule_grouped_bar', type:'grouped_bar', baseScore:78, intent:'multi-comparison',
    conditions: { catCount:[1,'+'], numCount:[2,3], maxUniqueInCat:12 },
    useCase: 'Compare 2-3 numeric measures side-by-side per category.',
    bestFor: ['multi-measure', 'before/after'] },

  { id:'rule_stacked_bar', type:'stacked_bar', baseScore:74, intent:'composition',
    conditions: { catCount:[2,'+'], numCount:[1,'+'], maxUniqueInCat:15, secondCatUnique:[2,8] },
    useCase: 'Numeric value broken down by sub-category within each main category.',
    bestFor: ['part-to-whole', 'breakdown'] },

  // ─── TIME SERIES ───
  { id:'rule_line', type:'line', baseScore:95, intent:'trend',
    conditions: { timeCount:[1,'+'], numCount:[1,'+'] },
    useCase: 'Show trends over time. The gold standard for time-series.',
    bestFor: ['trends', 'time series'] },

  { id:'rule_forecast', type:'forecast', baseScore:88, intent:'prediction',
    conditions: { timeCount:[1,'+'], numCount:[1,'+'], minRows:6 },
    useCase: 'Linear regression forecast with 95% confidence interval — predicts next 5 periods.',
    bestFor: ['forecasting', 'prediction', 'future planning'] },

  { id:'rule_multi_line', type:'multi_line', baseScore:84, intent:'trend-comparison',
    conditions: { timeCount:[1,'+'], numCount:[2,'+'] },
    useCase: 'Compare multiple metrics trending over the same time period.',
    bestFor: ['comparing trends'] },

  { id:'rule_area', type:'area', baseScore:80, intent:'volume-trend',
    conditions: { timeCount:[1,'+'], numCount:[1,'+'], minRows:6 },
    useCase: 'Like line chart but emphasizes magnitude/volume.',
    bestFor: ['volume', 'cumulative'] },

  { id:'rule_stacked_area', type:'stacked_area', baseScore:72, intent:'composition-time',
    conditions: { timeCount:[1,'+'], numCount:[1,'+'], catCount:[1,'+'] },
    useCase: 'How composition changes across categories over time.',
    bestFor: ['composition over time'] },

  // ─── PROPORTION ───
  { id:'rule_pie', type:'pie', baseScore:78, intent:'proportion',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], maxUniqueInCat:7 },
    useCase: 'Parts of a whole. Best with ≤7 slices.',
    bestFor: ['proportions', 'market share'] },

  { id:'rule_donut', type:'donut', baseScore:76, intent:'proportion',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], maxUniqueInCat:8 },
    useCase: 'Modern pie with center for a key metric.',
    bestFor: ['proportions with summary'] },

  { id:'rule_sunburst', type:'sunburst', baseScore:68, intent:'hierarchy',
    conditions: { catCount:[2,'+'], numCount:[1,'+'], maxUniqueInCat:10 },
    useCase: 'Hierarchical proportions — inner ring is parent category, outer is child.',
    bestFor: ['hierarchy', 'nested proportions'] },

  { id:'rule_treemap', type:'treemap', baseScore:68, intent:'hierarchy',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], maxUniqueInCat:20 },
    useCase: 'Rectangle size shows relative proportions — space-efficient.',
    bestFor: ['hierarchical proportions'] },

  // ─── CORRELATION ───
  { id:'rule_scatter', type:'scatter', baseScore:90, intent:'correlation',
    conditions: { numCount:[2,'+'], minRows:15 },
    useCase: 'Reveals correlations and clusters between two numeric measures.',
    bestFor: ['correlations', 'clusters'] },

  { id:'rule_bubble', type:'bubble', baseScore:75, intent:'multi-correlation',
    conditions: { numCount:[3,'+'], minRows:15 },
    useCase: 'Adds a 3rd dimension via bubble size.',
    bestFor: ['3-dimensional analysis'] },

  // ─── DISTRIBUTION ───
  { id:'rule_histogram', type:'histogram', baseScore:80, intent:'distribution',
    conditions: { numCount:[1,'+'], minRows:20 },
    useCase: 'Frequency distribution — see if data is normal, skewed, bimodal.',
    bestFor: ['distribution shape'] },

  { id:'rule_box_plot', type:'box_plot', baseScore:77, intent:'distribution-comparison',
    conditions: { numCount:[1,'+'], catCount:[1,'+'], maxUniqueInCat:12 },
    useCase: 'Compare distributions across categories — shows median, quartiles, outliers.',
    bestFor: ['distribution by group', 'outlier detection'] },

  { id:'rule_gauge', type:'gauge', baseScore:65, intent:'kpi',
    conditions: { numCount:[1,'+'] },
    useCase: 'KPI gauge — shows a single metric vs target/range.',
    bestFor: ['KPIs', 'single metrics'] },

  // ─── PATTERN ───
  { id:'rule_heatmap', type:'heatmap', baseScore:75, intent:'2d-pattern',
    conditions: { catCount:[2,'+'], numCount:[1,'+'], maxUniqueInCat:15 },
    useCase: '2D color matrix — spot patterns and hotspots.',
    bestFor: ['cross-tab', 'hotspots'] },

  { id:'rule_sankey', type:'sankey', baseScore:64, intent:'flow',
    conditions: { catCount:[2,'+'], numCount:[1,'+'], maxUniqueInCat:10 },
    useCase: 'Show flow between two categorical stages — width = volume.',
    bestFor: ['flow', 'transitions', 'process'] },

  // ─── GEOGRAPHIC ───
  { id:'rule_map', type:'map', baseScore:92, intent:'geographic',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], requiresGeographic:true },
    useCase: 'Choropleth map — color regions by metric value.',
    bestFor: ['regional analysis', 'country/state comparison'] },

  // ─── SPECIALTY ───
  { id:'rule_radar', type:'radar', baseScore:65, intent:'multi-metric',
    conditions: { numCount:[3,8] },
    useCase: 'Compare across multiple metrics on a spider web.',
    bestFor: ['multi-dimensional profiles'] },

  { id:'rule_waterfall', type:'waterfall', baseScore:60, intent:'flow',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], maxRows:20 },
    useCase: 'How individual contributions build to a total.',
    bestFor: ['running totals'] },

  { id:'rule_funnel', type:'funnel', baseScore:58, intent:'conversion',
    conditions: { catCount:[1,'+'], numCount:[1,'+'], maxUniqueInCat:8 },
    useCase: 'Progressive reduction through stages.',
    bestFor: ['conversion'] },

  { id:'rule_combo', type:'combo', baseScore:72, intent:'dual-axis',
    conditions: { catCount:[1,'+'], numCount:[2,'+'] },
    useCase: 'Combine bars and lines on dual axes.',
    bestFor: ['dual-axis'] },

  // ─── TEXT ───
  { id:'rule_word_cloud', type:'word_cloud', baseScore:70, intent:'text-frequency',
    conditions: { textCount:[1,'+'] },
    useCase: 'Visualize most common words from text data — size = frequency.',
    bestFor: ['text frequency', 'topic analysis'] },

  { id:'rule_text_length_dist', type:'histogram', baseScore:55, intent:'text-distribution',
    conditions: { textCount:[1,'+'] },
    useCase: 'See how long text values typically are.',
    bestFor: ['text length analysis'] },

  // ─── IMAGE ───
  { id:'rule_image_gallery', type:'image_gallery', baseScore:88, intent:'visual',
    conditions: { imageCount:[1,'+'] },
    useCase: 'Display image thumbnails in a gallery grid.',
    bestFor: ['visual review', 'image data'] },
];

const SEMANTIC_HINTS = {
  currency: /\b(price|cost|revenue|sales|profit|amount|total|balance|spend|expense|earnings|salary|pay|wage|fee|charge|income|usd|inr|eur)\b/i,
  percent: /\b(rate|ratio|percent|percentage|pct|growth|share|conversion|margin)\b/i,
  count: /\b(count|number|qty|quantity|units|orders|customers|users|visitors|transactions)\b/i,
  identifier: /\b(id|code|sku|key|reference|uuid|guid)\b/i,
  date: /\b(date|day|month|year|time|created|updated|modified|timestamp)\b/i,
  geographic: /\b(country|state|region|city|zip|postal|location|address|area|province|district)\b/i,
  rating: /\b(rating|score|stars|rank|grade|review)\b/i,
  url: /\b(url|link|website|image|photo|picture|thumbnail)\b/i,
};

function getSemanticHint(name) {
  const n = name.toLowerCase();
  for (const [k, regex] of Object.entries(SEMANTIC_HINTS)) {
    if (regex.test(n)) return k;
  }
  return null;
}

function matchRule(rule, ctx) {
  const { conditions } = rule;
  const inRange = (val, range) => {
    if (!range) return true;
    const [min, max] = range;
    if (val < min) return false;
    if (max !== '+' && val > max) return false;
    return true;
  };
  if (!inRange(ctx.numCount, conditions.numCount)) return false;
  if (!inRange(ctx.catCount, conditions.catCount)) return false;
  if (!inRange(ctx.timeCount, conditions.timeCount)) return false;
  if (!inRange(ctx.textCount || 0, conditions.textCount)) return false;
  if (!inRange(ctx.imageCount || 0, conditions.imageCount)) return false;
  if (conditions.maxUniqueInCat && ctx.maxUniqueInCat > conditions.maxUniqueInCat) return false;
  if (conditions.minRows && ctx.rows < conditions.minRows) return false;
  if (conditions.maxRows && ctx.rows > conditions.maxRows) return false;
  if (conditions.secondCatUnique && (ctx.secondCatUnique < conditions.secondCatUnique[0] || ctx.secondCatUnique > conditions.secondCatUnique[1])) return false;
  if (conditions.requiresGeographic && !ctx.hasGeographic) return false;
  return true;
}

module.exports = { RULES, SEMANTIC_HINTS, getSemanticHint, matchRule };
