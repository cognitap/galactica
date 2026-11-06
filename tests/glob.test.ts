import assert from 'node:assert/strict'
import { posix } from 'node:path'
import { test } from 'node:test'
import { globProblem, matchesGlob } from '../src/glob.ts'

const patterns = [
  '**',
  '**/*.ts',
  'src/**',
  'src/**/*.ts',
  'src/**/test/**',
  'src/*/a.ts',
  '.storybook/**',
  'src/**/.*',
  'src/?.ts',
  'src/[ab].ts',
  'src/[!a].ts',
  '{src,scripts}/**',
  'src/{a,{b,c}}.ts',
  'src/{1..3}.ts',
  'src/**/**/*.ts',
  'src/*.ts',
  'src/(auth)/**'
]
const paths = [
  'src/a.ts',
  'src/b.ts',
  'src/c.ts',
  'src/1.ts',
  'src/2.ts',
  'src/3.ts',
  'src/deep/a.ts',
  'src/deep/test/a.ts',
  'src/test/a.ts',
  'src/deep/test/a.js',
  'src/.hidden/a.ts',
  'src/.hidden',
  '.storybook/main.ts',
  'scripts/build.ts',
  'other/deep/a.ts',
  'src/a.js',
  'src/.ts',
  'src/(auth)/index.ts'
]

test('bounded matching agrees with Node on ordinary repository patterns', () => {
  for (const pattern of patterns) {
    assert.equal(globProblem(pattern), undefined, pattern)
    for (const path of paths) {
      assert.equal(
        matchesGlob(path, pattern),
        posix.matchesGlob(path, pattern),
        `${pattern}: ${path}`
      )
    }
  }
})

test('wildcard and globstar states do not backtrack on failing suffixes', () => {
  assert.equal(matchesGlob('a'.repeat(10000), '*a'.repeat(100) + 'b'), false)
  assert.equal(matchesGlob('a'.repeat(40) + 'b', '*a'.repeat(14) + 'b'), true)
  assert.equal(matchesGlob('a/'.repeat(10000) + 'end', '**/a/'.repeat(100) + 'missing'), false)
})

test('brace expansion and advanced syntax are rejected before matching', () => {
  for (const pattern of [
    '{a,b}'.repeat(20),
    '*'.repeat(1025),
    '@(a|b)',
    '**/+(a)',
    '[[:alpha:]]',
    '{9007199254740992..9007199254740994}'
  ]) {
    assert.match(globProblem(pattern)!, /glob ignored:/, pattern)
    assert.equal(matchesGlob('a'.repeat(40), pattern), false)
  }
})
