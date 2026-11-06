/**
 * Where an import specifier leads from a module: a module of the repository,
 * an external package, or nowhere. A `paths` alias that leads to a module
 * wins, as it does for TypeScript. Workspace packages resolve to their source
 * next, and TypeScript's own module resolution decides the rest.
 */

import { isBuiltin } from 'node:module'
import { dirname, extname, join } from 'node:path'
import ts from 'typescript'
import { canonicalFileName, type Warning } from './compiler-settings.ts'
import { compilerOptionsOf, type DiscoveredModule, type Discovery } from './discovery.ts'
import type { Inputs } from './inputs.ts'
import { toRepoPath, type RepoPath, type Target } from './model.ts'
import {
  packageImports,
  sourceCandidates,
  splitSpecifier,
  starIn,
  workspaceResolver,
  type WorkspaceResolver
} from './package-resolution.ts'
import { isWithin } from './paths.ts'
import { missingFile, readProblem, readRepositoryFile } from './safe-read.ts'

/** A repository file that is no module, such as a stylesheet or a declaration file. */
interface OtherFile {
  readonly kind: 'file'
  readonly path: RepoPath
}

/** File kinds with no code dependency in the map. Other unmodeled files stay unresolved. */
const assetExtensions: ReadonlySet<string> = new Set([
  '.json',
  '.jsonc',
  '.map',
  '.webmanifest',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.styl',
  '.stylus',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.tif',
  '.tiff',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.mp4',
  '.webm',
  '.mov',
  '.wasm',
  '.node',
  '.html',
  '.htm',
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.tsv',
  '.graphql',
  '.gql',
  '.hbs',
  '.mustache',
  '.pdf',
  '.glsl',
  '.wgsl',
  '.vert',
  '.frag'
])

const knownFile = (path: string) =>
  /\.d\.[cm]?ts$/i.test(path) || assetExtensions.has(extname(path).toLowerCase())

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
  readonly workspace: WorkspaceResolver
}

function memoized<T>(cache: Map<string, T>, compute: (key: string) => T): (key: string) => T {
  return key => {
    if (cache.has(key)) return cache.get(key)!
    const value = compute(key)
    cache.set(key, value)
    return value
  }
}

function moduleResolutionHost(
  root: string,
  inputs: Inputs,
  warnings: Warning[]
): ts.ModuleResolutionHost {
  return {
    fileExists: memoized(new Map(), inputs.fileExists),
    directoryExists: memoized(new Map(), inputs.directoryExists),
    readFile(file) {
      try {
        return readRepositoryFile(root, file, inputs)
      } catch (error) {
        if (!missingFile(error) && isWithin(root, file))
          warnings.push({
            path: toRepoPath(root, file),
            message: readProblem(error, 'could not read file')
          })
        return undefined
      }
    },
    realpath: inputs.realpath,
    getDirectories: inputs.getDirectories,
    getCurrentDirectory: () => root,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
  }
}

export const isRelative = (specifier: string) => /^\.\.?(\/|$)/.test(specifier)

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
    const star = starIn(key, specifier)
    return star === undefined ? [] : [{ key, star }]
  })
  const best = matches.sort((a, b) => b.key.indexOf('*') - a.key.indexOf('*'))[0]
  return best && { targets: paths[best.key]!, star: best.star }
}

/** The npm package a bare specifier can name, including an alias whose targets do not exist. */
function packageNamed(specifier: string): string | undefined {
  if (isRelative(specifier) || specifier.startsWith('#')) return undefined
  return splitSpecifier(specifier)?.name
}

/**
 * Resolves the imports of `discovery`'s modules. Keeps one TypeScript
 * resolution cache per config and remembers every file and directory lookup,
 * so each is made once per run.
 */
