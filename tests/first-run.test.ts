import assert from 'node:assert/strict'
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import { cliRunner } from './cli.ts'
import { repository, type Files } from './temp-repository.ts'

const { run: galactica } = cliRunner()
const run = (root: string, ...args: string[]) => galactica(root, ...args, '--root', root)

test('empty and non-JS overviews explain that no supported modules were found (DEV-732)', t => {
  const cases: readonly Files[] = [{}, { 'README.md': 'Hello', 'main.py': 'pass' }]
  for (const files of cases) {
    const result = run(repository(t, files), 'overview')
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      /no JavaScript or TypeScript modules (?:were )?found under (?:the )?(?:repository )?root/i
    )
  }
})

test('unknown options suggest a close option without raw Node parser prose (DEV-732)', t => {
  const result = run(repository(t, {}), 'overview', '--jsno')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /did you mean --json\?/i)
  assert.doesNotMatch(result.stderr, /To specify a positional argument|ERR_PARSE_ARGS/)
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('unknown commands point at help in one line (DEV-732)', t => {
  const result = run(repository(t, {}), 'overveiw')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--help/)
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('health names cross-package private imports clearly (DEV-732)', t => {
  const root = repository(t, { 'src/a.ts': 'export const a = 1' })
  const result = run(root, 'health')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /cross-package private imports/)
})

test('html keeps an explicitly absolute output path in its message (DEV-732)', t => {
  const root = repository(t, { 'src/a.ts': 'export const a = 1' })
  const output = join(repository(t, {}), 'map.html')
  const result = run(root, 'html', '--out', output)
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.stdout.startsWith(`wrote ${output} (`), result.stdout)
})

test('html default output explains where to put or ignore the generated page (DEV-732)', t => {
  const result = run(repository(t, { 'src/a.ts': 'export const a = 1' }), 'html')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--out|\.gitignore/)
})

for (const command of ['html', 'init']) {
  test(`${command} write failures are structured with --json (DEV-732)`, t => {
    const root = repository(t, { 'src/a.ts': 'export const a = 1' })
    const outside = repository(t, {})
    if (command === 'html') symlinkSync(join(outside, 'page.html'), join(root, 'galactica.html'))
    else symlinkSync(outside, join(root, '.agents'), 'dir')
    const result = run(root, command, '--json')
    assert.equal(result.status, 1)
    const output = JSON.parse(result.stdout)
    assert.equal(output.command, command)
    assert.match(output.error.message, /symbolic link/)
    assert.equal(result.stderr, '')
  })
  test(`${command} argument errors also use the JSON failure envelope`, t => {
    const root = repository(t, {})
    for (const args of [['--jsno'], ['extra'], ['--out'], ['--depth', '2']]) {
      const result = run(root, command, '--json', ...args)
      assert.equal(result.status, 1, args.join(' '))
      const output = JSON.parse(result.stdout)
      assert.equal(output.command, command)
      assert.equal(output.error.code, 'usage')
      assert.equal(result.stderr, '')
    }
  })
}

test('html JSON success reports the absolute path and exact size', t => {
  const root = repository(t, { 'src/a.ts': 'export const a = 1' })
  const result = run(root, 'html', '--json')
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.command, 'html')
  assert.ok(isAbsolute(output.path))
  assert.equal(readFileSync(output.path).length, output.bytes)
  assert.equal(result.stderr, '')
})

test('init JSON reports file statuses, including the all-kept exit code', t => {
  const root = repository(t, {})
  const first = run(root, 'init', '--json')
  assert.equal(first.status, 0, first.stderr)
  const output = JSON.parse(first.stdout)
  assert.equal(output.schemaVersion, 1)
  assert.equal(output.command, 'init')
  assert.equal(output.files.length, 3)
  assert.ok(output.files.every((file: { status: string }) => file.status === 'created'))
  const unchanged = run(root, 'init', '--json')
  assert.equal(unchanged.status, 0, unchanged.stderr)
  assert.ok(
    JSON.parse(unchanged.stdout).files.every(
      (file: { status: string }) => file.status === 'unchanged'
    )
  )
  for (const file of output.files) {
    const path = join(root, file.path)
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nEdited by the user.\n`)
  }
  const kept = run(root, 'init', '--json')
  assert.equal(kept.status, 1)
  assert.ok(
    JSON.parse(kept.stdout).files.every((file: { status: string }) => file.status === 'kept')
  )
  assert.equal(kept.stderr, '')
})

test('outline and where distinguish an export alias from the declaration name (DEV-732)', t => {
  const root = repository(t, {
    'src/slot.ts': 'const Slot = createSlot(); export { Slot, Slot as Root }'
  })
  const outline = run(root, 'outline', 'src/slot.ts')
  assert.equal(outline.status, 0, outline.stderr)
  assert.ok(
    outline.stdout.split('\n').some(line => line.includes('Root') && line.includes('Slot')),
    outline.stdout
  )
  const where = run(root, 'where', 'Root')
  assert.equal(where.status, 0, where.stderr)
  assert.ok(
    where.stdout.split('\n').some(line => line.includes('src/slot.ts:') && line.includes('Root')),
    where.stdout
  )
  const json = JSON.parse(run(root, 'outline', 'src/slot.ts', '--json').stdout)
  assert.deepEqual(
    json.symbols.map((symbol: { name: string }) => symbol.name),
    ['Root', 'Slot']
  )
  assert.ok(
    json.symbols.every((symbol: { signature: string }) =>
      symbol.signature.startsWith('const Slot =')
    )
  )
})

test('alias text handles declaration kinds, modifiers and Unicode names without changing normal names', t => {
  const declarations = [
    ['LocalFn', 'function LocalFn() {}'],
    ['LocalGen', 'function* LocalGen() {}'],
    ['LocalAsync', 'async function LocalAsync() {}'],
    ['LocalClass', 'class LocalClass {}'],
    ['LocalAbstract', 'abstract class LocalAbstract {}'],
    ['LocalType', 'type LocalType = string'],
    ['LocalInterface', 'interface LocalInterface {}'],
    ['LocalEnum', 'enum LocalEnum { A }'],
    ['LocalConstEnum', 'const enum LocalConstEnum { A }'],
    ['LocalLet', 'let LocalLet = 1'],
    ['LocalVar', 'var LocalVar = 1'],
    ['Å', 'const Å = 1']
  ] as const
  const root = repository(t, {
    'src/aliases.ts': declarations
      .map(([name, declaration]) => `${declaration}; export { ${name}, ${name} as Public${name} }`)
      .join('\n')
  })
  const result = run(root, 'outline', 'src/aliases.ts')
  assert.equal(result.status, 0, result.stderr)
  for (const [name] of declarations)
    assert.ok(result.stdout.includes(`Public${name} (alias of ${name})`), result.stdout)
  assert.equal(
    result.stdout.split('\n').filter(line => line.includes('(alias of ')).length,
    declarations.length
  )
})
