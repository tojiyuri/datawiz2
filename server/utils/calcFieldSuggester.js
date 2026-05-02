/**
 * calcFieldSuggester - Look at the dataset's columns and propose calculated fields.
 *
 * Approach: pattern-match field names against a domain knowledge base of common
 * KPIs (Profit, Margin, Conversion Rate, AOV, etc.). Each suggestion has:
 *   - name: proposed calc field name
 *   - formula: formula using actual column names
 *   - description: why this is useful
 *   - confidence: how sure the system is
 */

// Pattern: list of regexes that must match column names
// Each rule produces a calc field given matched columns
const RULES = [
  {
    name: 'Profit',
    description: 'Difference between revenue and cost',
    requires: [
      { key: 'revenue', patterns: [/^sales$/i, /^revenue$/i, /^income$/i, /total_sales/i, /gross_revenue/i] },
      { key: 'cost', patterns: [/^cost$/i, /^expense/i, /total_cost/i, /^cogs$/i] },
    ],
    formula: (m) => `[${m.revenue}] - [${m.cost}]`,
    confidence: 0.95,
  },
  {
    name: 'Profit Margin %',
    description: 'Profit as a percentage of revenue',
    requires: [
      { key: 'revenue', patterns: [/^sales$/i, /^revenue$/i, /^income$/i, /total_sales/i] },
      { key: 'cost', patterns: [/^cost$/i, /^expense/i, /total_cost/i, /^cogs$/i] },
    ],
    formula: (m) => `ROUND(([${m.revenue}] - [${m.cost}]) / [${m.revenue}] * 100, 1)`,
    confidence: 0.9,
  },
  {
    name: 'Conversion Rate %',
    description: 'Conversions divided by visits/leads',
    requires: [
      { key: 'conversions', patterns: [/conversion/i, /^orders$/i, /^purchases$/i, /^signups$/i] },
      { key: 'visits', patterns: [/^visits$/i, /^visitors$/i, /^leads$/i, /^sessions$/i, /^impressions$/i] },
    ],
    formula: (m) => `ROUND([${m.conversions}] / [${m.visits}] * 100, 2)`,
    confidence: 0.9,
  },
  {
    name: 'Average Order Value',
    description: 'Revenue per order',
    requires: [
      { key: 'revenue', patterns: [/^sales$/i, /^revenue$/i, /^total$/i] },
      { key: 'orders', patterns: [/^orders$/i, /^transactions$/i, /^purchases$/i] },
    ],
    formula: (m) => `ROUND([${m.revenue}] / [${m.orders}], 2)`,
    confidence: 0.85,
  },
  {
    name: 'Click-Through Rate %',
    description: 'Clicks divided by impressions',
    requires: [
      { key: 'clicks', patterns: [/^clicks$/i] },
      { key: 'impressions', patterns: [/^impressions$/i, /^views$/i] },
    ],
    formula: (m) => `ROUND([${m.clicks}] / [${m.impressions}] * 100, 2)`,
    confidence: 0.95,
  },
  {
    name: 'Discount %',
    description: 'Discount as percentage of original price',
    requires: [
      { key: 'discount', patterns: [/^discount$/i, /discount_amount/i] },
      { key: 'price', patterns: [/^price$/i, /list_price/i, /msrp/i, /original_price/i] },
    ],
    formula: (m) => `ROUND([${m.discount}] / [${m.price}] * 100, 1)`,
    confidence: 0.85,
  },
  {
    name: 'Net Revenue',
    description: 'Revenue minus discounts and returns',
    requires: [
      { key: 'revenue', patterns: [/^sales$/i, /^revenue$/i, /gross_revenue/i] },
      { key: 'discount', patterns: [/^discount$/i, /returns/i, /refunds/i] },
    ],
    formula: (m) => `[${m.revenue}] - [${m.discount}]`,
    confidence: 0.8,
  },
  {
    name: 'BMI',
    description: 'Body Mass Index from weight and height',
    requires: [
      { key: 'weight', patterns: [/^weight/i, /weight_kg/i] },
      { key: 'height', patterns: [/^height/i, /height_m$/i] },
    ],
    formula: (m) => `ROUND([${m.weight}] / POW([${m.height}], 2), 1)`,
    confidence: 0.85,
  },
  {
    name: 'Days Since',
    description: 'Days between today and a given date',
    requires: [
      { key: 'date', patterns: [/_date$/i, /^date$/i, /^created/i, /timestamp/i] },
    ],
    formula: (m) => `DATEDIFF([${m.date}], TODAY())`,
    confidence: 0.7,
  },
  // Stress/Mental health pattern (saw this in user's mental_health dataset)
  {
    name: 'Wellness Score',
    description: 'Composite of stress, anxiety, depression (lower = better)',
    requires: [
      { key: 'stress', patterns: [/stress/i] },
      { key: 'anxiety', patterns: [/anxiety/i] },
      { key: 'depression', patterns: [/depression/i] },
    ],
    formula: (m) => `ROUND(([${m.stress}] + [${m.anxiety}] + [${m.depression}]) / 3, 1)`,
    confidence: 0.85,
  },
];

function suggestCalcFields(analysis) {
  const cols = analysis?.columns || [];
  const numericCols = cols.filter(c => c.type === 'numeric' && c.subtype !== 'identifier' && c.subtype !== 'year');
  const numericNames = numericCols.map(c => c.name);
  const dateCols = cols.filter(c => c.type === 'temporal' || c.subtype === 'date');

  const suggestions = [];

  for (const rule of RULES) {
    const matched = {};
    let allMatched = true;
    for (const req of rule.requires) {
      // Find a numeric column whose name matches any pattern
      const candidates = req.patterns.flatMap(p =>
        (req.key === 'date' ? dateCols : numericCols).filter(c => p.test(c.name))
      );
      if (!candidates.length) { allMatched = false; break; }
      // Pick the first match
      matched[req.key] = candidates[0].name;
    }
    if (!allMatched) continue;
    suggestions.push({
      name: rule.name,
      formula: rule.formula(matched),
      description: rule.description,
      confidence: rule.confidence,
      sourceFields: Object.values(matched),
    });
  }

  return suggestions;
}

module.exports = { suggestCalcFields };
