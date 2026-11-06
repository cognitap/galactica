import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { emptyConfig } from '../src/model.ts'
import { pageData } from '../src/page-data.ts'
import { edge, modelOf } from './models.ts'

test('areas are ordered by the imports of source and config, which the map shows first', () => {
  const data = pageData(
    graphOf(
      modelOf({
        'src/a/a.ts': {},
        'src/b/b.ts': {},
        'src/x/x.ts': { edges: [edge('src/b/b.ts')] },
        'src/y/y.ts': { edges: [edge('src/a/a.ts')] },
        // Tests import across both, which would tie x and y if they counted.
        'src/x/x.test.ts': { edges: [edge('src/a/a.ts')] },
        'src/y/y.test.ts': { edges: [edge('src/b/b.ts')] }
      }),
      emptyConfig
    )
  )
  const rows = data.packages[0]!.rows.map(row => row.map(area => data.areas[area]!.path))
  assert.deepEqual(rows, [
    ['src/y', 'src/x'],
    ['src/a', 'src/b']
  ])
})
