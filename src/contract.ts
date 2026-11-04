/**
 * The public contract: the `--json` object of each command, documented in
 * docs/json-output.md. Removing or renaming a field, or changing its meaning,
 * is breaking and bumps SCHEMA_VERSION. Adding an optional field is not.
 *
 * Every shape here is plain strings and numbers. This file imports nothing from
 * model.ts, so no brand or private type can leak into the output.
 */

export const SCHEMA_VERSION = 1

export const commands = ['overview', 'where', 'outline', 'uses', 'deps'] as const
export type Command = (typeof commands)[number]

export const moduleKinds = ['source', 'test', 'story', 'config'] as const
export type ModuleKind = (typeof moduleKinds)[number]

export const symbolKinds = [
  'function',
  'class',
  'component',
  'type',
  'interface',
  'enum',
  'const'
] as const
export type SymbolKind = (typeof symbolKinds)[number]

export const languages = [
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'vue',
  'svelte',
  'astro'
] as const
export type Language = (typeof languages)[number]

interface Envelope<C extends Command> {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly command: C
}

export interface ModuleRef {
  readonly path: string
  readonly package: string
  readonly area: string
  readonly kind: ModuleKind
}

export interface SymbolRef {
  readonly name: string
  readonly kind: SymbolKind
  readonly line: number
  readonly default: boolean
  readonly signature: string
  /** First sentence of the doc comment. Omitted when the symbol has none. */
  readonly doc?: string
}

/** A module reached by walking edges. `names` is empty beyond distance 1. */
export interface Reached extends ModuleRef {
  readonly distance: number
  readonly names: readonly string[]
}

/** What `uses` and `deps` were asked about, after resolution. */
export type Subject =
  | { readonly kind: 'module'; readonly path: string; readonly package: string }
  | { readonly kind: 'area'; readonly path: string; readonly package: string }
  | { readonly kind: 'package'; readonly name: string; readonly dir: string }

export interface Failure {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly command: Command
  readonly error: {
    readonly code: 'not-found' | 'ambiguous' | 'usage'
    readonly message: string
  }
}

export interface Overview extends Envelope<'overview'> {
  /** Sorted by name. */
  readonly packages: readonly {
    readonly name: string
    readonly dir: string
    readonly modules: number
    /** Sorted by layer ascending, then path. */
    readonly areas: readonly {
      readonly path: string
      readonly layer: number
      readonly modules: number
      /** Sorted by importers descending, then path. Five unless `--all`. */
      readonly top: readonly {
        readonly path: string
        readonly importers: number
        readonly exports: readonly string[]
      }[]
    }[]
  }[]
  readonly cycles: number
  readonly unresolved: number
}

export interface Where extends Envelope<'where'> {
  readonly name: string
  /** Sorted by module path, then line. Empty is a valid answer, not a failure. */
  readonly definitions: readonly (SymbolRef & { readonly module: ModuleRef })[]
}

export interface Outline extends Envelope<'outline'> {
  readonly module: ModuleRef
  /** Line order. */
  readonly symbols: readonly SymbolRef[]
}

export interface Uses extends Envelope<'uses'> {
  readonly subject: Subject
  readonly depth: number
  /** Non-test dependents outside the subject, up to `depth`. Sorted by distance, then path. */
  readonly modules: readonly Reached[]
  /**
   * Every test module that depends on the subject at any distance, ignoring
   * `depth`: the question is which tests to run. Same order as `modules`.
   */
  readonly tests: readonly Reached[]
}

export interface Deps extends Envelope<'deps'> {
  readonly subject: Subject
  readonly depth: number
  /** Workspace modules outside the subject. Sorted by distance, then path. */
  readonly modules: readonly Reached[]
  /** Workspace packages those modules belong to, excluding the subject's own. Sorted. */
  readonly packages: readonly string[]
  /** npm package names imported inside the subject. Sorted. */
  readonly external: readonly string[]
  /** Sorted by `from`, then `specifier`. */
  readonly unresolved: readonly { readonly from: string; readonly specifier: string }[]
}

export type Output = Overview | Where | Outline | Uses | Deps
