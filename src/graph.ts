/**
 * The `Graph` derived from a `Model`: each module placed in its package and
 * area, the dependency order of areas and packages, reverse edges, the symbol
 * index and cycles. Pure, so a caller may rebuild it on every load.
 */

import { areasOf } from './areas.ts'
import { moduleCycles } from './cycles.ts'
import { layerAreas, orderPackages } from './layers.ts'
import {
  compare,
  compareEdges,
  type Config,
  type Graph,
  type Incoming,
  type Model,
  type ModuleNode,
  type RepoPath,
  type SymbolLocation
} from './model.ts'
import { kindOf, languageOf } from './source-file.ts'

function nodesOf(model: Model, config: Config, paths: readonly RepoPath[]): Graph['modules'] {
  const placements = areasOf(model, config)
  return new Map(
    paths.map((path): [RepoPath, ModuleNode] => {
      const language = languageOf(path)
      if (language === undefined) throw new Error(`${path} is no module`)
      const facts = model.modules[path]
      return [path, { facts, ...placements.get(path)!, kind: kindOf(path, config), language }]
    })
  )
}

/** For every module, the edges that reach it and those that pass through it as a barrel. */
function incomingOf(modules: Graph['modules']): Graph['incoming'] {
  const incoming = new Map<RepoPath, Incoming[]>([...modules.keys()].map(path => [path, []]))
  for (const [from, { facts }] of modules) {
    for (const edge of facts.edges) {
      if (edge.to.kind === 'module')
        incoming.get(edge.to.path)!.push({ from, edge, through: false })
      for (const barrel of edge.via) incoming.get(barrel)!.push({ from, edge, through: true })
    }
  }
  for (const entries of incoming.values()) {
    entries.sort(
      (a, b) =>
        compare(a.from, b.from) ||
        compareEdges(a.edge, b.edge) ||
        Number(a.through) - Number(b.through)
    )
  }
  return incoming
}

function symbolIndex(modules: Graph['modules']): Graph['symbols'] {
  const byName = new Map<string, SymbolLocation[]>()
  for (const [module, { facts }] of modules) {
    for (const symbol of facts.symbols) {
      const locations = byName.get(symbol.name) ?? []
      locations.push({ module, symbol })
      byName.set(symbol.name, locations)
    }
  }
  return new Map(
    [...byName]
      .sort(([a], [b]) => compare(a, b))
      .map(([name, locations]) => [
        name,
        locations.sort((a, b) => compare(a.module, b.module) || a.symbol.line - b.symbol.line)
      ])
  )
}

export function graphOf(model: Model, config: Config): Graph {
  const paths = (Object.keys(model.modules) as RepoPath[]).sort(compare)
  const modules = nodesOf(model, config, paths)
  const { areas, areaCycles } = layerAreas(modules)
  return {
    repository: model.repository,
    paths,
    modules,
    packages: orderPackages(modules, model.packages, areas),
    areas,
    areaCycles,
    incoming: incomingOf(modules),
    symbols: symbolIndex(modules),
    cycles: moduleCycles(modules)
  }
}
