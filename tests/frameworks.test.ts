import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyzeRepository } from '../src/analysis.ts'
import { emptyConfig, type Model, type RepoPath } from '../src/model.ts'
import { cliRunner } from './cli.ts'
import { repository, type Files } from './temp-repository.ts'

const galactica = fileURLToPath(new URL('..', import.meta.url))

const { node } = cliRunner()

function cli(script: string, root: string, ...args: string[]) {
  const { status, stdout, stderr } = node([script, ...args, '--root', root])
  assert.equal(status, 0, stderr)
  return stdout
}

const component = (name: string) => ({
  name,
  kind: 'component',
  line: 1,
  default: true,
  signature: `component ${name}`
})

const targets = (model: Model, path: string) =>
  model.modules[path as RepoPath]!.edges.map(({ to }) => (to.kind === 'module' ? to.path : to))

const app: Files = {
  'package.json': { name: 'app', dependencies: { vue: '*', svelte: '*' } },
  'node_modules/.keep': '',
  'src/a.ts': 'export const a = 1',
  'src/App.vue': "<script setup>\nimport { a } from './a'\n</script>",
  'src/Card.svelte': "<script>\n  import { a } from './a'\n</script>",
  'src/Page.mdx': "import { a } from './a'\n\n# Hi\n",
  'src/Widget.marko': "import { a } from './a'\n\n<div>${a}</div>\n"
}

/** A package in the target whose compiler entry, when required, writes `loaded-<name>` at the root. */
function plantedCompiler(name: string, entry?: string): Files {
  const parents = name.startsWith('@') ? "'..', '..', '..'" : "'..', '..'"
  const marker = `require('node:fs').writeFileSync(require('node:path').join(__dirname, ${parents}, 'loaded-${name.replaceAll('/', '-')}'), '')`
  const file = `${entry ?? 'index'}.js`
  return {
    [`node_modules/${name}/package.json`]: {
      name,
      version: '1.0.0',
      exports: { [entry ? `./${entry}` : '.']: `./${file}`, './package.json': './package.json' }
    },
    [`node_modules/${name}/${file}`]: `${marker}\nexports.parse = () => { throw new Error('planted') }`
  }
}

test('a compiler in the repository being mapped is never loaded', t => {
  const root = repository(t, {
    ...app,
    ...plantedCompiler('vue', 'compiler-sfc'),
    ...plantedCompiler('@vue/compiler-sfc'),
    ...plantedCompiler('svelte', 'compiler'),
    ...plantedCompiler('@mdx-js/mdx'),
    ...plantedCompiler('@marko/compiler'),
    ...plantedCompiler('marko', 'translator')
  })
  const cache = join(root, 'node_modules', '.cache', 'galactica')
  for (const run of ['cold', 'warm']) {
    const { model, summary } = analyzeRepository(root, emptyConfig, { cache })
    assert.deepEqual(targets(model, 'src/App.vue'), ['src/a.ts'], run)
    assert.deepEqual(targets(model, 'src/Card.svelte'), ['src/a.ts'], run)
    assert.deepEqual(targets(model, 'src/Page.mdx'), ['src/a.ts'], run)
    assert.deepEqual(targets(model, 'src/Widget.marko'), ['src/a.ts'], run)
    assert.deepEqual(summary.warnings, [], run)
  }
  const output = cli(join(galactica, 'dist', 'bin.js'), root, 'uses', 'src/a.ts')
  assert.match(output, /src\/App\.vue/)
  assert.match(output, /src\/Card\.svelte/)
  assert.match(output, /src\/Page\.mdx/)
  assert.match(output, /src\/Widget\.marko/)
  assert.deepEqual(
    ['vue', '@vue-compiler-sfc', 'svelte', '@mdx-js-mdx', '@marko-compiler', 'marko'].filter(name =>
      existsSync(join(root, `loaded-${name}`))
    ),
    []
  )
})

/** Galactica's build in a folder of its own, installed with TypeScript and with `optional` linked in. */
function installed(t: TestContext, optional: readonly string[]) {
  const folder = repository(t, {})
  cpSync(join(galactica, 'dist'), join(folder, 'dist'), { recursive: true })
  cpSync(join(galactica, 'package.json'), join(folder, 'package.json'))
  const require = createRequire(import.meta.url)
  const link = (name: string) => {
    let dir: string
    try {
      dir = dirname(require.resolve(`${name}/package.json`))
    } catch {
      dir = dirname(require.resolve(name))
      for (;;) {
        const manifest = join(dir, 'package.json')
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) break
        const parent = dirname(dir)
        if (parent === dir) throw new Error(`no package for ${name}`)
        dir = parent
      }
    }
    const target = join(folder, 'node_modules', name)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(realpathSync(dir), target)
  }
  link('typescript')
  optional.forEach(link)
  return { folder, link }
}

