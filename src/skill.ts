/**
 * The agent skill `galactica init` installs, and how it installs it without
 * overwriting an edit. Each written file records a hash of what Galactica
 * wrote, so a later run can tell an untouched file from an edited one.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './model.ts'
import { readRepositoryFile } from './safe-read.ts'
import { refuseLinks, writeBelow } from './safe-write.ts'

/**
 * The command the template names, so the template works as is when the skills
 * CLI copies it. Inside a repository, npx runs a copy of the package from the
 * repository's `node_modules` and reads its `.npmrc`. `--prefix /` makes npm
 * look in `/` for both, so a repository being mapped cannot plant either.
 */
export const defaultCommand = 'npx --prefix / @cognitap/galactica'

/** Codex reads `.agents/skills`, Claude Code reads `.claude/skills`. */
export const skillPaths = [
  '.agents/skills/galactica/SKILL.md',
  '.claude/skills/galactica/SKILL.md'
] as const

/**
 * Cursor's agent did not open the skill from `.agents/skills` or
 * `.cursor/skills` in testing, but did open it when a rule pointed to it.
 */
export const rulePath = '.cursor/rules/galactica.mdc'

export const skillTemplate = (): string =>
  readFileSync(new URL('../skills/galactica/SKILL.md', import.meta.url), 'utf8')

export interface SkillSource {
  readonly template: string
  readonly command: string
  readonly version: string
}

const hashLine = /^ {2}galactica-hash: "([0-9a-f]{64})"\n/m

/** The template with `command` in place of the default, stamped with the version and hash. */
export function skillFile({ template, command, version }: SkillSource): string {
  return stamped(
    template.replaceAll(defaultCommand, () => command),
    version
  )
}

/** A Cursor rule that Cursor's agent requests by the skill's description, and that sends it to the skill. */
export function ruleFile({ template, version }: SkillSource): string {
  const description = /^description: (.*)$/m.exec(template)![1]!
  return stamped(
    `---\ndescription: ${description}\nalwaysApply: false\n---\n\nRead \`${skillPaths[0]}\` and follow it.\n`,
    version
  )
}

/** `text` with frontmatter metadata giving the Galactica version and the hash of the file without its hash line. */
function stamped(text: string, version: string): string {
  const end = text.indexOf('\n---\n')
  const versioned = `${text.slice(0, end)}\nmetadata:\n  galactica-version: "${version}"`
  const rest = text.slice(end)
  return `${versioned}\n  galactica-hash: "${sha256(versioned + rest)}"${rest}`
}

interface AgentFile {
  /** Relative to the root. */
  readonly path: string
  readonly text: string
}

/** Every file `init` writes: the skill where each agent reads skills, and the Cursor rule. */
export const agentFiles = (source: SkillSource): readonly AgentFile[] => {
  const skill = skillFile(source)
  return [
    ...skillPaths.map(path => ({ path, text: skill })),
    { path: rulePath, text: ruleFile(source) }
  ]
}

/** Whether the file is exactly what some version of Galactica wrote. */
function isUnedited(text: string): boolean {
  const hash = hashLine.exec(text)?.[1]
  return hash !== undefined && sha256(text.replace(hashLine, '')) === hash
}

type InstallStatus = 'created' | 'updated' | 'unchanged' | 'kept'

interface Installed {
  /** Relative to the root. */
  readonly path: string
  readonly status: InstallStatus
}

function statusOf(current: string | undefined, file: string, force: boolean): InstallStatus {
  if (current === undefined) return 'created'
  if (current === file) return 'unchanged'
  return force || isUnedited(current) ? 'updated' : 'kept'
}

/**
 * Writes each file under `root`, keeping an edited file unless `force`. It
 * refuses a symbolic link on any path before it reads or writes, and writes
 * every changed file or none.
 */
export function installSkill(
  root: string,
  files: readonly AgentFile[],
  force: boolean
): readonly Installed[] {
  const targets = files.map(file => ({ ...file, target: join(root, file.path) }))
  for (const { target } of targets) refuseLinks(root, target)
  const installed = targets.map(({ path, text, target }) => ({
    path,
    text,
    target,
    status: statusOf(
      existsSync(target)
        ? readRepositoryFile(root, target, {
            fileExists: existsSync,
            readFile: file => readFileSync(file, 'utf8')
          })
        : undefined,
      text,
      force
    )
  }))
  writeBelow(
    root,
    installed
      .filter(({ status }) => status === 'created' || status === 'updated')
      .map(({ target, text }) => ({ path: target, text }))
  )
  return installed.map(({ path, status }) => ({ path, status }))
}
