import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { plainInputs } from '../src/inputs.ts'
import ts from 'typescript'
import { discover } from '../src/discovery.ts'
import { importResolver, type Resolution } from '../src/import-resolution.ts'
import { emptyConfig, parseRepoPath } from '../src/model.ts'
import { analyzeRepository } from '../src/analysis.ts'
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

test('package imports resolve framework files and extensionless bundler scripts (DEV-722)', t => {
  const files = {
    'package.json': { name: 'web', type: 'module', imports: { '#lib/*': './src/lib/*' } },
    'tsconfig.json': { compilerOptions: { module: 'esnext', moduleResolution: 'bundler' } },
    'src/main.ts': '',
    'src/lib/Component.svelte': '<script>export let value</script>',
    'src/lib/Panel.vue': '<template><div /></template>',
    'src/lib/View.astro': '---\nconst value = 1\n---\n',
    'src/lib/f.ts': 'export const f = 1',
    'src/lib/nested/index.ts': 'export const nested = 1'
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', [
      '#lib/Component.svelte',
      '#lib/Panel.vue',
      '#lib/View.astro',
      '#lib/f',
      '#lib/nested'
    ]),
    {
      '#lib/Component.svelte': { kind: 'module', path: 'src/lib/Component.svelte' },
      '#lib/Panel.vue': { kind: 'module', path: 'src/lib/Panel.vue' },
      '#lib/View.astro': { kind: 'module', path: 'src/lib/View.astro' },
      '#lib/f': { kind: 'module', path: 'src/lib/f.ts' },
      '#lib/nested': { kind: 'module', path: 'src/lib/nested/index.ts' }
    }
  )
})

test('package imports respect scope, pattern specificity, conditions and blocked entries', t => {
  const files = {
    'package.json': {
      name: 'web',
      imports: {
        '#lib/*': './src/lib/*',
        '#lib/private/*': null,
        '#lib/selected': { browser: './src/lib/browser.vue', default: './src/lib/normal.vue' },
        '#redirect': '#lib/normal.vue',
        '#loop': '#loop',
        '#runtime': 'node:fs',
        '#escape': '../outside.ts'
      }
    },
    'tsconfig.json': {
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        customConditions: ['browser']
      }
    },
    'src/main.ts': '',
    'src/lib/browser.vue': '',
    'src/lib/normal.vue': '',
    'src/lib/private/secret.vue': '',
    'src/child/package.json': { name: 'child' },
    'src/child/main.ts': ''
  }
  assert.deepEqual(
    resolved(t, files, 'src/main.ts', [
      '#lib/selected',
      '#lib/private/secret.vue',
      '#redirect',
      '#loop',
      '#runtime',
      '#escape'
    ]),
    {
      '#lib/selected': { kind: 'module', path: 'src/lib/browser.vue' },
      '#lib/private/secret.vue': { kind: 'unresolved', specifier: '#lib/private/secret.vue' },
      '#redirect': { kind: 'module', path: 'src/lib/normal.vue' },
      '#loop': { kind: 'unresolved', specifier: '#loop' },
      '#runtime': { kind: 'external', name: 'node:fs' },
      '#escape': { kind: 'unresolved', specifier: '#escape' }
    }
  )
  assert.deepEqual(resolved(t, files, 'src/child/main.ts', ['#lib/normal.vue']), {
    '#lib/normal.vue': { kind: 'unresolved', specifier: '#lib/normal.vue' }
  })
})

test('package imports preserve Node ESM extension rules and explicit opt-out', t => {
  const files = {
    'package.json': { name: 'web', type: 'module', imports: { '#lib/*': './src/lib/*' } },
    'tsconfig.json': { compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } },
    'src/main.ts': '',
    'src/lib/f.ts': ''
  }
  assert.deepEqual(resolved(t, files, 'src/main.ts', ['#lib/f'], ts.ModuleKind.ESNext), {
    '#lib/f': { kind: 'unresolved', specifier: '#lib/f' }
  })
  assert.deepEqual(
    resolved(
      t,
      {
        ...files,
        'tsconfig.json': {
          compilerOptions: {
            module: 'esnext',
            moduleResolution: 'bundler',
            resolvePackageJsonImports: false
          }
        }
      },
      'src/main.ts',
      ['#lib/f']
    ),
    {
      '#lib/f': { kind: 'unresolved', specifier: '#lib/f' }
    }
  )
})

