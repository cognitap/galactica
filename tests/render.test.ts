import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandTable, type Input } from '../src/commands.ts'
import { commands, type Failure, type Overview, type Cycles, type Uses } from '../src/contract.ts'
import { graphOf } from '../src/graph.ts'
import { emptyConfig, type RepoPath } from '../src/model.ts'
import { TESTS_NOTE } from '../src/queries.ts'
import { LIST_LIMIT, render } from '../src/render.ts'
import { defines, edge, edgeTo, modelOf } from './models.ts'

const graph = graphOf(
  modelOf({
    'src/cn.ts': { symbols: [defines('cn', 3, { kind: 'function', doc: 'Joins class names.' })] },
    'src/ui/Button.tsx': {
      symbols: [defines('Button', 5, { kind: 'component', default: true })],
      edges: [
        edge('src/cn.ts', { names: ['cn'] }),
        edgeTo({ kind: 'external', name: 'react' }, { line: 2 })
      ]
    },
    'src/ui/Button.test.tsx': { edges: [edge('src/ui/Button.tsx')] }
  }),
  emptyConfig
)

const repository = { graph, config: emptyConfig, warnings: [] }

const input = (argument: string, fields: Partial<Input> = {}): Input => ({
  argument,
  second: '',
  depth: 1,
  all: false,
  cwd: '.' as RepoPath,
  ...fields
})

const text = (command: keyof typeof commandTable, argument = '', fields: Partial<Input> = {}) =>
  render(commandTable[command].run(repository, input(argument, fields)))

test('the command table and the renderer cover every command of the contract', () => {
  assert.deepEqual(Object.keys(commandTable), [...commands])
  for (const command of commands) {
    const argument = commandTable[command].argument === undefined ? '' : 'src/cn.ts'
    const output = commandTable[command].run(repository, input(argument))
    assert.equal(output.command, command)
    assert.notEqual(render(output), '')
  }
})

test('overview text gives each layer one line, then the most imported modules', () => {
  assert.equal(
    text('overview'),
    [
      '1 package, 3 modules, 2 areas',
      'acme (.): 3 modules in 2 areas',
      'layer 0: src (1)',
      'layer 1: src/ui (2)',
      'most imported:',
      'src/cn.ts  1 importer  cn',
      '0 import cycles, 0 unresolved imports',
      'next: run the same command with where <name> in place of overview to find a symbol, or with uses <file> to list what to check and test before you edit it'
    ].join('\n')
  )
})

test('overview text lists modules with no importers only with --all', () => {
  const lines = text('overview', '', { all: true }).split('\n')
  assert.ok(lines.includes('src/ui/Button.tsx  0 importers  Button'))
  assert.ok(!lines.some(line => line.startsWith('src/ui/Button.test.tsx')))
})

test('overview text counts the warnings in one line that points at --json', () => {
  const warnings = [
    { path: 'packages/a/package.json', message: 'a workspace package without a name is skipped' },
    { path: 'tsconfig.json', message: "File '.nuxt/tsconfig.json' not found." }
  ]
  const output = commandTable.overview.run({ graph, config: emptyConfig, warnings }, input(''))
  const lines = render(output).split('\n')
  assert.deepEqual(lines.slice(-3, -1), [
    '0 import cycles, 0 unresolved imports',
    '2 warnings, overview --json lists them'
  ])
  assert.ok(!lines.some(line => line.includes('tsconfig.json')))
})

test('where and outline print one clickable path:line per symbol', () => {
  assert.equal(
    text('where', 'cn'),
    'cn: 1 definition\nsrc/cn.ts:3  function  const cn  // Joins class names.'
  )
  assert.equal(
    text('outline', 'src/ui/Button.tsx'),
    'src/ui/Button.tsx (source, area src/ui, package acme): 1 exported symbol\nsrc/ui/Button.tsx:5  default component  const Button'
  )
  assert.equal(text('where', 'button'), 'button: no definitions\nsimilar: Button')
  assert.equal(text('where', 'zzz'), 'zzz: no definitions')
})

