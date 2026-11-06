/**
 * The modules of a repository and the compiler settings for each, read once per
 * run before any file is parsed.
 */

import { basename, dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import {
  compilerSettings,
  defaultCompilerOptions,
  type Build,
  type Warning
} from './compiler-settings.ts'
import type { Language, ModuleKind } from './contract.ts'
import { globProblem, matchesGlob } from './glob.ts'
import type { Inputs } from './inputs.ts'
import {
  compare,
  parseRepoPath,
  toRepoPath,
  type Config,
  type Model,
  type PackageName,
  type RepoPath
} from './model.ts'
import { repositoryFiles } from './repository-files.ts'
import { kindOf, languageOf } from './source-file.ts'
import { nameOf, packageOf, readJson, workspacePackages, workspacePatterns } from './workspace.ts'

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
  /**
   * The builds of every config read, the `tsconfig*.json` files in each package
   * directory included, as a package's build config often owns no module.
   */
  readonly builds: readonly Build[]
  /** Sorted by path, then message. */
  readonly warnings: readonly Warning[]
}

/** Whether the config's `include` and `exclude` keep the module at `path`. */
function selected(path: RepoPath, { include, exclude }: Config): boolean {
  const matches = (glob: string) => matchesGlob(path, glob)
  return (include === undefined || include.some(matches)) && !exclude.some(matches)
}

export function discover(rootDir: string, config: Config, inputs: Inputs): Discovery {
  const root = resolve(rootDir)
  const files = repositoryFiles(root, inputs)
  const settings = compilerSettings(root, files, inputs)
  const candidates = files.flatMap(path => {
    const language = languageOf(path)
    if (!language || !selected(path, config)) return []
    const tsconfig = settings.configOf(join(root, path))
    return [{ path, language, kind: kindOf(path, config), config: tsconfig?.path ?? null }]
  })

  const warnings: Warning[] = []
  const configGlobs: readonly (readonly [string, string])[] = [
    ...(config.include ?? []).map((glob, index) => [`include[${index}]`, glob] as const),
    ...config.exclude.map((glob, index) => [`exclude[${index}]`, glob] as const),
    ...Object.entries(config.kinds).flatMap(([kind, globs]) =>
      globs.map((glob, index) => [`kinds.${kind}[${index}]`, glob] as const)
    ),
    ...config.areas.map(({ glob }) => [`areas[${JSON.stringify(glob)}]`, glob] as const)
  ]
  for (const [key, glob] of configGlobs) {
    const problem = globProblem(glob)
    if (problem)
      warnings.push({ path: parseRepoPath('galactica.config.json'), message: `${key}: ${problem}` })
  }
  const manifest = readJson(inputs, root, parseRepoPath('package.json'), warnings)
  const name = nameOf(manifest) ?? (basename(root) as PackageName)
  const patterns = workspacePatterns(inputs, root, manifest, warnings)
  const members = patterns ? workspacePackages(inputs, root, files, patterns, warnings) : []
  const packageDirs = new Set<string>(['.', ...members.map(member => member.dir)])
  for (const path of files) {
    if (/^tsconfig.*\.json$/.test(basename(path)) && packageDirs.has(dirname(path))) {
      settings.configAt(join(root, path))
    }
  }
  const builds = settings.configs().flatMap(({ build }) => (build ? [build] : []))
  const outDirs = builds.map(({ outDir }) => toRepoPath(root, outDir))
  warnings.push(...settings.warnings())
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
    builds,
    warnings: warnings.sort((a, b) => compare(a.path, b.path) || compare(a.message, b.message))
  }
}

export function compilerOptionsOf(
  discovery: Discovery,
  module: DiscoveredModule
): ts.CompilerOptions {
  return (module.config && discovery.configs.get(module.config)?.options) ?? defaultCompilerOptions
}
