/**
 * Which source module a bare specifier reaches when it names a workspace
 * package: through the package's `exports`, or its entry fields when it has
 * none, and from a build output path back to the source TypeScript compiled.
 */

import { isAbsolute, join, posix, relative, sep } from 'node:path'
import ts from 'typescript'
import type { Discovery } from './discovery.ts'
import type { Warning } from './compiler-settings.ts'
import { plainInputs, type Inputs } from './inputs.ts'
import { parseRepoPath, toRepoPath, type PackageName, type RepoPath } from './model.ts'
import { nameOf, readJson } from './workspace.ts'

export type UnresolvedReason = 'blocked' | 'no-export' | 'missing' | 'build-output'

export type WorkspaceResolution =
  | { readonly kind: 'module'; readonly path: RepoPath }
  | { readonly kind: 'unresolved'; readonly reason: UnresolvedReason }

export interface WorkspaceResolver {
  /** Undefined when the specifier names no workspace package, so TypeScript resolves it instead. */
  readonly resolve: (specifier: string) => WorkspaceResolution | undefined
  /** One per package and reason. */
  readonly warnings: () => readonly Warning[]
}

const reasons: Readonly<Record<UnresolvedReason, string>> = {
  blocked: 'exports maps the subpath to null',
  'no-export': 'exports has no entry for the subpath',
  missing: 'the target is no module in the repository',
  'build-output': 'the target is build output with no source module'
}

/** Most preferred first, whatever order a package.json lists them in. */
const conditions = ['source', 'types', 'import', 'module', 'require', 'node', 'default'] as const

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

/** An `exports` target: a path, null, a list of fallbacks, or conditions nested to any depth. */
function resolveTarget(
  target: unknown,
  star: string,
  locate: (path: string) => WorkspaceResolution
): WorkspaceResolution {
  if (target === null) return unresolved('blocked')
  if (typeof target === 'string') return locate(target.replaceAll('*', star))
  const options: readonly unknown[] = Array.isArray(target)
    ? target
    : isRecord(target)
      ? conditions
          .filter(condition => Object.hasOwn(target, condition))
          .map(condition => target[condition])
      : []
  return firstModule(options, option => resolveTarget(option, star, locate))
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

/** Splits a bare specifier into its package name, scoped or not, and its subpath, "." for none. */
export function splitSpecifier(
  specifier: string
): { readonly name: string; readonly subpath: string } | undefined {
  const match = /^((?:@[^/@]+\/)?[^/@.][^/]*)(\/.*)?$/.exec(specifier)
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

  function locateIn(dir: RepoPath) {
    return (target: string): WorkspaceResolution => {
      const path = posix.normalize(posix.join(dir, target))
      if (path === '..' || path.startsWith('../')) return unresolved('missing')
      const found = asModule(path)
      return found ? { kind: 'module', path: found } : fromBuild(path)
    }
  }

  function resolvePackage(manifest: unknown, dir: RepoPath, subpath: string): WorkspaceResolution {
    const locate = locateIn(dir)
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

  return {
    resolve(specifier) {
      const parts = splitSpecifier(specifier)
      const owner = parts && manifests.get(parts.name as PackageName)
      if (!parts || !owner) return undefined
      const result = resolvePackage(owner.manifest, owner.dir, parts.subpath)
      if (result.kind === 'module') return result
      const key = `${parts.name}\0${result.reason}`
      if (!warned.has(key)) {
        warned.add(key)
        warnings.push({ path: owner.path, message: `${specifier}: ${reasons[result.reason]}` })
      }
      return result
    },
    warnings: () => warnings
  }
}
