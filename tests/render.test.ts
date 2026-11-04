import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commandTable, type Input } from '../src/commands.ts'
import { commands, type Failure } from '../src/contract.ts'
import { graphOf } from '../src/graph.ts'
import type { RepoPath } from '../src/model.ts'
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
  })
)

const input = (argument: string, fields: Partial<Input> = {}): Input => ({
  argument,
  depth: 1,
  all: false,
  cwd: '.' as RepoPath,
  ...fields
})

const text = (command: keyof typeof commandTable, argument = '', fields: Partial<Input> = {}) =>
  render(commandTable[command].run(graph, input(argument, fields)))

test('the command table and the renderer cover every command of the contract', () => {
  assert.deepEqual(Object.keys(commandTable), [...commands])
  for (const command of commands) {
    const argument = commandTable[command].argument === undefined ? '' : 'src/cn.ts'
    const output = commandTable[command].run(graph, input(argument))
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
      'src/ui/Button.test.tsx  0 importers',
      'src/ui/Button.tsx  0 importers  Button',
      '0 import cycles, 0 unresolved imports',
      'next: galactica where <name> finds a symbol, galactica uses <file> lists what to check and test before you edit it'
    ].join('\n')
  )
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
      'tests:',
      '2  src/ui/Button.test.tsx'
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
    'src/ui/Button.test.tsx (module): 0 dependents within depth 1, 0 tests\nno dependents\nno tests'
  )
})

test('a long list stops after the limit and points at --json', () => {
  const specs = Object.fromEntries(
    Array.from({ length: LIST_LIMIT + 3 }, (_, index) => [
      `src/m${String(index).padStart(2, '0')}.ts`,
      { edges: [edge('lib/cn.ts')] }
    ])
  )
  const wide = graphOf(modelOf({ ...specs, 'lib/cn.ts': {} }))
  const lines = render(commandTable.uses.run(wide, input('lib/cn.ts'))).split('\n')
  assert.equal(lines.length, 1 + LIST_LIMIT + 2)
  assert.equal(lines.at(-2), '… 3 more, use --json')
})

test('a failure renders as its one-line message', () => {
  const failure: Failure = {
    schemaVersion: 1,
    command: 'uses',
    error: { code: 'not-found', message: 'no module, package or area named x' }
  }
  assert.equal(render(failure), 'galactica: no module, package or area named x')
  const output = commandTable.outline.run(graph, input('src/nope.ts'))
  assert.equal(render(output), 'galactica: no module named src/nope.ts')
})
