/**
 * Where a module or symbol lives in the repository host: reading a git remote,
 * checking a link template, and filling it for the page. All pure, so the git
 * reads stay at the boundary in `git-source.ts`.
 *
 * A template is a URL with the placeholders `{commit}`, `{path}` and `{line}`.
 */

export const GITHUB_HOST = 'github.com'

/** What the page needs to build a link: the template with `{commit}` filled in, and where the root sits. */
export interface PageSource {
  readonly template: string
  /** The root's directory within the repository, "" when the root is the repository's top level. */
  readonly prefix: string
  readonly shortCommit: string
  /** Whether tracked files differ from the commit the links point to. */
  readonly uncommitted: boolean
}

const GITHUB_SLUG = /^[\w.-]+$/

const scpRemote = /^(?:[\w.-]+@)?github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i

const urlProtocols: ReadonlySet<string> = new Set(['https:', 'http:', 'ssh:', 'git:', 'git+ssh:'])

function ownerAndRepository(remote: string): readonly [string, string] | undefined {
  const scp = scpRemote.exec(remote)
  if (scp !== null) return [scp[1]!, scp[2]!]
  let url
  try {
    url = new URL(remote)
  } catch {
    return undefined
  }
  if (!urlProtocols.has(url.protocol) || url.hostname.toLowerCase() !== GITHUB_HOST)
    return undefined
  const segments = url.pathname.replace(/\.git\/?$|\/$/, '').split('/')
  return segments.length === 3 && segments[0] === '' ? [segments[1]!, segments[2]!] : undefined
}

/** The GitHub link template for a git remote URL, or undefined for any other host or a malformed remote. */
export function githubTemplate(remote: string): string | undefined {
  const parsed = ownerAndRepository(remote.trim())
  if (
    parsed === undefined ||
    !parsed.every(part => GITHUB_SLUG.test(part) && !/^\.+$/.test(part))
  ) {
    return undefined
  }
  const [owner, repository] = parsed
  return `https://${GITHUB_HOST}/${owner}/${repository}/blob/{commit}/{path}#L{line}`
}

/** Why a template cannot be used, or undefined when it can. */
export function templateProblem(template: string): string | undefined {
  if (!/^https?:\/\//i.test(template))
    return 'a source URL template must start with http:// or https://'
  if (!template.includes('{path}')) return 'a source URL template must contain {path}'
  return undefined
}

/** The remote to read links from: `origin`, else the first by name. */
export function chosenRemote(remotes: Readonly<Record<string, string>>): string | undefined {
  const name = Object.hasOwn(remotes, 'origin') ? 'origin' : Object.keys(remotes).sort()[0]
  return name === undefined ? undefined : remotes[name]
}

export function pageSource(
  template: string,
  facts: { readonly commit: string; readonly prefix: string; readonly uncommitted: boolean }
): PageSource {
  return {
    template: template.replaceAll('{commit}', () => facts.commit),
    prefix: facts.prefix,
    shortCommit: facts.commit.slice(0, 7),
    uncommitted: facts.uncommitted
  }
}
