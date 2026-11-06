import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { emptyConfig } from '../src/model.ts'
import { pageData } from '../src/page-data.ts'
import { kindsOf, subjectOf } from '../src/page/indexes.js'
import { defines, modelOf } from './models.ts'

const page = pageData(
  graphOf(
    modelOf({
      'src/button/Button.tsx': { symbols: [defines('Button', 3, { kind: 'component' })] },
      'src/button/Button.test.ts': {},
      'src/button/Button.stories.tsx': {},
      'src/utils/math.ts': {}
    }),
    emptyConfig
  )
)
const button = page.modules.findIndex(module => module.path === 'src/button/Button.tsx')
const area = page.modules[button]!.area

test('selection indexes resolve to the original area or module', () => {
  assert.equal(subjectOf(page, { kind: 'area', index: area }), page.areas[area])
  assert.equal(subjectOf(page, { kind: 'module', index: button }), page.modules[button])
})

test('a target holds its area kinds or the kind of its owning module', () => {
  assert.deepEqual(
    new Set(kindsOf(page, { kind: 'area', area })),
    new Set(['source', 'test', 'story'])
  )
  assert.deepEqual(kindsOf(page, { kind: 'module', module: button }), ['source'])
  assert.deepEqual(kindsOf(page, { kind: 'symbol', module: button, symbol: 0 }), ['source'])
  const testModule = page.modules.findIndex(module => module.path.endsWith('.test.ts'))
  assert.deepEqual(kindsOf(page, { kind: 'module', module: testModule }), ['test'])
})
