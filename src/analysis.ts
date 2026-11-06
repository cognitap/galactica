/**
 * Analysing a repository into its `Model`: discovery, then for each module one
 * read and one parse, from which come its content hash, its symbols and its
 * imports, then the resolution of those imports across the repository, and
 * last the pass that follows imports through barrels. There is no program and
 * no type checker.
 *
 * With a cache, a module whose bytes are unchanged since the last run is not
 * parsed again. Everything after the parse depends on other files, so it runs
 * every time.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { readRepositoryFile } from './safe-read.ts'
import { resolveBarrels } from './barrels.ts'
import { compilerOptionsOf, discover, type DiscoveredModule, type Warning } from './discovery.ts'
import { currentStamp, readCache, writeCache, type Cache, type CacheEntry } from './cache.ts'
import { extract, hashOf } from './extraction.ts'
import { compilerOf, unreadWarnings, type Unread } from './frameworks.ts'
import { importResolver, type ImportResolver } from './import-resolution.ts'
import { reachFinder, withInstead } from './internal-imports.ts'
import { plainInputs, type Inputs } from './inputs.ts'
import { resolutionModeOf } from './imports.ts'
import {
  compareEdges,
  MODEL_FORMAT,
  type Config,
  type Edge,
  type Model,
  type ModuleFacts,
  type RepoPath
} from './model.ts'
import { unreadable } from './repository-files.ts'
import { isScriptLanguage } from './source-file.ts'

/** What a caller reports about a run. It stays out of the `Model`. */
export interface Summary {
  /** From discovery, the compiler settings and the workspace resolver. Sorted by path, then message. */
  readonly warnings: readonly Warning[]
  /** Edges whose target is unresolved. */
  readonly unresolved: number
  /** Imports of repository files that are no modules, such as stylesheets, by extension. They get no edge. */
  readonly skipped: Readonly<Record<string, number>>
  /**
   * How each module's symbols and imports were had: from the cache without a
   * read, from the cache after a read whose hash matched, or from a parse.
   */
  readonly modules: { readonly reused: number; readonly reread: number; readonly parsed: number }
  /** Wall time of each phase, in milliseconds. */
  readonly durations: {
    /** The TypeScript import, when the run loaded it. */
    readonly typescript: number
    readonly discovery: number
    readonly parse: number
    readonly resolution: number
    readonly barrels: number
  }
}

