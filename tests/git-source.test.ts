import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pageSourceOf } from '../src/git-source.ts'
import { git, gitRepository, repository } from './temp-repository.ts'

const commit = (root: string) =>
  git(
    root,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'm'
  )

function committed(t: TestContext, remote?: string) {
  const root = gitRepository(t, { 'web/src/a.ts': 'export const a = 1\n', 'b.ts': '' })
  if (remote !== undefined) git(root, 'remote', 'add', 'origin', remote)
  git(root, 'add', '.')
  commit(root)
  return root
}

const sha = /^[0-9a-f]{40}$/

test('a GitHub origin gives a template with the commit filled in and no prefix at the top level', t => {
  const source = pageSourceOf(committed(t, 'git@github.com:acme/app.git'))!
  assert.match(
    source.template,
    /^https:\/\/github\.com\/acme\/app\/blob\/[0-9a-f]{40}\/\{path\}#L\{line\}$/
  )
  assert.match(source.template.split('/')[6]!, sha)
  assert.equal(source.prefix, '')
  assert.equal(source.shortCommit, source.template.split('/')[6]!.slice(0, 7))
  assert.equal(source.uncommitted, false)
})

test('a root inside the repository gets its directory as the prefix', t => {
  const root = committed(t, 'https://github.com/acme/app')
  assert.equal(pageSourceOf(join(root, 'web'))!.prefix, 'web')
  assert.equal(pageSourceOf(join(root, 'web', 'src'))!.prefix, 'web/src')
})

test('without origin the first remote by name is used', t => {
  const root = committed(t)
  git(root, 'remote', 'add', 'zeta', 'https://github.com/acme/zeta')
  git(root, 'remote', 'add', 'beta', 'https://github.com/acme/beta')
  assert.match(pageSourceOf(root)!.template, /^https:\/\/github\.com\/acme\/beta\//)
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/app')
  assert.match(pageSourceOf(root)!.template, /^https:\/\/github\.com\/acme\/app\//)
})

test('another host, no remote, no commit, or no repository gives no source', t => {
  assert.equal(pageSourceOf(committed(t, 'https://gitlab.com/acme/app.git')), undefined)
  assert.equal(pageSourceOf(committed(t)), undefined)
  const fresh = gitRepository(t, { 'a.ts': '' })
  git(fresh, 'remote', 'add', 'origin', 'https://github.com/acme/app')
  assert.equal(pageSourceOf(fresh), undefined)
  assert.equal(pageSourceOf(repository(t, { 'a.ts': '' })), undefined)
})

test('an explicit template is used without any remote', t => {
  const source = pageSourceOf(committed(t), 'https://git.example.com/{commit}/{path}')!
  assert.match(source.template, /^https:\/\/git\.example\.com\/[0-9a-f]{40}\/\{path\}$/)
})

test('a change to a tracked file is flagged, an untracked file is not', t => {
  const root = committed(t, 'https://github.com/acme/app')
  writeFileSync(join(root, 'untracked.ts'), '')
  assert.equal(pageSourceOf(root)!.uncommitted, false)
  writeFileSync(join(root, 'b.ts'), 'export {}\n')
  assert.equal(pageSourceOf(root)!.uncommitted, true)
})

test('a folder the enclosing repository does not track gets no links', t => {
  const root = committed(t, 'https://github.com/acme/app')
  mkdirSync(join(root, 'scratch'))
  writeFileSync(join(root, 'scratch', 'x.ts'), '')
  assert.equal(pageSourceOf(join(root, 'scratch')), undefined)
})

test('a hook environment does not redirect the reads', t => {
  const root = committed(t, 'https://github.com/acme/app')
  const other = committed(t, 'https://github.com/acme/other')
  const saved = process.env.GIT_DIR
  process.env.GIT_DIR = join(other, '.git')
  t.after(() => {
    if (saved === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = saved
  })
  assert.match(pageSourceOf(root)!.template, /acme\/app\//)
})
