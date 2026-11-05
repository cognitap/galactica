/**
 * `galactica.config.json` at the root, read and checked once per run into a
 * `Config`. Every problem is a `ConfigError` naming the key it is about.
 * `schema/galactica.config.schema.json` states the same rules for editors.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { moduleKinds, type ModuleKind } from './contract.ts'
import { emptyConfig, parseRepoPath, type AreaPath, type Config } from './model.ts'
import { templateProblem } from './source-links.ts'

const CONFIG_FILE = 'galactica.config.json'

export class ConfigError extends Error {
  constructor(key: string | undefined, problem: string) {
    super(`${CONFIG_FILE}: ${key === undefined ? '' : `${key}: `}${problem}`)
  }
}

const keys = ['$schema', 'include', 'exclude', 'kinds', 'areas', 'sourceUrl'] as const

const choices = (names: readonly string[]) => `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`

const typeOf = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeOf(value) === 'object'
}

function expect(key: string | undefined, expected: string, value: unknown): never {
  throw new ConfigError(key, `expected ${expected}, got ${typeOf(value)}`)
}

function objectAt(key: string, value: unknown): Readonly<Record<string, unknown>> {
  return isObject(value) ? value : expect(key, 'an object', value)
}

function stringAt(key: string, value: unknown): string {
  return typeof value === 'string' ? value : expect(key, 'a string', value)
}

/** Why a glob or area path cannot name repository-relative paths, or undefined when it can. */
function pathProblem(text: string): string | undefined {
  if (text === '') return 'must not be empty'
  if (text.includes('\\')) return 'must use forward slashes'
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text)) return 'must be relative to the root'
  if (text.startsWith('./')) return 'must start at the root, with no leading ./'
  if (text.split('/').includes('..')) return 'must not leave the root with ..'
  return undefined
}

function globsAt(key: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) expect(key, 'an array of globs', value)
  return value.map((item, index) => {
    const glob = stringAt(`${key}[${index}]`, item)
    const problem = pathProblem(glob)
    if (problem !== undefined) throw new ConfigError(`${key}[${index}]`, `glob ${problem}`)
    return glob
  })
}

const isKind = (name: string): name is ModuleKind =>
  (moduleKinds as readonly string[]).includes(name)

function kindsAt(value: unknown): Config['kinds'] {
  return Object.fromEntries(
    Object.entries(objectAt('kinds', value)).map(([kind, globs]) => {
      const key = `kinds.${kind}`
      if (!isKind(kind)) {
        throw new ConfigError(key, `unknown kind; expected ${choices(moduleKinds)}`)
      }
      return [kind, globsAt(key, globs)]
    })
  )
}

function areasAt(value: unknown): Config['areas'] {
  return Object.entries(objectAt('areas', value)).map(([glob, raw]) => {
    const key = `areas[${JSON.stringify(glob)}]`
    const globProblem = pathProblem(glob)
    if (globProblem !== undefined) throw new ConfigError(key, `glob ${globProblem}`)
    const area = stringAt(key, raw)
    const areaProblem = pathProblem(area)
    if (areaProblem !== undefined) throw new ConfigError(key, `area path ${areaProblem}`)
    return { glob, area: parseRepoPath(area) as string as AreaPath }
  })
}

function sourceUrlAt(value: unknown): string {
  const template = stringAt('sourceUrl', value)
  const problem = template === 'none' ? undefined : templateProblem(template)
  if (problem !== undefined) throw new ConfigError('sourceUrl', problem)
  return template
}

function parseConfig(raw: unknown): Config {
  if (!isObject(raw)) expect(undefined, 'an object', raw)
  const unknown = Object.keys(raw).find(key => !(keys as readonly string[]).includes(key))
  if (unknown !== undefined) {
    throw new ConfigError(unknown, `unknown key; expected ${choices(keys)}`)
  }
  if (raw.$schema !== undefined) stringAt('$schema', raw.$schema)
  const include = raw.include === undefined ? undefined : globsAt('include', raw.include)
  if (include?.length === 0) throw new ConfigError('include', 'list at least one glob')
  return {
    ...(include === undefined ? {} : { include }),
    exclude: raw.exclude === undefined ? [] : globsAt('exclude', raw.exclude),
    kinds: raw.kinds === undefined ? {} : kindsAt(raw.kinds),
    areas: raw.areas === undefined ? [] : areasAt(raw.areas),
    ...(raw.sourceUrl === undefined ? {} : { sourceUrl: sourceUrlAt(raw.sourceUrl) })
  }
}

/** The config at `root`, or the empty config when there is no file. */
export function loadConfig(root: string): Config {
  let text
  try {
    text = readFileSync(join(root, CONFIG_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig
    throw new ConfigError(undefined, `could not read: ${(error as Error).message}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(undefined, `invalid JSON: ${(error as Error).message}`)
  }
  return parseConfig(raw)
}
