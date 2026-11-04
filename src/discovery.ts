/**
 * The modules of a repository and the compiler settings for each, read once per
 * run before any file is parsed.
 */

import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type ts from 'typescript'
import { compilerSettings, defaultCompilerOptions, type Warning } from './compiler-settings.ts'
import type { Language, ModuleKind } from './contract.ts'
import { parseRepoPath, type Model, type PackageName, type RepoPath } from './model.ts'
import { repositoryFiles } from './repository-files.ts'
import { kindOf, languageOf } from './source-file.ts'

export type { Warning } from './compiler-settings.ts'

export interface DiscoveredModule {
  readonly path: RepoPath
  readonly language: Language
  readonly kind: ModuleKind
  /** The tsconfig that applies, or null when none claims the module and the defaults apply. */
  readonly config: RepoPath | null
}

export interface Discovery {
  /** The absolute directory that module paths are relative to. */
  readonly root: string
  readonly repository: Model['repository']
  /** The whole repository as one package, until workspaces are read. */
  readonly packages: Model['packages']
  /** Sorted by path. */
  readonly modules: readonly DiscoveredModule[]
  /** Every config a module uses, by path. */
  readonly configs: ReadonlyMap<RepoPath, ts.ParsedCommandLine>
  /** Sorted by path, then message. */
  readonly warnings: readonly Warning[]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function rootPackageName(root: string, warnings: Warning[]): string {
  try {
    const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (typeof name === 'string' && name !== '') return name
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push({ path: parseRepoPath('package.json'), message: String(error) })
    }
  }
  return basename(root)
}

export function discover(rootDir: string): Discovery {
  const root = resolve(rootDir)
  const settings = compilerSettings(root)
  const candidates = repositoryFiles(root).flatMap(path => {
    const language = languageOf(path)
    if (!language) return []
    const config = settings.configOf(join(root, path))
    return [{ path, language, kind: kindOf(path), config: config?.path ?? null }]
  })

  const outDirs = settings.configs().flatMap(({ outDir }) => (outDir ? [outDir] : []))
  const modules = candidates
    .filter(({ path }) => !outDirs.some(outDir => path.startsWith(`${outDir}/`)))
    .sort((a, b) => compare(a.path, b.path))

  const warnings = [...settings.warnings()]
  const name = rootPackageName(root, warnings)
  const used = new Set(modules.map(module => module.config))
  return {
    root,
    repository: { name },
    packages: { [name as PackageName]: { dir: '.' as RepoPath } },
    modules,
    configs: new Map(
      settings
        .configs()
        .filter(({ path }) => used.has(path))
        .map(({ path, parsed }) => [path, parsed])
    ),
    warnings: warnings.sort((a, b) => compare(a.path, b.path) || compare(a.message, b.message))
  }
}

export function compilerOptionsOf(
  discovery: Discovery,
  module: DiscoveredModule
): ts.CompilerOptions {
  return (module.config && discovery.configs.get(module.config)?.options) ?? defaultCompilerOptions
}
