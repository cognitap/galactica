/**
 * The opt-in committed map, `galactica-map.json` at the repository root.
 * Agents can read it without running Galactica, and a pull request diffs it.
 * The file is documented and can change in a minor version. Command output
 * stays the contract: `check` names the areas that changed, and other commands
 * warn when the file is stale.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCHEMA_VERSION, type Check, type Failure } from './contract.ts'
import { isRecord, isString } from './json.ts'
import { compare, type Graph, type RepoPath } from './model.ts'
import { missingFile, readRepositoryFile, UnsafeReadError } from './safe-read.ts'

export const MAP_FILE = 'galactica-map.json'

const MAP_VERSION = 1

interface CommittedArea {
  readonly path: string
  readonly layer: number
  readonly modules: readonly string[]
  readonly dependsOn: readonly string[]
}

interface CommittedPackage {
  readonly name: string
  readonly dir: string
  readonly layer: number
  readonly areas: readonly CommittedArea[]
}

export interface CommittedMap {
  readonly version: typeof MAP_VERSION
  readonly packages: readonly CommittedPackage[]
}

export type CommittedRead =
  | { readonly status: 'absent' }
  | { readonly status: 'unreadable'; readonly message: string }
  | { readonly status: 'ready'; readonly map: CommittedMap }

const mapKeys = ['version', 'packages']
const packageKeys = ['name', 'dir', 'layer', 'areas']
const areaKeys = ['path', 'layer', 'modules', 'dependsOn']

class MapProblem extends Error {}

function problem(message: string): never {
  throw new MapProblem(message)
}

const unread = (detail: string) => `committed map ${MAP_FILE} could not be read: ${detail}`

function objectAt(key: string, value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) problem(`${key}: expected an object`)
  return value
}

function textAt(key: string, value: unknown): string {
  if (!isString(value) || value === '') problem(`${key}: expected a non-empty string`)
  return value
}

function layerAt(key: string, value: unknown): number {
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

function stringsAt(key: string, value: unknown): readonly string[] {
  if (!Array.isArray(value)) problem(`${key}: expected an array of strings`)
  const items = value.map((item, index) => textAt(`${key}[${index}]`, item))
  return [...new Set(items)].sort(compare)
}

function areaAt(key: string, value: unknown): CommittedArea {
  const record = objectAt(key, value)
  onlyKeys(key, record, areaKeys)
  return {
    path: textAt(`${key}.path`, record.path),
    layer: layerAt(`${key}.layer`, record.layer),
    modules: stringsAt(`${key}.modules`, record.modules),
    dependsOn: stringsAt(`${key}.dependsOn`, record.dependsOn)
  }
}

function packageAt(key: string, value: unknown): CommittedPackage {
  const record = objectAt(key, value)
  onlyKeys(key, record, packageKeys)
  const areas = record.areas
  if (!Array.isArray(areas)) problem(`${key}.areas: expected an array`)
  return {
    name: textAt(`${key}.name`, record.name),
    dir: textAt(`${key}.dir`, record.dir),
    layer: layerAt(`${key}.layer`, record.layer),
    areas: areas
      .map((item, index) => areaAt(`${key}.areas[${index}]`, item))
      .toSorted((a, b) => compare(a.path, b.path))
  }
}

/** The map `text` describes, or why it is not one. Key order does not matter. */
export function parseMap(text: string): CommittedMap | { readonly problem: string } {
  try {
    const raw = JSON.parse(text) as unknown
    const record = objectAt(MAP_FILE, raw)
    onlyKeys(MAP_FILE, record, mapKeys)
    if (record.version !== MAP_VERSION) {
      problem(`${MAP_FILE}: version ${String(record.version)} is not supported`)
    }
    if (!Array.isArray(record.packages)) problem(`${MAP_FILE}.packages: expected an array`)
    const packages = record.packages.map((item, index) =>
      packageAt(`${MAP_FILE}.packages[${index}]`, item)
    )
    const names = packages.map(pkg => pkg.name)
    if (new Set(names).size !== names.length)
      problem(`${MAP_FILE}.packages: duplicate package name`)
    const areas = packages.flatMap(pkg => pkg.areas.map(area => area.path))
    if (new Set(areas).size !== areas.length) problem(`${MAP_FILE}: duplicate area path`)
    return { version: MAP_VERSION, packages: packages.toSorted((a, b) => compare(a.name, b.name)) }
  } catch (error) {
    if (error instanceof MapProblem) return { problem: error.message }
    if (error instanceof SyntaxError)
      return { problem: `invalid JSON: ${error.message.replace(/\s+/g, ' ')}` }
    throw error
  }
}

