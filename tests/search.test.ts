import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { emptyConfig } from '../src/model.ts'
import { pageData } from '../src/page-data.ts'
import { moduleKinds, type ModuleKind } from '../src/contract.ts'
import { entriesOf, hiddenBy, search, type SearchEntry } from '../src/page/search.js'
import { defines, modelOf } from './models.ts'

const page = pageData(
  graphOf(
    modelOf({
      'src/button/Button.tsx': {
        symbols: [
          defines('Button', 3, { kind: 'component', default: true }),
          defines('ButtonProps', 1, { kind: 'type' })
        ]
      },
      'src/button/Button.stories.tsx': { symbols: [defines('Primary', 2)] },
      'src/forms/SubmitButton.tsx': { symbols: [defines('SubmitButton', 1)] },
      'src/forms/button-group.ts': {},
      'src/cn.ts': { symbols: [defines('cn')] },
      'tests/button.test.ts': {}
    }),
    emptyConfig
  )
)
const entries = entriesOf(page)

const found = (results: readonly SearchEntry[]) =>
  results.map(({ text, kind, where }) => `${kind} ${text} in ${where}`)

test('entries come in path order, each symbol after its module, with what it is and where it lives', () => {
  assert.deepEqual(found(entries), [
    'area src in acme',
    'area src/button in acme',
    'module src/button/Button.stories.tsx in src/button',
    'const Primary in src/button/Button.stories.tsx',
    'module src/button/Button.tsx in src/button',
    'default component Button in src/button/Button.tsx',
    'type ButtonProps in src/button/Button.tsx',
    'module src/cn.ts in src',
    'const cn in src/cn.ts',
    'area src/forms in acme',
    'module src/forms/SubmitButton.tsx in src/forms',
    'const SubmitButton in src/forms/SubmitButton.tsx',
    'module src/forms/button-group.ts in src/forms',
    'area tests in acme',
    'module tests/button.test.ts in tests'
  ])
  const button = page.modules.findIndex(({ path }) => path === 'src/button/Button.tsx')
  assert.deepEqual(entries.find(({ text }) => text === 'ButtonProps')!.target, {
    kind: 'symbol',
    module: button,
    symbol: 1
  })
})

const code: ReadonlySet<ModuleKind> = new Set(['source', 'config'])
const every: ReadonlySet<ModuleKind> = new Set(moduleKinds)

test('an exact match comes first, then a prefix of the last segment or name, then a substring, each in path order', () => {
  assert.deepEqual(found(search(entries, 'button', every)), [
    'area src/button in acme',
    'default component Button in src/button/Button.tsx',
    'module src/button/Button.stories.tsx in src/button',
    'module src/button/Button.tsx in src/button',
    'type ButtonProps in src/button/Button.tsx',
    'module src/forms/button-group.ts in src/forms',
    'module tests/button.test.ts in tests',
    'module src/forms/SubmitButton.tsx in src/forms',
    'const SubmitButton in src/forms/SubmitButton.tsx'
  ])
})

test('a whole path or a last segment matches exactly, whatever its case', () => {
  assert.deepEqual(found(search(entries, ' SRC/CN.TS ', code)), ['module src/cn.ts in src'])
  assert.deepEqual(found(search(entries, 'cn.ts', code)), ['module src/cn.ts in src'])
})

test('what the filter hides is still found, after what it shows within each tier', () => {
  assert.deepEqual(found(search(entries, 'button', code)), [
    'area src/button in acme',
    'default component Button in src/button/Button.tsx',
    'module src/button/Button.tsx in src/button',
    'type ButtonProps in src/button/Button.tsx',
    'module src/forms/button-group.ts in src/forms',
    'module src/button/Button.stories.tsx in src/button',
    'module tests/button.test.ts in tests',
    'module src/forms/SubmitButton.tsx in src/forms',
    'const SubmitButton in src/forms/SubmitButton.tsx'
  ])
  assert.deepEqual(found(search(entries, 'primary', code)), [
    'const Primary in src/button/Button.stories.tsx'
  ])
})

test('a match names the kinds that hide it, and an area hides only when all its kinds do', () => {
  const hiding = (query: string, shown: ReadonlySet<ModuleKind>) =>
    search(entries, query, shown).map(entry => `${entry.text}: ${hiddenBy(entry, shown).join(' ')}`)
  assert.deepEqual(hiding('primary', code), ['Primary: story'])
  assert.deepEqual(hiding('primary', every), ['Primary: '])
  assert.deepEqual(hiding('tests', code), ['tests: test', 'tests/button.test.ts: test'])
  assert.deepEqual(hiding('src/button', new Set(['story'])), [
    'src/button: ',
    'src/button/Button.stories.tsx: ',
    'src/button/Button.tsx: source'
  ])
})

test('an empty query finds nothing, and results stop at the limit', () => {
  assert.deepEqual(search(entries, '   ', every), [])
  assert.equal(search(entries, 's', every).length, 12)
  assert.equal(search(entries, 's', every, 3).length, 3)
})
