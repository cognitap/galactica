/**
 * The modules of a repository and the compiler settings for each, read once per
 * run before any file is parsed.
 */

import { basename, join, resolve } from 'node:path'
import type ts from 'typescript'
import { compilerSettings, defaultCompilerOptions, type Warning } from './compiler-settings.ts'
import type { Language, ModuleKind } from './contract.ts'
import { parseRepoPath, type Model, type PackageName, type RepoPath } from './model.ts'
import { repositoryFiles } from './repository-files.ts'
import { kindOf, languageOf } from './source-file.ts'
import { nameOf, packageOf, readJson, workspacePackages, workspacePatterns } from './workspace.ts'

export type { Warning } from './compiler-settings.ts'

export interface DiscoveredModule {
  readonly path: RepoPath
  readonly language: Language
  readonly kind: ModuleKind
  /** The tsconfig that applies, or null when none claims the module and the defaults apply. */
  readonly config: RepoPath | null
  readonly package: PackageName
}

export interface Discovery {
  /** The absolute directory that module paths are relative to. */
  readonly root: string
  readonly repository: Model['repository']
  /**
   * The workspace packages. The root is a package too when no workspace names
   * any, or when a module lies outside every workspace package.
   */
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

export function discover(rootDir: string): Discovery {
  const root = resolve(rootDir)
  const settings = compilerSettings(root)
  const files = repositoryFiles(root)
  const candidates = files.flatMap(path => {
    const language = languageOf(path)
    if (!language) return []
    const config = settings.configOf(join(root, path))
    return [{ path, language, kind: kindOf(path), config: config?.path ?? null }]
  })

  const outDirs = settings.configs().flatMap(({ outDir }) => (outDir ? [outDir] : []))
  const warnings = [...settings.warnings()]
  const manifest = readJson(root, parseRepoPath('package.json'), warnings)
  const name = nameOf(manifest) ?? (basename(root) as PackageName)
  const patterns = workspacePatterns(root, manifest, warnings)
  const members = patterns ? workspacePackages(root, files, patterns, warnings) : []
  const memberDirs: Model['packages'] = Object.fromEntries(
    members.map(member => [member.name, { dir: member.dir }])
  )

  const owned = candidates
    .filter(({ path }) => !outDirs.some(outDir => path.startsWith(`${outDir}/`)))
    .map(module => ({ ...module, package: packageOf(memberDirs, module.path) }))
    .sort((a, b) => compare(a.path, b.path))
  const rootIsPackage = members.length === 0 || owned.some(module => !module.package)
  const packages: Model['packages'] = Object.fromEntries(
    [...members, ...(rootIsPackage ? [{ name, dir: '.' as RepoPath }] : [])]
      .sort((a, b) => compare(a.name, b.name))
      .map(member => [member.name, { dir: member.dir }])
  )
  const modules = owned.map(module => ({ ...module, package: module.package ?? name }))

  const used = new Set(modules.map(module => module.config))
  return {
    root,
    repository: { name },
    packages,
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
