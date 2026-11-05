import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { graphOf } from '../src/graph.ts'
import type { Area, Graph, Model, ModuleFacts, ModuleNode, RepoPath } from '../src/model.ts'

/** A `Model` without the content hashes, which a hand-written file cannot know. */
export type ExpectedModel = Omit<Model, 'modules'> & {
  readonly modules: Readonly<Record<RepoPath, Omit<ModuleFacts, 'hash'>>>
}

/** The derived facts a case is about. A case states only the fields it covers. */
export type ExpectedGraph = Partial<{
  readonly kinds: Readonly<Record<RepoPath, ModuleNode['kind']>>
  /** Sorted by path. */
  readonly areas: readonly Area[]
  readonly cycles: Graph['cycles']
}>

/** A case's expected.json, and its expected-graph.json when it has one. */
export interface ExpectedFiles {
  readonly model: ExpectedModel
  readonly graph: ExpectedGraph | undefined
}

const fixtures = new URL('fixtures/', import.meta.url)

export function fixtureCases(): string[] {
  return readdirSync(fixtures, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

/** The fixture repository's root directory, which expected paths are relative to. */
export function fixtureRepo(name: string): string {
  return fileURLToPath(new URL(`${name}/repo`, fixtures))
}

const modelFile = (name: string) => new URL(`${name}/expected.json`, fixtures)
const graphFile = (name: string) => new URL(`${name}/expected-graph.json`, fixtures)

export function readExpected(name: string): ExpectedFiles {
  const graph = graphFile(name)
  return {
    model: JSON.parse(readFileSync(modelFile(name), 'utf8')),
    graph: existsSync(graph) ? JSON.parse(readFileSync(graph, 'utf8')) : undefined
  }
}

const isPrimitive = (value: unknown) => value === null || typeof value !== 'object'

/**
 * JSON as the expected files are written: two-space indent, arrays of
 * primitives and objects of at most two primitive fields on one line.
 */
function formatExpected(value: unknown, indent = ''): string {
  if (isPrimitive(value)) return JSON.stringify(value)
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.every(isPrimitive)) return `[${value.map(item => JSON.stringify(item)).join(', ')}]`
    return `[\n${value.map(item => inner + formatExpected(item, inner)).join(',\n')}\n${indent}]`
  }
  const entries = Object.entries(value as object)
  if (entries.length === 0) return '{}'
  const fields = entries.map(
    ([key, item]) => `${JSON.stringify(key)}: ${formatExpected(item, inner)}`
  )
  if (entries.length <= 2 && entries.every(([, item]) => isPrimitive(item))) {
    return `{ ${fields.join(', ')} }`
  }
  return `{\n${fields.map(field => inner + field).join(',\n')}\n${indent}}`
}

/** The expected files whose text on disk is not `files` as `formatExpected` writes them. */
function staleTexts(name: string, files: ExpectedFiles): readonly [URL, string][] {
  const targets = [
    [modelFile(name), files.model],
    [graphFile(name), files.graph]
  ] as const
  return targets.flatMap(([url, value]): [URL, string][] => {
    if (value === undefined) return []
    const text = `${formatExpected(value)}\n`
    return existsSync(url) && readFileSync(url, 'utf8') === text ? [] : [[url, text]]
  })
}

export function staleExpected(name: string, files: ExpectedFiles): string[] {
  return staleTexts(name, files).map(([url]) => fileURLToPath(url))
}

/** Writes the expected files that differ from `files`. Returns their paths. */
export function writeExpected(name: string, files: ExpectedFiles): string[] {
  return staleTexts(name, files).map(([url, text]) => {
    writeFileSync(url, text)
    return fileURLToPath(url)
  })
}

/** How an implemented aspect reads its slice of the expected files and of the analyzer's model. */
export interface Check {
  /** Asserts that the analyzer's model matches the expected files. */
  readonly compare: (files: ExpectedFiles, model: Model) => void
  /** The expected files with this aspect replaced by the analyzer's model. */
  readonly update: (files: ExpectedFiles, model: Model) => ExpectedFiles
}

