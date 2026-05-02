/**
 * ChartRecommender v5 - Knowledge base + learning + memory + expert insights.
 * Supports all 25+ chart types including map, sankey, sunburst, gauge,
 * word_cloud, image_gallery, forecast.
 */
const { RULES, getSemanticHint, matchRule } = require('./knowledgeBase');
const learning = require('./learningEngine');
const memory = require('./visualizationMemory');
const { generateExpertInsights } = require('./insightEngine');

class ChartRecommender {
  static recommend(columns, data, datasetMeta = {}) {
    // EXCLUDE identifiers, coordinates, and year from being aggregated as Y-axis metrics
    // They're "numeric" technically but summing them is meaningless
    const isMetric = c => c.type === 'numeric'
      && c.subtype !== 'identifier'
      && c.subtype !== 'coordinate';
    const num = columns.filter(isMetric);
    // Categorical with only 1 unique value is useless for any chart (it's a constant)
    const cat = columns.filter(c => c.type === 'categorical' && (c.stats?.unique || 0) >= 2);

    // Time columns include both regular temporals AND year/month_name/etc.
    // BUT exclude them from numeric metrics
    const time = columns.filter(c => c.type === 'temporal');
    const text = columns.filter(c => c.type === 'text' && c.subtype !== 'identifier');
    const image = columns.filter(c => c.type === 'image');

    // Sort time columns by usefulness for x-axis: prefer more unique values (better resolution)
    // and prefer regular temporal > month_name > year (more specific = more useful)
    const timeUsefulness = c => {
      const unique = c.stats?.unique || 0;
      if (unique < 2) return -1;
      const subtypeBonus = c.subtype === 'year' ? 0 :
                          c.subtype === 'month_num' ? 5 :
                          c.subtype === 'month_name' ? 10 :
                          c.subtype === 'day_of_week' ? 7 : 20; // regular dates
      return unique + subtypeBonus;
    };
    const timeSorted = [...time].sort((a, b) => timeUsefulness(b) - timeUsefulness(a))
                                  .filter(c => (c.stats?.unique || 0) >= 2);

    // Geographic columns - require >1 unique region for maps to be useful
    const geoCols = cat.filter(c =>
      (c.stats?.isGeographic || c.semantic === 'geographic') &&
      (c.stats?.unique || 0) > 1
    );

    const ctx = {
      numCount: num.length, catCount: cat.length, timeCount: timeSorted.length,
      textCount: text.length, imageCount: image.length,
      rows: data.length,
      maxUniqueInCat: cat.length ? Math.max(...cat.map(c => c.stats?.unique || 0)) : 0,
      secondCatUnique: cat.length >= 2 ? cat[1].stats?.unique || 0 : 0,
      hasGeographic: geoCols.length > 0,
    };

    columns.forEach(c => { c.semantic = c.semantic || getSemanticHint(c.name); });

    const memInfo = memory.getMemoryBoosts(columns);
    const memBoosts = memInfo.boosts;

    const recs = [];
    for (const rule of RULES) {
      if (!matchRule(rule, ctx)) continue;
      const variants = this._buildVariants(rule, num, cat, timeSorted, text, image, geoCols, columns, data, ctx, memBoosts);
      recs.push(...variants);
    }

    recs.sort((a, b) => b.score - a.score);

    // Deduplicate
    const seen = new Set();
    const unique = [];
    for (const r of recs) {
      const sig = `${r.type}|${r.x}|${r.y}|${r.stack || ''}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      unique.push(r);
    }

    const final = unique.slice(0, 14);

    // Generate insights AND record in memory
    final.forEach(rec => {
      try {
        const insights = generateExpertInsights(rec, data, columns);
        rec.insights = insights;                           // structured insights
        rec.insight = insights.map(i => i.text).join(' '); // concatenated for backwards-compat
      } catch (e) {
        rec.insight = rec.bestFor?.[0] ? `Best for: ${rec.bestFor.join(', ')}.` : '';
        rec.insights = [];
      }
      try { memory.recordChart(rec, columns, datasetMeta.id, datasetMeta.fileName); } catch {}
    });

    learning.recordRecommendation(final.length);
    return { recommendations: final, similarMemoriesCount: memInfo.similarMemoriesCount };
  }

  static _buildVariants(rule, num, cat, time, text, image, geoCols, allCols, data, ctx, memBoosts) {
    const variants = [];
    const learnW = learning.getWeight(rule.type, ctx);
    const memW = memBoosts[rule.type] || 1.0;
    const adjustedScore = rule.baseScore * learnW * memW;
    const make = (extra) => this._buildSpec(rule, { ...extra, score: adjustedScore - (variants.length * 2), learningWeight: learnW, memoryBoost: memW }, allCols);

    switch (rule.type) {
      case 'bar': case 'horizontal_bar': case 'box_plot':
        for (const c of cat.slice(0, 2)) for (const n of num.slice(0, 3)) variants.push(make({ x: c.name, y: n.name }));
        break;

      case 'grouped_bar': case 'combo':
        if (num.length >= 2) for (const c of cat.slice(0, 2)) variants.push(make({ x: c.name, y: num[0].name, y2: num[1].name }));
        break;

      case 'stacked_bar':
        if (cat.length >= 2 && num.length >= 1) variants.push(make({ x: cat[0].name, y: num[0].name, stack: cat[1].name }));
        break;

      case 'line': case 'area':
        for (const t of time.slice(0, 1)) for (const n of num.slice(0, 3)) variants.push(make({ x: t.name, y: n.name }));
        if (!time.length && cat.length && num.length) variants.push(make({ x: cat[0].name, y: num[0].name }));
        break;

      case 'forecast':
        if (time.length && num.length) for (const n of num.slice(0, 2)) variants.push(make({ x: time[0].name, y: n.name }));
        break;

      case 'multi_line':
        if (time.length && num.length >= 2) variants.push(make({ x: time[0].name, y: num[0].name, y2: num[1].name }));
        break;

      case 'stacked_area':
        if (time.length && num.length && cat.length) variants.push(make({ x: time[0].name, y: num[0].name, stack: cat[0].name }));
        break;

      case 'pie': case 'donut': case 'treemap': case 'funnel':
        for (const c of cat.slice(0, 2)) for (const n of num.slice(0, 2)) {
          if ((c.stats?.unique || 99) <= (rule.conditions.maxUniqueInCat || 99))
            variants.push(make({ x: c.name, y: n.name, category: c.name, value: n.name }));
        }
        break;

      case 'sunburst':
        if (cat.length >= 2 && num.length >= 1) variants.push(make({ x: cat[0].name, y: num[0].name, stack: cat[1].name, category: cat[0].name, value: num[0].name }));
        break;

      case 'gauge':
        for (const n of num.slice(0, 2)) variants.push(make({ x: 'gauge', y: n.name, value: n.name }));
        break;

      case 'scatter':
        if (num.length >= 2) for (let i = 0; i < Math.min(num.length, 3); i++)
          for (let j = i + 1; j < Math.min(num.length, 4); j++) variants.push(make({ x: num[i].name, y: num[j].name }));
        break;

      case 'bubble':
        if (num.length >= 3) variants.push(make({ x: num[0].name, y: num[1].name, size: num[2].name }));
        break;

      case 'histogram':
        // Numeric histogram
        for (const n of num.slice(0, 3)) variants.push(make({ x: n.name, y: 'count' }));
        // Text length histogram
        if (text.length && rule.id === 'rule_text_length_dist') {
          for (const t of text.slice(0, 1)) variants.push(make({ x: t.name, y: 'length' }));
        }
        break;

      case 'heatmap':
        if (cat.length >= 2 && num.length >= 1) variants.push(make({ x: cat[0].name, y: cat[1].name, value: num[0].name }));
        break;

      case 'sankey':
        if (cat.length >= 2 && num.length >= 1) variants.push(make({ x: cat[0].name, y: num[0].name, stack: cat[1].name, value: num[0].name }));
        break;

      case 'map':
        if (geoCols.length && num.length) for (const g of geoCols.slice(0, 1)) for (const n of num.slice(0, 2)) {
          variants.push(make({ x: g.name, y: n.name, category: g.name, value: n.name }));
        }
        break;

      case 'radar':
        if (num.length >= 3) variants.push(make({ x: 'metric', y: 'value', metrics: num.slice(0, 6).map(c => c.name) }));
        break;

      case 'waterfall':
        if (cat.length && num.length && data.length <= 20) variants.push(make({ x: cat[0].name, y: num[0].name }));
        break;

      case 'word_cloud':
        for (const t of text.slice(0, 2)) variants.push(make({ x: t.name, y: 'frequency' }));
        break;

      case 'image_gallery':
        for (const img of image.slice(0, 1)) {
          // Try to find a label column (first text or categorical)
          const labelCol = text[0]?.name || cat[0]?.name;
          variants.push(make({ x: img.name, y: 'image', label: labelCol, value: num[0]?.name }));
        }
        break;
    }
    return variants;
  }

  static _buildSpec(rule, extra, allCols) {
    const xCol = allCols.find(c => c.name === extra.x);
    const yCol = allCols.find(c => c.name === extra.y);
    let title;
    switch (rule.type) {
      case 'histogram': title = `Distribution of ${extra.x}`; break;
      case 'forecast': title = `${extra.y} Forecast (next 5 periods)`; break;
      case 'radar': title = 'Multi-Metric Profile'; break;
      case 'map': title = `${extra.y} by ${extra.x} (Map)`; break;
      case 'sankey': title = `Flow: ${extra.x} → ${extra.stack}`; break;
      case 'sunburst': title = `${extra.y}: ${extra.x} → ${extra.stack}`; break;
      case 'word_cloud': title = `Top Words in ${extra.x}`; break;
      case 'image_gallery': title = `${extra.x} Gallery`; break;
      case 'gauge': title = `${extra.y} Gauge`; break;
      default:
        if (extra.y2) title = `${extra.y} & ${extra.y2} by ${extra.x}`;
        else if (extra.stack) title = `${extra.y} by ${extra.x} (split: ${extra.stack})`;
        else if (extra.size) title = `${extra.x} vs ${extra.y} (size: ${extra.size})`;
        else title = `${extra.y} by ${extra.x}`;
    }
    return {
      type: rule.type, title, ...extra,
      score: extra.score,
      reason: rule.useCase,
      bestFor: rule.bestFor,
      intent: rule.intent,
      tags: [rule.intent],
      ruleId: rule.id,
      semanticX: xCol?.semantic,
      semanticY: yCol?.semantic,
      priority: extra.score >= 85 ? 'high' : extra.score >= 70 ? 'medium' : 'low',
    };
  }
}

module.exports = ChartRecommender;
