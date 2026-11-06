/**
 * Which source module a bare specifier reaches when it names a workspace
 * package: through the package's `exports`, or its entry fields when it has
 * none, and from a build output path back to the source TypeScript compiled,
 * else to the source a bundler most likely built it from.
 */

import { isAbsolute, join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import type { Discovery } from './discovery.ts'
import type { Warning } from './compiler-settings.ts'
import { plainInputs, type Inputs } from './inputs.ts'
import { parseRepoPath, toRepoPath, type PackageName, type RepoPath } from './model.ts'
import { nameOf, readJson } from './workspace.ts'

export type UnresolvedReason = 'blocked' | 'no-export' | 'missing' | 'build-output' | 'too-deep'

export type WorkspaceResolution =
  | { readonly kind: 'module'; readonly path: RepoPath }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedReason }

/** A public specifier of a package and the module it reaches. */
export interface Entry {
  readonly specifier: string
  readonly path: RepoPath
}

export interface WorkspaceResolver {
  /** Undefined when the specifier names no workspace package, so TypeScript resolves it instead. */
  readonly resolve: (specifier: string) => WorkspaceResolution | undefined
  /**
   * For a bare specifier that names a workspace package, the package and
   * whether the subpath is public: listed in its `exports` with a target, or
   * any subpath when it has no `exports`.
   */
  readonly exposure: (
    specifier: string
  ) => { readonly package: PackageName; readonly listed: boolean } | undefined
  /**
   * The package's public entries that reach a module: its name, then each
   * subpath its `exports` lists without a `*`, in the order listed.
   */
  readonly entries: (name: PackageName) => readonly Entry[]
  /**
   * A public specifier of the package beyond its entries that reaches `path`:
   * through a `*` subpath of `exports`, or by the module's own path when the
   * package has no `exports`.
   */
  readonly deepSpecifier: (name: PackageName, path: RepoPath) => string | undefined
  /** One per package and reason. */
  readonly warnings: () => readonly Warning[]
}

/** How deep `exports` targets are followed. Real packages nest a few levels, and a hostile one could nest thousands. */
const maxNesting = 32

const reasons: Readonly<Record<UnresolvedReason, string>> = {
  blocked: 'exports maps the subpath to null',
  'no-export': 'exports has no entry for the subpath',
  missing: 'the target is no module in the repository',
  'build-output': 'the target is build output with no source module',
  'too-deep': `exports nests conditions or fallbacks more than ${maxNesting} levels deep`
}

/**
 * Most preferred first, whatever order a package.json lists them in. Any other
 * condition, such as a repository's own condition for its source, comes after
 * these in the order listed.
 */
const conditions: readonly string[] = [
  'source',
  'types',
  'import',
  'module',
  'require',
  'node',
  'default'
]

/** Folders bundlers write to. A target under one that is no module is build output. */
const outDirs: ReadonlySet<string> = new Set(['dist', 'build', 'lib', 'out', 'esm', 'cjs'])

/** Folders within the output that split one build by format or platform. */
const formatDirs: ReadonlySet<string> = new Set([
  'esm',
  'cjs',
  'es',
  'mjs',
  'modern',
  'legacy',
  'node',
  'browser',
  'types'
])

/** The package.json fields that name the entry point of a package without `exports`. */
const entryFields = ['types', 'typings', 'module', 'main'] as const

/**
 * The extensions TypeScript tries for a path, in its order, by the path's
 * extension. Declaration files are no modules, so they are left out. A path
 * with no extension listed here also tries a directory index.
 */
const scriptSources = ['.ts', '.tsx', '.js', '.jsx'] as const
const probes: readonly {
  readonly extensions: readonly string[]
  readonly sources: readonly string[]
}[] = [
  { extensions: ['.d.mts', '.mts', '.mjs'], sources: ['.mts', '.mjs'] },
  { extensions: ['.d.cts', '.cts', '.cjs'], sources: ['.cts', '.cjs'] },
  { extensions: ['.tsx', '.jsx'], sources: ['.tsx', '.ts', '.jsx', '.js'] },
  { extensions: ['.d.ts', '.ts', '.js'], sources: scriptSources }
]

function candidates(path: string): readonly string[] {
  for (const { extensions, sources } of probes) {
    const extension = extensions.find(extension => path.endsWith(extension))
    if (extension) {
      const stem = path.slice(0, -extension.length)
      return sources.map(source => stem + source)
    }
  }
  return [
    path,
    ...scriptSources.map(source => path + source),
    ...scriptSources.map(source => `${path}/index${source}`)
  ]
}

