import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { commands } from '../src/contract.ts'
import { fixtureRepo } from './fixtures.ts'
import { repository } from './temp-repository.ts'

const cli = new URL('../dist/cli.js', import.meta.url).pathname

function galactica(cwd: string, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync('node', [cli, ...args], { cwd, encoding: 'utf8' })
  return { status, stdout, stderr }
}

const plain = fixtureRepo('plain-relative')
const monorepo = fixtureRepo('monorepo')

test('prints usage with --help, listing every command', () => {
  const { status, stdout } = galactica(plain, '--help')
  assert.equal(status, 0)
  assert.match(stdout, /^Usage: galactica/)
  for (const command of [...commands, 'html', 'init']) {
    assert.match(stdout, new RegExp(`^  ${command}\\b`, 'm'))
  }
})

test('prints the package version with --version', () => {
  assert.equal(galactica(plain, '--version').stdout.trim(), '0.0.0')
})

test('a command prints text by default and its JSON object with --json', () => {
  const text = galactica(plain, 'outline', 'src/math.ts')
  assert.equal(text.status, 0)
  assert.match(text.stdout, /^src\/math\.ts \(source, area src, package plain-relative\): 3/)
  assert.match(text.stdout, /^src\/math\.ts:2 {2}function {2}function add/m)

  const json = galactica(plain, 'outline', 'src/math.ts', '--json')
  assert.equal(json.status, 0)
  const output = JSON.parse(json.stdout)
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.command, 'outline')
  assert.deepEqual(
    output.symbols.map((symbol: { name: string }) => symbol.name),
    ['add', 'PI', 'Rounding']
  )
})

test('uses and deps follow edges in a plain repository', () => {
  assert.equal(
    galactica(plain, 'uses', 'src/math.ts').stdout,
    'src/math.ts (module): 1 dependent within depth 1, 0 tests\n1  src/main.ts  PI, add\nno tests\n'
  )
  const deps = JSON.parse(galactica(plain, 'deps', 'src/main.ts', '--json').stdout)
  assert.deepEqual(deps.unresolved, [{ from: 'src/main.ts', specifier: './gone' }])
})

test('subjects resolve by package name and directory in a monorepo, from any directory', () => {
  const byName = JSON.parse(galactica(monorepo, 'deps', '@mono/app', '--json').stdout)
  assert.deepEqual(byName.subject, { kind: 'package', name: '@mono/app', dir: 'packages/app' })
  assert.deepEqual(byName.packages, ['@mono/core'])

  const inside = join(monorepo, 'packages/core')
  const fromInside = galactica(inside, 'uses', 'src', '--root', '../..')
  assert.equal(fromInside.status, 0)
  assert.match(fromInside.stdout, /^packages\/core\/src \(area\): 1 dependent/)

  const overview = JSON.parse(galactica(monorepo, 'overview', '--json').stdout)
  assert.deepEqual(
    overview.packages.map((pkg: { name: string }) => pkg.name),
    ['@mono/app', '@mono/core']
  )
})

test('an unknown name is an empty answer with exit code 0', () => {
  const { status, stdout } = galactica(monorepo, 'where', 'gret', '--json')
  assert.equal(status, 0)
  assert.deepEqual(JSON.parse(stdout).definitions, [])
})

test('a failure prints its message, or its object with --json, and exits with code 1', () => {
  const text = galactica(monorepo, 'uses', 'index.ts')
  assert.equal(text.status, 1)
  assert.equal(text.stdout, '')
  assert.equal(
    text.stderr,
    'galactica: no module, package or area named index.ts. Did you mean packages/core/src/index.ts?\n'
  )

  const json = galactica(monorepo, 'uses', 'index.ts', '--json')
  assert.equal(json.status, 1)
  assert.equal(JSON.parse(json.stdout).error.code, 'not-found')
})

test('bad flags and missing arguments are usage failures', () => {
  for (const args of [
    ['uses'],
    ['uses', 'src', '--depth', '0'],
    ['where', 'x', '--depth', '2'],
    ['outline', 'a', 'b'],
    ['overview', '--bogus'],
    ['overview', '--root', 'nowhere'],
    ['overview', '--force']
  ]) {
    const { status, stdout } = galactica(plain, ...args, '--json')
    assert.equal(status, 1, args.join(' '))
    assert.equal(JSON.parse(stdout).error.code, 'usage', args.join(' '))
  }
})

