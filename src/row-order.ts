/**
 * The order of the boxes within each layer of the page, chosen to reduce the
 * crossings between the imports of different layers with the barycenter
 * heuristic: each node moves to the mean position of its neighbours in the
 * other layers, sweeping through the layers and back.
 *
 * A node's position is its index in its layer. The page stacks each layer's
 * boxes from the top of its column, so the index, not the share of the
 * column's length, is where a link meets the box.
 */

import { compare } from './model.ts'

const SWEEPS = 4

/**
 * `rows` in order, each reordered by the barycenter of its links to nodes in
 * other rows. Links within a row and repeated links count once. Nodes start in
 * path order, keep their place when they have no links, and break ties by path.
 */
export function orderRows<T extends string>(
  rows: readonly (readonly T[])[],
  links: Iterable<readonly [T, T]>
): readonly (readonly T[])[] {
  const rowOf = new Map(rows.flatMap((row, index) => row.map(node => [node, index] as const)))
  const neighbours = new Map<T, Set<T>>()
  for (const [a, b] of links) {
    if (a === b || rowOf.get(a) === rowOf.get(b) || !rowOf.has(a) || !rowOf.has(b)) continue
    neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b))
    neighbours.set(b, (neighbours.get(b) ?? new Set()).add(a))
  }

  const ordered = rows.map(row => [...row].sort(compare))
  const position = new Map<T, number>()
  const place = (row: readonly T[]) => row.forEach((node, index) => position.set(node, index))
  ordered.forEach(place)

  const down = ordered.map((_, index) => index)
  const sweep = [...down, ...down.toReversed()]
  for (let pass = 0; pass < SWEEPS; pass += 1) {
    for (const index of sweep) {
      const barycenter = new Map(
        ordered[index]!.map(node => {
          const around = [...(neighbours.get(node) ?? [])]
          const mean =
            around.length === 0
              ? position.get(node)!
              : around.reduce((sum, other) => sum + position.get(other)!, 0) / around.length
          return [node, mean]
        })
      )
      ordered[index]!.sort((a, b) => barycenter.get(a)! - barycenter.get(b)! || compare(a, b))
      place(ordered[index]!)
    }
  }
  return ordered
}
