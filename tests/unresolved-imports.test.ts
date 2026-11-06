import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Overview } from '../src/contract.ts'
import { cliRunner } from './cli.ts'
import { repository } from './temp-repository.ts'

const { run: galactica } = cliRunner()
const url = `data:text/javascript,${'export const x = 1;'.repeat(40)}`
function fixture(t: TestContext) {
  return repository(t, {
    'package.json': { name: 'app' },
    'src/main.ts': [
      "import './missing.ts'",
      "import './generated/route.js'",
      "import 'astro:content'",
      "import 'https://example.test/mod.js'",
      `import ${JSON.stringify(url)}`,
      "import './addon.node'"
    ].join('\n'),
    'tests/main.test.ts': "import './fixture-only.ts'",
    'src/main.stories.ts': "import 'virtual:storybook'",
    'vite.config.ts': "import 'jsr:@std/test'"
  })
}
function run(root: string, ...args: string[]) {
  const result = galactica(root, ...args, '--root', root, '--no-cache')
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

test('overview lists every unresolved import with file, line and likely cause (DEV-731)', t => {
  const root = fixture(t)
  const output = JSON.parse(run(root, 'overview', '--json')) as Overview
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.unresolved, 9)
  const entries = [
    { from: 'src/main.ts', line: 1, specifier: './missing.ts', cause: 'missing' },
    { from: 'src/main.ts', line: 2, specifier: './generated/route.js', cause: 'build' },
    { from: 'src/main.ts', line: 3, specifier: 'astro:content', cause: 'virtual' },
    { from: 'src/main.ts', line: 4, specifier: 'https://example.test/mod.js', cause: 'url' },
    { from: 'src/main.ts', line: 5, specifier: url, cause: 'url' },
    { from: 'src/main.ts', line: 6, specifier: './addon.node', cause: 'build' },
    { from: 'tests/main.test.ts', line: 1, specifier: './fixture-only.ts', cause: 'missing' },
    { from: 'src/main.stories.ts', line: 1, specifier: 'virtual:storybook', cause: 'virtual' },
    { from: 'vite.config.ts', line: 1, specifier: 'jsr:@std/test', cause: 'virtual' }
  ].sort((a, b) => (a.from === b.from ? a.line - b.line : a.from < b.from ? -1 : 1))
  assert.deepEqual(output.unresolvedImports, entries)
  assert.deepEqual(JSON.parse(run(root, 'overview', '--all', '--json')).unresolvedImports, entries)
})

test('overview text groups unresolved imports by likely cause (DEV-731)', t => {
  const text = run(fixture(t), 'overview')
  for (const group of ['build/generated: 2', 'virtual/scheme: 3', 'URL: 2', 'missing/unmapped: 2'])
    assert.ok(text.includes(group), text)
})

test('deps shortens long specifiers in text and keeps JSON complete (DEV-731)', t => {
  const root = fixture(t)
  const text = run(root, 'deps', 'src/main.ts')
  assert.ok(!text.includes(url), 'text must not dump the entire data URL')
  assert.match(text, /data:text\/javascript,.*…/)
  assert.ok(
    text.split('\n').every(line => line.length < 200),
    text
  )
  const json = JSON.parse(run(root, 'deps', 'src/main.ts', '--json'))
  assert.ok(json.unresolved.some((entry: { specifier: string }) => entry.specifier === url))
})
