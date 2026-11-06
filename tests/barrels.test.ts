import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveBarrels } from '../src/barrels.ts'
import type { Edge, Model, RepoPath, SymbolFacts, Target } from '../src/model.ts'

const defines = (name: string, isDefault = false): SymbolFacts => ({
  name,
  kind: 'const',
  line: 1,
  default: isDefault,
  signature: `const ${name}`
})

const targetOf = (to: string | Target): Target =>
  typeof to === 'string' ? { kind: 'module', path: to as RepoPath } : to

const imports = (
  to: string | Target,
  names: readonly string[],
  fields: Partial<Edge> = {}
): Edge => ({
  to: targetOf(to),
  line: 1,
  form: 'import',
  names,
  typeOnly: false,
  dynamic: false,
  via: [],
  ...fields
})

const reexports = (
  to: string | Target,
  names: readonly string[],
  renames?: Readonly<Record<string, string>>
): Edge => imports(to, names, { form: 'reexport', ...(renames ? { renames } : {}) })

interface Spec {
  readonly symbols?: readonly SymbolFacts[]
  readonly edges?: readonly Edge[]
}

function modulesOf(specs: Readonly<Record<string, Spec>>): Model['modules'] {
  return Object.fromEntries(
    Object.entries(specs).map(([path, { symbols = [], edges = [] }]) => [
      path,
      { path: path as RepoPath, hash: 'h', symbols, edges }
    ])
  )
}

const resolved = (specs: Readonly<Record<string, Spec>>, path = 'main.ts') =>
  resolveBarrels(modulesOf(specs))[path as RepoPath]!.edges

const summary = (edges: readonly Edge[]) =>
  edges.map(({ to, names, via }) => ({ to: to.kind === 'module' ? to.path : to, names, via }))

test('an import of a module that defines the name stays as it is', () => {
  const edges = [imports('a.ts', ['a'])]
  assert.deepEqual(resolved({ 'main.ts': { edges }, 'a.ts': { symbols: [defines('a')] } }), edges)
})

test('a named re-export leads to the module that defines the name', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['a'])] },
    'index.ts': { edges: [reexports('a.ts', ['a'])] },
    'a.ts': { symbols: [defines('a')] }
  }
  assert.deepEqual(summary(resolved(specs)), [{ to: 'a.ts', names: ['a'], via: ['index.ts'] }])
})

test('a renamed re-export leads to the name the defining module exports', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['y']), imports('index.ts', ['x'], { line: 2 })] },
    'index.ts': { edges: [reexports('a.ts', ['x'], { y: 'x' })] },
    'a.ts': { symbols: [defines('x')] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'a.ts', names: ['x'], via: ['index.ts'] },
    { to: 'index.ts', names: ['x'], via: [] }
  ])
})

test('a name passed on both renamed and unrenamed resolves under either name', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['x', 'y'])] },
    'index.ts': { edges: [reexports('a.ts', ['x'], { x: 'x', y: 'x' })] },
    'a.ts': { symbols: [defines('x')] }
  }
  assert.deepEqual(summary(resolved(specs)), [{ to: 'a.ts', names: ['x'], via: ['index.ts'] }])
})

test('a default export re-exported under a name resolves to the default', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['Button'])] },
    'index.ts': { edges: [reexports('Button.tsx', ['default'], { Button: 'default' })] },
    'Button.tsx': { symbols: [defines('Button', true)] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'Button.tsx', names: ['default'], via: ['index.ts'] }
  ])
})

test('export * passes on every name but the default, trying its targets in edge order', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['a', 'default', 'shared'])] },
    'index.ts': { edges: [reexports('a.ts', ['*']), reexports('b.ts', ['*'])] },
    'a.ts': { symbols: [defines('a'), defines('shared'), defines('A', true)] },
    'b.ts': { symbols: [defines('shared')] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'a.ts', names: ['a', 'shared'], via: ['index.ts'] },
    { to: 'index.ts', names: ['default'], via: [] }
  ])
})

test('export * as a name resolves to the whole module it names', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['ns'])] },
    'index.ts': { edges: [reexports('a.ts', ['*'], { ns: '*' })] },
    'a.ts': { symbols: [defines('ns')] }
  }
  assert.deepEqual(summary(resolved(specs)), [{ to: 'a.ts', names: ['*'], via: ['index.ts'] }])
})

test('nested barrels are listed in via from the importer side', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['Input'])] },
    'index.ts': { edges: [reexports('forms/index.ts', ['*'])] },
    'forms/index.ts': { edges: [reexports('forms/Input.tsx', ['Input'])] },
    'forms/Input.tsx': { symbols: [defines('Input')] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'forms/Input.tsx', names: ['Input'], via: ['index.ts', 'forms/index.ts'] }
  ])
})

test('a re-export of an external package or an unresolved specifier ends there', () => {
  const react: Target = { kind: 'external', name: 'react' }
  const gone: Target = { kind: 'unresolved', specifier: './gone' }
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['gone', 'useState'])] },
    'index.ts': { edges: [reexports(react, ['useState']), reexports(gone, ['gone'])] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: gone, names: ['gone'], via: ['index.ts'] },
    { to: react, names: ['useState'], via: ['index.ts'] }
  ])
})

test('a named re-export stands for its target when the target shows no definition', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['Counter'])] },
    'index.ts': { edges: [reexports('Counter.vue', ['default'], { Counter: 'default' })] },
    'Counter.vue': {}
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'Counter.vue', names: ['default'], via: ['index.ts'] }
  ])
})

