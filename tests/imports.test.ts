import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'
import { importsOf } from '../src/imports.ts'

const parse = (lines: readonly string[], kind = ts.ScriptKind.TS) =>
  ts.createSourceFile('a.ts', lines.join('\n'), ts.ScriptTarget.Latest, true, kind)

const imports = (lines: readonly string[], kind?: ts.ScriptKind) =>
  importsOf(parse(lines, kind)).map(({ specifier, ...rest }) => ({
    specifier: specifier.text,
    ...rest
  }))

const names = (lines: readonly string[]) =>
  Object.fromEntries(imports(lines).map(entry => [entry.specifier, entry.names]))

test('each import form yields one import at the line of its specifier', () => {
  assert.deepEqual(
    imports([
      "import 'side'",
      "import a from 'default'",
      'import {',
      '  b',
      "} from 'named'",
      "import x = require('equals')",
      "export { c } from 'reexport'",
      "export * from 'star'",
      "export * as ns from 'namespace'",
      "const d = require('required')",
      "const e = import('dynamic')"
    ]).map(({ specifier, line, form, dynamic }) => ({ specifier, line, form, dynamic })),
    [
      { specifier: 'side', line: 1, form: 'import', dynamic: false },
      { specifier: 'default', line: 2, form: 'import', dynamic: false },
      { specifier: 'named', line: 5, form: 'import', dynamic: false },
      { specifier: 'equals', line: 6, form: 'import', dynamic: false },
      { specifier: 'reexport', line: 7, form: 'reexport', dynamic: false },
      { specifier: 'star', line: 8, form: 'reexport', dynamic: false },
      { specifier: 'namespace', line: 9, form: 'reexport', dynamic: false },
      { specifier: 'required', line: 10, form: 'import', dynamic: false },
      { specifier: 'dynamic', line: 11, form: 'import', dynamic: true }
    ]
  )
})

test('calls anywhere in the file count, with a literal or untagged template specifier only', () => {
  assert.deepEqual(
    imports([
      'export function load(name: string) {',
      '  return [import(`./page`), import(name), import(`./${name}`), require(name)]',
      '}',
      "const f = () => require('./nested')",
      "require.resolve('./resolved')",
      "require('./two', 'arguments')",
      "type T = typeof import('./type-only')"
    ]).map(({ specifier, line }) => ({ specifier, line })),
    [
      { specifier: './page', line: 2 },
      { specifier: './nested', line: 4 }
    ]
  )
})

test('names are as the defining module exports them, sorted and unique', () => {
  assert.deepEqual(
    names([
      "import 'side'",
      "import def from 'default'",
      "import * as ns from 'namespace'",
      "import def2, { z, a as b, default as c, 'quoted' as q, z as y } from 'named'",
      "import def3, * as all from 'both'",
      "export { a, b as c, default } from 'reexport'",
      "export * from 'star'",
      "export * as ns2 from 'star-as'",
      "import x = require('equals')",
      "import {} from 'empty'"
    ]),
    {
      side: [],
      default: ['default'],
      namespace: ['*'],
      named: ['a', 'default', 'quoted', 'z'],
      both: ['*', 'default'],
      reexport: ['a', 'b', 'default'],
      star: ['*'],
      'star-as': ['*'],
      equals: ['*'],
      empty: []
    }
  )
})

test('require and import calls take names from a destructuring, all when kept, none when dropped', () => {
  assert.deepEqual(
    names([
      "const { a, b: c } = require('destructured')",
      "const whole = require('whole')",
      "require('dropped')",
      "async function f() { const { default: d, e } = await import('awaited') }",
      "async function g() { const m = await (import('kept')) }",
      "async function h() { await import('dropped-await') }",
      "void import('voided')",
      "const { x, ...rest } = require('rest')",
      "const { [key]: y } = require('computed')",
      "module.exports = require('passed-on')",
      "const Page = lazy(() => import('lazy'))"
    ]),
    {
      destructured: ['a', 'b'],
      whole: ['*'],
      dropped: [],
      awaited: ['default', 'e'],
      kept: ['*'],
      'dropped-await': [],
      voided: [],
      rest: ['*'],
      computed: ['*'],
      'passed-on': ['*'],
      lazy: ['*']
    }
  )
})

test('an import is type-only by import type, export type, or inline type on every specifier', () => {
  const typeOnly = (lines: readonly string[]) =>
    Object.fromEntries(imports(lines).map(entry => [entry.specifier, entry.typeOnly]))
  assert.deepEqual(
    typeOnly([
      "import type { A } from 'import-type'",
      "import type D from 'import-type-default'",
      "import { type B, type C } from 'all-inline'",
      "import { type E, f } from 'some-inline'",
      "import g, { type H } from 'default-and-inline'",
      "export type { I } from 'export-type'",
      "export { type J } from 'export-inline'",
      "export type * from 'export-type-star'",
      "import type K = require('equals-type')",
      "import 'side'",
      "const l = require('required')"
    ]),
    {
      'import-type': true,
      'import-type-default': true,
      'all-inline': true,
      'some-inline': false,
      'default-and-inline': false,
      'export-type': true,
      'export-inline': true,
      'export-type-star': true,
      'equals-type': true,
      side: false,
      required: false
    }
  )
})

test('an exported import-equals passes its module on', () => {
  assert.deepEqual(
    imports(["export import x = require('equals')", 'import y = x.y']).map(({ form }) => form),
    ['reexport']
  )
})

test('JavaScript files read require and import the same way', () => {
  assert.deepEqual(
    imports(
      ["const { add } = require('./math')", "import('./lazy.js').then(m => m.run())"],
      ts.ScriptKind.JS
    ).map(({ specifier, names }) => ({ specifier, names })),
    [
      { specifier: './math', names: ['add'] },
      { specifier: './lazy.js', names: ['*'] }
    ]
  )
})
