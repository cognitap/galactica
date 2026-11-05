import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'
import { analyzeRepository } from '../src/analysis.ts'
import { cacheDirectory, currentStamp, readCache } from '../src/cache.ts'
import type { RepoPath } from '../src/model.ts'
import { fixtureCases, fixtureRepo } from './fixtures.ts'
import { repository, type Files } from './temp-repository.ts'

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

const cachedFiles: Files = {
  'package.json': { name: 'cached', type: 'module' },
  'tsconfig.json': {
    compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowJs: true }
  },
  'src/index.ts': "export { a } from './a.ts'\nexport * from './b.ts'",
  'src/a.ts': "import { b } from './b.ts'\n/** A. */\nexport const a = () => b",
  'src/b.ts': 'export const b = 2\nexport type B = number',
  'src/legacy.cjs': "const { a } = require('./a.ts')\nmodule.exports = { a }",
  'src/App.vue': '<template/>'
}

/** A repository and a cache folder for it, outside the repository. */
function cachedRepository(t: TestContext, files: Files = cachedFiles) {
  const root = repository(t, files)
  const cache = join(repository(t, {}), 'cache')
  const run = () => analyzeRepository(root, { cache })
  const cold = () => analyzeRepository(root).model
  return { root, cache, run, cold }
}

const counts = (reused: number, reread: number, parsed: number) => ({ reused, reread, parsed })

test('a warm run gives the model of a cold run, without reading a module', t => {
  const { run, cold } = cachedRepository(t)
  const first = run()
  assert.deepEqual(first.summary.modules, counts(0, 0, 5))
  const warm = run()
  assert.deepEqual(warm.summary.modules, counts(5, 0, 0))
  assert.deepEqual(warm.model, cold())
  assert.deepEqual(warm.model, first.model)
  assert.equal(JSON.stringify(warm.model), JSON.stringify(cold()))
})

test('every fixture gives the same model warm as cold', t => {
  for (const name of fixtureCases()) {
    const root = fixtureRepo(name)
    const cache = join(repository(t, {}), 'cache')
    const cold = analyzeRepository(root, { cache }).model
    const warm = analyzeRepository(root, { cache })
    assert.equal(warm.summary.modules.parsed, 0, name)
    assert.equal(JSON.stringify(warm.model), JSON.stringify(cold), name)
    assert.equal(JSON.stringify(analyzeRepository(root).model), JSON.stringify(cold), name)
  }
})

test('editing one file parses only that file, and the model is that of a cold run', t => {
  const { root, run, cold } = cachedRepository(t)
  run()
  writeFileSync(join(root, 'src/b.ts'), 'export const b = 2\nexport const c = 3\n')
  const edited = run()
  assert.deepEqual(edited.summary.modules, counts(4, 0, 1))
  assert.deepEqual(edited.model, cold())
})

test('touching a file without changing it reads it again but does not parse it', t => {
  const { root, cache, run, cold } = cachedRepository(t)
  run()
  const later = new Date(Date.now() + 60_000)
  utimesSync(join(root, 'src/a.ts'), later, later)
  const touched = run()
  assert.deepEqual(touched.summary.modules, counts(4, 1, 0))
  assert.deepEqual(touched.model, cold())
  assert.equal(
    readCache(cache, currentStamp()).get('src/a.ts' as RepoPath)?.mtimeMs,
    later.getTime()
  )
  assert.deepEqual(run().summary.modules, counts(5, 0, 0))
})

test('an added file is parsed, and a deleted one leaves the cache', t => {
  const { root, cache, run, cold } = cachedRepository(t)
  run()
  writeFileSync(join(root, 'src/c.ts'), "export { b as c } from './b.ts'")
  rmSync(join(root, 'src/legacy.cjs'))
  const changed = run()
  assert.deepEqual(changed.summary.modules, counts(4, 0, 1))
  assert.deepEqual(changed.model, cold())
  assert.deepEqual([...readCache(cache, currentStamp()).keys()].sort(), [
    'src/App.vue',
    'src/a.ts',
    'src/b.ts',
    'src/c.ts',
    'src/index.ts'
  ])
  rmSync(join(root, 'src/c.ts'))
  const deleted = run()
  assert.deepEqual(deleted.summary.modules, counts(4, 0, 0))
  assert.deepEqual(deleted.model, cold())
  assert.equal(readCache(cache, currentStamp()).size, 4)
})

test('a cache from another Galactica build or TypeScript version is discarded', t => {
  const { cache, run, cold } = cachedRepository(t)
  run()
  const file = join(cache, 'cache.json')
  const written = JSON.parse(readFileSync(file, 'utf8'))
  for (const other of [{ galactica: '9.9.9' }, { build: 'other' }, { typescript: '1.0.0' }]) {
    writeFileSync(file, JSON.stringify({ ...written, ...other }))
    const discarded = run()
    assert.deepEqual(discarded.summary.modules, counts(0, 0, 5), JSON.stringify(other))
    assert.deepEqual(discarded.model, cold())
  }
})

test('a corrupt cache is ignored and replaced', t => {
  const { cache, run, cold } = cachedRepository(t)
  run()
  writeFileSync(join(cache, 'cache.json'), '{"format":1,"modules":{')
  const recovered = run()
  assert.deepEqual(recovered.summary.modules, counts(0, 0, 5))
  assert.deepEqual(recovered.model, cold())
  assert.deepEqual(run().summary.modules, counts(5, 0, 0))
})

test('a cache folder that cannot be written does not fail the run', t => {
  const { cache, run, cold } = cachedRepository(t)
  mkdirSync(cache)
  chmodSync(cache, 0o500)
  assert.deepEqual(run().model, cold())
  assert.deepEqual(readdirSync(cache), [])
  assert.deepEqual(run().summary.modules, counts(0, 0, 5))
})

function filesUnder(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
    .sort()
}

test('the analysis writes nothing but the cache file, and nothing at all without a cache', t => {
  const root = repository(t, { ...cachedFiles, 'node_modules/left-pad/index.js': '' })
  const before = filesUnder(root)
  analyzeRepository(root)
  assert.deepEqual(filesUnder(root), before)
  analyzeRepository(root, { cache: cacheDirectory(root) })
  assert.deepEqual(
    filesUnder(root),
    [...before, join('node_modules', '.cache', 'galactica', 'cache.json')].sort()
  )
})