test('a re-export cycle leaves the import on the module it names', () => {
  const specs = {
    'main.ts': { edges: [imports('a.ts', ['x']), imports('c.ts', ['y'], { line: 2 })] },
    'a.ts': { edges: [reexports('b.ts', ['*'])] },
    'b.ts': { edges: [reexports('a.ts', ['*'])] },
    'c.ts': { edges: [reexports('d.ts', ['y'])] },
    'd.ts': { edges: [reexports('c.ts', ['y'])] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'a.ts', names: ['x'], via: [] },
    { to: 'c.ts', names: ['y'], via: [] }
  ])
})

test('a cycle of export * still finds a name defined beyond it, from either side', () => {
  const specs = {
    'main.ts': { edges: [imports('a.ts', ['x']), imports('b.ts', ['x'], { line: 2 })] },
    'a.ts': { edges: [reexports('b.ts', ['*']), reexports('c.ts', ['*'])] },
    'b.ts': { edges: [reexports('a.ts', ['*'])] },
    'c.ts': { symbols: [defines('x')] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'c.ts', names: ['x'], via: ['a.ts'] },
    { to: 'c.ts', names: ['x'], via: ['b.ts', 'a.ts'] }
  ])
})

test('a name no module exports leaves the import on the module it names', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['missing'])] },
    'index.ts': { edges: [reexports('a.ts', ['*'])] },
    'a.ts': { symbols: [defines('a')] }
  }
  assert.deepEqual(summary(resolved(specs)), [{ to: 'index.ts', names: ['missing'], via: [] }])
})

test('namespace and side-effect imports stay on the barrel', () => {
  const edges = [imports('index.ts', ['*']), imports('index.ts', [], { line: 2 })]
  const specs = {
    'main.ts': { edges },
    'index.ts': { edges: [reexports('a.ts', ['a'])] },
    'a.ts': { symbols: [defines('a')] }
  }
  assert.deepEqual(resolved(specs), edges)
})

test('one import splits into an edge per defining module, sorted by target, then via', () => {
  const specs = {
    'main.ts': { edges: [imports('index.ts', ['a', 'b', 'c', 'missing', 'own'])] },
    'index.ts': {
      symbols: [defines('own')],
      edges: [reexports('b.ts', ['b']), reexports('a.ts', ['a']), reexports('inner.ts', ['*'])]
    },
    'inner.ts': { edges: [reexports('a.ts', ['c'])] },
    'a.ts': { symbols: [defines('a'), defines('c')] },
    'b.ts': { symbols: [defines('b')] }
  }
  assert.deepEqual(summary(resolved(specs)), [
    { to: 'a.ts', names: ['a'], via: ['index.ts'] },
    { to: 'a.ts', names: ['c'], via: ['index.ts', 'inner.ts'] },
    { to: 'b.ts', names: ['b'], via: ['index.ts'] },
    { to: 'index.ts', names: ['missing', 'own'], via: [] }
  ])
})

test('a split edge keeps its line, form, typeOnly and dynamic', () => {
  const specs = {
    'main.ts': {
      edges: [
        imports('index.ts', ['A'], { line: 3, typeOnly: true }),
        imports('index.ts', ['b'], { line: 4, dynamic: true })
      ]
    },
    'index.ts': { edges: [reexports('a.ts', ['A']), reexports('b.ts', ['b'])] },
    'a.ts': { symbols: [defines('A')] },
    'b.ts': { symbols: [defines('b')] }
  }
  assert.deepEqual(resolved(specs), [
    imports('a.ts', ['A'], { line: 3, typeOnly: true, via: ['index.ts' as RepoPath] }),
    imports('b.ts', ['b'], { line: 4, dynamic: true, via: ['index.ts' as RepoPath] })
  ])
})

test('a barrel keeps its own re-export edges pointing at the module they name', () => {
  const specs = {
    'index.ts': { edges: [reexports('inner.ts', ['a'])] },
    'inner.ts': { edges: [reexports('a.ts', ['a'])] },
    'a.ts': { symbols: [defines('a')] }
  }
  assert.deepEqual(resolved(specs, 'index.ts'), [reexports('inner.ts', ['a'])])
})

/** `main.ts` importing `x` through `length` barrels, each passing it on with a named or `*` re-export. */
const barrelChain = (length: number): Record<string, Spec> => ({
  'main.ts': { edges: [imports('b0.ts', ['x'])] },
  ...Object.fromEntries(
    Array.from({ length }, (_, index) => [
      `b${index}.ts`,
      { edges: [reexports(`b${index + 1}.ts`, index % 2 === 0 ? ['x'] : ['*'])] }
    ])
  ),
  [`b${length}.ts`]: { symbols: [defines('x')] }
})

test('a chain of barrels is followed for 100 barrels, and a longer one stops at its first barrel', () => {
  const via = Array.from({ length: 100 }, (_, index) => `b${index}.ts`)
  assert.deepEqual(summary(resolved(barrelChain(100))), [{ to: 'b100.ts', names: ['x'], via }])
  assert.deepEqual(summary(resolved(barrelChain(101))), [{ to: 'b0.ts', names: ['x'], via: [] }])
  assert.deepEqual(summary(resolved(barrelChain(5000))), [{ to: 'b0.ts', names: ['x'], via: [] }])
})
