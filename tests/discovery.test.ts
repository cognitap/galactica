import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'
import { defaultCompilerOptions } from '../src/compiler-settings.ts'
import { compilerOptionsOf, discover, type Discovery } from '../src/discovery.ts'
import { git, gitRepository, repository } from './temp-repository.ts'

const paths = (discovery: Discovery) => discovery.modules.map(module => module.path)
const configs = (discovery: Discovery) =>
  Object.fromEntries(discovery.modules.map(module => [module.path, module.config]))

test('modules are the files with a module extension, sorted, with language and kind', t => {
  const root = repository(t, {
    'src/b.tsx': '',
    'src/a.ts': '',
    'src/a.test.ts': '',
    'src/env.d.ts': '',
    'src/style.css': '',
    'README.md': '',
    'vite.config.mjs': ''
  })
  assert.deepEqual(
    discover(root).modules.map(({ path, language, kind }) => [path, language, kind]),
    [
      ['src/a.test.ts', 'ts', 'test'],
      ['src/a.ts', 'ts', 'source'],
      ['src/b.tsx', 'tsx', 'source'],
      ['vite.config.mjs', 'mjs', 'config']
    ]
  )
})

test('in a git work tree, ignored files are skipped and untracked ones are kept', t => {
  const root = gitRepository(t, {
    '.gitignore': 'output/\n*.local.ts\n',
    'src/tracked.ts': '',
    'src/gone.ts': '',
    'src/untracked.ts': '',
    'src/secret.local.ts': '',
    'output/tsconfig.json': { include: ['**/*'] },
    'output/report.ts': ''
  })
  git(root, 'add', 'src/tracked.ts', 'src/gone.ts')
  rmSync(join(root, 'src/gone.ts'))
  assert.deepEqual(paths(discover(root)), ['src/tracked.ts', 'src/untracked.ts'])
})

