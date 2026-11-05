/**
 * What a file is, from its path and the config alone: whether it is a module,
 * its language and its kind. Discovery and the graph both take the kind from
 * `kindOf`, so every command and the page classify a file the same way.
 */

import { posix } from 'node:path'
import { ConfigError } from './config.ts'
import { languages, type Language, type ModuleKind } from './contract.ts'
import type { Config, RepoPath } from './model.ts'

const languageByExtension: ReadonlyMap<string, Language> = new Map(
  languages.map(language => [`.${language}`, language])
)

const frameworkLanguages = ['vue', 'svelte', 'astro'] as const

/** The languages TypeScript parses directly. Framework files need their own compiler. */
export type ScriptLanguage = Exclude<Language, (typeof frameworkLanguages)[number]>

export function isScriptLanguage(language: Language): language is ScriptLanguage {
  return !(frameworkLanguages as readonly string[]).includes(language)
}

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
  /** Whether the folders the module is in, outermost first, give the kind. */
  readonly folders: (directories: readonly string[]) => boolean
}[] = [
  {
    kind: 'test',
    name: /\.(test|spec)\./,
    folders: directories => directories.some(segment => testDirectories.has(segment))
  },
  {
    kind: 'story',
    name: /\.(stories|story)\./,
    // Storybook reads its config from `.storybook` itself. Its subfolders hold
    // what stories render, such as example components.
    folders: directories => directories.slice(0, -1).includes('.storybook')
  },
  {
    kind: 'config',
    name: /\.config\.|^\.[\w-]*rc\./,
    folders: directories => directories.some(segment => segment.startsWith('.'))
  }
]

/** The kind the config gives `path`, which may match the globs of one kind only. */
function configuredKind(path: RepoPath, kinds: Config['kinds']): ModuleKind | undefined {
  let found: { readonly kind: ModuleKind; readonly key: string } | undefined
  for (const [kind, globs] of Object.entries(kinds) as [ModuleKind, readonly string[]][]) {
    const index = globs.findIndex(glob => posix.matchesGlob(path, glob))
    if (index < 0) continue
    const key = `kinds.${kind}[${index}]`
    if (found)
      throw new ConfigError(key, `${path} also matches ${found.key}; a module has one kind`)
    found = { kind, key }
  }
  return found?.kind
}

export function kindOf(path: RepoPath, config: Config): ModuleKind {
  const configured = configuredKind(path, config.kinds)
  if (configured !== undefined) return configured
  const name = nameOf(path)
  const directories = directoriesOf(path)
  const rule = kindRules.find(
    ({ name: pattern, folders }) => pattern.test(name) || folders(directories)
  )
  return rule?.kind ?? 'source'
}

/** Source and config modules are the code that runs. Tests and stories only use it, so they never shape dependency order. */
export function isSourceOrConfig(kind: ModuleKind): boolean {
  return kind === 'source' || kind === 'config'
}
