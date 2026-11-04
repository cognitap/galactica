import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layersOf, stronglyConnected } from '../src/strongly-connected.ts'

function graph(edges: Readonly<Record<string, readonly string[]>>) {
  const nodes = Object.keys(edges).sort()
  const successors = (node: string) => edges[node] ?? []
  return { nodes, successors, components: stronglyConnected(nodes, successors) }
}

test('each component comes after the components it reaches, with sorted members', () => {
  const { components } = graph({ a: ['c'], b: ['a'], c: ['b', 'd'], d: [] })
  assert.deepEqual(components, [['d'], ['a', 'b', 'c']])
})

test('a node that reaches itself is a component of one', () => {
  assert.deepEqual(graph({ a: ['a'] }).components, [['a']])
})

test('layers count the longest path to a node that reaches nothing', () => {
  const { components, successors } = graph({ app: ['ui', 'lib'], ui: ['lib'], lib: [], cli: [] })
  assert.deepEqual(Object.fromEntries(layersOf(components, successors)), {
    cli: 0,
    lib: 0,
    ui: 1,
    app: 2
  })
})

test('members of a cycle share a layer above everything the cycle reaches', () => {
  const { components, successors } = graph({ a: ['b'], b: ['a', 'c'], c: [], d: ['a'] })
  const layers = layersOf(components, successors)
  assert.deepEqual(
    [layers.get('a'), layers.get('b'), layers.get('c'), layers.get('d')],
    [1, 1, 0, 2]
  )
})

test('a long chain does not overflow the stack', () => {
  const nodes = Array.from({ length: 100_000 }, (_, index) => String(index).padStart(6, '0'))
  const next = (node: string) => {
    const index = Number(node)
    return index + 1 < nodes.length ? [nodes[index + 1]!] : []
  }
  const components = stronglyConnected(nodes, next)
  assert.equal(components.length, nodes.length)
  assert.equal(layersOf(components, next).get(nodes[0]!), nodes.length - 1)
})
