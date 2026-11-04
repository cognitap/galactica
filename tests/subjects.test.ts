import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import type { RepoPath } from '../src/model.ts'
import { readingsOf, resolveModule, resolveSubject, similarPaths } from '../src/subjects.ts'
import { modelOf } from './models.ts'

const monorepo = graphOf(
  modelOf(
    {
      'packages/ui/src/Button.tsx': {},
      'packages/ui/src/Button.test.tsx': {},
      'packages/ui/src/Button.stories.tsx': {},
      'packages/ui/src/cn.ts': {},
      'packages/ui/index.ts': {},
      'packages/app/src/main.ts': {},
      'packages/app/src/routes/home.ts': {},
      'packages/app/src/routes/about.ts': {}
    },
    { '@acme/ui': 'packages/ui', '@acme/app': 'packages/app' }
  )
)

const root = '.' as RepoPath
const at = (path: string) => path as RepoPath

const subjectOf = (text: string, cwd: RepoPath | undefined = root) => {
  const result = resolveSubject(monorepo, text, cwd)
  return 'error' in result ? result.error : result.subject
}

test('a path reads from the current directory and from the root, normalized', () => {
  assert.deepEqual(readingsOf('./src/cn.ts', root), ['src/cn.ts'])
  assert.deepEqual(readingsOf('src/', at('packages/ui')), ['packages/ui/src', 'src'])
  assert.deepEqual(readingsOf('../cn.ts', at('src/lib')), ['src/cn.ts'])
  assert.deepEqual(readingsOf('src\\cn.ts', undefined), ['src/cn.ts'])
  assert.deepEqual(readingsOf('/abs/cn.ts', root), [])
})

test('a module path resolves to the module, from the root or the current directory', () => {
  const module = { kind: 'module', path: 'packages/ui/src/cn.ts', package: '@acme/ui' }
  assert.deepEqual(subjectOf('packages/ui/src/cn.ts'), module)
  assert.deepEqual(subjectOf('./packages/ui/src/cn.ts'), module)
  assert.deepEqual(subjectOf('src/cn.ts', at('packages/ui')), module)
  assert.deepEqual(subjectOf('packages/ui/src/cn.ts', undefined), module)
})

test('a package resolves by name or by directory', () => {
  const ui = { kind: 'package', name: '@acme/ui', dir: 'packages/ui' }
  assert.deepEqual(subjectOf('@acme/ui'), ui)
  assert.deepEqual(subjectOf('packages/ui/'), ui)
})

test('a package directory that is also an area resolves as the package', () => {
  assert.ok(monorepo.areas.has('packages/ui' as never))
  assert.deepEqual(subjectOf('packages/ui'), {
    kind: 'package',
    name: '@acme/ui',
    dir: 'packages/ui'
  })
})

test('an area path resolves to the area', () => {
  assert.deepEqual(subjectOf('packages/app/src/routes'), {
    kind: 'area',
    path: 'packages/app/src/routes',
    package: '@acme/app'
  })
})

test('an area or a package stands for its source and config modules', () => {
  const area = resolveSubject(monorepo, 'packages/ui/src', root)
  const pkg = resolveSubject(monorepo, '@acme/ui', root)
  assert.ok(!('error' in area) && !('error' in pkg))
  assert.deepEqual([...area.members], ['packages/ui/src/Button.tsx', 'packages/ui/src/cn.ts'])
  assert.deepEqual(
    [...pkg.members],
    ['packages/ui/index.ts', 'packages/ui/src/Button.tsx', 'packages/ui/src/cn.ts']
  )
  const test = resolveSubject(monorepo, 'packages/ui/src/Button.test.tsx', root)
  assert.ok(!('error' in test))
  assert.deepEqual([...test.members], ['packages/ui/src/Button.test.tsx'])
})

test('two readings that name different subjects of one rule are ambiguous', () => {
  const graph = graphOf(modelOf({ 'src/cn.ts': {}, 'src/src/cn.ts': {} }))
  const result = resolveSubject(graph, 'src/cn.ts', at('src'))
  assert.deepEqual(result, {
    error: {
      code: 'ambiguous',
      message: 'src/cn.ts names the module src/src/cn.ts or the module src/cn.ts'
    }
  })
})

test('an unknown subject is not found, with paths that end like it', () => {
  assert.deepEqual(subjectOf('cn.ts'), {
    code: 'not-found',
    message: 'no module, package or area named cn.ts. Did you mean packages/ui/src/cn.ts?'
  })
  assert.deepEqual(subjectOf('routes/nope'), {
    code: 'not-found',
    message: 'no module, package or area named routes/nope'
  })
})

test('outline takes only a module', () => {
  assert.deepEqual(resolveModule(monorepo, 'packages/app/src/routes', root), {
    error: { code: 'not-found', message: 'no module named packages/app/src/routes' }
  })
  assert.deepEqual(resolveModule(monorepo, '@acme/ui', root), {
    error: { code: 'not-found', message: 'no module named @acme/ui' }
  })
})

test('similar paths end with the text, with or without the extension, shortest first', () => {
  const paths = ['src/a/Button.tsx', 'src/Button.tsx', 'src/cn.ts', 'src/x/y/Button.tsx', 'b/cn.ts']
  assert.deepEqual(similarPaths(paths, 'Button.tsx'), [
    'src/Button.tsx',
    'src/a/Button.tsx',
    'src/x/y/Button.tsx'
  ])
  assert.deepEqual(similarPaths(paths, './cn'), ['b/cn.ts', 'src/cn.ts'])
  assert.deepEqual(similarPaths(paths, ''), [])
})
