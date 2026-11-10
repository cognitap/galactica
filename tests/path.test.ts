import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Path } from '../src/contract.ts'
import { graphOf } from '../src/graph.ts'
import { emptyConfig, type RepoPath } from '../src/model.ts'
import { PATH_LIMIT, importPath } from '../src/path.ts'
import { render } from '../src/render.ts'
import { edge, edgeTo, modelOf, type Spec } from './models.ts'

const graph = (specs: Readonly<Record<string, Spec>>) => graphOf(modelOf(specs), emptyConfig)

function ask(
  specs: Readonly<Record<string, Spec>>,
  from: string,
  to: string,
  all = false,
  cwd?: RepoPath
): Path {
  const result = importPath(graph(specs), from, to, cwd, all)
  assert.ok(!('error' in result), JSON.stringify(result))
  return result
}

const chain = {
  'src/a.ts': {
    edges: [
      edge('src/b.ts', { line: 1, names: ['left'] }),
      edge('src/z.ts', { line: 4, names: ['direct'] })
    ]
  },
  'src/b.ts': { edges: [edge('src/z.ts', { line: 2, names: ['right'] })] },
  'src/m.ts': { edges: [edge('src/z.ts', { names: ['later'] })] },
  'src/z.ts': {}
} satisfies Readonly<Record<string, Spec>>

test('path prints the shortest import chain', () => {
  const result = ask(chain, 'src/a.ts', 'src/z.ts')
  assert.equal(result.all, false)
  assert.equal(result.truncated, false)
  assert.deepEqual(
    result.chains.map(entry => entry.modules),
    [['src/a.ts', 'src/z.ts']]
  )
  assert.deepEqual(result.chains[0]?.steps, [
    { from: 'src/a.ts', to: 'src/z.ts', line: 4, names: ['direct'], via: [] }
  ])
  assert.equal(
    render(result),
    ['src/a.ts reaches src/z.ts in 1 import:', 'src/a.ts:4 -> src/z.ts  direct'].join('\n')
  )
})

test('path --all lists every simple chain, shortest first, and stops at the limit', () => {
  const specs: Record<string, Spec> = {
    'src/a.ts': { edges: [edge('src/z.ts', { line: 1, names: ['direct'] })] },
    'src/z.ts': {}
  }
  for (let index = 0; index <= PATH_LIMIT; index += 1) {
    const middle = `src/m${String(index).padStart(2, '0')}.ts`
    specs['src/a.ts'] = {
      edges: [...(specs['src/a.ts']?.edges ?? []), edge(middle, { line: index + 2 })]
    }
    specs[middle] = { edges: [edge('src/z.ts')] }
  }
  const result = ask(specs, 'src/a.ts', 'src/z.ts', true)
  assert.equal(PATH_LIMIT, 20)
  assert.equal(result.chains.length, PATH_LIMIT)
  assert.equal(result.truncated, true)
  assert.deepEqual(result.chains[0]?.modules, ['src/a.ts', 'src/z.ts'])
  assert.deepEqual(result.chains[1]?.modules, ['src/a.ts', 'src/m00.ts', 'src/z.ts'])
  assert.equal(result.chains.at(-1)?.modules[1], 'src/m18.ts')
  assert.match(render(result), /more chains exist than this list shows/)
})

test('a chain of two imports prints each step', () => {
  const result = ask(
    {
      'src/a.ts': { edges: [edge('src/b.ts', { line: 1, names: ['b'] })] },
      'src/b.ts': { edges: [edge('src/c.ts', { line: 2, names: ['c'] })] },
      'src/c.ts': {}
    },
    'src/a.ts',
    'src/c.ts'
  )
  assert.equal(
    render(result),
    [
      'src/a.ts reaches src/c.ts in 2 imports:',
      'src/a.ts:1 -> src/b.ts  b',
      'src/b.ts:2 -> src/c.ts  c'
    ].join('\n')
  )
})