test('installed without its optional dependencies, each framework warns once, and its files keep their component', async t => {
  const { folder } = installed(t, [])
  const { analyzeRepository: analyze }: typeof import('../src/analysis.ts') = await import(
    pathToFileURL(join(folder, 'dist', 'analysis.js')).href
  )
  const root = repository(t, { ...app, 'src/Nav.vue': '<template><nav /></template>' })
  const { model, summary } = analyze(root, emptyConfig)
  assert.deepEqual(summary.warnings, [
    {
      path: 'src/App.vue',
      message: '@vue/compiler-sfc is not installed with Galactica; 2 .vue files have no imports'
    },
    {
      path: 'src/Card.svelte',
      message: 'svelte/compiler is not installed with Galactica; 1 .svelte file has no imports'
    },
    {
      path: 'src/Page.mdx',
      message: '@mdx-js/mdx is not installed with Galactica; 1 .mdx file has no imports'
    },
    {
      path: 'src/Widget.marko',
      message: '@marko/compiler is not installed with Galactica; 1 .marko file has no imports'
    }
  ])
  const { symbols, edges } = model.modules['src/App.vue' as RepoPath]!
  assert.deepEqual([symbols, edges], [[component('App')], []])
})

test('a cache written without the compilers is discarded once they are installed', t => {
  const { folder, link } = installed(t, [])
  const root = repository(t, app)
  const uses = () => cli(join(folder, 'dist', 'bin.js'), root, 'uses', 'src/a.ts', '--json')
  const dependents = () => JSON.parse(uses()).modules.map(({ path }: { path: string }) => path)
  assert.deepEqual(dependents(), [])
  link('@vue/compiler-sfc')
  assert.deepEqual(dependents(), ['src/App.vue'])
  link('svelte')
  assert.deepEqual(dependents(), ['src/App.vue', 'src/Card.svelte'])
  link('@mdx-js/mdx')
  assert.deepEqual(dependents(), ['src/App.vue', 'src/Card.svelte', 'src/Page.mdx'])
  link('@marko/compiler')
  assert.deepEqual(dependents(), ['src/App.vue', 'src/Card.svelte', 'src/Page.mdx'])
  link('marko')
  assert.deepEqual(dependents(), [
    'src/App.vue',
    'src/Card.svelte',
    'src/Page.mdx',
    'src/Widget.marko'
  ])
})

test('a compiler that throws leaves the file its component, and warns once with the first failure', t => {
  const root = repository(t, {
    'package.json': { name: 'app' },
    'src/A.svelte': '<script>',
    'src/B.svelte': '<script>'
  })
  const cache = join(repository(t, {}), 'cache')
  const warning = {
    path: 'src/A.svelte',
    message:
      'svelte/compiler failed on src/A.svelte: Unexpected end of input; 2 .svelte files have no imports'
  }
  for (const run of ['cold', 'warm']) {
    const { model, summary } = analyzeRepository(root, emptyConfig, { cache })
    assert.deepEqual(summary.warnings, [warning], run)
    assert.deepEqual(model.modules['src/A.svelte' as RepoPath]!.symbols, [component('A')], run)
  }
})

const brief = (model: Model, path: string) => ({
  symbols: model.modules[path as RepoPath]!.symbols.map(({ name, line, kind }) => [
    name,
    line,
    kind
  ]),
  targets: targets(model, path)
})

