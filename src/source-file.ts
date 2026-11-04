/**
 * What a file is, from its path alone: whether it is a module, its language
 * and its kind. The graph derives `ModuleNode.kind` from `kindOf` too, so both
 * maps classify a file the same way.
 */

import { languages, type Language, type ModuleKind } from './contract.ts'
import type { RepoPath } from './model.ts'

const languageByExtension: ReadonlyMap<string, Language> = new Map(
  languages.map(language => [`.${language}`, language])
)

const declaration = /\.d\.[cm]?ts$/

function nameOf(path: RepoPath): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function directoriesOf(path: RepoPath): readonly string[] {
  return path.split('/').slice(0, -1)
}

/** The module's language, or undefined when the file is no module. Declaration files hold no code, so they are none. */
export function languageOf(path: RepoPath): Language | undefined {
  const name = nameOf(path)
  if (declaration.test(name)) return undefined
  const dot = name.lastIndexOf('.')
  return dot > 0 ? languageByExtension.get(name.slice(dot)) : undefined
}

const testDirectories: ReadonlySet<string> = new Set(['__tests__', 'test', 'tests'])

/** The first rule that matches decides the kind. A file no rule matches is `source`. */
const kindRules: readonly {
  readonly kind: Exclude<ModuleKind, 'source'>
  readonly name: RegExp
  readonly directory: (segment: string) => boolean
}[] = [
  { kind: 'test', name: /\.(test|spec)\./, directory: segment => testDirectories.has(segment) },
  { kind: 'story', name: /\.(stories|story)\./, directory: () => false },
  {
    kind: 'config',
    name: /\.config\.|^\.[\w-]*rc\./,
    directory: segment => segment.startsWith('.')
  }
]

export function kindOf(path: RepoPath): ModuleKind {
  const name = nameOf(path)
  const directories = directoriesOf(path)
  const rule = kindRules.find(
    ({ name: pattern, directory }) => pattern.test(name) || directories.some(directory)
  )
  return rule?.kind ?? 'source'
}

/** Source and config modules are the code that runs. Tests and stories only use it, so they never shape dependency order. */
export function isSourceOrConfig(kind: ModuleKind): boolean {
  return kind === 'source' || kind === 'config'
}
