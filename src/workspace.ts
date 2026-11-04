/**
 * Which packages a workspace names, and which package a path belongs to. The
 * workspace is the `packages` of `pnpm-workspace.yaml`, else the root
 * package.json `workspaces` field that npm, Yarn and Bun read.
 */

import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { Warning } from './compiler-settings.ts'
import { parseRepoPath, type Model, type PackageName, type RepoPath } from './model.ts'

/** Globs over package directories. A leading `!` excludes. */
export type WorkspacePatterns = readonly string[]

export interface WorkspacePackage {
  readonly name: PackageName
  readonly dir: RepoPath
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** A JSON file's value, undefined when it is absent, and a warning when it does not parse. */
export function readJson(root: string, path: RepoPath, warnings: Warning[]): unknown {
  const text = readText(join(root, path))
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    warnings.push({ path, message: String(error) })
    return undefined
  }
}

function withoutComment(line: string): string {
  let quote: string | undefined
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (quote) {
      if (char === quote) quote = undefined
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]!))) {
      return line.slice(0, index)
    }
  }
  return line
}

function scalar(raw: string): string {
  const text = raw.trim()
  const single = /^'((?:[^']|'')*)'$/.exec(text)
  if (single) return single[1]!.replaceAll("''", "'")
  const double = /^"([^"\\]*)"$/.exec(text)
  if (double) return double[1]!
  if (text === '' || /^[-'"[\]{},&*!|>%@`]|[{}[\],]|: /.test(text)) {
    throw new Error(`unsupported value ${JSON.stringify(text)}`)
  }
  return text
}

function flowSequence(text: string): WorkspacePatterns {
  const inner = /^\[(.*)\]$/s.exec(text.trim())
  if (!inner) throw new Error('a flow sequence must close with ]')
  const items = inner[1]!.split(',').map(item => item.trim())
  if (items.at(-1) === '') items.pop()
  return items.map(scalar)
}

/**
 * The `packages` sequence of a pnpm-workspace.yaml, as a block or flow
 * sequence of plain or quoted strings. Undefined when the key is absent.
 * Throws on any other value.
 */
export function pnpmWorkspacePatterns(text: string): WorkspacePatterns | undefined {
  const lines = text.split(/\r?\n/).map(withoutComment)
  const start = lines.findIndex(line => /^packages\s*:/.test(line))
  if (start === -1) return undefined
  const inline = lines[start]!.replace(/^packages\s*:/, '').trim()
  const rest = lines.slice(start + 1)
  if (inline.startsWith('[')) {
    const end = [inline, ...rest].findIndex(line => line.includes(']'))
    return flowSequence([inline, ...rest].slice(0, end + 1).join(' '))
  }
  if (inline !== '') throw new Error('packages must be a sequence')
  const patterns: string[] = []
  for (const line of rest) {
    if (line.trim() === '') continue
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item) patterns.push(scalar(item[1]!))
    else if (/^\s/.test(line)) throw new Error('packages must be a sequence of strings')
    else break
  }
  return patterns
}

function workspacesField(manifest: unknown): unknown {
  if (typeof manifest !== 'object' || manifest === null || !('workspaces' in manifest)) {
    return undefined
  }
  const { workspaces } = manifest
  if (typeof workspaces === 'object' && workspaces !== null && 'packages' in workspaces) {
    return workspaces.packages
  }
  return workspaces
}

/** The first workspace source that names packages, or undefined in a single-package repository. */
export function workspacePatterns(
  root: string,
  manifest: unknown,
  warnings: Warning[]
): WorkspacePatterns | undefined {
  const yamlPath = parseRepoPath('pnpm-workspace.yaml')
  const yaml = readText(join(root, yamlPath))
  if (yaml !== undefined) {
    try {
      const patterns = pnpmWorkspacePatterns(yaml)
      if (patterns) return patterns
    } catch (error) {
      warnings.push({ path: yamlPath, message: `packages: ${(error as Error).message}` })
    }
  }
  const field = workspacesField(manifest)
  if (field === undefined) return undefined
  if (Array.isArray(field) && field.every(pattern => typeof pattern === 'string')) return field
  warnings.push({
    path: parseRepoPath('package.json'),
    message: 'workspaces must be a list of strings, or { "packages": [...] }'
  })
  return undefined
}

function normalizePattern(pattern: string): string {
  return posix.normalize(pattern).replace(/\/$/, '')
}

/**
 * The directories among `files` that hold a package.json the patterns match,
 * as packages named by that package.json. Sorted by name.
 */
export function workspacePackages(
  root: string,
  files: readonly RepoPath[],
  patterns: WorkspacePatterns,
  warnings: Warning[]
): readonly WorkspacePackage[] {
  const included = patterns.filter(pattern => !pattern.startsWith('!')).map(normalizePattern)
  const excluded = patterns
    .filter(pattern => pattern.startsWith('!'))
    .map(pattern => normalizePattern(pattern.slice(1)))
  const matches = (dir: string) => (pattern: string) => posix.matchesGlob(dir, pattern)
  const dirs = files
    .filter(path => path.endsWith('/package.json'))
    .map(path => path.slice(0, -'/package.json'.length) as RepoPath)
    .filter(dir => included.some(matches(dir)) && !excluded.some(matches(dir)))
    .sort()

  const byName = new Map<PackageName, WorkspacePackage>()
  for (const dir of dirs) {
    const path = parseRepoPath(`${dir}/package.json`)
    const manifest = readJson(root, path, warnings)
    const name = nameOf(manifest)
    if (name === undefined) {
      if (manifest !== undefined) {
        warnings.push({ path, message: 'a workspace package without a name is skipped' })
      }
      continue
    }
    const first = byName.get(name)
    if (first) {
      warnings.push({ path, message: `${name} is also the name of ${first.dir}, which keeps it` })
      continue
    }
    byName.set(name, { name, dir })
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** The `name` of a package.json value, when it is a non-empty string. */
export function nameOf(manifest: unknown): PackageName | undefined {
  if (typeof manifest !== 'object' || manifest === null || !('name' in manifest)) return undefined
  const { name } = manifest
  return typeof name === 'string' && name !== '' ? (name as PackageName) : undefined
}

/** The package whose `dir` is the longest prefix of `path`. The root package, at ".", contains every path. */
export function packageOf(packages: Model['packages'], path: RepoPath): PackageName | undefined {
  let owner: PackageName | undefined
  let depth = -1
  for (const [name, { dir }] of Object.entries(packages) as [PackageName, { dir: RepoPath }][]) {
    const length = dir === '.' ? 0 : dir.length
    const contains = dir === '.' || path === dir || path.startsWith(`${dir}/`)
    if (contains && length > depth) {
      owner = name
      depth = length
    }
  }
  return owner
}
