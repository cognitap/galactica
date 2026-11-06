import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { cacheDirectory, CACHE_FORMAT } from '../src/cache.ts'
import { loadConfig } from '../src/config.ts'
import { TESTS_NOTE } from '../src/queries.ts'
import { commands } from '../src/contract.ts'
import { MODEL_CACHE_FORMAT } from '../src/model-cache.ts'
import { gitlab, invalidConfigs, validConfigs } from './config-examples.ts'
import { fixtureRepo } from './fixtures.ts'
import { git, gitRepository, repository } from './temp-repository.ts'

const cli = new URL('../dist/bin.js', import.meta.url).pathname
const program = new URL('../dist/cli.js', import.meta.url).pathname
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
/** The stamp of the built CLI, which hashes its own files. */
const { currentStamp }: typeof import('../src/cache.ts') = await import(
  new URL('../dist/cache.js', import.meta.url).href
)

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

test('the CLI loads TypeScript only when a command analyzes a repository', () => {
  const script = [
    "import { createRequire } from 'node:module'",
    `const { run } = await import(${JSON.stringify(program)})`,
    'const loaded = () =>',
    "  Object.keys(createRequire(import.meta.url).cache).some(file => file.includes('/typescript/'))",
    'const before = loaded()',
    `await run(['--version'], ${JSON.stringify(plain)})`,
    'const afterVersion = loaded()',
    `await run(['overview', '--no-cache'], ${JSON.stringify(plain)})`,
    'console.log(JSON.stringify([before, afterVersion, loaded()]))'
  ].join('\n')
  const result = spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: plain,
    env,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [false, false, true])
})

test('an older Node.js gets one line and loads nothing beyond the version check', () => {
  const preload = [
    "import { registerHooks } from 'node:module'",
    "Object.defineProperty(process.versions, 'node', { value: '22.21.1' })",
    'const loaded = []',
    'registerHooks({ resolve: (specifier, context, next) => {',
    '  const resolved = next(specifier, context)',
    '  loaded.push(resolved.url)',
    '  return resolved',
    '} })',
    "process.on('exit', () => console.log(JSON.stringify(loaded)))"
  ].join('\n')
  const { status, stdout, stderr } = spawnSync(
    'node',
    ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, cli, 'overview'],
    { cwd: plain, env, encoding: 'utf8' }
  )
  assert.equal(status, 1)
  assert.equal(stderr, 'galactica: needs Node.js 24.1.0 or newer, and this is Node.js 22.21.1\n')
  const dist = new URL('../dist/', import.meta.url).href
  const loaded = (JSON.parse(stdout) as string[]).map(url => url.replace(dist, ''))
  assert.deepEqual(loaded, ['bin.js', 'node-version.js'])
})

test('prints usage with --help, listing every command', () => {
  const { status, stdout } = galactica(plain, '--help')
  assert.equal(status, 0)
  assert.match(stdout, /^Usage: galactica/)
  for (const command of [...commands, 'html', 'init']) {
    assert.match(stdout, new RegExp(`^  ${command}\\b`, 'm'))
  }
})

test('prints the package version with --version', () => {
  assert.equal(galactica(plain, '--version').stdout.trim(), version)
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
    `src/math.ts (module): 1 dependent within depth 1, 0 tests\n1  src/main.ts  PI, add\nno tests\n${TESTS_NOTE}\n`
  )
  const deps = JSON.parse(galactica(plain, 'deps', 'src/main.ts', '--json').stdout)
  assert.deepEqual(deps.unresolved, [{ from: 'src/main.ts', specifier: './gone' }])
})

