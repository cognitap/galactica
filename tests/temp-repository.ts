import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'

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
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

export function gitRepository(t: TestContext, files: Files): string {
  const root = repository(t, files)
  git(root, 'init', '--quiet')
  return root
}
