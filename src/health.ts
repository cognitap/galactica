/**
 * The `health` answer: concrete findings about the structure, with no score.
 * Import cycles as `cycles` lists them, areas far larger than the rest of
 * their package, and imports that reach into another package's internals.
 */

import { SCHEMA_VERSION, type Health, type InternalImport, type OversizedArea } from './contract.ts'
import { cyclesWhere } from './cycles.ts'
import { compare, type Graph } from './model.ts'
import { isSourceOrConfig } from './source-file.ts'

/** The relative rule: an area this large, and this many times its package's median, is oversized. */
export const OVERSIZED = { modules: 20, times: 5 } as const

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function oversizedAreas(graph: Graph, areaModules: number | undefined): readonly OversizedArea[] {
  return [...graph.packages].flatMap(([name, { areas }]) => {
    const sizes = areas.map(path => {
      const { modules } = graph.areas.get(path)!
      return {
        path,
        modules: modules.filter(module => graph.modules.get(module)!.kind === 'source').length
      }
    })
    const counted = sizes.filter(({ modules }) => modules > 0)
    if (counted.length === 0) return []
    const middle = median(counted.map(({ modules }) => modules))
    const oversized = (modules: number) =>
      areaModules === undefined
        ? modules >= OVERSIZED.modules && modules >= OVERSIZED.times * middle
        : modules > areaModules
    return counted
      .filter(({ modules }) => oversized(modules))
      .map(({ path, modules }) => ({ path, package: name, modules, median: middle }))
  })
}

/**
 * One finding per import statement, though barrels split it into an edge per
 * defining module. Tests and stories are left out, since a test of internals
 * imports them on purpose.
 */
function internalImports(graph: Graph): readonly InternalImport[] {
  const found: InternalImport[] = []
  for (const from of graph.paths) {
    const byStatement = new Map<string, { finding: InternalImport; names: Set<string> }>()
    const { facts, kind } = graph.modules.get(from)!
    if (!isSourceOrConfig(kind)) continue
    for (const edge of facts.edges) {
      const { internal } = edge
      if (internal === undefined) continue
      const key = `${edge.line}\0${internal.specifier}`
      const statement = byStatement.get(key)
      if (statement !== undefined) {
        for (const name of edge.names) statement.names.add(name)
        continue
      }
      const to = edge.to.kind === 'module' ? (edge.via[0] ?? edge.to.path) : undefined
      byStatement.set(key, {
        names: new Set(edge.names),
        finding: {
          from,
          line: edge.line,
          specifier: internal.specifier,
          names: [],
          reach: internal.reach,
          package: internal.package,
          ...(to === undefined ? {} : { to }),
          ...(internal.instead === undefined ? {} : { instead: internal.instead })
        }
      })
    }
    for (const { finding, names } of byStatement.values()) {
      found.push({ ...finding, names: [...names].sort(compare) })
    }
  }
  return found.sort(
    (a, b) => compare(a.from, b.from) || a.line - b.line || compare(a.specifier, b.specifier)
  )
}

export function health(graph: Graph, areaModules: number | undefined): Health {
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'health',
    cycles: cyclesWhere(graph),
    ...(areaModules === undefined ? {} : { areaModules }),
    oversizedAreas: oversizedAreas(graph, areaModules).toSorted((a, b) => compare(a.path, b.path)),
    internalImports: internalImports(graph)
  }
}
