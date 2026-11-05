import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moduleCycles } from '../src/cycles.ts'
import { layerAreas, orderPackages, type Placed } from '../src/layers.ts'
import {
  emptyConfig,
  type AreaPath,
  type Edge,
  type Model,
  type PackageName,
  type RepoPath
} from '../src/model.ts'
import { kindOf } from '../src/source-file.ts'

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

interface Spec {
  readonly area: string
  readonly package?: string
  readonly edges?: readonly Edge[]
}

function nodesOf(specs: Readonly<Record<string, Spec>>): ReadonlyMap<RepoPath, Placed> {
  return new Map(
    Object.entries(specs).map(([path, spec]) => [
      path as RepoPath,
      {
        facts: { path: path as RepoPath, hash: 'h', symbols: [], edges: spec.edges ?? [] },
        package: (spec.package ?? 'acme') as PackageName,
        area: spec.area as AreaPath,
        kind: kindOf(path as RepoPath, emptyConfig)
      }
    ])
  )
}

const layers = (specs: Readonly<Record<string, Spec>>) =>
  Object.fromEntries(
    [...layerAreas(nodesOf(specs)).areas].map(([path, area]) => [path, area.layer])
  )

test('an area sits one above the highest area it imports', () => {
  assert.deepEqual(
    layers({
      'app/main.ts': { area: 'app', edges: [edge('ui/Button.tsx'), edge('lib/cn.ts')] },
      'ui/Button.tsx': { area: 'ui', edges: [edge('lib/cn.ts')] },
      'lib/cn.ts': { area: 'lib' }
    }),
    { app: 2, lib: 0, ui: 1 }
  )
})

test('areas list their package and sorted modules', () => {
  const { areas } = layerAreas(
    nodesOf({ 'ui/b.ts': { area: 'ui' }, 'ui/a.ts': { area: 'ui' }, 'lib/c.ts': { area: 'lib' } })
  )
  assert.deepEqual(
    [...areas.values()],
    [
      { path: 'lib', package: 'acme', layer: 0, modules: ['lib/c.ts'] },
      { path: 'ui', package: 'acme', layer: 0, modules: ['ui/a.ts', 'ui/b.ts'] }
    ]
  )
})

test('a re-export makes no layer edge', () => {
  assert.deepEqual(
    layers({
      'src/index.ts': { area: 'src', edges: [edge('src/ui/Button.tsx', { form: 'reexport' })] },
      'src/cn.ts': { area: 'src' },
      'src/ui/Button.tsx': { area: 'src/ui', edges: [edge('src/cn.ts')] }
    }),
    { src: 0, 'src/ui': 1 }
  )
})

test('a type-only import makes a layer edge but no module cycle', () => {
  const specs = {
    'a/one.ts': { area: 'a', edges: [edge('b/two.ts', { typeOnly: true })] },
    'b/two.ts': { area: 'b', edges: [edge('a/one.ts')] }
  }
  const { areas, areaCycles } = layerAreas(nodesOf(specs))
  assert.equal(areas.get('a' as AreaPath)?.layer, 0)
  assert.equal(areaCycles.length, 1)
  assert.deepEqual(moduleCycles(nodesOf(specs)), [])
})

test('a two-area cycle shares a layer and reports the edges that close it', () => {
  const specs = {
    'app/main.ts': { area: 'app', edges: [edge('orders/order.ts')] },
    'orders/order.ts': {
      area: 'orders',
      edges: [edge('shared/id.ts'), edge('users/user.ts', { line: 2 })]
    },
    'orders/tax.ts': { area: 'orders' },
    'users/user.ts': {
      area: 'users',
      edges: [edge('orders/order.ts', { line: 3 }), edge('orders/tax.ts', { line: 4 })]
    },
    'shared/id.ts': { area: 'shared' }
  }
  const { areaCycles } = layerAreas(nodesOf(specs))
  assert.deepEqual(layers(specs), { app: 2, orders: 1, shared: 0, users: 1 })
  assert.deepEqual(areaCycles, [
    {
      areas: ['orders', 'users'],
      edges: [
        { from: 'orders/order.ts', to: 'users/user.ts', line: 2 },
        { from: 'users/user.ts', to: 'orders/order.ts', line: 3 },
        { from: 'users/user.ts', to: 'orders/tax.ts', line: 4 }
      ]
    }
  ])
  assert.deepEqual(moduleCycles(nodesOf(specs)), [['orders/order.ts', 'users/user.ts']])
})

