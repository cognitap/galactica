/**
 * The git reads behind the page's source links: the remote, the commit the
 * links point to, where the root sits in the repository, and whether tracked
 * files have changed since. Anything git cannot answer means no links.
 */

import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { git } from './repository-files.ts'
import { chosenRemote, githubTemplate, pageSource, type PageSource } from './source-links.ts'

const output = (root: string, ...args: string[]) => {
  const result = git(root, args)
  return result.status === 0 ? result.stdout.trim() : undefined
}

function remotesOf(root: string): Readonly<Record<string, string>> {
  const names = (output(root, 'remote') ?? '').split('\n').filter(name => name !== '')
  return Object.fromEntries(
    names.flatMap(name => {
      const url = output(root, 'remote', 'get-url', name)
      return url === undefined ? [] : [[name, url]]
    })
  )
}

/**
 * The page's source links for the repository at `root`, from `template` or else
 * from a GitHub remote. Undefined when there is no commit, no tracked file
 * under `root`, or no template to use.
 */
export function pageSourceOf(root: string, template?: string): PageSource | undefined {
  const commit = output(root, 'rev-parse', 'HEAD')
  const toplevel = output(root, 'rev-parse', '--show-toplevel')
  if (commit === undefined || toplevel === undefined) return undefined
  if (!output(root, 'ls-files', '--cached', '--', '.')) return undefined
  const chosen = template ?? githubTemplate(chosenRemote(remotesOf(root)) ?? '')
  if (chosen === undefined) return undefined
  const prefix = relative(realpathSync(toplevel), realpathSync(root)).split(sep).join('/')
  const uncommitted = output(root, 'status', '--porcelain', '--untracked-files=no') !== ''
  return pageSource(chosen, { commit, prefix, uncommitted })
}
