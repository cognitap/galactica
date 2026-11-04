/**
 * The cache of what each module gives on its own, kept between runs. It is a
 * boundary: the file is parsed into typed entries here, and anything missing,
 * unreadable, corrupt or written by another build reads as an empty cache.
 * Writing it never fails a run, and deleting it is always safe.
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { symbolKinds } from './contract.ts'
import type { Extraction } from './extraction.ts'
import type { Import, ImportSyntax } from './imports.ts'
import { compare, type RepoPath, type SymbolFacts } from './model.ts'

export const CACHE_FORMAT = 1

export interface CacheEntry extends Extraction {
  readonly mtimeMs: number
  readonly size: number
}

export type Cache = ReadonlyMap<RepoPath, CacheEntry>

/** What produced a cache. A cache with any other stamp is discarded whole. */
export interface Stamp {
  readonly galactica: string
  /** A hash of Galactica's own code, since every build before a release shares one version. */
  readonly build: string
  /** The parser's output depends on its version. */
  readonly typescript: string
}

const here = dirname(fileURLToPath(import.meta.url))

function buildHash(): string {
  const hash = createHash('sha256')
  const files = readdirSync(here)
    .filter(name => extname(name) === extname(import.meta.url))
    .sort(compare)
  for (const name of files) {
    hash.update(`${name}\0`).update(readFileSync(join(here, name)))
  }
  return hash.digest('hex')
}

export function currentStamp(): Stamp {
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
  return { galactica: String(pkg.version), build: buildHash(), typescript: ts.version }
}

export interface Environment {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
}

const currentEnvironment = (): Environment => ({
  platform: process.platform,
  env: process.env,
  home: homedir()
})

function userCacheDirectory({ platform, env, home }: Environment): string {
  if (platform === 'darwin') return join(home, 'Library', 'Caches')
  if (platform === 'win32') return env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  const xdg = env.XDG_CACHE_HOME
  return xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, '.cache')
}

/**
 * Where the cache of `root` lives: under its `node_modules/.cache`, which
 * every repository already ignores, else in the user's cache directory, in a
 * folder named by a hash of the root's absolute path.
 */
export function cacheDirectory(root: string, environment = currentEnvironment()): string {
  const absolute = resolve(root)
  const nodeModules = join(absolute, 'node_modules')
  if (statSync(nodeModules, { throwIfNoEntry: false })?.isDirectory()) {
    return join(nodeModules, '.cache', 'galactica')
  }
  const key = createHash('sha256').update(absolute).digest('hex').slice(0, 16)
  return join(userCacheDirectory(environment), 'galactica', key)
}

const cacheFile = (directory: string) => join(directory, 'cache.json')

type Unknown = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Unknown =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

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

function importOf(value: unknown): Import | undefined {
  if (!isRecord(value)) return undefined
  const { specifier, syntax, resolutionMode, line, form, names, renames, typeOnly, dynamic } = value
  if (!isString(specifier) || !isSyntax(syntax) || !isLine(line) || !isForm(form)) return undefined
  if (!isStrings(names) || typeof typeOnly !== 'boolean' || typeof dynamic !== 'boolean') {
    return undefined
  }
  if (resolutionMode !== undefined && !isMode(resolutionMode)) return undefined
  if (renames !== undefined && !isRenames(renames)) return undefined
  return {
    specifier,
    syntax,
    ...(resolutionMode === undefined ? {} : { resolutionMode }),
    line,
    form,
    names,
    ...(renames === undefined ? {} : { renames }),
    typeOnly,
    dynamic
  }
}

function every<T>(values: unknown, parse: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(values)) return undefined
  const parsed = values.map(parse)
  return parsed.every(value => value !== undefined) ? parsed : undefined
}

function entryOf(value: unknown): CacheEntry | undefined {
  if (!isRecord(value)) return undefined
  const { hash, mtimeMs, size } = value
  const symbols = every(value.symbols, symbolOf)
  const imports = every(value.imports, importOf)
  if (!isString(hash) || typeof mtimeMs !== 'number' || typeof size !== 'number') return undefined
  return symbols && imports && { hash, mtimeMs, size, symbols, imports }
}

const sameStamp = (file: Unknown, stamp: Stamp) =>
  file.galactica === stamp.galactica &&
  file.build === stamp.build &&
  file.typescript === stamp.typescript

/** The cache in `directory`, empty unless its format and stamp match. An entry that does not parse is left out. */
export function readCache(directory: string, stamp: Stamp): Cache {
  let file: unknown
  try {
    file = JSON.parse(readFileSync(cacheFile(directory), 'utf8'))
  } catch {
    return new Map()
  }
  if (!isRecord(file) || file.format !== CACHE_FORMAT || !sameStamp(file, stamp)) return new Map()
  if (!isRecord(file.modules)) return new Map()
  return new Map(
    Object.entries(file.modules).flatMap(([path, value]) => {
      const entry = entryOf(value)
      return entry ? [[path as RepoPath, entry] as const] : []
    })
  )
}

/**
 * Replaces the cache in `directory` by renaming a complete file over it, so a
 * reader sees the old cache or the new one, never part of one. Of two runs
 * that write at once the last rename wins, and either cache is valid.
 */
export function writeCache(directory: string, stamp: Stamp, cache: Cache): void {
  const modules = Object.fromEntries([...cache].sort(([a], [b]) => compare(a, b)))
  const text = JSON.stringify({ format: CACHE_FORMAT, ...stamp, modules })
  const temporary = join(directory, `cache.${process.pid}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporary, text)
    renameSync(temporary, cacheFile(directory))
  } catch {
    try {
      rmSync(temporary, { force: true })
    } catch {}
  }
}
