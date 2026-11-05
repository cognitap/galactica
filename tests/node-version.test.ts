import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { minimumNode, nodeProblem } from '../src/node-version.ts'

test('accepts the minimum Node.js and anything newer', () => {
  for (const version of ['24.1.0', '24.1.1', '24.11.0', '25.0.0', '26.11.1', '100.0.0']) {
    assert.equal(nodeProblem(version), undefined, version)
  }
})

test('rejects anything older than the minimum Node.js', () => {
  for (const version of ['24.0.2', '24.0.0', '23.11.0', '22.21.1', '18.20.8', '4.9.1']) {
    assert.equal(
      nodeProblem(version),
      `needs Node.js 24.1.0 or newer, and this is Node.js ${version}`,
      version
    )
  }
})

test('package.json engines names the same minimum', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.engines.node, `>=${minimumNode}`)
})