function check<T>(
  expected: (files: ExpectedFiles) => T,
  actual: (model: Model) => T,
  replace: (files: ExpectedFiles, value: T) => ExpectedFiles
): Check {
  return {
    compare: (files, model) => assert.deepStrictEqual(actual(model), expected(files)),
    update: (files, model) => replace(files, actual(model))
  }
}

type ModuleField = 'symbols' | 'edges'

const fieldByPath = (modules: ExpectedModel['modules'], key: ModuleField) =>
  Object.fromEntries(Object.values(modules).map(facts => [facts.path, facts[key]]))

/** One field of every module. */
function moduleField(key: ModuleField): Check {
  return check(
    ({ model }) => fieldByPath(model.modules, key),
    model => fieldByPath(model.modules, key),
    (files, values) => ({
      ...files,
      model: {
        ...files.model,
        modules: Object.fromEntries(
          Object.entries(files.model.modules).map(([path, facts]) => [
            path,
            { ...facts, [key]: values[path] ?? [] }
          ])
        )
      }
    })
  )
}

export interface Aspect {
  readonly name: string
  /** The Linear issue that implements the aspect. */
  readonly owner: string
  /** Absent until the owner lands. */
  readonly check?: Check
  /** Cases a later issue finishes, with that issue. */
  readonly pendingIn?: Readonly<Record<string, string>>
  /** Whether a case's expected files state the aspect at all. */
  readonly stated: (files: ExpectedFiles) => boolean
}

const always = () => true

const pathsOf = (model: ExpectedModel) => Object.keys(model.modules) as RepoPath[]

/** Each part of the expected files, with the issue that makes the analyzer produce it. */
export const aspects: readonly Aspect[] = [
  {
    name: 'files',
    owner: 'DEV-668',
    stated: always,
    check: check(
      ({ model }) => pathsOf(model),
      pathsOf,
      (files, paths) => ({
        ...files,
        model: {
          ...files.model,
          modules: Object.fromEntries(
            paths.map(path => [path, files.model.modules[path] ?? { path, symbols: [], edges: [] }])
          )
        }
      })
    )
  },
  {
    name: 'packages',
    owner: 'DEV-668',
    stated: always,
    check: check(
      ({ model }) => ({ repository: model.repository, packages: model.packages }),
      ({ repository, packages }) => ({ repository, packages }),
      (files, packages) => ({ ...files, model: { ...files.model, ...packages } })
    )
  },
  {
    name: 'kinds',
    owner: 'DEV-668',
    stated: ({ graph }) => graph?.kinds !== undefined,
    check: check(
      ({ graph }) => graph?.kinds,
      model =>
        Object.fromEntries([...graphOf(model).modules].map(([path, node]) => [path, node.kind])),
      (files, kinds) => ({ ...files, graph: { ...files.graph, kinds } })
    )
  },
  {
    name: 'symbols',
    owner: 'DEV-669',
    stated: always,
    check: moduleField('symbols')
  },
  {
    name: 'edges',
    owner: 'DEV-671',
    stated: always,
    check: moduleField('edges')
  },
  {
    name: 'areas',
    owner: 'DEV-673',
    stated: ({ graph }) => graph?.areas !== undefined,
    check: check(
      ({ graph }) => graph?.areas,
      model => [...graphOf(model).areas.values()],
      (files, areas) => ({ ...files, graph: { ...files.graph, areas } })
    )
  },
  {
    name: 'cycles',
    owner: 'DEV-673',
    stated: ({ graph }) => graph?.cycles !== undefined,
    check: check(
      ({ graph }) => graph?.cycles,
      model => graphOf(model).cycles,
      (files, cycles) => ({ ...files, graph: { ...files.graph, cycles } })
    )
  }
]

/** What a case does with an aspect it states: run the check, or wait for an issue. */
export function statusOf(aspect: Aspect, name: string): Check | { readonly pending: string } {
  const issue = aspect.pendingIn?.[name]
  if (issue !== undefined) return { pending: issue }
  return aspect.check ?? { pending: aspect.owner }
}
