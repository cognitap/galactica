import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { pageData, type PageData } from '../src/page-data.ts'
import { defines, edge, modelOf } from './models.ts'

const areaPaths = (page: PageData, indexes: readonly number[]) =>
  indexes.map(index => page.areas[index]!.path)

const modulePaths = (page: PageData, indexes: readonly number[]) =>
  indexes.map(index => page.modules[index]!.path)

const monorepo = pageData(
  graphOf(
    modelOf(
      {
        'packages/app/src/main.ts': {
          edges: [edge('packages/app/src/ui/view.ts'), edge('packages/core/src/index.ts')]
        },
        'packages/app/src/ui/view.ts': { edges: [edge('packages/app/src/ui/button.ts')] },
        'packages/app/src/ui/button.ts': {},
        'packages/app/scripts/build.ts': {},
        'packages/app/scripts/clean.ts': {},
        'packages/core/src/index.ts': {
          symbols: [
            defines('add', 2, { kind: 'function', signature: 'function add(a, b)', doc: 'Adds.' })
          ]
        },
        'packages/core/src/index.test.ts': { edges: [edge('packages/core/src/index.ts')] }
      },
      { '@m/app': 'packages/app', '@m/core': 'packages/core' }
    )
  )
)

test('packages come highest layer first, each with its areas in rows from the highest layer down', () => {
  assert.equal(monorepo.repository, 'acme')
  assert.deepEqual(
    monorepo.packages.map(({ name, dir, layer, rows }) => ({
      name,
      dir,
      layer,
      rows: rows.map(row => areaPaths(monorepo, row))
    })),
    [
      {
        name: '@m/app',
        dir: 'packages/app',
        layer: 1,
        rows: [['packages/app/src'], ['packages/app/scripts', 'packages/app/src/ui']]
      },
      { name: '@m/core', dir: 'packages/core', layer: 0, rows: [['packages/core/src']] }
    ]
  )
})

test('an area is labelled relative to its package and coloured by its top-level folder there', () => {
  assert.deepEqual(monorepo.folders, ['src', 'scripts'])
  assert.deepEqual(
    monorepo.areas.map(area => [area.label, monorepo.folders[area.folder], area.layer]),
    [
      ['scripts', 'scripts', 0],
      ['src', 'src', 1],
      ['src/ui', 'src', 0],
      ['src', 'src', 0]
    ]
  )
  const core = monorepo.areas.find(area => area.path === 'packages/core/src')!
  assert.equal(monorepo.packages[core.package]!.name, '@m/core')
  assert.deepEqual(core.kinds, { source: 1, test: 1, story: 0, config: 0 })
  assert.deepEqual(modulePaths(monorepo, core.modules), [
    'packages/core/src/index.test.ts',
    'packages/core/src/index.ts'
  ])
})

test('a module carries its symbols and the imports it makes and receives', () => {
  const byPath = new Map(monorepo.modules.map(module => [module.path, module]))
  const index = byPath.get('packages/core/src/index.ts')!
  assert.equal(index.label, 'index.ts')
  assert.equal(monorepo.areas[index.area]!.path, 'packages/core/src')
  assert.deepEqual(index.symbols, [
    {
      name: 'add',
      kind: 'function',
      line: 2,
      default: false,
      signature: 'function add(a, b)',
      doc: 'Adds.'
    }
  ])
  assert.deepEqual(
    [...byPath.values()].map(({ path, kind, imports, importers }) => [
      path,
      kind,
      imports,
      importers
    ]),
    [
      ['packages/app/scripts/build.ts', 'source', 0, 0],
      ['packages/app/scripts/clean.ts', 'source', 0, 0],
      ['packages/app/src/main.ts', 'source', 2, 0],
      ['packages/app/src/ui/button.ts', 'source', 0, 1],
      ['packages/app/src/ui/view.ts', 'source', 1, 1],
      ['packages/core/src/index.test.ts', 'test', 1, 0],
      ['packages/core/src/index.ts', 'source', 0, 1]
    ]
  )
})

test('area cycles carry their closing imports, and module cycles are listed', () => {
  const page = pageData(
    graphOf(
      modelOf({
        'src/orders/order.ts': { edges: [edge('src/users/user.ts', { line: 4 })] },
        'src/orders/tax.ts': {},
        'src/users/user.ts': { edges: [edge('src/orders/order.ts', { line: 7 })] },
        'src/users/name.ts': {},
        'src/main.ts': {}
      })
    )
  )
  const [acme] = page.packages
  assert.deepEqual(
    acme!.areaCycles.map(cycle => ({
      areas: areaPaths(page, cycle.areas),
      edges: cycle.edges.map(
        ({ from, to, line }) => `${page.modules[from]!.path}:${line} → ${page.modules[to]!.path}`
      )
    })),
    [
      {
        areas: ['src/orders', 'src/users'],
        edges: [
          'src/orders/order.ts:4 → src/users/user.ts',
          'src/users/user.ts:7 → src/orders/order.ts'
        ]
      }
    ]
  )
  assert.deepEqual(
    acme!.moduleCycles.map(cycle => modulePaths(page, cycle)),
    [['src/orders/order.ts', 'src/users/user.ts']]
  )
  assert.deepEqual(
    page.areas.map(area => [area.path, area.cycle]),
    [
      ['src', false],
      ['src/orders', true],
      ['src/users', true]
    ]
  )
})

test('areas in a row are ordered so the imports between rows cross less', () => {
  const page = pageData(
    graphOf(
      modelOf({
        'src/a/one.ts': { edges: [edge('src/y/one.ts')] },
        'src/a/two.ts': {},
        'src/b/one.ts': { edges: [edge('src/x/one.ts')] },
        'src/b/two.ts': {},
        'src/x/one.ts': {},
        'src/x/two.ts': {},
        'src/y/one.ts': {},
        'src/y/two.ts': {}
      })
    )
  )
  assert.deepEqual(
    page.packages[0]!.rows.map(row => areaPaths(page, row)),
    [
      ['src/b', 'src/a'],
      ['src/x', 'src/y']
    ]
  )
})
