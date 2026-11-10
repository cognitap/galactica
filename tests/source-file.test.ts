import assert from 'node:assert/strict'
import { test } from 'node:test'
import { languages } from '../src/contract.ts'
import { isScriptLanguage } from '../src/frameworks.ts'
import { emptyConfig, parseRepoPath } from '../src/model.ts'
import { kindOf, languageOf } from '../src/source-file.ts'

const kind = (path: string) => kindOf(parseRepoPath(path), emptyConfig)
const language = (path: string) => languageOf(parseRepoPath(path))

test('every contract language is the language of files with that extension', () => {
  for (const name of languages) assert.equal(language(`src/a.${name}`), name)
  assert.equal(language('src/Counter.vue'), 'vue')
  assert.equal(language('.eslintrc.cjs'), 'cjs')
})

test('files with other extensions, and declaration files, are no modules', () => {
  for (const path of [
    'README.md',
    'package.json',
    'src/style.css',
    'src/app.component.html',
    'src/template.html',
    'Makefile',
    'src/env.d.ts',
    'src/env.d.mts',
    'src/env.d.cts',
    '.ts'
  ]) {
    assert.equal(language(path), undefined, path)
  }
})

test('test files are named .test. or .spec., or live under a test directory', () => {
  assert.equal(kind('src/format.test.ts'), 'test')
  assert.equal(kind('src/format.spec.tsx'), 'test')
  assert.equal(kind('src/__tests__/format.ts'), 'test')
  assert.equal(kind('test/helpers.ts'), 'test')
  assert.equal(kind('tests/browser/render.tsx'), 'test')
})

test('stories are named .stories. or .story.', () => {
  assert.equal(kind('src/ui/Price.stories.tsx'), 'story')
  assert.equal(kind('src/ui/Price.story.ts'), 'story')
})

test('config files are named .config. or .<tool>rc., or live under a dot directory', () => {
  assert.equal(kind('vite.config.ts'), 'config')
  assert.equal(kind('packages/app/eslint.config.mjs'), 'config')
  assert.equal(kind('.eslintrc.cjs'), 'config')
  assert.equal(kind('.lint-stagedrc.js'), 'config')
  assert.equal(kind('.storybook/main.ts'), 'config')
  assert.equal(kind('.github/scripts/release.mjs'), 'config')
})

test('a module in a subfolder of .storybook is a story, since stories render it', () => {
  assert.equal(kind('.storybook/examples/KbdExamples.tsx'), 'story')
  assert.equal(kind('packages/ui/.storybook/decorators/theme/Frame.tsx'), 'story')
  assert.equal(kind('.storybook/preview.tsx'), 'config')
})

test('everything else is source, including names that only resemble a rule', () => {
  for (const path of [
    'src/main.ts',
    'src/config.ts',
    'src/config/index.ts',
    'src/testing.ts',
    'src/latest/index.ts',
    'src/history.ts',
    'src/src.ts'
  ]) {
    assert.equal(kind(path), 'source', path)
  }
})

test('test wins over story, and story wins over config', () => {
  assert.equal(kind('src/Price.stories.test.tsx'), 'test')
  assert.equal(kind('tests/Price.stories.tsx'), 'test')
  assert.equal(kind('.storybook/Intro.stories.tsx'), 'story')
  assert.equal(kind('tests/vitest.config.ts'), 'test')
})

test('framework languages are no script languages', () => {
  assert.equal(isScriptLanguage('tsx'), true)
  assert.equal(isScriptLanguage('cjs'), true)
  assert.equal(isScriptLanguage('vue'), false)
})

for (const name of ['app.e2e-spec.ts', 'app.integration-spec.tsx', 'app-spec.js']) {
  test(`${name} is a test`, () => assert.equal(kind(`src/${name}`), 'test'))
}

for (const folder of [
  '__testfixtures__',
  '__fixtures__',
  'testdata',
  'testData',
  'fixtures',
  '__mocks__'
]) {
  test(`${folder} contains tests, including framework files`, () => {
    for (const extension of ['ts', 'js', 'vue', 'svelte', 'astro', 'mdx', 'marko']) {
      assert.equal(kind(`src/${folder}/nested/component.${extension}`), 'test')
    }
  })
}

test('explicit kinds can keep production fixture directories as source', () => {
  const config = { ...emptyConfig, kinds: { source: ['src/fixtures/**'] } }
  assert.equal(kindOf(parseRepoPath('src/fixtures/seeds.ts'), config), 'source')
})