test('a Vue 2 single-file component with the Options API is read', t => {
  const root = repository(t, {
    'package.json': { name: 'legacy' },
    'src/helper.ts': 'export const helper = (n: number) => n + 1',
    'src/Legacy.vue': [
      '<template functional>',
      '  <div :class="{ on: active }" @click="toggle">{{ count | currency }}</div>',
      '</template>',
      '',
      '<script lang="ts">',
      "import Vue from 'vue'",
      "import { helper } from './helper'",
      'export const version = 2',
      'export default {',
      "  name: 'Legacy',",
      '  props: { active: Boolean },',
      '  data() { return { count: 0 } },',
      "  filters: { currency: (value: number) => '$' + value },",
      '  methods: { toggle() { this.count = helper(this.count) } }',
      '}',
      '</script>',
      '',
      '<style scoped>div { color: red }</style>'
    ].join('\n')
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  assert.deepEqual(summary.warnings, [])
  assert.deepEqual(brief(model, 'src/Legacy.vue'), {
    symbols: [
      ['Legacy', 1, 'component'],
      ['version', 8, 'const']
    ],
    targets: [{ kind: 'external', name: 'vue' }, 'src/helper.ts']
  })
})

test('a Svelte 4 component with export let, $: and a context="module" script is read', t => {
  const root = repository(t, {
    'package.json': { name: 'legacy' },
    'src/Child.svelte': '<slot />',
    'src/Card.svelte': [
      '<script context="module" lang="ts">',
      '  export const preload = () => 1',
      '</script>',
      '',
      '<script lang="ts">',
      "  import { createEventDispatcher } from 'svelte'",
      "  import Child from './Child.svelte'",
      '  export let name: string',
      '  export let count = 0',
      '  const dispatch = createEventDispatcher()',
      '  $: doubled = count * 2',
      "  $: if (count > 3) dispatch('big')",
      '</script>',
      '',
      '<svelte:options accessors />',
      '<button on:click={() => count++} class:big={doubled > 4}>{name} {doubled}</button>',
      '<slot name="footer" {count} />',
      '{#each [1, 2] as i (i)}<Child let:item {i} />{/each}'
    ].join('\n')
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  assert.deepEqual(summary.warnings, [])
  assert.deepEqual(brief(model, 'src/Card.svelte'), {
    symbols: [
      ['Card', 1, 'component'],
      ['preload', 2, 'function']
    ],
    targets: [{ kind: 'external', name: 'svelte' }, 'src/Child.svelte']
  })
})

test('an MDX file reads its statements and ignores an import in a fenced block', t => {
  const root = repository(t, {
    'package.json': { name: 'docs' },
    'src/Button.tsx': 'export const Button = () => null',
    'src/Page.mdx': [
      "import { Button } from './Button'",
      '',
      "export const title = 'Hi'",
      '',
      '# Hello',
      '',
      '<Button />',
      '',
      '```js',
      "import { hidden } from './nope'",
      '```'
    ].join('\n')
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  assert.deepEqual(summary.warnings, [])
  assert.deepEqual(brief(model, 'src/Page.mdx'), {
    symbols: [
      ['Page', 1, 'component'],
      ['title', 3, 'const']
    ],
    targets: ['src/Button.tsx']
  })
})

test('a Marko file reads its own imports and does not resolve a custom tag', t => {
  const root = repository(t, {
    'package.json': { name: 'widgets' },
    'src/marko.json': '{',
    'src/value.ts': 'export const value = 1',
    'src/Bar.marko': "import { value } from './secret'\n\n<span/>\n",
    'src/Widget.marko': [
      "import { value } from './value'",
      'export const title = "Hi"',
      '',
      'static {',
      '  const extra = import("./later")',
      '}',
      '',
      '<div>${value}<Bar/></div>'
    ].join('\n')
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  assert.deepEqual(summary.warnings, [])
  assert.deepEqual(brief(model, 'src/Widget.marko'), {
    symbols: [
      ['Widget', 1, 'component'],
      ['title', 2, 'const']
    ],
    targets: ['src/value.ts', { kind: 'unresolved', specifier: './later' }]
  })
})

test('a Solid component in jsx is read like any JSX module', t => {
  const root = repository(t, {
    'package.json': { name: 'solid-app', dependencies: { 'solid-js': '*' } },
    'src/icon.tsx': 'export const icon = "i"',
    'src/Button.jsx': [
      "import { createSignal } from 'solid-js'",
      "import { icon } from './icon'",
      'export function Button() {',
      '  const [count] = createSignal(0)',
      '  return <button>{count()}{icon}</button>',
      '}'
    ].join('\n')
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  assert.deepEqual(summary.warnings, [])
  assert.deepEqual(targets(model, 'src/Button.jsx'), [
    { kind: 'external', name: 'solid-js' },
    'src/icon.tsx'
  ])
})

test('an Angular component class is read, and its html template is not a module', t => {
  const root = repository(t, {
    'package.json': { name: 'ng', dependencies: { '@angular/core': '*' } },
    'src/format.ts': 'export const format = (value: string) => value',
    'src/app.component.ts': [
      "import { Component } from '@angular/core'",
      "import { format } from './format'",
      '@Component({',
      "  selector: 'app-root',",
      "  templateUrl: './app.component.html'",
      '})',
      'export class AppComponent {',
      '  title = format("hi")',
      '}'
    ].join('\n'),
    'src/app.component.html': '<app-button [label]="title"></app-button>\n<div>{{ title }}</div>'
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  assert.deepEqual(summary.warnings, [])
  assert.equal(model.modules['src/app.component.html' as RepoPath], undefined)
  assert.deepEqual(targets(model, 'src/app.component.ts'), [
    { kind: 'external', name: '@angular/core' },
    'src/format.ts'
  ])
})
