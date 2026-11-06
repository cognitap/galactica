/**
 * The data the HTML page draws, derived from the `Graph`. Areas and modules are
 * referred to by their index in `areas` and `modules`, which keeps the
 * embedded JSON small. The shape is private to the page and is no contract.
 */

import type { InternalImport, ModuleKind } from './contract.ts'
import { health } from './health.ts'
import {
  compare,
  type AreaPath,
  type Brand,
  type Graph,
  type RepoPath,
  type SymbolFacts
} from './model.ts'
import { orderRows } from './row-order.ts'
import { isSourceOrConfig } from './source-file.ts'
import type { PageSource } from './source-links.ts'
import { stronglyConnected } from './strongly-connected.ts'
import { areaSubject, moduleSubject, type Resolved } from './subjects.ts'

/** Ascending module indexes, each stored as its gap from the one before, so long lists of nearby modules take few digits. */
export type IndexGaps = Brand<readonly number[], 'IndexGaps'>

function gapsOf(indexes: readonly number[]): IndexGaps {
  const gaps: readonly number[] = indexes.map(
    (index, position) => index - (indexes[position - 1] ?? 0)
  )
  return gaps as IndexGaps
}

/** What `uses` and `deps` answer at depth 1. */
export interface PageRelations {
  /** The `modules` of `uses`: what imports the subject, stories and config included. */
  readonly usedBy: IndexGaps
  /** The `tests` of `uses`, at any distance. */
  readonly usedByTests: IndexGaps
  /** The `modules` of `deps`: what the subject imports in the workspace, barrels included. */
  readonly uses: IndexGaps
}

export interface PageModule extends PageRelations {
  readonly path: string
  /** The path relative to its area's directory. */
  readonly label: string
  readonly area: number
  readonly kind: ModuleKind
  readonly symbols: readonly SymbolFacts[]
  /** Workspace modules this module imports. */
  readonly imports: number
  /** Source and config modules that import this module itself, as `overview` counts them. */
  readonly importers: number
}

export interface PageArea extends PageRelations {
  readonly path: string
  /** The path relative to its package's directory, "." for the directory itself. */
  readonly label: string
  readonly package: number
  readonly layer: number
  /** Index into `PageData.folders`, which decides the box's colour. */
  readonly folder: number
  readonly kinds: Readonly<Record<ModuleKind, number>>
  readonly modules: readonly number[]
  readonly cycle: boolean
}

export interface PageCycle {
  readonly areas: readonly number[]
  readonly edges: readonly { readonly from: number; readonly to: number; readonly line: number }[]
}

export interface PagePackage {
  readonly name: string
  readonly dir: string
  readonly layer: number
  /** Area indexes by layer, the highest layer first. */
  readonly rows: readonly (readonly number[])[]
  readonly areaCycles: readonly PageCycle[]
  /** Module cycles whose first module lies in this package. */
  readonly moduleCycles: readonly (readonly number[])[]
}

/** What `health` lists, with modules and areas by index. */
export interface PageHealth {
  readonly cycles: readonly {
    readonly modules: readonly number[]
    readonly loadTime: boolean
    /** The imports to break. */
    readonly breaks: readonly {
      readonly from: number
      readonly to: number
      readonly line: number
      readonly names: readonly string[]
    }[]
  }[]
  /** `health.areaModules`, or null for the relative rule. */
  readonly areaModules: number | null
  readonly oversized: readonly {
    readonly area: number
    readonly modules: number
    readonly median: number
  }[]
  readonly internal: readonly (Omit<InternalImport, 'from' | 'to' | 'instead'> & {
    readonly from: number
    readonly to: number | null
    readonly instead: string | null
  })[]
}

export interface PageData {
  readonly repository: string
  /** Top-level folders within their packages, the most common first, then by name. */
  readonly folders: readonly string[]
  /** Highest package layer first, so each package depends only on those after it. */
  readonly packages: readonly PagePackage[]
  readonly areas: readonly PageArea[]
  readonly modules: readonly PageModule[]
  /** What the page builds links to source from, or null for plain paths. */
  readonly source: PageSource | null
  readonly health: PageHealth
}

function relativeTo(dir: string, path: string): string {
  if (path === dir) return '.'
  if (dir === '.') return path
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path
}

const topFolder = (label: string): string => label.split('/')[0]!

function indexOf<T>(values: readonly T[]): ReadonlyMap<T, number> {
  return new Map(values.map((value, index) => [value, index]))
}

