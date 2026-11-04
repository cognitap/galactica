import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

export function readExpected(name: string): ExpectedModel {
  return JSON.parse(readFileSync(new URL(`${name}/expected.json`, fixtures), 'utf8'))
}

export function readExpectedGraph(name: string): ExpectedGraph | undefined {
  const url = new URL(`${name}/expected-graph.json`, fixtures)
  return existsSync(url) ? JSON.parse(readFileSync(url, 'utf8')) : undefined
}

/** Asserts that `actual` matches the case's expected.json, ignoring hashes. */
export function compareFixture(name: string, actual: Model): void {
  const modules: ExpectedModel['modules'] = Object.fromEntries(
    Object.values(actual.modules).map(({ path, symbols, edges }) => [
      path,
      { path, symbols, edges }
    ])
  )
  const expected = readExpected(name)
  assert.deepStrictEqual({ ...actual, modules }, expected)
  assert.deepStrictEqual(Object.keys(modules), Object.keys(expected.modules))
}
