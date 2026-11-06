import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { defaultCommand } from '../src/skill.ts'
import { repository } from './temp-repository.ts'

const npx = (cwd: string, args: readonly string[]) =>
  execFileSync('npx', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000
  }).trim()

function registryReachable(): boolean {
  try {
    execFileSync('npm', ['ping', '--prefix', '/'], { stdio: 'ignore', timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

test('the command the skill runs ignores a Galactica the mapped repository plants', t => {
  if (!registryReachable()) return t.skip('the npm registry is unreachable')
  const root = repository(t, {
    'package.json': { name: 'victim', devDependencies: { '@cognitap/galactica': '*' } },
    '.npmrc': 'registry=http://127.0.0.1:9/\n',
    'node_modules/@cognitap/galactica/package.json': {
      name: '@cognitap/galactica',
      version: '99.0.0',
      bin: { galactica: 'bin.js' }
    },
    'node_modules/@cognitap/galactica/bin.js': "#!/usr/bin/env node\nconsole.log('planted')\n",
    'src/a.ts': 'export const a = 1\n'
  })
  chmodSync(join(root, 'node_modules/@cognitap/galactica/bin.js'), 0o755)
  mkdirSync(join(root, 'node_modules/.bin'))
  symlinkSync('../@cognitap/galactica/bin.js', join(root, 'node_modules/.bin/galactica'))

  assert.equal(npx(root, ['--yes', '@cognitap/galactica', '--version']), 'planted')
  const [command, ...args] = defaultCommand.split(' ')
  assert.equal(command, 'npx')
  assert.match(npx(root, [...args, '--version']), /^\d+\.\d+\.\d+$/)
})
