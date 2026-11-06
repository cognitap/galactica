/**
 * How `init` and `html` write files. A repository can commit a symbolic link
 * where Galactica writes, so no path component below the folder the caller
 * trusts may be a link, and each file goes to a temporary file beside it that
 * is renamed into place.
 */

import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

/** A write refused because `link`, `target` itself or a folder above it, is a symbolic link. */
export class SymlinkRefused extends Error {
  readonly target: string
  readonly link: string
  constructor(target: string, link: string) {
    super(`refused to write ${target}: ${link} is a symbolic link`)
    this.target = target
    this.link = link
  }
}

export interface FileWrite {
  /** Absolute, below the folder written to. */
  readonly path: string
  readonly text: string
}

/** Whether `path` is below `folder`, judged from the paths alone. */
export function isBelow(folder: string, path: string): boolean {
  const rest = relative(folder, path)
  return rest !== '' && !rest.startsWith(`..${sep}`) && rest !== '..' && !isAbsolute(rest)
}

/** Each path from the first component below `folder` down to `path`. */
function componentsBelow(folder: string, path: string): readonly string[] {
  if (!isBelow(folder, path)) return []
  const parts = relative(folder, path).split(sep)
  return parts.map((_, index) => join(folder, ...parts.slice(0, index + 1)))
}

/** Throws `SymlinkRefused` when `path` or a folder between `folder` and it is a symbolic link. */
export function refuseLinks(folder: string, path: string): void {
  for (const component of componentsBelow(folder, path)) {
    const stat = lstatSync(component, { throwIfNoEntry: false })
    if (stat === undefined) return
    if (stat.isSymbolicLink()) throw new SymlinkRefused(path, component)
  }
}

/**
 * Writes every file below `folder`, creating missing folders, or writes none:
 * it checks every path before it writes, and renames the files into place only
 * once each is written beside its target.
 */
export function writeBelow(folder: string, files: readonly FileWrite[]): void {
  for (const { path } of files) refuseLinks(folder, path)
  const created: string[] = []
  const staged: string[] = []
  try {
    for (const { path, text } of files) {
      for (const component of componentsBelow(folder, dirname(path))) {
        if (lstatSync(component, { throwIfNoEntry: false }) !== undefined) continue
        mkdirSync(component)
        created.push(component)
      }
      const temporary = join(
        dirname(path),
        `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      )
      writeFileSync(temporary, text, { flag: 'wx' })
      staged.push(temporary)
    }
  } catch (error) {
    for (const temporary of staged) rmSync(temporary, { force: true })
    for (const directory of created.toReversed()) rmdirSync(directory)
    throw error
  }
  files.forEach(({ path }, index) => renameSync(staged[index]!, path))
}
