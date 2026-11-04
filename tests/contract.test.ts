import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('the public contract imports nothing, so no private type can reach the output', () => {
  const source = readFileSync(new URL('../src/contract.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(import|export\s.*\sfrom)\s/m)
})
