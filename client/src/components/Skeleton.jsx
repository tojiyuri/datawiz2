/**
 * Skeleton loaders — show shapes that match what's loading instead of bare
 * spinners. Reduces layout shift and feels more "in progress" than "broken."
 *
 * The shimmer animation lives in index.css (.skeleton class). These are
 * just composed shapes for common scenarios.
 */

/** Simple text line — adjust width to taste. */
export function SkeletonLine({ width = '100%', className = '' }) {
  return <div className={`skeleton skeleton-text ${className}`} style={{ width }} />;
}

/** A title block — wider line, slightly taller, used as page-header placeholder. */
export function SkeletonTitle({ width = '40%', className = '' }) {
  return <div className={`skeleton skeleton-title ${className}`} style={{ width }} />;
}

/** A chart-shaped block (16:9 aspect). Matches what a real chart will fill. */
export function SkeletonChart({ className = '' }) {
  return <div className={`skeleton skeleton-block ${className}`} />;
}

/**
 * A card-shaped placeholder — title + a few lines + a chart shape. Use as
 * the placeholder while a sheet/dashboard tile is loading.
 */
export function SkeletonCard({ showChart = false, lines = 2 }) {
  return (
    <div className="card p-4">
      <SkeletonTitle width="50%" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} width={i === lines - 1 ? '60%' : '90%'} className="mb-1.5" />
      ))}
      {showChart && (
        <div className="mt-3">
          <SkeletonChart />
        </div>
      )}
    </div>
  );
}

/**
 * A grid of skeleton cards — useful while listing sheets/dashboards.
 */
export function SkeletonGrid({ count = 6, columns = 3 }) {
  const colsClass = columns === 2 ? 'md:grid-cols-2' : columns === 3 ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4';
  return (
    <div className={`grid grid-cols-1 ${colsClass} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} showChart lines={1} />
      ))}
    </div>
  );
}

/**
 * Stat-ribbon skeleton — for the 6-cell ribbon on AnalysisPage while
 * its analysis is fetching.
 */
export function SkeletonStatRibbon({ cells = 6 }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 mb-12 border-y border-wiz-border">
      {Array.from({ length: cells }).map((_, i) => (
        <div key={i} className={`py-4 px-3 ${i > 0 ? 'border-l border-wiz-border' : ''}`}>
          <SkeletonLine width="40%" className="mb-2" />
          <SkeletonTitle width="70%" className="mb-0" />
        </div>
      ))}
    </div>
  );
}
