/** Pure decoders for cached extraction facts and derived models. No filesystem or parser loads. */

import type { Summary } from './analysis.ts'
import { symbolKinds } from './contract.ts'
import type { Extraction } from './extraction.ts'
import type { Import, ImportSyntax } from './imports.ts'
import { isRecord, isString, type UnknownRecord } from './json.ts'
import {
  MODEL_FORMAT,
  type Edge,
  type Internal,
  type Model,
  type ModuleFacts,
  type SymbolFacts,
  type Target
} from './model.ts'

export interface CacheEntry extends Extraction {
  readonly hash: string
  readonly mtimeMs: number
  readonly size: number
}

/** What a hit gives back beside the model. A hit's module counts and durations follow from being one. */
export interface CachedModel {
  readonly model: Model
  readonly warnings: Summary['warnings']
  readonly unresolved: number
  readonly skipped: Summary['skipped']
}

const isLine = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0

const isStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isString)

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    (values as readonly unknown[]).includes(value)

const isSymbolKind = oneOf(symbolKinds)
const isSyntax = oneOf<ImportSyntax>(['declaration', 'import-equals', 'require', 'import-call'])
const isForm = oneOf<Import['form']>(['import', 'reexport'])
const isMode = oneOf<NonNullable<Import['resolutionMode']>>(['import', 'require'])

function symbolOf(value: unknown): SymbolFacts | undefined {
  if (!isRecord(value)) return undefined
  const { name, kind, line, signature, doc } = value
  if (!isString(name) || !isSymbolKind(kind) || !isLine(line) || !isString(signature)) {
    return undefined
  }
  if (typeof value.default !== 'boolean' || (doc !== undefined && !isString(doc))) return undefined
  return {
    name,
    kind,
    line,
    default: value.default,
    signature,
    ...(doc === undefined ? {} : { doc })
  }
}

const isRenames = (value: unknown): value is Readonly<Record<string, string>> =>
  isRecord(value) && Object.values(value).every(isString)

function isJSX(value: unknown): value is NonNullable<Import['jsx']> {
  return (
    isRecord(value) &&
    isStrings(value.names) &&
    (value.factory === undefined || isString(value.factory)) &&
    (value.fragmentFactory === undefined || isString(value.fragmentFactory)) &&
    (value.fragment === undefined || value.fragment === true)
  )
}

function importOf(value: unknown): Import | undefined {
  if (!isRecord(value)) return undefined
  const {
    specifier,
    syntax,
    resolutionMode,
    line,
    form,
    names,
    renames,
    typeOnly,
    dynamic,
    loadTime,
    elided,
    metadataLoadTime,
    jsx
  } = value
  if (!isString(specifier) || !isSyntax(syntax) || !isLine(line) || !isForm(form)) return undefined
  if (!isStrings(names) || typeof typeOnly !== 'boolean' || typeof dynamic !== 'boolean') {
    return undefined
  }
  if (resolutionMode !== undefined && !isMode(resolutionMode)) return undefined
  if (renames !== undefined && !isRenames(renames)) return undefined
  if (loadTime !== undefined && !isStrings(loadTime)) return undefined
  if (elided !== undefined && elided !== 'unless-verbatim' && elided !== 'unless-metadata') {
    return undefined
  }
  if (metadataLoadTime !== undefined && !isStrings(metadataLoadTime)) return undefined
  if (jsx !== undefined && !isJSX(jsx)) return undefined
  return {
    specifier,
    syntax,
    ...(resolutionMode === undefined ? {} : { resolutionMode }),
    line,
    form,
    names,
    ...(renames === undefined ? {} : { renames }),
    typeOnly,
    dynamic,
    ...(loadTime === undefined ? {} : { loadTime }),
    ...(elided === undefined ? {} : { elided }),
    ...(metadataLoadTime === undefined ? {} : { metadataLoadTime }),
    ...(jsx === undefined ? {} : { jsx })
  }
}

function every<T>(values: unknown, parse: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(values)) return undefined
  const parsed = values.map(parse)
  return parsed.every(value => value !== undefined) ? parsed : undefined
}

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || isString(value)

