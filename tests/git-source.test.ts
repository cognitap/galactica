import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { pageSourceOf } from '../src/git-source.ts'
import { noteOf } from '../src/page/links.js'
import { gitEnvironment } from '../src/repository-files.ts'
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

function remoteTracking(root: string, ref: string, from = 'HEAD') {
  git(root, 'update-ref', `refs/remotes/${ref}`, from)
}

function ahead(root: string, name: string) {
  writeFileSync(join(root, name), name)
  git(root, 'add', '.')
  commit(root)
}

const head = (root: string) =>
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    env: gitEnvironment(),
    encoding: 'utf8'
  }).trim()

test('a pushed HEAD is linked as it is', t => {
  const root = committed(t, 'https://github.com/acme/app')
  remoteTracking(root, 'origin/main')
  const source = pageSourceOf(root)!
  assert.equal(source.template.split('/')[6], head(root))
  assert.equal(source.unpushed, 0)
  assert.equal(noteOf(source), undefined)
})

test('HEAD ahead of its upstream links the merge base and counts the commits beyond it', t => {
  const root = committed(t, 'https://github.com/acme/app')
  const pushed = head(root)
  remoteTracking(root, 'origin/topic')
  git(root, 'branch', '--set-upstream-to', 'origin/topic')
  ahead(root, 'one.ts')
  ahead(root, 'two.ts')
  const source = pageSourceOf(root)!
  assert.equal(source.template.split('/')[6], pushed)
  assert.equal(source.unpushed, 2)
  assert.equal(
    noteOf(source),
    `Links point to ${pushed.slice(0, 7)}, the newest commit on origin; this map also includes 2 unpushed commits.`
  )
  writeFileSync(join(root, 'b.ts'), 'export {}\n')
  assert.match(noteOf(pageSourceOf(root)!)!, /2 unpushed commits and uncommitted changes\.$/)
})

test('a branch without an upstream falls back to origin/HEAD, then origin/main, then origin/master', t => {
  const root = committed(t, 'https://github.com/acme/app')
  const pushed = head(root)
  ahead(root, 'one.ts')
  const linked = () => pageSourceOf(root)!.template.split('/')[6]
  remoteTracking(root, 'origin/master', pushed)
  assert.equal(linked(), pushed)
  ahead(root, 'two.ts')
  const second = head(root)
  remoteTracking(root, 'origin/main', second)
  assert.equal(linked(), second)
  ahead(root, 'three.ts')
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master')
  assert.equal(linked(), pushed)
  assert.equal(pageSourceOf(root)!.unpushed, 3)
})

test('an upstream on another remote is not used', t => {
  const root = committed(t, 'https://github.com/acme/app')
  const pushed = head(root)
  remoteTracking(root, 'origin/main')
  git(root, 'remote', 'add', 'fork', 'https://github.com/me/app')
  remoteTracking(root, 'fork/topic')
  git(root, 'branch', '--set-upstream-to', 'fork/topic')
  ahead(root, 'one.ts')
  assert.equal(pageSourceOf(root)!.template.split('/')[6], pushed)
})

test('without any remote ref the links point to HEAD', t => {
  const root = committed(t, 'https://github.com/acme/app')
  ahead(root, 'one.ts')
  const source = pageSourceOf(root)!
  assert.equal(source.template.split('/')[6], head(root))
  assert.equal(source.unpushed, 0)
  assert.equal(noteOf(source), undefined)
})
