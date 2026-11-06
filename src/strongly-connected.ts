/**
 * Strongly connected components and the layers over them, shared by every
 * dependency order the graph computes: module cycles, area layers and the
 * package order.
 */

import { compare } from './model.ts'

type Successors<T> = (node: T) => readonly T[]

/** Successors from (from, to) pairs, each list sorted and without repeats. */
export function adjacency<T extends string>(pairs: Iterable<readonly [T, T]>): Successors<T> {
  const sets = new Map<T, Set<T>>()
  for (const [from, to] of pairs) {
    const set = sets.get(from) ?? new Set()
    sets.set(from, set.add(to))
  }
  const lists = new Map([...sets].map(([node, set]) => [node, [...set].sort(compare)]))
  return node => lists.get(node) ?? []
}

interface Frame<T> {
  readonly node: T
  readonly successors: readonly T[]
  next: number
}

/**
 * Tarjan's algorithm, without recursion so deep graphs cannot overflow the
 * stack. Each component comes after every component it reaches, with its
 * members sorted.
 */
export function stronglyConnected<T extends string>(
  nodes: readonly T[],
  successors: Successors<T>
): readonly (readonly T[])[] {
  const index = new Map<T, number>()
  const low = new Map<T, number>()
  const open: T[] = []
  const isOpen = new Set<T>()
  const frames: Frame<T>[] = []
  const components: T[][] = []

  const enter = (node: T) => {
    low.set(node, index.size)
    index.set(node, index.size)
    open.push(node)
    isOpen.add(node)
    frames.push({ node, successors: successors(node), next: 0 })
  }
  const lower = (node: T, value: number) => low.set(node, Math.min(low.get(node)!, value))

  for (const root of nodes) {
    if (index.has(root)) continue
    enter(root)
    while (frames.length > 0) {
      const frame = frames.at(-1)!
      const successor = frame.successors[frame.next]
      if (successor !== undefined) {
        frame.next += 1
        if (!index.has(successor)) enter(successor)
        else if (isOpen.has(successor)) lower(frame.node, index.get(successor)!)
        continue
      }
      frames.pop()
      const parent = frames.at(-1)
      if (parent) lower(parent.node, low.get(frame.node)!)
      if (low.get(frame.node) !== index.get(frame.node)) continue
      const component: T[] = []
      let member: T
      do {
        member = open.pop()!
        isOpen.delete(member)
        component.push(member)
      } while (member !== frame.node)
      components.push(component.sort(compare))
    }
  }
  return components
}

/**
 * The layer of each node, given `components` in the order `stronglyConnected`
 * returns them: 0 when its component reaches no other, else one above the
 * highest component it reaches. Members of one component share its layer.
 */
export function layersOf<T extends string>(
  components: readonly (readonly T[])[],
  successors: Successors<T>
): ReadonlyMap<T, number> {
  const layers = new Map<T, number>()
  for (const component of components) {
    const members = new Set(component)
    const layer = component
      .flatMap(successors)
      .filter(node => !members.has(node))
      .reduce((highest, node) => Math.max(highest, layers.get(node)! + 1), 0)
    for (const member of component) layers.set(member, layer)
  }
  return layers
}
