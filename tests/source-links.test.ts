import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hrefOf, noteOf } from '../src/page/links.js'
import { chosenRemote, githubTemplate, pageSource, templateProblem } from '../src/source-links.ts'

const github = (owner: string, repository: string) =>
  `https://github.com/${owner}/${repository}/blob/{commit}/{path}#L{line}`

test('every common GitHub remote form gives the same template', () => {
  for (const remote of [
    'https://github.com/cognitap/radiant.git',
    'https://github.com/cognitap/radiant',
    'https://github.com/cognitap/radiant/',
    'https://github.com/cognitap/radiant.git/',
    'http://github.com/cognitap/radiant.git',
    'https://user:token@github.com/cognitap/radiant.git',
    'git@github.com:cognitap/radiant.git',
    'git@github.com:cognitap/radiant',
    'git@github.com:cognitap/radiant/',
    'github.com:cognitap/radiant.git',
    'ssh://git@github.com/cognitap/radiant.git',
    'ssh://git@github.com:22/cognitap/radiant',
    'git://github.com/cognitap/radiant.git',
    'HTTPS://GitHub.com/cognitap/radiant.git',
    '  https://github.com/cognitap/radiant.git\n'
  ]) {
    assert.equal(githubTemplate(remote), github('cognitap', 'radiant'), remote)
  }
})

test('a repository name keeps its dots and a trailing .git is dropped once', () => {
  assert.equal(githubTemplate('git@github.com:vuejs/vue.js.git'), github('vuejs', 'vue.js'))
  assert.equal(githubTemplate('https://github.com/a/b.git.git'), github('a', 'b.git'))
})

test('another host, or a malformed remote, gives no template', () => {
  for (const remote of [
    'https://gitlab.com/group/repo.git',
    'git@gitlab.com:group/repo.git',
    'https://github.com.evil.example/cognitap/radiant.git',
    'https://example.com/github.com/cognitap/radiant',
    'https://github.com/cognitap',
    'https://github.com/cognitap/radiant/tree/main',
    'https://github.com/',
    'git@github.com:radiant.git',
    'git@github.com:a/b/c.git',
    'https://github.com/../radiant',
    'https://github.com/a b/radiant',
    'file:///srv/git/radiant.git',
    '/srv/git/radiant.git',
    '../radiant',
    ''
  ]) {
    assert.equal(githubTemplate(remote), undefined, remote)
  }
})

test('origin wins, else the first remote by name, else none', () => {
  assert.equal(chosenRemote({ upstream: 'u', origin: 'o' }), 'o')
  assert.equal(chosenRemote({ zeta: 'z', alpha: 'a' }), 'a')
  assert.equal(chosenRemote({}), undefined)
})

test('a template needs an http(s) address and {path}', () => {
  assert.equal(templateProblem('https://git.example.com/{commit}/{path}#L{line}'), undefined)
  assert.equal(templateProblem('http://git.example.com/{path}'), undefined)
  assert.match(templateProblem('https://git.example.com/{commit}')!, /\{path\}/)
  assert.match(templateProblem('javascript:alert({path})')!, /http/)
  assert.match(templateProblem('{path}')!, /http/)
})

test('the page source has the commit filled in, wherever the template uses it', () => {
  const facts = { commit: 'a8b474d0123456789', prefix: 'web', uncommitted: false }
  assert.deepEqual(pageSource('https://h/{commit}/{path}?ref={commit}', facts), {
    template: 'https://h/a8b474d0123456789/{path}?ref=a8b474d0123456789',
    prefix: 'web',
    shortCommit: 'a8b474d',
    uncommitted: false
  })
})

const source = (prefix = '', template = github('o', 'r').replace('{commit}', 'abc')) => ({
  template,
  prefix,
  shortCommit: 'abc',
  uncommitted: false
})

test('a symbol link carries its line and a module link has no line fragment', () => {
  assert.equal(hrefOf(source(), 'src/cn.ts', 12), 'https://github.com/o/r/blob/abc/src/cn.ts#L12')
  assert.equal(hrefOf(source(), 'src/cn.ts'), 'https://github.com/o/r/blob/abc/src/cn.ts')
})

test('each path segment is percent-encoded and the slashes are kept', () => {
  assert.equal(
    hrefOf(source(), 'src/a b/#1?/100%/ü.ts', 3),
    'https://github.com/o/r/blob/abc/src/a%20b/%231%3F/100%25/%C3%BC.ts#L3'
  )
  assert.equal(
    hrefOf(source(), 'src/[id]/{path}.ts', 3),
    'https://github.com/o/r/blob/abc/src/%5Bid%5D/%7Bpath%7D.ts#L3'
  )
})

test('a root inside a larger repository adds its directory before the path', () => {
  assert.equal(
    hrefOf(source('packages/web app'), 'src/cn.ts', 2),
    'https://github.com/o/r/blob/abc/packages/web%20app/src/cn.ts#L2'
  )
})

test('a template without a hash fragment fills {line} or leaves it empty', () => {
  const query = source('', 'https://h/{path}?line={line}')
  assert.equal(hrefOf(query, 'a.ts', 4), 'https://h/a.ts?line=4')
  assert.equal(hrefOf(query, 'a.ts'), 'https://h/a.ts?line=')
  const gitlab = source('', 'https://gitlab.example.com/g/r/-/blob/abc/{path}#L{line}')
  assert.equal(hrefOf(gitlab, 'a.ts'), 'https://gitlab.example.com/g/r/-/blob/abc/a.ts')
})

test('a replacement pattern in a path is taken literally', () => {
  assert.equal(hrefOf(source('', 'https://h/{path}'), "a$&$'.ts"), "https://h/a%24%26%24'.ts")
})

test('the header says which commit the links point to only when tracked files changed', () => {
  assert.equal(noteOf(source()), undefined)
  assert.equal(
    noteOf({ ...source(), shortCommit: 'a8b474d', uncommitted: true }),
    'Links point to commit a8b474d; this map also includes uncommitted changes.'
  )
})
