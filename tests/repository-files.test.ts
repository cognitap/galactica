import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gitListing, repositoryFiles } from '../src/repository-files.ts'
import { git, gitRepository } from './temp-repository.ts'

test('git prunes unused build and dependency folders before emitting untracked files (DEV-730)', t => {
  const root = gitRepository(t, {
    'src/main.ts': '',
    'node_modules/large/index.js': '',
    'packages/a/build/output.js': '',
    'packages/a/src/new.ts': '',
    'packages/a/.gitignore': 'ignored.ts\n',
    'packages/a/ignored.ts': '',
    'dist/tracked.js': ''
  })
  git(root, 'add', 'src/main.ts', 'dist/tracked.js')
  const listed = gitListing(root)!.split('\0').filter(Boolean)
  assert.ok(listed.includes('src/main.ts'))
  assert.ok(listed.includes('packages/a/src/new.ts'))
  assert.ok(listed.includes('dist/tracked.js'), 'tracked files still come from the index')
  assert.ok(
    !listed.some(path => path.startsWith('node_modules/') || path.includes('/build/')),
    listed.join('\n')
  )
  assert.ok(!listed.includes('packages/a/ignored.ts'))
  assert.deepEqual(repositoryFiles(root).toSorted(), [
    'packages/a/.gitignore',
    'packages/a/src/new.ts',
    'src/main.ts'
  ])
})