test('cycles lists each loop that runs as code, load time first, through barrels, and no type-only loop', () => {
  const cycleKinds = fixtureRepo('cycle-kinds')
  const json = JSON.parse(galactica(cycleKinds, 'cycles', '--json').stdout)
  assert.deepEqual(
    json.cycles.map((cycle: { modules: string[]; loadTime: boolean }) => [
      cycle.modules,
      cycle.loadTime
    ]),
    [
      [['src/load/plugins.ts', 'src/load/config.ts'], true],
      [['src/barrel/log.ts', 'src/barrel/store.ts'], false],
      [['src/later/order.ts', 'src/later/user.ts'], false]
    ]
  )
  const text = galactica(cycleKinds, 'cycles').stdout
  assert.match(
    text,
    /^ {2}src\/load\/config\.ts:1 -> src\/load\/plugins\.ts {2}plugins {2}used later {2}break here$/m
  )
  assert.match(
    text,
    /^ {2}src\/load\/plugins\.ts:1 -> src\/load\/config\.ts {2}defaults {2}used at load time$/m
  )
  assert.match(
    text,
    /^ {2}src\/barrel\/log\.ts:1 -> src\/barrel\/store\.ts {2}via src\/barrel\/index\.ts {2}Store {2}used later$/m
  )
  assert.doesNotMatch(text, /src\/types\//)
  assert.match(
    galactica(cycleKinds, 'uses', 'src/load/config.ts').stdout,
    /^in an import cycle with src\/load\/plugins\.ts, used at load time: the cycles command shows where to break it$/m
  )
  assert.doesNotMatch(galactica(cycleKinds, 'deps', 'src/types/shape.ts').stdout, /cycle/)
})

test('health prints its findings and exits 0 whatever it finds', () => {
  const internal = fixtureRepo('internal-imports')
  const text = galactica(internal, 'health')
  assert.equal(text.status, 0)
  assert.match(text.stdout, /^0 import cycles, 1 oversized area, 7 cross-package private imports$/m)
  assert.match(
    text.stdout,
    /^ {2}packages\/app\/src\/main\.ts:1 {2}\.\.\/\.\.\/core\/src\/math {2}add {2}relative path into @fx\/core {2}use @fx\/core$/m
  )
  const json = galactica(internal, 'health', '--json')
  assert.equal(json.status, 0)
  const output = JSON.parse(json.stdout)
  assert.equal(output.command, 'health')
  assert.equal(output.internalImports.length, 7)
  const cyclic = galactica(fixtureRepo('cycle-kinds'), 'health')
  assert.equal(cyclic.status, 0)
  assert.match(
    cyclic.stdout,
    /^3 import cycles, 0 oversized areas, 0 cross-package private imports$/m
  )
})

test('health takes health.areaModules from galactica.config.json', t => {
  const root = repository(t, {
    'package.json': { name: 'acme' },
    'galactica.config.json': validConfigs.smallAreas,
    'src/a.ts': '',
    'src/b.ts': '',
    'src/c.ts': ''
  })
  const output = JSON.parse(galactica(root, 'health', '--json').stdout)
  assert.equal(output.areaModules, 2)
  assert.deepEqual(output.oversizedAreas, [{ path: 'src', package: 'acme', modules: 3, median: 3 }])
  assert.match(
    galactica(root, 'health').stdout,
    /^oversized areas \(more than 2 source modules, by health\.areaModules\):$/m
  )
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

test('overview counts the warnings, and its JSON lists them the same from every directory', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/b/package.json': { name: 'shared' },
    'packages/b/index.ts': '',
    'packages/a/package.json': { name: 'shared' },
    'packages/a/index.ts': '',
    'packages/c/package.json': { private: true },
    'packages/c/tsconfig.json': { extends: './missing.json' },
    'packages/c/index.ts': ''
  })
  const warnings = [
    {
      path: 'packages/b/package.json',
      message: 'shared is also the name of packages/a, which keeps it'
    },
    { path: 'packages/c/package.json', message: 'a workspace package without a name is skipped' },
    { path: 'packages/c/tsconfig.json', message: "Cannot read file 'packages/c/missing.json'." }
  ]
  const text = galactica(root, 'overview', '--no-cache')
  assert.equal(text.status, 0)
  assert.match(text.stdout, /^3 warnings, overview --json lists them$/m)

  const outputs = [
    galactica(root, 'overview', '--json'),
    galactica(root, 'overview', '--json'),
    galactica(join(root, 'packages/c'), 'overview', '--json', '--root', '../..'),
    galactica(tmpdir(), 'overview', '--json', '--root', root, '--no-cache')
  ].map(({ stdout }) => stdout)
  assert.deepEqual(JSON.parse(outputs[0]!).warnings, warnings)
  for (const output of outputs.slice(1)) assert.equal(output, outputs[0])
})

