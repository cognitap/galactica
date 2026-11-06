/**
 * Installs the packed package into a throwaway repository and runs it there,
 * the way a user's `npx @cognitap/galactica` does: only what `files` ships and
 * what `dependencies` and `optionalDependencies` install.
 *
 * node scripts/pack-and-test.ts [<archive>]
 *
 * Without an archive it packs the current build. pnpm installs the archive's
 * dependencies from its store, and reaches the registry only for what the
 * store lacks.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Output } from '../src/contract.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  version: string
}
const archiveArg = process.argv[2]
const work = mkdtempSync(join(tmpdir(), 'galactica-package-'))
const archive = resolve(archiveArg ?? join(work, 'galactica.tgz'))
const repository = join(work, 'repository')
const env = { ...process.env, NODE_PATH: undefined }
const run = (command: string, args: readonly string[], cwd = repository) =>
  execFileSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180_000 })
const galactica = (...args: string[]) =>
  run(join(repository, 'node_modules', '.bin', 'galactica'), args).trimEnd()
const json = (...args: string[]) => JSON.parse(galactica(...args, '--json')) as Output

const files: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
  'galactica.config.json': JSON.stringify({
    $schema: `./node_modules/${name}/schema/galactica.config.schema.json`
  }),
  'src/a.ts': 'export const a = 1\n',
  'src/main.ts': "import { a } from './a'\nexport const main = a\n",
  'src/App.vue': "<script setup>\nimport { a } from './a'\n</script>\n",
  'src/Card.svelte': "<script>\n  import { a } from './a'\n</script>\n"
}

try {
  if (!archiveArg) run('pnpm', ['pack', '--out', archive], root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true })
    writeFileSync(join(repository, path), content)
  }
  run('pnpm', ['add', '--prefer-offline', '--ignore-scripts', '--reporter=silent', archive])
  const shrinkwrapText = run('tar', ['-xOf', archive, 'package/npm-shrinkwrap.json'])
  const shrinkwrap = JSON.parse(shrinkwrapText) as {
    packages: Record<
      string,
      {
        version: string
        resolved?: string
        integrity?: string
        dependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
      }
    >
  }
  assert.ok(shrinkwrap.packages['node_modules/vue'], 'locks the Vue compiler tree')
  assert.ok(shrinkwrap.packages['node_modules/svelte'], 'locks the Svelte compiler tree')
  for (const [path, entry] of Object.entries(shrinkwrap.packages)) {
    if (path === '') continue
    assert.match(entry.version, /^\d+\.\d+\.\d+/, `${path} has an exact version`)
    assert.match(
      entry.resolved ?? '',
      /^https:\/\/registry\.npmjs\.org\//,
      `${path} has a registry URL`
    )
    assert.ok(entry.integrity?.startsWith('sha512-'), `${path} has an integrity hash`)
  }
  const installed = join(repository, 'node_modules', name)
  assert.ok(existsSync(join(installed, 'schema/galactica.config.schema.json')), 'ships the schema')

  // npm/npx honors a published shrinkwrap; pnpm uses the consumer's own lockfile.
  const npmRepository = join(work, 'npm-repository')
  mkdirSync(npmRepository)
  writeFileSync(
    join(npmRepository, 'package.json'),
    JSON.stringify({ name: 'npm-consumer', private: true })
  )
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--install-strategy=nested',
      archive
    ],
    npmRepository
  )
  const npmInstalled = join(npmRepository, 'node_modules', name)
  assert.equal(readFileSync(join(npmInstalled, 'npm-shrinkwrap.json'), 'utf8'), shrinkwrapText)
  // npm may nest or hoist the locked packages. Walk the actual dependency graph,
  // comparing each package to the entry that Node would reach in the lock's tree.
  const verified = new Set<string>()
  const verifyTree = (lockedPath: string, actualPath: string): void => {
    const entry = shrinkwrap.packages[lockedPath]
    assert.ok(entry, `${lockedPath} is locked`)
    const actual = JSON.parse(readFileSync(join(actualPath, 'package.json'), 'utf8')) as {
      version: string
    }
    // The archive manifest owns Galactica's version; pnpm version does not
    // rewrite the shrinkwrap's root metadata when preparing a release.
    if (lockedPath !== '') {
      assert.equal(
        actual.version,
        entry.version,
        `${lockedPath} installs its shrinkwrapped version`
      )
    }
    if (verified.has(lockedPath)) return
    verified.add(lockedPath)
    for (const dependency of Object.keys({
      ...entry.dependencies,
      ...entry.optionalDependencies
    })) {
      let owner = lockedPath
      let target = posix.join(owner, 'node_modules', dependency)
      while (!(target in shrinkwrap.packages) && owner !== '.') {
        owner = posix.dirname(owner || '.')
        target = posix.join(owner, 'node_modules', dependency)
      }
      assert.ok(target in shrinkwrap.packages, `${dependency} is in the locked tree`)
      const paths = createRequire(join(actualPath, 'package.json')).resolve.paths(dependency) ?? []
      const directory = paths
        .map(path => join(path, dependency))
        .find(path => existsSync(join(path, 'package.json')))
      assert.ok(directory, `${dependency} is installed`)
      verifyTree(target, directory)
    }
  }
  verifyTree('', npmInstalled)
  assert.equal(
    verified.size,
    Object.keys(shrinkwrap.packages).length,
    'checks the complete production tree'
  )
  const npmUses = JSON.parse(
    run(
      join(npmRepository, 'node_modules', '.bin', 'galactica'),
      ['uses', 'src/a.ts', '--root', repository, '--json'],
      npmRepository
    )
  ) as Output
  assert.ok('modules' in npmUses)
  assert.deepEqual(
    npmUses.modules.map(module => module.path),
    ['src/App.vue', 'src/Card.svelte', 'src/main.ts']
  )

  assert.equal(galactica('--version'), version)

  const uses = json('uses', 'src/a.ts')
  assert.ok('modules' in uses)
  assert.deepEqual(
    uses.modules.map(module => module.path),
    ['src/App.vue', 'src/Card.svelte', 'src/main.ts'],
    'TypeScript, vue and svelte load from the installed package'
  )

  assert.deepEqual(galactica('init').split('\n'), [
    'created .agents/skills/galactica/SKILL.md',
    'created .claude/skills/galactica/SKILL.md',
    'created .cursor/rules/galactica.mdc'
  ])
  const skill = readFileSync(join(repository, '.agents/skills/galactica/SKILL.md'), 'utf8')
  assert.match(skill, /`npx @cognitap\/galactica overview`/)
  assert.ok(skill.includes(`galactica-version: "${version}"`), 'stamps the package version')

  assert.match(galactica('html'), /^wrote .*galactica\.html \(\d+ KB\)$/)
  const page = readFileSync(join(repository, 'galactica.html'), 'utf8')
  assert.match(page, /<style>/, 'inlines the page stylesheet')
  assert.match(page, /src\/Card\.svelte/)

  console.log(`${name}@${version} from ${archive} installs and runs`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
