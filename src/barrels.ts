/**
 * Following imports through barrels: once every module's facts exist, each
 * name an import takes from a module that only re-exports it is traced along
 * `export ... from` edges to the module that defines it. Syntax alone decides,
 * from the symbols and edges already in the model.
 */

import {
  compareEdges,
  type Edge,
  type Model,
  type ModuleFacts,
  type RepoPath,
  type Target
} from './model.ts'

type Modules = Model['modules']
type ModuleTarget = Extract<Target, { kind: 'module' }>

/** Where a name is defined, as that module exports it, and the barrels on the way. */
interface Definition {
  readonly to: Target
  readonly name: string
  readonly via: readonly RepoPath[]
}

/**
 * `settled` is false when the search met a (module, name) still being
 * searched, in a re-export cycle. Such a result depends on where the search
 * entered the cycle, so it is not memoized.
 */
interface Search {
  readonly found: Definition | undefined
  readonly settled: boolean
}

const isStar = (edge: Edge) =>
  edge.form === 'reexport' && edge.renames === undefined && edge.names[0] === '*'

function exportsOwn(facts: ModuleFacts, name: string): boolean {
  if (name === '*') return true
  if (name === 'default') return facts.symbols.some(symbol => symbol.default)
  return facts.symbols.some(symbol => symbol.name === name)
}

/** The name a re-export edge takes from its target for `exported`, if it exports that name. */
function takenFor(edge: Edge, exported: string): string | undefined {
  if (edge.form !== 'reexport' || exported === '*') return undefined
  const renamed = edge.renames?.[exported]
  if (renamed !== undefined) return renamed
  const renamedAway = Object.values(edge.renames ?? {}).includes(exported)
  return edge.names.includes(exported) && !renamedAway ? exported : undefined
}

const through = (path: RepoPath, definition: Definition): Definition => ({
  ...definition,
  via: [path, ...definition.via]
})

function definitions(modules: Modules): (to: ModuleTarget, name: string) => Search {
  const memo = new Map<string, Definition | undefined>()
  const searching = new Set<string>()

  const definitionOf = (to: ModuleTarget, name: string): Search => {
    const key = `${to.path}\0${name}`
    if (memo.has(key)) return { found: memo.get(key), settled: true }
    if (searching.has(key)) return { found: undefined, settled: false }
    searching.add(key)
    const search = searchModule(to, name)
    searching.delete(key)
    if (search.settled) memo.set(key, search.found)
    return search
  }

  const searchModule = (to: ModuleTarget, name: string): Search => {
    const facts = modules[to.path]
    if (exportsOwn(facts, name)) return { found: { to, name, via: [] }, settled: true }
    for (const edge of facts.edges) {
      const taken = takenFor(edge, name)
      if (taken !== undefined) return searchReexport(to.path, edge.to, taken)
    }
    if (name === 'default') return { found: undefined, settled: true }
    let settled = true
    for (const edge of facts.edges) {
      if (!isStar(edge) || edge.to.kind !== 'module') continue
      const search = definitionOf(edge.to, name)
      settled &&= search.settled
      if (search.found) return { found: through(to.path, search.found), settled }
    }
    return { found: undefined, settled }
  }

  /** A named re-export vouches that its target exports the name, so the target stands in when the search there finds nothing. */
  const searchReexport = (barrel: RepoPath, to: Target, name: string): Search => {
    const search =
      to.kind === 'module' ? definitionOf(to, name) : { found: undefined, settled: true }
    if (!search.found && !search.settled) return search
    return {
      found: through(barrel, search.found ?? { to, name, via: [] }),
      settled: search.settled
    }
  }

  return definitionOf
}

function rewritten(edge: Edge, definitionOf: ReturnType<typeof definitions>): readonly Edge[] {
  const { to } = edge
  if (edge.form !== 'import' || to.kind !== 'module' || edge.names.length === 0) return [edge]
  const groups = new Map<string, { definition: Definition; names: string[]; read: string[] }>()
  for (const name of edge.names) {
    const definition = definitionOf(to, name).found ?? { to, name, via: [] }
    const key = JSON.stringify([definition.to, definition.via])
    const group = groups.get(key) ?? { definition, names: [], read: [] }
    groups.set(key, group)
    group.names.push(definition.name)
    if (edge.loadTime?.includes(name)) group.read.push(definition.name)
  }
  return [...groups.values()].map(({ definition, names, read }) => {
    const { loadTime: _, via: __, ...rest } = edge
    return {
      ...rest,
      to: definition.to,
      names: [...new Set(names)].sort(),
      ...(read.length === 0 ? {} : { loadTime: [...new Set(read)].sort() }),
      via: definition.via
    }
  })
}

/** `modules` with each import that lands on a barrel pointing at the modules that define its names. */
export function resolveBarrels(modules: Modules): Modules {
  const definitionOf = definitions(modules)
  return Object.fromEntries(
    Object.entries(modules).map(([path, facts]) => [
      path,
      {
        ...facts,
        edges: facts.edges.flatMap(edge => rewritten(edge, definitionOf)).sort(compareEdges)
      }
    ])
  )
}
