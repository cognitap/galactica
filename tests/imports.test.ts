import assert from 'node:assert/strict'
import { test } from 'node:test'
import ts from 'typescript'
import { importsOf, resolutionModeOf } from '../src/imports.ts'
import { parseRepoPath } from '../src/model.ts'
import { parseScript, type ScriptLanguage } from '../src/syntax.ts'

const parse = (lines: readonly string[], kind = ts.ScriptKind.TS) =>
  ts.createSourceFile('a.ts', lines.join('\n'), ts.ScriptTarget.Latest, true, kind)

const imports = (lines: readonly string[], kind?: ts.ScriptKind) => importsOf(parse(lines, kind))

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

test('re-exports that rename map each exported name to the name they take', () => {
  const renames = (lines: readonly string[]) =>
    Object.fromEntries(imports(lines).map(entry => [entry.specifier, entry.renames]))
  assert.deepEqual(
    renames([
      "export { default as Button } from 'button'",
      "export { a, b as c } from 'some'",
      "export { a as b, a } from 'both'",
      "export { a, type B } from 'none'",
      "export * as ns from 'namespace'",
      "export * from 'star'",
      "export import x = require('equals')",
      "import y = require('imported')",
      "import { a as z } from 'renamed-import'"
    ]),
    {
      button: { Button: 'default' },
      some: { c: 'b' },
      both: { a: 'a', b: 'a' },
      none: undefined,
      namespace: { ns: '*' },
      star: undefined,
      equals: { x: '*' },
      imported: undefined,
      'renamed-import': undefined
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

test('each import records its syntax, and a resolution-mode attribute where a type-only one sets it', () => {
  assert.deepEqual(
    imports([
      "import 'side'",
      "export * from 'star'",
      "import x = require('equals')",
      "const r = require('required')",
      "const d = import('dynamic')",
      "import type { T } from 'as-import' with { 'resolution-mode': 'import' }",
      "export type { U } from 'as-require' with { 'resolution-mode': 'require' }",
      "import { v } from 'not-type-only' with { 'resolution-mode': 'require' }"
    ]).map(({ specifier, syntax, resolutionMode }) => ({ specifier, syntax, resolutionMode })),
    [
      { specifier: 'side', syntax: 'declaration', resolutionMode: undefined },
      { specifier: 'star', syntax: 'declaration', resolutionMode: undefined },
      { specifier: 'equals', syntax: 'import-equals', resolutionMode: undefined },
      { specifier: 'required', syntax: 'require', resolutionMode: undefined },
      { specifier: 'dynamic', syntax: 'import-call', resolutionMode: undefined },
      { specifier: 'as-import', syntax: 'declaration', resolutionMode: 'import' },
      { specifier: 'as-require', syntax: 'declaration', resolutionMode: 'require' },
      { specifier: 'not-type-only', syntax: 'declaration', resolutionMode: undefined }
    ]
  )
})

test('the resolution mode of each import is the one TypeScript reads from the module itself', () => {
  const lines = [
    "import 'side'",
    "import x = require('equals')",
    "const r = require('required')",
    "const d = import('dynamic')",
    "import type { T } from 'as-import' with { 'resolution-mode': 'import' }",
    "export type { U } from 'as-require' with { 'resolution-mode': 'require' }"
  ].join('\n')
  const languages: readonly ScriptLanguage[] = ['ts', 'mts', 'cts', 'tsx', 'js', 'mjs', 'cjs']
  const formats: readonly ts.ResolutionMode[] = [
    undefined,
    ts.ModuleKind.CommonJS,
    ts.ModuleKind.ESNext
  ]
  const optionSets: readonly ts.CompilerOptions[] = [
    {},
    { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
    { module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 },
    { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    { module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Bundler },
    { module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler }
  ]
  for (const language of languages) {
    for (const format of formats) {
      const path = parseRepoPath(`src/a.${language}`)
      const source = parseScript(path, language, lines, format)
      const literals = new Map<string, ts.StringLiteralLike>()
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node)) literals.set(node.text, node)
        ts.forEachChild(node, visit)
      }
      visit(source)
      for (const options of optionSets) {
        for (const imported of importsOf(source)) {
          assert.equal(
            resolutionModeOf(imported, language, format, options),
            ts.getModeForUsageLocation(source, literals.get(imported.specifier)!, options),
            `${imported.specifier} in ${language}, format ${format}, ${JSON.stringify(options)}`
          )
        }
      }
    }
  }
})

const passedOn = (lines: readonly string[]) =>
  imports(lines)
    .filter(({ form }) => form === 'reexport')
    .map(({ specifier, syntax, line, names, renames, typeOnly }) => ({
      specifier,
      syntax,
      line,
      names,
      renames,
      typeOnly
    }))

test('exporting an imported name re-exports it from the module it came from, at the export', () => {
  assert.deepEqual(
    passedOn([
      "import { a, b as local } from './named'",
      "import def from './default'",
      "import * as ns from './namespace'",
      "import x = require('./equals')",
      'export { a, local as c, def, ns, x }'
    ]),
    [
      {
        specifier: './named',
        syntax: 'declaration',
        line: 5,
        names: ['a', 'b'],
        renames: { c: 'b' },
        typeOnly: false
      },
      {
        specifier: './default',
        syntax: 'declaration',
        line: 5,
        names: ['default'],
        renames: { def: 'default' },
        typeOnly: false
      },
      {
        specifier: './namespace',
        syntax: 'declaration',
        line: 5,
        names: ['*'],
        renames: { ns: '*' },
        typeOnly: false
      },
      {
        specifier: './equals',
        syntax: 'import-equals',
        line: 5,
        names: ['*'],
        renames: { x: '*' },
        typeOnly: false
      }
    ]
  )
})

test('the import itself stays an import', () => {
  assert.deepEqual(
    imports(["import { a } from './a'", 'export { a }']).map(({ form, names, line }) => ({
      form,
      names,
      line
    })),
    [
      { form: 'import', names: ['a'], line: 1 },
      { form: 'reexport', names: ['a'], line: 2 }
    ]
  )
})

test('export default of an imported name re-exports what the import took as the default', () => {
  assert.deepEqual(
    passedOn([
      "import { a } from './named'",
      "import App from './App'",
      "import * as all from './all'",
      'export default a',
      'export { App as default }',
      'export default all'
    ]).map(({ specifier, line, names, renames }) => ({ specifier, line, names, renames })),
    [
      { specifier: './named', line: 4, names: ['a'], renames: { default: 'a' } },
      { specifier: './App', line: 5, names: ['default'], renames: undefined },
      { specifier: './all', line: 6, names: ['*'], renames: { default: '*' } }
    ]
  )
})

test('a re-exported import is type-only when the import or the export is', () => {
  assert.deepEqual(
    passedOn([
      "import type { A } from './import-type'",
      "import { type B, c } from './inline'",
      "import { D } from './export-type'",
      "import { e } from './value'",
      'export { A, B, c }',
      'export type { D }',
      'export { type e }'
    ]).map(({ specifier, names, typeOnly }) => ({ specifier, names, typeOnly })),
    [
      { specifier: './import-type', names: ['A'], typeOnly: true },
      { specifier: './inline', names: ['B', 'c'], typeOnly: false },
      { specifier: './export-type', names: ['D'], typeOnly: true },
      { specifier: './value', names: ['e'], typeOnly: true }
    ]
  )
})

test('exporting a local declaration, an unknown name, or inside a module block re-exports nothing', () => {
  assert.deepEqual(
    passedOn([
      "import { a } from './a'",
      'const own = 1',
      'export { own, missing }',
      'export default own',
      'export = a',
      "declare module 'other' { export { a } }"
    ]),
    []
  )
})

test('the resolution-mode of a type-only import carries over to its re-export', () => {
  assert.deepEqual(
    imports([
      "import type { T } from './t' with { 'resolution-mode': 'require' }",
      'export type { T }'
    ]).map(({ form, resolutionMode }) => ({ form, resolutionMode })),
    [
      { form: 'import', resolutionMode: 'require' },
      { form: 'reexport', resolutionMode: 'require' }
    ]
  )
})
