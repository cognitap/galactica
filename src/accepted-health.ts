/**
 * The opt-in record of accepted health findings, `galactica-health.json` at
 * the repository root. `accept` writes it. `health` and the page leave a
 * finding out while its identity matches, and say how many they left out.
 * The file can change in a minor version. Command output stays the contract.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCHEMA_VERSION, type Failure, type Health } from './contract.ts'
import { health } from './health.ts'
import { isRecord, isString } from './json.ts'
import { compare, type Graph } from './model.ts'
import { missingFile, readRepositoryFile, UnsafeReadError } from './safe-read.ts'

export const HEALTH_FILE = 'galactica-health.json'

const FILE_VERSION = 1

interface AcceptedArea {
  readonly path: string
  readonly modules: number
}

interface AcceptedImport {
  readonly from: string
  readonly specifier: string
  readonly names: readonly string[]
}

export interface AcceptedFile {
  readonly version: typeof FILE_VERSION
  readonly cycles: readonly (readonly string[])[]
  readonly areas: readonly AcceptedArea[]
  readonly imports: readonly AcceptedImport[]
}

export type AcceptedRead =
  | { readonly status: 'absent' }
  | { readonly status: 'unreadable'; readonly message: string }
  | { readonly status: 'ready'; readonly file: AcceptedFile }

const fileKeys = ['version', 'cycles', 'areas', 'imports']
const areaKeys = ['path', 'modules']
const importKeys = ['from', 'specifier', 'names']

class FileProblem extends Error {}

function problem(message: string): never {
  throw new FileProblem(message)
}

const unread = (detail: string) => `accepted findings ${HEALTH_FILE} could not be read: ${detail}`

function objectAt(key: string, value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) problem(`${key}: expected an object`)
  return value
}

function textAt(key: string, value: unknown): string {
  if (!isString(value) || value === '') problem(`${key}: expected a non-empty string`)
  return value
}

function countAt(key: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problem(`${key}: expected a whole number of at least 0`)
  }
  return value
}

function onlyKeys(
  key: string,
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
) {
  const unknown = Object.keys(value).find(name => !allowed.includes(name))
  if (unknown !== undefined) problem(`${key}: unknown key ${unknown}`)
}

function pathsAt(key: string, value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    problem(`${key}: expected a non-empty array of paths`)
  }
  const items = value.map((item, index) => textAt(`${key}[${index}]`, item))
  if (new Set(items).size !== items.length) problem(`${key}: duplicate module`)
  return items.toSorted(compare)
}

function namesAt(key: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) problem(`${key}: expected an array of strings`)
  const items = value.map((item, index) => textAt(`${key}[${index}]`, item))
  if (new Set(items).size !== items.length) problem(`${key}: duplicate name`)
  return items.toSorted(compare)
}

const cycleKey = (modules: readonly string[]) => [...modules].sort(compare).join('\0')
const areaKey = (path: string, modules: number) => JSON.stringify([path, modules])
const importKey = (item: AcceptedImport) => JSON.stringify([item.from, item.specifier, item.names])

function unique<T>(key: string, items: readonly T[], id: (item: T) => string): readonly T[] {
  const seen = new Set<string>()
  for (const item of items) {
    const mark = id(item)
    if (seen.has(mark)) problem(`${key}: duplicate`)
    seen.add(mark)
  }
  return items
}

function areaAt(key: string, value: unknown): AcceptedArea {
  const record = objectAt(key, value)
  onlyKeys(key, record, areaKeys)
  return {
    path: textAt(`${key}.path`, record.path),
    modules: countAt(`${key}.modules`, record.modules)
  }
}

function importAt(key: string, value: unknown): AcceptedImport {
  const record = objectAt(key, value)
  onlyKeys(key, record, importKeys)
  return {
    from: textAt(`${key}.from`, record.from),
    specifier: textAt(`${key}.specifier`, record.specifier),
    names: namesAt(`${key}.names`, record.names)
  }
}

function listAt<T>(
  key: string,
  value: unknown,
  itemAt: (key: string, value: unknown) => T
): readonly T[] {
  if (!Array.isArray(value)) problem(`${key}: expected an array`)
  return value.map((item, index) => itemAt(`${key}[${index}]`, item))
}

/** The accepted findings `text` describes, or why it is not that file. Key order does not matter. */
export function parseAccepted(text: string): AcceptedFile | { readonly problem: string } {
  try {
    const raw = JSON.parse(text) as unknown
    const record = objectAt(HEALTH_FILE, raw)
    onlyKeys(HEALTH_FILE, record, fileKeys)
    if (record.version !== FILE_VERSION) {
      problem(`${HEALTH_FILE}: version ${String(record.version)} is not supported`)
    }
    const cycles = unique(
      `${HEALTH_FILE}.cycles`,
      listAt(`${HEALTH_FILE}.cycles`, record.cycles, pathsAt).toSorted((a, b) =>
        compare(cycleKey(a), cycleKey(b))
      ),
      cycleKey
    )
    const areas = unique(
      `${HEALTH_FILE}.areas`,
      listAt(`${HEALTH_FILE}.areas`, record.areas, areaAt).toSorted((a, b) =>
        compare(a.path, b.path)
      ),
      area => area.path
    )
    const imports = unique(
      `${HEALTH_FILE}.imports`,
      listAt(`${HEALTH_FILE}.imports`, record.imports, importAt).toSorted(
        (a, b) =>
          compare(a.from, b.from) ||
          compare(a.specifier, b.specifier) ||
          compare(importKey(a), importKey(b))
      ),
      importKey
    )
    return { version: FILE_VERSION, cycles, areas, imports }
  } catch (error) {
    if (error instanceof FileProblem) return { problem: error.message }
    if (error instanceof SyntaxError) {
      return { problem: `invalid JSON: ${error.message.replace(/\s+/g, ' ')}` }
    }
    throw error
  }
}

