import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { repository } from './temp-repository.ts'

function discoverChrome(path: string, ci?: string) {
  const helper = new URL('./browser.ts', import.meta.url).href
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `console.log((await import(${JSON.stringify(helper)})).chrome ?? 'unavailable')`
    ],
    { env: { ...process.env, CI: ci, CHROME_PATH: path }, encoding: 'utf8' }
  )
}

test('CI fails clearly when the configured Chrome is missing, without falling back', t => {
  const path = join(repository(t, {}), 'missing-chrome')
  const result = discoverChrome(path, 'true')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Browser tests require Chrome in CI.*CHROME_PATH/)
})

test('a local run without Chrome can skip the browser tests', t => {
  const path = join(repository(t, {}), 'missing-chrome')
  const result = discoverChrome(path)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'unavailable\n')
})
