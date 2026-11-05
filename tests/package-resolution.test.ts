import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { discover } from '../src/discovery.ts'
import { emptyConfig } from '../src/model.ts'
import { splitSpecifier, workspaceResolver } from '../src/package-resolution.ts'
import { repository, type Files } from './temp-repository.ts'

/** A workspace with one package, `pkg` in `packages/pkg`, whose package.json adds `manifest`. */
function workspace(t: TestContext, manifest: object, files: Files) {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/pkg/package.json': { name: 'pkg', ...manifest },
    ...Object.fromEntries(
      Object.entries(files).map(([path, text]) => [`packages/pkg/${path}`, text])
    )
  })
  return workspaceResolver(discover(root, emptyConfig))
}

/** Each specifier's resolution, as the module path or `unresolved: <reason>`. */
function resolutions(
  t: TestContext,
  manifest: object,
  files: Files,
  specifiers: readonly string[]
) {
  const resolver = workspace(t, manifest, files)
  return Object.fromEntries(
    specifiers.map(specifier => {
      const result = resolver.resolve(specifier)
      if (!result) return [specifier, 'not in the workspace']
      return [specifier, result.kind === 'module' ? result.path : `unresolved: ${result.reason}`]
    })
  )
}

test('a specifier splits into its package name and subpath', () => {
  assert.deepEqual(splitSpecifier('pkg'), { name: 'pkg', subpath: '.' })
  assert.deepEqual(splitSpecifier('pkg/a/b'), { name: 'pkg', subpath: './a/b' })
  assert.deepEqual(splitSpecifier('@scope/pkg'), { name: '@scope/pkg', subpath: '.' })
  assert.deepEqual(splitSpecifier('@scope/pkg/api'), { name: '@scope/pkg', subpath: './api' })
  assert.equal(splitSpecifier('./relative'), undefined)
  assert.equal(splitSpecifier('@scope'), undefined)
  assert.deepEqual(splitSpecifier('JSONStream'), { name: 'JSONStream', subpath: '.' })
  for (const notPackage of [
    '$lib/utils',
    '$app/stores',
    '_private',
    '.hidden',
    '@sc ope/pkg',
    'a b'
  ])
    assert.equal(splitSpecifier(notPackage), undefined, notPackage)
})

test('a specifier that names no workspace package is left to TypeScript', t => {
  assert.deepEqual(resolutions(t, {}, { 'index.ts': '' }, ['react', 'pkgx', './index.ts']), {
    react: 'not in the workspace',
    pkgx: 'not in the workspace',
    './index.ts': 'not in the workspace'
  })
})

test('exports as a string names the package root only', t => {
  assert.deepEqual(
    resolutions(t, { exports: './src/index.ts' }, { 'src/index.ts': '', 'src/a.ts': '' }, [
      'pkg',
      'pkg/src/a.ts'
    ]),
    { pkg: 'packages/pkg/src/index.ts', 'pkg/src/a.ts': 'unresolved: no-export' }
  )
})

test('a subpath map resolves each subpath, scoped names included', t => {
  const root = repository(t, {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/api/package.json': {
      name: '@acme/api',
      exports: { '.': './index.ts', './client': './src/client.ts' }
    },
    'packages/api/index.ts': '',
    'packages/api/src/client.ts': ''
  })
  const resolver = workspaceResolver(discover(root, emptyConfig))
  assert.deepEqual(resolver.resolve('@acme/api'), { kind: 'module', path: 'packages/api/index.ts' })
  assert.deepEqual(resolver.resolve('@acme/api/client'), {
    kind: 'module',
    path: 'packages/api/src/client.ts'
  })
})

test('conditions resolve in the order source, types, import, module, require, node, default, then as listed', t => {
  const exports = {
    './a': { default: './dist/a.js', require: './src/a.cts', source: './src/a.ts' },
    './b': { default: './src/other.ts', node: { require: './src/b.cts', import: './src/b.ts' } },
    './c': { browser: './src/browser.ts', '@acme/source': './src/c.ts' },
    './d': { '@acme/source': './src/a.cts', default: './src/other.ts' }
  }
  assert.deepEqual(
    resolutions(
      t,
      { exports },
      {
        'src/a.ts': '',
        'src/a.cts': '',
        'src/b.ts': '',
        'src/b.cts': '',
        'src/c.ts': '',
        'src/other.ts': ''
      },
      ['pkg/a', 'pkg/b', 'pkg/c', 'pkg/d']
    ),
    {
      'pkg/a': 'packages/pkg/src/a.ts',
      'pkg/b': 'packages/pkg/src/b.ts',
      'pkg/c': 'packages/pkg/src/c.ts',
      'pkg/d': 'packages/pkg/src/other.ts'
    }
  )
})