function importCounts(graph: Graph, path: RepoPath) {
  const { facts } = graph.modules.get(path)!
  const targets = facts.edges.flatMap(edge => (edge.to.kind === 'module' ? [edge.to.path] : []))
  const importers = graph.incoming
    .get(path)!
    .filter(({ from, through }) => !through && isSourceOrConfig(graph.modules.get(from)!.kind))
  return {
    imports: new Set(targets).size,
    importers: new Set(importers.map(({ from }) => from)).size
  }
}

/**
 * Links between areas as the map first draws them, with tests and stories
 * hidden: each import of source and config, and each barrel it passes through.
 */
function areaLinks(graph: Graph): readonly (readonly [AreaPath, AreaPath])[] {
  return [...graph.modules.values()].flatMap(({ facts, area, kind }) =>
    (isSourceOrConfig(kind) ? facts.edges : []).flatMap(edge =>
      [...(edge.to.kind === 'module' ? [edge.to.path] : []), ...edge.via].map(
        path => [area, graph.modules.get(path)!.area] as const
      )
    )
  )
}

function foldersOf(labels: readonly string[]): readonly string[] {
  const counts = new Map<string, number>()
  for (const folder of labels.map(topFolder)) counts.set(folder, (counts.get(folder) ?? 0) + 1)
  return [...counts]
    .sort(([a, countA], [b, countB]) => countB - countA || compare(a, b))
    .map(([folder]) => folder)
}

/** Tests reachable through ordinary imports, shared by every member of a strongly connected component. */
function testReachOf(graph: Graph, moduleIndex: ReadonlyMap<string, number>) {
  const tests = graph.paths.filter(path => graph.modules.get(path)!.kind === 'test')
  if (tests.length === 0) return (_members: ReadonlySet<RepoPath>) => gapsOf([])
  const testIndex = indexOf(tests)
  const importers = new Map(
    graph.paths.map(path => [
      path,
      [
        ...new Set(
          graph.incoming
            .get(path)!
            .filter(entry => !entry.through)
            .map(entry => entry.from)
        )
      ]
    ])
  )
  const components = stronglyConnected(graph.paths, path => importers.get(path)!)
  const componentOf = new Map(
    components.flatMap((members, index) => members.map(path => [path, index] as const))
  )
  const words = Math.ceil(tests.length / 32)
  const reachable = components.map(() => new Uint32Array(words))
  const union = (into: Uint32Array, from: Uint32Array) => {
    for (let word = 0; word < words; word++) into[word] = into[word]! | from[word]!
  }
  // stronglyConnected puts each component after all components it reaches.
  for (const [index, members] of components.entries()) {
    const bits = reachable[index]!
    for (const path of members) {
      const test = testIndex.get(path)
      if (test !== undefined) bits[test >>> 5] = bits[test >>> 5]! | (1 << (test & 31))
      for (const importer of importers.get(path)!) {
        const other = componentOf.get(importer)!
        if (other !== index) union(bits, reachable[other]!)
      }
    }
  }
  return (members: ReadonlySet<RepoPath>): IndexGaps => {
    const bits = new Uint32Array(words)
    for (const path of members) {
      union(bits, reachable[componentOf.get(path)!]!)
      // A through-barrel edge counts only when the barrel itself is a subject member.
      for (const { from, through } of graph.incoming.get(path)!) {
        if (through) union(bits, reachable[componentOf.get(from)!]!)
      }
    }
    const indexes: number[] = []
    for (let word = 0; word < words; word++) {
      let value = bits[word]!
      while (value !== 0) {
        const bit = 31 - Math.clz32(value & -value)
        const path = tests[word * 32 + bit]!
        if (!members.has(path)) indexes.push(moduleIndex.get(path)!)
        value = (value & (value - 1)) >>> 0
      }
    }
    return gapsOf(indexes)
  }
}

function relationsOf(
  graph: Graph,
  resolved: Resolved,
  moduleIndex: ReadonlyMap<string, number>,
  testsOf: (members: ReadonlySet<RepoPath>) => IndexGaps
): PageRelations {
  const indexes = (paths: Iterable<RepoPath>) =>
    gapsOf(
      [...new Set(paths)]
        .filter(path => !resolved.members.has(path))
        .map(path => moduleIndex.get(path)!)
        .sort((a, b) => a - b)
    )
  const usedBy: RepoPath[] = []
  const uses: RepoPath[] = []
  for (const path of resolved.members) {
    for (const { from } of graph.incoming.get(path)!) {
      if (graph.modules.get(from)!.kind !== 'test') usedBy.push(from)
    }
    for (const { to, via } of graph.modules.get(path)!.facts.edges) {
      if (to.kind === 'module') uses.push(to.path)
      uses.push(...via)
    }
  }
  return {
    usedBy: indexes(usedBy),
    usedByTests: testsOf(resolved.members),
    uses: indexes(uses)
  }
}

