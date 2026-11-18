import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeRepository } from '../src/analysis.ts'
import {
  acceptFindings,
  fileOf,
  formatAccepted,
  parseAccepted,
  type AcceptedFile
} from '../src/accepted-health.ts'
import { SCHEMA_VERSION, type Health } from '../src/contract.ts'
import { graphOf } from '../src/graph.ts'
import { health } from '../src/health.ts'
import { emptyConfig } from '../src/model.ts'
import { pageData } from '../src/page-data.ts'
import { render } from '../src/render.ts'
import { fixtureRepo } from './fixtures.ts'

const found: Health = {
  schemaVersion: SCHEMA_VERSION,
  command: 'health',
  cycles: [
    {
      modules: ['src/b.ts', 'src/a.ts'],
      loadTime: false,
      imports: [
        {
          from: 'src/a.ts',
          to: 'src/b.ts',
          line: 1,
          names: ['b'],
          via: [],
          use: 'later',
          break: true
        }
      ]
    }
  ],
  oversizedAreas: [{ path: 'src/ui', package: 'app', modules: 24, median: 3 }],
  internalImports: [
    {
      from: 'src/main.ts',
      line: 8,
      specifier: '../ui/src/private',
      names: ['Button'],
      reach: 'relative',
      package: 'ui'
    }
  ]
}

const recorded = (): AcceptedFile => fileOf(found)

test('accept records each finding once, in a stable order', () => {
  const file = recorded()
  assert.deepEqual(file, {
    version: 1,
    cycles: [['src/a.ts', 'src/b.ts']],
    areas: [{ path: 'src/ui', modules: 24 }],
    imports: [{ from: 'src/main.ts', specifier: '../ui/src/private', names: ['Button'] }]
  })
  assert.deepEqual(parseAccepted(formatAccepted(file)), file)
})

test('a finding stays accepted until its identity changes', () => {
  const hidden = acceptFindings(found, recorded())
  assert.equal(hidden.accepted, 3)
  assert.deepEqual(hidden.cycles, [])
  assert.deepEqual(hidden.oversizedAreas, [])
  assert.deepEqual(hidden.internalImports, [])
  assert.match(render(hidden), /3 findings accepted$/)

  const grown = acceptFindings(
    {
      ...found,
      cycles: [{ ...found.cycles[0]!, modules: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }],
      oversizedAreas: [{ ...found.oversizedAreas[0]!, modules: 25, median: 9 }],
      internalImports: [{ ...found.internalImports[0]!, line: 40, names: ['Button', 'Icon'] }]
    },
    recorded()
  )
  assert.equal(grown.accepted, 0)
  assert.equal(grown.cycles.length, 1)
  assert.equal(grown.oversizedAreas[0]?.modules, 25)
  assert.deepEqual(grown.internalImports[0]?.names, ['Button', 'Icon'])

  const moved = acceptFindings(
    {
      ...found,
      cycles: [
        {
          ...found.cycles[0]!,
          modules: ['src/a.ts', 'src/b.ts'],
          imports: [{ ...found.cycles[0]!.imports[0]!, line: 12 }]
        }
      ],
      internalImports: [{ ...found.internalImports[0]!, line: 2 }]
    },
    recorded()
  )
  assert.equal(moved.accepted, 3)
})

test('a record that matches nothing is not counted', () => {
  const file = recorded()
  const gone = acceptFindings(
    { ...found, cycles: [], oversizedAreas: [], internalImports: [] },
    file
  )
  assert.equal(gone.accepted, 0)
  assert.match(render(gone), /0 findings accepted$/)
})

test('the page leaves out the same findings and keeps the count', () => {
  const graph = graphOf(
    analyzeRepository(fixtureRepo('internal-imports'), emptyConfig).model,
    emptyConfig
  )
  const listed = health(graph, undefined)
  const file = fileOf(listed)
  const page = pageData(graph, null, undefined, file)
  assert.equal(page.health.cycles.length, 0)
  assert.equal(page.health.oversized.length, 0)
  assert.equal(page.health.internal.length, 0)
  assert.equal(
    page.health.accepted,
    listed.cycles.length + listed.oversizedAreas.length + listed.internalImports.length
  )
  assert.ok((page.health.accepted ?? 0) > 0)
})

test('the accepted file rejects a version, key or duplicate it does not know', () => {
  assert.deepEqual(parseAccepted('{"version":2,"cycles":[],"areas":[],"imports":[]}'), {
    problem: 'galactica-health.json: version 2 is not supported'
  })
  const extra = parseAccepted('{"version":1,"cycles":[],"areas":[],"imports":[],"extra":true}')
  if (!('problem' in extra)) assert.fail('extra')
  assert.equal(extra.problem, 'galactica-health.json: unknown key extra')
  const duplicate = parseAccepted(
    '{"version":1,"cycles":[["src/a.ts"],["src/a.ts"]],"areas":[],"imports":[]}'
  )
  if (!('problem' in duplicate)) assert.fail('duplicate')
  assert.equal(duplicate.problem, 'galactica-health.json.cycles: duplicate')
  const broken = parseAccepted('{')
  if (!('problem' in broken)) assert.fail('broken')
  assert.match(broken.problem, /^invalid JSON:/)
})