test('deps counts a relative import into an untracked node_modules as its package', t => {
  const root = gitRepository(t, {
    '.gitignore': 'node_modules/\n',
    'package.json': { name: 'site' },
    'src/Toc.astro':
      "---\nimport List from '../node_modules/@astrojs/starlight/dist/List.astro'\n---\n",
    'node_modules/@astrojs/starlight/package.json': { name: '@astrojs/starlight' },
    'node_modules/@astrojs/starlight/dist/List.astro': ''
  })
  const deps = JSON.parse(galactica(root, 'deps', 'src/Toc.astro', '--json').stdout)
  assert.deepEqual(deps.external, ['@astrojs/starlight'])
  assert.deepEqual(deps.unresolved, [])
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

test('no command or an unknown one points at help in one line and exits with code 1', () => {
  for (const args of [[], ['nope']]) {
    const { status, stderr } = galactica(plain, ...args)
    assert.equal(status, 1)
    assert.match(stderr, /--help/)
    assert.equal(stderr.trim().split('\n').length, 1)
  }
})

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

test('commands take kinds and areas from galactica.config.json', t => {
  const root = repository(t, {
    'package.json': { name: 'acme' },
    'galactica.config.json': validConfigs.themeAndComponents,
    'docs/.vitepress/theme/index.ts': '',
    'src/components/Kbd/Kbd.tsx': 'export const Kbd = 1',
    'src/components/Kbd/Kbd.stories.tsx': ''
  })
  assert.match(
    galactica(root, 'outline', 'docs/.vitepress/theme/index.ts').stdout,
    /^docs\/\.vitepress\/theme\/index\.ts \(source, area docs\/\.vitepress\/theme, package acme\)/
  )
  assert.match(
    galactica(root, 'outline', 'src/components/Kbd/Kbd.tsx').stdout,
    /^src\/components\/Kbd\/Kbd\.tsx \(source, area src\/components, package acme\)/
  )
})

test('an invalid galactica.config.json fails every command with one line naming the key', t => {
  const unknownKind = invalidConfigs.find(({ message }) => message.startsWith('kinds.storyy'))!
  const root = repository(t, {
    'package.json': {},
    'src/a.ts': '',
    'galactica.config.json': unknownKind.config
  })
  const message = `galactica.config.json: ${unknownKind.message}`
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

/** A repository and a folder outside it holding `outside.txt`, which a link in the repository can point at. */
function besideOutside(t: TestContext) {
  const root = repository(t, { 'package.json': {}, 'src/a.ts': 'export const a = 1' })
  const outside = repository(t, { 'outside.txt': 'Not Galactica.\n' })
  return { root, outside, untouched: () => filesUnder(outside).join() === 'outside.txt' }
}

function link(root: string, path: string, target: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  symlinkSync(target, join(root, path))
}

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

function filesUnder(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
    .sort()
}

const cacheOf = (root: string) =>
  cacheDirectory(root, { platform: process.platform, env, home: realpathSync(home) })!

test('a command keeps its cache in the user cache folder, never in the repository, and --no-cache writes none', t => {
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
  assert.deepEqual(filesUnder(root), before)
  assert.deepEqual(filesUnder(cacheOf(root)), ['cache.json', 'model.json'])
  assert.equal(galactica(root, 'html', '--no-cache', '--out', join(home, 'map.html')).status, 0)
})

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

const stealing = {
  'package.json': { name: 'forge' },
  'src/a.ts':
    "import { execSync } from 'node:child_process'\nexport function stealKeys() { return execSync('id') }",
  'node_modules/.keep': ''
}

const shipped = (root: string, file: string, text: string) => {
  mkdirSync(join(root, 'node_modules/.cache/galactica'), { recursive: true })
  writeFileSync(join(root, 'node_modules/.cache/galactica', file), text)
}

const outlined = (root: string) => {
  const { status, stdout, stderr } = galactica(root, 'outline', 'src/a.ts')
  assert.equal(status, 0, stderr)
  return stdout
}

const harmless = {
  name: 'formatDate',
  kind: 'function',
  line: 1,
  default: false,
  signature: 'function formatDate()'
}

test('an extraction cache the repository ships is never read', t => {
  const root = repository(t, stealing)
  const { mtimeMs, size } = statSync(join(root, 'src/a.ts'))
  const hash = sha256(readFileSync(join(root, 'src/a.ts'), 'utf8'))
  const entry = { hash, mtimeMs, size, symbols: [harmless], imports: [] }
  shipped(
    root,
    'cache.json',
    JSON.stringify({ format: CACHE_FORMAT, ...currentStamp(), modules: { 'src/a.ts': entry } })
  )
  assert.match(outlined(root), /stealKeys/)
  assert.doesNotMatch(outlined(root), /formatDate/)
})

test('a model cache the repository ships is never read', t => {
  const root = repository(t, stealing)
  const config = sha256(JSON.stringify(loadConfig(root)))
  const inputs = { config, git: null, directories: [], files: [] }
  const header = { format: MODEL_CACHE_FORMAT, ...currentStamp(), inputs }
  const module = { path: 'src/a.ts', hash: 'f00d', symbols: [harmless], edges: [] }
  const model = {
    format: 3,
    repository: { name: 'forge' },
    packages: { forge: { dir: '.' } },
    modules: { 'src/a.ts': module }
  }
  const body = { model, warnings: [], unresolved: 0, skipped: {} }
  shipped(root, 'model.json', `${JSON.stringify(header)}\n${JSON.stringify(body)}`)
  assert.match(outlined(root), /stealKeys/)
  assert.doesNotMatch(outlined(root), /formatDate/)
})

test('a cache folder the repository links elsewhere is never written', t => {
  const root = repository(t, stealing)
  const elsewhere = repository(t, {})
  mkdirSync(join(root, 'node_modules/.cache'))
  symlinkSync(elsewhere, join(root, 'node_modules/.cache/galactica'))
  outlined(root)
  outlined(root)
  assert.deepEqual(readdirSync(elsewhere), [])
})