test('uses and deps print a header, one module per line, and say when a list is empty', () => {
  assert.equal(
    text('uses', 'src/cn.ts'),
    [
      'src/cn.ts (module): 1 dependent within depth 1, 1 test',
      '1  src/ui/Button.tsx  cn',
      'tests, closest first:',
      '2  src/ui/Button.test.tsx  via src/ui/Button.tsx',
      TESTS_NOTE
    ].join('\n')
  )
  assert.equal(
    text('deps', 'src/ui'),
    [
      'src/ui (area): 1 dependency within depth 1, 1 external package, 0 unresolved imports',
      '1  src/cn.ts  cn',
      'packages: none',
      'external: react',
      'unresolved: none'
    ].join('\n')
  )
  assert.equal(
    text('uses', 'src/ui/Button.test.tsx'),
    `src/ui/Button.test.tsx (module): 0 dependents within depth 1, 0 tests\nno dependents\nno tests\n${TESTS_NOTE}`
  )
})

test('cycles text lists each cycle, its modules and its imports, those to break first', () => {
  const cyclic = graphOf(
    modelOf({
      'src/a.ts': { edges: [edge('src/b.ts', { line: 2, names: ['b', 'c'], loadTime: ['b'] })] },
      'src/b.ts': {
        edges: [edge('src/a.ts', { line: 4, names: ['a'], via: ['src/index.ts' as RepoPath] })]
      },
      'src/index.ts': { edges: [edge('src/a.ts', { form: 'reexport', names: ['a'] })] }
    }),
    emptyConfig
  )
  const run = (command: 'cycles' | 'uses', argument = '') =>
    render(
      commandTable[command].run(
        { graph: cyclic, config: emptyConfig, warnings: [] },
        input(argument)
      )
    )
  assert.equal(
    run('cycles'),
    [
      '1 import cycle, 1 used at load time',
      'cycle 1: 2 modules, used at load time, in dependency order:',
      '  src/a.ts',
      '  src/b.ts',
      'imports (1 to break):',
      '  src/b.ts:4 -> src/a.ts  via src/index.ts  a  used later  break here',
      '  src/a.ts:2 -> src/b.ts  b, c  used at load time',
      'break here marks the imports that point back up the order, bringing in the fewest names. To cut one: move what both modules need into a third, lower module, pass a callback instead of importing, or merge modules that cannot be separated.'
    ].join('\n')
  )
  assert.match(
    run('uses', 'src/a.ts'),
    /\nin an import cycle with src\/b\.ts, used at load time: the cycles command shows where to break it$/
  )
  assert.equal(text('cycles'), 'no import cycles')
})

test('a long list stops after the limit and points at --json', () => {
  const specs = Object.fromEntries(
    Array.from({ length: LIST_LIMIT + 3 }, (_, index) => [
      `src/m${String(index).padStart(2, '0')}.ts`,
      { edges: [edge('lib/cn.ts')] }
    ])
  )
  const wide = graphOf(modelOf({ ...specs, 'lib/cn.ts': {} }), emptyConfig)
  const lines = render(
    commandTable.uses.run({ graph: wide, config: emptyConfig, warnings: [] }, input('lib/cn.ts'))
  ).split('\n')
  assert.equal(lines.length, 1 + LIST_LIMIT + 3)
  assert.equal(lines.at(-3), '… 3 more, use --json')
})

test('a failure renders as its one-line message', () => {
  const failure: Failure = {
    schemaVersion: 1,
    command: 'uses',
    error: { code: 'not-found', message: 'no module, package or area named x' }
  }
  assert.equal(render(failure), 'galactica: no module, package or area named x')
  const output = commandTable.outline.run(repository, input('src/nope.ts'))
  assert.equal(render(output), 'galactica: no module named src/nope.ts')
})

test('overview caps broad layers and the whole report while preserving JSON data', () => {
  const areas = Array.from({ length: 12052 }, (_, index) => ({
    path: `packages/babel/fixtures/case-${index}`,
    layer: 0,
    modules: 1,
    top: []
  }))
  const output: Overview = {
    schemaVersion: 1,
    command: 'overview',
    all: false,
    cycles: 0,
    unresolved: 0,
    unresolvedImports: [],
    warnings: [],
    packages: [{ name: 'babel', dir: '.', modules: areas.length, areas }]
  }
  const before = JSON.stringify(output)
  const result = render(output)
  assert.ok(Buffer.byteLength(result) < 8192, `overview has ${Buffer.byteLength(result)} bytes`)
  assert.match(result, /layer 0: .*… and \d+ more, use --json/)
  assert.equal(JSON.stringify(output), before)
  assert.equal(output.packages[0]?.areas.length, 12052)
})

