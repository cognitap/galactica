import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cliRunner } from './cli.ts'
import { fixtureRepo } from './fixtures.ts'
import { besideOutside, filesUnder, link, repository } from './temp-repository.ts'
const { run: galactica } = cliRunner()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const plain = fixtureRepo('plain-relative')

const skillPaths = ['.agents/skills/galactica/SKILL.md', '.claude/skills/galactica/SKILL.md']

const rulePath = '.cursor/rules/galactica.mdc'

const written = [...skillPaths, rulePath]

test('init installs the skill with the given command, and a second run changes nothing', t => {
  const root = repository(t, { 'package.json': {} })
  const first = galactica(root, 'init', '--command', 'node /opt/galactica/dist/cli.js')
  assert.equal(first.status, 0)
  assert.equal(first.stdout, written.map(path => `created ${path}\n`).join(''))
  const files = skillPaths.map(path => readFileSync(join(root, path), 'utf8'))
  assert.equal(files[0], files[1])
  assert.match(files[0]!, /^name: galactica$/m)
  assert.ok(files[0]!.includes(`\n  galactica-version: "${version}"\n`))
  assert.match(files[0]!, /`node \/opt\/galactica\/dist\/cli\.js uses <file>`/)
  assert.deepEqual(readdirSync(root, { recursive: true }).toSorted(), [
    '.agents',
    '.agents/skills',
    '.agents/skills/galactica',
    '.agents/skills/galactica/SKILL.md',
    '.claude',
    '.claude/skills',
    '.claude/skills/galactica',
    '.claude/skills/galactica/SKILL.md',
    '.cursor',
    '.cursor/rules',
    '.cursor/rules/galactica.mdc',
    'package.json'
  ])

  const second = galactica(root, 'init', '--command', 'node /opt/galactica/dist/cli.js')
  assert.equal(second.stdout, written.map(path => `unchanged ${path}\n`).join(''))
  assert.deepEqual(
    skillPaths.map(path => readFileSync(join(root, path), 'utf8')),
    files
  )
  assert.equal(
    galactica(root, 'init').stdout,
    skillPaths.map(path => `updated ${path}\n`).join('') + `unchanged ${rulePath}\n`
  )
  assert.match(
    readFileSync(join(root, skillPaths[0]!), 'utf8'),
    /`npx --prefix \/ @cognitap\/galactica overview`/
  )
})

test('init keeps an edited skill, exits 1 when it keeps every one, and --force overwrites', t => {
  const root = repository(t, {})
  galactica(root, 'init')
  const [agents, claude] = skillPaths as [string, string]
  writeFileSync(join(root, claude), 'Our own notes.\n')
  const one = galactica(root, 'init', '--command', 'galactica')
  assert.equal(one.status, 0)
  assert.equal(
    one.stdout,
    `updated ${agents}\nkept ${claude}: edited since galactica wrote it, --force overwrites it\nunchanged ${rulePath}\n`
  )
  assert.equal(readFileSync(join(root, claude), 'utf8'), 'Our own notes.\n')

  writeFileSync(join(root, agents), 'Our own notes.\n')
  writeFileSync(join(root, rulePath), 'Our own rule.\n')
  assert.equal(galactica(root, 'init').status, 1)
  const forced = galactica(root, 'init', '--force')
  assert.equal(forced.status, 0)
  assert.equal(forced.stdout, written.map(path => `updated ${path}\n`).join(''))
})

test('init --root installs into that directory and prints paths from the current one', t => {
  const root = repository(t, { 'packages/app/package.json': {} })
  const { status, stdout } = galactica(join(root, 'packages/app'), 'init', '--root', '../..')
  assert.equal(status, 0)
  assert.equal(stdout, written.map(path => `created ../../${path}\n`).join(''))
  assert.ok(existsSync(join(root, skillPaths[0]!)))
})

test('init refuses a skill file that is a symbolic link, dangling or not, and writes nothing', t => {
  for (const force of [[], ['--force']]) {
    for (const target of ['outside.txt', 'created.txt']) {
      const { root, outside, untouched } = besideOutside(t)
      link(root, skillPaths[1]!, join(outside, target))
      const { status, stdout, stderr } = galactica(root, 'init', ...force)
      assert.equal(status, 1)
      assert.equal(stdout, '')
      assert.equal(stderr, `galactica: refused to write ${skillPaths[1]}: it is a symbolic link\n`)
      assert.ok(untouched(), `${target} ${force}`)
      assert.equal(readFileSync(join(outside, 'outside.txt'), 'utf8'), 'Not Galactica.\n')
      assert.deepEqual(filesUnder(root), ['package.json', 'src/a.ts'])
    }
  }
})

test('init refuses to write through a linked folder such as .claude -> ~/.claude', t => {
  const { root, outside, untouched } = besideOutside(t)
  link(root, '.cursor', outside)
  const { status, stderr } = galactica(root, 'init')
  assert.equal(status, 1)
  assert.equal(stderr, `galactica: refused to write ${rulePath}: .cursor is a symbolic link\n`)
  assert.ok(untouched())
  assert.deepEqual(readdirSync(root).toSorted(), ['.cursor', 'package.json', 'src'])
})

test('init installs nothing when one of its files cannot be written', t => {
  const root = repository(t, { 'package.json': {}, '.cursor': 'a file, not a folder' })
  const { status, stdout, stderr } = galactica(root, 'init')
  assert.equal(status, 1)
  assert.equal(stdout, '')
  assert.match(stderr, /^galactica: could not install the skill: /)
  assert.deepEqual(readdirSync(root).toSorted(), ['.cursor', 'package.json'])
})

test('init takes no argument, no flag of another command and no empty --command', () => {
  for (const args of [
    ['init', 'src'],
    ['init', '--out', 'x'],
    ['init', '--command', ' '],
    ['init', '--root', 'nowhere']
  ]) {
    const { status, stdout, stderr } = galactica(plain, ...args)
    assert.equal(status, 1, args.join(' '))
    assert.equal(stdout, '', args.join(' '))
    assert.match(stderr, /^galactica: /, args.join(' '))
  }
  assert.ok(!existsSync(join(plain, '.agents')))
})
