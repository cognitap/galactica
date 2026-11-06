import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cacheDirectory } from '../src/cache.ts'
import { cliRunner } from './cli.ts'
import { git, gitRepository, repository } from './temp-repository.ts'

const commit = (root: string) =>
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--quiet', '-m', 'm')

test("a repository's git config and hooks never run a program", t => {
  const markers = repository(t, {})
  const mark = (name: string) => {
    const script = join(markers, `${name}.sh`)
    writeFileSync(script, `#!/bin/sh\ntouch '${join(markers, name)}'\ncat\n`)
    chmodSync(script, 0o755)
    return script
  }

  const lib = gitRepository(t, {
    'f.ts': 'export const f = 1\n',
    '.gitattributes': '* filter=lib\n'
  })
  git(lib, 'add', '.')
  commit(lib)

  const root = gitRepository(t, {
    'package.json': { name: 'app' },
    '.gitignore': 'node_modules\n',
    '.gitattributes': '* filter=evil\n',
    'node_modules/.keep': '',
    'src/a.ts': 'export const a = 1\n',
    'src/b.ts': "import { a } from './a'\n"
  })
  git(root, 'add', '.')
  git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', lib, 'lib')
  commit(root)
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/app.git')
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')

  git(root, 'config', 'core.fsmonitor', mark('fsmonitor'))
  for (const [repo, driver] of [
    [root, 'evil'],
    [join(root, 'lib'), 'lib']
  ] as const) {
    git(repo, 'config', `filter.${driver}.clean`, mark(`${driver}-clean`))
    git(repo, 'config', `filter.${driver}.process`, mark(`${driver}-process`))
    git(repo, 'config', `filter.${driver}.required`, 'true')
  }
  const hook = join(root, '.git', 'hooks', 'post-index-change')
  writeFileSync(hook, `#!/bin/sh\n${mark('post-index-change')}\n`)
  chmodSync(hook, 0o755)

  // Keep git's stat data stale without triggering the cache's coarse-timestamp refusal.
  const later = new Date(Math.floor(Date.now() / 1000) * 1000 + 60_123)
  for (const file of ['src/a.ts', 'src/b.ts', '.gitattributes', 'lib/f.ts']) {
    utimesSync(join(root, file), later, later)
  }

  const { run: galactica, env, home } = cliRunner(t)
  const run = (...args: string[]) => {
    const { status, stderr } = galactica(root, ...args, '--root', root)
    assert.equal(status, 0, stderr)
  }
  const page = join(markers, 'map.html')
  run('overview')
  run('html', '--out', page)
  run('overview')
  assert.match(readFileSync(page, 'utf8'), /github\.com\/acme\/app/)
  const cache = cacheDirectory(root, { platform: process.platform, env, home })!
  assert.ok(existsSync(join(cache, 'model.json')))
  assert.deepEqual(
    readdirSync(markers).filter(name => !name.includes('.')),
    []
  )
})
