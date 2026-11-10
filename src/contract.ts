/**
 * The public contract: the `--json` object of each command, documented in
 * docs/json-output.md. Removing or renaming a field, or changing its meaning,
 * is breaking and bumps SCHEMA_VERSION. Adding an optional field is not.
 *
 * Every shape here is plain strings and numbers. This file imports nothing from
 * anywhere, so no brand or private type can leak into the output.
 */

export const SCHEMA_VERSION = 1

export const commands = [
  'overview',
  'where',
  'outline',
  'uses',
  'deps',
  'path',
  'cycles',
  'health'
] as const
export type Command = (typeof commands)[number]
export type WriterCommand = 'html' | 'init'

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

interface Envelope<C extends Command | WriterCommand> {
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
  /** Exported name, which can be an alias of the declaration named in signature. */
  readonly name: string
  readonly kind: SymbolKind
  readonly line: number
  readonly default: boolean
  /** Original declaration signature, preserved when name is an export alias. */
  readonly signature: string
  /** First sentence of the doc comment. Omitted when the symbol has none. */
  readonly doc?: string
}

/** A module reached by walking edges. `names` is empty beyond distance 1. */
export interface Reached extends ModuleRef {
  readonly distance: number
  readonly names: readonly string[]
}

/** A test that depends on the subject of `uses`, and how it reaches it. */
export interface ReachedTest extends Reached {
  /**
   * The module outside the subject that imports it on the test's path, on a
   * shortest path of imports that load code when there is one. Omitted when the
   * test imports the subject itself.
   */
  readonly via?: string
  /** Set when every path from the test passes through this module, which much of the repository imports. */
  readonly hub?: string
}

/** What `uses` and `deps` were asked about, after resolution. */
export type Subject =
  | { readonly kind: 'module'; readonly path: string; readonly package: string }
  | { readonly kind: 'area'; readonly path: string; readonly package: string }
  | { readonly kind: 'package'; readonly name: string; readonly dir: string }

/** A problem the analysis found and worked around, such as a config it could not read. */
export interface Warning {
  /** The file the problem is in. */
  readonly path: string
  /** One line. An ignored glob names its workspace pattern or config key and the reason. */
  readonly message: string
}

export interface Failure {
  readonly schemaVersion: typeof SCHEMA_VERSION
  readonly command: Command | WriterCommand
  readonly error: {
    /** usage also covers unsupported Deno roots and writer argument, config or write failures. */
    readonly code: 'not-found' | 'ambiguous' | 'usage'
    readonly message: string
  }
}

/** A completed HTML write. The path is absolute; bytes is the exact UTF-8 size. */
interface HtmlWritten extends Envelope<'html'> {
  readonly path: string
  readonly bytes: number
}

/**
 * Installed skill files, in installation order. Paths are relative to the selected root.
 * When every file is kept, this object is still returned and the exit code is 1.
 */
interface SkillInstalled extends Envelope<'init'> {
  readonly files: readonly {
    readonly path: string
    readonly status: 'created' | 'updated' | 'unchanged' | 'kept'
  }[]
}

export type WriterOutput = HtmlWritten | SkillInstalled

/** One unresolved import from any mapped module, including tests and stories. */
export interface UnresolvedImport {
  readonly from: string
  readonly line: number
  /** Complete source specifier; text output may shorten it. */
  readonly specifier: string
  /** Likely cause inferred from the specifier, not a diagnosis of the filesystem or build. */
  readonly cause: 'build' | 'virtual' | 'url' | 'missing'
}

export interface Overview extends Envelope<'overview'> {
  /** Whether `--all` was given, so `top` lists every source and config module. */
  readonly all: boolean
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
      /** Source and config modules, sorted by importers descending, then path. Five unless `--all`. */
      readonly top: readonly {
        readonly path: string
        readonly importers: number
        readonly exports: readonly string[]
      }[]
    }[]
  }[]
  readonly cycles: number
  /** Imports without a mapped module, known asset/declaration or external package, including unsupported files. */
  readonly unresolved: number
  /** Every unresolved import, sorted by from, line, then specifier. Its length equals unresolved. */
  readonly unresolvedImports: readonly UnresolvedImport[]
  /**
   * Analysis problems, sorted by path, then message. Compiler deprecation and
   * output-layout migration notices and valid package.json metadata exports are omitted.
   * Unsafe optional configuration reads add a warning; required Galactica config uses a usage failure.
   */
  readonly warnings: readonly Warning[]
}

export interface Where extends Envelope<'where'> {
  readonly name: string
  /** Sorted by module path, then line. Empty is a valid answer, not a failure. */
  readonly definitions: readonly (SymbolRef & { readonly module: ModuleRef })[]
  /** Up to three exported names like `name`, when `definitions` is empty. Otherwise empty. */
  readonly suggestions: readonly string[]
}

export interface Outline extends Envelope<'outline'> {
  readonly module: ModuleRef
  /** Line order. */
  readonly symbols: readonly SymbolRef[]
}

