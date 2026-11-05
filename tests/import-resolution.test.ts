import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import ts from 'typescript'
import { discover } from '../src/discovery.ts'
import { importResolver, type Resolution } from '../src/import-resolution.ts'
import { emptyConfig } from '../src/model.ts'
import { repository, type Files } from './temp-repository.ts'

/** Where each specifier leads from `from`, resolved in the given mode. */
function resolved(
  t: TestContext,
  files: Files,
  from: string,
  specifiers: readonly string[],
  mode?: ts.ResolutionMode
): Readonly<Record<string, Resolution>> {
  const discovery = discover(repository(t, files), emptyConfig)
  const module = discovery.modules.find(({ path }) => path === from)
  assert.ok(module, `${from} is no module`)
  const resolver = importResolver(discovery)
  return Object.fromEntries(
    specifiers.map(specifier => [specifier, resolver.resolve(module, specifier, mode)])
  )
}

test('relative specifiers resolve to modules, and a miss stays unresolved', t => {
  assert.deepEqual(
    resolved(
      t,
      { 'src/main.ts': '', 'src/math.ts': '', 'src/shapes/index.ts': '', 'src/App.jsx': '' },
      'src/main.ts',
      ['./math', './shapes', './App', '../src/math.ts', './gone']
    ),
    {
      './math': { kind: 'module', path: 'src/math.ts' },
      './shapes': { kind: 'module', path: 'src/shapes/index.ts' },
      './App': { kind: 'module', path: 'src/App.jsx' },
      '../src/math.ts': { kind: 'module', path: 'src/math.ts' },
      './gone': { kind: 'unresolved', specifier: './gone' }
    }
  )
})

test('tsconfig paths and baseUrl resolve, and an alias that reaches no file stays unresolved', t => {
  const files = {
    'tsconfig.json': {
      compilerOptions: {
        moduleResolution: 'bundler',
        module: 'esnext',
        baseUrl: './src',
        paths: { '@/*': ['*'], '~config': ['config/index.ts'] }
      },
      include: ['src']
    },
    'src/main.ts': '',
    'src/lib/math.ts': '',
    'src/config/index.ts': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', ['@/lib/math', '~config', 'lib/math', '@/lib/gone']),
    {
      '@/lib/math': { kind: 'module', path: 'src/lib/math.ts' },
      '~config': { kind: 'module', path: 'src/config/index.ts' },
      'lib/math': { kind: 'module', path: 'src/lib/math.ts' },
      '@/lib/gone': { kind: 'unresolved', specifier: '@/lib/gone' }
    }
  )
})

test('under nodenext a .js specifier reaches the TypeScript source', t => {
  const files = {
    'package.json': { name: 'esm', type: 'module' },
    'tsconfig.json': {
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' },
      include: ['src']
    },
    'src/main.ts': '',
    'src/math.ts': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', ['./math.js', './math'], ts.ModuleKind.ESNext),
    {
      './math.js': { kind: 'module', path: 'src/math.ts' },
      './math': { kind: 'unresolved', specifier: './math' }
    }
  )
})

test('the module format decides the resolution mode, so require resolves as CommonJS', t => {
  const files = {
    'package.json': { name: 'cjs', type: 'commonjs' },
    'tsconfig.json': {
      compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', allowJs: true },
      include: ['src']
    },
    'src/index.js': '',
    'src/main.mjs': '',
    'src/math.js': ''
  }
  const discovery = discover(repository(t, files), emptyConfig)
  const resolver = importResolver(discovery)
  const formats = Object.fromEntries(
    discovery.modules.map(module => [module.path, resolver.formatOf(module)])
  )
  assert.deepEqual(formats, {
    'src/index.js': ts.ModuleKind.CommonJS,
    'src/main.mjs': ts.ModuleKind.ESNext,
    'src/math.js': ts.ModuleKind.CommonJS
  })
  const index = discovery.modules.find(({ path }) => path === 'src/index.js')!
  assert.deepEqual(resolver.resolve(index, './math', ts.ModuleKind.CommonJS), {
    kind: 'module',
    path: 'src/math.js'
  })
  assert.deepEqual(resolver.resolve(index, './math', ts.ModuleKind.ESNext), {
    kind: 'unresolved',
    specifier: './math'
  })
})

test('built-ins are external under their node: name, with or without the prefix', t => {
  assert.deepEqual(
    resolved(t, { 'src/main.ts': '' }, 'src/main.ts', [
      'fs',
      'node:fs',
      'fs/promises',
      'node:fs/promises',
      'node:test'
    ]),
    {
      fs: { kind: 'external', name: 'node:fs' },
      'node:fs': { kind: 'external', name: 'node:fs' },
      'fs/promises': { kind: 'external', name: 'node:fs' },
      'node:fs/promises': { kind: 'external', name: 'node:fs' },
      'node:test': { kind: 'external', name: 'node:test' }
    }
  )
})

