/**
 * Analysing a repository into its `Model`: discovery, then for each module one
 * read and one parse, from which come its content hash, its symbols and its
 * resolved edges. There is no program and no type checker.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { compilerOptionsOf, discover, type DiscoveredModule, type Warning } from './discovery.ts'
import { importResolver, type ImportResolver } from './import-resolution.ts'
import { importsOf } from './imports.ts'
import { MODEL_FORMAT, type Edge, type Model, type ModuleFacts, type Target } from './model.ts'
import { symbolsOf } from './symbols.ts'
import { isScriptLanguage, parseScript } from './syntax.ts'

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
  }
}

export interface Analysis {
  readonly model: Model
  readonly summary: Summary
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function targetKey(target: Target): string {
  if (target.kind === 'module') return target.path
  if (target.kind === 'external') return target.name
  return target.specifier
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

function analyzeModule(
  root: string,
  module: DiscoveredModule,
  options: ts.CompilerOptions,
  resolver: ImportResolver,
  clock: Clock
): Analyzed {
  const { path, language } = module
  const bytes = readFileSync(join(root, path))
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (!isScriptLanguage(language)) {
    return { facts: { path, hash, symbols: [], edges: [] }, skipped: [] }
  }
  const format = timed(clock, 'resolution', () => resolver.formatOf(module))
  const { source, symbols, imports } = timed(clock, 'parse', () => {
    const source = parseScript(path, language, bytes.toString('utf8'), format)
    return { source, symbols: symbolsOf(source), imports: importsOf(source) }
  })
  const edges: Edge[] = []
  const skipped: string[] = []
  timed(clock, 'resolution', () => {
    for (const { specifier, ...taken } of imports) {
      const mode = ts.getModeForUsageLocation(source, specifier, options)
      const to = resolver.resolve(module, specifier.text, mode)
      if (to.kind === 'file') skipped.push(extensionOf(to.path))
      else edges.push({ to, ...taken, via: [] })
    }
  })
  edges.sort((a, b) => a.line - b.line || compare(targetKey(a.to), targetKey(b.to)))
  return { facts: { path, hash, symbols, edges }, skipped }
}

/** The repository's model, with a summary of what the analysis could not resolve or map. */
export function analyzeRepository(rootDir: string): Analysis {
  const clock: Clock = { discovery: 0, parse: 0, resolution: 0 }
  const discovery = timed(clock, 'discovery', () => discover(rootDir))
  const resolver = importResolver(discovery)
  const analyzed = discovery.modules.map(module =>
    analyzeModule(discovery.root, module, compilerOptionsOf(discovery, module), resolver, clock)
  )

  const skipped: Record<string, number> = {}
  for (const extension of analyzed.flatMap(module => module.skipped).sort(compare)) {
    skipped[extension] = (skipped[extension] ?? 0) + 1
  }
  const edges = analyzed.flatMap(module => module.facts.edges)
  return {
    model: {
      format: MODEL_FORMAT,
      repository: discovery.repository,
      packages: discovery.packages,
      modules: Object.fromEntries(analyzed.map(({ facts }) => [facts.path, facts]))
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
