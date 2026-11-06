import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { cliRunner } from './cli.ts'
import { gitlab, validConfigs } from './config-examples.ts'
import { fixtureRepo } from './fixtures.ts'
import { besideOutside, git, gitRepository, link, repository } from './temp-repository.ts'
const { run: galactica } = cliRunner()
const plain = fixtureRepo('plain-relative')

test('html --out writes the page and prints its path and size', t => {
  const out = join(repository(t, {}), 'map.html')
  const first = galactica(plain, 'html', '--out', out)
  assert.equal(first.status, 0)
  assert.equal(first.stderr, '')
  const shown = out.replaceAll('.', '\\.')
  assert.match(first.stdout, new RegExp(`^wrote ${shown} \\(\\d+ KB\\)\\n$`))
  const page = readFileSync(out, 'utf8')
  assert.match(page, /^<!doctype html>/)
  assert.match(page, /"repository":"plain-relative"/)

  assert.equal(galactica(plain, 'html', '--out', out).status, 0)
  assert.equal(readFileSync(out, 'utf8'), page)
})

test('html writes galactica.html in the current directory by default, and names it from there', t => {
  const outputs = [repository(t, {}), repository(t, {})].map(cwd => {
    const { status, stdout } = galactica(cwd, 'html', '--root', plain)
    assert.equal(status, 0)
    assert.ok(existsSync(join(cwd, 'galactica.html')))
    return stdout
  })
  assert.match(outputs[0]!, /^wrote galactica\.html \(\d+ KB\)\nUse --out/)
  assert.equal(outputs[1], outputs[0])
})

test('html takes no argument and no flag of another command, and other commands take no html flag', () => {
  for (const args of [
    ['html', 'src'],
    ['html', '--depth', '2'],
    ['html', '--root', 'nowhere'],
    ['overview', '--out', 'map.html'],
    ['overview', '--source-url', 'none'],
    ['html', '--force']
  ]) {
    const { status, stdout, stderr } = galactica(plain, ...args)
    assert.equal(status, 1, args.join(' '))
    assert.equal(stdout, '', args.join(' '))
    assert.match(stderr, /^galactica: /, args.join(' '))
  }
})

function linkedRepository(t: TestContext, remote: string) {
  const root = gitRepository(t, { 'package.json': {}, 'src/a.ts': 'export const a = 1\n' })
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'add', '.')
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
  return root
}

function pageSource(root: string, ...args: string[]) {
  const out = join(root, 'map.html')
  const result = galactica(root, 'html', '--out', out, ...args)
  const page = existsSync(out) ? readFileSync(out, 'utf8') : ''
  const block = /id="galactica-data"\s*>([^]*?)<\/script>/.exec(page)
  return { ...result, source: block === null ? undefined : JSON.parse(block[1]!).source }
}

test('html links to the GitHub remote at the commit it mapped', t => {
  const root = linkedRepository(t, 'git@github.com:acme/app.git')
  const { status, source } = pageSource(root)
  assert.equal(status, 0)
  assert.match(
    source.template,
    /^https:\/\/github\.com\/acme\/app\/blob\/[0-9a-f]{40}\/\{path\}#L\{line\}$/
  )
  assert.equal(source.prefix, '')
  assert.equal(source.uncommitted, false)
})

test('html notes tracked changes the links cannot show, and ignores untracked files', t => {
  const root = linkedRepository(t, 'https://github.com/acme/app')
  writeFileSync(join(root, 'src/new.ts'), '')
  assert.equal(pageSource(root).source.uncommitted, false)
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 2\n')
  assert.equal(pageSource(root).source.uncommitted, true)
})

test('html --source-url none turns links off', t => {
  const { status, source } = pageSource(
    linkedRepository(t, 'https://github.com/acme/app'),
    '--source-url',
    'none'
  )
  assert.equal(status, 0)
  assert.equal(source, null)
})

