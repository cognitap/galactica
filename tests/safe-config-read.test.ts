import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { gitRepository, repository } from './temp-repository.ts'

const cli = process.env.GALACTICA_TEST_CLI ?? new URL('../dist/bin.js', import.meta.url).pathname

/** Fence the bad read before a baseline process can consume unbounded /dev/zero data. */
function probe(
  root: string,
  unsafe: string,
  command: readonly string[] = ['overview', '--root', root, '--json', '--no-cache']
) {
  const preload = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const original = fs.readFileSync;
    fs.readFileSync = function(path, ...args) {
      if (String(path) === ${JSON.stringify(unsafe)}) {
        console.error('UNSAFE_CONFIG_READ');
        throw new Error('UNSAFE_CONFIG_READ');
      }
      return original.call(this, path, ...args);
    };
    syncBuiltinESMExports();
  `
  return spawnSync(
    process.execPath,
    ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, cli, ...command],
    { encoding: 'utf8', timeout: 5000 }
  )
}

for (const file of [
  'tsconfig.json',
  'jsconfig.json',
  'package.json',
  'pnpm-workspace.yaml',
  'galactica.config.json'
]) {
  for (const destination of ['device', 'outside']) {
    test(`${file} linked to ${destination} is refused before any read (DEV-734)`, t => {
      const outside = repository(t, {
        'outside.json': { name: 'OUTSIDE_SECRET', compilerOptions: {} }
      })
      const root = gitRepository(t, { 'src/main.ts': 'export const main = 1' })
      const path = join(root, file)
      symlinkSync(destination === 'device' ? '/dev/zero' : join(outside, 'outside.json'), path)
      const result = probe(root, path)
      assert.equal(result.error, undefined, String(result.error))
      assert.doesNotMatch(
        result.stderr,
        /UNSAFE_CONFIG_READ/,
        'config must be rejected before opening it'
      )
      assert.equal(result.status, file === 'galactica.config.json' ? 1 : 0, result.stderr)
      assert.doesNotMatch(result.stdout, /OUTSIDE_SECRET/)
      const output = JSON.parse(result.stdout) as {
        warnings: { path: string; message: string }[]
        error?: { message: string }
      }
      if (file === 'galactica.config.json') {
        assert.match(output.error?.message ?? '', /regular file|outside the repository/)
        return
      }
      assert.ok(
        output.warnings.some(
          warning =>
            warning.path === file && /regular file|outside the repository/.test(warning.message)
        ),
        result.stdout
      )
    })
  }
}

for (const file of ['tsconfig.json', 'package.json', 'galactica.config.json']) {
  test(`${file} over the size cap is refused without reading`, t => {
    const root = gitRepository(t, { 'src/main.ts': 'export const main = 1' })
    const path = join(root, file)
    writeFileSync(path, '{}')
    truncateSync(path, 10_000_001)
    const result = probe(root, path)
    assert.equal(result.error, undefined)
    assert.doesNotMatch(result.stderr, /UNSAFE_CONFIG_READ/)
    assert.equal(result.status, file === 'galactica.config.json' ? 1 : 0)
    assert.match(result.stdout, /over 10 MB/)
  })
}

test('an extended config below a linked folder outside the root is refused', t => {
  const outside = repository(t, {
    'base.json': { compilerOptions: { baseUrl: '.', paths: { '@outside': ['secret.ts'] } } }
  })
  const root = gitRepository(t, {
    'tsconfig.json': { extends: './linked/base.json' },
    'src/main.ts': 'export const main = 1'
  })
  symlinkSync(outside, join(root, 'linked'), 'dir')
  const result = probe(root, join(root, 'linked/base.json'))
  assert.equal(result.error, undefined)
  assert.doesNotMatch(result.stderr, /UNSAFE_CONFIG_READ/)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /links outside the repository/)
})

test('a regular config linked within the root is still read', t => {
  const root = gitRepository(t, {
    'config/base.json': { compilerOptions: { baseUrl: '.', paths: { '@lib': ['src/lib.ts'] } } },
    'src/main.ts': "import { value } from '@lib'; export const main = value",
    'src/lib.ts': 'export const value = 1'
  })
  symlinkSync(join(root, 'config/base.json'), join(root, 'tsconfig.json'))
  const result = probe(root, join(root, 'not-a-read'))
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout) as { unresolved: number; warnings: unknown[] }
  assert.equal(output.unresolved, 0)
  assert.deepEqual(output.warnings, [])
})

test('repairing a refused config in place invalidates a warm model', t => {
  const root = gitRepository(t, { 'package.json': '{}', 'src/main.ts': 'export const main = 1' })
  const path = join(root, 'package.json')
  truncateSync(path, 10_000_001)
  const home = repository(t, {})
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    LOCALAPPDATA: join(home, 'AppData', 'Local')
  }
  const run = () => {
    const result = spawnSync(process.execPath, [cli, 'overview', '--root', root, '--json'], {
      encoding: 'utf8',
      timeout: 10000,
      env
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout) as { packages: { name: string }[]; warnings: unknown[] }
  }
  assert.ok(run().warnings.length > 0)
  assert.ok(
    readdirSync(home, { recursive: true }).some(file => String(file).endsWith('model.json')),
    'first run writes a model cache'
  )
  const before = statSync(root).mtimeMs
  writeFileSync(path, JSON.stringify({ name: 'repaired' }))
  assert.equal(statSync(root).mtimeMs, before, 'repair changes the file, not its parent directory')
  const repaired = run()
  assert.equal(repaired.packages[0]?.name, 'repaired')
  assert.deepEqual(repaired.warnings, [])
})

test('init refuses an oversized existing skill without opening it or writing other files', t => {
  const root = gitRepository(t, {})
  const directory = join(root, '.agents/skills/galactica')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'SKILL.md')
  writeFileSync(file, 'edited')
  truncateSync(file, 10_000_001)
  const result = probe(root, file, ['init', '--root', root])
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.doesNotMatch(result.stderr, /UNSAFE_CONFIG_READ/)
  assert.match(result.stderr, /over 10 MB/)
  assert.equal(statSync(file).size, 10_000_001)
  assert.equal(existsSync(join(root, '.claude/skills/galactica/SKILL.md')), false)
})

test('a non-git repository still reports an unsafe config omitted by the directory walk', t => {
  const root = repository(t, { 'src/main.ts': 'export const main = 1' })
  const file = join(root, 'tsconfig.json')
  symlinkSync('/dev/zero', file)
  const result = probe(root, file)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0)
  assert.doesNotMatch(result.stderr, /UNSAFE_CONFIG_READ/)
  assert.match(result.stdout, /outside the repository|regular file/)
})
