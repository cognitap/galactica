import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import type { TestContext } from 'node:test'
import { gitEnvironment } from '../src/repository-files.ts'

/** File path to its text, or to a value written as JSON. */
export type Files = Readonly<Record<string, string | object>>

/** A temporary directory holding `files`, removed after the test. */
export function repository(t: TestContext, files: Files): string {
  const root = mkdtempSync(join(tmpdir(), 'galactica-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    writeFileSync(join(root, path), text)
  }
  return root
}

export function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, env: gitEnvironment(), stdio: 'ignore' })
}

export function gitRepository(t: TestContext, files: Files): string {
  const root = repository(t, files)
  git(root, 'init', '--quiet')
  return root
}

/** A repository and a folder outside it holding `outside.txt`, which a link in the repository can point at. */
export function besideOutside(t: TestContext) {
  const root = repository(t, { 'package.json': {}, 'src/a.ts': 'export const a = 1' })
  const outside = repository(t, { 'outside.txt': 'Not Galactica.\n' })
  return { root, outside, untouched: () => filesUnder(outside).join() === 'outside.txt' }
}

export function link(root: string, path: string, target: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  symlinkSync(target, join(root, path))
}

export function filesUnder(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
    .sort()
}
