/**
 * The private model, in two layers split by what each one needs.
 *
 * `Model` holds per-module facts that need the file's contents: its symbols and
 * its resolved outgoing edges. It is the cache, plain JSON, and the analyzer
 * replaces one module at a time.
 *
 * `Graph` is everything computable from a `Model` plus `galactica.config.json`:
 * package membership, kind, language, areas, layers, reverse edges, the symbol
 * index and cycles. It lives in memory and is rebuilt on load, so a config
 * change invalidates no cache entry.
 */

import { isAbsolute, posix, relative, sep } from 'node:path'
import type { Language, ModuleKind, SymbolKind } from './contract.ts'

declare const brand: unique symbol
type Brand<T, Name extends string> = T & { readonly [brand]: Name }

/** Repository-relative, forward slashes, no leading `./`, no trailing `/`. "." is the root. */
export type RepoPath = Brand<string, 'RepoPath'>
/** The `name` field of a workspace package.json. */
export type PackageName = Brand<string, 'PackageName'>
/** An area's directory. Unique across packages. */
export type AreaPath = Brand<string, 'AreaPath'>

function normalize(forwardSlashed: string): RepoPath {
  const path = posix.normalize(forwardSlashed)
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  if (trimmed === '..' || trimmed.startsWith('../')) {
    throw new Error(`path escapes the repository: ${forwardSlashed}`)
  }
  return trimmed as RepoPath
}

/** Converts a filesystem path under `root`. Throws when it lies outside. */
export function toRepoPath(root: string, absolutePath: string): RepoPath {
  const rel = relative(root, absolutePath)
  if (isAbsolute(rel)) throw new Error(`path is outside the repository: ${absolutePath}`)
  return normalize(rel.split(sep).join('/'))
}

/** Parses a repository-relative path from user input. Throws on absolute paths and `..` escapes. */
export function parseRepoPath(raw: string): RepoPath {
  const slashed = raw.replaceAll('\\', '/')
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`path must be relative to the repository: ${raw}`)
  }
  return normalize(slashed)
}

export const MODEL_FORMAT = 1

export interface Model {
  /** A mismatch discards the cache. It is never migrated. */
  readonly format: typeof MODEL_FORMAT
  readonly repository: { readonly name: string }
  /** From the workspace manifest. A module belongs to the package with the longest `dir` prefix of its path. */
  readonly packages: Readonly<Record<PackageName, { readonly dir: RepoPath }>>
  /** Keys sorted, so the serialized model is deterministic. */
  readonly modules: Readonly<Record<RepoPath, ModuleFacts>>
}

export interface ModuleFacts {
  readonly path: RepoPath
  /** Content hash. The incremental update skips a module whose hash is unchanged. */
  readonly hash: string
  /** Exported declarations defined in this file, in line order. Re-exports are edges. */
  readonly symbols: readonly SymbolFacts[]
  /**
   * Sorted by line, then target. An import through a barrel yields one edge to
   * the module that defines each name, so one statement can yield several edges.
   */
  readonly edges: readonly Edge[]
}

export interface SymbolFacts {
  /** The declaration's own name. An anonymous default export is named "default". */
  readonly name: string
  readonly kind: SymbolKind
  readonly line: number
  readonly default: boolean
  /** One line, declaration keyword included, body omitted. */
  readonly signature: string
  /** First sentence of the doc comment. Absent when there is none. */
  readonly doc?: string
}

/** Unresolved imports stay in the model so `deps` can report them. */
export type Target =
  | { readonly kind: 'module'; readonly path: RepoPath }
  | { readonly kind: 'external'; readonly name: string }
  | { readonly kind: 'unresolved'; readonly specifier: string }

export interface Edge {
  readonly to: Target
  readonly line: number
  /** `import` brings names in. `reexport` passes them on with `export ... from`. */
  readonly form: 'import' | 'reexport'
  /** Names as the defining module exports them. "*" for a namespace import or `export *`, empty for a side-effect import. */
  readonly names: readonly string[]
  readonly typeOnly: boolean
  readonly dynamic: boolean
  /**
   * Barrels the resolver walked through to reach `to`, importer side first.
   * If one of them changes, this edge may resolve differently.
   */
  readonly via: readonly RepoPath[]
}

function sortedModules(entries: Iterable<[RepoPath, ModuleFacts]>): Model['modules'] {
  return Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Returns a model with `facts` in place of any entry at its path. Idempotent. */
export function replaceModule(model: Model, facts: ModuleFacts): Model {
  const entries = Object.entries(model.modules).filter(([path]) => path !== facts.path)
  return {
    ...model,
    modules: sortedModules([...(entries as [RepoPath, ModuleFacts][]), [facts.path, facts]])
  }
}

/** Returns a model without the entry at `path`. Idempotent. */
export function removeModule(model: Model, path: RepoPath): Model {
  const entries = Object.entries(model.modules).filter(([key]) => key !== path)
  return { ...model, modules: sortedModules(entries as [RepoPath, ModuleFacts][]) }
}

/** The overrides from `galactica.config.json`, parsed at the boundary. Every field is optional. */
export interface Config {
  /** Glob to area name, for grouping that does not follow folders. */
  readonly areas?: Readonly<Record<string, string>>
  readonly kinds?: Readonly<Partial<Record<ModuleKind, readonly string[]>>>
}

/** A module joined with everything derived about it. */
export interface ModuleNode {
  readonly facts: ModuleFacts
  readonly package: PackageName
  readonly area: AreaPath
  readonly kind: ModuleKind
  readonly language: Language
}

export interface Area {
  readonly path: AreaPath
  readonly package: PackageName
  /** 0 depends on no other area in its package. Members of an area cycle share a layer. Computed from source and config modules only. */
  readonly layer: number
  /** Sorted by path. */
  readonly modules: readonly RepoPath[]
}

/** An edge seen from its target. `through` marks a barrel the edge only routed through. */
export interface Incoming {
  readonly from: RepoPath
  readonly edge: Edge
  readonly through: boolean
}

export interface SymbolLocation {
  readonly module: RepoPath
  readonly symbol: SymbolFacts
}

export interface Graph {
  readonly repository: Model['repository']
  /** All module paths, sorted. */
  readonly paths: readonly RepoPath[]
  readonly modules: ReadonlyMap<RepoPath, ModuleNode>
  readonly packages: ReadonlyMap<
    PackageName,
    { readonly dir: RepoPath; readonly areas: readonly AreaPath[] }
  >
  readonly areas: ReadonlyMap<AreaPath, Area>
  /** Reverse edges per module. Feeds `uses` and the importer counts in `overview`. */
  readonly incoming: ReadonlyMap<RepoPath, readonly Incoming[]>
  /** Exported name to its definitions, sorted by module path, then line. Feeds `where`. */
  readonly symbols: ReadonlyMap<string, readonly SymbolLocation[]>
  /** Strongly connected components of size above one among source modules, each sorted, the list sorted by first member. */
  readonly cycles: readonly (readonly RepoPath[])[]
}