/**
 * The sources, relative to the package and without extension, that a bundler
 * most likely built `target` from, most specific first: the same path under
 * `src`, then with each format folder dropped. A bundle of the package root
 * named after the package, as Rollup names one, is built from `src/index`.
 */
function bundledSources(target: string, packageName: string, subpath: string): readonly string[] {
  const [outDir, ...parts] = target.split('/')
  if (outDir === undefined || !outDirs.has(outDir) || parts.length === 0) return []
  const file = parts.pop()!.replace(/(\.d)?\.[cm]?[jt]sx?$/, '')
  const sources = [[...parts, file].join('/')]
  while (parts[0] !== undefined && formatDirs.has(parts[0])) {
    parts.shift()
    sources.push([...parts, file].join('/'))
  }
  if (subpath === '.' && file.split('.')[0] === packageName.replace(/^@[^/]+\//, '')) {
    sources.push('index')
  }
  return sources.map(source => `src/${source}`)
}

function unresolved(reason: UnresolvedReason): WorkspaceResolution {
  return { kind: 'unresolved', reason }
}

/** The first option that reaches a module, else the first option's failure. */
function firstModule<T>(
  options: readonly T[],
  resolveOne: (option: T) => WorkspaceResolution
): WorkspaceResolution {
  let failure = unresolved('no-export')
  for (const [index, option] of options.entries()) {
    const result = resolveOne(option)
    if (result.kind === 'module') return result
    if (index === 0) failure = result
  }
  return failure
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** An `exports` target: a path, null, or a list of fallbacks or conditions nested up to `maxNesting` deep. */
function resolveTarget(
  target: unknown,
  star: string,
  locate: (path: string) => WorkspaceResolution,
  depth = 0
): WorkspaceResolution {
  if (target === null) return unresolved('blocked')
  if (typeof target === 'string') return locate(target.replaceAll('*', star))
  if (depth === maxNesting) return unresolved('too-deep')
  const options: readonly unknown[] = Array.isArray(target)
    ? target
    : isRecord(target)
      ? [
          ...conditions.filter(condition => Object.hasOwn(target, condition)),
          ...Object.keys(target).filter(condition => !conditions.includes(condition))
        ].map(condition => target[condition])
      : []
  return firstModule(options, option => resolveTarget(option, star, locate, depth + 1))
}

/** The exports entry for `subpath` and the text its `*` stands for, by the package.json exports rules. */
function exportsEntry(
  exports: unknown,
  subpath: string
): { readonly target: unknown; readonly star: string } | undefined {
  const isSubpathMap = isRecord(exports) && Object.keys(exports).every(key => key.startsWith('.'))
  const map: Readonly<Record<string, unknown>> = isSubpathMap ? exports : { '.': exports }
  if (Object.hasOwn(map, subpath) && !subpath.includes('*'))
    return { target: map[subpath], star: '' }
  const matches = Object.keys(map).flatMap(key => {
    const [prefix, suffix, ...more] = key.split('*')
    if (prefix === undefined || suffix === undefined || more.length > 0) return []
    const fits =
      subpath.length >= key.length && subpath.startsWith(prefix) && subpath.endsWith(suffix)
    return fits
      ? [{ key, prefix, star: subpath.slice(prefix.length, subpath.length - suffix.length) }]
      : []
  })
  const best = matches.sort(
    (a, b) => b.prefix.length - a.prefix.length || b.key.length - a.key.length
  )[0]
  return best && { target: map[best.key], star: best.star }
}

function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/**
 * Splits a bare specifier into its package name, scoped or not, and its
 * subpath, "." for none. A name npm could not publish, such as SvelteKit's
 * `$lib` alias, is no package: npm names are URL-safe and start with neither
 * `.` nor `_`, and older ones may hold capitals.
 */
export function splitSpecifier(
  specifier: string
): { readonly name: string; readonly subpath: string } | undefined {
  const match = /^((?:@[\w~-][\w.~-]*\/)?(?![._])[\w~-][\w.~-]*)(\/.*)?$/.exec(specifier)
  return match ? { name: match[1]!, subpath: `.${match[2] ?? ''}` } : undefined
}

/**
 * Resolves bare specifiers that name a package of `discovery`. The root
 * package resolves its own name only when it has `exports`, as Node and
 * TypeScript allow self-reference only then. Reads each package.json once,
 * when the resolver is made.
 */
export function workspaceResolver(
  discovery: Discovery,
  inputs: Inputs = plainInputs(ts.sys)
): WorkspaceResolver {
  const modules: ReadonlySet<string> = new Set(discovery.modules.map(module => module.path))
  const manifests = new Map(
    Object.entries(discovery.packages).flatMap(([name, { dir }]) => {
      const path = parseRepoPath(`${dir}/package.json`)
      const manifest = readJson(inputs, discovery.root, path, [])
      const reachable = dir !== '.' || (isRecord(manifest) && manifest.exports !== undefined)
      return reachable && nameOf(manifest) === name
        ? [[name as PackageName, { dir, path, manifest }] as const]
        : []
    })
  )
  const warnings: Warning[] = []
  const warned = new Set<string>()

  const asModule = (path: string): RepoPath | undefined =>
    candidates(path).find(candidate => modules.has(candidate)) as RepoPath | undefined

  /** A path can lie under the outDirs of several configs, so the first whose source is a module wins. */
  function fromBuild(path: string): WorkspaceResolution {
    const absolute = join(discovery.root, path)
    const matching = discovery.builds.filter(({ outDir }) => isInside(outDir, absolute))
    if (matching.length === 0) return unresolved('missing')
    for (const { outDir, rootDir } of matching) {
      const source = join(rootDir, relative(outDir, absolute))
      if (!isInside(discovery.root, source)) continue
      const found = asModule(toRepoPath(discovery.root, source))
      if (found) return { kind: 'module', path: found }
    }
    return unresolved('build-output')
  }

  /** With `guess`, a target no build config accounts for maps to its likely bundled source. */
  function locateIn(dir: RepoPath, packageName: string, subpath: string, guess: boolean) {
    return (target: string): WorkspaceResolution => {
      const path = posix.normalize(posix.join(dir, target))
      if (path === '..' || path.startsWith('../')) return unresolved('missing')
      const found = asModule(path)
      if (found) return { kind: 'module', path: found }
      const built = fromBuild(path)
      if (built.kind === 'module' || !guess) return built
      const source = bundledSources(posix.relative(dir, path), packageName, subpath)
        .map(source => asModule(posix.join(dir, source)))
        .find(source => source !== undefined)
      return source ? { kind: 'module', path: source } : built
    }
  }

  function resolvePackage(
    { manifest, dir }: { readonly manifest: unknown; readonly dir: RepoPath },
    packageName: string,
    subpath: string,
    guess: boolean
  ): WorkspaceResolution {
    const locate = locateIn(dir, packageName, subpath, guess)
    const exports = isRecord(manifest) ? manifest.exports : undefined
    if (exports !== undefined) {
      const entry = exportsEntry(exports, subpath)
      return entry ? resolveTarget(entry.target, entry.star, locate) : unresolved('no-export')
    }
    if (subpath !== '.') return locate(subpath)
    const fields = entryFields.flatMap(field => {
      const value = isRecord(manifest) ? manifest[field] : undefined
      return typeof value === 'string' ? [value] : []
    })
    return firstModule([...fields, './index'], locate)
  }

  function lookup(specifier: string) {
    const parts = splitSpecifier(specifier)
    const owner = parts && manifests.get(parts.name as PackageName)
    if (!parts || !owner) return undefined
    // Every exact target first, so that a guess never overrides what the package states.
    const result = firstModule([false, true], guess =>
      resolvePackage(owner, parts.name, parts.subpath, guess)
    )
    return { parts, owner, result }
  }

  /** Whether `specifier` reaches the module at `path`, with no warning when it reaches none. */
  const reaches = (specifier: string, path: RepoPath) => {
    const result = lookup(specifier)?.result
    return result?.kind === 'module' && result.path === path
  }

  const exportsOf = (name: PackageName) => {
    const manifest = manifests.get(name)?.manifest
    return isRecord(manifest) ? manifest.exports : undefined
  }

  const subpathKeys = (exports: unknown): readonly string[] =>
    isRecord(exports) && Object.keys(exports).every(key => key.startsWith('.'))
      ? Object.keys(exports)
      : ['.']

  const specifierOf = (name: string, subpath: string) =>
    subpath === '.' ? name : `${name}${subpath.slice(1)}`

  const entryCache = new Map<PackageName, readonly Entry[]>()

  return {
    resolve(specifier) {
      const found = lookup(specifier)
      if (!found) return undefined
      const { parts, owner, result } = found
      if (result.kind === 'module') return result
      const key = `${parts.name}\0${result.reason}`
      const metadata =
        parts.subpath === './package.json' &&
        isRecord(owner.manifest) &&
        exportsEntry(owner.manifest.exports, parts.subpath)?.target === './package.json'
      if (!metadata && !warned.has(key)) {
        warned.add(key)
        warnings.push({ path: owner.path, message: `${specifier}: ${reasons[result.reason]}` })
      }
      return result
    },
    exposure(specifier) {
      const parts = splitSpecifier(specifier)
      const name = parts?.name as PackageName | undefined
      if (!parts || name === undefined || !manifests.has(name)) return undefined
      const exports = exportsOf(name)
      if (exports === undefined) return { package: name, listed: true }
      const entry = exportsEntry(exports, parts.subpath)
      return { package: name, listed: entry !== undefined && entry.target !== null }
    },
    entries(name) {
      const cached = entryCache.get(name)
      if (cached) return cached
      const exports = exportsOf(name)
      const subpaths = exports === undefined ? ['.'] : subpathKeys(exports)
      const entries = subpaths.flatMap(subpath => {
        if (subpath.includes('*')) return []
        const specifier = specifierOf(name, subpath)
        const result = lookup(specifier)?.result
        return result?.kind === 'module' ? [{ specifier, path: result.path }] : []
      })
      entryCache.set(name, entries)
      return entries
    },
    deepSpecifier(name, path) {
      const owner = manifests.get(name)
      if (!owner) return undefined
      const relativePath = posix.relative(owner.dir === '.' ? '' : owner.dir, path)
      const exports = exportsOf(name)
      const subpaths =
        exports === undefined
          ? ownPaths(relativePath).map(own => `./${own}`)
          : subpathKeys(exports).flatMap(key =>
              key.includes('*') && isRecord(exports)
                ? patternStars(exports[key], relativePath).map(star => key.replace('*', star))
                : []
            )
      return subpaths.map(subpath => specifierOf(name, subpath)).find(spec => reaches(spec, path))
    },
    warnings: () => warnings
  }
}

const scriptExtension = /(\.d)?\.[cm]?[jt]sx?$/

/** The subpaths a module may be imported by, shortest first: its folder for an index, then without its extension. */
function ownPaths(relativePath: string): readonly string[] {
  const stem = relativePath.replace(scriptExtension, '')
  const folder = stem.endsWith('/index') ? [stem.slice(0, -'/index'.length)] : []
  return [...new Set([...folder, stem, relativePath])]
}

/** Every string an `exports` target can lead to, through conditions and fallbacks up to `maxNesting` deep. */
function targetStrings(target: unknown, depth = 0): readonly string[] {
  if (typeof target === 'string') return [target]
  if (depth === maxNesting) return []
  const options = Array.isArray(target) ? target : isRecord(target) ? Object.values(target) : []
  return options.flatMap(option => targetStrings(option, depth + 1))
}

/**
 * What `*` would stand for in a target pattern such as `./dist/*.js` for the
 * module at `relativePath` to match it, comparing paths without extensions
 * and reading an output folder such as `dist` as `src`. Each guess is only a
 * candidate: the caller keeps one that resolves to the module.
 */
function patternStars(target: unknown, relativePath: string): readonly string[] {
  const stars = targetStrings(target).flatMap(pattern => {
    const [prefix, suffix, ...more] = posix.normalize(pattern).split('*')
    if (prefix === undefined || suffix === undefined || more.length > 0) return []
    const [outDir, ...rest] = prefix.split('/')
    const prefixes =
      outDir !== undefined && outDirs.has(outDir) && rest.length > 0
        ? [prefix, ['src', ...rest].join('/')]
        : [prefix]
    const forms = [
      { path: relativePath, end: suffix },
      { path: relativePath.replace(scriptExtension, ''), end: suffix.replace(scriptExtension, '') }
    ]
    return prefixes.flatMap(start =>
      forms.flatMap(({ path, end }) =>
        path.length > start.length + end.length && path.startsWith(start) && path.endsWith(end)
          ? [path.slice(start.length, path.length - end.length)]
          : []
      )
    )
  })
  return [...new Set(stars)]
}
