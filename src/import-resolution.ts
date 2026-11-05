/**
 * Where an import specifier leads from a module: a module of the repository,
 * an external package, or nowhere. Workspace packages resolve to their source
 * first, and TypeScript's own module resolution decides the rest.
 */

import { isBuiltin } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import ts from 'typescript'
import type { Warning } from './compiler-settings.ts'
import { compilerOptionsOf, type DiscoveredModule, type Discovery } from './discovery.ts'
import { plainInputs, type Inputs } from './inputs.ts'
import { toRepoPath, type RepoPath, type Target } from './model.ts'
import { splitSpecifier, workspaceResolver } from './package-resolution.ts'

/** A repository file that is no module, such as a stylesheet or a declaration file. */
export interface OtherFile {
  readonly kind: 'file'
  readonly path: RepoPath
}

/** An `OtherFile` gets no edge, since it is no code dependency and the model has no target for it. */
export type Resolution = Target | OtherFile

export interface ImportResolver {
  /** The module format TypeScript implies for the module's file, which decides how its imports resolve. */
  readonly formatOf: (module: DiscoveredModule) => ts.ResolutionMode
  readonly resolve: (
    module: DiscoveredModule,
    specifier: string,
    mode: ts.ResolutionMode
  ) => Resolution
  /** From the workspace resolver, one per package and reason. */
  readonly warnings: () => readonly Warning[]
}

function memoized<T>(cache: Map<string, T>, compute: (key: string) => T): (key: string) => T {
  return key => {
    if (cache.has(key)) return cache.get(key)!
    const value = compute(key)
    cache.set(key, value)
    return value
  }
}

function moduleResolutionHost(root: string, inputs: Inputs): ts.ModuleResolutionHost {
  return {
    fileExists: memoized(new Map(), inputs.fileExists),
    directoryExists: memoized(new Map(), inputs.directoryExists),
    readFile: inputs.readFile,
    realpath: inputs.realpath,
    getDirectories: inputs.getDirectories,
    getCurrentDirectory: () => root,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
  }
}

const canonicalFileName = ts.sys.useCaseSensitiveFileNames
  ? (name: string) => name
  : (name: string) => name.toLowerCase()

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier)

const nodeModules = /[/\\]node_modules[/\\]((?:@[^/\\]+[/\\])?[^/\\]+)/g

/** The package a file under `node_modules` belongs to, the innermost one for nested installs. */
function packageOfFile(file: string): string | undefined {
  return [...file.matchAll(nodeModules)].at(-1)?.[1]?.replaceAll('\\', '/')
}

/** A `paths` pattern that matches the specifier, as TypeScript picks it: an exact key, else the longest prefix. */
function pathsMatch(
  paths: ts.MapLike<string[]>,
  specifier: string
): { readonly targets: readonly string[]; readonly star: string } | undefined {
  if (Object.hasOwn(paths, specifier)) return { targets: paths[specifier]!, star: '' }
  const matches = Object.keys(paths).flatMap(key => {
    const [prefix, suffix, ...more] = key.split('*')
    if (prefix === undefined || suffix === undefined || more.length > 0) return []
    const fits =
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
    return fits
      ? [{ prefix, key, star: specifier.slice(prefix.length, specifier.length - suffix.length) }]
      : []
  })
  const best = matches.sort((a, b) => b.prefix.length - a.prefix.length)[0]
  return best && { targets: paths[best.key]!, star: best.star }
}

/** The package a bare specifier names. A relative path, a package import or a `paths` alias names none. */
function packageNamed(specifier: string, options: ts.CompilerOptions): string | undefined {
  if (isRelative(specifier) || specifier.startsWith('#')) return undefined
  if (options.paths && pathsMatch(options.paths, specifier)) return undefined
  return splitSpecifier(specifier)?.name
}

/**
 * Resolves the imports of `discovery`'s modules. Keeps one TypeScript
 * resolution cache per config and remembers every file and directory lookup,
 * so each is made once per run.
 */
export function importResolver(
  discovery: Discovery,
  inputs: Inputs = plainInputs(ts.sys)
): ImportResolver {
  const { root } = discovery
  const modules: ReadonlySet<string> = new Set(discovery.modules.map(module => module.path))
  const workspace = workspaceResolver(discovery, inputs)
  const host = moduleResolutionHost(root, inputs)
  const caches = new Map<RepoPath | null, ts.ModuleResolutionCache>()

  function cacheOf(module: DiscoveredModule, options: ts.CompilerOptions) {
    const cached = caches.get(module.config)
    if (cached) return cached
    const cache = ts.createModuleResolutionCache(root, canonicalFileName, options)
    caches.set(module.config, cache)
    return cache
  }

  /** The repository file at an absolute path that exists, as a module when it is one. */
  function inRepository(file: string): Resolution | undefined {
    if (!isInside(root, file)) return undefined
    const path = toRepoPath(root, file)
    return modules.has(path) ? { kind: 'module', path } : { kind: 'file', path }
  }

  /** Where the specifier names a file by its exact path, through a relative path, `paths` or `baseUrl`. */
  function exactFiles(
    module: DiscoveredModule,
    specifier: string,
    options: ts.CompilerOptions
  ): readonly string[] {
    if (isRelative(specifier)) return [join(root, dirname(module.path), specifier)]
    const base = options.baseUrl ?? options.pathsBasePath
    if (typeof base !== 'string') return []
    const match = options.paths && pathsMatch(options.paths, specifier)
    const mapped = match
      ? match.targets.map(target => join(base, target.replace('*', match.star)))
      : []
    return options.baseUrl ? [...mapped, join(options.baseUrl, specifier)] : mapped
  }

  function unresolvedByTypeScript(
    module: DiscoveredModule,
    specifier: string,
    options: ts.CompilerOptions
  ): Resolution {
    const exact = exactFiles(module, specifier, options).find(file => host.fileExists(file))
    const found = exact && inRepository(exact)
    if (found) return found
    const name = packageNamed(specifier, options)
    return name ? { kind: 'external', name } : { kind: 'unresolved', specifier }
  }

  return {
    formatOf(module) {
      const options = compilerOptionsOf(discovery, module)
      const packageJsons = cacheOf(module, options).getPackageJsonInfoCache()
      return ts.getImpliedNodeFormatForFile(join(root, module.path), packageJsons, host, options)
    },
    resolve(module, specifier, mode) {
      const member = workspace.resolve(specifier)
      if (member) return member.kind === 'module' ? member : { kind: 'unresolved', specifier }
      if (isBuiltin(specifier)) {
        return { kind: 'external', name: `node:${specifier.replace(/^node:/, '').split('/')[0]}` }
      }
      const options = compilerOptionsOf(discovery, module)
      const { resolvedModule } = ts.resolveModuleName(
        specifier,
        join(root, module.path),
        options,
        host,
        cacheOf(module, options),
        undefined,
        mode
      )
      if (!resolvedModule) return unresolvedByTypeScript(module, specifier, options)
      const file = resolvedModule.resolvedFileName
      const external = resolvedModule.isExternalLibraryImport
        ? (packageNamed(specifier, options) ?? packageOfFile(file))
        : undefined
      if (external) return { kind: 'external', name: external }
      return inRepository(file) ?? { kind: 'unresolved', specifier }
    },
    warnings: () => workspace.warnings()
  }
}
