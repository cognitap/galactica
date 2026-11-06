/**
 * The answers of `where`, `outline`, `uses` and `deps`, built from a `Graph`
 * as the `--json` objects of src/contract.ts.
 */

import {
  SCHEMA_VERSION,
  type Command,
  type Deps,
  type Failure,
  type ModuleRef,
  type Outline,
  type Reached,
  type ReachedTest,
  type Subject,
  type SymbolRef,
  type Uses,
  type Where
} from './contract.ts'
import { cyclesWhere } from './cycles.ts'
import {
  compare,
  sortedUnique,
  type Graph,
  type Incoming,
  type RepoPath,
  type SymbolFacts
} from './model.ts'
import { resolveModule, resolveSubject, type Miss, type Resolved } from './subjects.ts'

export function failure(command: Command, { error }: Miss): Failure {
  return { schemaVersion: SCHEMA_VERSION, command, error }
}

function moduleRef(graph: Graph, path: RepoPath): ModuleRef {
  const node = graph.modules.get(path)!
  return { path, package: node.package, area: node.area, kind: node.kind }
}

function symbolRef({
  name,
  kind,
  line,
  default: isDefault,
  signature,
  doc
}: SymbolFacts): SymbolRef {
  return { name, kind, line, default: isDefault, signature, ...(doc === undefined ? {} : { doc }) }
}

/** Up to three exported names equal to `name` but for case, or containing it, or contained in it. */
function similarNames(graph: Graph, name: string): readonly string[] {
  const wanted = name.toLowerCase()
  const rank = (candidate: string) => (candidate.toLowerCase() === wanted ? 0 : 1)
  return [...graph.symbols.keys()]
    .filter(candidate => {
      const lower = candidate.toLowerCase()
      return lower.includes(wanted) || wanted.includes(lower)
    })
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length || compare(a, b))
    .slice(0, 3)
}

export function where(graph: Graph, name: string): Where {
  const definitions = (graph.symbols.get(name) ?? []).map(({ module, symbol }) => ({
    module: moduleRef(graph, module),
    ...symbolRef(symbol)
  }))
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'where',
    name,
    definitions,
    suggestions: definitions.length === 0 ? similarNames(graph, name) : []
  }
}

export function outline(graph: Graph, file: string, cwd: RepoPath | undefined): Outline | Failure {
  const resolved = resolveModule(graph, file, cwd)
  if ('error' in resolved) return failure('outline', resolved)
  const [path] = resolved.members
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'outline',
    module: moduleRef(graph, path),
    symbols: graph.modules.get(path)!.facts.symbols.map(symbolRef)
  }
}

/** One edge of the walk: the module it reaches and the names it takes. */
interface Step {
  readonly to: RepoPath
  readonly names: readonly string[]
  /** False for a barrel the import only passes through, which the walk lists but does not leave. */
  readonly onward: boolean
}

/**
 * Breadth-first from `members` along `steps`, up to `limit` steps. Each module
 * outside `members` gets its shortest distance, and at distance 1 the names
 * the steps from `members` take.
 */
function reach(
  graph: Graph,
  members: ReadonlySet<RepoPath>,
  steps: (path: RepoPath) => readonly Step[],
  limit: number
): readonly Reached[] {
  const reached = new Map<RepoPath, { distance: number; names: Set<string> }>()
  const walked = new Set(members)
  let frontier = [...members]
  for (let distance = 1; distance <= limit && frontier.length > 0; distance++) {
    const next: RepoPath[] = []
    for (const path of frontier) {
      for (const { to, names, onward } of steps(path)) {
        if (members.has(to)) continue
        let entry = reached.get(to)
        if (entry === undefined) {
          entry = { distance, names: new Set() }
          reached.set(to, entry)
        }
        if (distance === 1) for (const name of names) entry.names.add(name)
        if (onward && !walked.has(to)) {
          walked.add(to)
          next.push(to)
        }
      }
    }
    frontier = next
  }
  return [...reached]
    .map(([path, { distance, names }]) => ({
      ...moduleRef(graph, path),
      distance,
      names: sortedUnique(names)
    }))
    .sort((a, b) => a.distance - b.distance || compare(a.path, b.path))
}

