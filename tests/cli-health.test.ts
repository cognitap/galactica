import assert from 'node:assert/strict'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cliRunner } from './cli.ts'
import { besideOutside, link, repository } from './temp-repository.ts'

const { run: galactica } = cliRunner()

function cycle(t: Parameters<typeof repository>[0]) {
  return repository(t, {
    'package.json': { name: 'app' },
    'src/a.ts': 'import { b } from "./b"\nexport const a = b\n',
    'src/b.ts': 'import { a } from "./a"\nexport const b = a\n'
  })
}

test('accept writes the findings, and health leaves them out until a cycle gains a module', t => {
  const root = cycle(t)
  const before = JSON.parse(galactica(root, 'health', '--json').stdout)
  assert.equal(before.accepted, undefined)
  assert.equal(before.cycles.length, 1)
  assert.doesNotMatch(galactica(root, 'health').stdout, /accepted/)

  const wrote = galactica(root, 'accept')
  assert.equal(wrote.status, 0, wrote.stderr)
  assert.match(wrote.stdout, /^wrote galactica-health\.json \(\d+ KB\)\n$/)
  const file = join(root, 'galactica-health.json')
  const text = readFileSync(file, 'utf8')
  const json = JSON.parse(galactica(root, 'accept', '--json').stdout)
  assert.equal(json.command, 'accept')
  assert.equal(json.path, join(realpathSync(root), 'galactica-health.json'))
  assert.equal(json.bytes, Buffer.byteLength(text))

  const hidden = JSON.parse(galactica(root, 'health', '--json').stdout)
  assert.equal(hidden.accepted, 1)
  assert.deepEqual(hidden.cycles, [])
  assert.match(galactica(root, 'health').stdout, /1 finding accepted\n$/)

  writeFileSync(
    join(root, 'src/b.ts'),
    'import { a } from "./a"\nimport { c } from "./c"\nexport const b = a + c\n'
  )
  writeFileSync(join(root, 'src/c.ts'), 'import { a } from "./a"\nexport const c = a\n')
  const grown = JSON.parse(galactica(root, 'health', '--json').stdout)
  assert.equal(grown.accepted, 0)
  assert.equal(grown.cycles.length, 1)
  assert.ok(grown.cycles[0].modules.includes('src/c.ts'))
})

test('an unreadable accepted file fails health and html, and accept replaces it', t => {
  const root = cycle(t)
  const file = join(root, 'galactica-health.json')
  writeFileSync(file, '{')
  const health = galactica(root, 'health')
  assert.equal(health.status, 1)
  assert.match(
    health.stderr,
    /accepted findings galactica-health\.json could not be read: invalid JSON/
  )
  assert.equal(galactica(root, 'overview').status, 0)
  assert.doesNotMatch(galactica(root, 'overview').stdout, /galactica-health/)
  const html = galactica(root, 'html', '--out', join(root, 'map.html'))
  assert.equal(html.status, 1)
  assert.match(html.stderr, /could not be read: invalid JSON/)

  assert.equal(galactica(root, 'accept').status, 0)
  assert.equal(JSON.parse(galactica(root, 'health', '--json').stdout).accepted, 1)
})

test('accept refuses a symbolic link', t => {
  const { root, outside, untouched } = besideOutside(t)
  link(root, 'galactica-health.json', join(outside, 'outside.txt'))
  const wrote = galactica(root, 'accept')
  assert.equal(wrote.status, 1)
  assert.match(wrote.stderr, /refused to write galactica-health\.json: it is a symbolic link/)
  assert.equal(untouched(), true)
  assert.match(galactica(root, 'health').stderr, /could not be read: links outside the repository/)
})

test('accept takes no argument and no flag of another command', t => {
  const root = cycle(t)
  for (const args of [
    ['accept', 'src'],
    ['accept', '--depth', '2'],
    ['accept', '--out', 'health.json']
  ]) {
    const result = galactica(root, ...args)
    assert.equal(result.status, 1, args.join(' '))
    assert.match(result.stderr, /^galactica: /, args.join(' '))
  }
})
