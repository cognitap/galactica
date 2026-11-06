/**
 * The `overview` answer: each package with its areas in layer order and the
 * most imported source and config modules of each area.
 */

import { SCHEMA_VERSION, type Overview, type Warning, type UnresolvedImport } from './contract.ts'
import { compare, type Graph, type RepoPath } from './model.ts'
import { isSourceOrConfig } from './source-file.ts'

/** Modules listed per area unless `--all`. */
export const TOP = 5

/** Hints only: a missing generated or virtual module is often expected before a build. */
function likelyCause(specifier: string): UnresolvedImport['cause'] {
  if (/^(?:https?|data|file|blob|ftp):/i.test(specifier)) return 'url'
  if (/^[a-z][\w+.-]*:/i.test(specifier) && !/^[a-z]:[\\/]/i.test(specifier)) return 'virtual'
  if (specifier.startsWith('\0')) return 'virtual'
  if (
    /(?:^|[/\\])(?:dist|build|out|generated|__generated__|\.next|\.nuxt|\.svelte-kit|\.astro)(?:[/\\]|$)/i.test(
      specifier
    ) ||
    /(?:^|[/\\])\$types(?:\.|$)/.test(specifier) ||
    /\.node(?:$|[?#])/.test(specifier)
  )
    return 'build'
  return 'missing'
}

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
  const unresolvedImports: UnresolvedImport[] = []
  for (const [from, { facts }] of graph.modules) {
    for (const { to, line } of facts.edges) {
      if (to.kind === 'unresolved')
        unresolvedImports.push({
          from,
          line,
          specifier: to.specifier,
          cause: likelyCause(to.specifier)
        })
    }
  }
  unresolvedImports.sort(
    (a, b) => compare(a.from, b.from) || a.line - b.line || compare(a.specifier, b.specifier)
  )
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'overview',
    all,
    packages,
    cycles: graph.cycles.length,
    unresolved: unresolvedImports.length,
    unresolvedImports,
    warnings
  }
}
