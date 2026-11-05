import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { emptyConfig, type RepoPath } from '../src/model.ts'
import { overview } from '../src/overview.ts'
import { defines, edge, edgeTo, modelOf } from './models.ts'

const monorepo = graphOf(
  modelOf(
    {
      'packages/ui/src/cn.ts': { symbols: [defines('cn'), defines('cx', 2)] },
      'packages/ui/src/index.ts': { edges: [edge('packages/ui/src/cn.ts', { form: 'reexport' })] },
      'packages/ui/src/parts/Button.tsx': { edges: [edge('packages/ui/src/cn.ts')] },
      'packages/ui/src/parts/Card.tsx': {
        edges: [edge('packages/ui/src/cn.ts'), edge('packages/ui/src/parts/Button.tsx')]
      },
      'packages/ui/src/parts/Card.test.tsx': { edges: [edge('packages/ui/src/parts/Button.tsx')] },
      'packages/ui/src/parts/Card.stories.tsx': {
        edges: [edge('packages/ui/src/parts/Button.tsx')]
      },
      'packages/app/main.ts': {
        edges: [
          edge('packages/ui/src/cn.ts', { via: ['packages/ui/src/index.ts' as RepoPath] }),
          edge('packages/ui/src/cn.ts', { line: 2 }),
          edgeTo({ kind: 'unresolved', specifier: './gone' }, { line: 3 })
        ]
      }
    },
    { '@acme/ui': 'packages/ui', '@acme/app': 'packages/app' }
  ),
  emptyConfig
)

test('overview lists packages by name and areas by layer, then path', () => {
  const result = overview(monorepo, false)
  assert.deepEqual(
    result.packages.map(({ name, dir, modules, areas }) => [
      name,
      dir,
      modules,
      areas.map(area => [area.path, area.layer, area.modules])
    ]),
    [
      ['@acme/app', 'packages/app', 1, [['packages/app', 0, 1]]],
      [
        '@acme/ui',
        'packages/ui',
        6,
        [
          ['packages/ui/src', 0, 2],
          ['packages/ui/src/parts', 1, 4]
        ]
      ]
    ]
  )
  assert.equal(result.cycles, 0)
  assert.equal(result.unresolved, 1)
})

test('top ranks modules by distinct importers that are no tests or stories, barrels aside', () => {
  const [, ui] = overview(monorepo, false).packages
  assert.deepEqual(ui.areas[0].top, [
    { path: 'packages/ui/src/cn.ts', importers: 4, exports: ['cn', 'cx'] },
    { path: 'packages/ui/src/index.ts', importers: 0, exports: [] }
  ])
  assert.deepEqual(
    ui.areas[1].top.map(({ path, importers }) => [path, importers]),
    [
      ['packages/ui/src/parts/Button.tsx', 1],
      ['packages/ui/src/parts/Card.tsx', 0]
    ]
  )
})

test('top leaves out tests and stories, and is empty for an area of only those', () => {
  const graph = graphOf(
    modelOf({
      'src/cn.ts': {},
      'src/cn.test.ts': { edges: [edge('src/cn.ts')] },
      'src/specs/a.test.ts': { edges: [edge('src/cn.ts')] },
      'src/specs/a.stories.tsx': { edges: [edge('src/cn.ts')] }
    }),
    emptyConfig
  )
  for (const all of [false, true]) {
    const areas = overview(graph, all).packages[0].areas
    const tops = Object.fromEntries(areas.map(area => [area.path, area.top.map(m => m.path)]))
    assert.deepEqual(tops, { src: ['src/cn.ts'], 'src/specs': [] })
  }
  assert.equal(overview(graph, false).packages[0].areas[1].modules, 2)
})

test('top holds five modules per area, or all of them with --all', () => {
  const specs = Object.fromEntries(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => [`src/${name}.ts`, {}])
  )
  const graph = graphOf(modelOf(specs), emptyConfig)
  assert.equal(overview(graph, false).packages[0].areas[0].top.length, 5)
  assert.equal(overview(graph, true).packages[0].areas[0].top.length, 7)
})

test('overview counts module cycles', () => {
  const graph = graphOf(
    modelOf({
      'src/a.ts': { edges: [edge('src/b.ts')] },
      'src/b.ts': { edges: [edge('src/a.ts')] }
    }),
    emptyConfig
  )
  assert.equal(overview(graph, false).cycles, 1)
})
