/**
 * Module cycles, the import loops among the code that runs: which modules
 * form each one, which imports close it, which of those the importer reads
 * while it loads, and which to cut.
 */

import { SCHEMA_VERSION, type Cycle, type CycleImport, type Cycles } from './contract.ts'
import { compare, type Edge, type Graph, type RepoPath } from './model.ts'
import { dependencies, type Nodes } from './layers.ts'
import { importersOf } from './overview.ts'
import { isSourceOrConfig } from './source-file.ts'
import { adjacency, stronglyConnected } from './strongly-connected.ts'

/** Type-only imports load nothing, and an import through a barrel already points at the defining module. */
const runs = (edge: Edge) => !edge.typeOnly && edge.form !== 'reexport'

export function moduleCycles(nodes: Nodes): Graph['cycles'] {
  const pairs: [RepoPath, RepoPath][] = []
  for (const { from, to, source, target, edge } of dependencies(nodes)) {
    if (!runs(edge)) continue
    if (!isSourceOrConfig(source.kind) || !isSourceOrConfig(target.kind)) continue
    pairs.push([from, to])
  }
  const code = [...nodes.keys()]
    .filter(path => isSourceOrConfig(nodes.get(path)!.kind))
    .sort(compare)
  return stronglyConnected(code, adjacency(pairs))
    .filter(component => component.length > 1)
    .sort((a, b) => compare(a[0]!, b[0]!))
}

interface Link {
  readonly from: RepoPath
  readonly to: RepoPath
  readonly edge: Edge
}

/** The names an import brings in, a namespace counting every name its target exports. */
function namesOf(graph: Graph, { to, edge }: Link): number {
  if (edge.names.includes('*')) return Math.max(1, graph.modules.get(to)!.facts.symbols.length)
  return edge.names.length
}

/**
 * What cutting each import costs. An import used at load time costs more than
 * all the names in the cycle together: the importer needs the module it
 * imports to finish loading first, so that module is the lower one, and
 * cutting the import changes how the importer starts. Otherwise an import
 * costs the names it brings in, none for a side-effect import.
 */
function costsOf(graph: Graph, links: readonly Link[]): readonly number[] {
  const names = links.map(link => namesOf(graph, link))
  const loadTime = 1 + names.reduce((sum, count) => sum + count, 0)
  return links.map((link, index) => names[index]! + (link.edge.loadTime ? loadTime : 0))
}

/**
 * The members in an order whose imports pointing back up it cost little, by
 * `costsOf` and the greedy heuristic of Eades, Lin and Smyth for a minimum
 * feedback arc set: a module that imports nothing left goes last, one nothing
 * left imports goes first, and otherwise the module whose imports outweigh
 * its importers most goes first. The imports pointing back up are the ones to
 * cut. Every module of a cycle shares one layer, so this extends the layer
 * order within it. Of two modules that weigh the same, the one with fewer
 * importers in the repository goes first, since the more widely imported
 * module is the lower one.
 */
function dependencyOrder(
  graph: Graph,
  members: readonly RepoPath[],
  links: readonly Link[]
): readonly RepoPath[] {
  const left = new Set(members)
  const empty = () => new Map(members.map(path => [path, new Map<RepoPath, number>()]))
  const [out, into] = [empty(), empty()]
  const costs = costsOf(graph, links)
  for (const [index, link] of links.entries()) {
    const weight = costs[index]!
    const outs = out.get(link.from)!
    outs.set(link.to, (outs.get(link.to) ?? 0) + weight)
    into.get(link.to)!.set(link.from, outs.get(link.to)!)
  }
  // Live neighbours and their weight on each side, updated as modules are placed.
  const tally = (sides: typeof out) =>
    new Map(
      members.map(path => {
        const weights = [...sides.get(path)!.values()]
        return [path, { count: weights.length, weight: weights.reduce((a, b) => a + b, 0) }]
      })
    )
  const [outs, ins] = [tally(out), tally(into)]
  const importers = new Map(members.map(path => [path, importersOf(graph, path)]))
  const ordered = [...members].sort(
    (a, b) => importers.get(a)! - importers.get(b)! || compare(a, b)
  )

  const first: RepoPath[] = []
  const last: RepoPath[] = []
  const place = (path: RepoPath, end: RepoPath[]) => {
    left.delete(path)
    end.push(path)
    for (const [next, weight] of out.get(path)!) {
      const side = ins.get(next)!
      side.count -= 1
      side.weight -= weight
    }
    for (const [previous, weight] of into.get(path)!) {
      const side = outs.get(previous)!
      side.count -= 1
      side.weight -= weight
    }
  }
  while (left.size > 0) {
    const candidates = ordered.filter(path => left.has(path))
    const sink = candidates.find(path => outs.get(path)!.count === 0)
    if (sink !== undefined) {
      place(sink, last)
      continue
    }
    const source = candidates.find(path => ins.get(path)!.count === 0)
    if (source !== undefined) {
      place(source, first)
      continue
    }
    const lead = (path: RepoPath) => outs.get(path)!.weight - ins.get(path)!.weight
    const top = candidates.reduce((best, path) => (lead(path) > lead(best) ? path : best))
    place(top, first)
  }
  return [...first, ...last.reverse()]
}

function cycleOf(graph: Graph, members: readonly RepoPath[]): Cycle {
  const inside = new Set(members)
  const links: Link[] = []
  for (const from of members) {
    for (const edge of graph.modules.get(from)!.facts.edges) {
      if (edge.to.kind !== 'module' || !inside.has(edge.to.path) || !runs(edge)) continue
      links.push({ from, to: edge.to.path, edge })
    }
  }
  const order = dependencyOrder(graph, members, links)
  const position = new Map(order.map((path, index) => [path, index]))
  const imports = links
    .map(({ from, to, edge }): CycleImport => ({
      from,
      to,
      line: edge.line,
      names: edge.names,
      via: edge.via,
      use: edge.loadTime === undefined ? 'later' : 'load-time',
      break: position.get(from)! > position.get(to)!
    }))
    .sort(
      (a, b) =>
        compare(a.from, b.from) ||
        a.line - b.line ||
        compare(a.to, b.to) ||
        compare(a.via.join('\0'), b.via.join('\0'))
    )
  return {
    modules: order,
    loadTime: imports.some(({ use }) => use === 'load-time'),
    imports
  }
}

/** The cycles `graph.cycles` lists that `keep` accepts, those used at load time first. */
export function cyclesWhere(
  graph: Graph,
  keep: (members: readonly RepoPath[]) => boolean = () => true
): readonly Cycle[] {
  return graph.cycles
    .filter(keep)
    .map(members => cycleOf(graph, members))
    .sort((a, b) => Number(b.loadTime) - Number(a.loadTime))
}

export function cycles(graph: Graph): Cycles {
  return { schemaVersion: SCHEMA_VERSION, command: 'cycles', cycles: cyclesWhere(graph) }
}
