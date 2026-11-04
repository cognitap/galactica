import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isScriptLanguage } from '../src/syntax.ts'

test('framework languages are no script languages', () => {
  assert.equal(isScriptLanguage('tsx'), true)
  assert.equal(isScriptLanguage('cjs'), true)
  assert.equal(isScriptLanguage('vue'), false)
})
