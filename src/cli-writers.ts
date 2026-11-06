/** HTML writing and agent installation, after command-line validation. */

import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { HtmlInput, InitInput } from './cli-input.ts'
import type { Repository } from './commands.ts'
import { SCHEMA_VERSION, type WriterOutput } from './contract.ts'
import { pageSourceOf } from './git-source.ts'
import { htmlOf } from './html.ts'
import { isBelow } from './paths.ts'
import { SymlinkRefused, writeBelow } from './safe-write.ts'
import { agentFiles, installSkill, skillTemplate } from './skill.ts'

type Written =
  | { readonly problem: string }
  | {
      readonly code: number
      readonly message: string
      readonly output: WriterOutput
    }

/** The refusal in one line, with paths from the current directory. */
function refusal({ target, link }: SymlinkRefused, cwd: string): { readonly problem: string } {
  const shown = relative(cwd, target)
  const why = link === target ? 'it is' : `${relative(cwd, link)} is`
  return { problem: `refused to write ${shown}: ${why} a symbolic link` }
}

function openInBrowser(path: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
  child.on('error', error => console.error(`galactica: could not open ${path}: ${error.message}`))
  child.unref()
}

/** Writes the HTML page and records its machine-readable result. */
export function writeHtml(input: HtmlInput, repository: Repository, cwd: string): Written {
  const { root, sourceUrl: flag } = input
  const template = flag ?? repository.config.sourceUrl
  const out = resolve(cwd, input.out ?? 'galactica.html')
  const source = template === 'none' ? null : (pageSourceOf(root, template) ?? null)
  const page = htmlOf(repository.graph, source, repository.config.health?.areaModules)
  try {
    writeBelow(isBelow(root, out) ? root : dirname(out), [{ path: out, text: page }])
  } catch (error) {
    if (error instanceof SymlinkRefused) return refusal(error, cwd)
    return { problem: `could not write ${out}: ${(error as Error).message}` }
  }
  if (input.open) openInBrowser(out)
  const size = Math.round(Buffer.byteLength(page) / 1024)
  const shown = input.out !== undefined && isAbsolute(input.out) ? out : relative(cwd, out)
  const hint =
    input.out === undefined
      ? '\nUse --out <file> to write elsewhere, or add galactica.html to .gitignore.'
      : ''
  return {
    code: 0,
    message: `wrote ${shown} (${size.toLocaleString('en')} KB)${hint}`,
    output: {
      schemaVersion: SCHEMA_VERSION,
      command: 'html',
      path: out,
      bytes: Buffer.byteLength(page)
    }
  }
}

/**
 * Installs the agent skill. Agents run it unattended, so an edited file is
 * reported rather than asked about, and it fails only when every file was kept.
 */
export function installAgents(input: InitInput, cwd: string, version: string): Written {
  const { root, skillCommand: command } = input
  const files = agentFiles({ template: skillTemplate(), command, version })
  let installed
  try {
    installed = installSkill(root, files, input.force)
  } catch (error) {
    if (error instanceof SymlinkRefused) return refusal(error, cwd)
    return { problem: `could not install the skill: ${(error as Error).message}` }
  }
  const lines = installed.map(({ path, status }) => {
    const shown = relative(cwd, join(root, path))
    return status === 'kept'
      ? `kept ${shown}: edited since galactica wrote it, --force overwrites it`
      : `${status} ${shown}`
  })
  const allKept = installed.every(({ status }) => status === 'kept')
  return {
    code: allKept ? 1 : 0,
    message: lines.join('\n'),
    output: { schemaVersion: SCHEMA_VERSION, command: 'init', files: installed }
  }
}