/**
 * A module that much of the repository imports: at least `importers` modules,
 * and at least `share` of all modules. A test that reaches a subject only
 * through one says little about the subject, since it reaches most modules.
 */
const HUB = { importers: 20, share: 1 / 20 } as const

const hubCache = new WeakMap<Graph, ReadonlySet<RepoPath>>()

function hubsOf(graph: Graph): ReadonlySet<RepoPath> {
  let hubs = hubCache.get(graph)
  if (hubs === undefined) {
    const least = Math.max(HUB.importers, HUB.share * graph.modules.size)
    const importerCount = (incoming: readonly Incoming[]) =>
      new Set(incoming.filter(({ through }) => !through).map(({ from }) => from)).size
    hubs = new Set(
      [...graph.incoming]
        .filter(([, incoming]) => importerCount(incoming) >= least)
        .map(([path]) => path)
    )
    hubCache.set(graph, hubs)
  }
  return hubs
}

/** How the walk from a subject reaches a module, by its shortest paths. */
interface Route {
  /** The first module on the paths, the least in path order. */
  readonly via: RepoPath
  /** The hub nearest the subject on the paths, the least in path order, and undefined when a path has none. */
  readonly hub: RepoPath | undefined
}

/** The lesser path, undefined when either is. */
const least = (a: RepoPath | undefined, b: RepoPath | undefined) =>
  a === undefined || b === undefined ? undefined : compare(a, b) <= 0 ? a : b

/**
 * Breadth-first from `members` to the modules `importers` gives, without
 * walking on past a module `stop` names. One layer at a time, so a module's
 * route takes the least of all its shortest paths, whatever order they come in.
 */
function routes(
  members: ReadonlySet<RepoPath>,
  importers: (path: RepoPath) => readonly RepoPath[],
  hubs: ReadonlySet<RepoPath>,
  stop: (path: RepoPath) => boolean
): ReadonlyMap<RepoPath, Route> {
  const found = new Map<RepoPath, Route>()
  let frontier: readonly RepoPath[] = [...members]
  while (frontier.length > 0) {
    const layer = new Map<RepoPath, Route>()
    for (const path of frontier) {
      const from = found.get(path)
      for (const to of importers(path)) {
        if (members.has(to) || found.has(to)) continue
        const route = { via: from?.via ?? to, hub: from?.hub ?? (hubs.has(to) ? to : undefined) }
        const known = layer.get(to)
        layer.set(
          to,
          known === undefined
            ? route
            : { via: least(known.via, route.via)!, hub: least(known.hub, route.hub) }
        )
      }
    }
    for (const [path, route] of layer) found.set(path, route)
    frontier = [...layer.keys()].filter(path => !stop(path))
  }
  return found
}

export const TESTS_NOTE =
  'Lists only tests that import the subject, directly or through other modules. End-to-end, playground and fixture-driven tests that load it another way, such as through a dev server, a build or a config file, can be missing, so also search for tests named after the feature.'

/** Each test with the module its path starts from, and the hub it reaches the subject only through. */
function testRoutes(
  graph: Graph,
  members: ReadonlySet<RepoPath>,
  tests: readonly Reached[]
): readonly ReachedTest[] {
  const hubs = hubsOf(graph)
  const importers = (loading: boolean) => (path: RepoPath) =>
    graph.incoming
      .get(path)!
      .filter(({ through, edge }) => (!through || members.has(path)) && !(loading && edge.typeOnly))
      .map(({ from }) => from)
  const any = routes(members, importers(false), hubs, () => false)
  const loading = routes(members, importers(true), hubs, () => false)
  const avoiding = routes(members, importers(false), hubs, path => hubs.has(path))
  return tests.map(test => {
    if (test.distance === 1) return test
    const path = test.path as RepoPath
    const { via } = loading.get(path) ?? any.get(path)!
    const hub = avoiding.has(path) ? undefined : any.get(path)!.hub
    return { ...test, via, ...(hub === undefined ? {} : { hub }) }
  })
}