test('path follows a cycle once and says when nothing reaches the target', () => {
  const specs = {
    'src/a.ts': { edges: [edge('src/b.ts'), edge('src/c.ts', { names: ['c'] })] },
    'src/b.ts': { edges: [edge('src/a.ts')] },
    'src/c.ts': {}
  }
  assert.deepEqual(
    ask(specs, 'src/a.ts', 'src/c.ts', true).chains.map(entry => entry.modules),
    [['src/a.ts', 'src/c.ts']]
  )
  const none = ask(specs, 'src/c.ts', 'src/a.ts')
  assert.deepEqual(none.chains, [])
  assert.equal(none.truncated, false)
  assert.equal(render(none), 'no import chain from src/c.ts to src/a.ts')
})

test('the same module is a chain of that module alone, not a search for a cycle', () => {
  const specs = {
    'src/a.ts': { edges: [edge('src/a.ts', { line: 3, names: ['self'] })] }
  }
  const result = ask(specs, 'src/a.ts', 'src/a.ts', true)
  assert.deepEqual(result.chains, [{ modules: ['src/a.ts'], steps: [] }])
  assert.equal(render(result), 'src/a.ts is the same module')
})

test('several imports of one module count as one step, the earliest, names sorted', () => {
  const result = ask(
    {
      'src/a.ts': {
        edges: [
          edge('src/b.ts', { line: 9, names: ['later'] }),
          edge('src/b.ts', { line: 2, names: ['b', 'a'] })
        ]
      },
      'src/b.ts': {}
    },
    'src/a.ts',
    'src/b.ts'
  )
  assert.deepEqual(result.chains[0]?.steps, [
    { from: 'src/a.ts', to: 'src/b.ts', line: 2, names: ['a', 'b'], via: [] }
  ])
})

test('a barrel stays on the step that passes through it, and type-only imports count', () => {
  const result = ask(
    {
      'src/a.ts': {
        edges: [
          edge('src/c.ts', { line: 3, names: ['C'], via: ['src/b.ts' as RepoPath], typeOnly: true })
        ]
      },
      'src/b.ts': {},
      'src/c.ts': {}
    },
    'src/a.ts',
    'src/c.ts'
  )
  assert.deepEqual(result.chains[0]?.modules, ['src/a.ts', 'src/c.ts'])
  assert.deepEqual(result.chains[0]?.steps[0]?.via, ['src/b.ts'])
})

test('external and unresolved imports are not steps', () => {
  const result = ask(
    {
      'src/a.ts': {
        edges: [
          edgeTo({ kind: 'external', name: 'react' }, { line: 1 }),
          edgeTo({ kind: 'unresolved', specifier: './gone' }, { line: 2 }),
          edge('src/b.ts', { line: 3, names: [] })
        ]
      },
      'src/b.ts': {}
    },
    'src/a.ts',
    'src/b.ts'
  )
  assert.equal(
    render(result),
    ['src/a.ts reaches src/b.ts in 1 import:', 'src/a.ts:3 -> src/b.ts  side effect only'].join(
      '\n'
    )
  )
})

test('a path reads each argument from the current directory, and names a missing module', () => {
  const specs = {
    'src/ui/Button.tsx': { edges: [edge('src/cn.ts', { names: ['cn'] })] },
    'src/cn.ts': {}
  }
  const result = ask(specs, 'Button.tsx', 'src/cn.ts', false, 'src/ui' as RepoPath)
  assert.equal(result.from.path, 'src/ui/Button.tsx')
  assert.deepEqual(result.chains[0]?.modules, ['src/ui/Button.tsx', 'src/cn.ts'])

  const missing = importPath(graph(specs), 'src/nope.ts', 'src/cn.ts', undefined, false)
  assert.deepEqual(missing, {
    schemaVersion: 1,
    command: 'path',
    error: { code: 'not-found', message: 'no module named src/nope.ts' }
  })
  const missingTarget = importPath(graph(specs), 'src/cn.ts', 'src/gone.ts', undefined, false)
  assert.ok('error' in missingTarget && missingTarget.error.message.includes('src/gone.ts'))
})
