import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRepoPath, toRepoPath } from '../src/model.ts'

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
