import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { commands } from '../src/contract.ts'
import { fixtureRepo } from './fixtures.ts'

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
  for (const command of commands) assert.match(stdout, new RegExp(`^  ${command}\\b`, 'm'))
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
    ['overview', '--root', 'nowhere']
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