export function cacheEntryOf(value: unknown): CacheEntry | undefined {
  if (!isRecord(value)) return undefined
  const { hash, mtimeMs, size, failure } = value
  const symbols = every(value.symbols, symbolOf)
  const imports = every(value.imports, importOf)
  if (!isString(hash) || typeof mtimeMs !== 'number' || typeof size !== 'number') return undefined
  if (!isOptionalString(failure)) return undefined
  return (
    symbols &&
    imports && {
      hash,
      mtimeMs,
      size,
      symbols,
      imports,
      ...(failure === undefined ? {} : { failure })
    }
  )
}

const isWarning = (value: unknown): value is Summary['warnings'][number] =>
  isRecord(value) && typeof value.path === 'string' && typeof value.message === 'string'

const isCounts = (value: unknown): value is Summary['skipped'] =>
  isRecord(value) && Object.values(value).every(count => typeof count === 'number')

const isPackages = (value: unknown): value is Model['packages'] =>
  isRecord(value) && Object.values(value).every(pkg => isRecord(pkg) && isString(pkg.dir))

function isTarget(value: unknown, modules: UnknownRecord): value is Target {
  if (!isRecord(value)) return false
  if (value.kind === 'module') return isString(value.path) && Object.hasOwn(modules, value.path)
  if (value.kind === 'external') return isString(value.name)
  return value.kind === 'unresolved' && isString(value.specifier)
}

const isInternal = (value: unknown, packages: Model['packages']): value is Internal =>
  isRecord(value) &&
  isString(value.specifier) &&
  (value.reach === 'relative' || value.reach === 'unlisted') &&
  isString(value.package) &&
  Object.hasOwn(packages, value.package) &&
  (value.instead === undefined || isString(value.instead))

const isEdge = (
  value: unknown,
  modules: UnknownRecord,
  packages: Model['packages']
): value is Edge =>
  isRecord(value) &&
  isTarget(value.to, modules) &&
  isLine(value.line) &&
  isForm(value.form) &&
  isStrings(value.names) &&
  (value.renames === undefined || isRenames(value.renames)) &&
  typeof value.typeOnly === 'boolean' &&
  typeof value.dynamic === 'boolean' &&
  (value.loadTime === undefined || isStrings(value.loadTime)) &&
  isStrings(value.via) &&
  value.via.every(path => Object.hasOwn(modules, path)) &&
  (value.internal === undefined || isInternal(value.internal, packages))

const isModule = (
  path: string,
  value: unknown,
  modules: UnknownRecord,
  packages: Model['packages']
): value is ModuleFacts =>
  isRecord(value) &&
  value.path === path &&
  isString(value.hash) &&
  Array.isArray(value.symbols) &&
  value.symbols.every(symbol => symbolOf(symbol) !== undefined) &&
  Array.isArray(value.edges) &&
  value.edges.every(edge => isEdge(edge, modules, packages))

/**
 * The cached model, checked whole, so a damaged or hand-edited file is
 * analyzed again instead of reaching a command. Every module an edge names is
 * in the model, and every package an internal import names.
 */
function modelOf(value: unknown): Model | undefined {
  if (!isRecord(value) || value.format !== MODEL_FORMAT) return undefined
  const { repository, packages, modules } = value
  if (!isRecord(repository) || !isString(repository.name) || !isPackages(packages)) {
    return undefined
  }
  if (!isRecord(modules)) return undefined
  for (const [path, module] of Object.entries(modules)) {
    if (!isModule(path, module, modules, packages)) return undefined
  }
  return value as unknown as Model
}

export function cachedModelOf(value: unknown): CachedModel | undefined {
  if (!isRecord(value)) return undefined
  const { warnings, unresolved, skipped } = value
  if (!Array.isArray(warnings) || !warnings.every(isWarning)) return undefined
  if (typeof unresolved !== 'number' || !isCounts(skipped)) return undefined
  const model = modelOf(value.model)
  return model && { model, warnings, unresolved, skipped }
}
