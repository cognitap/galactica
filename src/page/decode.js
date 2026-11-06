/** Restore the private wire data once; all rendering reads the complete PageData shape. */

/** @typedef {import('../page-data.ts').PageWireData} PageWireData */
/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../page-data.ts').PageRelations} PageRelations */

/** @type {readonly number[]} */
const emptyList = []
const emptyIndexes = /** @type {import('../page-data.ts').IndexGaps} */ (emptyList)

/**
 * @param {string} dir
 * @param {string} path
 */
function relativeTo(dir, path) {
  if (path === dir) return '.'
  if (dir === '.') return path
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path
}

/** @param {Partial<PageRelations>} value @returns {PageRelations} */
const relationsOf = value => ({
  usedBy: value.usedBy ?? emptyIndexes,
  usedByTests: value.usedByTests ?? emptyIndexes,
  uses: value.uses ?? emptyIndexes
})

/** @param {PageWireData} wire @returns {PageData} */
export function decodePage(wire) {
  const packages = (wire.packages ?? []).map(pkg => ({
    ...pkg,
    rows: pkg.rows ?? [],
    areaCycles: pkg.areaCycles ?? [],
    moduleCycles: pkg.moduleCycles ?? []
  }))
  const areas = (wire.areas ?? []).map(area => ({
    ...area,
    label: relativeTo(packages[area.package].dir, area.path),
    modules: area.modules ?? [],
    ...relationsOf(area)
  }))
  const modules = (wire.modules ?? []).map(module => ({
    ...module,
    label: relativeTo(areas[module.area].path, module.path),
    symbols: (module.symbols ?? []).map(symbol => ({
      ...symbol,
      default: symbol.default ?? false
    })),
    ...relationsOf(module)
  }))
  return {
    ...wire,
    folders: wire.folders ?? [],
    packages,
    areas,
    modules,
    health: {
      ...wire.health,
      cycles: wire.health.cycles ?? [],
      oversized: wire.health.oversized ?? [],
      internal: wire.health.internal ?? []
    }
  }
}