export function importResolver(discovery: Discovery, inputs: Inputs): ImportResolver {
  const { root } = discovery
  const modules: ReadonlySet<string> = new Set(discovery.modules.map(module => module.path))
  const workspace = workspaceResolver(discovery, inputs)
  const readWarnings: Warning[] = []
  const importsOf = packageImports(root, inputs, readWarnings)
  const host = moduleResolutionHost(root, inputs, readWarnings)
  const caches = new Map<RepoPath | null, ts.ModuleResolutionCache>()

  function cacheOf(module: DiscoveredModule, options: ts.CompilerOptions) {
    const cached = caches.get(module.config)
    if (cached) return cached
    const cache = ts.createModuleResolutionCache(root, canonicalFileName, options)
    caches.set(module.config, cache)
    return cache
  }

  /** Canonical spellings are probed lazily, only when a path misses the discovered module list. */
  const realPath = memoized(new Map<string, string | undefined>(), file => {
    try {
      return canonicalFileName(inputs.realpath(file))
    } catch {
      return undefined
    }
  })
  let canonicalModules: ReadonlyMap<string, RepoPath> | undefined

  /**
   * The repository file at an absolute path that exists, as a module when it
   * is one. A file under `node_modules`, reached by a relative path such as
   * `../node_modules/pkg/Foo.astro`, belongs to its package.
   */
  function inRepository(file: string, specifier: string): Resolution | undefined {
    if (!isWithin(root, file)) return undefined
    const path = toRepoPath(root, file)
    const name = packageOfFile(`/${path}`)
    if (name) return { kind: 'external', name }
    if (modules.has(path)) return { kind: 'module', path }
    const actual = realPath(file)
    const realRoot = realPath(root)
    if (actual === undefined || realRoot === undefined || !isWithin(realRoot, actual))
      return undefined
    if (canonicalModules === undefined) {
      canonicalModules = new Map(
        discovery.modules.flatMap(module => {
          const key = realPath(join(root, module.path))
          return key === undefined ? [] : [[key, module.path] as const]
        })
      )
    }
    const module = canonicalModules.get(actual)
    if (module !== undefined) return { kind: 'module', path: module }
    return knownFile(path) ? { kind: 'file', path } : { kind: 'unresolved', specifier }
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
    options: ts.CompilerOptions,
    mode: ts.ResolutionMode
  ): Resolution {
    const supportsImports = [
      ts.ModuleResolutionKind.Bundler,
      ts.ModuleResolutionKind.Node16,
      ts.ModuleResolutionKind.NodeNext
    ].includes(options.moduleResolution ?? ts.ModuleResolutionKind.Bundler)
    if (
      specifier.startsWith('#') &&
      supportsImports &&
      options.resolvePackageJsonImports !== false
    ) {
      const active = new Set([
        'types',
        'default',
        mode === ts.ModuleKind.CommonJS ? 'require' : 'import',
        ...(options.customConditions ?? [])
      ])
      if (
        options.moduleResolution !== undefined &&
        options.moduleResolution !== ts.ModuleResolutionKind.Bundler
      )
        active.add('node')
      const extensionless =
        options.moduleResolution === undefined ||
        options.moduleResolution === ts.ModuleResolutionKind.Bundler ||
        mode !== ts.ModuleKind.ESNext
      for (const { dir, target } of importsOf(module.path, specifier, active)) {
        if (!target.startsWith('./')) {
          if (splitSpecifier(target) || isBuiltin(target)) {
            const resolved = resolveWhole(module, target, mode)
            if (resolved.kind !== 'unresolved') return resolved
          }
          continue
        }
        const absolute = join(root, dir, target)
        if (!isWithin(join(root, dir), absolute)) continue
        const paths = extensionless ? sourceCandidates(absolute) : [absolute]
        const file = paths.find(path => host.fileExists(path))
        const resolved = file && inRepository(file, specifier)
        if (resolved) return resolved
      }
    }
    const exact = exactFiles(module, specifier, options).find(file => host.fileExists(file))
    const found = exact && inRepository(exact, specifier)
    if (found) return found
    const name = packageNamed(specifier)
    return name ? { kind: 'external', name } : { kind: 'unresolved', specifier }
  }

  function byTypeScript(
    module: DiscoveredModule,
    specifier: string,
    options: ts.CompilerOptions,
    mode: ts.ResolutionMode
  ): Resolution {
    let resolvedModule: ts.ResolvedModuleFull | undefined
    try {
      const result = ts.resolveModuleName(
        specifier,
        join(root, module.path),
        options,
        host,
        cacheOf(module, options),
        undefined,
        mode
      )
      resolvedModule = result.resolvedModule
    } catch (error) {
      // TypeScript recurses indefinitely on cyclic private-import redirects.
      // The fallback follows the same mapping with a bounded depth.
      if (!(error instanceof RangeError) || !specifier.startsWith('#')) throw error
    }
    if (!resolvedModule) return unresolvedByTypeScript(module, specifier, options, mode)
    const file = resolvedModule.resolvedFileName
    const external = resolvedModule.isExternalLibraryImport
      ? ((options.paths && pathsMatch(options.paths, specifier)
          ? undefined
          : packageNamed(specifier)) ?? packageOfFile(file))
      : undefined
    if (external) return { kind: 'external', name: external }
    return inRepository(file, specifier) ?? { kind: 'unresolved', specifier }
  }

  /**
   * A `paths` alias that leads to a module wins over a workspace package, as
   * it does for TypeScript. One that leads nowhere, such as a catch-all `*`
   * for type folders, leaves the specifier to the workspace.
   */
  function resolveWhole(
    module: DiscoveredModule,
    specifier: string,
    mode: ts.ResolutionMode
  ): Resolution {
    const options = compilerOptionsOf(discovery, module)
    const aliased =
      options.paths !== undefined && pathsMatch(options.paths, specifier)
        ? byTypeScript(module, specifier, options, mode)
        : undefined
    if (aliased !== undefined && aliased.kind !== 'external') return aliased
    const member = workspace.resolve(specifier)
    if (member) {
      if (member.kind === 'module') return member
      return member.kind === 'file'
        ? (inRepository(join(root, member.path), specifier) ?? { kind: 'unresolved', specifier })
        : { kind: 'unresolved', specifier }
    }
    if (isBuiltin(specifier)) {
      return { kind: 'external', name: `node:${specifier.replace(/^node:/, '').split('/')[0]}` }
    }
    return aliased ?? byTypeScript(module, specifier, options, mode)
  }

  return {
    formatOf(module) {
      const options = compilerOptionsOf(discovery, module)
      const packageJsons = cacheOf(module, options).getPackageJsonInfoCache()
      return ts.getImpliedNodeFormatForFile(join(root, module.path), packageJsons, host, options)
    },
    /** A bundler such as Vite reads `./worker?worker` as the file `./worker` with a query, so a specifier that resolves to nothing whole resolves without its query. */
    resolve(module, specifier, mode) {
      const whole = resolveWhole(module, specifier, mode)
      const query = specifier.indexOf('?')
      if (whole.kind !== 'unresolved' || query < 0) return whole
      const path = resolveWhole(module, specifier.slice(0, query), mode)
      return path.kind === 'unresolved' ? whole : path
    },
    warnings: () => [...workspace.warnings(), ...readWarnings],
    workspace
  }
}
