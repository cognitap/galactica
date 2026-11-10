import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join, sep } from 'node:path'
import { test, type TestContext } from 'node:test'
import {
  cacheDirectory,
  CACHE_FORMAT,
  currentStamp,
  readCache,
  writeCache,
  type Cache,
  type Environment
} from '../src/cache.ts'
import type { CacheEntry } from '../src/cache-schema.ts'
import type { RepoPath } from '../src/model.ts'
import { repository } from './temp-repository.ts'

const stamp = {
  galactica: '1.2.3',
  build: 'abc',
  typescript: '6.0.3',
  vue: '3.5.44',
  svelte: 'missing',
  mdx: '3.1.1',
  marko: 'missing',
  markoCompiler: '5.42.18'
}

const entry: CacheEntry = {
  hash: 'f00d',
  mtimeMs: 1730000000123.456,
  size: 42,
  symbols: [
    { name: 'a', kind: 'const', line: 1, default: false, signature: 'const a = 1' },
    { name: 'B', kind: 'component', line: 3, default: true, signature: 'function B()', doc: 'B.' }
  ],
  imports: [
    {
      specifier: './b',
      syntax: 'declaration',
      line: 1,
      form: 'reexport',
      names: ['b', 'default'],
      renames: { B: 'default', b: 'b' },
      typeOnly: false,
      dynamic: false
    },
    {
      specifier: 'pkg',
      syntax: 'declaration',
      resolutionMode: 'require',
      line: 2,
      form: 'import',
      names: ['T'],
      typeOnly: true,
      dynamic: false
    },
    {
      specifier: './lazy',
      syntax: 'import-call',
      line: 4,
      form: 'import',
      names: ['*'],
      typeOnly: false,
      dynamic: true
    },
    {
      specifier: './jsx',
      syntax: 'declaration',
      line: 5,
      form: 'import',
      names: ['h'],
      typeOnly: false,
      dynamic: false,
      elided: 'unless-verbatim',
      jsx: { names: ['h'], factory: 'h', fragmentFactory: 'Fragment', fragment: true }
    }
  ]
}

const cache: Cache = new Map([
  ['src/a.ts' as RepoPath, entry],
  [
    'src/App.vue' as RepoPath,
    {
      hash: 'beef',
      mtimeMs: 1,
      size: 0,
      symbols: [],
      imports: [],
      failure: 'Unexpected token'
    }
  ]
])

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const cacheText = (directory: string) => readFileSync(join(directory, 'cache.json'), 'utf8')

/** A home of its own, so the cache folder is created where the test can see it. */
function homeFor(t: TestContext) {
  const home = realpathSync(repository(t, {}))
  const at = (root: string, platform: NodeJS.Platform = 'linux', env: Environment['env'] = {}) =>
    cacheDirectory(root, { platform, env, home })
  return { home, at }
}

test('the cache lives in the user cache directory, by a hash of the root, even when the root has node_modules', t => {
  const { home, at } = homeFor(t)
  const root = repository(t, { 'node_modules/.keep': '' })
  const key = at(root)!.split(sep).at(-1)!
  assert.match(key, /^[0-9a-f]{16}$/)
  assert.equal(at(root, 'darwin'), join(home, 'Library/Caches/galactica', key))
  assert.equal(at(root, 'linux'), join(home, '.cache/galactica', key))
  assert.equal(
    at(root, 'linux', { XDG_CACHE_HOME: join(home, 'xdg') }),
    join(home, 'xdg/galactica', key)
  )
  assert.equal(
    at(root, 'linux', { XDG_CACHE_HOME: 'relative' }),
    join(home, '.cache/galactica', key)
  )
  assert.equal(
    at(root, 'win32', { LOCALAPPDATA: join(home, 'local') }),
    join(home, 'local/galactica', key)
  )
  assert.equal(
    at(root, 'win32', { LOCALAPPDATA: 'relative' }),
    join(home, 'AppData/Local/galactica', key)
  )
  assert.equal(statSync(at(root)!).mode & 0o777, 0o700)
  assert.deepEqual(readdirSync(join(root, 'node_modules')), ['.keep'])
  assert.notEqual(at(repository(t, {})), at(root))
})

test('a root reached through a symlink shares the cache of its real path', t => {
  const { home, at } = homeFor(t)
  const root = repository(t, {})
  const link = join(home, 'link')
  symlinkSync(root, link)
  assert.equal(at(link), at(root))
})

test('there is no cache without an absolute user cache directory', t => {
  const root = repository(t, {})
  assert.equal(cacheDirectory(root, { platform: 'linux', env: {}, home: '' }), undefined)
  assert.equal(cacheDirectory(root, { platform: 'win32', env: {}, home: 'relative' }), undefined)
})

test('there is no cache when the cache folder would lie inside the repository', t => {
  const root = realpathSync(repository(t, {}))
  assert.equal(cacheDirectory(root, { platform: 'linux', env: {}, home: root }), undefined)
  const { home, at } = homeFor(t)
  const outside = at(root)!
  rmSync(outside, { recursive: true })
  symlinkSync(join(root, 'cache'), outside)
  mkdirSync(join(root, 'cache'))
  assert.equal(at(root), undefined)
  assert.deepEqual(readdirSync(join(home, '.cache/galactica')).length, 1)
})