test('a condition whose target reaches no module falls through to the next', t => {
  assert.deepEqual(
    resolutions(
      t,
      { exports: { types: './types/index.d.ts', default: './src/index.ts' } },
      { 'src/index.ts': '' },
      ['pkg']
    ),
    { pkg: 'packages/pkg/src/index.ts' }
  )
})

test('* patterns substitute the matched text, and the longest prefix wins', t => {
  const exports = {
    './components/*': './src/components/*.tsx',
    './components/internal/*': null,
    './utils/*.js': './src/utils/*.ts'
  }
  assert.deepEqual(
    resolutions(
      t,
      { exports },
      {
        'src/components/Button.tsx': '',
        'src/components/forms/Input.tsx': '',
        'src/components/internal/Secret.tsx': '',
        'src/utils/format.ts': ''
      },
      [
        'pkg/components/Button',
        'pkg/components/forms/Input',
        'pkg/components/internal/Secret',
        'pkg/utils/format.js'
      ]
    ),
    {
      'pkg/components/Button': 'packages/pkg/src/components/Button.tsx',
      'pkg/components/forms/Input': 'packages/pkg/src/components/forms/Input.tsx',
      'pkg/components/internal/Secret': 'unresolved: blocked',
      'pkg/utils/format.js': 'packages/pkg/src/utils/format.ts'
    }
  )
})

test('an array of targets takes the first that reaches a module', t => {
  assert.deepEqual(
    resolutions(
      t,
      { exports: { '.': ['./src/gone.ts', './src/index.ts'] } },
      { 'src/index.ts': '' },
      ['pkg']
    ),
    { pkg: 'packages/pkg/src/index.ts' }
  )
})

test('without exports, the root uses types, typings, module, main, then index', t => {
  const files = {
    'src/types.ts': '',
    'src/typings.ts': '',
    'src/module.ts': '',
    'src/main.ts': '',
    'index.ts': ''
  }
  const fields = {
    types: './src/types.ts',
    typings: './src/typings.ts',
    module: './src/module.ts',
    main: './src/main.ts'
  }
  const order = Object.keys(fields).map(
    (_, index) =>
      resolutions(t, Object.fromEntries(Object.entries(fields).slice(index)), files, ['pkg']).pkg
  )
  assert.deepEqual(order, [
    'packages/pkg/src/types.ts',
    'packages/pkg/src/typings.ts',
    'packages/pkg/src/module.ts',
    'packages/pkg/src/main.ts'
  ])
  assert.deepEqual(resolutions(t, {}, files, ['pkg']), { pkg: 'packages/pkg/index.ts' })
})

test('without exports, any other subpath is a path inside the package', t => {
  assert.deepEqual(
    resolutions(t, {}, { 'utils/format.ts': '', 'utils/index.ts': '' }, [
      'pkg/utils/format',
      'pkg/utils',
      'pkg/utils/missing'
    ]),
    {
      'pkg/utils/format': 'packages/pkg/utils/format.ts',
      'pkg/utils': 'packages/pkg/utils/index.ts',
      'pkg/utils/missing': 'unresolved: missing'
    }
  )
})

test('a JavaScript target tries the TypeScript source extensions in TypeScript order', t => {
  const exports = {
    './js': './src/js.js',
    './both': './src/both.js',
    './jsx': './src/jsx.jsx',
    './mjs': './src/mjs.mjs',
    './cjs': './src/cjs.cjs',
    './plain': './src/plain.js'
  }
  assert.deepEqual(
    resolutions(
      t,
      { exports },
      {
        'src/js.ts': '',
        'src/both.tsx': '',
        'src/both.js': '',
        'src/jsx.tsx': '',
        'src/mjs.mts': '',
        'src/cjs.cts': '',
        'src/plain.js': ''
      },
      ['pkg/js', 'pkg/both', 'pkg/jsx', 'pkg/mjs', 'pkg/cjs', 'pkg/plain']
    ),
    {
      'pkg/js': 'packages/pkg/src/js.ts',
      'pkg/both': 'packages/pkg/src/both.tsx',
      'pkg/jsx': 'packages/pkg/src/jsx.tsx',
      'pkg/mjs': 'packages/pkg/src/mjs.mts',
      'pkg/cjs': 'packages/pkg/src/cjs.cts',
      'pkg/plain': 'packages/pkg/src/plain.js'
    }
  )
})

test('a target under the outDir maps back to the source under rootDir', t => {
  const tsconfig = { compilerOptions: { outDir: 'dist', rootDir: 'src', declaration: true } }
  assert.deepEqual(
    resolutions(
      t,
      {
        exports: {
          '.': { types: './dist/index.d.ts' },
          './util': './dist/util.js',
          './gone': './dist/gone.js'
        }
      },
      { 'tsconfig.json': tsconfig, 'src/index.ts': '', 'src/util.ts': '' },
      ['pkg', 'pkg/util', 'pkg/gone']
    ),
    {
      pkg: 'packages/pkg/src/index.ts',
      'pkg/util': 'packages/pkg/src/util.ts',
      'pkg/gone': 'unresolved: build-output'
    }
  )
})

