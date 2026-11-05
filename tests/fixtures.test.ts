import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { test } from 'node:test'
import { languages, moduleKinds, symbolKinds } from '../src/contract.ts'
import { analyzeRepository } from '../src/analysis.ts'
import {
  emptyConfig,
  MODEL_FORMAT,
  parseRepoPath,
  type Model,
  type RepoPath,
  type Target
} from '../src/model.ts'
import {
  aspects,
  fixtureCases,
  fixtureRepo,
  readExpected,
  staleExpected,
  statusOf
} from './fixtures.ts'

const cases = [
  'plain-relative',
  'tsconfig-paths',
  'barrels',
  'cycle',
  'javascript',
  'allowjs-mixed',
  'type-only-and-dynamic',
  'react-components',
  'tests-and-stories',
  'package-self-reference',
  'paths-over-package',
  'paths-catch-all',
  'import-query',
  'commonjs',
  'monorepo',
  'vue',
  'svelte',
  'astro'
]

const mapped = new Set<string>(languages)
const frameworks = new Set(['vue', 'svelte', 'astro'])
const importLine = /\bfrom\s*['"]|\bimport\s*['"]|\bimport\s*\(|\brequire\s*\(/

function mappedFiles(repo: string, dir = repo): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : mappedFiles(repo, path)
    return mapped.has(extname(entry.name).slice(1))
      ? [relative(repo, path).split('\\').join('/')]
      : []
  })
}

function sorted<T>(items: readonly T[], key: (item: T) => string | number = String): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
}

function targetKey(target: Target): string {
  if (target.kind === 'module') return target.path
  if (target.kind === 'external') return target.name
  return target.specifier
}

function sourceLine(repo: string, path: string, line: number): string {
  const text = readFileSync(join(repo, path), 'utf8').split('\n')
  assert.ok(line >= 1 && line <= text.length, `${path}:${line} is outside the file`)
  return text[line - 1] ?? ''
}

function packageName(repo: string, dir: string): unknown {
  return JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8')).name
}

test('every listed case has a fixture, and every fixture is listed', () => {
  assert.deepEqual(fixtureCases(), sorted(cases))
})

