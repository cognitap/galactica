import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Reached } from '../src/contract.ts'
import { graphOf } from '../src/graph.ts'
import type { RepoPath } from '../src/model.ts'
import { deps, outline, uses, where } from '../src/queries.ts'
import { defines, edge, edgeTo, modelOf } from './models.ts'

const root = '.' as RepoPath

const button = defines('Button', 4, {
  kind: 'component',
  default: true,
  signature: 'function Button(): JSX.Element',
  doc: 'A button.'
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
    'src/app/other.ts': {
      edges: [edge('src/lone.ts', { names: ['lone'], via: ['src/index.ts' as RepoPath] })]
    },
    'src/ui/Button.tsx': {
      symbols: [defines('ButtonProps', 1, { kind: 'type' }), button],
      edges: [edge('src/cn.ts', { names: ['cn'] })]
    },
    'src/ui/Card.tsx': { edges: [edge('src/ui/Button.tsx', { names: ['default'] })] },
    'src/ui/Button.stories.tsx': { edges: [edge('src/ui/Button.tsx', { names: ['default'] })] },
    'src/ui/Card.test.tsx': { edges: [edge('src/ui/Card.tsx')] },
    'src/app/main.ts': {
      edges: [
        edgeTo({ kind: 'external', name: 'react' }, { line: 1 }),
        edge('src/cn.ts', { line: 2, names: ['cn'], via: ['src/index.ts' as RepoPath] }),
        edgeTo({ kind: 'unresolved', specifier: './gone' }, { line: 3 }),
        edgeTo({ kind: 'unresolved', specifier: './gone' }, { line: 4 })
      ]
    },
    'tests/cn.test.ts': { edges: [edge('src/cn.ts', { names: ['cn'] })] }
  })
)

const summary = (modules: readonly Reached[]) =>
  modules.map(({ path, distance, names }) => [path, distance, names.join(',')])

test('where lists each definition of a name with its module', () => {
  assert.deepEqual(where(app, 'Button'), {
    schemaVersion: 1,
    command: 'where',
    name: 'Button',
    definitions: [
      {
        module: { path: 'src/ui/Button.tsx', package: 'acme', area: 'src/ui', kind: 'source' },
        name: 'Button',
        kind: 'component',
        line: 4,
        default: true,
        signature: 'function Button(): JSX.Element',
        doc: 'A button.'
      }
    ],
    suggestions: []
  })
})

test('where answers an unknown name with no definitions and similar names', () => {
  assert.deepEqual(where(app, 'button').definitions, [])
  assert.deepEqual(where(app, 'button').suggestions, ['Button', 'ButtonProps'])
  assert.deepEqual(where(app, 'Props').suggestions, ['ButtonProps'])
  assert.deepEqual(where(app, 'nothing').suggestions, [])
})

test('outline lists the exported symbols of one module in line order', () => {
  const result = outline(app, 'src/ui/Button.tsx', root)
  assert.ok(result.command === 'outline' && !('error' in result))
  assert.deepEqual(result.module, {
    path: 'src/ui/Button.tsx',
    package: 'acme',
    area: 'src/ui',
    kind: 'source'
  })
  assert.deepEqual(
    result.symbols.map(symbol => [symbol.name, symbol.line, 'doc' in symbol]),
    [
      ['ButtonProps', 1, false],
      ['Button', 4, true]
    ]
  )
})

test('outline of a path that is no module fails with not-found', () => {
  assert.deepEqual(outline(app, 'src/ui', root), {
    schemaVersion: 1,
    command: 'outline',
    error: { code: 'not-found', message: 'no module named src/ui' }
  })
})

test('uses lists direct dependents, barrels and imports through them, with the names taken', () => {
  const result = uses(app, 'src/cn.ts', root, 1)
  assert.ok(result.command === 'uses' && !('error' in result))
  assert.deepEqual(result.subject, { kind: 'module', path: 'src/cn.ts', package: 'acme' })
  assert.deepEqual(summary(result.modules), [
    ['src/app/main.ts', 1, 'cn'],
    ['src/index.ts', 1, 'cn'],
    ['src/ui/Button.tsx', 1, 'cn']
  ])
})

test('uses within a depth adds farther dependents with no names, stories included', () => {
  const result = uses(app, 'src/cn.ts', root, 2)
  assert.ok(result.command === 'uses' && !('error' in result))
  assert.deepEqual(summary(result.modules).slice(3), [
    ['src/ui/Button.stories.tsx', 2, ''],
    ['src/ui/Card.tsx', 2, '']
  ])
})

test('uses lists every test that depends on the subject, whatever the depth', () => {
  const result = uses(app, 'src/cn.ts', root, 1)
  assert.ok(result.command === 'uses' && !('error' in result))
  assert.deepEqual(summary(result.tests), [
    ['tests/cn.test.ts', 1, 'cn'],
    ['src/ui/Card.test.tsx', 3, '']
  ])
})

