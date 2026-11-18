import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cliRunner } from './cli.ts'
import { besideOutside, link, repository } from './temp-repository.ts'

const { run: galactica } = cliRunner()

function app(t: Parameters<typeof repository>[0]) {
  return repository(t, {
    'package.json': { name: 'app' },
    'src/a.ts': 'export const a = 1\n',
    'src/b.ts': 'export const b = a\n'
  })
}

test('snapshot writes galactica-map.json and check matches those bytes', t => {
  const root = app(t)
  const first = galactica(root, 'snapshot')
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.stderr, '')
  assert.match(first.stdout, /^wrote galactica-map\.json \(\d+ KB\)\n$/)
  const file = join(root, 'galactica-map.json')
  const text = readFileSync(file, 'utf8')
  assert.equal(galactica(root, 'snapshot').status, 0)
  assert.equal(readFileSync(file, 'utf8'), text)

  const check = galactica(root, 'check')
  assert.equal(check.status, 0, check.stderr)
  assert.equal(check.stdout, 'galactica-map.json matches the repository\n')
  const overview = JSON.parse(galactica(root, 'overview', '--json').stdout)
  assert.equal(overview.committedMap, undefined)

  const json = galactica(root, 'snapshot', '--json')
  assert.equal(json.status, 0)
  const output = JSON.parse(json.stdout)
  assert.equal(output.command, 'snapshot')
  assert.equal(output.path, join(realpathSync(root), 'galactica-map.json'))
  assert.equal(output.bytes, Buffer.byteLength(text))
  assert.equal(output.committedMap, undefined)
})

test('snapshot writes into --root, and check from another directory reads it there', t => {
  const root = app(t)
  const cwd = repository(t, {})
  const wrote = galactica(cwd, 'snapshot', '--root', root)
  assert.equal(wrote.status, 0, wrote.stderr)
  assert.ok(existsSync(join(root, 'galactica-map.json')))
  assert.equal(existsSync(join(cwd, 'galactica-map.json')), false)
  assert.equal(galactica(cwd, 'check', '--root', root).status, 0)
})

test('check names the area that changed, and other commands warn until snapshot', t => {
  const root = app(t)
  assert.match(galactica(root, 'check').stderr, /no committed map at galactica-map\.json/)
  assert.equal(galactica(root, 'check').status, 1)
  assert.equal(galactica(root, 'overview').stdout.includes('committed map'), false)

  galactica(root, 'snapshot')
  writeFileSync(join(root, 'src/c.ts'), 'export const c = 1\n')
  const check = galactica(root, 'check')
  assert.equal(check.status, 1)
  assert.equal(check.stderr, '')
  assert.match(check.stdout, /src \(app\): changed/)
  const json = JSON.parse(galactica(root, 'check', '--json').stdout)
  assert.equal(json.stale, true)
  assert.equal(json.areas[0].path, 'src')
  assert.equal(json.areas[0].change, 'changed')

  const overview = galactica(root, 'overview')
  assert.equal(overview.status, 0)
  assert.match(overview.stdout, /committed map galactica-map\.json is stale; run check\n$/)
  const noted = JSON.parse(galactica(root, 'overview', '--json').stdout)
  assert.equal(noted.committedMap, 'committed map galactica-map.json is stale; run check')
  const html = galactica(root, 'html', '--out', join(root, 'map.html'))
  assert.equal(html.status, 0, html.stderr)
  assert.match(html.stdout, /is stale; run check\n$/)

  assert.equal(galactica(root, 'snapshot').status, 0)
  assert.equal(galactica(root, 'check').status, 0)
  assert.equal(JSON.parse(galactica(root, 'overview', '--json').stdout).committedMap, undefined)
})

test('an unreadable committed map warns, and check exits 1', t => {
  const root = app(t)
  writeFileSync(join(root, 'galactica-map.json'), '{')
  const check = galactica(root, 'check')
  assert.equal(check.status, 1)
  assert.match(check.stderr, /could not be read: invalid JSON/)
  const overview = galactica(root, 'overview')
  assert.equal(overview.status, 0)
  assert.match(overview.stdout, /could not be read: invalid JSON/)
  const noted = JSON.parse(galactica(root, 'outline', 'src/nope.ts', '--json').stdout)
  assert.equal(noted.error.code, 'not-found')
  assert.match(noted.committedMap, /could not be read: invalid JSON/)
  assert.match(galactica(root, 'outline', 'src/nope.ts').stderr, /could not be read: invalid JSON/)
})

test('snapshot refuses a symbolic link and does not follow one out of the repository', t => {
  const { root, outside, untouched } = besideOutside(t)
  link(root, 'galactica-map.json', join(outside, 'outside.txt'))
  const wrote = galactica(root, 'snapshot')
  assert.equal(wrote.status, 1)
  assert.match(wrote.stderr, /refused to write galactica-map\.json: it is a symbolic link/)
  assert.equal(untouched(), true)
  const check = galactica(root, 'check')
  assert.equal(check.status, 1)
  assert.match(check.stderr, /could not be read: links outside the repository/)
})

test('snapshot takes no argument and no flag of another command', t => {
  const root = app(t)
  for (const args of [
    ['snapshot', 'src'],
    ['snapshot', '--depth', '2'],
    ['snapshot', '--out', 'map.json']
  ]) {
    const result = galactica(root, ...args)
    assert.equal(result.status, 1, args.join(' '))
    assert.match(result.stderr, /^galactica: /, args.join(' '))
  }
})
