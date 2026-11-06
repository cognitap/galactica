import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cacheDirectory } from '../src/cache.ts'
import { cliRunner } from './cli.ts'
import { repository } from './temp-repository.ts'

test('cached CLI runs leave the inherited user home and cache untouched', t => {
  const user = repository(t, { sentinel: 'keep' })
  const inherited = {
    ...process.env,
    HOME: user,
    USERPROFILE: user,
    XDG_CACHE_HOME: join(user, 'xdg-cache'),
    LOCALAPPDATA: join(user, 'local-data')
  }
  let dispose = () => {}
  t.after(() => dispose())
  const runner = cliRunner(
    {
      after: fn => {
        dispose = fn
      }
    },
    inherited
  )
  const root = repository(t, { 'src/main.ts': 'export const value = 1' })
  for (let run = 0; run < 2; run++) {
    const result = runner.run(root, 'overview', '--json')
    assert.equal(result.status, 0, result.stderr)
  }
  const cache = cacheDirectory(root, {
    platform: process.platform,
    env: runner.env,
    home: runner.home
  })!
  assert.ok(existsSync(join(cache, 'cache.json')), 'the test exercises a real cached run')
  assert.deepEqual(readdirSync(user), ['sentinel'])
  assert.equal(readFileSync(join(user, 'sentinel'), 'utf8'), 'keep')
  assert.equal(runner.env.HOME, runner.home)
  assert.equal(runner.env.USERPROFILE, runner.home)
  assert.equal(runner.env.XDG_CACHE_HOME, join(runner.home, '.cache'))
  assert.equal(runner.env.LOCALAPPDATA, join(runner.home, 'AppData', 'Local'))
  dispose()
  assert.equal(existsSync(runner.home), false, 'cleanup removes the home and caches')
})

test('the shared runner uses the selected Node executable', t => {
  const runner = cliRunner(t)
  const result = runner.node(['-p', 'process.execPath'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), process.execPath)
})
