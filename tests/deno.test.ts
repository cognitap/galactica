import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { run } from '../src/cli.ts'
import { commands } from '../src/contract.ts'
import { repository } from './temp-repository.ts'

for (const file of ['deno.json', 'deno.jsonc']) {
  test(`${file} refuses analysis explicitly in text, JSON and HTML`, async t => {
    const root = repository(t, {
      [file]: '{ /* Deno config */ "workspace": ["packages/core"] }',
      'src/main.ts': 'import { value } from "jsr:@example/core"; export const main = value'
    })
    const message = `${file}: Deno repositories are not supported; workspace and import-map resolution would give an incomplete map`
    for (const command of commands) {
      const argument = ['where', 'outline', 'uses', 'deps'].includes(command) ? ['src/main.ts'] : []
      const text = await run([command, ...argument], root)
      assert.equal(text.code, 1, `${command} should refuse a Deno repository`)
      assert.equal(text.stdout, '')
      assert.equal(text.stderr, `galactica: ${message}`)
      const json = await run([command, ...argument, '--json'], root)
      assert.equal(json.code, 1)
      assert.equal(json.stderr, '')
      assert.deepEqual(JSON.parse(json.stdout), {
        schemaVersion: 1,
        command,
        error: { code: 'usage', message }
      })
    }
    const html = await run(['html', '--out', join(root, 'map.html')], root)
    assert.equal(html.code, 1)
    assert.equal(html.stderr, `galactica: ${message}`)
    assert.ok(!existsSync(join(root, 'map.html')))
    assert.equal((await run(['--help'], root)).code, 0)
    assert.equal((await run(['--version'], root)).code, 0)
  })
}

test('adding a Deno config refuses a previously cached repository', async t => {
  const root = repository(t, { 'src/main.ts': 'export const main = 1' })
  assert.equal((await run(['overview'], root)).code, 0)
  writeFileSync(join(root, 'deno.json'), '{}')
  assert.equal((await run(['overview'], root)).code, 1)
})
