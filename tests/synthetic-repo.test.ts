import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { syntheticRepository, writeRepository } from '../scripts/synthetic-repo.ts'
import { analyzeRepository } from '../src/analysis.ts'
import { emptyConfig } from '../src/model.ts'

const small = { modules: 90, packages: 3, seed: 1 }

test('the same options give the same files, and another seed different ones', () => {
  assert.deepEqual(syntheticRepository(small), syntheticRepository(small))
  assert.notDeepEqual(syntheticRepository(small), syntheticRepository({ ...small, seed: 2 }))
})

test('a small repository has exactly the modules asked for and maps without warnings', t => {
  const root = mkdtempSync(join(tmpdir(), 'galactica-synthetic-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeRepository(root, syntheticRepository(small))
  const { model, summary } = analyzeRepository(root, emptyConfig)
  const modules = Object.values(model.modules)
  assert.equal(modules.length, small.modules)
  assert.equal(Object.keys(model.packages).length, small.packages)
  assert.deepEqual(summary.warnings, [])
  assert.equal(summary.unresolved, 0)
  const edges = modules.flatMap(module => module.edges)
  assert.ok(
    edges.some(edge => edge.via.length > 0),
    'some imports pass through a barrel'
  )
  assert.ok(
    edges.some(edge => edge.to.kind === 'module' && edge.to.path.startsWith('packages/pkg0/')),
    'some modules import another package'
  )
})
