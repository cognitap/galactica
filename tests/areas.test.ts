import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areasOf } from '../src/areas.ts'
import { MODEL_FORMAT, type Model, type RepoPath } from '../src/model.ts'

function modelOf(packages: Readonly<Record<string, string>>, paths: readonly string[]): Model {
  return {
    format: MODEL_FORMAT,
    repository: { name: 'acme' },
    packages: Object.fromEntries(
      Object.entries(packages).map(([name, dir]) => [name, { dir: dir as RepoPath }])
    ) as Model['packages'],
    modules: Object.fromEntries(
      paths.map(path => [path, { path: path as RepoPath, hash: 'h', symbols: [], edges: [] }])
    )
  }
}

const areas = (model: Model) =>
  Object.fromEntries([...areasOf(model)].map(([path, { area }]) => [path, area]))

test('each folder of several modules is an area', () => {
  const model = modelOf({ acme: '.' }, [
    'src/a/one.ts',
    'src/a/two.ts',
    'src/b/one.ts',
    'src/b/two.ts'
  ])
  assert.deepEqual(areas(model), {
    'src/a/one.ts': 'src/a',
    'src/a/two.ts': 'src/a',
    'src/b/one.ts': 'src/b',
    'src/b/two.ts': 'src/b'
  })
})

test('a single-module folder joins its parent, repeatedly, when the parent holds modules', () => {
  const model = modelOf({ acme: '.' }, ['src/a.ts', 'src/b.ts', 'src/x/y.ts', 'src/x/z/w.ts'])
  assert.equal(areas(model)['src/x/y.ts'], 'src')
  assert.equal(areas(model)['src/x/z/w.ts'], 'src')
})

test('a single-module folder under a folder of folders stays an area', () => {
  const model = modelOf({ acme: '.' }, ['src/cn.ts', 'src/index.ts', 'src/ui/Button/Button.tsx'])
  assert.equal(areas(model)['src/ui/Button/Button.tsx'], 'src/ui/Button')
})

test('merging stops at the package directory, which is an area itself', () => {
  const model = modelOf({ acme: '.', ui: 'lib/ui' }, [
    'lib/a.ts',
    'lib/b.ts',
    'lib/ui/index.ts',
    'lib/ui/src/Button.tsx'
  ])
  assert.deepEqual(Object.fromEntries(areasOf(model)), {
    'lib/a.ts': { package: 'acme', area: 'lib' },
    'lib/b.ts': { package: 'acme', area: 'lib' },
    'lib/ui/index.ts': { package: 'ui', area: 'lib/ui' },
    'lib/ui/src/Button.tsx': { package: 'ui', area: 'lib/ui' }
  })
})

test('the root package directory is the area "."', () => {
  const model = modelOf({ acme: '.' }, ['main.ts', 'tools/build.ts'])
  assert.deepEqual(areas(model), { 'main.ts': '.', 'tools/build.ts': '.' })
})
