/**
 * Grouping modules into areas by folder, with no config: each folder is an
 * area, except that a folder of a single module joins its parent.
 */

import type { AreaPath, Model, ModuleNode, RepoPath } from './model.ts'
import { packageOf } from './workspace.ts'

export type Placement = Pick<ModuleNode, 'package' | 'area'>

const directoryOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '.' : path.slice(0, slash)
}

/**
 * The package and area of each module. A folder that holds a single module
 * joins its parent, repeatedly, while the parent holds modules of its own,
 * and never above the package's directory.
 */
export function areasOf(model: Model): ReadonlyMap<RepoPath, Placement> {
  const paths = Object.keys(model.modules) as RepoPath[]
  const counts = new Map<string, number>()
  for (const directory of paths.map(directoryOf)) {
    counts.set(directory, (counts.get(directory) ?? 0) + 1)
  }
  return new Map(
    paths.map(path => {
      const owner = packageOf(model.packages, path)
      if (owner === undefined) throw new Error(`${path} is in no package`)
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
