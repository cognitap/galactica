import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  cacheDirectory,
  CACHE_FORMAT,
  currentStamp,
  readCache,
  writeCache,
  type Cache,
  type CacheEntry,
  type Environment
} from '../src/cache.ts'
import type { RepoPath } from '../src/model.ts'
import { repository } from './temp-repository.ts'

const stamp = {
  galactica: '1.2.3',
  build: 'abc',
  typescript: '6.0.3',
  vue: '3.5.44',
  svelte: 'missing'
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

const cacheText = (directory: string) => readFileSync(join(directory, 'cache.json'), 'utf8')

test('the cache lives under node_modules/.cache/galactica when the root has node_modules', t => {
  const root = repository(t, { 'node_modules/.keep': '' })
  assert.equal(cacheDirectory(root), join(root, 'node_modules', '.cache', 'galactica'))
})

test('without node_modules, the cache lives in the user cache directory, by a hash of the root', t => {
  const root = repository(t, { 'package.json': {} })
  const other = repository(t, { 'package.json': {} })
  const on = (platform: NodeJS.Platform, env: Environment['env'] = {}) =>
    cacheDirectory(root, { platform, env, home: '/home/me' })
  const key = on('linux').split('/').at(-1)!
  assert.match(key, /^[0-9a-f]{16}$/)
  assert.equal(on('darwin'), join('/home/me/Library/Caches/galactica', key))
  assert.equal(on('linux'), join('/home/me/.cache/galactica', key))
  assert.equal(on('linux', { XDG_CACHE_HOME: '/xdg' }), join('/xdg/galactica', key))
  assert.equal(on('linux', { XDG_CACHE_HOME: 'relative' }), join('/home/me/.cache/galactica', key))
  assert.equal(on('win32', { LOCALAPPDATA: '/local' }), join('/local/galactica', key))
  assert.equal(on('win32'), join('/home/me/AppData/Local/galactica', key))
  const elsewhere = cacheDirectory(other, { platform: 'linux', env: {}, home: '/home/me' })
  assert.notEqual(elsewhere, on('linux'))
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
    [file.galactica, file.build, file.typescript, file.vue, file.svelte],
    ['1.2.3', 'abc', '6.0.3', '3.5.44', 'missing']
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
    { ...stamp, svelte: '5.57.3' }
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
  assert.equal(galactica, '0.0.0')
  assert.match(build, /^[0-9a-f]{64}$/)
  assert.match(typescript, /^\d+\.\d+\.\d+/)
})
