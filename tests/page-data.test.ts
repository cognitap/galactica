import assert from 'node:assert/strict'
import { test } from 'node:test'
import { symbolKinds, type Deps, type Failure, type Uses } from '../src/contract.ts'
import { graphOf } from '../src/graph.ts'
import { emptyConfig, type AreaPath, type RepoPath } from '../src/model.ts'
import {
  pageData,
  wireDataOf,
  type PageData,
  type PageRelations,
  type PageWireData
} from '../src/page-data.ts'
import { decodePage } from '../src/page/decode.js'
import { indexesOf } from '../src/page/indexes.js'
import { deps, depsOf, uses, usesOf } from '../src/queries.ts'
import { areaSubject, moduleSubject, type Resolved } from '../src/subjects.ts'
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
    ),
    emptyConfig
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

test('an area is labelled relative to its package', () => {
  assert.deepEqual(
    monorepo.areas.map(area => [area.label, area.layer]),
    [
      ['scripts', 0],
      ['src', 1],
      ['src/ui', 0],
      ['src', 0]
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
      }),
      emptyConfig
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
    page.health.cycles.map(cycle => modulePaths(page, cycle.modules)),
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
      }),
      emptyConfig
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

const app = graphOf(
  modelOf({
    'src/cn.ts': { symbols: [defines('cn', 2)] },
    'src/index.ts': {
      edges: [
        edge('src/cn.ts', { form: 'reexport', names: ['cn'] }),
        edge('src/lone.ts', { line: 2, form: 'reexport', names: ['lone'] })
      ]
    },
    'src/lone.ts': { symbols: [defines('lone')] },
    'src/app/main.ts': {
      edges: [edge('src/cn.ts', { names: ['cn'], via: ['src/index.ts' as RepoPath] })]
    },
    'src/ui/Button.tsx': { edges: [edge('src/cn.ts', { names: ['cn'] })] },
    'src/ui/Card.tsx': { edges: [edge('src/ui/Button.tsx')] },
    'src/ui/Button.stories.tsx': { edges: [edge('src/ui/Button.tsx')] },
    'src/ui/Card.test.tsx': { edges: [edge('src/ui/Card.tsx')] },
    'tests/cn.test.ts': { edges: [edge('src/cn.ts', { names: ['cn'] })] },
    'vite.config.ts': { edges: [edge('src/app/main.ts')] }
  }),
  emptyConfig
)
const appPage = pageData(app)

function answered<T extends Uses | Deps>(answer: T | Failure): T {
  assert.ok(!('error' in answer), 'the subject resolves')
  return answer
}

interface Relations {
  readonly usedBy: readonly number[]
  readonly usedByTests: readonly number[]
  readonly uses: readonly number[]
}

function cliRelations(text: string): Relations {
  const indexOf = new Map(appPage.modules.map(({ path }, index) => [path, index]))
  const indexes = (modules: readonly { readonly path: string }[]) =>
    modules.map(({ path }) => indexOf.get(path)!).sort((a, b) => a - b)
  const { modules, tests } = answered(uses(app, text, undefined, 1))
  return {
    usedBy: indexes(modules),
    usedByTests: indexes(tests),
    uses: indexes(answered(deps(app, text, undefined, 1)).modules)
  }
}

const relations = ({ usedBy, usedByTests, uses }: PageRelations): Relations => ({
  usedBy: indexesOf(usedBy),
  usedByTests: indexesOf(usedByTests),
  uses: indexesOf(uses)
})

test('each module and area carries what uses and deps answer for it at depth 1', () => {
  for (const module of appPage.modules) {
    assert.deepEqual(relations(module), cliRelations(module.path), module.path)
  }
  for (const area of appPage.areas.filter(({ path }) => path !== '.')) {
    assert.deepEqual(relations(area), cliRelations(area.path), area.path)
  }
  const cn = appPage.modules.find(({ path }) => path === 'src/cn.ts')!
  assert.deepEqual(modulePaths(appPage, relations(cn).usedBy), [
    'src/app/main.ts',
    'src/index.ts',
    'src/ui/Button.tsx'
  ])
  assert.deepEqual(modulePaths(appPage, relations(cn).usedByTests), [
    'src/ui/Card.test.tsx',
    'tests/cn.test.ts'
  ])
  const main = appPage.modules.find(({ path }) => path === 'src/app/main.ts')!
  assert.deepEqual(modulePaths(appPage, relations(main).uses), ['src/cn.ts', 'src/index.ts'])
})

