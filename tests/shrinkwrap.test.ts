import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { repository } from './temp-repository.ts'

const script = fileURLToPath(new URL('../scripts/shrinkwrap.ts', import.meta.url))

function fixture(t: TestContext) {
  const production = {
    name: '@cognitap/galactica',
    version: '0.1.5',
    license: 'MIT',
    dependencies: { typescript: '6.0.3' },
    bin: { galactica: './dist/bin.js' },
    engines: { node: '>=24.1.0' },
    optionalDependencies: { svelte: '5.57.3', vue: '3.5.44' }
  }
  const manifest = {
    ...production,
    scripts: { version: 'node scripts/shrinkwrap.ts --sync-metadata' }
  }
  const lock = {
    name: production.name,
    version: production.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { ...structuredClone(production), bin: { galactica: 'dist/bin.js' } },
      'node_modules/typescript': { version: production.dependencies.typescript },
      'node_modules/svelte': { version: production.optionalDependencies.svelte },
      'node_modules/vue': { version: production.optionalDependencies.vue },
      'node_modules/transitive': { version: '1.2.3', integrity: 'sha512-kept' }
    }
  }
  const root = repository(t, {
    'package.json': manifest,
    'npm-shrinkwrap.json': lock,
    'scripts/shrinkwrap.ts': readFileSync(script, 'utf8')
  })
  const save = () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(root, 'npm-shrinkwrap.json'), JSON.stringify(lock))
  }
  const run = (mode = '--check') =>
    spawnSync(process.execPath, [script, mode], { cwd: root, encoding: 'utf8', timeout: 20_000 })
  const read = () =>
    JSON.parse(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8')) as typeof lock
  return { root, manifest, lock, save, run, read }
}

test('the production lock check accepts matching root metadata and compiler versions', t => {
  const result = fixture(t).run()
  assert.equal(result.status, 0, result.stderr)
})

const drift = {
  'manifest compiler versions': ({ manifest }: ReturnType<typeof fixture>) => {
    manifest.optionalDependencies.vue = '99.0.0'
  },
  'root compiler declarations': ({ lock }: ReturnType<typeof fixture>) => {
    lock.packages[''].dependencies.typescript = '0.0.0'
  },
  'locked compiler versions': ({ lock }: ReturnType<typeof fixture>) => {
    lock.packages['node_modules/svelte'].version = '0.0.0'
  },
  'root package version': ({ lock }: ReturnType<typeof fixture>) => {
    lock.packages[''].version = '0.0.0'
  },
  'top-level package version': ({ lock }: ReturnType<typeof fixture>) => {
    lock.version = '0.0.0'
  }
}
for (const [name, change] of Object.entries(drift)) {
  test(`the production lock check reports drift in ${name} with a repair command`, t => {
    const repo = fixture(t)
    change(repo)
    repo.save()
    const result = repo.run()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /npm-shrinkwrap\.json/)
    assert.match(result.stderr, /Run pnpm shrinkwrap:(?:update|sync)/)
  })
}

test('metadata synchronization changes both versions and metadata while retaining locked dependencies', t => {
  const repo = fixture(t)
  repo.manifest.version = '0.2.0'
  repo.manifest.engines.node = '>=26.0.0'
  repo.manifest.bin.galactica = './dist/other.js'
  repo.save()
  const result = repo.run('--sync-metadata')
  assert.equal(result.status, 0, result.stderr)
  const updated = repo.read()
  assert.equal(updated.version, '0.2.0')
  assert.equal(updated.packages[''].version, '0.2.0')
  assert.equal(updated.packages[''].engines.node, '>=26.0.0')
  assert.equal(updated.packages[''].bin.galactica, 'dist/other.js')
  const { '': _oldRoot, ...before } = repo.lock.packages
  const { '': _newRoot, ...after } = updated.packages
  assert.deepEqual(after, before)
})

test('metadata synchronization refuses dependency drift without writing the lock', t => {
  const repo = fixture(t)
  repo.manifest.optionalDependencies.vue = '99.0.0'
  repo.save()
  const before = readFileSync(join(repo.root, 'npm-shrinkwrap.json'), 'utf8')
  const result = repo.run('--sync-metadata')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Run pnpm shrinkwrap:update/)
  assert.equal(readFileSync(join(repo.root, 'npm-shrinkwrap.json'), 'utf8'), before)
})

test('pnpm version runs metadata synchronization before the release lock check', t => {
  const repo = fixture(t)
  const result = spawnSync('pnpm', ['version', '0.2.0', '--no-git-tag-version'], {
    cwd: repo.root,
    encoding: 'utf8',
    timeout: 20_000
  })
  assert.equal(result.status, 0, result.stderr)
  const updated = repo.read()
  assert.equal(updated.version, '0.2.0')
  assert.equal(updated.packages[''].version, '0.2.0')
  assert.deepEqual(
    updated.packages['node_modules/transitive'],
    repo.lock.packages['node_modules/transitive']
  )
  assert.equal(repo.run().status, 0)
})
