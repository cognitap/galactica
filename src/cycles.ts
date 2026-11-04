/** Module cycles, the import loops among the code that runs. */

import { compare, type Graph, type RepoPath } from './model.ts'
import { dependencies, type Nodes } from './layers.ts'
import { isSourceOrConfig } from './source-file.ts'
import { adjacency, stronglyConnected } from './strongly-connected.ts'

export function moduleCycles(nodes: Nodes): Graph['cycles'] {
  const pairs: [RepoPath, RepoPath][] = []
  for (const { from, to, source, target, edge } of dependencies(nodes)) {
    if (edge.typeOnly || edge.form === 'reexport') continue
    if (!isSourceOrConfig(source.kind) || !isSourceOrConfig(target.kind)) continue
    pairs.push([from, to])
  }
  const code = [...nodes.keys()]
    .filter(path => isSourceOrConfig(nodes.get(path)!.kind))
    .sort(compare)
  return stronglyConnected(code, adjacency(pairs))
    .filter(component => component.length > 1)
    .sort((a, b) => compare(a[0]!, b[0]!))
}
