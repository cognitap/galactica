/**
 * Prepares a release candidate from a clean checkout: checks the version and
 * its notes, builds and packs once, runs scripts/pack-and-test.ts on that
 * archive and dry-runs its publication. Writes `release/galactica.tgz` and the
 * `release/release.json` receipt with the version, source commit and SHA-512
 * integrity that the release workflow checks npm against.
 *
 * pnpm release:prepare
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, 'release')
const archive = join(directory, 'galactica.tgz')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  version: string
  private?: boolean
}
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const { version } = manifest
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })

run(process.execPath, ['scripts/shrinkwrap.ts', '--check'])

rmSync(directory, { recursive: true, force: true })

assert.match(
  version,
  /^0\.\d+\.\d+$/,
  'Only experimental 0.x releases are enabled. 1.0.0 needs a reviewed change once the command output, the config and the skill are stable.'
)
const notes = changelog.split(/^## /m).find(section => section.startsWith(`${version}\n`))
assert.ok(notes?.slice(version.length).trim(), `Add CHANGELOG.md notes under ## ${version}.`)
if (process.env.RELEASE_PUBLISH === 'true') {
  assert.ok(!manifest.private, 'Remove private from package.json before publishing.')
}
assert.equal(git('status', '--porcelain'), '', 'Commit all changes before preparing a release.')

run('pnpm', ['build'])
mkdirSync(directory, { recursive: true })
run('pnpm', ['pack', '--out', archive])
run(process.execPath, ['scripts/pack-and-test.ts', archive])
run('pnpm', ['publish', archive, '--dry-run', '--no-git-checks', '--ignore-scripts'])

const receipt = {
  version,
  sourceCommit: git('rev-parse', 'HEAD'),
  integrity: `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`
}
writeFileSync(join(directory, 'release.json'), `${JSON.stringify(receipt, null, 2)}\n`)
console.log(`Prepared ${manifest.name}@${version} from ${receipt.sourceCommit} in ${directory}`)
