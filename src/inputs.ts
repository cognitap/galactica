/**
 * What an analysis takes from the machine beyond its modules' bytes, and
 * whether any of it has changed since. A full run records every file it
 * stats or reads, every directory whose entries decided a probe, the
 * repository's listing and the framework compilers it found. A warm run
 * checks the record with stats alone, so the derived model is reused only
 * when every input is as it was, and nothing is read, TypeScript included,
 * to find that out.
 */

import { createHash } from 'node:crypto'
import { readdirSync, statSync, type Dirent } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type ts from 'typescript'
import { languages, type Language } from './contract.ts'
import { compilerResolver, type Compiler } from './frameworks.ts'
import type { Config, RepoPath } from './model.ts'
import { gitListing } from './repository-files.ts'

export interface FileStat {
  readonly mtimeMs: number
  readonly size: number
}

/** The reads an analysis makes. A module's bytes are read after `stat`, so the stat is what a record keeps. */
export interface Inputs {
  readonly fileExists: (path: string) => boolean
  readonly directoryExists: (path: string) => boolean
  /** As TypeScript reads a file: undefined when it cannot, byte order marks decoded. */
  readonly readFile: (path: string) => string | undefined
  readonly realpath: (path: string) => string
  readonly getDirectories: (path: string) => string[]
  readonly readdir: (path: string) => readonly Dirent[]
  /** Throws when there is no file. */
  readonly stat: (path: string) => FileStat
  /** What `git ls-files` prints for the root, or undefined when git does not list it. */
  readonly gitListing: (root: string) => string | undefined
  readonly compilerOf: (language: Language, dir: RepoPath) => Compiler | undefined
}

/** The machine as it is, read through TypeScript's `sys` where TypeScript reads. */
export function plainInputs(root: string, sys: ts.System): Inputs {
  return {
    fileExists: sys.fileExists,
    directoryExists: sys.directoryExists,
    readFile: sys.readFile,
    realpath: sys.realpath ?? (path => path),
    getDirectories: sys.getDirectories,
    readdir: path => readdirSync(path, { withFileTypes: true }),
    stat: path => statSync(path),
    gitListing,
    compilerOf: compilerResolver(root)
  }
}

/**
 * Everything a model was derived from, as stats. Paths under the root are
 * relative to it. A directory's mtime changes when an entry is added, removed
 * or renamed, so it stands for every probe of its entries, existing or not.
 * A probe outside the root records the probed path itself instead, since a
 * directory above the root changes for reasons of its own.
 */
export interface Fingerprint {
  /** A hash of the `Config` the analysis took. */
  readonly config: string
  /** A hash of git's listing, or null when the files were walked. */
  readonly git: string | null
  /** Directories under the root. Null when the directory was absent. */
  readonly directories: readonly (readonly [path: string, mtimeMs: number | null])[]
  /** Files read or stat-ed, and paths probed outside the root. Null when the path was absent. */
  readonly files: readonly (readonly [
    path: string,
    stat: readonly [mtimeMs: number, size: number] | null
  ])[]
  readonly compilers: readonly (readonly [language: Language, dir: RepoPath, stamp: string])[]
}

