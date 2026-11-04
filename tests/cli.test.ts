import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const cli = new URL('../dist/cli.js', import.meta.url).pathname

test('prints usage with --help', () => {
  const out = execFileSync('node', [cli, '--help'], { encoding: 'utf8' })
  assert.match(out, /^Usage: galactica/)
})

test('prints the package version with --version', () => {
  const out = execFileSync('node', [cli, '--version'], { encoding: 'utf8' })
  assert.equal(out.trim(), '0.0.0')
})
