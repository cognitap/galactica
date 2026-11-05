import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import ts from 'typescript'
import { analyzeRepository } from '../src/analysis.ts'
import { loadConfig } from '../src/config.ts'
import { plainInputs, type Inputs } from '../src/inputs.ts'
import { fixtureCases, fixtureRepo } from './fixtures.ts'
import {
  committedCopy,
  copy,
  deepestFolder,
  differences,
  outputsOf,
  places,
  rootFlag,
  type Conditions
} from './determinism.ts'

const scratch = mkdtempSync(join(tmpdir(), 'galactica-determinism-'))
after(() => rmSync(scratch, { recursive: true, force: true }))
const subjects = 2
/** Workspace packages, barrels, an import cycle, tests and stories, and a framework compiler. */
const representative = ['monorepo', 'barrels', 'cycle', 'tests-and-stories', 'vue']

/**
 * Each fixture maps to the same bytes from its root with a cold cache, warm
 * from its deepest folder, and with no cache from outside a copy at another
 * path whose files were written in reverse, each in its own locale and time
 * zone. Mapping every fixture this way takes over a minute of CPU, so it maps
 * the representative ones, and the commands ask about the two most imported
 * packages, areas and modules of each; the page and `overview --all` hold
 * every module. `node scripts/determinism.ts` checks any repository in full.
 */
describe('mapping a fixture twice', { concurrency: true }, () => {
  for (const name of representative) {
    test(`${name} gives the same bytes wherever and however it runs`, async () => {
      const here = join(scratch, name)
      const a = join(here, 'a', 'repo')
      const b = join(here, 'elsewhere', 'deeper', 'repo')
      mkdirSync(a, { recursive: true })
      mkdirSync(b, { recursive: true })
      const commit = committedCopy(fixtureRepo(name), a, 'sorted')
      assert.equal(committedCopy(fixtureRepo(name), b, 'reversed'), commit)
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
          label: 'a copy at another path, written in reverse, no cache, from outside it',
          cwd: here,
          flags: ['--root', b, '--no-cache'],
          home: join(here, 'home-b'),
          place: places.other
        }
      ]
      const expected = await outputsOf(base, here, subjects)
      assert.match(expected.html!, /^0\n\n<!doctype html>/)
      assert.match(expected.html!, new RegExp(`/blob/${commit}/`))
      for (const conditions of runs) {
        const actual = await outputsOf(conditions, here, subjects)
        assert.deepEqual(differences(expected, actual), {}, conditions.label)
      }
    })
  }
})

/** The machine with every directory listing, and git's, in reverse. */
const reversed = (inputs: Inputs): Inputs => ({
  ...inputs,
  getDirectories: path => inputs.getDirectories(path).toReversed(),
  readdir: path => inputs.readdir(path).toReversed(),
  gitListing: root =>
    inputs
      .gitListing(root)
      ?.split('\0')
      .filter(path => path !== '')
      .toReversed()
      .map(path => `${path}\0`)
      .join('')
})

/** The model and summary as bytes, without the durations, which are the one thing a run may change. */
function analyzedBytes(root: string, inputs: Inputs): string {
  const { model, summary } = analyzeRepository(root, loadConfig(root), { inputs })
  return JSON.stringify({ model, summary: { ...summary, durations: undefined } })
}

test('every fixture analyzes to the same bytes whatever order the file system lists it in', () => {
  for (const name of fixtureCases()) {
    const walked = join(scratch, 'walked', name)
    copy(fixtureRepo(name), walked, 'reversed')
    for (const root of [fixtureRepo(name), walked]) {
      const plain = plainInputs(ts.sys)
      assert.equal(analyzedBytes(root, reversed(plain)), analyzedBytes(root, plain), root)
    }
  }
})