test('there is no cache when the cache folder is a symlink, wherever it leads', t => {
  const { at } = homeFor(t)
  const root = repository(t, {})
  const elsewhere = repository(t, {})
  const directory = at(root)!
  rmSync(directory, { recursive: true })
  symlinkSync(elsewhere, directory)
  assert.equal(at(root), undefined)
  assert.deepEqual(readdirSync(elsewhere), [])
})

test('a written cache reads back the same, and replaces the previous one', t => {
  const directory = join(repository(t, {}), 'cache')
  writeCache(directory, stamp, new Map([['src/old.ts' as RepoPath, entry]]))
  writeCache(directory, stamp, cache)
  assert.deepEqual(readCache(directory, stamp), cache)
  assert.deepEqual(readdirSync(directory), ['cache.json'])
})

test('the file holds the format, the stamp and the entries by path, sorted', t => {
  const directory = repository(t, {})
  writeCache(directory, stamp, cache)
  const file = JSON.parse(cacheText(directory))
  assert.equal(file.format, CACHE_FORMAT)
  assert.deepEqual(
    [
      file.galactica,
      file.build,
      file.typescript,
      file.vue,
      file.svelte,
      file.mdx,
      file.marko,
      file.markoCompiler
    ],
    ['1.2.3', 'abc', '6.0.3', '3.5.44', 'missing', '3.1.1', 'missing', '5.42.18']
  )
  assert.deepEqual(Object.keys(file.modules), ['src/App.vue', 'src/a.ts'])
})

test('a cache from another format, Galactica build, TypeScript or compiler version is discarded whole', t => {
  const directory = repository(t, {})
  writeCache(directory, stamp, cache)
  for (const other of [
    { ...stamp, galactica: '1.2.4' },
    { ...stamp, build: 'abd' },
    { ...stamp, typescript: '6.0.4' },
    { ...stamp, vue: 'missing' },
    { ...stamp, svelte: '5.57.3' },
    { ...stamp, mdx: 'missing' },
    { ...stamp, marko: '6.4.12' },
    { ...stamp, markoCompiler: 'missing' }
  ]) {
    assert.equal(readCache(directory, other).size, 0)
  }
  const file = JSON.parse(cacheText(directory))
  writeFileSync(join(directory, 'cache.json'), JSON.stringify({ ...file, format: 0 }))
  assert.equal(readCache(directory, stamp).size, 0)
})

test('a missing or corrupt cache reads as empty', t => {
  const directory = repository(t, {})
  assert.equal(readCache(join(directory, 'missing'), stamp).size, 0)
  for (const text of ['{"format":1,', 'null', '[]', '"cache"', JSON.stringify({ format: 1 })]) {
    writeFileSync(join(directory, 'cache.json'), text)
    assert.equal(readCache(directory, stamp).size, 0, text)
  }
})

test('an entry that does not parse is left out, and the others are kept', t => {
  const directory = repository(t, {})
  writeCache(directory, stamp, cache)
  const file = JSON.parse(cacheText(directory))
  const broken = [
    { ...entry, hash: 1 },
    { ...entry, symbols: [{ ...entry.symbols[0], kind: 'macro' }] },
    { ...entry, symbols: [{ ...entry.symbols[0], line: 0 }] },
    { ...entry, imports: [{ ...entry.imports[0], syntax: 'include' }] },
    { ...entry, imports: [{ ...entry.imports[0], renames: { a: 1 } }] },
    { ...entry, imports: [{ ...entry.imports[0], resolutionMode: 'both' }] },
    ...[
      null,
      { names: [1] },
      { names: ['h'], factory: 1 },
      { names: ['h'], fragmentFactory: false },
      { names: ['h'], fragment: 'yes' }
    ].map(jsx => ({ ...entry, imports: [{ ...entry.imports[0], jsx }] })),
    { ...entry, imports: 'none' },
    { ...entry, failure: 1 },
    'entry'
  ]
  for (const value of broken) {
    const modules = { ...file.modules, 'src/a.ts': value }
    writeFileSync(join(directory, 'cache.json'), JSON.stringify({ ...file, modules }))
    assert.deepEqual(
      [...readCache(directory, stamp).keys()],
      ['src/App.vue'],
      JSON.stringify(value)
    )
  }
})

test('a cache that cannot be written is skipped without an error, and leaves nothing behind', t => {
  const root = repository(t, { blocked: 'a file where the folder would be' })
  writeCache(join(root, 'blocked', 'cache'), stamp, cache)
  assert.deepEqual(readdirSync(root), ['blocked'])

  const readOnly = join(root, 'read-only')
  mkdirSync(readOnly)
  chmodSync(readOnly, 0o500)
  writeCache(readOnly, stamp, cache)
  assert.deepEqual(readdirSync(readOnly), [])
})

test('the current stamp names this Galactica and TypeScript', () => {
  const { galactica, build, typescript } = currentStamp()
  assert.equal(galactica, version)
  assert.match(build, /^[0-9a-f]{64}$/)
  assert.match(typescript, /^\d+\.\d+\.\d+/)
})

test('the current stamp names each installed framework compiler', () => {
  const { vue, svelte, mdx, marko, markoCompiler } = currentStamp()
  assert.deepEqual(
    { vue, svelte, mdx, marko, markoCompiler },
    {
      vue: '3.5.44',
      svelte: '5.57.3',
      mdx: '3.1.1',
      marko: '6.4.12',
      markoCompiler: '5.42.18'
    }
  )
})
