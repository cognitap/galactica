/**
 * Dependency order above the module: the layer of each area within its
 * package, the area cycles that make areas share a layer, and the order of
 * packages.
 */

import {
  compare,
  type Area,
  type AreaCycle,
  type AreaPath,
  type ClosingEdge,
  type Edge,
  type Graph,
  type Model,
  type ModuleNode,
  type PackageName,
  type RepoPath
} from './model.ts'
import { isSourceOrConfig } from './source-file.ts'
import { adjacency, layersOf, stronglyConnected } from './strongly-connected.ts'

export type Placed = Pick<ModuleNode, 'facts' | 'package' | 'area' | 'kind'>
export type Nodes = ReadonlyMap<RepoPath, Placed>

export interface Dependency {
  readonly from: RepoPath
  readonly to: RepoPath
  readonly source: Placed
  readonly target: Placed
  readonly edge: Edge
}

/** Every edge to a module in `nodes`, in path order, then edge order. */
export function* dependencies(nodes: Nodes): Generator<Dependency> {
  for (const [from, source] of nodes) {
    for (const edge of source.facts.edges) {
      if (edge.to.kind !== 'module') continue
      const target = nodes.get(edge.to.path)
      if (target) yield { from, to: edge.to.path, source, target, edge }
    }
  }
}

const sortedUnique = (edges: readonly ClosingEdge[]): readonly ClosingEdge[] => {
  const byKey = new Map(edges.map(edge => [`${edge.from}\0${edge.to}\0${edge.line}`, edge]))
  return [...byKey.values()].sort(
    (a, b) => compare(a.from, b.from) || compare(a.to, b.to) || a.line - b.line
  )
}

interface Link extends ClosingEdge {
  readonly areas: readonly [AreaPath, AreaPath]
}

export interface AreaLayers {
  readonly areas: Graph['areas']
  readonly areaCycles: Graph['areaCycles']
}

/** Areas with their layers, and the area cycles among them. */
export function layerAreas(nodes: Nodes): AreaLayers {
  const members = new Map<AreaPath, { package: PackageName; modules: RepoPath[] }>()
  const code = new Set<AreaPath>()
  for (const [path, node] of nodes) {
    const area = members.get(node.area) ?? { package: node.package, modules: [] }
    area.modules.push(path)
    members.set(node.area, area)
    if (isSourceOrConfig(node.kind)) code.add(node.area)
  }

  const links: Link[] = []
  const uses: [AreaPath, AreaPath][] = []
  for (const { from, to, source, target, edge } of dependencies(nodes)) {
    if (edge.form === 'reexport' || !isSourceOrConfig(target.kind)) continue
    if (source.package !== target.package || source.area === target.area) continue
    if (isSourceOrConfig(source.kind)) {
      links.push({ from, to, line: edge.line, areas: [source.area, target.area] })
    } else if (!code.has(source.area)) {
      uses.push([source.area, target.area])
    }
  }

  const next = adjacency(links.map(link => link.areas))
  const components = stronglyConnected([...code].sort(compare), next)
  const layers = new Map(layersOf(components, next))
  const used = adjacency(uses)
  for (const area of members.keys()) {
    if (code.has(area)) continue
    layers.set(
      area,
      used(area).reduce((highest, target) => Math.max(highest, layers.get(target)! + 1), 0)
    )
  }

  const areas = [...members.keys()].sort(compare).map((path): Area => ({
    path,
    package: members.get(path)!.package,
    layer: layers.get(path)!,
    modules: members.get(path)!.modules.sort(compare)
  }))
  const areaCycles = components
    .filter(component => component.length > 1)
    .map((component): AreaCycle => {
      const inside = new Set(component)
      const closing = links.filter(({ areas: [from, to] }) => inside.has(from) && inside.has(to))
      return {
        areas: component,
        edges: sortedUnique(closing.map(({ from, to, line }) => ({ from, to, line })))
      }
    })
    .sort((a, b) => compare(a.areas[0]!, b.areas[0]!))
  return { areas: new Map(areas.map(area => [area.path, area])), areaCycles }
}

/** Packages in dependency order, each with its layer and areas. */
export function orderPackages(
  nodes: Nodes,
  packages: Model['packages'],
  areas: Graph['areas']
): Graph['packages'] {
  const pairs: [PackageName, PackageName][] = []
  for (const { source, target } of dependencies(nodes)) {
    if (!isSourceOrConfig(source.kind) || !isSourceOrConfig(target.kind)) continue
    if (source.package !== target.package) pairs.push([source.package, target.package])
  }
  const names = (Object.keys(packages) as PackageName[]).sort(compare)
  const next = adjacency(pairs)
  const layers = layersOf(stronglyConnected(names, next), next)
  const ordered = names.sort((a, b) => layers.get(a)! - layers.get(b)! || compare(a, b))
  return new Map(
    ordered.map(name => [
      name,
      {
        dir: packages[name].dir,
        layer: layers.get(name)!,
        areas: [...areas.values()].filter(area => area.package === name).map(area => area.path)
      }
    ])
  )
}
