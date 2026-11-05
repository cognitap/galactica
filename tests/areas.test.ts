import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areasOf } from '../src/areas.ts'
import { ConfigError } from '../src/config.ts'
import { emptyConfig, MODEL_FORMAT, type Config, type Model, type RepoPath } from '../src/model.ts'
import { loaded, validConfigs } from './config-examples.ts'

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

const areas = (model: Model, config: Config = emptyConfig) =>
  Object.fromEntries([...areasOf(model, config)].map(([path, { area }]) => [path, area]))

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
  assert.deepEqual(Object.fromEntries(areasOf(model, emptyConfig)), {
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

test('a module the config places joins the area of the first glob it matches', t => {
  const model = modelOf({ acme: '.' }, [
    'src/cn.ts',
    'src/index.ts',
    'src/components/Button/Button.tsx',
    'src/components/Button/Button.stories.tsx',
    'src/components/Kbd/Kbd.tsx'
  ])
  assert.deepEqual(areas(model, loaded(t, validConfigs.areaOrder)), {
    'src/cn.ts': 'src',
    'src/index.ts': 'src',
    'src/components/Button/Button.tsx': 'src/components',
    'src/components/Button/Button.stories.tsx': 'src/stories',
    'src/components/Kbd/Kbd.tsx': 'src/components'
  })
})

test('an area outside the package of a module it places makes the config invalid', t => {
  const model = modelOf({ acme: '.', ui: 'packages/ui' }, ['packages/ui/src/a.ts', 'scripts/a.ts'])
  for (const [config, message] of [
    [
      validConfigs.areaOutsidePackage,
      'areas["packages/ui/**"]: src is not in package ui (packages/ui), the package of packages/ui/src/a.ts'
    ],
    [
      validConfigs.areaInNestedPackage,
      'areas["scripts/**"]: packages/ui is not in package acme (.), the package of scripts/a.ts'
    ]
  ] as const) {
    assert.throws(
      () => areasOf(model, loaded(t, config)),
      error => error instanceof ConfigError && error.message === `galactica.config.json: ${message}`
    )
  }
})
