import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { emptyConfig } from '../src/model.ts'
import { analyze } from '../src/model-cache.ts'
import { git, gitRepository } from './temp-repository.ts'

const analysis = new URL('../src/analysis.ts', import.meta.url).pathname
const model = new URL('../src/model.ts', import.meta.url).pathname

interface Analyzed {
  readonly modules: readonly string[]
  readonly symbols: readonly string[]
  readonly warnings: readonly { readonly path: string; readonly message: string }[]
}

/**
 * Analyzes `root` in a child process that is killed after 20 seconds, since
 * a read of `/dev/zero` never ends and would hang the test run.
 */
function analyzed(root: string): Analyzed {
  const script = [
    `import { analyzeRepository } from ${JSON.stringify(analysis)}`,
    `import { emptyConfig } from ${JSON.stringify(model)}`,
    `const { model, summary } = analyzeRepository(${JSON.stringify(root)}, emptyConfig)`,
    'const modules = Object.values(model.modules)',
    'console.log(JSON.stringify({',
    '  modules: modules.map(module => module.path),',
    '  symbols: modules.flatMap(module => module.symbols.map(symbol => symbol.name)),',
    '  warnings: summary.warnings',
    '}))'
  ].join('\n')
  const { status, signal, stdout, stderr } = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 26 }
  )
  assert.equal(signal, null, 'the analysis finished within 20 seconds')
  assert.equal(status, 0, stderr)
  return JSON.parse(stdout) as Analyzed
}

function linkedRepository(t: TestContext, link: string, target: string): string {
  const root = gitRepository(t, {
    'package.json': { name: 'app' },
    'src/a.ts': 'export const a = 1'
  })
  symlinkSync(target, join(root, link))
  return root
}

test('a module linked to /dev/zero is skipped with a warning, and the analysis ends', t => {
  const root = linkedRepository(t, 'src/zero.ts', '/dev/zero')
  assert.deepEqual(analyzed(root), {
    modules: ['src/a.ts'],
    symbols: ['a'],
    warnings: [{ path: 'src/zero.ts', message: 'links outside the repository, so it is skipped' }]
  })
})

test('a module linked to a file outside the repository is skipped, and none of it is read', t => {
  const outside = mkdtempSync(join(tmpdir(), 'galactica-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  writeFileSync(join(outside, 'secret.ts'), "export const API_KEY = 'secret'")
  const root = linkedRepository(t, 'src/leak.ts', join(outside, 'secret.ts'))
  assert.deepEqual(analyzed(root), {
    modules: ['src/a.ts'],
    symbols: ['a'],
    warnings: [{ path: 'src/leak.ts', message: 'links outside the repository, so it is skipped' }]
  })
})

test('a module under a folder linked outside the repository is skipped', t => {
  const outside = mkdtempSync(join(tmpdir(), 'galactica-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  const root = gitRepository(t, {
    'package.json': { name: 'app' },
    'src/a.ts': 'export const a = 1',
    'lib/secret.ts': 'export const placeholder = 1'
  })
  git(root, 'add', '.')
  renameSync(join(root, 'lib'), join(outside, 'lib'))
  writeFileSync(join(outside, 'lib/secret.ts'), "export const API_KEY = 'secret'")
  symlinkSync(join(outside, 'lib'), join(root, 'lib'))
  assert.deepEqual(analyzed(root), {
    modules: ['src/a.ts'],
    symbols: ['a'],
    warnings: [{ path: 'lib/secret.ts', message: 'links outside the repository, so it is skipped' }]
  })
})

test('a module linked to a file inside the repository is read from that file', t => {
  const root = linkedRepository(t, 'src/alias.ts', 'a.ts')
  assert.deepEqual(analyzed(root), {
    modules: ['src/a.ts', 'src/alias.ts'],
    symbols: ['a', 'a'],
    warnings: []
  })
})

test('a module linked to a directory inside the repository is skipped as no regular file', t => {
  const root = linkedRepository(t, 'src/dir.ts', '../lib')
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'lib/b.ts'), 'export const b = 2')
  assert.deepEqual(analyzed(root), {
    modules: ['lib/b.ts', 'src/a.ts'],
    symbols: ['b', 'a'],
    warnings: [{ path: 'src/dir.ts', message: 'is not a regular file, so it is skipped' }]
  })
})

test('a module over 10 MB is skipped with a warning, and one of 10 MB is read', t => {
  const root = gitRepository(t, {
    'package.json': { name: 'app' },
    'src/large.ts': 'export const large = 1\n'.padEnd(10_000_000, '/'),
    'src/huge.ts': 'export const huge = 1\n'.padEnd(10_000_001, '/')
  })
  assert.deepEqual(analyzed(root), {
    modules: ['src/large.ts'],
    symbols: ['large'],
    warnings: [{ path: 'src/huge.ts', message: 'is over 10 MB, so it is skipped' }]
  })
})

test('a module over 10 MB that shrinks is read on the next run with a cache', async t => {
  const root = gitRepository(t, {
    '.gitignore': 'node_modules\n',
    'package.json': { name: 'app' },
    'src/huge.ts': 'export const huge = 1\n'.padEnd(10_000_001, '/')
  })
  const cache = join(root, 'node_modules/.cache/galactica')
  mkdirSync(cache, { recursive: true })
  const past = new Date(Date.now() - 60_000)
  const settled = () => {
    for (const path of ['', '.git', 'src', 'src/huge.ts', 'package.json', '.gitignore']) {
      utimesSync(join(root, path), past, past)
    }
  }
  settled()
  assert.deepEqual(Object.keys((await analyze(root, emptyConfig, { cache })).model.modules), [])
  writeFileSync(join(root, 'src/huge.ts'), 'export const huge = 1\n')
  settled()
  const { model, summary } = await analyze(root, emptyConfig, { cache })
  assert.deepEqual(Object.keys(model.modules), ['src/huge.ts'])
  assert.deepEqual(summary.warnings, [])
})
