/**
 * The answer of `path`: the import chains by which one module reaches another.
 * A chain follows edges to the modules that define the imported names. A barrel
 * the import passes through is `via` on that step, not a module of the chain.
 */

import {
  SCHEMA_VERSION,
  type Failure,
  type ImportChain,
  type ModuleRef,
  type Path,
  type PathStep
} from './contract.ts'
import {
  compare,
  compareEdges,
  sortedUnique,
  type Edge,
  type Graph,
  type RepoPath
} from './model.ts'
import { resolveModule, type Miss, type Resolved } from './subjects.ts'

/** How many chains `--all` lists. */
export const PATH_LIMIT = 20

/** Expansions `--all` may make before it stops and sets `truncated`. */
const SEARCH_BUDGET = 10_000

interface ModuleEdge extends Edge {
  readonly to: { readonly kind: 'module'; readonly path: RepoPath }
}

interface Found {
  readonly modules: readonly RepoPath[]
  readonly steps: readonly PathStep[]
}

function failure(miss: Miss): Failure {
  return { schemaVersion: SCHEMA_VERSION, command: 'path', error: miss.error }
}

function onlyMember(resolved: Resolved): RepoPath | undefined {
  for (const path of resolved.members) return path
  return undefined
}

function namedModule(
  graph: Graph,
  text: string,
  cwd: RepoPath | undefined
): { readonly path: RepoPath; readonly ref: ModuleRef } | Failure {
  const resolved = resolveModule(graph, text, cwd)
  if ('error' in resolved) return failure(resolved)
  const path = onlyMember(resolved)
  const ref = path === undefined ? undefined : moduleRef(graph, path)
  if (path === undefined || ref === undefined) {
    return failure({ error: { code: 'not-found', message: `no module named ${text}` } })
  }
  return { path, ref }
}

function moduleRef(graph: Graph, path: RepoPath): ModuleRef | undefined {
  const node = graph.modules.get(path)
  if (node === undefined) return undefined
  return { path, package: node.package, area: node.area, kind: node.kind }
}

/** One edge per target module, the earliest line, targets in path order. */
function outgoing(graph: Graph, from: RepoPath): readonly ModuleEdge[] {
  const node = graph.modules.get(from)
  if (node === undefined) return []
  const chosen = new Map<RepoPath, ModuleEdge>()
  for (const edge of node.facts.edges) {
    if (edge.to.kind !== 'module') continue
    const moduleEdge: ModuleEdge = { ...edge, to: edge.to }
    const known = chosen.get(edge.to.path)
    if (known === undefined || compareEdges(moduleEdge, known) < 0) {
      chosen.set(edge.to.path, moduleEdge)
    }
  }
  return [...chosen.values()].sort((a, b) => compare(a.to.path, b.to.path))
}

function stepOf(from: RepoPath, edge: ModuleEdge): PathStep {
  return {
    from,
    to: edge.to.path,
    line: edge.line,
    names: sortedUnique(edge.names),
    via: edge.via
  }
}

function reconstruct(
  from: RepoPath,
  to: RepoPath,
  previous: ReadonlyMap<RepoPath, { readonly from: RepoPath; readonly edge: ModuleEdge }>
): Found | undefined {
  const modules: RepoPath[] = []
  const steps: PathStep[] = []
  let cursor = to
  while (cursor !== from) {
    const hop = previous.get(cursor)
    if (hop === undefined) return undefined
    modules.push(cursor)
    steps.push(stepOf(hop.from, hop.edge))
    cursor = hop.from
  }
  modules.push(from)
  modules.reverse()
  steps.reverse()
  return { modules, steps }
}

/** The lexically least shortest chain, or none. Each module is visited once. */
function shortest(graph: Graph, from: RepoPath, to: RepoPath): Found | undefined {
  const previous = new Map<RepoPath, { readonly from: RepoPath; readonly edge: ModuleEdge }>()
  const seen = new Set<RepoPath>([from])
  const queue: RepoPath[] = [from]
  let head = 0
  while (head < queue.length) {
    const current = queue[head]
    head += 1
    if (current === undefined) break
    for (const edge of outgoing(graph, current)) {
      const next = edge.to.path
      if (seen.has(next)) continue
      seen.add(next)
      previous.set(next, { from: current, edge })
      if (next === to) return reconstruct(from, to, previous)
      queue.push(next)
    }
  }
  return undefined
}

/**
 * Every simple chain, shortest first. Stops after `PATH_LIMIT` chains or
 * `SEARCH_BUDGET` steps, and then `truncated` is true.
 */
function everyChain(
  graph: Graph,
  from: RepoPath,
  to: RepoPath
): { readonly chains: readonly Found[]; readonly truncated: boolean } {
  interface Walk {
    readonly at: RepoPath
    readonly modules: readonly RepoPath[]
    readonly steps: readonly PathStep[]
  }
  const queue: Walk[] = [{ at: from, modules: [from], steps: [] }]
  const chains: Found[] = []
  let head = 0
  let expanded = 0
  let truncated = false
  while (head < queue.length) {
    const current = queue[head]
    head += 1
    if (current === undefined) break
    if (current.at === to) {
      if (chains.length === PATH_LIMIT) {
        truncated = true
        break
      }
      chains.push({ modules: current.modules, steps: current.steps })
      continue
    }
    const seen = new Set(current.modules)
    for (const edge of outgoing(graph, current.at)) {
      if (seen.has(edge.to.path)) continue
      expanded += 1
      if (expanded > SEARCH_BUDGET) {
        truncated = true
        break
      }
      queue.push({
        at: edge.to.path,
        modules: [...current.modules, edge.to.path],
        steps: [...current.steps, stepOf(current.at, edge)]
      })
    }
    if (truncated) break
  }
  return { chains, truncated }
}

function chainsBetween(
  graph: Graph,
  from: RepoPath,
  to: RepoPath,
  all: boolean
): { readonly chains: readonly ImportChain[]; readonly truncated: boolean } {
  if (from === to) return { chains: [{ modules: [from], steps: [] }], truncated: false }
  const one = shortest(graph, from, to)
  if (one === undefined) return { chains: [], truncated: false }
  if (!all) return { chains: [one], truncated: false }
  const listed = everyChain(graph, from, to)
  if (listed.chains.length === 0) return { chains: [one], truncated: true }
  return listed
}

export function importPath(
  graph: Graph,
  fromText: string,
  toText: string,
  cwd: RepoPath | undefined,
  all: boolean
): Path | Failure {
  const from = namedModule(graph, fromText, cwd)
  if ('error' in from) return from
  const to = namedModule(graph, toText, cwd)
  if ('error' in to) return to
  const { chains, truncated } = chainsBetween(graph, from.path, to.path, all)
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'path',
    from: from.ref,
    to: to.ref,
    all,
    chains,
    truncated
  }
}