test('no command or an unknown one prints usage and exits with code 1', () => {
  for (const args of [[], ['nope']]) {
    const { status, stderr } = galactica(plain, ...args)
    assert.equal(status, 1)
    assert.match(stderr, /Usage: galactica/)
  }
})

test('html --out writes the page and prints its path and size', t => {
  const out = join(repository(t, {}), 'map.html')
  const first = galactica(plain, 'html', '--out', out)
  assert.equal(first.status, 0)
  assert.equal(first.stderr, '')
  assert.match(first.stdout, new RegExp(`^wrote ${out.replaceAll('.', '\\.')} \\(\\d+ KB\\)\\n$`))
  const page = readFileSync(out, 'utf8')
  assert.match(page, /^<!doctype html>/)
  assert.match(page, /"repository":"plain-relative"/)

  assert.equal(galactica(plain, 'html', '--out', out).status, 0)
  assert.equal(readFileSync(out, 'utf8'), page)
})

test('html writes galactica.html in the current directory by default', t => {
  const cwd = repository(t, {})
  const { status } = galactica(cwd, 'html', '--root', plain)
  assert.equal(status, 0)
  assert.ok(existsSync(join(cwd, 'galactica.html')))
})

test('html takes no argument and no flag of another command, and other commands take no html flag', () => {
  for (const args of [
    ['html', 'src'],
    ['html', '--json'],
    ['html', '--depth', '2'],
    ['html', '--root', 'nowhere'],
    ['overview', '--out', 'map.html'],
    ['html', '--force']
  ]) {
    const { status, stdout, stderr } = galactica(plain, ...args)
    assert.equal(status, 1, args.join(' '))
    assert.equal(stdout, '', args.join(' '))
    assert.match(stderr, /^galactica: /, args.join(' '))
  }
})

const skillPaths = ['.agents/skills/galactica/SKILL.md', '.claude/skills/galactica/SKILL.md']

test('init installs the skill with the given command, and a second run changes nothing', t => {
  const root = repository(t, { 'package.json': {} })
  const first = galactica(root, 'init', '--command', 'node /opt/galactica/dist/cli.js')
  assert.equal(first.status, 0)
  assert.equal(first.stdout, skillPaths.map(path => `created ${path}\n`).join(''))
  const files = skillPaths.map(path => readFileSync(join(root, path), 'utf8'))
  assert.equal(files[0], files[1])
  assert.match(files[0]!, /^name: galactica$/m)
  assert.match(files[0]!, /^ {2}galactica-version: "0\.0\.0"$/m)
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
    'package.json'
  ])

  const second = galactica(root, 'init', '--command', 'node /opt/galactica/dist/cli.js')
  assert.equal(second.stdout, skillPaths.map(path => `unchanged ${path}\n`).join(''))
  assert.deepEqual(
    skillPaths.map(path => readFileSync(join(root, path), 'utf8')),
    files
  )
  assert.equal(galactica(root, 'init').stdout, skillPaths.map(path => `updated ${path}\n`).join(''))
  assert.match(
    readFileSync(join(root, skillPaths[0]!), 'utf8'),
    /`npx @cognitap\/galactica overview`/
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
    `updated ${agents}\nkept ${claude}: edited since galactica wrote it, --force overwrites it\n`
  )
  assert.equal(readFileSync(join(root, claude), 'utf8'), 'Our own notes.\n')

  writeFileSync(join(root, agents), 'Our own notes.\n')
  assert.equal(galactica(root, 'init').status, 1)
  const forced = galactica(root, 'init', '--force')
  assert.equal(forced.status, 0)
  assert.equal(forced.stdout, skillPaths.map(path => `updated ${path}\n`).join(''))
})

test('init --root installs into that directory and prints paths from the current one', t => {
  const root = repository(t, { 'packages/app/package.json': {} })
  const { status, stdout } = galactica(join(root, 'packages/app'), 'init', '--root', '../..')
  assert.equal(status, 0)
  assert.equal(stdout, skillPaths.map(path => `created ../../${path}\n`).join(''))
  assert.ok(existsSync(join(root, skillPaths[0]!)))
})

test('init takes no argument, no flag of another command and no empty --command', () => {
  for (const args of [
    ['init', 'src'],
    ['init', '--json'],
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
