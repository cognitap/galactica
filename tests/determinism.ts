/**
 * Maps one commit under conditions that must not change the output, and
 * reports every output that differs: the commands in text and `--json`, and
 * the HTML page.
 */

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { gitEnvironment } from '../src/repository-files.ts'

const child = new URL('determinism-outputs.ts', import.meta.url).pathname

/** The locale and time zone of a run, which must not reach the output. */
export const places = {
  plain: { LANG: 'C', TZ: 'UTC' },
  far: { LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8', TZ: 'Pacific/Kiritimati' },
  other: { LANG: 'de_DE.UTF-8', LC_ALL: 'ja_JP.UTF-8', TZ: 'America/St_Johns' }
} as const

export interface Conditions {
  readonly label: string
  /** Where the command runs. */
  readonly cwd: string
  /** Passed to every command, such as `--root` or `--no-cache`. */
  readonly flags: readonly string[]
  /** The user's home, which holds the cache of a repository without node_modules. */
  readonly home: string
  readonly place: Readonly<Record<string, string>>
}

/** Each output by command line, with `html` for the page. */
export type Outputs = Readonly<Record<string, string>>

const locales = /^(LANG|LANGUAGE|LC_\w+|TZ)$/

/** What every command answers under `conditions`, asking about at most `subjects` of each kind. */
export async function outputsOf(
  conditions: Conditions,
  scratch: string,
  subjects = Infinity
): Promise<Outputs> {
  const inherited = Object.entries(process.env).filter(([name]) => !locales.test(name))
  const { home } = conditions
  const env = {
    ...Object.fromEntries(inherited),
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    ...conditions.place
  }
  const page = join(mkdtempSync(join(scratch, 'page-')), 'galactica.html')
  const cap = subjects === Infinity ? 'all' : String(subjects)
  const { stdout } = await promisify(execFile)('node', [child, page, cap, ...conditions.flags], {
    cwd: conditions.cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 1 << 30
  })
  return JSON.parse(stdout)
}

/** The first differing line of each output that differs, keyed by command line. */
export function differences(expected: Outputs, actual: Outputs): Record<string, string> {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
  return Object.fromEntries(
    keys.flatMap(key => {
      const a = expected[key]?.split('\n') ?? []
      const b = actual[key]?.split('\n') ?? []
      if (a.join('\n') === b.join('\n')) return []
      const line = a.findIndex((text, index) => text !== b[index])
      const at = line === -1 ? a.length : line
      const clip = (text: string | undefined) => (text ?? '<missing>').slice(0, 300)
      return [[key, `line ${at + 1}: ${clip(a[at])} !== ${clip(b[at])}`]]
    })
  )
}

/** Every file under `dir` but `.git`, relative to it, sorted. */
export function filesOf(dir: string, prefix = ''): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap(entry => {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) return entry.name === '.git' ? [] : filesOf(dir, path)
      return entry.isFile() ? [path] : []
    })
    .sort()
}

const fixedGit = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'galactica',
  GIT_AUTHOR_EMAIL: 'galactica@example.com',
  GIT_COMMITTER_NAME: 'galactica',
  GIT_COMMITTER_EMAIL: 'galactica@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z'
}

function git(root: string, ...args: string[]): string {
  const env = { ...gitEnvironment(), ...fixedGit }
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim()
}

type Order = 'sorted' | 'reversed'

/** A copy of the files of `source` at `target`, written in `order`. */
export function copy(source: string, target: string, order: Order): void {
  const files = filesOf(source)
  for (const path of order === 'sorted' ? files : files.toReversed()) {
    mkdirSync(join(target, path, '..'), { recursive: true })
    writeFileSync(join(target, path), readFileSync(join(source, path)))
  }
}

/**
 * A copy of the files of `source` at `target`, written in `order`, committed
 * with a fixed author and date so every copy has the same commit, and pushed
 * nowhere but recorded as on a GitHub remote, so the page links to source.
 */
export function committedCopy(source: string, target: string, order: Order) {
  copy(source, target, order)
  git(target, 'init', '--quiet', '--initial-branch=main')
  git(target, 'add', '--all')
  git(target, 'commit', '--quiet', '--allow-empty', '-m', 'fixture')
  git(target, 'remote', 'add', 'origin', 'https://github.com/cognitap/fixture.git')
  git(target, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return git(target, 'rev-parse', 'HEAD')
}

/** The deepest folder that holds a file, so a run from it sits as far from the root as it can. */
export function deepestFolder(root: string): string {
  const folders = filesOf(root).map(path => path.split('/').slice(0, -1).join('/'))
  const deepest = folders.reduce((a, b) => (b.split('/').length > a.split('/').length ? b : a), '')
  return join(root, deepest)
}

/** `--root` as a run from `cwd` would write it, relative where it can be. */
export const rootFlag = (cwd: string, root: string) => ['--root', relative(cwd, root) || '.']