test('an area at a package directory answers for the area, not for the package', () => {
  const root = appPage.areas.find(({ path }) => path === '.')!
  assert.deepEqual(modulePaths(appPage, relations(root).uses), ['src/app/main.ts'])
  assert.deepEqual(root.usedBy, [])
  assert.notDeepEqual(relations(root), cliRelations('.'))
})

test('page test reach reads the graph a bounded number of times (DEV-730)', () => {
  const specs = Object.fromEntries([
    ...Array.from({ length: 120 }, (_, index) => [
      `src/m${index}.ts`,
      { edges: index === 0 ? [] : [edge(`src/m${index - 1}.ts`)] }
    ]),
    ...Array.from({ length: 20 }, (_, index) => [
      `tests/m${index}.test.ts`,
      { edges: [edge('src/m119.ts')] }
    ])
  ])
  const graph = graphOf(modelOf(specs), emptyConfig)
  const incoming = new Map(graph.incoming)
  const get = incoming.get.bind(incoming)
  let reads = 0
  incoming.get = path => {
    reads++
    return get(path)
  }
  const page = pageData({ ...graph, incoming })
  const first = page.modules.find(module => module.path === 'src/m0.ts')!
  assert.equal(indexesOf(first.usedByTests).length, 20)
  assert.ok(
    reads < graph.modules.size * 20,
    `page made ${reads} incoming lookups for ${graph.modules.size} modules`
  )
})

test('batched page relations match commands through cycles, barrels and more than 64 tests', () => {
  const graph = graphOf(
    modelOf({
      'src/a.ts': { edges: [edge('src/b.ts', { typeOnly: true }), edge('src/cycle.test.ts')] },
      'src/b.ts': { edges: [edge('src/a.ts')] },
      'src/lone.ts': {},
      'src/index.ts': {
        edges: [edge('src/a.ts', { form: 'reexport' }), edge('src/lone.ts', { form: 'reexport' })]
      },
      'src/consumer.ts': { edges: [edge('src/a.ts', { via: ['src/index.ts' as RepoPath] })] },
      'src/cycle.test.ts': { edges: [edge('src/a.ts')] },
      'tests/outer.test.ts': { edges: [edge('src/cycle.test.ts')] },
      'src/view.stories.tsx': { edges: [edge('src/b.ts')] },
      'tests/story.test.ts': { edges: [edge('src/view.stories.tsx')] },
      ...Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [
          `tests/case${index}.test.ts`,
          { edges: [edge('src/consumer.ts')] }
        ])
      )
    }),
    emptyConfig
  )
  const page = pageData(graph)
  const index = new Map(page.modules.map((module, index) => [module.path, index]))
  const indexes = (modules: readonly { readonly path: string }[]) =>
    modules.map(module => index.get(module.path)!).sort((a, b) => a - b)
  const expected = (resolved: Resolved): Relations => {
    const answer = usesOf(graph, resolved, 1)
    return {
      usedBy: indexes(answer.modules),
      usedByTests: indexes(answer.tests),
      uses: indexes(depsOf(graph, resolved, 1).modules)
    }
  }
  for (const module of page.modules)
    assert.deepEqual(
      relations(module),
      expected(moduleSubject(graph, module.path as RepoPath)),
      module.path
    )
  for (const area of page.areas)
    assert.deepEqual(
      relations(area),
      expected(areaSubject(graph, area.path as Parameters<typeof areaSubject>[1])),
      area.path
    )
})

test('the page carries the source its links are built from, or null', () => {
  const source = {
    template: 'https://github.com/acme/app/blob/abc1234/{path}#L{line}',
    prefix: 'web',
    shortCommit: 'abc1234',
    unpushed: 0,
    remote: 'origin',
    uncommitted: false
  }
  const graph = graphOf(modelOf({ 'src/a.ts': {} }), emptyConfig)
  assert.equal(pageData(graph).source, null)
  assert.deepEqual(pageData(graph, source).source, source)
})

const wireOf = (data: PageData): PageWireData => JSON.parse(JSON.stringify(wireDataOf(data)))

test('HTML wire data omits labels, false defaults and empty collections, then restores the complete page model', () => {
  for (const expected of [monorepo, appPage, pageData(graphOf(modelOf({}), emptyConfig))]) {
    const wire = wireOf(expected)
    for (const area of wire.areas ?? []) {
      assert.equal('label' in area, false)
      for (const key of ['usedBy', 'usedByTests', 'uses', 'modules'] as const)
        assert.notDeepEqual(area[key], [], key)
    }
    for (const module of wire.modules ?? []) {
      assert.equal('label' in module, false)
      for (const key of ['usedBy', 'usedByTests', 'uses', 'symbols'] as const)
        assert.notDeepEqual(module[key], [], key)
      for (const symbol of module.symbols ?? []) assert.notEqual(symbol[5], false)
    }
    for (const pkg of wire.packages ?? []) {
      assert.notDeepEqual(pkg.rows, [])
      assert.notDeepEqual(pkg.areaCycles, [])
    }
    for (const value of Object.values(wire.health)) assert.notDeepEqual(value, [])
    assert.deepEqual(decodePage(wire), expected)
  }
})

