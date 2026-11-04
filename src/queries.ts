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
  type Subject,
  type SymbolRef,
  type Uses,
  type Where
} from './contract.ts'
import { compare, type Graph, type RepoPath, type SymbolFacts } from './model.ts'
import { resolveModule, resolveSubject, type Miss, type Resolved } from './subjects.ts'

export function failure(command: Command, { error }: Miss): Failure {
  return { schemaVersion: SCHEMA_VERSION, command, error }
}

export function moduleRef(graph: Graph, path: RepoPath): ModuleRef {
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

const sortedUnique = (values: Iterable<string>) => [...new Set(values)].sort(compare)

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
    tests: dependents.filter(module => module.kind === 'test')
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
    )
  }
}
