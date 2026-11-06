import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, parse, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { isBelow, isWithin } from '../src/paths.ts'

const folder = resolve(tmpdir(), 'galactica-paths', 'repo')

for (const [name, path, within, below] of [
  ['the folder itself', folder, true, false],
  ['a trailing separator', folder + sep, true, false],
  ['a descendant', join(folder, 'src', 'a.ts'), true, true],
  ['a sibling with the same prefix', folder + '-other', false, false],
  ['the parent', join(folder, '..'), false, false],
  [
    'a path that escapes through dot segments',
    folder + sep + 'src' + sep + '..' + sep + '..' + sep + 'secret',
    false,
    false
  ],
  ['a path that normalizes to the folder', folder + sep + 'src' + sep + '..', true, false],
  ['a descendant with dots in its name', join(folder, '..notes'), true, true]
] as const) {
  test(`path containment handles ${name}`, () => {
    assert.equal(isWithin(folder, path), within)
    assert.equal(isBelow(folder, path), below)
  })
}

test('the filesystem root contains its descendants but is not below itself', () => {
  const root = parse(folder).root
  assert.equal(isWithin(root, folder), true)
  assert.equal(isBelow(root, folder), true)
  assert.equal(isWithin(root, root), true)
  assert.equal(isBelow(root, root), false)
})
