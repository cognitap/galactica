import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { commands } from '../src/contract.ts'
import { TESTS_NOTE } from '../src/queries.ts'
import { cliRunner } from './cli.ts'
import { invalidConfigs, validConfigs } from './config-examples.ts'
import { fixtureRepo } from './fixtures.ts'
import { gitRepository, repository } from './temp-repository.ts'
const { run: galactica, node } = cliRunner()
const cli = new URL('../dist/bin.js', import.meta.url).pathname
const program = new URL('../dist/cli.js', import.meta.url).pathname

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

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
  const result = node(['--input-type=module', '-e', script], { cwd: plain })
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
  const { status, stdout, stderr } = node(
    ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, cli, 'overview'],
    { cwd: plain }
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

test('help links the JSON contract on GitHub where packaged CLI users can read it (DEV-718)', () => {
  const { status, stdout } = galactica(plain, '--help')
  assert.equal(status, 0)
  assert.ok(stdout.includes('https://github.com/cognitap/galactica/blob/main/docs/json-output.md'))
})

test('no command or an unknown one points at help in one line and exits with code 1', () => {
  for (const args of [[], ['nope']]) {
    const { status, stderr } = galactica(plain, ...args)
    assert.equal(status, 1)
    assert.match(stderr, /--help/)
    assert.equal(stderr.trim().split('\n').length, 1)
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
