import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import {
  emptyConfig,
  MODEL_FORMAT,
  type Edge,
  type Model,
  type ModuleFacts,
  type PackageName,
  type RepoPath,
  type SymbolFacts
} from '../src/model.ts'

const edge = (to: string, fields: Partial<Edge> = {}): Edge => ({
  to: { kind: 'module', path: to as RepoPath },
  line: 1,
  form: 'import',
  names: ['x'],
  typeOnly: false,
  dynamic: false,
  via: [],
  ...fields
})

const defines = (name: string, line = 1): SymbolFacts => ({
  name,
  kind: 'const',
  line,
  default: false,
  signature: `const ${name}`
})

type Spec = Partial<Pick<ModuleFacts, 'symbols' | 'edges'>>

function modelOf(specs: Readonly<Record<string, Spec>>): Model {
  return {
    format: MODEL_FORMAT,
    repository: { name: 'acme' },
    packages: { ['acme' as PackageName]: { dir: '.' as RepoPath } },
    modules: Object.fromEntries(
      Object.entries(specs).map(([path, { symbols = [], edges = [] }]) => [
        path,
        { path: path as RepoPath, hash: 'h', symbols, edges }
      ])
    )
  }
}

test('each module is placed in its package and area, with its kind and language', () => {
  const graph = graphOf(
    modelOf({ 'src/ui/Price.tsx': {}, 'src/ui/Price.stories.tsx': {}, 'vite.config.mjs': {} }),
    emptyConfig
  )
  assert.deepEqual(graph.paths, ['src/ui/Price.stories.tsx', 'src/ui/Price.tsx', 'vite.config.mjs'])
  const summary = [...graph.modules].map(
    ([path, { facts, package: owner, area, kind, language }]) => [
      path,
      facts.path,
      owner,
      area,
      kind,
      language
    ]
  )
  assert.deepEqual(summary, [
    ['src/ui/Price.stories.tsx', 'src/ui/Price.stories.tsx', 'acme', 'src/ui', 'story', 'tsx'],
    ['src/ui/Price.tsx', 'src/ui/Price.tsx', 'acme', 'src/ui', 'source', 'tsx'],
    ['vite.config.mjs', 'vite.config.mjs', 'acme', '.', 'config', 'mjs']
  ])
  assert.deepEqual([...graph.packages], [['acme', { dir: '.', layer: 0, areas: ['.', 'src/ui'] }]])
})

test('incoming lists each importer, and marks the barrels an edge only routed through', () => {
  const throughBarrel = edge('src/ui/Button.tsx', { line: 2, via: ['src/index.ts' as RepoPath] })
  const direct = edge('src/ui/Button.tsx', { line: 1 })
  const reexport = edge('src/ui/Button.tsx', { form: 'reexport' })
  const graph = graphOf(
    modelOf({
      'src/main.ts': { edges: [throughBarrel] },
      'src/app.ts': { edges: [direct] },
      'src/index.ts': { edges: [reexport] },
      'src/ui/Button.tsx': {}
    }),
    emptyConfig
  )
  assert.deepEqual(graph.incoming.get('src/ui/Button.tsx' as RepoPath), [
    { from: 'src/app.ts', edge: direct, through: false },
    { from: 'src/index.ts', edge: reexport, through: false },
    { from: 'src/main.ts', edge: throughBarrel, through: false }
  ])
  assert.deepEqual(graph.incoming.get('src/index.ts' as RepoPath), [
    { from: 'src/main.ts', edge: throughBarrel, through: true }
  ])
  assert.deepEqual(graph.incoming.get('src/app.ts' as RepoPath), [])
})

test('symbols map each name to its definitions by module path, then line', () => {
  const graph = graphOf(
    modelOf({
      'src/b.ts': { symbols: [defines('format', 3), defines('Price', 5)] },
      'src/a.ts': { symbols: [defines('format', 9)] },
      'src/b/c.ts': { symbols: [defines('format', 1)] }
    }),
    emptyConfig
  )
  assert.deepEqual([...graph.symbols.keys()], ['Price', 'format'])
  assert.deepEqual(
    graph.symbols.get('format')?.map(({ module, symbol }) => [module, symbol.line]),
    [
      ['src/a.ts', 9],
      ['src/b.ts', 3],
      ['src/b/c.ts', 1]
    ]
  )
})

test('the graph carries the layers and cycles of its model', () => {
  const graph = graphOf(
    modelOf({
      'src/orders/order.ts': { edges: [edge('src/users/user.ts')] },
      'src/orders/tax.ts': {},
      'src/users/user.ts': { edges: [edge('src/orders/order.ts')] },
      'src/users/name.ts': {}
    }),
    emptyConfig
  )
  assert.deepEqual(
    [...graph.areas.values()].map(area => [area.path, area.layer]),
    [
      ['src/orders', 0],
      ['src/users', 0]
    ]
  )
  assert.deepEqual(graph.cycles, [['src/orders/order.ts', 'src/users/user.ts']])
  assert.deepEqual(graph.areaCycles, [
    {
      areas: ['src/orders', 'src/users'],
      edges: [
        { from: 'src/orders/order.ts', to: 'src/users/user.ts', line: 1 },
        { from: 'src/users/user.ts', to: 'src/orders/order.ts', line: 1 }
      ]
    }
  ])
})
