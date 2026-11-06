import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeRepository } from '../src/analysis.ts'
import { cycles } from '../src/cycles.ts'
import { graphOf } from '../src/graph.ts'
import { health } from '../src/health.ts'
import { emptyConfig } from '../src/model.ts'
import { loaded, validConfigs } from './config-examples.ts'
import { fixtureRepo } from './fixtures.ts'
import { defines, edge, modelOf } from './models.ts'

const graph = graphOf(
  analyzeRepository(fixtureRepo('internal-imports'), emptyConfig).model,
  emptyConfig
)

const main = 'packages/app/src/main.ts'

test('health lists each import into another package once, with the public specifier to use', () => {
  assert.deepEqual(health(graph, undefined).internalImports, [
    {
      from: main,
      line: 1,
      specifier: '../../core/src/math',
      names: ['add'],
      reach: 'relative',
      package: '@fx/core',
      to: 'packages/core/src/math.ts',
      instead: '@fx/core'
    },
    {
      from: main,
      line: 2,
      specifier: '../../core/src/format',
      names: ['format'],
      reach: 'relative',
      package: '@fx/core',
      to: 'packages/core/src/format.ts',
      instead: '@fx/core/format'
    },
    {
      from: main,
      line: 3,
      specifier: '../../core/src/internal/secret',
      names: ['secret'],
      reach: 'relative',
      package: '@fx/core',
      to: 'packages/core/src/internal/secret.ts'
    },
    {
      from: main,
      line: 4,
      specifier: '../../core/src/icons/star',
      names: ['star'],
      reach: 'relative',
      package: '@fx/core',
      to: 'packages/core/src/icons/star.ts',
      instead: '@fx/core/icons/star'
    },
    {
      from: main,
      line: 5,
      specifier: '../../plain/src/text/slug',
      names: ['slug'],
      reach: 'relative',
      package: '@fx/plain',
      to: 'packages/plain/src/text/slug.ts',
      instead: '@fx/plain/src/text/slug'
    },
    {
      from: main,
      line: 7,
      specifier: '@fx/core/src/format',
      names: ['format'],
      reach: 'unlisted',
      package: '@fx/core',
      to: 'packages/core/src/format.ts',
      instead: '@fx/core/format'
    },
    {
      from: main,
      line: 8,
      specifier: '@fx/core/internal/gone',
      names: ['gone'],
      reach: 'unlisted',
      package: '@fx/core'
    }
  ])
})

test('one import that barrels split is one finding with every name, from the module it names', () => {
  const split = graphOf(
    modelOf(
      {
        'packages/app/main.ts': {
          edges: [
            edge('packages/ui/a.ts', {
              names: ['a'],
              via: ['packages/ui/index.ts' as never],
              internal: { specifier: '../ui/index', reach: 'relative', package: 'ui' as never }
            }),
            edge('packages/ui/b.ts', {
              names: ['b'],
              via: ['packages/ui/index.ts' as never],
              internal: { specifier: '../ui/index', reach: 'relative', package: 'ui' as never }
            })
          ]
        },
        'packages/ui/index.ts': {},
        'packages/ui/a.ts': { symbols: [defines('a')] },
        'packages/ui/b.ts': { symbols: [defines('b')] }
      },
      { app: 'packages/app', ui: 'packages/ui' }
    ),
    emptyConfig
  )
  assert.deepEqual(health(split, undefined).internalImports, [
    {
      from: 'packages/app/main.ts',
      line: 1,
      specifier: '../ui/index',
      names: ['a', 'b'],
      reach: 'relative',
      package: 'ui',
      to: 'packages/ui/index.ts'
    }
  ])
})

test('a test that imports another package internals is no finding', () => {
  const findings = health(graph, undefined).internalImports
  assert.ok(graph.modules.get('packages/app/src/main.test.ts' as never)!.facts.edges[0]!.internal)
  assert.equal(
    findings.some(({ from }) => from.endsWith('.test.ts')),
    false
  )
})

test('an area of at least 20 source modules and 5 times its package median is oversized, tests aside', () => {
  const answer = health(graph, undefined)
  assert.equal(answer.areaModules, undefined)
  assert.deepEqual(answer.oversizedAreas, [
    { path: 'packages/big/src/widgets', package: '@fx/big', modules: 20, median: 2 }
  ])
})

test('health.areaModules replaces the relative rule: an area with more source modules is oversized', t => {
  const areaModules = loaded(t, validConfigs.areaModules).health?.areaModules
  assert.equal(areaModules, 19)
  const answer = health(graph, areaModules)
  assert.equal(answer.areaModules, 19)
  assert.deepEqual(
    answer.oversizedAreas.map(({ path }) => path),
    ['packages/big/src/widgets']
  )
  assert.deepEqual(health(graph, 20).oversizedAreas, [])
  assert.deepEqual(
    health(graph, 1).oversizedAreas.map(({ path, modules }) => [path, modules]),
    [
      ['packages/big/src/one', 2],
      ['packages/big/src/two', 2],
      ['packages/big/src/widgets', 20],
      ['packages/core/src', 5],
      ['packages/plain/src/text', 2]
    ]
  )
})

test('health lists the cycles as the cycles command does', () => {
  const cyclic = graphOf(
    modelOf({
      'src/a.ts': { symbols: [defines('a')], edges: [edge('src/b.ts', { names: ['b'] })] },
      'src/b.ts': { symbols: [defines('b')], edges: [edge('src/a.ts', { names: ['a'] })] }
    }),
    emptyConfig
  )
  assert.equal(health(cyclic, undefined).cycles.length, 1)
  assert.deepEqual(health(cyclic, undefined).cycles, cycles(cyclic).cycles)
})

test('fixture conventions cannot create oversized areas or source cycles', () => {
  const specs: Record<string, { edges: ReturnType<typeof edge>[] }> = {
    'src/core.ts': { edges: [] }
  }
  for (const directory of [
    '__testfixtures__',
    '__fixtures__',
    'testdata',
    'testData',
    'fixtures',
    '__mocks__'
  ]) {
    for (let index = 0; index < 25; index++) {
      specs[`src/${directory}/${index}.ts`] = { edges: [edge('src/core.ts')] }
    }
    specs['src/core.ts']!.edges.push(edge(`src/${directory}/0.ts`))
  }
  specs['src/app.e2e-spec.ts'] = { edges: [edge('src/core.ts')] }
  specs['src/core.ts']!.edges.push(edge('src/app.e2e-spec.ts'))
  const graph = graphOf(modelOf(specs), emptyConfig)
  assert.equal(health(graph, undefined).oversizedAreas.length, 0)
  assert.equal(cycles(graph).cycles.length, 0)
})