test('without rootDir, build output maps back to the config directory', t => {
  assert.deepEqual(
    resolutions(
      t,
      { main: './lib/index.js' },
      { 'tsconfig.json': { compilerOptions: { outDir: 'lib' } }, 'index.ts': '' },
      ['pkg']
    ),
    { pkg: 'packages/pkg/index.ts' }
  )
})

test('a build config that owns no module maps its outDir back to source', t => {
  const root = repository(t, {
    'package.json': {
      name: '@acme/lib',
      exports: {
        '.': { types: './dist/library/index.d.ts', default: './dist/library/index.js' },
        './motion': {
          types: './dist/library/motion/index.d.ts',
          default: './dist/library/motion/index.js'
        },
        './gone': './dist/library/gone.js'
      }
    },
    'tsconfig.json': { compilerOptions: { noEmit: true }, include: ['src', 'tests'] },
    'tsconfig.build.json': {
      extends: './tsconfig.json',
      compilerOptions: { noEmit: false, outDir: './dist/library', rootDir: './src' },
      include: ['src']
    },
    'src/index.ts': '',
    'src/motion/index.ts': '',
    'tests/package.test.ts': ''
  })
  const discovery = discover(root, emptyConfig)
  assert.deepEqual(
    new Set(discovery.modules.map(module => module.config)),
    new Set(['tsconfig.json'])
  )
  const resolver = workspaceResolver(discovery)
  assert.deepEqual(
    ['@acme/lib', '@acme/lib/motion', '@acme/lib/gone'].map(specifier =>
      resolver.resolve(specifier)
    ),
    [
      { kind: 'module', path: 'src/index.ts' },
      { kind: 'module', path: 'src/motion/index.ts' },
      { kind: 'unresolved', reason: 'build-output' }
    ]
  )
})

test('of builds whose outDirs both hold a target, the first that reaches a module wins', t => {
  assert.deepEqual(
    resolutions(
      t,
      { exports: { '.': './dist/library/index.js', './tool': './dist/scripts/tool.js' } },
      {
        'tsconfig.json': { compilerOptions: { outDir: 'dist', rootDir: '.' } },
        'tsconfig.build.json': { compilerOptions: { outDir: 'dist/library', rootDir: 'src' } },
        'src/index.ts': '',
        'scripts/tool.ts': ''
      },
      ['pkg', 'pkg/tool']
    ),
    { pkg: 'packages/pkg/src/index.ts', 'pkg/tool': 'packages/pkg/scripts/tool.ts' }
  )
})

test('a target that reaches no module is missing', t => {
  assert.deepEqual(
    resolutions(
      t,
      { exports: { './styles': './styles.css', './gone': './src/gone.ts' } },
      { 'styles.css': '' },
      ['pkg/styles', 'pkg/gone']
    ),
    { 'pkg/styles': 'unresolved: missing', 'pkg/gone': 'unresolved: missing' }
  )
})

test('each unresolved reason warns once per package', t => {
  const resolver = workspace(
    t,
    { exports: { './a': './a.ts', './b': './b.ts', './private/*': null } },
    {}
  )
  for (const specifier of ['pkg/a', 'pkg/b', 'pkg/private/x', 'pkg/private/y', 'pkg/c']) {
    resolver.resolve(specifier)
  }
  assert.deepEqual(resolver.warnings(), [
    {
      path: 'packages/pkg/package.json',
      message: 'pkg/a: the target is no module in the repository'
    },
    {
      path: 'packages/pkg/package.json',
      message: 'pkg/private/x: exports maps the subpath to null'
    },
    { path: 'packages/pkg/package.json', message: 'pkg/c: exports has no entry for the subpath' }
  ])
})

test('the root package resolves its own name only when it has exports', t => {
  const exporting = repository(t, {
    'package.json': { name: '@acme/self', exports: { './utils': './src/utils.ts' } },
    'src/utils.ts': ''
  })
  assert.deepEqual(
    workspaceResolver(discover(exporting, emptyConfig)).resolve('@acme/self/utils'),
    {
      kind: 'module',
      path: 'src/utils.ts'
    }
  )
  const plain = repository(t, { 'package.json': { name: 'plain' }, 'src/utils.ts': '' })
  assert.equal(
    workspaceResolver(discover(plain, emptyConfig)).resolve('plain/src/utils.ts'),
    undefined
  )
  const unnamed = repository(t, { 'index.ts': '' })
  const [fallbackName] = Object.keys(discover(unnamed, emptyConfig).packages)
  assert.equal(workspaceResolver(discover(unnamed, emptyConfig)).resolve(fallbackName!), undefined)
})