function healthOf(
  graph: Graph,
  areaModules: number | undefined,
  areaIndex: ReadonlyMap<string, number>,
  moduleIndex: ReadonlyMap<string, number>
): PageHealth {
  const found = health(graph, areaModules)
  const at = (path: string) => moduleIndex.get(path)!
  return {
    cycles: found.cycles.map(({ modules, loadTime, imports }) => ({
      modules: modules.map(at),
      loadTime,
      breaks: imports
        .filter(entry => entry.break)
        .map(({ from, to, line, names }) => ({ from: at(from), to: at(to), line, names }))
    })),
    areaModules: found.areaModules ?? null,
    oversized: found.oversizedAreas.map(({ path, modules, median }) => ({
      area: areaIndex.get(path)!,
      modules,
      median
    })),
    internal: found.internalImports.map(({ from, to, instead, ...rest }) => ({
      ...rest,
      from: at(from),
      to: to === undefined ? null : at(to),
      instead: instead ?? null
    }))
  }
}

export function pageData(
  graph: Graph,
  source: PageSource | null = null,
  areaModules?: number
): PageData {
  const packageNames = [...graph.packages]
    .sort(([a, { layer: layerA }], [b, { layer: layerB }]) => layerB - layerA || compare(a, b))
    .map(([name]) => name)
  const packageIndex = indexOf(packageNames)
  const areaPaths = [...graph.areas.keys()]
  const areaIndex = indexOf<string>(areaPaths)
  const moduleIndex = indexOf<string>(graph.paths)
  const testsOf = testReachOf(graph, moduleIndex)
  const inCycle = new Set<AreaPath>(graph.areaCycles.flatMap(cycle => cycle.areas))

  const labels = areaPaths.map(path => {
    const area = graph.areas.get(path)!
    return relativeTo(graph.packages.get(area.package)!.dir, path)
  })
  const folders = foldersOf(labels)
  const folderIndex = indexOf(folders)

  const areas = areaPaths.map((path, index): PageArea => {
    const area = graph.areas.get(path)!
    const kinds = { source: 0, test: 0, story: 0, config: 0 }
    for (const module of area.modules) kinds[graph.modules.get(module)!.kind] += 1
    return {
      path,
      label: labels[index]!,
      package: packageIndex.get(area.package)!,
      layer: area.layer,
      folder: folderIndex.get(topFolder(labels[index]!))!,
      kinds,
      modules: area.modules.map(module => moduleIndex.get(module)!),
      cycle: inCycle.has(path),
      ...relationsOf(graph, areaSubject(graph, path), moduleIndex, testsOf)
    }
  })

  const modules = graph.paths.map((path): PageModule => {
    const node = graph.modules.get(path)!
    return {
      path,
      label: relativeTo(node.area, path),
      area: areaIndex.get(node.area)!,
      kind: node.kind,
      symbols: node.facts.symbols,
      ...importCounts(graph, path),
      ...relationsOf(graph, moduleSubject(graph, path), moduleIndex, testsOf)
    }
  })

  const links = areaLinks(graph)
  const packages = packageNames.map((name): PagePackage => {
    const { dir, layer, areas: members } = graph.packages.get(name)!
    const byLayer = new Map<number, AreaPath[]>()
    for (const path of members) {
      const areaLayer = graph.areas.get(path)!.layer
      byLayer.set(areaLayer, [...(byLayer.get(areaLayer) ?? []), path])
    }
    const rows = orderRows(
      [...byLayer].sort(([a], [b]) => b - a).map(([, row]) => row),
      links
    ).map(row => row.map(path => areaIndex.get(path)!))
    const areaCycles = graph.areaCycles
      .filter(cycle => graph.areas.get(cycle.areas[0]!)!.package === name)
      .map(cycle => ({
        areas: cycle.areas.map(path => areaIndex.get(path)!),
        edges: cycle.edges.map(({ from, to, line }) => ({
          from: moduleIndex.get(from)!,
          to: moduleIndex.get(to)!,
          line
        }))
      }))
    const moduleCycles = graph.cycles
      .filter(cycle => graph.modules.get(cycle[0]!)!.package === name)
      .map(cycle => cycle.map(path => moduleIndex.get(path)!))
    return { name, dir, layer, rows, areaCycles, moduleCycles }
  })

  return {
    repository: graph.repository.name,
    folders,
    packages,
    areas,
    modules,
    source,
    health: healthOf(graph, areaModules, areaIndex, moduleIndex)
  }
}