test('overview caps many packages and layers, including --all rankings', () => {
  const output: Overview = {
    schemaVersion: 1,
    command: 'overview',
    all: true,
    cycles: 0,
    unresolved: 1,
    unresolvedImports: [
      { from: 'src/main.ts', line: 1, specifier: 'astro:content', cause: 'virtual' }
    ],
    warnings: [],
    packages: Array.from({ length: 500 }, (_, index) => ({
      name: `p${index}`,
      dir: `packages/p${index}`,
      modules: 100,
      areas: Array.from({ length: 100 }, (_, layer) => ({
        path: `packages/p${index}/src/area${layer}`,
        layer,
        modules: 1,
        top: [
          { path: `packages/p${index}/src/area${layer}/main.ts`, importers: 2, exports: ['main'] }
        ]
      }))
    }))
  }
  const result = render(output)
  assert.ok(Buffer.byteLength(result) < 8192, `overview has ${Buffer.byteLength(result)} bytes`)
  assert.match(result, /more.*use --json/)
  assert.equal(output.packages.length, 500)
  assert.match(result, /virtual\/scheme: 1/)
  assert.ok(result.split('\n')[1]!.includes('unresolved import by likely cause'))
})

test('cycles caps the entire report with its total and full JSON intact', () => {
  const output: Cycles = {
    schemaVersion: 1,
    command: 'cycles',
    cycles: Array.from({ length: 300 }, (_, index) => ({
      loadTime: false,
      modules: Array.from({ length: 100 }, (_, member) => `src/cycle${index}/module${member}.ts`),
      imports: []
    }))
  }
  const before = JSON.stringify(output)
  const result = render(output)
  assert.match(result, /^300 import cycles, 0 used at load time/)
  assert.ok(Buffer.byteLength(result) < 8192, `cycles has ${Buffer.byteLength(result)} bytes`)
  assert.match(result, /more.*use --json/)
  assert.equal(JSON.stringify(output), before)
})

test('uses text lists the tests outside hubs, then counts those that reach the subject only through each hub', () => {
  const at = (path: string, distance: number, fields: { via?: string; hub?: string } = {}) => ({
    path,
    package: 'acme',
    area: 'src',
    kind: 'test' as const,
    distance,
    names: distance === 1 ? ['parse'] : [],
    ...fields
  })
  const uses: Uses = {
    schemaVersion: 1,
    command: 'uses',
    subject: { kind: 'module', path: 'src/sourcemap.ts', package: 'acme' },
    depth: 1,
    modules: [],
    tests: [
      at('src/sourcemap.test.ts', 1),
      at('src/css.test.ts', 2, { via: 'src/css.ts' }),
      at('src/a.test.ts', 3, { via: 'src/css.ts', hub: 'src/config.ts' }),
      at('src/b.test.ts', 3, { via: 'src/css.ts', hub: 'src/config.ts' }),
      at('src/c.test.ts', 4, { via: 'src/send.ts', hub: 'src/server.ts' })
    ],
    testsNote: 'Only tests that import it.',
    cycles: []
  }
  assert.equal(
    render(uses),
    [
      'src/sourcemap.ts (module): 0 dependents within depth 1, 2 tests and 3 more only through widely imported modules',
      'no dependents',
      'tests, closest first:',
      '1  src/sourcemap.test.ts  parse',
      '2  src/css.test.ts  via src/css.ts',
      '2 more tests reach it only through src/config.ts, which much of the repository imports',
      '1 more test reaches it only through src/server.ts, which much of the repository imports',
      'Only tests that import it.'
    ].join('\n')
  )
})

test('no text names a bare galactica command, since agents run it through the command the skill names', () => {
  const cyclic = graphOf(
    modelOf({
      'src/a.ts': { edges: [edge('src/b.ts', { loadTime: ['x'] })] },
      'src/b.ts': { edges: [edge('src/a.ts')] }
    }),
    emptyConfig
  )
  const warnings = [
    { path: 'package.json', message: 'a workspace package without a name is skipped' }
  ]
  for (const command of commands) {
    const argument = commandTable[command].argument === undefined ? '' : 'src/a.ts'
    const output = render(
      commandTable[command].run({ graph: cyclic, config: emptyConfig, warnings }, input(argument))
    )
    assert.doesNotMatch(output, /galactica [a-z]/, command)
  }
})
