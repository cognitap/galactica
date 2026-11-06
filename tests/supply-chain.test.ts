import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

for (const workflow of ['ci.yml', 'release.yml']) {
  test(`${workflow} pins every action to a full SHA and records its version`, () => {
    const text = readFileSync(new URL(`../.github/workflows/${workflow}`, import.meta.url), 'utf8')
    const actions = [...text.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)]
    assert.ok(actions.length > 0)
    for (const [, action] of actions) {
      assert.match(action ?? '', /^[\w/-]+@[a-f0-9]{40}\s+# v\d+\.\d+\.\d+$/)
    }
  })
}

test('the publish job only sets up Node, downloads the candidate and publishes', () => {
  const text = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
  const publish = text.split('\n  publish:')[1] ?? ''
  assert.doesNotMatch(publish, /checkout|pnpm\/action-setup|pnpm publish/)
  assert.match(publish, /npm publish release\/galactica.tgz --ignore-scripts/)
  const version = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim()
  assert.ok(publish.includes(`node-version: '${version}'`))
})
