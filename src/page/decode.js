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
  const { symbolKinds = [], ...data } = wire
  const packages = (data.packages ?? []).map(pkg => ({
    ...pkg,
    rows: pkg.rows ?? [],
    areaCycles: pkg.areaCycles ?? [],
    moduleCycles: pkg.moduleCycles ?? []
  }))
  const areas = (data.areas ?? []).map(area => ({
    ...area,
    label: relativeTo(packages[area.package].dir, area.path),
    modules: area.modules ?? [],
    ...relationsOf(area)
  }))
  const modules = (data.modules ?? []).map(module => ({
    ...module,
    label: relativeTo(areas[module.area].path, module.path),
    symbols: (module.symbols ?? []).map(([name, kind, line, signature, doc, isDefault]) => ({
      name,
      kind: symbolKinds[kind],
      line,
      signature,
      default: isDefault ?? false,
      ...(doc == null ? {} : { doc })
    })),
    ...relationsOf(module)
  }))
  return {
    ...data,
    folders: data.folders ?? [],
    packages,
    areas,
    modules,
    health: {
      ...data.health,
      cycles: data.health.cycles ?? [],
      oversized: data.health.oversized ?? [],
      internal: data.health.internal ?? []
    }
  }
}