function targetsOf(graph: Graph, from: RepoPath): readonly RepoPath[] {
  const targets = new Set<RepoPath>()
  for (const edge of graph.modules.get(from)!.facts.edges) {
    if (edge.to.kind === 'module') targets.add(edge.to.path)
    for (const barrel of edge.via) targets.add(barrel)
  }
  return [...targets]
}

/** Packages by name, each area by path, with the other areas it imports. */
export function mapOf(graph: Graph): CommittedMap {
  const areaDeps = new Map<string, Set<string>>()
  for (const [from, node] of graph.modules) {
    for (const target of targetsOf(graph, from)) {
      const other = graph.modules.get(target)
      if (other === undefined || other.area === node.area) continue
      const deps = areaDeps.get(node.area) ?? new Set<string>()
      deps.add(other.area)
      areaDeps.set(node.area, deps)
    }
  }
  const listed = (values: Set<string> | undefined) => [...(values ?? [])].sort(compare)
  return {
    version: MAP_VERSION,
    packages: [...graph.packages]
      .sort(([a], [b]) => compare(a, b))
      .map(([name, info]) => ({
        name,
        dir: info.dir,
        layer: info.layer,
        areas: info.areas.toSorted(compare).map(path => {
          const area = graph.areas.get(path)!
          return {
            path,
            layer: area.layer,
            modules: [...area.modules],
            dependsOn: listed(areaDeps.get(path))
          }
        })
      }))
  }
}

/** Canonical text. The same map is the same bytes. */
export function formatMap(map: CommittedMap): string {
  return `${JSON.stringify(map, null, 2)}\n`
}

interface IndexedArea {
  readonly packageName: string
  readonly area: CommittedArea
}

function areasOf(map: CommittedMap): ReadonlyMap<string, IndexedArea> {
  return new Map(
    map.packages.flatMap(pkg =>
      pkg.areas.map(area => [area.path, { packageName: pkg.name, area }] as const)
    )
  )
}

const areaMark = (entry: IndexedArea) =>
  JSON.stringify([entry.packageName, entry.area.layer, entry.area.modules, entry.area.dependsOn])

type AreaChange = Check['areas'][number]

function areaChanges(fresh: CommittedMap, committed: CommittedMap): readonly AreaChange[] {
  const current = areasOf(fresh)
  const previous = areasOf(committed)
  const changes: AreaChange[] = []
  for (const path of [...new Set([...current.keys(), ...previous.keys()])].sort(compare)) {
    const next = current.get(path)
    const prev = previous.get(path)
    if (next === undefined && prev !== undefined) {
      changes.push({ path, package: prev.packageName, change: 'removed' })
    } else if (next !== undefined && prev === undefined) {
      changes.push({ path, package: next.packageName, change: 'added' })
    } else if (next !== undefined && prev !== undefined && areaMark(next) !== areaMark(prev)) {
      changes.push({ path, package: next.packageName, change: 'changed' })
    }
  }
  return changes
}

const usage = (message: string): Failure => ({
  schemaVersion: SCHEMA_VERSION,
  command: 'check',
  error: { code: 'usage', message }
})

/** Whether the committed map matches `graph`, and which areas differ. */
export function check(graph: Graph, read: CommittedRead | undefined): Check | Failure {
  if (read === undefined || read.status === 'absent') {
    return usage(`no committed map at ${MAP_FILE}; run snapshot`)
  }
  if (read.status === 'unreadable') return usage(read.message)
  const fresh = mapOf(graph)
  return {
    schemaVersion: SCHEMA_VERSION,
    command: 'check',
    path: MAP_FILE,
    stale: formatMap(fresh) !== formatMap(read.map),
    areas: areaChanges(fresh, read.map)
  }
}

const STALE = `committed map ${MAP_FILE} is stale; run check`

/** The warning line other commands add when the committed map is stale or unreadable. */
export function committedMapNote(
  graph: Graph,
  read: CommittedRead | undefined
): string | undefined {
  if (read === undefined || read.status === 'absent') return undefined
  if (read.status === 'unreadable') return read.message
  return formatMap(mapOf(graph)) === formatMap(read.map) ? undefined : STALE
}

/** The committed map at `root`, read with the same rules as other repository files. */
export function readCommittedMap(root: string): CommittedRead {
  try {
    const text = readRepositoryFile(root, join(root, MAP_FILE), {
      fileExists: existsSync,
      readFile: file => readFileSync(file, 'utf8')
    })
    const parsed = parseMap(text)
    return 'problem' in parsed
      ? { status: 'unreadable', message: unread(parsed.problem) }
      : { status: 'ready', map: parsed }
  } catch (error) {
    if (missingFile(error)) return { status: 'absent' }
    const detail = error instanceof UnsafeReadError ? error.reason : (error as Error).message
    return { status: 'unreadable', message: unread(detail) }
  }
}
