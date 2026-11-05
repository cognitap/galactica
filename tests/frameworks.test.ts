import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyzeRepository } from '../src/analysis.ts'
import { emptyConfig, type Model, type RepoPath } from '../src/model.ts'
import { repository, type Files } from './temp-repository.ts'

const galactica = fileURLToPath(new URL('..', import.meta.url))

function cli(script: string, root: string, ...args: string[]) {
  const { status, stdout, stderr } = spawnSync('node', [script, ...args, '--root', root], {
    encoding: 'utf8'
  })
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
  'src/Card.svelte': "<script>\n  import { a } from './a'\n</script>"
}

/** A package in the target whose compiler entry, when required, writes `loaded-<name>` at the root. */
function plantedCompiler(name: string, entry: string): Files {
  const marker = `require('node:fs').writeFileSync(require('node:path').join(__dirname, '..', '..', 'loaded-${name}'), '')`
  return {
    [`node_modules/${name}/package.json`]: {
      name,
      version: '1.0.0',
      exports: { [`./${entry}`]: `./${entry}.js`, './package.json': './package.json' }
    },
    [`node_modules/${name}/${entry}.js`]: `${marker}\nexports.parse = () => { throw new Error('planted') }`
  }
}

test('a compiler in the repository being mapped is never loaded', t => {
  const root = repository(t, {
    ...app,
    ...plantedCompiler('vue', 'compiler-sfc'),
    ...plantedCompiler('svelte', 'compiler')
  })
  const cache = join(root, 'node_modules', '.cache', 'galactica')
  for (const run of ['cold', 'warm']) {
    const { model, summary } = analyzeRepository(root, emptyConfig, { cache })
    assert.deepEqual(targets(model, 'src/App.vue'), ['src/a.ts'], run)
    assert.deepEqual(targets(model, 'src/Card.svelte'), ['src/a.ts'], run)
    assert.deepEqual(summary.warnings, [], run)
  }
  const output = cli(join(galactica, 'dist', 'cli.js'), root, 'uses', 'src/a.ts')
  assert.match(output, /src\/App\.vue/)
  assert.match(output, /src\/Card\.svelte/)
  assert.deepEqual(
    ['vue', 'svelte'].filter(name => existsSync(join(root, `loaded-${name}`))),
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
    const target = join(folder, 'node_modules', name)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(realpathSync(dirname(require.resolve(`${name}/package.json`))), target)
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
      message: 'vue/compiler-sfc is not installed with Galactica; 2 .vue files have no imports'
    },
    {
      path: 'src/Card.svelte',
      message: 'svelte/compiler is not installed with Galactica; 1 .svelte file has no imports'
    }
  ])
  const { symbols, edges } = model.modules['src/App.vue' as RepoPath]!
  assert.deepEqual([symbols, edges], [[component('App')], []])
})

test('a cache written without the compilers is discarded once they are installed', t => {
  const { folder, link } = installed(t, [])
  const root = repository(t, app)
  const uses = () => cli(join(folder, 'dist', 'cli.js'), root, 'uses', 'src/a.ts', '--json')
  const dependents = () => JSON.parse(uses()).modules.map(({ path }: { path: string }) => path)
  assert.deepEqual(dependents(), [])
  link('vue')
  link('svelte')
  assert.deepEqual(dependents(), ['src/App.vue', 'src/Card.svelte'])
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