const cyclesOf = (graph: Graph, { members }: Resolved) =>
  cyclesWhere(graph, cycle => cycle.some(path => members.has(path)))

const ownPackage = (subject: Subject) =>
  subject.kind === 'package' ? subject.name : subject.package

export function uses(
  graph: Graph,
  text: string,
  cwd: RepoPath | undefined,
  depth: number
): Uses | Failure {
  const resolved = resolveSubject(graph, text, cwd)
  return 'error' in resolved ? failure('uses', resolved) : usesOf(graph, resolved, depth)
}

/** `uses` of a subject already resolved. */
export function usesOf(graph: Graph, resolved: Resolved, depth: number): Uses {
  // An import that only passes through a barrel depends on the barrel when the
  // barrel is the subject. Past the subject it depends on the defining module,
  // which the walk reaches directly, so following it would add every importer
  // of src/index.ts to whatever src/index.ts re-exports.
  const importers = (path: RepoPath) =>
    graph.incoming
      .get(path)!
      .filter(({ through }) => !through || resolved.members.has(path))
      .map(({ from, edge }) => ({ to: from, names: edge.names, onward: true }))
  // Tests are wanted at any distance, so the walk ignores `depth` and `modules` applies it.
  const dependents = reach(graph, resolved.members, importers, Infinity)
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'uses',
    subject: resolved.subject,
    depth,
    modules: dependents.filter(module => module.kind !== 'test' && module.distance <= depth),
    tests: testRoutes(
      graph,
      resolved.members,
      dependents.filter(module => module.kind === 'test')
    ),
    testsNote: TESTS_NOTE,
    cycles: cyclesOf(graph, resolved)
  }
}

export function deps(
  graph: Graph,
  text: string,
  cwd: RepoPath | undefined,
  depth: number
): Deps | Failure {
  const resolved = resolveSubject(graph, text, cwd)
  return 'error' in resolved ? failure('deps', resolved) : depsOf(graph, resolved, depth)
}

/** `deps` of a subject already resolved. */
export function depsOf(graph: Graph, resolved: Resolved, depth: number): Deps {
  const edgesOf = (path: RepoPath) => graph.modules.get(path)!.facts.edges
  // An import through a barrel loads the barrel too, and `uses` of the barrel
  // lists the importer. Walking on from the barrel would reach everything it
  // re-exports, not what the import takes.
  const imported = (path: RepoPath) =>
    edgesOf(path).flatMap(({ to, via, names }) => [
      ...(to.kind === 'module' ? [{ to: to.path, names, onward: true }] : []),
      ...via.map(barrel => ({ to: barrel, names, onward: false }))
    ])
  const modules = reach(graph, resolved.members, imported, depth)
  const own = ownPackage(resolved.subject)
  const edges = [...resolved.members].flatMap(from => edgesOf(from).map(edge => ({ from, edge })))
  const unresolved = new Map<string, { from: string; specifier: string }>()
  for (const { from, edge } of edges) {
    if (edge.to.kind !== 'unresolved') continue
    const entry = { from, specifier: edge.to.specifier }
    unresolved.set(`${from}\0${entry.specifier}`, entry)
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'deps',
    subject: resolved.subject,
    depth,
    modules,
    packages: sortedUnique(modules.map(module => module.package).filter(name => name !== own)),
    external: sortedUnique(
      edges.flatMap(({ edge }) => (edge.to.kind === 'external' ? [edge.to.name] : []))
    ),
    unresolved: [...unresolved.values()].sort(
      (a, b) => compare(a.from, b.from) || compare(a.specifier, b.specifier)
    ),
    cycles: cyclesOf(graph, resolved)
  }
}
