/**
 * Which files a repository has. In a git work tree that is what git tracks or
 * would track, so `.gitignore` applies exactly. Outside one, a walk of the
 * directory tree, which reads no ignore file.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

function gitFiles(root: string): readonly string[] | undefined {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  if (result.status !== 0) return undefined
  // --cached lists files deleted from the work tree until the deletion is staged.
  return [...new Set(result.stdout.split('\0'))].filter(
    path => path !== '' && existsSync(join(root, path))
  )
}

function walkedFiles(root: string, dir = ''): readonly string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      return entry.name === '.git' || skippedDirectories.has(entry.name)
        ? []
        : walkedFiles(root, path)
    }
    return entry.isFile() ? [path] : []
  })
}

/** Every file under `root` outside the skipped directories, unsorted. */
export function repositoryFiles(root: string): readonly RepoPath[] {
  return (gitFiles(root) ?? walkedFiles(root))
    .filter(path => !inSkippedDirectory(path))
    .map(parseRepoPath)
}
