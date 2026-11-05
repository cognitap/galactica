import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Cycle } from '../src/contract.ts'
import { cycles } from '../src/cycles.ts'
import { graphOf } from '../src/graph.ts'
import { emptyConfig, type RepoPath } from '../src/model.ts'
import { deps, uses } from '../src/queries.ts'
import { stronglyConnected, adjacency } from '../src/strongly-connected.ts'
import { edge, modelOf, type Spec } from './models.ts'

const listed = (specs: Readonly<Record<string, Spec>>) =>
  cycles(graphOf(modelOf(specs), emptyConfig)).cycles

const breaks = (cycle: Cycle) =>
  cycle.imports.filter(entry => entry.break).map(({ from, to }) => `${from} -> ${to}`)

test('a cycle lists its modules in dependency order and every import between them, sorted', () => {
  const [cycle, ...rest] = listed({
    'a.ts': { edges: [edge('b.ts', { line: 2, names: ['b1', 'b2'] })] },
    'b.ts': {
      edges: [edge('c.ts', { names: ['c1', 'c2'] }), edge('a.ts', { line: 3, names: ['a'] })]
    },
    'c.ts': { edges: [edge('a.ts', { names: ['a1', 'a2', 'a3'] })] },
    'd.ts': { edges: [edge('a.ts')] }
  })
  assert.deepEqual(rest, [])
  assert.deepEqual(cycle, {
    modules: ['b.ts', 'c.ts', 'a.ts'],
    loadTime: false,
    imports: [
      {
        from: 'a.ts',
        to: 'b.ts',
        line: 2,
        names: ['b1', 'b2'],
        via: [],
        use: 'later',
        break: true
      },
      {
        from: 'b.ts',
        to: 'c.ts',
        line: 1,
        names: ['c1', 'c2'],
        via: [],
        use: 'later',
        break: false
      },
      { from: 'b.ts', to: 'a.ts', line: 3, names: ['a'], via: [], use: 'later', break: false },
      {
        from: 'c.ts',
        to: 'a.ts',
        line: 1,
        names: ['a1', 'a2', 'a3'],
        via: [],
        use: 'later',
        break: false
      }
    ]
  })
})

test('the import to break brings in the fewest names, a side-effect import none', () => {
  const [loop] = listed({
    'a.ts': { edges: [edge('b.ts', { names: ['x', 'y'] })] },
    'b.ts': { edges: [edge('c.ts', { names: ['x'] })] },
    'c.ts': { edges: [edge('a.ts', { names: ['x', 'y', 'z'] })] }
  })
  assert.deepEqual(breaks(loop!), ['b.ts -> c.ts'])
  const [sideEffect] = listed({
    'a.ts': { edges: [edge('b.ts', { names: [] })] },
    'b.ts': { edges: [edge('a.ts', { names: ['x'] })] }
  })
  assert.deepEqual(breaks(sideEffect!), ['a.ts -> b.ts'])
})

test('an import used at load time is kept over any number of names used later', () => {
  const [cycle] = listed({
    'a.ts': { edges: [edge('b.ts', { names: ['x'], loadTime: ['x'] })] },
    'b.ts': { edges: [edge('a.ts', { names: ['p', 'q', 'r'] })] }
  })
  assert.deepEqual(cycle!.modules, ['a.ts', 'b.ts'])
  assert.deepEqual(breaks(cycle!), ['b.ts -> a.ts'])
  assert.equal(cycle!.loadTime, true)
  assert.deepEqual(
    cycle!.imports.map(({ use }) => use),
    ['load-time', 'later']
  )
})

test('of two imports that cost the same, the one into the module fewer others import is cut', () => {
  const [cycle] = listed({
    'app.ts': { edges: [edge('shared.ts')] },
    'other.ts': { edges: [edge('shared.ts')] },
    'shared.ts': { edges: [edge('app.ts')] }
  })
  assert.deepEqual(cycle!.modules, ['app.ts', 'shared.ts'])
  assert.deepEqual(breaks(cycle!), ['shared.ts -> app.ts'])
})

test('cycles used at load time come first, type-only imports and re-exports close none', () => {
  const found = listed({
    'a.ts': { edges: [edge('b.ts')] },
    'b.ts': { edges: [edge('a.ts')] },
    'c.ts': { edges: [edge('d.ts', { loadTime: ['x'] })] },
    'd.ts': { edges: [edge('c.ts')] },
    'types/a.ts': { edges: [edge('types/b.ts', { typeOnly: true })] },
    'types/b.ts': { edges: [edge('types/a.ts')] },
    'reexport/a.ts': { edges: [edge('reexport/b.ts', { form: 'reexport' })] },
    'reexport/b.ts': { edges: [edge('reexport/a.ts')] }
  })
  assert.deepEqual(
    found.map(({ modules, loadTime }) => [modules.toSorted(), loadTime]),
    [
      [['c.ts', 'd.ts'], true],
      [['a.ts', 'b.ts'], false]
    ]
  )
})

/** A deterministic pseudo-random sequence, so a failure reproduces. */
function* random(seed: number): Generator<number> {
  let state = seed
  while (true) {
    state = (state * 1103515245 + 12345) % 2 ** 31
    yield state / 2 ** 31
  }
}

test('cutting every import marked break leaves no cycle among the modules', () => {
  const next = random(7)
  const draw = () => next.next().value as number
  for (let round = 0; round < 50; round++) {
    const count = 3 + Math.floor(draw() * 25)
    const specs: Record<string, Spec> = {}
    for (let index = 0; index < count; index++) {
      const edges = []
      for (let target = 0; target < count; target++) {
        if (target === index || draw() > 0.15) continue
        const names = ['a', 'b', 'c', 'd'].slice(0, Math.floor(draw() * 5))
        const loadTime = names.length > 0 && draw() < 0.2 ? [names[0]!] : undefined
        edges.push(edge(`m${target}.ts`, { names, ...(loadTime ? { loadTime } : {}) }))
      }
      specs[`m${index}.ts`] = { edges }
    }
    for (const cycle of listed(specs)) {
      const kept = cycle.imports
        .filter(entry => !entry.break)
        .map(({ from, to }) => [from, to] as const)
      const components = stronglyConnected(
        cycle.modules as RepoPath[],
        adjacency(kept as [RepoPath, RepoPath][])
      )
      assert.ok(
        components.every(component => component.length === 1),
        `round ${round}`
      )
      for (const { from, to, break: cut } of cycle.imports) {
        assert.equal(cut, cycle.modules.indexOf(from) > cycle.modules.indexOf(to))
      }
    }
  }
})

test('uses and deps list the cycles a module of the subject is in, and none otherwise', () => {
  const graph = graphOf(
    modelOf({
      'src/a.ts': { edges: [edge('src/b.ts')] },
      'src/b.ts': { edges: [edge('src/a.ts')] },
      'src/c.ts': { edges: [edge('src/a.ts')] }
    }),
    emptyConfig
  )
  const all = cycles(graph).cycles
  const usesOf = (subject: string) => {
    const result = uses(graph, subject, '.' as RepoPath, 1)
    return 'error' in result ? undefined : result.cycles
  }
  const depsOf = (subject: string) => {
    const result = deps(graph, subject, '.' as RepoPath, 1)
    return 'error' in result ? undefined : result.cycles
  }
  assert.deepEqual(usesOf('src/a.ts'), all)
  assert.deepEqual(depsOf('src/b.ts'), all)
  assert.deepEqual(depsOf('src'), all)
  assert.deepEqual(usesOf('src/c.ts'), [])
  assert.deepEqual(depsOf('src/c.ts'), [])
})