test('html --source-url sets the template for any host', t => {
  const root = linkedRepository(t, 'https://gitlab.example.com/group/repo.git')
  assert.equal(pageSource(root).source, null)
  const { status, source } = pageSource(root, '--source-url', gitlab)
  assert.equal(status, 0)
  assert.match(
    source.template,
    /^https:\/\/gitlab\.example\.com\/group\/repo\/-\/blob\/[0-9a-f]{40}\/\{path\}#L\{line\}$/
  )
})

test('html takes sourceUrl from galactica.config.json, and --source-url wins over it', t => {
  const root = linkedRepository(t, 'https://github.com/acme/app')
  writeFileSync(join(root, 'galactica.config.json'), JSON.stringify(validConfigs.full))
  assert.match(pageSource(root).source.template, /^https:\/\/gitlab\.example\.com\/group\/repo\//)
  assert.equal(pageSource(root, '--source-url', 'none').source, null)
  const other = 'https://git.example.com/{commit}/{path}'
  assert.match(
    pageSource(root, '--source-url', other).source.template,
    /^https:\/\/git\.example\.com\//
  )

  writeFileSync(join(root, 'galactica.config.json'), JSON.stringify(validConfigs.sourceUrlNone))
  assert.equal(pageSource(root).source, null)
})

test('html --source-url without {path}, or not on http(s), fails and writes no page', t => {
  const root = linkedRepository(t, 'https://github.com/acme/app')
  for (const [template, problem] of [
    ['https://git.example.com/{commit}', /\{path\}/],
    ['javascript:{path}', /http/]
  ] as const) {
    const { status, stdout, stderr } = galactica(
      root,
      'html',
      '--out',
      join(root, 'bad.html'),
      '--source-url',
      template
    )
    assert.equal(status, 1)
    assert.equal(stdout, '')
    assert.match(stderr, /^galactica: --source-url: /)
    assert.match(stderr, problem)
    assert.equal(existsSync(join(root, 'bad.html')), false)
  }
})

test('html has no links outside a git repository', t => {
  const { status, source } = pageSource(repository(t, { 'package.json': {}, 'src/a.ts': '' }))
  assert.equal(status, 0)
  assert.equal(source, null)
})

test('html refuses a page path that is a symbolic link, by default or with --out', t => {
  const { root, outside, untouched } = besideOutside(t)
  link(root, 'galactica.html', join(outside, 'outside.txt'))
  const byDefault = galactica(root, 'html')
  assert.equal(byDefault.status, 1)
  assert.equal(byDefault.stdout, '')
  assert.equal(
    byDefault.stderr,
    'galactica: refused to write galactica.html: it is a symbolic link\n'
  )

  const elsewhere = repository(t, {})
  link(elsewhere, 'map.html', join(outside, 'outside.txt'))
  const out = join(elsewhere, 'map.html')
  const explicit = galactica(root, 'html', '--out', out)
  assert.equal(explicit.status, 1)
  assert.match(
    explicit.stderr,
    /^galactica: refused to write \S+\/map\.html: it is a symbolic link\n$/
  )
  assert.ok(untouched())
  assert.equal(readFileSync(join(outside, 'outside.txt'), 'utf8'), 'Not Galactica.\n')
})

test('html refuses a linked folder inside the repository, and writes through one outside it', t => {
  const { root, outside, untouched } = besideOutside(t)
  link(root, 'docs', outside)
  const inside = galactica(root, 'html', '--out', 'docs/map.html')
  assert.equal(inside.status, 1)
  assert.equal(
    inside.stderr,
    'galactica: refused to write docs/map.html: docs is a symbolic link\n'
  )
  assert.ok(untouched())

  const elsewhere = repository(t, {})
  link(elsewhere, 'linked', outside)
  const chosen = galactica(root, 'html', '--out', join(elsewhere, 'linked', 'map.html'))
  assert.equal(chosen.status, 0)
  assert.match(readFileSync(join(outside, 'map.html'), 'utf8'), /^<!doctype html>/)
})