test('package imports work without an unavailable generated SvelteKit config', t => {
  assert.deepEqual(
    resolved(
      t,
      {
        'package.json': { name: 'web', type: 'module', imports: { '#lib/*': './src/lib/*' } },
        'tsconfig.json': {
          extends: './.svelte-kit/tsconfig.json',
          compilerOptions: { module: 'esnext' }
        },
        'src/main.ts': '',
        'src/lib/f.ts': '',
        'src/lib/Panel.svelte': ''
      },
      'src/main.ts',
      ['#lib/f', '#lib/Panel.svelte']
    ),
    {
      '#lib/f': { kind: 'module', path: 'src/lib/f.ts' },
      '#lib/Panel.svelte': { kind: 'module', path: 'src/lib/Panel.svelte' }
    }
  )
})

test('existing workspace JSON exports and package metadata resolve as files (DEV-723)', t => {
  assert.deepEqual(
    resolved(
      t,
      {
        'package.json': { name: 'root', workspaces: ['packages/*'] },
        'src/main.ts': '',
        'packages/globals/package.json': {
          name: '@babel/helper-globals',
          exports: {
            './data/*.json': './data/*.json',
            './package.json': './package.json'
          }
        },
        'packages/globals/data/builtin-lower.json': '[]',
        'packages/plain/package.json': { name: 'plain' }
      },
      'src/main.ts',
      [
        '@babel/helper-globals/data/builtin-lower.json',
        '@babel/helper-globals/package.json',
        'plain/package.json'
      ]
    ),
    {
      '@babel/helper-globals/data/builtin-lower.json': {
        kind: 'file',
        path: 'packages/globals/data/builtin-lower.json'
      },
      '@babel/helper-globals/package.json': { kind: 'file', path: 'packages/globals/package.json' },
      'plain/package.json': { kind: 'file', path: 'packages/plain/package.json' }
    }
  )
})

test('declaration-only workspace entries and subpaths resolve as files (DEV-723)', t => {
  assert.deepEqual(
    resolved(
      t,
      {
        'package.json': { name: 'root', workspaces: ['packages/*'] },
        'src/main.ts': '',
        'packages/types/package.json': { name: '@calcom/types', types: './index.d.ts' },
        'packages/types/index.d.ts': 'export interface Root {}',
        'packages/types/App.d.ts': 'export interface App {}',
        'packages/types/esm.d.mts': 'export interface ESM {}',
        'packages/types/cjs.d.cts': 'export interface CJS {}'
      },
      'src/main.ts',
      ['@calcom/types', '@calcom/types/App', '@calcom/types/esm.mjs', '@calcom/types/cjs.cjs']
    ),
    {
      '@calcom/types': { kind: 'file', path: 'packages/types/index.d.ts' },
      '@calcom/types/App': { kind: 'file', path: 'packages/types/App.d.ts' },
      '@calcom/types/esm.mjs': { kind: 'file', path: 'packages/types/esm.d.mts' },
      '@calcom/types/cjs.cjs': { kind: 'file', path: 'packages/types/cjs.d.cts' }
    }
  )
})

test('a missing paths target falls back to its npm package (DEV-723)', t => {
  assert.deepEqual(
    resolved(
      t,
      {
        'package.json': { name: 'app' },
        'tsconfig.json': {
          compilerOptions: {
            module: 'esnext',
            moduleResolution: 'bundler',
            paths: {
              electron: ['./generated/electron.d.ts'],
              '@acme/pkg/*': ['./missing/*'],
              '$lib/*': ['./missing/*']
            }
          }
        },
        'src/main.ts': ''
      },
      'src/main.ts',
      ['electron', '@acme/pkg/sub', '$lib/missing']
    ),
    {
      electron: { kind: 'external', name: 'electron' },
      '@acme/pkg/sub': { kind: 'external', name: '@acme/pkg' },
      '$lib/missing': { kind: 'unresolved', specifier: '$lib/missing' }
    }
  )
})

test('imports through a symlinked folder reach the discovered source (DEV-724)', t => {
  const root = repository(t, { 'src/main.ts': '', 'src/actual/a.ts': '' })
  symlinkSync(join(root, 'src/actual'), join(root, 'src/alias'), 'dir')
  const discovery = discover(root, emptyConfig)
  const main = discovery.modules.find(module => module.path === 'src/main.ts')!
  assert.deepEqual(importResolver(discovery).resolve(main, './alias/a', undefined), {
    kind: 'module',
    path: 'src/actual/a.ts'
  })
})

