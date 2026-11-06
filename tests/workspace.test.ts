import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discover, type Discovery } from '../src/discovery.ts'
import { emptyConfig, parseRepoPath, type Model } from '../src/model.ts'
import { packageOf, pnpmWorkspacePatterns } from '../src/workspace.ts'
import { repository } from './temp-repository.ts'

const membership = (discovery: Discovery) =>
  Object.fromEntries(discovery.modules.map(module => [module.path, module.package]))

test('pnpm-workspace.yaml packages as a block sequence, with quotes and comments', () => {
  const yaml = [
    '# workspace',
    'packages:',
    "  - 'apps/*' # applications",
    '  - "libs/**"',
    '',
    '  - tools/cli',
    "  - '!apps/legacy'",
    'catalog:',
    '  react: 19.0.0'
  ].join('\n')
  assert.deepEqual(pnpmWorkspacePatterns(yaml), ['apps/*', 'libs/**', 'tools/cli', '!apps/legacy'])
})

test('pnpm-workspace.yaml packages as a flow sequence, on one line or several', () => {
  assert.deepEqual(pnpmWorkspacePatterns("packages: ['apps/*', libs/*]\n"), ['apps/*', 'libs/*'])
  assert.deepEqual(
    pnpmWorkspacePatterns('packages: [\n  "apps/*", # apps\n  libs/*,\n]\nnodeVersion: 26\n'),
    ['apps/*', 'libs/*']
  )
})

test('a pnpm-workspace.yaml without packages names none, and other shapes throw', () => {
  assert.equal(
    pnpmWorkspacePatterns('nodeVersion: 26.11.1\nallowBuilds:\n  esbuild: true\n'),
    undefined
  )
  assert.throws(() => pnpmWorkspacePatterns('packages: apps/*\n'), /must be a sequence/)
  assert.throws(() => pnpmWorkspacePatterns('packages:\n  apps: true\n'), /sequence of strings/)
  assert.throws(() => pnpmWorkspacePatterns('packages:\n  - *anchor\n'), /unsupported value/)
  assert.throws(() => pnpmWorkspacePatterns("packages: ['apps/*'\n"), /close with \]/)
})

test('pnpm-workspace.yaml names the packages, by their package.json name', t => {
  const root = repository(t, {
    'package.json': { name: 'root' },
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'packages/ui/package.json': { name: '@acme/ui' },
    'packages/ui/src/Button.tsx': '',
    'packages/api/package.json': { name: '@acme/api' },
    'packages/api/index.ts': ''
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(discovery.packages, {
    '@acme/api': { dir: 'packages/api' },
    '@acme/ui': { dir: 'packages/ui' }
  })
  assert.deepEqual(membership(discovery), {
    'packages/api/index.ts': '@acme/api',
    'packages/ui/src/Button.tsx': '@acme/ui'
  })
})

test('package.json workspaces names the packages, as a list or as { packages }', t => {
  for (const workspaces of [['packages/*'], { packages: ['packages/*'] }]) {
    const root = repository(t, {
      'package.json': { name: 'root', workspaces },
      'packages/ui/package.json': { name: '@acme/ui' },
      'packages/ui/index.ts': ''
    })
    assert.deepEqual(discover(root, emptyConfig).packages, { '@acme/ui': { dir: 'packages/ui' } })
  }
})

test('a pnpm-workspace.yaml it cannot read is a warning, and workspaces applies instead', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['libs/*'] },
    'pnpm-workspace.yaml': 'packages: libs/*\n',
    'libs/a/package.json': { name: 'a' },
    'libs/a/index.ts': ''
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(discovery.packages, { a: { dir: 'libs/a' } })
  assert.deepEqual(discovery.warnings, [
    { path: 'pnpm-workspace.yaml', message: 'packages: packages must be a sequence' }
  ])
})