test('an area of only tests sits above the areas it imports and moves none of them', () => {
  assert.deepEqual(
    layers({
      'tests/app.test.ts': { area: 'tests', edges: [edge('src/ui/Button.tsx')] },
      'tests/helpers/render.test.ts': { area: 'tests/helpers', edges: [] },
      'src/ui/Button.tsx': { area: 'src/ui', edges: [edge('src/lib/cn.ts')] },
      'src/lib/cn.ts': { area: 'src/lib', edges: [] },
      'src/lib/cn.test.ts': { area: 'src/lib', edges: [edge('tests/app.test.ts')] }
    }),
    { 'src/lib': 0, 'src/ui': 1, tests: 2, 'tests/helpers': 0 }
  )
})

test('a test in a mixed area does not move that area', () => {
  assert.deepEqual(
    layers({
      'lib/format.ts': { area: 'lib' },
      'lib/format.test.ts': { area: 'lib', edges: [edge('ui/Price.tsx')] },
      'ui/Price.tsx': { area: 'ui', edges: [edge('lib/format.ts')] },
      'ui/Price.stories.tsx': { area: 'ui', edges: [edge('ui/Price.tsx')] }
    }),
    { lib: 0, ui: 1 }
  )
})

test('cross-package edges order packages and leave area layers alone', () => {
  const specs = {
    'apps/web/main.ts': {
      area: 'apps/web',
      package: 'web',
      edges: [edge('packages/ui/Button.tsx')]
    },
    'packages/ui/Button.tsx': {
      area: 'packages/ui',
      package: 'ui',
      edges: [edge('packages/cn/cn.ts')]
    },
    'packages/cn/cn.ts': { area: 'packages/cn', package: 'cn' },
    'tools/check.test.ts': { area: 'tools', package: 'web', edges: [edge('packages/cn/cn.ts')] }
  }
  const nodes = nodesOf(specs)
  const { areas } = layerAreas(nodes)
  assert.deepEqual(layers(specs), { 'apps/web': 0, 'packages/cn': 0, 'packages/ui': 0, tools: 0 })
  const packages: Model['packages'] = {
    ['web' as PackageName]: { dir: 'apps/web' as RepoPath },
    ['ui' as PackageName]: { dir: 'packages/ui' as RepoPath },
    ['cn' as PackageName]: { dir: 'packages/cn' as RepoPath },
    ['docs' as PackageName]: { dir: 'docs' as RepoPath }
  }
  assert.deepEqual(
    [...orderPackages(nodes, packages, areas)],
    [
      ['cn', { dir: 'packages/cn', layer: 0, areas: ['packages/cn'] }],
      ['docs', { dir: 'docs', layer: 0, areas: [] }],
      ['ui', { dir: 'packages/ui', layer: 1, areas: ['packages/ui'] }],
      ['web', { dir: 'apps/web', layer: 2, areas: ['apps/web', 'tools'] }]
    ]
  )
})

test('module cycles leave out re-exports, tests and stories, and are sorted', () => {
  const specs = {
    'z/a.ts': { area: 'z', edges: [edge('z/b.ts')] },
    'z/b.ts': { area: 'z', edges: [edge('z/a.ts')] },
    'b/index.ts': { area: 'b', edges: [edge('b/x.ts', { form: 'reexport' })] },
    'b/x.ts': { area: 'b', edges: [edge('b/index.ts')] },
    'c/x.ts': { area: 'c', edges: [edge('c/x.test.ts')] },
    'c/x.test.ts': { area: 'c', edges: [edge('c/x.ts')] },
    'a/m.ts': { area: 'a', edges: [edge('a/n.ts', { dynamic: true })] },
    'a/n.ts': { area: 'a', edges: [edge('a/m.ts')] }
  }
  assert.deepEqual(moduleCycles(nodesOf(specs)), [
    ['a/m.ts', 'a/n.ts'],
    ['z/a.ts', 'z/b.ts']
  ])
})