test('a package is external by the name in its specifier, installed or not', t => {
  const files = {
    'src/main.ts': '',
    'node_modules/@scope/pkg/package.json': { name: '@scope/pkg', main: 'index.js' },
    'node_modules/@scope/pkg/index.js': '',
    'node_modules/@scope/pkg/sub.js': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', ['@scope/pkg', '@scope/pkg/sub', 'zod', 'lodash/fp']),
    {
      '@scope/pkg': { kind: 'external', name: '@scope/pkg' },
      '@scope/pkg/sub': { kind: 'external', name: '@scope/pkg' },
      zod: { kind: 'external', name: 'zod' },
      'lodash/fp': { kind: 'external', name: 'lodash' }
    }
  )
})

test('a relative path into node_modules is external, by the package it reaches', t => {
  const files = {
    'src/components/Toc.astro': '',
    'node_modules/@astrojs/starlight/package.json': { name: '@astrojs/starlight' },
    'node_modules/@astrojs/starlight/dist/List.astro': '',
    'node_modules/@astrojs/starlight/dist/toc.js': '',
    'node_modules/zod/package.json': { name: 'zod' },
    'node_modules/zod/lib/index.js': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/components/Toc.astro', [
      '../../node_modules/@astrojs/starlight/dist/List.astro',
      '../../node_modules/@astrojs/starlight/dist/toc.js',
      '../../node_modules/zod/lib/index.js'
    ]),
    {
      '../../node_modules/@astrojs/starlight/dist/List.astro': {
        kind: 'external',
        name: '@astrojs/starlight'
      },
      '../../node_modules/@astrojs/starlight/dist/toc.js': {
        kind: 'external',
        name: '@astrojs/starlight'
      },
      '../../node_modules/zod/lib/index.js': { kind: 'external', name: 'zod' }
    }
  )
})

test('a package import that reaches no file stays unresolved', t => {
  assert.deepEqual(resolved(t, { 'src/main.ts': '' }, 'src/main.ts', ['#internal/log']), {
    '#internal/log': { kind: 'unresolved', specifier: '#internal/log' }
  })
})

test('a SvelteKit alias without its generated tsconfig stays unresolved, never a package', t => {
  const files = {
    'tsconfig.json': { extends: './.svelte-kit/tsconfig.json' },
    'src/routes/+page.ts': '',
    'src/lib/utils.ts': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/routes/+page.ts', ['$lib/utils', '$app/stores', 'svelte']),
    {
      '$lib/utils': { kind: 'unresolved', specifier: '$lib/utils' },
      '$app/stores': { kind: 'unresolved', specifier: '$app/stores' },
      svelte: { kind: 'external', name: 'svelte' }
    }
  )
})

test('a repository file that is no module is no module target', t => {
  const files = {
    'tsconfig.json': {
      compilerOptions: {
        moduleResolution: 'bundler',
        module: 'esnext',
        paths: { '@/*': ['./src/*'] }
      },
      include: ['src']
    },
    'src/main.ts': '',
    'src/styles.css': '',
    'src/types.d.ts': '',
    'src/data.json': '{}',
    'src/assets/logo.svg': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', [
      './styles.css',
      './types',
      './data.json',
      '@/assets/logo.svg'
    ]),
    {
      './styles.css': { kind: 'file', path: 'src/styles.css' },
      './types': { kind: 'file', path: 'src/types.d.ts' },
      './data.json': { kind: 'file', path: 'src/data.json' },
      '@/assets/logo.svg': { kind: 'file', path: 'src/assets/logo.svg' }
    }
  )
})

test('a framework module is reached by its exact path, relative or through paths', t => {
  const files = {
    'tsconfig.json': {
      compilerOptions: {
        moduleResolution: 'bundler',
        module: 'esnext',
        paths: { '@/*': ['./src/*'] }
      },
      include: ['src']
    },
    'src/main.ts': '',
    'src/Counter.vue': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', ['./Counter.vue', '@/Counter.vue', './Missing.vue']),
    {
      './Counter.vue': { kind: 'module', path: 'src/Counter.vue' },
      '@/Counter.vue': { kind: 'module', path: 'src/Counter.vue' },
      './Missing.vue': { kind: 'unresolved', specifier: './Missing.vue' }
    }
  )
})

test('a workspace package resolves to its source, and its failure is final', t => {
  const files = {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'packages/app/package.json': { name: '@mono/app' },
    'packages/app/src/main.ts': '',
    'packages/core/package.json': { name: '@mono/core', exports: { '.': './src/index.ts' } },
    'packages/core/src/index.ts': '',
    'packages/core/src/hidden.ts': ''
  }
  const discovery = discover(repository(t, files), emptyConfig)
  const resolver = importResolver(discovery)
  const main = discovery.modules.find(({ path }) => path === 'packages/app/src/main.ts')!
  assert.deepEqual(resolver.resolve(main, '@mono/core', undefined), {
    kind: 'module',
    path: 'packages/core/src/index.ts'
  })
  assert.deepEqual(resolver.resolve(main, '@mono/core/src/hidden', undefined), {
    kind: 'unresolved',
    specifier: '@mono/core/src/hidden'
  })
  assert.deepEqual(
    resolver.warnings().map(warning => warning.path),
    ['packages/core/package.json']
  )
})