test('a pnpm-workspace.yaml without packages leaves workspaces to decide', t => {
  const root = repository(t, {
    'package.json': { name: 'root' },
    'pnpm-workspace.yaml': 'nodeVersion: 26.11.1\n',
    'packages/ui/package.json': { name: '@acme/ui' },
    'src/main.ts': ''
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(discovery.packages, { root: { dir: '.' } })
  assert.deepEqual(discovery.warnings, [])
})

test('negated patterns exclude, and ** matches packages at any depth', t => {
  const root = repository(t, {
    'package.json': { name: 'root' },
    'pnpm-workspace.yaml': "packages:\n  - 'packages/**'\n  - '!packages/legacy/**'\n",
    'packages/applications/web/package.json': { name: 'web' },
    'packages/applications/web/main.ts': '',
    'packages/libraries/ui/package.json': { name: 'ui' },
    'packages/libraries/ui/index.ts': '',
    'packages/legacy/old/package.json': { name: 'old' },
    'packages/legacy/old/index.ts': ''
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(discovery.packages, {
    root: { dir: '.' },
    ui: { dir: 'packages/libraries/ui' },
    web: { dir: 'packages/applications/web' }
  })
  assert.equal(membership(discovery)['packages/legacy/old/index.ts'], 'root')
})

test('a member without a name is skipped with a warning', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/named/package.json': { name: 'named' },
    'packages/named/index.ts': '',
    'packages/unnamed/package.json': { private: true }
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(discovery.packages, { named: { dir: 'packages/named' } })
  assert.deepEqual(discovery.warnings, [
    {
      path: 'packages/unnamed/package.json',
      message: 'a workspace package without a name is skipped'
    }
  ])
})

test('a module belongs to the innermost package that contains it', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*', 'packages/app/plugins/*'] },
    'packages/app/package.json': { name: 'app' },
    'packages/app/src/main.ts': '',
    'packages/app/plugins/auth/package.json': { name: 'auth' },
    'packages/app/plugins/auth/index.ts': '',
    'packages/application/package.json': { name: 'application' },
    'packages/application/index.ts': ''
  })
  assert.deepEqual(membership(discover(root, emptyConfig)), {
    'packages/app/plugins/auth/index.ts': 'auth',
    'packages/app/src/main.ts': 'app',
    'packages/application/index.ts': 'application'
  })
})

test('the root is a package when a module lies outside every workspace package', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/ui/package.json': { name: 'ui' },
    'packages/ui/index.ts': '',
    'scripts/release.ts': ''
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(discovery.packages, { root: { dir: '.' }, ui: { dir: 'packages/ui' } })
  assert.deepEqual(membership(discovery), {
    'packages/ui/index.ts': 'ui',
    'scripts/release.ts': 'root'
  })
})

test('the root is no package when every module lies in a workspace package', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/ui/package.json': { name: 'ui' },
    'packages/ui/index.ts': '',
    'README.md': ''
  })
  assert.deepEqual(discover(root, emptyConfig).packages, { ui: { dir: 'packages/ui' } })
})

test('packageOf picks the longest directory prefix, and the root contains every path', () => {
  const packages = (dirs: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(dirs).map(([name, dir]) => [name, { dir: parseRepoPath(dir) }])
    ) as Model['packages']
  const members = { app: 'packages/app', auth: 'packages/app/plugins/auth' }
  const withRoot = packages({ root: '.', ...members })
  const of = (path: string) => packageOf(withRoot, parseRepoPath(path))
  assert.equal(of('packages/app/plugins/auth/index.ts'), 'auth')
  assert.equal(of('packages/app/src/main.ts'), 'app')
  assert.equal(of('packages/application/index.ts'), 'root')
  assert.equal(packageOf(packages(members), parseRepoPath('scripts/x.ts')), undefined)
})

test('package lookup does not rescan every package for each module (DEV-730)', () => {
  let scans = 0
  const packages = new Proxy(
    Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `pkg${index}`,
        { dir: parseRepoPath(`packages/pkg${index}`) }
      ])
    ) as Model['packages'],
    {
      ownKeys(target) {
        scans++
        return Reflect.ownKeys(target)
      }
    }
  )
  for (let index = 0; index < 1000; index++) {
    const owner = `pkg${index % 100}`
    assert.equal(packageOf(packages, parseRepoPath(`packages/${owner}/src/file${index}.ts`)), owner)
  }
  assert.ok(scans <= 2, `package map was enumerated ${scans} times for 1,000 modules`)
})