/** Canonical text. The same findings are the same bytes. */
export function formatAccepted(file: AcceptedFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** One record for each distinct finding `health` would list. */
export function fileOf(found: Health): AcceptedFile {
  const cycles = new Map<string, readonly string[]>()
  for (const cycle of found.cycles) {
    const modules = [...cycle.modules].sort(compare)
    cycles.set(cycleKey(modules), modules)
  }
  const areas = new Map<string, AcceptedArea>()
  for (const area of found.oversizedAreas) {
    areas.set(area.path, { path: area.path, modules: area.modules })
  }
  const imports = new Map<string, AcceptedImport>()
  for (const item of found.internalImports) {
    const recorded = {
      from: item.from,
      specifier: item.specifier,
      names: [...item.names].sort(compare)
    }
    imports.set(importKey(recorded), recorded)
  }
  return {
    version: FILE_VERSION,
    cycles: [...cycles.values()].sort((a, b) => compare(cycleKey(a), cycleKey(b))),
    areas: [...areas.values()].sort((a, b) => compare(a.path, b.path)),
    imports: [...imports.values()].sort(
      (a, b) =>
        compare(a.from, b.from) ||
        compare(a.specifier, b.specifier) ||
        compare(importKey(a), importKey(b))
    )
  }
}

/**
 * Findings whose identity is in `file` are left out. A cycle's identity is its
 * set of modules, an area's is its path and source-module count, and an
 * import's is its file, specifier and names. `accepted` counts the ones left out.
 */
export function acceptFindings(found: Health, file: AcceptedFile): Health {
  const cycles = new Set(file.cycles.map(cycleKey))
  const areas = new Set(file.areas.map(area => areaKey(area.path, area.modules)))
  const imports = new Set(file.imports.map(importKey))
  const keptCycles = found.cycles.filter(cycle => !cycles.has(cycleKey(cycle.modules)))
  const keptAreas = found.oversizedAreas.filter(
    area => !areas.has(areaKey(area.path, area.modules))
  )
  const keptImports = found.internalImports.filter(
    item =>
      !imports.has(importKey({ from: item.from, specifier: item.specifier, names: item.names }))
  )
  return {
    ...found,
    cycles: keptCycles,
    oversizedAreas: keptAreas,
    internalImports: keptImports,
    accepted:
      found.cycles.length -
      keptCycles.length +
      (found.oversizedAreas.length - keptAreas.length) +
      (found.internalImports.length - keptImports.length)
  }
}

const usage = (message: string): Failure => ({
  schemaVersion: SCHEMA_VERSION,
  command: 'health',
  error: { code: 'usage', message }
})

/** `health`, with accepted findings left out when the repository recorded them. */
export function healthReport(
  graph: Graph,
  areaModules: number | undefined,
  read: AcceptedRead | undefined
): Health | Failure {
  const found = health(graph, areaModules)
  if (read === undefined || read.status === 'absent') return found
  if (read.status === 'unreadable') return usage(read.message)
  return acceptFindings(found, read.file)
}

/** The accepted findings at `root`, read with the same rules as other repository files. */
export function readAccepted(root: string): AcceptedRead {
  try {
    const text = readRepositoryFile(root, join(root, HEALTH_FILE), {
      fileExists: existsSync,
      readFile: file => readFileSync(file, 'utf8')
    })
    const parsed = parseAccepted(text)
    return 'problem' in parsed
      ? { status: 'unreadable', message: unread(parsed.problem) }
      : { status: 'ready', file: parsed }
  } catch (error) {
    if (missingFile(error)) return { status: 'absent' }
    const detail = error instanceof UnsafeReadError ? error.reason : (error as Error).message
    return { status: 'unreadable', message: unread(detail) }
  }
}
