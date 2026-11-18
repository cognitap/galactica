import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  check,
  committedMapNote,
  formatMap,
  mapOf,
  parseMap,
  type CommittedMap
} from '../src/committed-map.ts'
import { render } from '../src/render.ts'
import { graphOf } from '../src/graph.ts'
import { emptyConfig } from '../src/model.ts'
import { edge, modelOf } from './models.ts'

const graph = graphOf(
  modelOf({
    'src/a.ts': {},
    'src/b.ts': {},
    'src/ui/c.ts': { edges: [edge('src/a.ts')] },
    'src/ui/d.ts': {}
  }),
  emptyConfig
)

const map: CommittedMap = {
  version: 1,
  packages: [
    {
      name: 'acme',
      dir: '.',
      layer: 0,
      areas: [
        {
          path: 'src',
          layer: 0,
          modules: ['src/a.ts', 'src/b.ts'],
          dependsOn: []
        },
        {
          path: 'src/ui',
          layer: 1,
          modules: ['src/ui/c.ts', 'src/ui/d.ts'],
          dependsOn: ['src']
        }
      ]
    }
  ]
}

test('the committed map lists packages, areas, layers and the areas they import', () => {
  assert.deepEqual(mapOf(graph), map)
  assert.equal(formatMap(mapOf(graph)), formatMap(map))
})

test('a same-area import does not change the map', () => {
  const linked = graphOf(
    modelOf({
      'src/a.ts': {},
      'src/b.ts': { edges: [edge('src/a.ts')] },
      'src/ui/c.ts': { edges: [edge('src/a.ts')] },
      'src/ui/d.ts': {}
    }),
    emptyConfig
  )
  assert.deepEqual(mapOf(linked), map)
})

test('parse accepts another key order and rejects a shape it does not know', () => {
  const reordered = {
    packages: map.packages.map(pkg => ({
      areas: pkg.areas.map(area => ({
        dependsOn: area.dependsOn,
        modules: area.modules,
        layer: area.layer,
        path: area.path
      })),
      layer: pkg.layer,
      dir: pkg.dir,
      name: pkg.name
    })),
    version: 1
  }
  const parsed = parseMap(JSON.stringify(reordered))
  if ('problem' in parsed) assert.fail(parsed.problem)
  assert.equal(formatMap(parsed), formatMap(map))
  assert.deepEqual(parseMap('{"version":2,"packages":[]}'), {
    problem: 'galactica-map.json: version 2 is not supported'
  })
  const extra = parseMap('{"version":1,"packages":[],"extra":true}')
  if (!('problem' in extra)) assert.fail('extra')
  assert.equal(extra.problem, 'galactica-map.json: unknown key extra')
  const broken = parseMap('{')
  assert.ok('problem' in broken)
  assert.match(broken.problem, /^invalid JSON:/)
})

test('check names an area whose modules or dependencies changed', () => {
  const read = { status: 'ready' as const, map }
  const added = graphOf(
    modelOf({
      'src/a.ts': {},
      'src/b.ts': {},
      'src/c.ts': {},
      'src/ui/c.ts': { edges: [edge('src/a.ts')] },
      'src/ui/d.ts': {}
    }),
    emptyConfig
  )
  const modules = check(added, read)
  assert.equal(modules.command, 'check')
  if ('error' in modules) assert.fail('modules')
  assert.equal(modules.stale, true)
  assert.deepEqual(modules.areas, [{ path: 'src', package: 'acme', change: 'changed' }])
  assert.equal(
    render(modules),
    ['galactica-map.json differs from the repository', 'src (acme): changed'].join('\n')
  )

  const unlinked = graphOf(
    modelOf({
      'src/a.ts': {},
      'src/b.ts': {},
      'src/ui/c.ts': {},
      'src/ui/d.ts': {}
    }),
    emptyConfig
  )
  const dependencies = check(unlinked, read)
  if ('error' in dependencies) assert.fail('dependencies')
  assert.deepEqual(dependencies.areas, [{ path: 'src/ui', package: 'acme', change: 'changed' }])

  const matched = check(graph, read)
  if ('error' in matched) assert.fail('match')
  assert.equal(matched.stale, false)
  assert.equal(render(matched), 'galactica-map.json matches the repository')
  assert.equal(committedMapNote(graph, read), undefined)
  assert.equal(
    committedMapNote(added, read),
    'committed map galactica-map.json is stale; run check'
  )
})

test('check fails when there is no committed map, and ignores one that is absent', () => {
  const missing = check(graph, undefined)
  assert.equal(render(missing), 'galactica: no committed map at galactica-map.json; run snapshot')
  assert.equal(committedMapNote(graph, { status: 'absent' }), undefined)
  assert.equal(
    committedMapNote(graph, { status: 'unreadable', message: 'committed map could not be read' }),
    'committed map could not be read'
  )
})