test('decoding derives labels relative to package and area directories, including nested and non-prefix paths', () => {
  const graph = graphOf(
    modelOf(
      {
        'root.ts': {},
        'nested/root.ts': {},
        'packages/ui/index.ts': {},
        'packages/ui/src/deep/Button.tsx': {},
        'packages/ui/src-more/Outside.ts': {}
      },
      { root: '.', ui: 'packages/ui' }
    ),
    {
      ...emptyConfig,
      areas: [
        { glob: 'root.ts', area: '.' as AreaPath },
        { glob: 'nested/**', area: '.' as AreaPath },
        { glob: 'packages/ui/index.ts', area: 'packages/ui' as AreaPath },
        { glob: 'packages/ui/src*/**', area: 'packages/ui/src' as AreaPath }
      ]
    }
  )
  const expected = pageData(graph)
  const decoded = decodePage(wireOf(expected))
  assert.deepEqual(decoded, expected)
  assert.deepEqual(Object.fromEntries(decoded.areas.map(area => [area.path, area.label])), {
    '.': '.',
    'packages/ui': '.',
    'packages/ui/src': 'src'
  })
  const labels = Object.fromEntries(decoded.modules.map(module => [module.path, module.label]))
  assert.equal(labels['root.ts'], 'root.ts')
  assert.equal(labels['nested/root.ts'], 'nested/root.ts')
  assert.equal(labels['packages/ui/index.ts'], 'index.ts')
  assert.equal(labels['packages/ui/src/deep/Button.tsx'], 'deep/Button.tsx')
  assert.equal(labels['packages/ui/src-more/Outside.ts'], 'packages/ui/src-more/Outside.ts')
})

test('wire decoding preserves default exports, documentation, signatures and source-link data', () => {
  const symbols = [
    defines('Button', 3, {
      kind: 'component',
      default: true,
      doc: '',
      signature: 'function Button()'
    }),
    defines('message', 7, { signature: 'const message = "</script><!--"', doc: 'Unicode: café 😀' })
  ]
  const source = {
    template: 'https://github.com/acme/ui/blob/abc/{path}#L{line}',
    prefix: 'web',
    shortCommit: 'abc',
    unpushed: 0,
    remote: 'origin',
    uncommitted: false
  }
  const expected = pageData(
    graphOf(modelOf({ 'src/Button.tsx': { symbols } }), emptyConfig),
    source
  )
  const decoded = decodePage(wireOf(expected))
  assert.deepEqual(decoded, expected)
  assert.deepEqual(decoded.modules[0]!.symbols, symbols)
})

test('symbol tuples retain all kinds and omit unused trailing fields', () => {
  const symbols = [
    ...symbolKinds.map((kind, index) => defines(`kind${index}`, index + 1, { kind })),
    defines('documented', 20, {
      doc: 'Unicode café 😀 and </script>',
      signature: 'function documented(value: string)'
    }),
    defines('defaultOnly', 30, { default: true }),
    defines('emptyDoc', 40, { default: true, doc: '' }),
    defines('defaultDoc', 50, { default: true, doc: 'A default export.' })
  ]
  const expected = pageData(graphOf(modelOf({ 'src/symbols.ts': { symbols } }), emptyConfig))
  const wire = wireOf(expected)
  assert.deepEqual(wire.symbolKinds, symbolKinds)
  const tuples = wire.modules![0]!.symbols!
  for (const [index, kind] of symbolKinds.entries()) {
    assert.deepEqual(tuples[index], [`kind${index}`, index, index + 1, `const kind${index}`], kind)
  }
  assert.deepEqual(tuples.slice(symbolKinds.length), [
    [
      'documented',
      symbolKinds.indexOf('const'),
      20,
      'function documented(value: string)',
      'Unicode café 😀 and </script>'
    ],
    ['defaultOnly', symbolKinds.indexOf('const'), 30, 'const defaultOnly', null, true],
    ['emptyDoc', symbolKinds.indexOf('const'), 40, 'const emptyDoc', '', true],
    ['defaultDoc', symbolKinds.indexOf('const'), 50, 'const defaultDoc', 'A default export.', true]
  ])
  assert.deepEqual(decodePage(wire), expected)
})
