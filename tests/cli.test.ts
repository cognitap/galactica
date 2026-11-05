import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { commands } from '../src/contract.ts'
import { validConfigs } from './config-examples.ts'
import { fixtureRepo } from './fixtures.ts'
import { git, gitRepository, repository } from './temp-repository.ts'

const cli = new URL('../dist/cli.js', import.meta.url).pathname

/** A home of its own, so a repository without node_modules keeps its cache out of the user's. */
const home = mkdtempSync(join(tmpdir(), 'galactica-home-'))
after(() => rmSync(home, { recursive: true, force: true }))
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CACHE_HOME: join(home, '.cache'),
  LOCALAPPDATA: join(home, 'AppData', 'Local')
}

function galactica(cwd: string, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync('node', [cli, ...args], {
    cwd,
    env,
    encoding: 'utf8'
  })
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
  const gitlab = 'https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}'
  const root = linkedRepository(t, 'https://gitlab.example.com/group/repo.git')
  assert.equal(pageSource(root).source, null)
  const { status, source } = pageSource(root, '--source-url', gitlab)
  assert.equal(status, 0)
  assert.match(
    source.template,
    /^https:\/\/gitlab\.example\.com\/group\/repo\/-\/blob\/[0-9a-f]{40}\/\{path\}#L\{line\}$/
  )
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

test('commands take kinds and areas from galactica.config.json', t => {
  const root = repository(t, {
    'package.json': { name: 'acme' },
    'galactica.config.json': validConfigs.storybookAndComponents,
    '.storybook/examples/KbdExamples.tsx': '',
    'src/components/Kbd/Kbd.tsx': 'export const Kbd = 1',
    'src/components/Kbd/Kbd.stories.tsx': ''
  })
  assert.match(
    galactica(root, 'outline', '.storybook/examples/KbdExamples.tsx').stdout,
    /^\.storybook\/examples\/KbdExamples\.tsx \(story, area \.storybook\/examples, package acme\)/
  )
  assert.match(
    galactica(root, 'outline', 'src/components/Kbd/Kbd.tsx').stdout,
    /^src\/components\/Kbd\/Kbd\.tsx \(source, area src\/components, package acme\)/
  )
})

test('an invalid galactica.config.json fails every command with one line naming the key', t => {
  const root = repository(t, {
    'package.json': {},
    'src/a.ts': '',
    'galactica.config.json': { kinds: { storyy: ['.storybook/**'] } }
  })
  const message =
    'galactica.config.json: kinds.storyy: unknown kind; expected source, test, story or config'
  for (const args of [['overview'], ['html', '--out', join(root, 'map.html')]]) {
    const { status, stdout, stderr } = galactica(root, ...args)
    assert.equal(status, 1, args[0])
    assert.equal(stdout, '', args[0])
    assert.equal(stderr, `galactica: ${message}\n`, args[0])
  }
  assert.equal(existsSync(join(root, 'map.html')), false)
  const json = galactica(root, 'where', 'a', '--json')
  assert.equal(json.status, 1)
  assert.deepEqual(JSON.parse(json.stdout).error, { code: 'usage', message })
})

test('html has no links outside a git repository', t => {
  const { status, source } = pageSource(repository(t, { 'package.json': {}, 'src/a.ts': '' }))
  assert.equal(status, 0)
  assert.equal(source, null)
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

function filesUnder(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
    .sort()
}

test('a command keeps its cache under node_modules/.cache/galactica, and --no-cache writes none', t => {
  const root = repository(t, {
    'package.json': { name: 'cached' },
    'src/a.ts': "import { b } from './b'\nexport const a = b",
    'src/b.ts': 'export const b = 1',
    'node_modules/left-pad/index.js': ''
  })
  const before = filesUnder(root)
  const uncached = galactica(root, 'deps', 'src/a.ts', '--json', '--no-cache')
  assert.equal(uncached.status, 0)
  assert.deepEqual(filesUnder(root), before)

  const cold = galactica(root, 'deps', 'src/a.ts', '--json')
  const warm = galactica(root, 'deps', 'src/a.ts', '--json')
  assert.equal(cold.stdout, uncached.stdout)
  assert.equal(warm.stdout, uncached.stdout)
  assert.deepEqual(
    filesUnder(root),
    [...before, join('node_modules', '.cache', 'galactica', 'cache.json')].sort()
  )
  assert.equal(galactica(root, 'html', '--no-cache', '--out', join(home, 'map.html')).status, 0)
})
