/**
 * Hierarchies / drill-down.
 *
 * A hierarchy is an ordered list of dimensions: Country → State → City.
 * The user picks a level, and the chart aggregates at that level. Drill
 * down by clicking a value to filter to that value AND advance to the next
 * level.
 *
 * Hierarchy shape:
 *   { name: 'Geography', levels: ['Country', 'State', 'City'] }
 *
 * Drill state: { hierarchyName, level, path: [{level, value}, ...] }
 *   - level: 0-indexed current depth
 *   - path: drilled-into values that filter the underlying data
 *
 * Example:
 *   Initial:    { hierarchyName: 'Geography', level: 0, path: [] }
 *               → groups by Country, shows USA, Canada, UK, ...
 *   User clicks "USA":
 *               { hierarchyName: 'Geography', level: 1, path: [{level: 0, value: 'USA'}] }
 *               → filters to Country=USA, groups by State
 *
 * The `applyDrillState` function returns:
 *   - filterFor(row): predicate to filter source data by the drill path
 *   - currentLevel: column name to use for the X axis at this level
 *   - canDrillUp / canDrillDown / breadcrumbs: for UI affordances
 */

function validateHierarchy(h, columnNames = []) {
  if (!h || !h.name) return { ok: false, error: 'Hierarchy must have a name' };
  if (!Array.isArray(h.levels) || !h.levels.length) {
    return { ok: false, error: 'Hierarchy must have at least one level' };
  }
  const missing = h.levels.filter(l => !columnNames.includes(l));
  if (missing.length) return { ok: false, missing, error: `Unknown columns: ${missing.join(', ')}` };
  return { ok: true };
}

/**
 * Compute view state for a hierarchy + drill path.
 *
 * Returns:
 *   {
 *     currentLevelName: 'State',
 *     currentLevelIndex: 1,
 *     filter: (row) => boolean,
 *     breadcrumbs: [{level: 0, name: 'Country', value: 'USA'}, ...],
 *     canDrillUp: true,
 *     canDrillDown: true,
 *   }
 */
function resolveDrill(hierarchy, drillState) {
  const path = (drillState?.path) || [];
  const levelIndex = Math.max(0, Math.min(hierarchy.levels.length - 1, drillState?.level ?? path.length));
  const currentLevelName = hierarchy.levels[levelIndex];

  const filter = (row) => {
    for (const step of path) {
      const colName = hierarchy.levels[step.level];
      if (String(row[colName]) !== String(step.value)) return false;
    }
    return true;
  };

  const breadcrumbs = path.map(step => ({
    level: step.level,
    name: hierarchy.levels[step.level],
    value: step.value,
  }));

  return {
    currentLevelName,
    currentLevelIndex: levelIndex,
    filter,
    breadcrumbs,
    canDrillUp: levelIndex > 0,
    canDrillDown: levelIndex < hierarchy.levels.length - 1,
  };
}

/**
 * Drill down one level. Returns a new drill state.
 */
function drillDown(hierarchy, drillState, value) {
  const { currentLevelIndex, canDrillDown } = resolveDrill(hierarchy, drillState);
  if (!canDrillDown) return drillState;

  const newPath = [...(drillState?.path || []), { level: currentLevelIndex, value }];
  return {
    hierarchyName: hierarchy.name,
    level: currentLevelIndex + 1,
    path: newPath,
  };
}

/**
 * Drill up one level. Returns a new drill state.
 */
function drillUp(hierarchy, drillState) {
  const path = drillState?.path || [];
  if (!path.length) return drillState;
  return {
    hierarchyName: hierarchy.name,
    level: Math.max(0, (drillState.level || 0) - 1),
    path: path.slice(0, -1),
  };
}

/**
 * Jump to a specific level via breadcrumb click.
 */
function drillToLevel(hierarchy, drillState, targetLevel) {
  const path = drillState?.path || [];
  return {
    hierarchyName: hierarchy.name,
    level: targetLevel,
    path: path.slice(0, targetLevel),
  };
}

/**
 * Apply the drill filter to source data. Convenience wrapper.
 */
function applyDrill(data, hierarchy, drillState) {
  if (!hierarchy || !drillState || !drillState.path?.length) return data;
  const { filter } = resolveDrill(hierarchy, drillState);
  return data.filter(filter);
}

module.exports = {
  validateHierarchy,
  resolveDrill,
  drillDown,
  drillUp,
  drillToLevel,
  applyDrill,
};
