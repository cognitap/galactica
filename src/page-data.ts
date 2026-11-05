/**
 * The data the HTML page draws, derived from the `Graph`. Areas and modules are
 * referred to by their index in `areas` and `modules`, which keeps the
 * embedded JSON small. The shape is private to the page and is no contract.
 */

import type { ModuleKind, Reached } from './contract.ts'
import { compare, type AreaPath, type Graph, type RepoPath, type SymbolFacts } from './model.ts'
import { depsOf, usesOf } from './queries.ts'
import { orderRows } from './row-order.ts'
import { isSourceOrConfig } from './source-file.ts'
import type { PageSource } from './source-links.ts'
import { areaSubject, moduleSubject, type Resolved } from './subjects.ts'

/** What `uses` and `deps` answer at depth 1, as module indexes in ascending order. */
export interface PageRelations {
  /** The `modules` of `uses`: what imports the subject, stories and config included. */
  readonly usedBy: readonly number[]
  /** The `tests` of `uses`, at any distance. */
  readonly usedByTests: readonly number[]
  /** The `modules` of `deps`: what the subject imports in the workspace, barrels included. */
  readonly uses: readonly number[]
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

function areaLinks(graph: Graph): readonly (readonly [AreaPath, AreaPath])[] {
  return [...graph.modules.values()].flatMap(({ facts, area }) =>
    facts.edges.flatMap(edge =>
      edge.to.kind === 'module' ? [[area, graph.modules.get(edge.to.path)!.area] as const] : []
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

function relationsOf(
  graph: Graph,
  resolved: Resolved,
  moduleIndex: ReadonlyMap<string, number>
): PageRelations {
  const indexes = (modules: readonly Reached[]) =>
    modules.map(({ path }) => moduleIndex.get(path)!).sort((a, b) => a - b)
  const { modules: usedBy, tests } = usesOf(graph, resolved, 1)
  return {
    usedBy: indexes(usedBy),
    usedByTests: indexes(tests),
    uses: indexes(depsOf(graph, resolved, 1).modules)
  }
}

export function pageData(graph: Graph, source: PageSource | null = null): PageData {
  const packageNames = [...graph.packages]
    .sort(([a, { layer: layerA }], [b, { layer: layerB }]) => layerB - layerA || compare(a, b))
    .map(([name]) => name)
  const packageIndex = indexOf(packageNames)
  const areaPaths = [...graph.areas.keys()]
  const areaIndex = indexOf<string>(areaPaths)
  const moduleIndex = indexOf<string>(graph.paths)
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
      ...relationsOf(graph, areaSubject(graph, path), moduleIndex)
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
      ...relationsOf(graph, moduleSubject(graph, path), moduleIndex)
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

  return { repository: graph.repository.name, folders, packages, areas, modules, source }
}
