/**
 * Imports that reach into another workspace package's internals: a relative
 * path into its directory, or a subpath of the package that its `exports` does
 * not list. Read as imports resolve, before barrels are followed, with the
 * public specifier that gives the same import where the package has one.
 */

import { definitionFinder } from './barrels.ts'
import type { DiscoveredModule, Discovery } from './discovery.ts'
import { isRelative, type Resolution } from './import-resolution.ts'
import type { Edge, Internal, Model, RepoPath } from './model.ts'
import type { WorkspaceResolver } from './package-resolution.ts'

/**
 * How an import reaches into another package, or undefined when it does not.
 * A relative path counts when it leads into a package whose directory does
 * not hold the importer, so a module of a nested package may reach up into
 * the shared files of the root.
 */
export function reachFinder(
  discovery: Discovery,
  workspace: WorkspaceResolver
): (module: DiscoveredModule, specifier: string, to: Resolution) => Internal | undefined {
  const owners = new Map(discovery.modules.map(module => [module.path, module.package]))
  return (module, specifier, to) => {
    if (isRelative(specifier)) {
      if (to.kind !== 'module') return undefined
      const owner = owners.get(to.path)!
      const { dir } = discovery.packages[owner]
      const holds = dir === '.' || module.path.startsWith(`${dir}/`)
      return holds ? undefined : { specifier, reach: 'relative', package: owner }
    }
    const exposure = workspace.exposure(specifier)
    if (exposure === undefined || exposure.listed || exposure.package === module.package) {
      return undefined
    }
    return { specifier, reach: 'unlisted', package: exposure.package }
  }
}

/**
 * `modules` with each internal import given the public specifier to use
 * instead: an entry of the package that reaches the same module, else one
 * that exports each name the import takes from the same definition, else a
 * `*` subpath or, with no `exports`, the module's own path. A namespace or
 * side-effect import takes only the same module.
 */
export function withInstead(
  modules: Model['modules'],
  workspace: WorkspaceResolver
): Model['modules'] {
  const definitionOf = definitionFinder(modules)
  const same = (a: RepoPath, b: RepoPath, name: string) => {
    const left = definitionOf(a, name)
    const right = definitionOf(b, name)
    return (
      left !== undefined &&
      right !== undefined &&
      left.name === right.name &&
      JSON.stringify(left.to) === JSON.stringify(right.to)
    )
  }
  const insteadOf = (edge: Edge, internal: Internal): string | undefined => {
    if (edge.to.kind !== 'module') return undefined
    const target = edge.to.path
    const entries = workspace.entries(internal.package)
    const exportsNames =
      edge.names.length > 0 && !edge.names.includes('*')
        ? (entry: RepoPath) => edge.names.every(name => same(entry, target, name))
        : () => false
    return (
      entries.find(({ path }) => path === target)?.specifier ??
      entries.find(({ path }) => exportsNames(path))?.specifier ??
      workspace.deepSpecifier(internal.package, target)
    )
  }
  return Object.fromEntries(
    Object.entries(modules).map(([path, facts]) => {
      if (!facts.edges.some(edge => edge.internal)) return [path, facts]
      const edges = facts.edges.map(edge => {
        if (edge.internal === undefined) return edge
        const instead = insteadOf(edge, edge.internal)
        return instead === undefined ? edge : { ...edge, internal: { ...edge.internal, instead } }
      })
      return [path, { ...facts, edges }]
    })
  )
}