export interface Recorder {
  readonly inputs: Inputs
  /** The record, or undefined when a timestamp is too fresh to trust. */
  readonly fingerprint: () => Fingerprint | undefined
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

function directoryMtime(path: string): number | null {
  const stat = statSync(path, { throwIfNoEntry: false })
  return stat?.isDirectory() ? stat.mtimeMs : null
}

/** The stat of whatever is at `path`, a directory included, or null when nothing is. */
function statOf(path: string): FileStat | null {
  const stat = statSync(path, { throwIfNoEntry: false })
  return stat ? { mtimeMs: stat.mtimeMs, size: stat.size } : null
}

// The prefix answers the normalized paths TypeScript and `join` build, which is
// all of them on POSIX. `relative` answers a path with the other separator.
function isInside(root: string, path: string): boolean {
  if (path === root || path.startsWith(root + sep)) return true
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function shorten(root: string, path: string): string {
  if (path === root) return '.'
  if (path.startsWith(root + sep))
    return path
      .slice(root.length + 1)
      .split(sep)
      .join('/')
  return isInside(root, path) ? relative(root, path).split(sep).join('/') : path
}

const lengthen = (root: string, path: string) => (isAbsolute(path) ? path : join(root, path))

/**
 * Whether a timestamp could hide a change. A filesystem that keeps whole
 * seconds gives a file changed twice within one second the same mtime, so a
 * record made within that second would still match after the second change.
 */
const racy = (mtimeMs: number, start: number) => mtimeMs % 1000 === 0 && mtimeMs >= start - 2000

/** Reads as `plainInputs` does and records each read before it happens, so a change during the run reads as a change. */
export function recordInputs(root: string, sys: ts.System, config: Config): Recorder {
  const start = Date.now()
  const plain = plainInputs(root, sys)
  const directories = new Map<string, number | null>()
  const files = new Map<string, FileStat | null>()
  const compilers = new Map<string, Fingerprint['compilers'][number]>()
  let git: string | null = null

  const directory = (path: string) => {
    if (!directories.has(path)) directories.set(path, directoryMtime(path))
  }
  const file = (path: string) => {
    if (!files.has(path)) files.set(path, statOf(path))
  }
  /** What decides a probe of `path`: its directory's entries under the root, the path itself outside. */
  const probed = (path: string) => {
    const parent = dirname(path)
    if (isInside(root, parent)) directory(parent)
    else file(path)
  }
  const read = (path: string) => {
    probed(path)
    file(path)
  }
  directory(root)

  const inputs: Inputs = {
    fileExists(path) {
      probed(path)
      return plain.fileExists(path)
    },
    directoryExists(path) {
      probed(path)
      return plain.directoryExists(path)
    },
    readFile(path) {
      read(path)
      return plain.readFile(path)
    },
    realpath(path) {
      probed(path)
      return plain.realpath(path)
    },
    getDirectories(path) {
      if (isInside(root, path)) directory(path)
      else file(path)
      return plain.getDirectories(path)
    },
    readdir(path) {
      directory(path)
      return plain.readdir(path)
    },
    stat(path) {
      probed(path)
      const stat = plain.stat(path)
      if (!files.has(path)) files.set(path, { mtimeMs: stat.mtimeMs, size: stat.size })
      return stat
    },
    gitListing(listedRoot) {
      const listing = plain.gitListing(listedRoot)
      git = listing === undefined ? null : sha256(listing)
      for (const path of listing?.split('\0') ?? []) {
        if (path !== '') directory(dirname(join(listedRoot, path)))
      }
      return listing
    },
    compilerOf(language, dir) {
      const compiler = plain.compilerOf(language, dir)
      if (compiler) compilers.set(`${language}\0${dir}`, [language, dir, compiler.stamp])
      return compiler
    }
  }

  return {
    inputs,
    fingerprint() {
      const stamps = [...directories.values(), ...[...files.values()].map(stat => stat?.mtimeMs)]
      if (stamps.some(mtimeMs => mtimeMs != null && racy(mtimeMs, start))) return undefined
      return {
        config: sha256(JSON.stringify(config)),
        git,
        directories: [...directories].map(([path, mtimeMs]) => [shorten(root, path), mtimeMs]),
        files: [...files].map(([path, stat]) => [
          shorten(root, path),
          stat && [stat.mtimeMs, stat.size]
        ]),
        compilers: [...compilers.values()]
      }
    }
  }
}

/** Whether every recorded input is as the record says. A path that cannot be read counts as changed. */
export function unchanged(root: string, fingerprint: Fingerprint, config: Config): boolean {
  if (sha256(JSON.stringify(config)) !== fingerprint.config) return false
  try {
    for (const [path, mtimeMs] of fingerprint.directories) {
      if (directoryMtime(lengthen(root, path)) !== mtimeMs) return false
    }
    for (const [path, stat] of fingerprint.files) {
      const now = statOf(lengthen(root, path))
      if (now?.mtimeMs !== stat?.[0] || now?.size !== stat?.[1]) return false
    }
  } catch {
    return false
  }
  const compilerOf = compilerResolver(root)
  for (const [language, dir, stamp] of fingerprint.compilers) {
    if (compilerOf(language, dir)?.stamp !== stamp) return false
  }
  const listing = gitListing(root)
  if (fingerprint.git === null) return listing === undefined
  return listing !== undefined && sha256(listing) === fingerprint.git
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isNumber = (value: unknown): value is number => typeof value === 'number'

const isTuple = (value: unknown, length: number): value is readonly unknown[] =>
  Array.isArray(value) && value.length === length

const isLanguage = (value: unknown): value is Language =>
  (languages as readonly unknown[]).includes(value)

const isDirectory = (value: unknown): value is Fingerprint['directories'][number] =>
  isTuple(value, 2) && isString(value[0]) && (value[1] === null || isNumber(value[1]))

const isFile = (value: unknown): value is Fingerprint['files'][number] =>
  isTuple(value, 2) &&
  isString(value[0]) &&
  (value[1] === null || (isTuple(value[1], 2) && value[1].every(isNumber)))

const isCompiler = (value: unknown): value is Fingerprint['compilers'][number] =>
  isTuple(value, 3) && isLanguage(value[0]) && isString(value[1]) && isString(value[2])

/** The fingerprint a cache file holds, or undefined when it has another shape. */
export function fingerprintOf(value: unknown): Fingerprint | undefined {
  if (!isRecord(value)) return undefined
  const { config, git, directories, files, compilers } = value
  if (!isString(config) || !(git === null || isString(git))) return undefined
  if (!Array.isArray(directories) || !directories.every(isDirectory)) return undefined
  if (!Array.isArray(files) || !files.every(isFile)) return undefined
  if (!Array.isArray(compilers) || !compilers.every(isCompiler)) return undefined
  return { config, git, directories, files, compilers }
}