export interface Analysis {
  readonly model: Model
  readonly summary: Summary
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const extensionOf = (path: string) => /(\.d)?\.[^./]+$/.exec(path)?.[0] ?? '(none)'

/** A framework file compiles to an ES module, so its imports resolve as a TypeScript ES module's do. */
const frameworkScript = { language: 'ts', format: ts.ModuleKind.ESNext } as const

type Clock = Record<keyof Summary['durations'], number>

function timed<T>(clock: Clock, phase: keyof Clock, run: () => T): T {
  const start = performance.now()
  const result = run()
  clock[phase] += performance.now() - start
  return result
}

interface Analyzed {
  readonly facts: ModuleFacts
  /** The extensions of the repository files the module imports that are no modules. */
  readonly skipped: readonly string[]
}

function resolveModule(
  module: DiscoveredModule,
  { hash, symbols, imports }: CacheEntry,
  options: ts.CompilerOptions,
  resolver: ImportResolver,
  reachOf: ReturnType<typeof reachFinder>
): Analyzed {
  const { path } = module
  const { language, format } = isScriptLanguage(module.language)
    ? { language: module.language, format: resolver.formatOf(module) }
    : frameworkScript
  const edges: Edge[] = []
  const skipped: string[] = []
  for (const { specifier, syntax, resolutionMode, ...taken } of imports) {
    const mode = resolutionModeOf({ syntax, resolutionMode }, language, format, options)
    const to = resolver.resolve(module, specifier, mode)
    const internal = reachOf(module, specifier, to)
    if (to.kind === 'file') skipped.push(extensionOf(to.path))
    else edges.push({ to, ...taken, via: [], ...(internal === undefined ? {} : { internal }) })
  }
  edges.sort(compareEdges)
  return { facts: { path, hash, symbols, edges }, skipped }
}

type Source = keyof Summary['modules']

/**
 * The module's entry, from `cached` when the module's size and mtime, or
 * else its hash, are unchanged. The stat comes before the read, so a file
 * written after the read has a newer mtime than the entry records.
 */
function entryOf(
  root: string,
  { path, language }: DiscoveredModule,
  cached: CacheEntry | undefined,
  load: (() => unknown) | undefined,
  clock: Clock,
  inputs: Inputs
): readonly [CacheEntry, Source] {
  const file = join(root, path)
  const { mtimeMs, size } = inputs.stat(file)
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return [cached, 'reused']
  const bytes = readRepositoryFile(root, file, {
    fileExists: inputs.fileExists,
    readFile: file => readFileSync(file)
  })
  const hash = hashOf(bytes)
  if (cached?.hash === hash) return [{ ...cached, mtimeMs, size }, 'reread']
  const extraction = timed(clock, 'parse', () => extract(path, language, bytes, load))
  return [{ hash, mtimeMs, size, ...extraction }, 'parsed']
}

export interface Options {
  /** The folder of the cache. Without one, every module is parsed and nothing is written. */
  readonly cache?: string
  /** What the analysis reads, recorded or not. The machine as it is by default. */
  readonly inputs?: Inputs
}

/** The repository's model, with a summary of what the analysis could not resolve or map. */
export function analyzeRepository(
  rootDir: string,
  config: Config,
  { cache, inputs = plainInputs(ts.sys) }: Options = {}
): Analysis {
  const clock: Clock = { typescript: 0, discovery: 0, parse: 0, resolution: 0, barrels: 0 }
  const discovered = timed(clock, 'discovery', () => discover(rootDir, config, inputs))
  const unreadableOf = unreadable(discovered.root)
  const skippedModules: Warning[] = []
  const readable = discovered.modules.filter(({ path }) => {
    const problem = unreadableOf(path)
    if (problem === undefined) return true
    inputs.stat(join(discovered.root, path))
    skippedModules.push({ path, message: `${problem}, so it is skipped` })
    return false
  })
  const discovery = { ...discovered, modules: readable }
  const store = cache === undefined ? undefined : { directory: cache, stamp: currentStamp() }
  const cached: Cache = store ? readCache(store.directory, store.stamp) : new Map()
  const counts: Record<Source, number> = { reused: 0, reread: 0, parsed: 0 }
  const entries = new Map<RepoPath, CacheEntry>()
  const unread: Unread[] = []
  const unparsed: Warning[] = []
  for (const module of discovery.modules) {
    const { path, language } = module
    const compiler = compilerOf(language)
    const [entry, source] = entryOf(
      discovery.root,
      module,
      cached.get(path),
      compiler?.load,
      clock,
      inputs
    )
    entries.set(path, entry)
    counts[source]++
    const { failure } = entry
    if (compiler && (!compiler.load || failure !== undefined)) {
      unread.push({ path, language, compiler, ...(failure === undefined ? {} : { failure }) })
    } else if (failure !== undefined) {
      unparsed.push({
        path,
        message: `could not read the file (${failure}), so it has no symbols or imports`
      })
    }
  }
  const changed = counts.reread + counts.parsed > 0 || cached.size !== entries.size
  if (store && changed) writeCache(store.directory, store.stamp, entries)
  const resolver = importResolver(discovery, inputs)
  const reachOf = reachFinder(discovery, resolver.workspace)
  const analyzed = timed(clock, 'resolution', () =>
    discovery.modules.map(module =>
      resolveModule(
        module,
        entries.get(module.path)!,
        compilerOptionsOf(discovery, module),
        resolver,
        reachOf
      )
    )
  )

  const skipped: Record<string, number> = {}
  for (const extension of analyzed.flatMap(module => module.skipped).sort(compare)) {
    skipped[extension] = (skipped[extension] ?? 0) + 1
  }
  const modules = timed(clock, 'barrels', () =>
    resolveBarrels(
      withInstead(
        Object.fromEntries(analyzed.map(({ facts }) => [facts.path, facts])),
        resolver.workspace
      )
    )
  )
  const edges = Object.values(modules).flatMap(facts => facts.edges)
  return {
    model: {
      format: MODEL_FORMAT,
      repository: discovery.repository,
      packages: discovery.packages,
      modules
    },
    summary: {
      warnings: [
        ...discovery.warnings,
        ...resolver.warnings(),
        ...unreadWarnings(unread),
        ...skippedModules,
        ...unparsed
      ].sort((a, b) => compare(a.path, b.path) || compare(a.message, b.message)),
      unresolved: edges.filter(edge => edge.to.kind === 'unresolved').length,
      skipped,
      modules: counts,
      durations: clock
    }
  }
}
