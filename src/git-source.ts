/**
 * The git reads behind the page's source links: the remote, the commit the
 * links point to, where the root sits in the repository, and whether tracked
 * files have changed since. Anything git cannot answer means no links.
 */

import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { git } from './repository-files.ts'
import {
  chosenRemote,
  githubTemplate,
  linkBase,
  pageSource,
  type PageSource
} from './source-links.ts'

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
 * The commit the links point to: HEAD when the remote has it, else the merge
 * base of HEAD with the remote's newest commit, read from local refs only, else
 * HEAD as the best that can be done.
 */
function linkedCommit(root: string, remote: string, head: string): string {
  const remoteHasHead =
    output(
      root,
      'for-each-ref',
      '--contains',
      head,
      '--format=%(refname)',
      `refs/remotes/${remote}/`
    ) !== ''
  const base = linkBase({
    remote,
    remoteHasHead,
    upstream: output(root, 'rev-parse', '--abbrev-ref', '@{upstream}'),
    exists: ref => output(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== undefined
  })
  return (base !== undefined && output(root, 'merge-base', head, base)) || head
}

/**
 * The page's source links for the repository at `root`, from `template` or else
 * from a GitHub remote. Undefined when there is no commit, no tracked file
 * under `root`, or no template to use.
 */
export function pageSourceOf(root: string, template?: string): PageSource | undefined {
  const head = output(root, 'rev-parse', 'HEAD')
  const toplevel = output(root, 'rev-parse', '--show-toplevel')
  if (head === undefined || toplevel === undefined) return undefined
  if (!output(root, 'ls-files', '--cached', '--', '.')) return undefined
  const remotes = remotesOf(root)
  const remote = chosenRemote(remotes)
  const chosen = template ?? (remote === undefined ? undefined : githubTemplate(remotes[remote]!))
  if (chosen === undefined) return undefined
  const commit = remote === undefined ? head : linkedCommit(root, remote, head)
  const unpushed = Number(output(root, 'rev-list', '--count', `${commit}..${head}`) ?? 0)
  const prefix = relative(realpathSync(toplevel), realpathSync(root)).split(sep).join('/')
  const uncommitted = output(root, 'status', '--porcelain', '--untracked-files=no') !== ''
  return pageSource(chosen, { commit, prefix, uncommitted, unpushed, remote: remote ?? '' })
}
