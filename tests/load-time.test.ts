import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'
import { importsOf } from '../src/imports.ts'

/** Each specifier's names read at load time, for the imports that read any. */
function readAtLoad(lines: readonly string[], kind = ts.ScriptKind.TS) {
  const source = ts.createSourceFile('a.ts', lines.join('\n'), ts.ScriptTarget.Latest, true, kind)
  return Object.fromEntries(
    importsOf(source).flatMap(({ specifier, loadTime }) =>
      loadTime === undefined ? [] : [[specifier, loadTime]]
    )
  )
}

test('a name read in top-level code is read at load time, one read only inside a function is not', () => {
  assert.deepEqual(
    readAtLoad([
      "import { a, b } from './ab'",
      "import later from './later'",
      'export const value = a()',
      'export function f() { return b + later }'
    ]),
    { './ab': ['a'] }
  )
})

test('class bodies run at load time except methods, constructors and instance fields', () => {
  assert.deepEqual(
    readAtLoad([
      "import { Base } from './base'",
      "import { decorate } from './decorate'",
      "import { initial } from './initial'",
      "import { shared } from './shared'",
      "import { field } from './field'",
      "import { method } from './method'",
      '@decorate',
      'export class Thing extends Base {',
      '  static initial = initial',
      '  static { shared() }',
      '  field = field',
      '  run() { return method }',
      '}'
    ]),
    {
      './base': ['Base'],
      './decorate': ['decorate'],
      './initial': ['initial'],
      './shared': ['shared']
    }
  )
})

test('a top-level function runs at load time when top-level code calls it, directly or through another', () => {
  assert.deepEqual(
    readAtLoad([
      "import { first } from './first'",
      "import { second } from './second'",
      "import { never } from './never'",
      "import { built } from './built'",
      'function setup() { first(); const inner = () => second; return inner() }',
      'const start = () => setup()',
      'function unused() { return never }',
      'class Built { constructor() { built() } }',
      'start()',
      'new Built()'
    ]),
    { './first': ['first'], './second': ['second'], './built': ['built'] }
  )
})

test('a function called where it stands runs at load time', () => {
  assert.deepEqual(
    readAtLoad([
      "import { a } from './a'",
      "import { b } from './b'",
      '(() => a())()',
      ';(function () { b })()'
    ]),
    { './a': ['a'], './b': ['b'] }
  )
})

test('a local of the same name hides the import, and a type position reads nothing', () => {
  assert.deepEqual(
    readAtLoad([
      "import { a } from './a'",
      "import { T } from './t'",
      "import { p } from './p'",
      '{ const a = 1; console.log(a) }',
      'for (const a of []) console.log(a)',
      'export const x: T = { p: 1 }.p as T',
      'export const y = ({}).p'
    ]),
    {}
  )
})

test('a top-level require reads at load time unless its binding is read only inside functions', () => {
  assert.deepEqual(
    readAtLoad(
      [
        "const { a } = require('./destructured')",
        "const lazy = require('./lazy')",
        "const eager = require('./eager')",
        "require('./side-effect')",
        'eager.run()',
        "function f() { return lazy.x + require('./inside').y }",
        "const later = import('./dynamic')"
      ],
      ts.ScriptKind.JS
    ),
    { './destructured': ['a'], './eager': ['*'] }
  )
})

test('a namespace import read at load time reads "*", and a type-only import reads nothing', () => {
  assert.deepEqual(
    readAtLoad([
      "import * as ns from './ns'",
      "import type { Shape } from './shape'",
      'export const value = ns.value',
      'export const shape = {} as Shape'
    ]),
    { './ns': ['*'] }
  )
})
