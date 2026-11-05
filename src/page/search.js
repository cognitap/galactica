/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */

/**
 * @typedef {{ readonly kind: 'area', readonly area: number }
 *   | { readonly kind: 'module', readonly module: number }
 *   | { readonly kind: 'symbol', readonly module: number, readonly symbol: number }} Target
 */

/**
 * @typedef {object} SearchEntry
 * @property {string} text the area or module path, or the symbol name
 * @property {string} tail the last segment of the path, or the symbol name
 * @property {string} kind "area", "module" or the symbol's kind
 * @property {string} where the package of an area, the area of a module, the module of a symbol
 * @property {readonly ModuleKind[]} kinds the kinds of module that show it: the module's own, or every kind an area holds
 * @property {Target} target
 */

/** @param {string} path */
const tailOf = path => path.slice(path.lastIndexOf('/') + 1)

/**
 * Areas, modules and exported symbols, in path order, a symbol after its module.
 * @param {PageData} data
 * @returns {readonly SearchEntry[]}
 */
export function entriesOf(data) {
  /** @type {{ path: string, order: number, entry: SearchEntry }[]} */
  const placed = []
  data.areas.forEach((area, index) => {
    placed.push({
      path: area.path,
      order: 0,
      entry: {
        text: area.path,
        tail: tailOf(area.path),
        kind: 'area',
        where: data.packages[area.package].name,
        kinds: /** @type {ModuleKind[]} */ (Object.keys(area.kinds)).filter(
          kind => area.kinds[kind] > 0
        ),
        target: { kind: 'area', area: index }
      }
    })
  })
  data.modules.forEach((module, index) => {
    const kinds = [module.kind]
    placed.push({
      path: module.path,
      order: 0,
      entry: {
        text: module.path,
        tail: tailOf(module.path),
        kind: 'module',
        where: data.areas[module.area].path,
        kinds,
        target: { kind: 'module', module: index }
      }
    })
    module.symbols.forEach((symbol, position) => {
      placed.push({
        path: module.path,
        order: position + 1,
        entry: {
          text: symbol.name,
          tail: symbol.name,
          kind: symbol.default ? `default ${symbol.kind}` : symbol.kind,
          where: module.path,
          kinds,
          target: { kind: 'symbol', module: index, symbol: position }
        }
      })
    })
  })
  return placed
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.order - b.order))
    .map(({ entry }) => entry)
}

/**
 * 0 for an exact match of the text or its tail, 1 for a prefix of the tail, 2
 * for a substring of the text, undefined for no match.
 * @param {SearchEntry} entry
 * @param {string} wanted lower case
 */
function tierOf(entry, wanted) {
  const text = entry.text.toLowerCase()
  const tail = entry.tail.toLowerCase()
  if (text === wanted || tail === wanted) return 0
  if (tail.startsWith(wanted)) return 1
  if (text.includes(wanted)) return 2
  return undefined
}

/**
 * The kinds that hide `entry` from the map, none when one of its kinds is shown.
 * @param {SearchEntry} entry
 * @param {ReadonlySet<ModuleKind>} shown the kinds the map shows
 * @returns {readonly ModuleKind[]}
 */
export const hiddenBy = (entry, shown) =>
  entry.kinds.some(kind => shown.has(kind)) ? [] : entry.kinds

/**
 * The entries that match `query` whatever its case, best first, then those the
 * map shows before those it hides, then in path order. Hidden entries are
 * still found, so a search never misses what the filter leaves out.
 * @param {readonly SearchEntry[]} entries in path order, as `entriesOf` gives them
 * @param {string} query
 * @param {ReadonlySet<ModuleKind>} shown the kinds the map shows
 * @param {number} [limit]
 * @returns {readonly SearchEntry[]}
 */
export function search(entries, query, shown, limit = 12) {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return []
  /** @type {{ entry: SearchEntry, tier: number, hidden: number, order: number }[]} */
  const matches = []
  entries.forEach((entry, order) => {
    const tier = tierOf(entry, wanted)
    if (tier === undefined) return
    matches.push({ entry, tier, hidden: hiddenBy(entry, shown).length > 0 ? 1 : 0, order })
  })
  return matches
    .sort((a, b) => a.tier - b.tier || a.hidden - b.hidden || a.order - b.order)
    .slice(0, limit)
    .map(({ entry }) => entry)
}
