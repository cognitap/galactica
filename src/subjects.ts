/**
 * What a command argument names. `uses` and `deps` take a module, a workspace
 * package or an area, and `outline` takes a module. A path reads from the
 * current directory and from the repository root.
 */

import { posix } from 'node:path'
import type { Failure, Subject } from './contract.ts'
import {
  compare,
  parseRepoPath,
  type AreaPath,
  type Graph,
  type PackageName,
  type RepoPath
} from './model.ts'
import { isSourceOrConfig } from './source-file.ts'

export interface Resolved {
  readonly subject: Subject
  /**
   * The modules the subject stands for. An area or a package is its source and
   * config modules. Its tests and stories use it like any other test or story.
   */
  readonly members: ReadonlySet<RepoPath>
}

export type Miss = { readonly error: Failure['error'] }

const isAbsolute = (text: string) => /^([A-Za-z]:)?[\\/]/.test(text)

function parsed(raw: string): RepoPath | undefined {
  try {
    return parseRepoPath(raw)
  } catch {
    return undefined
  }
}

/** The repository paths `text` can mean, from the current directory and from the root. */
export function readingsOf(text: string, cwd: RepoPath | undefined): readonly RepoPath[] {
  if (isAbsolute(text)) return []
  const slashed = text.replaceAll('\\', '/')
  const readings = [
    cwd === undefined ? undefined : parsed(posix.join(cwd, slashed)),
    parsed(slashed)
  ]
  return [...new Set(readings.filter(path => path !== undefined))]
}

type Rule = (graph: Graph, text: string, readings: readonly RepoPath[]) => readonly Resolved[]

export function moduleSubject(graph: Graph, path: RepoPath): Resolved {
  const { package: name } = graph.modules.get(path)!
  return { subject: { kind: 'module', path, package: name }, members: new Set([path]) }
}

const moduleRule: Rule = (graph, _text, readings) =>
  readings.filter(path => graph.modules.has(path)).map(path => moduleSubject(graph, path))

const sourceOrConfig = (graph: Graph, paths: Iterable<RepoPath>): ReadonlySet<RepoPath> =>
  new Set([...paths].filter(path => isSourceOrConfig(graph.modules.get(path)!.kind)))

export function areaSubject(graph: Graph, path: AreaPath): Resolved {
  const area = graph.areas.get(path)!
  return {
    subject: { kind: 'area', path: area.path, package: area.package },
    members: sourceOrConfig(graph, area.modules)
  }
}

function packageSubject(graph: Graph, name: PackageName): Resolved {
  const { dir } = graph.packages.get(name)!
  const paths = graph.paths.filter(path => graph.modules.get(path)!.package === name)
  return { subject: { kind: 'package', name, dir }, members: sourceOrConfig(graph, paths) }
}

const packageNameRule: Rule = (graph, text) =>
  graph.packages.has(text as PackageName) ? [packageSubject(graph, text as PackageName)] : []

const packageDirRule: Rule = (graph, _text, readings) =>
  [...graph.packages]
    .filter(([, { dir }]) => readings.includes(dir))
    .map(([name]) => packageSubject(graph, name))

const areaRule: Rule = (graph, _text, readings) =>
  readings
    .map(path => path as string as AreaPath)
    .filter(path => graph.areas.has(path))
    .map(path => areaSubject(graph, path))

/** In order. The first rule that matches anything decides. */
const subjectRules: readonly Rule[] = [moduleRule, packageNameRule, packageDirRule, areaRule]

function describe(subject: Subject): string {
  return subject.kind === 'package' ? `package ${subject.name}` : `${subject.kind} ${subject.path}`
}

/** Up to three paths that end with `text`, shortest first, with or without their extension. */
export function similarPaths(paths: Iterable<string>, text: string): readonly string[] {
  const tail = text.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
  if (tail === '') return []
  return [...paths]
    .filter(path => path.endsWith(tail) || path.replace(/\.[^./]+$/, '').endsWith(tail))
    .sort((a, b) => a.length - b.length || compare(a, b))
    .slice(0, 3)
}

function notFound(what: string, text: string, similar: readonly string[]): Miss {
  const hint = similar.length === 0 ? '' : `. Did you mean ${similar.join(', ')}?`
  return { error: { code: 'not-found', message: `no ${what} named ${text}${hint}` } }
}

function decide(
  rules: readonly Rule[],
  graph: Graph,
  text: string,
  cwd: RepoPath | undefined
): Resolved | Miss | undefined {
  const readings = readingsOf(text, cwd)
  for (const rule of rules) {
    const matches = rule(graph, text, readings)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      const names = matches.map(({ subject }) => `the ${describe(subject)}`).join(' or ')
      return { error: { code: 'ambiguous', message: `${text} names ${names}` } }
    }
  }
  return undefined
}

/** The module, package or area `text` names: module path, package name, package directory, then area path. */
export function resolveSubject(
  graph: Graph,
  text: string,
  cwd: RepoPath | undefined
): Resolved | Miss {
  return (
    decide(subjectRules, graph, text, cwd) ??
    notFound(
      'module, package or area',
      text,
      similarPaths([...graph.paths, ...graph.areas.keys()], text)
    )
  )
}

export function resolveModule(
  graph: Graph,
  text: string,
  cwd: RepoPath | undefined
): Resolved | Miss {
  return (
    decide([moduleRule], graph, text, cwd) ??
    notFound('module', text, similarPaths(graph.paths, text))
  )
}