test('case differences on a case-insensitive filesystem reach the source (DEV-724)', t => {
  const root = repository(t, { 'src/main.ts': '', 'src/Actual.ts': '' })
  const actual = join(root, 'src/Actual.ts')
  const lower = join(root, 'src/actual.ts')
  const plain = plainInputs(ts.sys)
  const corrected = (path: string) => (path === lower ? actual : path)
  const inputs = {
    ...plain,
    fileExists: (path: string) => plain.fileExists(corrected(path)),
    readFile: (path: string) => plain.readFile(corrected(path)),
    realpath: (path: string) => plain.realpath(corrected(path))
  }
  const discovery = discover(root, emptyConfig, inputs)
  const main = discovery.modules.find(module => module.path === 'src/main.ts')!
  assert.deepEqual(importResolver(discovery, inputs).resolve(main, './actual', undefined), {
    kind: 'module',
    path: 'src/Actual.ts'
  })
})

test('unknown files and source omitted from discovery stay unresolved (DEV-724)', t => {
  const root = repository(t, {
    'src/main.ts': '',
    'src/hidden.ts': 'export const hidden = 1',
    'src/template.unknown': 'content',
    'src/styles.css': '',
    'src/data.json': '{}'
  })
  const discovery = discover(root, { ...emptyConfig, exclude: ['src/hidden.ts'] })
  const main = discovery.modules.find(module => module.path === 'src/main.ts')!
  const resolver = importResolver(discovery)
  assert.deepEqual(
    Object.fromEntries(
      ['./hidden', './template.unknown', './styles.css', './data.json'].map(specifier => [
        specifier,
        resolver.resolve(main, specifier, undefined)
      ])
    ),
    {
      './hidden': { kind: 'unresolved', specifier: './hidden' },
      './template.unknown': { kind: 'unresolved', specifier: './template.unknown' },
      './styles.css': { kind: 'file', path: 'src/styles.css' },
      './data.json': { kind: 'file', path: 'src/data.json' }
    }
  )
})

test('a source symlink that escapes the repository stays unresolved', t => {
  const outside = repository(t, { 'outside.ts': '' })
  const root = repository(t, { 'src/main.ts': '' })
  symlinkSync(outside, join(root, 'src/alias'), 'dir')
  const discovery = discover(root, emptyConfig)
  const main = discovery.modules.find(module => module.path === 'src/main.ts')!
  assert.deepEqual(importResolver(discovery).resolve(main, './alias/outside', undefined), {
    kind: 'unresolved',
    specifier: './alias/outside'
  })
})

test('an unknown workspace export and an alias to existing unsupported input stay unresolved', t => {
  const files = {
    'package.json': { name: 'root', workspaces: ['packages/*'] },
    'tsconfig.json': {
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        paths: { 'pkg/aliased': ['./src/input.unknown'] }
      }
    },
    'src/main.ts': '',
    'src/input.unknown': 'content',
    'packages/pkg/package.json': {
      name: 'pkg',
      exports: { './unknown': './input.unknown', './aliased': './src/index.ts' }
    },
    'packages/pkg/input.unknown': 'content',
    'packages/pkg/src/index.ts': ''
  }
  assert.deepEqual(resolved(t, files, 'src/main.ts', ['pkg/unknown', 'pkg/aliased']), {
    'pkg/unknown': { kind: 'unresolved', specifier: 'pkg/unknown' },
    'pkg/aliased': { kind: 'unresolved', specifier: 'pkg/aliased' }
  })
})

test('analysis counts unsupported imports and retains canonical dependencies (DEV-724 integration)', t => {
  const root = repository(t, {
    'src/main.ts': [
      "import { a } from './alias/a'",
      "import './input.unknown'",
      "import './style.css'",
      "import './types'",
      "import './data.json'"
    ].join('\n'),
    'src/actual/a.ts': 'export const a = 1',
    'src/input.unknown': 'content',
    'src/style.css': '',
    'src/types.d.ts': 'export interface T {}',
    'src/data.json': '{}'
  })
  symlinkSync(join(root, 'src/actual'), join(root, 'src/alias'), 'dir')
  const { summary, model } = analyzeRepository(root, emptyConfig)
  assert.equal(summary.unresolved, 1)
  assert.deepEqual(summary.skipped, { '.css': 1, '.d.ts': 1, '.json': 1 })
  assert.deepEqual(
    model.modules[parseRepoPath('src/main.ts')]?.edges.map(edge => edge.to),
    [
      { kind: 'module', path: 'src/actual/a.ts' },
      { kind: 'unresolved', specifier: './input.unknown' }
    ]
  )
})
