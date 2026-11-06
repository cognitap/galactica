import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { CACHE_FORMAT, cacheDirectory } from '../src/cache.ts'
import { loadConfig } from '../src/config.ts'
import { MODEL_CACHE_FORMAT } from '../src/model-cache.ts'
import { cliRunner } from './cli.ts'
import { filesUnder, repository } from './temp-repository.ts'
const { run: galactica, env, home } = cliRunner()
/** The stamp of the built CLI, which hashes its own files. */
const { currentStamp }: typeof import('../src/cache.ts') = await import(
  new URL('../dist/cache.js', import.meta.url).href
)

const cacheOf = (root: string) =>
  cacheDirectory(root, { platform: process.platform, env, home: realpathSync(home) })!

test('a command keeps its cache in the user cache folder, never in the repository, and --no-cache writes none', t => {
  const root = repository(t, {
    'package.json': { name: 'cached' },
    'src/a.ts': "import { b } from './b'\nexport const a = b",
    'src/b.ts': 'export const b = 1',
    'node_modules/left-pad/index.js': ''
  })
  const before = filesUnder(root)
  const uncached = galactica(root, 'deps', 'src/a.ts', '--json', '--no-cache')
  assert.equal(uncached.status, 0)
  assert.deepEqual(filesUnder(root), before)

  const cold = galactica(root, 'deps', 'src/a.ts', '--json')
  const warm = galactica(root, 'deps', 'src/a.ts', '--json')
  assert.equal(cold.stdout, uncached.stdout)
  assert.equal(warm.stdout, uncached.stdout)
  assert.deepEqual(filesUnder(root), before)
  assert.deepEqual(filesUnder(cacheOf(root)), ['cache.json', 'model.json'])
  assert.equal(galactica(root, 'html', '--no-cache', '--out', join(home, 'map.html')).status, 0)
})

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const stealing = {
  'package.json': { name: 'forge' },
  'src/a.ts':
    "import { execSync } from 'node:child_process'\nexport function stealKeys() { return execSync('id') }",
  'node_modules/.keep': ''
}

const shipped = (root: string, file: string, text: string) => {
  mkdirSync(join(root, 'node_modules/.cache/galactica'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.cache/galactica', file), text)
}

const outlined = (root: string) => {
  const { status, stdout, stderr } = galactica(root, 'outline', 'src/a.ts')
  assert.equal(status, 0, stderr)
  return stdout
}

const harmless = {
  name: 'formatDate',
  kind: 'function',
  line: 1,
  default: false,
  signature: 'function formatDate()'
}

test('an extraction cache the repository ships is never read', t => {
  const root = repository(t, stealing)
  const { mtimeMs, size } = statSync(join(root, 'src/a.ts'))
  const hash = sha256(readFileSync(join(root, 'src/a.ts'), 'utf8'))
  const entry = { hash, mtimeMs, size, symbols: [harmless], imports: [] }
  shipped(
    root,
    'cache.json',
    JSON.stringify({ format: CACHE_FORMAT, ...currentStamp(), modules: { 'src/a.ts': entry } })
  )
  assert.match(outlined(root), /stealKeys/)
  assert.doesNotMatch(outlined(root), /formatDate/)
})

test('a model cache the repository ships is never read', t => {
  const root = repository(t, stealing)
  const config = sha256(JSON.stringify(loadConfig(root)))
  const inputs = { config, git: null, directories: [], files: [] }
  const header = { format: MODEL_CACHE_FORMAT, ...currentStamp(), inputs }
  const module = { path: 'src/a.ts', hash: 'f00d', symbols: [harmless], edges: [] }
  const model = {
    format: 3,
    repository: { name: 'forge' },
    packages: { forge: { dir: '.' } },
    modules: { 'src/a.ts': module }
  }
  const body = { model, warnings: [], unresolved: 0, skipped: {} }
  shipped(root, 'model.json', `${JSON.stringify(header)}\n${JSON.stringify(body)}`)
  assert.match(outlined(root), /stealKeys/)
  assert.doesNotMatch(outlined(root), /formatDate/)
})

test('a cache folder the repository links elsewhere is never written', t => {
  const root = repository(t, stealing)
  const elsewhere = repository(t, {})
  mkdirSync(join(root, 'node_modules/.cache'))
  symlinkSync(elsewhere, join(root, 'node_modules/.cache/galactica'))
  outlined(root)
  outlined(root)
  assert.deepEqual(readdirSync(elsewhere), [])
})
