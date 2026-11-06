/** One policy for bytes read from a mapped repository, including configuration files. */

import { lstatSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { toRepoPath } from './model.ts'
import { unreadable } from './repository-files.ts'

export class UnsafeReadError extends Error {
  readonly file: string
  readonly reason: string

  constructor(file: string, reason: string) {
    super(`refused to read ${basename(file)}: ${reason}`)
    this.file = file
    this.reason = reason
  }
}

interface Reader<T> {
  readonly fileExists: (file: string) => boolean
  readonly readFile: (file: string) => T | undefined
  readonly stat?: (file: string) => unknown
}

/** Checks the shared regular-file/root/size policy before invoking any byte reader. */
export function readRepositoryFile<T>(root: string, file: string, reader: Reader<T>): T {
  // Preserve the input recorder's probe even when the read is refused.
  reader.fileExists(file)
  let path
  try {
    path = toRepoPath(resolve(root), resolve(file))
  } catch {
    throw new UnsafeReadError(file, 'is outside the repository')
  }
  const entry = lstatSync(file, { throwIfNoEntry: false })
  if (entry === undefined) {
    const error: NodeJS.ErrnoException = new Error('file does not exist')
    error.code = 'ENOENT'
    throw error
  }
  // Refused existing files must invalidate a cached model when they are repaired in place.
  try {
    reader.stat?.(file)
  } catch {
    /* The policy check below reports broken links. */
  }
  let problem
  try {
    problem = unreadable(root)(path)
  } catch {
    throw new UnsafeReadError(file, 'cannot be inspected or its symbolic link cannot be followed')
  }
  if (problem !== undefined) throw new UnsafeReadError(file, problem)
  const value = reader.readFile(file)
  if (value === undefined) throw new UnsafeReadError(file, 'could not be read')
  return value
}

export const missingFile = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  ['ENOENT', 'ENOTDIR'].includes(error.code)

/** The policy refusal when known, otherwise the caller's context for an ordinary read failure. */
export const readProblem = (error: unknown, fallback: string): string =>
  error instanceof UnsafeReadError ? error.message : fallback
