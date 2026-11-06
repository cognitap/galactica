/** Lexical containment of filesystem paths; callers check symbolic links separately. */

import { isAbsolute, relative, sep } from 'node:path'

const contained = (path: string) =>
  !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)

/** Whether `path` is `folder` itself or one of its descendants. */
export function isWithin(folder: string, path: string): boolean {
  return contained(relative(folder, path))
}

/** Whether `path` is a descendant of `folder`, excluding the folder itself. */
export function isBelow(folder: string, path: string): boolean {
  const rest = relative(folder, path)
  return rest !== '' && contained(rest)
}