/** An import from one module of a cycle to another. */
export interface CycleImport {
  readonly from: string
  readonly to: string
  /** The line of the import in `from`. */
  readonly line: number
  /** As `to` exports them, sorted. "*" for a namespace import, empty for a side-effect import. */
  readonly names: readonly string[]
  /** Barrels the import passes through, importer side first. */
  readonly via: readonly string[]
  /** `load-time` when `from` reads one of `names` in code that runs while it loads, `later` when only inside functions. */
  readonly use: 'load-time' | 'later'
  /** Whether the import points back up `modules`. Cutting every import marked so leaves no cycle among the modules. */
  readonly break: boolean
}

/**
 * Source and config modules that import each other in a loop, leaving out type-only imports and re-exports.
 * Imports read by JSX factories selected through pragmas or compiler options count as runtime imports.
 */
export interface Cycle {
  /** In dependency order: every import goes down this list, except those marked `break`. */
  readonly modules: readonly string[]
  /** Whether an import of the cycle is used at load time. */
  readonly loadTime: boolean
  /** Every import between the modules, sorted by `from`, line, then `to`. */
  readonly imports: readonly CycleImport[]
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
  readonly tests: readonly ReachedTest[]
  /** Which tests `tests` can miss: those that load the subject other than by importing it. */
  readonly testsNote: string
  /** The cycles a module of the subject is in, ordered as `cycles` orders them. */
  readonly cycles: readonly Cycle[]
}

export interface Deps extends Envelope<'deps'> {
  readonly subject: Subject
  readonly depth: number
  /** Workspace modules outside the subject. Sorted by distance, then path. */
  readonly modules: readonly Reached[]
  /** Workspace packages those modules belong to, excluding the subject's own. Sorted. */
  readonly packages: readonly string[]
  /** npm package names imported inside the subject, including missing paths-alias targets. Sorted. */
  readonly external: readonly string[]
  /**
   * Unmapped imports from the subject's starting modules, deduplicated by from/specifier.
   * Package and area subjects start from source/config only, not their tests or stories.
   * Sorted by `from`, then `specifier`; overview.unresolvedImports gives the repository-wide list with lines.
   */
  readonly unresolved: readonly { readonly from: string; readonly specifier: string }[]
  /** The cycles a module of the subject is in, ordered as `cycles` orders them. */
  readonly cycles: readonly Cycle[]
}

/** One hop of an import chain. `via` lists the barrels it passes through, importer side first. */
export interface PathStep {
  readonly from: string
  readonly to: string
  /** The line of this import in `from`. */
  readonly line: number
  /** As `to` exports them, sorted. "*" for a namespace import, empty for a side-effect import. */
  readonly names: readonly string[]
  /** Barrels this import passes through, importer side first. */
  readonly via: readonly string[]
}

/** A simple chain of imports. `modules` starts at `from` and ends at `to`. */
export interface ImportChain {
  readonly modules: readonly string[]
  /** The import between each successive pair of `modules`. Empty when both arguments name the same module. */
  readonly steps: readonly PathStep[]
}

export interface Path extends Envelope<'path'> {
  readonly from: ModuleRef
  readonly to: ModuleRef
  /** Whether `--all` was given. */
  readonly all: boolean
  /**
   * The shortest chain when `all` is false. Otherwise every distinct simple
   * chain, shortest first, then by module path, up to 20. Empty when `from`
   * never imports its way to `to`.
   */
  readonly chains: readonly ImportChain[]
  /** True when more chains exist than `chains` lists, or the search stopped early. */
  readonly truncated: boolean
}

export interface Cycles extends Envelope<'cycles'> {
  /** Those with an import used at load time first, then by their first module in path order. */
  readonly cycles: readonly Cycle[]
}

/** An area that holds far more source modules than the other areas of its package. */
export interface OversizedArea {
  readonly path: string
  readonly package: string
  /** Its source modules, tests, stories and config aside. */
  readonly modules: number
  /** The median of `modules` over the areas of the package that hold a source module. */
  readonly median: number
}

/** An import that reaches into another workspace package's internals. */
export interface InternalImport {
  readonly from: string
  /** The line of the import in `from`. */
  readonly line: number
  /** As written. */
  readonly specifier: string
  /** As the defining modules export them, sorted. "*" for a namespace import, empty for a side-effect import. */
  readonly names: readonly string[]
  /** `relative`: a relative path into the package's directory. `unlisted`: a subpath its `exports` does not list. */
  readonly reach: 'relative' | 'unlisted'
  /** The package reached into. */
  readonly package: string
  /** The module the specifier names. Omitted when it resolves to none. */
  readonly to?: string
  /** A public specifier of the package that gives the same import. Omitted when there is none. */
  readonly instead?: string
}

export interface Health extends Envelope<'health'> {
  /** As `cycles` lists them. */
  readonly cycles: readonly Cycle[]
  /** `health.areaModules` of galactica.config.json, which replaces the relative rule. Omitted when unset. */
  readonly areaModules?: number
  /** Sorted by path. */
  readonly oversizedAreas: readonly OversizedArea[]
  /** Sorted by `from`, line, then specifier. */
  readonly internalImports: readonly InternalImport[]
}

export type Output = Overview | Where | Outline | Uses | Deps | Path | Cycles | Health
