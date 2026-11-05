/**
 * Grouping modules into areas: the area `galactica.config.json` names for a
 * module, or else its folder, except that a folder of a single module joins
 * its parent.
 */

import { posix } from 'node:path'
import { ConfigError } from './config.ts'
import type {
  AreaPath,
  AreaRule,
  Config,
  Model,
  ModuleNode,
  PackageName,
  RepoPath
} from './model.ts'
import { packageOf } from './workspace.ts'

export type Placement = Pick<ModuleNode, 'package' | 'area'>

const directoryOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '.' : path.slice(0, slash)
}

/** The area the first matching rule names, which must lie in the module's own package. */
function configuredArea(
  model: Model,
  rules: readonly AreaRule[],
  path: RepoPath,
  owner: PackageName
): AreaPath | undefined {
  const rule = rules.find(({ glob }) => posix.matchesGlob(path, glob))
  if (rule === undefined) return undefined
  if (packageOf(model.packages, rule.area as string as RepoPath) !== owner) {
    throw new ConfigError(
      `areas[${JSON.stringify(rule.glob)}]`,
      `${rule.area} is not in package ${owner} (${model.packages[owner].dir}), the package of ${path}`
    )
  }
  return rule.area
}

/**
 * The package and area of each module. A module a rule of the config matches
 * is in the area the rule names. Of the others, a folder that holds a single
 * module joins its parent, repeatedly, while the parent holds modules of its
 * own, and never above the package's directory.
 */
export function areasOf(model: Model, config: Config): ReadonlyMap<RepoPath, Placement> {
  const paths = Object.keys(model.modules) as RepoPath[]
  const owners = new Map(
    paths.map(path => {
      const owner = packageOf(model.packages, path)
      if (owner === undefined) throw new Error(`${path} is in no package`)
      return [path, { owner, configured: configuredArea(model, config.areas, path, owner) }]
    })
  )
  const counts = new Map<string, number>()
  for (const path of paths.filter(path => owners.get(path)!.configured === undefined)) {
    const directory = directoryOf(path)
    counts.set(directory, (counts.get(directory) ?? 0) + 1)
  }
  return new Map(
    paths.map(path => {
      const { owner, configured } = owners.get(path)!
      if (configured !== undefined) return [path, { package: owner, area: configured }]
      const top = model.packages[owner].dir
      let area = directoryOf(path)
      // Merging only single-module folders keeps each Radiant component family,
      // a component and its story, its own area. Merging folders of two modules
      // too cascades: radiant-docs' app router folds into the root area. A parent
      // with no modules of its own only groups folders, and merging through it
      // would carry src/components/ThemeScope/ThemeScope.tsx into src, beside cn.ts.
      while (area !== top && counts.get(area) === 1 && counts.has(directoryOf(area))) {
        area = directoryOf(area)
      }
      return [path, { package: owner, area: area as AreaPath }]
    })
  )
}