for (const name of cases) {
  const repo = fixtureRepo(name)
  const files = readExpected(name)
  const expected = files.model
  const modules = Object.values(expected.modules)

  test(`${name}: modules are exactly the mapped files, with normalized sorted keys`, () => {
    assert.equal(expected.format, MODEL_FORMAT)
    const keys = Object.keys(expected.modules)
    assert.deepEqual(keys, sorted(keys), 'modules keys are not sorted')
    assert.deepEqual(keys, sorted(mappedFiles(repo)))
    for (const [key, facts] of Object.entries(expected.modules)) {
      assert.equal(parseRepoPath(key), key, `${key} is not a normalized path`)
      assert.equal(facts.path, key, `${key} holds facts for ${facts.path}`)
    }
  })

  test(`${name}: packages match their package.json and contain every module`, () => {
    assert.equal(expected.repository.name, packageName(repo, '.'))
    const dirs = Object.entries(expected.packages).map(([pkg, { dir }]) => {
      assert.equal(parseRepoPath(dir), dir, `${pkg} has an unnormalized dir ${dir}`)
      assert.equal(packageName(repo, dir), pkg, `${dir}/package.json does not name ${pkg}`)
      return dir
    })
    for (const { path } of modules) {
      assert.ok(
        dirs.some(dir => dir === '.' || path.startsWith(`${dir}/`)),
        `${path} is in no package`
      )
    }
  })

  test(`${name}: symbols are in line order and point at their declarations`, () => {
    for (const { path, symbols } of modules) {
      const lines = symbols.map(symbol => symbol.line)
      assert.deepEqual(lines, sorted(lines, Number), `${path} symbols are not in line order`)
      for (const symbol of symbols) {
        const where = `${path}:${symbol.line} ${symbol.name}`
        assert.ok(symbolKinds.includes(symbol.kind), `${where} has unknown kind ${symbol.kind}`)
        assert.match(
          symbol.signature,
          /^((async|declare|abstract) )*(function|class|interface|type|enum|const|let|var|component)\b[^\n]*$/,
          `${where} signature is not one declaration line`
        )
        if (symbol.doc !== undefined) assert.match(symbol.doc, /^[^\n]+$/, `${where} doc`)
        const line = sourceLine(repo, path, symbol.line)
        if (frameworks.has(extname(path).slice(1)) && symbol.default) {
          assert.equal(
            symbol.name,
            basename(path, extname(path)),
            `${where} is not named after its file`
          )
          assert.equal(symbol.line, 1, `${where} is an implicit export, so its line is 1`)
        } else {
          assert.ok(
            line.includes(symbol.name),
            `${where} points at a line without the name: ${line}`
          )
        }
      }
    }
  })

  test(`${name}: edges are sorted and point at their imports and at known modules`, () => {
    for (const { path, edges } of modules) {
      const keys = edges.map(edge => `${String(edge.line).padStart(6, '0')} ${targetKey(edge.to)}`)
      assert.deepEqual(keys, sorted(keys), `${path} edges are not sorted by line, then target`)
      for (const edge of edges) {
        const where = `${path}:${edge.line} -> ${targetKey(edge.to)}`
        const line = sourceLine(repo, path, edge.line)
        assert.match(line, importLine, `${where} points at a line without an import: ${line}`)
        assert.deepEqual(edge.names, sorted(edge.names), `${where} names are not sorted`)
        if (edge.form === 'reexport') assert.match(line, /\bexport\b/, `${where} reexport`)
        if (edge.dynamic) assert.match(line, /\bimport\s*\(/, `${where} dynamic`)
        if (edge.renames) assert.equal(edge.form, 'reexport', `${where} renames on an import`)
        if (edge.to.kind === 'module') {
          assert.ok(edge.to.path in expected.modules, `${where} targets a path that is no module`)
        } else if (edge.via.length === 0) {
          assert.ok(line.includes(targetKey(edge.to)), `${where} is not on its line: ${line}`)
        }
        for (const barrel of edge.via) {
          assert.ok(barrel in expected.modules, `${where} goes via ${barrel}, which is no module`)
        }
      }
    }
  })

  const graph = files.graph
  if (graph) {
    test(`${name}: expected-graph.json names known modules and packages`, () => {
      const paths = Object.keys(expected.modules)
      if (graph.kinds) {
        assert.deepEqual(Object.keys(graph.kinds), paths, 'kinds must list every module in order')
        for (const kind of Object.values(graph.kinds)) assert.ok(moduleKinds.includes(kind), kind)
      }
      if (graph.areas) {
        assert.deepEqual(
          graph.areas.map(area => area.path),
          sorted(graph.areas.map(area => area.path)),
          'areas are not sorted by path'
        )
        for (const area of graph.areas) {
          assert.ok(area.package in expected.packages, `${area.path} is in unknown ${area.package}`)
          assert.deepEqual(
            area.modules,
            sorted(area.modules),
            `${area.path} modules are not sorted`
          )
        }
        assert.deepEqual(sorted(graph.areas.flatMap(area => area.modules)), paths)
      }
      const cycles = graph.cycles ?? []
      assert.deepEqual(
        cycles,
        sorted(cycles, cycle => cycle[0] ?? ''),
        'cycles are not sorted'
      )
      for (const cycle of cycles) {
        assert.deepEqual(cycle, sorted(cycle), `cycle ${cycle.join(', ')} is not sorted`)
        for (const path of cycle) assert.ok(path in expected.modules, `${path} is no module`)
      }
    })
  }

  test(`${name}: expected files are written as fixtures:update writes them`, () => {
    assert.deepEqual(staleExpected(name, files), [])
  })

  let model: Model | undefined
  for (const aspect of aspects.filter(aspect => aspect.stated(files))) {
    const status = statusOf(aspect, name)
    const title = `${name}: ${aspect.name} match the analyzer`
    if ('pending' in status) {
      test(title, { todo: `pending until ${status.pending}` })
    } else {
      test(title, () =>
        status.compare(files, (model ??= analyzeRepository(repo, emptyConfig).model))
      )
    }
  }
}

test('an implemented aspect fails on any difference and updates to the analyzer output', () => {
  const name = 'plain-relative'
  const files = readExpected(name)
  const { model } = analyzeRepository(fixtureRepo(name), emptyConfig)
  const extra = 'src/extra.ts' as RepoPath
  const changed = {
    ...files,
    model: {
      ...files.model,
      modules: { ...files.model.modules, [extra]: { path: extra, symbols: [], edges: [] } }
    }
  }
  const check = statusOf(
    aspects.find(aspect => aspect.name === 'files')!,
    name
  )
  assert.ok(!('pending' in check))
  assert.throws(() => check.compare(changed, model), /src\/extra\.ts/)
  assert.deepStrictEqual(check.update(changed, model), files)
})
