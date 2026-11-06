/**
 * The cache of what each module gives on its own, kept between runs, in a
 * folder of the user's that the mapped repository cannot reach. It is a
 * boundary: the file is parsed into typed entries here, and anything missing,
 * unreadable, corrupt or written by another build reads as an empty cache.
 * Writing it never fails a run, and deleting it is always safe.
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cacheEntryOf, type CacheEntry } from './cache-schema.ts'
import { isRecord, type UnknownRecord } from './json.ts'
import { compare, type RepoPath } from './model.ts'
import { isWithin } from './paths.ts'

export type { CacheEntry } from './cache-schema.ts'

export const CACHE_FORMAT = 6

export type Cache = ReadonlyMap<RepoPath, CacheEntry>

/** What produced a cache. A cache with any other stamp is discarded whole. */
export interface Stamp {
  readonly galactica: string
  /** A hash of Galactica's own code, since every build before a release shares one version. */
  readonly build: string
  /** The parser's output depends on its version. */
  readonly typescript: string
  /** The versions of the framework compilers, or `missing` when Galactica was installed without one. */
  readonly vue: string
  readonly svelte: string
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

const versionOf = (manifest: string) => String(JSON.parse(readFileSync(manifest, 'utf8')).version)

const require = createRequire(import.meta.url)

// Read from its package.json, so a warm run knows the stamp without loading the package.
function dependencyVersion(name: string): string {
  try {
    return versionOf(require.resolve(`${name}/package.json`))
  } catch {
    return 'missing'
  }
}

export function currentStamp(): Stamp {
  return {
    galactica: versionOf(join(here, '..', 'package.json')),
    build: buildHash(),
    typescript: dependencyVersion('typescript'),
    vue: dependencyVersion('@vue/compiler-sfc'),
    svelte: dependencyVersion('svelte')
  }
}

export interface Environment {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly home: string
}

function currentEnvironment(): Environment {
  let home = ''
  try {
    home = homedir()
  } catch {}
  return { platform: process.platform, env: process.env, home }
}

function userCacheDirectory({ platform, env, home }: Environment): string {
  if (platform === 'darwin') return join(home, 'Library', 'Caches')
  const local = platform === 'win32' ? env.LOCALAPPDATA : env.XDG_CACHE_HOME
  if (local !== undefined && isAbsolute(local)) return local
  return platform === 'win32' ? join(home, 'AppData', 'Local') : join(home, '.cache')
}

/**
 * The cache folder of `root`: in the user's cache directory, in a folder
 * named by a hash of the root's real path, created for this user alone. The
 * repository being mapped must never supply its own cache, so there is none
 * when that folder is not this user's own directory, is a symlink, or lies
 * inside the root, and none without an absolute user cache directory.
 */
export function cacheDirectory(
  root: string,
  environment = currentEnvironment()
): string | undefined {
  const base = userCacheDirectory(environment)
  if (!isAbsolute(base)) return undefined
  try {
    const real = realpathSync(root)
    const key = createHash('sha256').update(real).digest('hex').slice(0, 16)
    const directory = join(base, 'galactica', key)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const stat = lstatSync(directory)
    const uid = process.getuid?.()
    if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid)) return undefined
    return isWithin(real, realpathSync(directory)) ? undefined : directory
  } catch {
    return undefined
  }
}

const cacheFile = (directory: string) => join(directory, 'cache.json')

export const sameStamp = (file: UnknownRecord, stamp: Stamp) =>
  file.galactica === stamp.galactica &&
  file.build === stamp.build &&
  file.typescript === stamp.typescript &&
  file.vue === stamp.vue &&
  file.svelte === stamp.svelte

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
      const entry = cacheEntryOf(value)
      return entry ? [[path as RepoPath, entry] as const] : []
    })
  )
}

/**
 * Replaces `file` by renaming a complete file over it, so a reader sees the
 * old file or the new one, never part of one. Of two runs that write at once
 * the last rename wins, and either file is valid. Never throws.
 */
export function replaceFile(file: string, text: string): void {
  const directory = dirname(file)
  const temporary = join(
    directory,
    `${basename(file)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  )
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    try {
      rmSync(temporary, { force: true })
    } catch {}
  }
}

export function writeCache(directory: string, stamp: Stamp, cache: Cache): void {
  const modules = Object.fromEntries([...cache].sort(([a], [b]) => compare(a, b)))
  replaceFile(cacheFile(directory), JSON.stringify({ format: CACHE_FORMAT, ...stamp, modules }))
}
