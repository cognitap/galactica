/**
 * Which files a repository has. In a git work tree that is what git tracks or
 * would track, so `.gitignore` applies exactly. Outside one, or in a folder
 * that an enclosing repository ignores, a walk of the directory tree, which
 * reads no ignore file.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import type { Inputs } from './inputs.ts'
import { parseRepoPath, type RepoPath } from './model.ts'

/** Build output and installed packages. Skipped at any depth, even when git tracks them. */
const skippedDirectories: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.vercel',
  'storybook-static'
])

function inSkippedDirectory(path: string): boolean {
  return path
    .split('/')
    .slice(0, -1)
    .some(segment => skippedDirectories.has(segment))
}

/**
 * Variables that point git at a repository. A git hook or `rebase --exec`
 * exports them, and git obeys them over `cwd`, so without this a run inside
 * one repository's hook would list, or with `git init` rewrite, another's.
 */
const repositoryLocation = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX'
]

/** The environment for a git command that must act on the repository at its `cwd`. */
export function gitEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !repositoryLocation.includes(name))
  )
}

/**
 * Options for every command. The repository's own config, which an archive
 * with its `.git` brings along, can name a program for `core.fsmonitor`, and
 * git runs it whenever it reads the index. `--no-optional-locks` keeps
 * `status` from writing the index, which would change the repository and run
 * its `post-index-change` hook. The other config keys that run a program,
 * such as `core.sshCommand`, `credential.helper` or `diff.external`, apply to
 * no command Galactica runs.
 */
const safely = ['-c', 'core.fsmonitor=false', '--no-optional-locks']

export function git(root: string, args: readonly string[]) {
  return spawnSync('git', [...safely, ...args], {
    cwd: root,
    env: gitEnvironment(),
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'ignore']
  })
}

/**
 * Whether `git ls-files` run in `root` lists its files. It does not when
 * `root` is no work tree, or sits in a folder that an enclosing repository
 * ignores, where git lists nothing.
 */
function listedByGit(root: string): boolean {
  if (existsSync(join(root, '.git'))) return true
  const toplevel = git(root, ['rev-parse', '--show-toplevel'])
  if (toplevel.status !== 0) return false
  const inside = relative(toplevel.stdout.trimEnd(), realpathSync(root))
  return inside === '' || git(root, ['check-ignore', '--quiet', '.']).status === 1
}

/** What `git ls-files` prints for `root`, NUL-separated, or undefined when git does not list it. */
export function gitListing(root: string): string | undefined {
  if (!listedByGit(root)) return undefined
  const result = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  return result.status === 0 ? result.stdout : undefined
}

function gitFiles(root: string, listing: string): readonly string[] {
  // --cached lists files deleted from the work tree until the deletion is staged.
  return [...new Set(listing.split('\0'))].filter(
    path => path !== '' && existsSync(join(root, path))
  )
}

type Listing = Pick<Inputs, 'gitListing' | 'readdir'>

function walkedFiles(root: string, listing: Listing, dir = ''): readonly string[] {
  return listing.readdir(join(root, dir)).flatMap(entry => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      return entry.name === '.git' || skippedDirectories.has(entry.name)
        ? []
        : walkedFiles(root, listing, path)
    }
    return entry.isFile() ? [path] : []
  })
}

const fromDisk: Listing = {
  gitListing,
  readdir: path => readdirSync(path, { withFileTypes: true })
}

/**
 * The largest module Galactica reads, in bytes. The largest module in eight
 * large clones, vscode, Next.js, TypeScript, Babel, Yarn Berry, Nx, Deno's
 * std and fresh, is an 8.4 MB test fixture of vscode, and the largest
 * hand-written one is a 3.2 MB copy of TypeScript's `checker.ts`.
 */
const maxModuleBytes = 10_000_000

/**
 * Why the module at `path` is not read, or undefined when it is: when it is
 * no regular file of at most `maxModuleBytes` within `root` once its links
 * are followed. A link to `/dev/zero` would never finish reading, and a link
 * out of the root would put a file from elsewhere on the machine into the
 * output. A link within the root is read from its target, as the
 * repository holds those bytes anyway.
 */
export function unreadable(root: string): (path: RepoPath) => string | undefined {
  const realRoot = realpathSync.native(root)
  const within = (path: string) => {
    const inside = relative(realRoot, realpathSync.native(join(root, path)))
    return inside.split(sep)[0] !== '..' && !isAbsolute(inside)
  }
  // A folder can be a link too, when an index that came with an archive lists
  // files under a path the work tree links elsewhere.
  const folders = new Map<string, boolean>([['.', true]])
  const folderWithin = (folder: string): boolean => {
    let inside = folders.get(folder)
    if (inside === undefined) {
      inside =
        folderWithin(posix.dirname(folder)) &&
        (!lstatSync(join(root, folder)).isSymbolicLink() || within(folder))
      folders.set(folder, inside)
    }
    return inside
  }
  return path => {
    const link = lstatSync(join(root, path))
    const inside = link.isSymbolicLink() ? within(path) : folderWithin(posix.dirname(path))
    if (!inside) return 'links outside the repository'
    const stat = link.isSymbolicLink() ? statSync(join(root, path)) : link
    if (!stat.isFile()) return 'is not a regular file'
    if (stat.size > maxModuleBytes) return `is over ${maxModuleBytes / 1_000_000} MB`
    return undefined
  }
}

/** Every file under `root` outside the skipped directories, unsorted. */
export function repositoryFiles(root: string, listing: Listing = fromDisk): readonly RepoPath[] {
  const listed = listing.gitListing(root)
  const files = listed === undefined ? walkedFiles(root, listing) : gitFiles(root, listed)
  return files.filter(path => !inSkippedDirectory(path)).map(parseRepoPath)
}
