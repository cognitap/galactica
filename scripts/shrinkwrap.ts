/** Maintain npm's production lock without installing development dependencies or running scripts. */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface Manifest {
  readonly name: string
  readonly version: string
  readonly license?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly bin?: Readonly<Record<string, string>>
  readonly engines?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
}

interface Shrinkwrap {
  readonly name: string
  readonly version: string
  readonly lockfileVersion: number
  readonly packages: Readonly<Record<string, Partial<Manifest>>>
}

const metadataOf = ({
  name,
  version,
  license,
  dependencies,
  bin,
  engines,
  optionalDependencies
}: Manifest): Manifest => ({
  name,
  version,
  ...(license === undefined ? {} : { license }),
  ...(dependencies === undefined ? {} : { dependencies }),
  ...(bin === undefined
    ? {}
    : {
        bin: Object.fromEntries(
          Object.entries(bin).map(([name, path]) => [name, path.replace(/^\.\//, '')])
        )
      }),
  ...(engines === undefined ? {} : { engines }),
  ...(optionalDependencies === undefined ? {} : { optionalDependencies })
})

function check(manifest: Manifest, lock: Shrinkwrap): void {
  const update = 'Run pnpm shrinkwrap:update and review npm-shrinkwrap.json.'
  const sync = 'Run pnpm shrinkwrap:sync to update package metadata.'
  assert.equal(lock.lockfileVersion, 3, `npm-shrinkwrap.json must use lockfileVersion 3. ${update}`)
  const root = lock.packages?.['']
  assert.ok(root, `npm-shrinkwrap.json is missing its root package. ${update}`)
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    assert.deepEqual(
      root[field] ?? {},
      manifest[field] ?? {},
      `npm-shrinkwrap.json root ${field} differs from package.json. ${update}`
    )
  }
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.optionalDependencies
  })) {
    assert.equal(
      lock.packages[`node_modules/${name}`]?.version,
      version,
      `npm-shrinkwrap.json must lock ${name} at package.json's exact version ${version}. ${update}`
    )
  }
  assert.equal(lock.name, manifest.name, `npm-shrinkwrap.json has a stale package name. ${sync}`)
  assert.equal(
    lock.version,
    manifest.version,
    `npm-shrinkwrap.json has a stale package version. ${sync}`
  )
  assert.deepEqual(
    root,
    metadataOf(manifest),
    `npm-shrinkwrap.json has stale root metadata. ${sync}`
  )
}

const textOf = (value: unknown) => JSON.stringify(value, null, 2) + '\n'

try {
  const mode = process.argv[2] ?? '--check'
  assert.ok(
    ['--check', '--update', '--sync-metadata'].includes(mode) && process.argv.length <= 3,
    'Usage: node scripts/shrinkwrap.ts [--check | --update | --sync-metadata]'
  )
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest
  const file = 'npm-shrinkwrap.json'
  if (mode === '--update') {
    const temporary = mkdtempSync(join(tmpdir(), 'galactica-shrinkwrap-'))
    try {
      writeFileSync(join(temporary, 'package.json'), textOf(metadataOf(manifest)))
      // Seed the existing resolutions so a metadata update does not refresh the compiler tree.
      if (existsSync(file)) writeFileSync(join(temporary, 'package-lock.json'), readFileSync(file))
      execFileSync(
        'npm',
        [
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--omit=dev',
          '--no-audit',
          '--no-fund'
        ],
        { cwd: temporary, stdio: 'inherit' }
      )
      const lock = JSON.parse(
        readFileSync(join(temporary, 'package-lock.json'), 'utf8')
      ) as Shrinkwrap
      check(manifest, lock)
      writeFileSync(file, textOf(lock))
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  } else {
    assert.ok(existsSync(file), 'npm-shrinkwrap.json is missing. Run pnpm shrinkwrap:update.')
    const lock = JSON.parse(readFileSync(file, 'utf8')) as Shrinkwrap
    if (mode === '--sync-metadata') {
      const synced = {
        ...lock,
        name: manifest.name,
        version: manifest.version,
        packages: { ...lock.packages, '': metadataOf(manifest) }
      }
      // Validate before writing: metadata sync must never conceal a dependency-tree mismatch.
      check(manifest, synced)
      writeFileSync(file, textOf(synced))
    } else check(manifest, lock)
  }
  console.log('npm-shrinkwrap.json matches package.json')
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
