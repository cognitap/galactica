/**
 * Analysing a repository into its `Model`: discovery, then for each module one
 * read and one parse, from which come its content hash, its symbols and its
 * imports, then the resolution of those imports across the repository, and
 * last the pass that follows imports through barrels. There is no program and
 * no type checker.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type ts from 'typescript'
import { resolveBarrels } from './barrels.ts'
import { compilerOptionsOf, discover, type DiscoveredModule, type Warning } from './discovery.ts'
import { extract, type Extraction } from './extraction.ts'
import { importResolver, type ImportResolver } from './import-resolution.ts'
import { resolutionModeOf } from './imports.ts'
import { compareEdges, MODEL_FORMAT, type Edge, type Model, type ModuleFacts } from './model.ts'
import { isScriptLanguage } from './syntax.ts'

/** What a caller reports about a run. It stays out of the `Model`, which is the cache. */
export interface Summary {
  /** From discovery, the compiler settings and the workspace resolver. Sorted by path, then message. */
  readonly warnings: readonly Warning[]
  /** Edges whose target is unresolved. */
  readonly unresolved: number
  /** Imports of repository files that are no modules, such as stylesheets, by extension. They get no edge. */
  readonly skipped: Readonly<Record<string, number>>
  /** Wall time of each phase, in milliseconds. */
  readonly durations: {
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
  { hash, symbols, imports }: Extraction,
  options: ts.CompilerOptions,
  resolver: ImportResolver
): Analyzed {
  const { path, language } = module
  if (!isScriptLanguage(language)) return { facts: { path, hash, symbols, edges: [] }, skipped: [] }
  const format = resolver.formatOf(module)
  const edges: Edge[] = []
  const skipped: string[] = []
  for (const { specifier, syntax, resolutionMode, ...taken } of imports) {
    const mode = resolutionModeOf({ syntax, resolutionMode }, language, format, options)
    const to = resolver.resolve(module, specifier, mode)
    if (to.kind === 'file') skipped.push(extensionOf(to.path))
    else edges.push({ to, ...taken, via: [] })
  }
  edges.sort(compareEdges)
  return { facts: { path, hash, symbols, edges }, skipped }
}

/** The repository's model, with a summary of what the analysis could not resolve or map. */
export function analyzeRepository(rootDir: string): Analysis {
  const clock: Clock = { discovery: 0, parse: 0, resolution: 0, barrels: 0 }
  const discovery = timed(clock, 'discovery', () => discover(rootDir))
  const extractions = discovery.modules.map(({ path, language }) => {
    const bytes = readFileSync(join(discovery.root, path))
    return timed(clock, 'parse', () => extract(path, language, bytes))
  })
  const resolver = importResolver(discovery)
  const analyzed = timed(clock, 'resolution', () =>
    discovery.modules.map((module, index) =>
      resolveModule(module, extractions[index]!, compilerOptionsOf(discovery, module), resolver)
    )
  )

  const skipped: Record<string, number> = {}
  for (const extension of analyzed.flatMap(module => module.skipped).sort(compare)) {
    skipped[extension] = (skipped[extension] ?? 0) + 1
  }
  const modules = timed(clock, 'barrels', () =>
    resolveBarrels(Object.fromEntries(analyzed.map(({ facts }) => [facts.path, facts])))
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
      warnings: [...discovery.warnings, ...resolver.warnings()].sort(
        (a, b) => compare(a.path, b.path) || compare(a.message, b.message)
      ),
      unresolved: edges.filter(edge => edge.to.kind === 'unresolved').length,
      skipped,
      durations: clock
    }
  }
}
