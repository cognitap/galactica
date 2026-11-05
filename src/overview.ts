/**
 * The `overview` answer: each package with its areas in layer order and the
 * most imported source and config modules of each area.
 */

import { SCHEMA_VERSION, type Overview, type Warning } from './contract.ts'
import { compare, type Graph, type RepoPath } from './model.ts'
import { isSourceOrConfig } from './source-file.ts'

/** Modules listed per area unless `--all`. */
export const TOP = 5

/**
 * The modules other than tests and stories with an edge to `path` itself. An
 * import that only passes through a barrel counts for the module that defines
 * the name, not for the barrel.
 */
export function importersOf(graph: Graph, path: RepoPath): number {
  const importers = graph.incoming
    .get(path)!
    .filter(({ from, through }) => !through && isSourceOrConfig(graph.modules.get(from)!.kind))
  return new Set(importers.map(({ from }) => from)).size
}

export function overview(graph: Graph, all: boolean, warnings: readonly Warning[]): Overview {
  const packages = [...graph.packages]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, { dir, areas }]) => {
      const placed = areas
        .map(path => graph.areas.get(path)!)
        .sort((a, b) => a.layer - b.layer || compare(a.path, b.path))
        .map(area => {
          const ranked = area.modules
            .filter(path => isSourceOrConfig(graph.modules.get(path)!.kind))
            .map(path => ({
              path,
              importers: importersOf(graph, path),
              exports: graph.modules.get(path)!.facts.symbols.map(symbol => symbol.name)
            }))
            .sort((a, b) => b.importers - a.importers || compare(a.path, b.path))
          return {
            path: area.path,
            layer: area.layer,
            modules: area.modules.length,
            top: all ? ranked : ranked.slice(0, TOP)
          }
        })
      return {
        name,
        dir,
        modules: placed.reduce((sum, area) => sum + area.modules, 0),
        areas: placed
      }
    })
  const edges = [...graph.modules.values()].flatMap(({ facts }) => facts.edges)
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'overview',
    all,
    packages,
    cycles: graph.cycles.length,
    unresolved: edges.filter(edge => edge.to.kind === 'unresolved').length,
    warnings
  }
}
