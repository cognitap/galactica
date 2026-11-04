import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { analyzeRepository } from '../src/analysis.ts'
import type { RepoPath } from '../src/model.ts'
import { repository } from './temp-repository.ts'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

test('each module carries the sha256 of its contents', t => {
  const root = repository(t, { 'src/a.ts': 'export const a = 1\n', 'src/App.vue': '<template/>' })
  const { modules } = analyzeRepository(root).model
  assert.equal(modules['src/a.ts' as RepoPath]?.hash, sha256('export const a = 1\n'))
  assert.equal(modules['src/App.vue' as RepoPath]?.hash, sha256('<template/>'))
})

test('symbols and edges come from the module, edges sorted by line, then target', t => {
  const root = repository(t, {
    'src/main.ts': [
      "import { b } from './b'; import { a } from './a'",
      "export { c } from './c'",
      "import './styles.css'",
      "import { gone } from './gone'",
      'export const main = () => a + b + gone'
    ].join('\n'),
    'src/a.ts': 'export const a = 1',
    'src/b.ts': 'export const b = 2',
    'src/c.ts': 'export const c = 3',
    'src/styles.css': ''
  })
  const main = analyzeRepository(root).model.modules['src/main.ts' as RepoPath]!
  assert.deepEqual(
    main.symbols.map(symbol => symbol.name),
    ['main']
  )
  assert.deepEqual(main.edges, [
    {
      to: { kind: 'module', path: 'src/a.ts' },
      line: 1,
      form: 'import',
      names: ['a'],
      typeOnly: false,
      dynamic: false,
      via: []
    },
    {
      to: { kind: 'module', path: 'src/b.ts' },
      line: 1,
      form: 'import',
      names: ['b'],
      typeOnly: false,
      dynamic: false,
      via: []
    },
    {
      to: { kind: 'module', path: 'src/c.ts' },
      line: 2,
      form: 'reexport',
      names: ['c'],
      typeOnly: false,
      dynamic: false,
      via: []
    },
    {
      to: { kind: 'unresolved', specifier: './gone' },
      line: 4,
      form: 'import',
      names: ['gone'],
      typeOnly: false,
      dynamic: false,
      via: []
    }
  ])
})

test('each import resolves in the mode TypeScript gives its syntax and file', t => {
  const root = repository(t, {
    'package.json': { name: 'esm', type: 'module' },
    'tsconfig.json': {
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowJs: true },
      include: ['src']
    },
    'src/main.ts': ["import { a } from './a'", "import { b } from './a.js'"].join('\n'),
    'src/legacy.cjs': "const { a } = require('./a')",
    'src/lib/package.json': { type: 'commonjs' },
    'src/lib/index.js': "const { a } = require('../a')",
    'src/a.ts': 'export const a = 1'
  })
  const { modules } = analyzeRepository(root).model
  const targets = (path: string) =>
    modules[path as RepoPath]!.edges.map(({ to, line }) => ({ to, line }))
  assert.deepEqual(targets('src/main.ts'), [
    { to: { kind: 'unresolved', specifier: './a' }, line: 1 },
    { to: { kind: 'module', path: 'src/a.ts' }, line: 2 }
  ])
  assert.deepEqual(targets('src/legacy.cjs'), [
    { to: { kind: 'module', path: 'src/a.ts' }, line: 1 }
  ])
  assert.deepEqual(targets('src/lib/index.js'), [
    { to: { kind: 'module', path: 'src/a.ts' }, line: 1 }
  ])
})

test('the summary counts unresolved edges and skipped imports, and collects warnings', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/app/package.json': { name: 'app' },
    'packages/app/src/main.ts': [
      "import 'core/hidden'",
      "import './gone'",
      "import './a.css'",
      "import './b.css'",
      "import './types'",
      "import data from './data.json'"
    ].join('\n'),
    'packages/app/src/a.css': '',
    'packages/app/src/b.css': '',
    'packages/app/src/types.d.ts': '',
    'packages/app/src/data.json': '{}',
    'packages/core/package.json': { name: 'core', exports: { '.': './index.ts' } },
    'packages/core/index.ts': ''
  })
  const { summary, model } = analyzeRepository(root)
  assert.equal(summary.unresolved, 2)
  assert.deepEqual(summary.skipped, { '.css': 2, '.d.ts': 1, '.json': 1 })
  assert.deepEqual(summary.warnings, [
    {
      path: 'packages/core/package.json',
      message: 'core/hidden: exports has no entry for the subpath'
    }
  ])
  assert.equal(model.modules['packages/app/src/main.ts' as RepoPath]?.edges.length, 2)
})
