import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { analyzeRepository } from '../src/analysis.ts'
import { emptyConfig, type RepoPath } from '../src/model.ts'
import { repository, type Files } from './temp-repository.ts'

/** A stand-in `vue` package whose compiler reads every file as a `<script setup>` importing `specifier`. */
function fakeVue(dir: string, version: string, specifier: string): Files {
  const descriptor = {
    script: null,
    scriptSetup: { content: `\nimport '${specifier}'\n`, lang: 'ts', loc: { start: { line: 1 } } }
  }
  return {
    [`${dir}node_modules/vue/package.json`]: {
      name: 'vue',
      version,
      exports: { './compiler-sfc': './compiler-sfc.cjs', './package.json': './package.json' }
    },
    [`${dir}node_modules/vue/compiler-sfc.cjs`]: `exports.parse = () => (${JSON.stringify({ descriptor })})`
  }
}

const throwingSvelte: Files = {
  'node_modules/svelte/package.json': {
    name: 'svelte',
    version: '5.0.0',
    exports: { './compiler': './compiler.cjs', './package.json': './package.json' }
  },
  'node_modules/svelte/compiler.cjs':
    "exports.parse = () => { throw new Error('Unexpected token') }"
}

const component = (name: string) => ({
  name,
  kind: 'component',
  line: 1,
  default: true,
  signature: `component ${name}`
})

const workspace: Files = {
  'package.json': { name: 'root', workspaces: ['packages/*'] },
  'packages/web/package.json': { name: 'web' },
  'packages/web/src/App.vue': '<script setup>\nimport { a } from "./a"\n</script>',
  'packages/web/src/Nav.vue': '<template><nav /></template>',
  'packages/web/src/a.ts': 'export const a = 1',
  'packages/docs/package.json': { name: 'docs' },
  'packages/docs/src/Page.vue': '<template><main /></template>'
}

test('without a compiler, each package warns once, and its files keep their component', t => {
  const { model, summary } = analyzeRepository(repository(t, workspace), emptyConfig)
  assert.deepEqual(summary.warnings, [
    {
      path: 'packages/docs/package.json',
      message: 'vue/compiler-sfc not found; 1 .vue file has no imports'
    },
    {
      path: 'packages/web/package.json',
      message: 'vue/compiler-sfc not found; 2 .vue files have no imports'
    }
  ])
  const app = model.modules['packages/web/src/App.vue' as RepoPath]!
  assert.deepEqual([app.symbols, app.edges], [[component('App')], []])
})

test('the compiler comes from the package that has the file, else from the root', t => {
  const root = repository(t, {
    ...workspace,
    'packages/docs/src/from-root.ts': '',
    'packages/web/src/from-web.ts': '',
    ...fakeVue('', '1.0.0', './from-root'),
    ...fakeVue('packages/web/', '2.0.0', './from-web')
  })
  const { model, summary } = analyzeRepository(root, emptyConfig)
  const targets = (path: string) =>
    model.modules[path as RepoPath]!.edges.map(edge => edge.to.kind === 'module' && edge.to.path)
  assert.deepEqual(targets('packages/web/src/App.vue'), ['packages/web/src/from-web.ts'])
  assert.deepEqual(targets('packages/docs/src/Page.vue'), ['packages/docs/src/from-root.ts'])
  assert.deepEqual(summary.warnings, [])
})

test('a compiler that throws leaves the file its component, and warns once with the first failure', t => {
  const root = repository(t, {
    'package.json': { name: 'app' },
    'src/A.svelte': '<script>',
    'src/B.svelte': '<script>',
    ...throwingSvelte
  })
  const cache = join(repository(t, {}), 'cache')
  const warning = {
    path: 'package.json',
    message:
      'svelte/compiler failed on src/A.svelte: Unexpected token; 2 .svelte files have no imports'
  }
  for (const run of ['cold', 'warm']) {
    const { model, summary } = analyzeRepository(root, emptyConfig, { cache })
    assert.deepEqual(summary.warnings, [warning], run)
    assert.deepEqual(model.modules['src/A.svelte' as RepoPath]!.symbols, [component('A')], run)
  }
})

test('a cached framework file is parsed again when its compiler is installed or changes version', t => {
  const root = repository(t, {
    'package.json': { name: 'app' },
    'src/App.vue': '<template />',
    'src/x.ts': '',
    'src/main.ts': "import App from './App.vue'"
  })
  const cache = join(repository(t, {}), 'cache')
  const install = (version: string) => {
    for (const [path, content] of Object.entries(fakeVue('', version, './x'))) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(
        join(root, path),
        typeof content === 'string' ? content : JSON.stringify(content)
      )
    }
  }
  const run = () => {
    const { model, summary } = analyzeRepository(root, emptyConfig, { cache })
    return [summary.modules.parsed, model.modules['src/App.vue' as RepoPath]!.edges.length]
  }
  assert.deepEqual(run(), [3, 0])
  install('1.0.0')
  assert.deepEqual(run(), [1, 1])
  assert.deepEqual(run(), [0, 1])
  install('1.0.1')
  assert.deepEqual(run(), [1, 1])
})
