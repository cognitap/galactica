import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const version = JSON.parse(read('package.json')).version as string
const nvmrc = read('.nvmrc').trim()
const pin = /^[\w/-]+@[a-f0-9]{40}\s+# v\d+\.\d+\.\d+$/

test('the action runs the published release and uploads the HTML map', () => {
  const action = read('action.yml')
  assert.match(action, /default: html/)
  assert.match(action, new RegExp(`node-version: '${nvmrc}'`))
  assert.match(action, /html\|check/)
  assert.match(action, /@cognitap\/galactica@\$\{version\}/)
  assert.match(action, /No matching version found/)
  assert.match(action, /node_modules\/\.bin\/galactica/)
  assert.match(action, /galactica\.html/)
  const uses = [...action.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)].map(([, value]) => value)
  assert.deepEqual(uses, [
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
    'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2'
  ])
  for (const value of uses) assert.match(value ?? '', pin)
})

test('the action recipes pin their actions and this release', () => {
  const commands = read('docs/commands.md')
  const section = commands.split('## GitHub Action')[1]?.split('## init')[0] ?? ''
  assert.match(section, /one page/)
  assert.match(section, new RegExp(`Node\\.js ${nvmrc}`))
  assert.match(section, /command: check/)
  assert.match(section, /_site\/index\.html/)
  const uses = [...section.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)].map(([, value]) => value)
  assert.ok(uses.length >= 4)
  for (const value of uses) {
    if (value === `cognitap/galactica@v${version}`) continue
    assert.match(value ?? '', pin)
  }
  assert.ok(uses.includes(`cognitap/galactica@v${version}`))
})