test('a GIT_DIR inherited from a hook or rebase --exec does not redirect git', t => {
  const other = gitRepository(t, { 'elsewhere.ts': '' })
  const root = gitRepository(t, { '.gitignore': 'vendor.ts\n', 'kept.ts': '', 'vendor.ts': '' })
  git(root, 'add', '--force', 'vendor.ts')
  const inherited = process.env.GIT_DIR
  process.env.GIT_DIR = join(other, '.git')
  t.after(() => {
    if (inherited === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = inherited
  })
  assert.deepEqual(paths(discover(root)), ['kept.ts', 'vendor.ts'])
  const fresh = gitRepository(t, { 'fresh.ts': '' })
  assert.ok(existsSync(join(fresh, '.git')), 'the helper initialises its own repository')
})

test('build output and installed packages are skipped, even when git tracks them', t => {
  const root = gitRepository(t, {
    'src/main.ts': '',
    'node_modules/pkg/index.js': '',
    'packages/ui/node_modules/pkg/index.js': '',
    'dist/main.js': '',
    'packages/ui/build/index.js': '',
    '.next/server/page.js': '',
    'storybook-static/main.js': ''
  })
  git(root, 'add', '--force', '.')
  assert.deepEqual(paths(discover(root)), ['src/main.ts'])
})

test('a config outDir is skipped as build output', t => {
  const root = gitRepository(t, {
    'tsconfig.json': { compilerOptions: { outDir: 'lib', allowJs: true }, include: ['src'] },
    'src/main.ts': '',
    'lib/main.js': ''
  })
  assert.deepEqual(paths(discover(root)), ['src/main.ts'])
})

test('the outDir of a package build config that owns no module is skipped too', t => {
  const root = gitRepository(t, {
    'tsconfig.json': { include: ['src'] },
    'tsconfig.build.json': { compilerOptions: { outDir: 'emitted', allowJs: true } },
    'src/main.ts': '',
    'emitted/main.js': ''
  })
  assert.deepEqual(paths(discover(root)), ['src/main.ts'])
})

test('an outDir that holds the config itself marks no build output', t => {
  const root = repository(t, {
    'tsconfig.json': { compilerOptions: { outDir: '.' } },
    'src/main.ts': ''
  })
  assert.deepEqual(paths(discover(root)), ['src/main.ts'])
})

test('outside a git work tree, a walk lists the files, without reading .gitignore', t => {
  const root = repository(t, {
    '.gitignore': 'output/\n',
    'src/main.ts': '',
    'output/report.ts': '',
    'node_modules/pkg/index.js': '',
    'coverage/lcov.js': ''
  })
  assert.deepEqual(paths(discover(root)), ['output/report.ts', 'src/main.ts'])
})

test('the repository and its one package are named by the root package.json', t => {
  const named = repository(t, { 'package.json': { name: '@acme/app' } })
  assert.deepEqual(discover(named).repository, { name: '@acme/app' })
  assert.deepEqual(discover(named).packages, { '@acme/app': { dir: '.' } })
  const unnamed = repository(t, { 'src/main.ts': '' })
  assert.deepEqual(discover(unnamed).repository, { name: basename(unnamed) })
})

test('the nearest tsconfig.json that includes a module owns it', t => {
  const root = repository(t, {
    'tsconfig.json': { include: ['src', 'packages/ui/stories'] },
    'src/main.ts': '',
    'packages/ui/tsconfig.json': { include: ['src'] },
    'packages/ui/src/Button.tsx': '',
    'packages/ui/stories/Button.stories.tsx': '',
    'scripts/release.ts': ''
  })
  assert.deepEqual(configs(discover(root)), {
    'packages/ui/src/Button.tsx': 'packages/ui/tsconfig.json',
    'packages/ui/stories/Button.stories.tsx': 'tsconfig.json',
    'scripts/release.ts': null,
    'src/main.ts': 'tsconfig.json'
  })
})

test('a solution-style config hands each module to the reference that includes it', t => {
  const root = repository(t, {
    'tsconfig.json': {
      files: [],
      references: [{ path: './tsconfig.app.json' }, { path: './config' }]
    },
    'tsconfig.app.json': {
      compilerOptions: { composite: true, jsx: 'react-jsx' },
      include: ['src']
    },
    'config/tsconfig.json': {
      compilerOptions: { composite: true },
      references: [{ path: '../tsconfig.node.json' }],
      files: []
    },
    'tsconfig.node.json': { compilerOptions: { composite: true }, include: ['vite.config.ts'] },
    'src/App.tsx': '',
    'vite.config.ts': '',
    'scripts/release.mjs': ''
  })
  const discovery = discover(root)
  assert.deepEqual(configs(discovery), {
    'scripts/release.mjs': null,
    'src/App.tsx': 'tsconfig.app.json',
    'vite.config.ts': 'tsconfig.node.json'
  })
  const app = discovery.modules.find(module => module.path === 'src/App.tsx')!
  assert.equal(compilerOptionsOf(discovery, app).jsx, ts.JsxEmit.ReactJSX)
  assert.deepEqual([...discovery.configs.keys()].sort(), [
    'tsconfig.app.json',
    'tsconfig.node.json'
  ])
})

test('options follow an extends chain', t => {
  const root = repository(t, {
    'tsconfig.base.json': { compilerOptions: { strict: true, jsx: 'preserve' } },
    'configs/react.json': {
      extends: '../tsconfig.base.json',
      compilerOptions: { jsx: 'react-jsx', paths: { '@/*': ['./src/*'] } }
    },
    'packages/app/tsconfig.json': { extends: '../../configs/react.json', include: ['src'] },
    'packages/app/src/main.tsx': ''
  })
  const discovery = discover(root)
  const [module] = discovery.modules
  assert.equal(module?.config, 'packages/app/tsconfig.json')
  const options = compilerOptionsOf(discovery, module!)
  assert.equal(options.strict, true)
  assert.equal(options.jsx, ts.JsxEmit.ReactJSX)
  assert.deepEqual(options.paths, { '@/*': ['./src/*'] })
})

test('a module no config includes gets bundler defaults that allow JavaScript', t => {
  const root = repository(t, {
    'tsconfig.json': { include: ['src/**/*.ts'] },
    'src/main.ts': '',
    'src/legacy.cjs': 'module.exports = {}'
  })
  const discovery = discover(root)
  const legacy = discovery.modules.find(module => module.path === 'src/legacy.cjs')!
  assert.equal(legacy.config, null)
  assert.deepEqual(compilerOptionsOf(discovery, legacy), defaultCompilerOptions)
})

test('framework files belong to the config whose include matches them', t => {
  const root = repository(t, {
    'tsconfig.json': { include: ['src'] },
    'src/Counter.vue': '',
    'src/Card.svelte': '',
    'src/Page.astro': ''
  })
  assert.deepEqual(Object.values(configs(discover(root))), [
    'tsconfig.json',
    'tsconfig.json',
    'tsconfig.json'
  ])
})

test('config problems become warnings, and the options TypeScript still honours stay', t => {
  const root = repository(t, {
    'tsconfig.json': {
      compilerOptions: { baseUrl: './src', notAnOption: true },
      include: ['src']
    },
    'src/main.ts': '',
    'package.json': '{ "name": '
  })
  const discovery = discover(root)
  assert.deepEqual(
    discovery.warnings.map(({ path, message }) => [
      path,
      /SyntaxError|'baseUrl' is deprecated|Unknown compiler option 'notAnOption'/.exec(message)?.[0]
    ]),
    [
      ['package.json', 'SyntaxError'],
      ['tsconfig.json', "'baseUrl' is deprecated"],
      ['tsconfig.json', "Unknown compiler option 'notAnOption'"]
    ]
  )
  const [module] = discovery.modules
  assert.equal(compilerOptionsOf(discovery, module!).baseUrl, join(root, 'src'))
})
