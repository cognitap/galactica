import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseRepoPath,
  removeModule,
  replaceModule,
  toRepoPath,
  type ModuleFacts,
  type RepoPath
} from '../src/model.ts'

function facts(path: string, hash = 'h'): ModuleFacts {
  return { path: path as RepoPath, hash, symbols: [], edges: [] }
}

import { modelOf as modelFrom } from './models.ts'

const modelOf = (...paths: string[]) =>
  modelFrom(Object.fromEntries(paths.toSorted().map(path => [path, {}])))

test('parseRepoPath normalizes separators, ./ prefixes and trailing slashes', () => {
  assert.equal(parseRepoPath('src\\ui\\Button.tsx'), 'src/ui/Button.tsx')
  assert.equal(parseRepoPath('./src/cn.ts'), 'src/cn.ts')
  assert.equal(parseRepoPath('src/ui/'), 'src/ui')
  assert.equal(parseRepoPath('src/a/../cn.ts'), 'src/cn.ts')
  assert.equal(parseRepoPath('.'), '.')
})

test('parseRepoPath rejects absolute paths and paths that leave the repository', () => {
  assert.throws(() => parseRepoPath('/etc/passwd'))
  assert.throws(() => parseRepoPath('C:\\repo\\src\\cn.ts'))
  assert.throws(() => parseRepoPath('../outside.ts'))
  assert.throws(() => parseRepoPath('src/../../outside.ts'))
  assert.throws(() => parseRepoPath('..'))
})

test('toRepoPath makes a path relative to the root', () => {
  assert.equal(toRepoPath('/repo', '/repo/src/cn.ts'), 'src/cn.ts')
  assert.equal(toRepoPath('/repo', '/repo/'), '.')
  assert.equal(toRepoPath('/repo/', '/repo/src/'), 'src')
})

test('toRepoPath rejects paths outside the root', () => {
  assert.throws(() => toRepoPath('/repo', '/elsewhere/cn.ts'))
  assert.throws(() => toRepoPath('/repo', '/repo-sibling/cn.ts'))
})

test('replaceModule keeps modules keyed and sorted by path', () => {
  const model = modelOf('src/z.ts', 'src/a.ts', 'src/m.ts')
  assert.deepEqual(Object.keys(model.modules), ['src/a.ts', 'src/m.ts', 'src/z.ts'])
})

test('replaceModule is idempotent and replaces an existing entry', () => {
  const once = replaceModule(modelOf('src/a.ts', 'src/b.ts'), facts('src/a.ts', 'new'))
  const twice = replaceModule(once, facts('src/a.ts', 'new'))
  assert.deepEqual(twice, once)
  assert.equal(once.modules['src/a.ts' as RepoPath]?.hash, 'new')
  assert.deepEqual(Object.keys(once.modules), ['src/a.ts', 'src/b.ts'])
})

test('replaceModule does not mutate its input', () => {
  const before = modelOf('src/a.ts')
  replaceModule(before, facts('src/b.ts'))
  assert.deepEqual(Object.keys(before.modules), ['src/a.ts'])
})

test('removeModule is idempotent and keeps the remaining keys sorted', () => {
  const once = removeModule(modelOf('src/c.ts', 'src/a.ts', 'src/b.ts'), 'src/b.ts' as RepoPath)
  const twice = removeModule(once, 'src/b.ts' as RepoPath)
  assert.deepEqual(twice, once)
  assert.deepEqual(Object.keys(once.modules), ['src/a.ts', 'src/c.ts'])
  assert.deepEqual(removeModule(modelOf(), 'src/x.ts' as RepoPath), modelOf())
})
