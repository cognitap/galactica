/**
 * The agent skill `galactica init` installs, and how it installs it without
 * overwriting an edit. Each written file records a hash of what Galactica
 * wrote, so a later run can tell an untouched file from an edited one.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The command the template names, so the template works as is when the skills CLI copies it. */
export const defaultCommand = 'npx @cognitap/galactica'

/** Codex and Cursor read `.agents/skills`, Claude Code reads `.claude/skills`. */
export const skillPaths = [
  '.agents/skills/galactica/SKILL.md',
  '.claude/skills/galactica/SKILL.md'
] as const

export const skillTemplate = (): string =>
  readFileSync(new URL('../skills/galactica/SKILL.md', import.meta.url), 'utf8')

export interface SkillSource {
  readonly template: string
  readonly command: string
  readonly version: string
}

const hashLine = /^ {2}galactica-hash: "([0-9a-f]{64})"\n/m

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The template with `command` in place of the default, and frontmatter
 * metadata giving the Galactica version and the hash of the file without
 * its hash line.
 */
export function skillFile({ template, command, version }: SkillSource): string {
  const text = template.replaceAll(defaultCommand, () => command)
  const end = text.indexOf('\n---\n')
  const versioned = `${text.slice(0, end)}\nmetadata:\n  galactica-version: "${version}"`
  const rest = text.slice(end)
  return `${versioned}\n  galactica-hash: "${hashOf(versioned + rest)}"${rest}`
}

/** Whether the file is exactly what some version of Galactica wrote. */
function isUnedited(text: string): boolean {
  const hash = hashLine.exec(text)?.[1]
  return hash !== undefined && hashOf(text.replace(hashLine, '')) === hash
}

export type InstallStatus = 'created' | 'updated' | 'unchanged' | 'kept'

export interface Installed {
  /** Relative to the root. */
  readonly path: string
  readonly status: InstallStatus
}

function statusOf(current: string | undefined, file: string, force: boolean): InstallStatus {
  if (current === undefined) return 'created'
  if (current === file) return 'unchanged'
  return force || isUnedited(current) ? 'updated' : 'kept'
}

/** Writes `file` to each skill path under `root`, keeping an edited file unless `force`. */
export function installSkill(root: string, file: string, force: boolean): readonly Installed[] {
  return skillPaths.map(path => {
    const target = join(root, path)
    const status = statusOf(
      existsSync(target) ? readFileSync(target, 'utf8') : undefined,
      file,
      force
    )
    if (status === 'created' || status === 'updated') {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file)
    }
    return { path, status }
  })
}