test('uses of a barrel lists the modules that import through it', () => {
  const result = uses(app, 'src/index.ts', root, 1)
  assert.ok(result.command === 'uses' && !('error' in result))
  assert.deepEqual(summary(result.modules), [
    ['src/app/main.ts', 1, 'cn'],
    ['src/app/other.ts', 1, 'lone']
  ])
})

test('uses past the subject leaves out imports that only pass through a barrel', () => {
  const result = uses(app, 'src/cn.ts', root, 5)
  assert.ok(result.command === 'uses' && !('error' in result))
  assert.ok(!result.modules.some(module => module.path === 'src/app/other.ts'))
})

test('deps lists a barrel an import passes through, but walks on only from the defining module', () => {
  const result = deps(app, 'src/app/other.ts', root, 3)
  assert.ok(result.command === 'deps' && !('error' in result))
  assert.deepEqual(summary(result.modules), [
    ['src/index.ts', 1, 'lone'],
    ['src/lone.ts', 1, 'lone']
  ])
})

test('uses of an area leaves out the modules inside it, lists its own stories as dependents, and its own tests', () => {
  const result = uses(app, 'src/ui', root, 1)
  assert.ok(result.command === 'uses' && !('error' in result))
  assert.deepEqual(result.subject, { kind: 'area', path: 'src/ui', package: 'acme' })
  assert.deepEqual(summary(result.modules), [['src/ui/Button.stories.tsx', 1, 'default']])
  assert.deepEqual(summary(result.tests), [['src/ui/Card.test.tsx', 1, 'x']])
})

test('deps of an area and a package leave out what its tests and stories import', () => {
  const graph = graphOf(
    modelOf(
      {
        'ui/src/Button.tsx': { edges: [edge('lib/cn.ts')] },
        'ui/src/Button.stories.tsx': {
          edges: [edge('lib/examples.ts'), edgeTo({ kind: 'external', name: 'storybook' })]
        },
        'ui/src/Button.test.tsx': { edges: [edge('lib/helpers.ts')] },
        'lib/cn.ts': {},
        'lib/examples.ts': {},
        'lib/helpers.ts': {}
      },
      { ui: 'ui', lib: 'lib' }
    )
  )
  for (const subject of ['ui/src', 'ui']) {
    const result = deps(graph, subject, root, 1)
    assert.ok(result.command === 'deps' && !('error' in result))
    assert.deepEqual(summary(result.modules), [['lib/cn.ts', 1, 'x']])
    assert.deepEqual(result.packages, ['lib'])
    assert.deepEqual(result.external, [])
  }
})

test('deps lists the modules and barrels a module imports, its packages, externals and unresolved imports', () => {
  assert.deepEqual(deps(app, 'src/app/main.ts', root, 1), {
    schemaVersion: 1,
    command: 'deps',
    subject: { kind: 'module', path: 'src/app/main.ts', package: 'acme' },
    depth: 1,
    modules: [
      {
        path: 'src/cn.ts',
        package: 'acme',
        area: 'src',
        kind: 'source',
        distance: 1,
        names: ['cn']
      },
      {
        path: 'src/index.ts',
        package: 'acme',
        area: 'src',
        kind: 'source',
        distance: 1,
        names: ['cn']
      }
    ],
    packages: [],
    external: ['react'],
    unresolved: [{ from: 'src/app/main.ts', specifier: './gone' }]
  })
})

test('deps walks to the given depth', () => {
  const result = deps(app, 'src/ui/Card.test.tsx', root, 2)
  assert.ok(result.command === 'deps' && !('error' in result))
  assert.deepEqual(summary(result.modules), [
    ['src/ui/Card.tsx', 1, 'x'],
    ['src/ui/Button.tsx', 2, '']
  ])
})

test('deps of a package lists the other packages it reaches', () => {
  const graph = graphOf(
    modelOf(
      {
        'packages/app/src/main.ts': { edges: [edge('packages/ui/src/cn.ts', { names: ['cn'] })] },
        'packages/app/src/util.ts': {},
        'packages/ui/src/cn.ts': { edges: [edge('packages/tokens/index.ts')] },
        'packages/tokens/index.ts': {}
      },
      { '@acme/app': 'packages/app', '@acme/ui': 'packages/ui', '@acme/tokens': 'packages/tokens' }
    )
  )
  const result = deps(graph, '@acme/app', root, 2)
  assert.ok(result.command === 'deps' && !('error' in result))
  assert.deepEqual(result.subject, { kind: 'package', name: '@acme/app', dir: 'packages/app' })
  assert.deepEqual(summary(result.modules), [
    ['packages/ui/src/cn.ts', 1, 'cn'],
    ['packages/tokens/index.ts', 2, '']
  ])
  assert.deepEqual(result.packages, ['@acme/tokens', '@acme/ui'])
})

test('uses and deps fail on an unknown subject, naming their command', () => {
  for (const query of [uses, deps]) {
    const result = query(app, 'src/nope.ts', root, 1)
    assert.ok('error' in result)
    assert.equal(result.error.code, 'not-found')
    assert.equal(result.command, query.name)
  }
})
