/**
 * Whether Galactica maps a repository to the same bytes wherever it runs. It
 * clones each repository twice, to folders of the same name under different
 * paths, and maps the clones from different directories, with a cold cache, a
 * warm cache and none, in different locales and time zones. It prints each
 * output that differs and exits 1 when any does. It runs no code of the
 * repositories and writes nothing into them.
 *
 * node scripts/determinism.ts [--subjects 10] <repository>...
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  deepestFolder,
  differences,
  outputsOf,
  places,
  rootFlag,
  type Conditions
} from '../tests/determinism.ts'

const { values, positionals } = parseArgs({
  options: { subjects: { type: 'string', default: '10' } },
  allowPositionals: true
})
const subjects = Number(values.subjects)

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    encoding: 'utf8'
  }).trim()

/** A clone of `source` at `target` with the same commit and the same origin, so the page links alike. */
function clone(source: string, target: string): void {
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', source, target], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  })
  git(target, 'remote', 'set-url', 'origin', git(source, 'remote', 'get-url', 'origin'))
}

let failed = false
const scratch = mkdtempSync(join(tmpdir(), 'galactica-determinism-'))
try {
  for (const source of positionals.map(path => resolve(path))) {
    const name = basename(source)
    const here = join(scratch, name)
    const a = join(here, 'a', name)
    const b = join(here, 'elsewhere', 'deeper', name)
    mkdirSync(join(a, '..'), { recursive: true })
    mkdirSync(join(b, '..'), { recursive: true })
    clone(source, a)
    clone(source, b)
    const sub = deepestFolder(a)
    const base: Conditions = {
      label: 'cold, from the root',
      cwd: a,
      flags: [],
      home: join(here, 'home-a'),
      place: places.plain
    }
    const runs: Conditions[] = [
      {
        ...base,
        label: 'warm, from the deepest folder',
        cwd: sub,
        flags: rootFlag(sub, a),
        place: places.far
      },
      {
        label: 'another clone at another path, no cache, from outside it',
        cwd: here,
        flags: ['--root', b, '--no-cache'],
        home: join(here, 'home-b'),
        place: places.other
      }
    ]
    const started = performance.now()
    const expected = await outputsOf(base, here, subjects)
    console.log(
      `${name}: ${Object.keys(expected).length} outputs, ${Math.round(performance.now() - started)} ms`
    )
    for (const conditions of runs) {
      const different = differences(expected, await outputsOf(conditions, here, subjects))
      const count = Object.keys(different).length
      console.log(`  ${conditions.label}: ${count === 0 ? 'identical' : `${count} differ`}`)
      for (const [key, difference] of Object.entries(different))
        console.log(`    ${key}: ${difference}`)
      failed ||= count > 0
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
process.exitCode = failed ? 1 : 0
