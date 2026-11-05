import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { analyzeRepository, type Analysis } from '../src/analysis.ts'
import { loadConfig } from '../src/config.ts'
import { analyze } from '../src/model-cache.ts'
import { git, gitRepository, repository, type Files } from './temp-repository.ts'

const base: Files = {
  'package.json': { name: 'app', private: true, workspaces: ['packages/*'] },
  'tsconfig.base.json': {
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'Bundler',
      allowJs: true,
      paths: { '@lib/*': ['./packages/lib/src/*'] }
    }
  },
  'tsconfig.json': { extends: './tsconfig.base.json', include: ['src', 'packages'] },
  'src/main.ts': [
    "import { a } from './a'",
    "import { lib } from 'lib'",
    "import { util } from '@lib/util'",
    "import './styles.css'",
    "import { ext } from 'ext'",
    'export const main = [a, lib, util, ext]'
  ].join('\n'),
  'src/a.js': 'export const a = 1',
  'src/styles.css': '',
  'packages/lib/package.json': { name: 'lib', exports: { '.': './src/index.ts' } },
  'packages/lib/src/index.ts': "import { util } from '@lib/util'\nexport const lib = util",
  'packages/lib/src/util.ts': 'export const util = 3',
  'packages/lib/src/other.ts': 'export const other = 4'
}

/** The part of an analysis a command's output is built from. */
const output = ({ model, summary }: Analysis) =>
  JSON.stringify({
    model,
    warnings: summary.warnings,
    unresolved: summary.unresolved,
    skipped: summary.skipped
  })

/** A run answered from the model cache did no work, so every phase took no time. */
const fromCache = ({ summary }: Analysis) => Object.values(summary.durations).every(ms => ms === 0)

type Init = typeof repository

interface Repo {
  readonly root: string
  readonly cache: string
  readonly run: () => Promise<Analysis>
  readonly fresh: () => Analysis
  readonly write: (path: string, content: string | object) => void
}

/** A repository and a cache folder for it, outside the repository. */
function cachedRepository(t: TestContext, files = base, init: Init = repository): Repo {
  const root = init(t, files)
  const cache = join(repository(t, {}), 'cache')
  return {
    root,
    cache,
    run: () => analyze(root, loadConfig(root), { cache }),
    fresh: () => analyzeRepository(root, loadConfig(root)),
    write(path, content) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(
        join(root, path),
        typeof content === 'string' ? content : JSON.stringify(content)
      )
    }
  }
}

/**
 * After `change`, the next run analyzes again and gives what an uncached run
 * gives, byte for byte, and the run after that is answered from the cache.
 */
async function sees(repo: Repo, change: (repo: Repo) => void): Promise<Analysis> {
  change(repo)
  const changed = await repo.run()
  assert.ok(!fromCache(changed), 'the change is seen')
  assert.equal(output(changed), output(repo.fresh()))
  const again = await repo.run()
  assert.ok(fromCache(again), 'the run after is answered from the cache')
  assert.equal(output(again), output(changed))
  return changed
}

test('a run with no change is answered from the cache, with the output of an uncached run', async t => {
  const repo = cachedRepository(t)
  const first = await repo.run()
  assert.ok(!fromCache(first))
  assert.deepEqual(first.summary.modules, { reused: 0, reread: 0, parsed: 5 })
  const second = await repo.run()
  assert.ok(fromCache(second))
  assert.equal(output(second), output(repo.fresh()))
  assert.deepEqual(second.summary.modules, { reused: 5, reread: 0, parsed: 0 })
})

const changes: Readonly<Record<string, (repo: Repo) => void>> = {
  'a module is edited': ({ write }) => write('src/a.js', 'export const a = 1\nexport const b = 2'),
  'a module is added': ({ write }) => write('src/b.ts', "export { a } from './a'"),
  'a module is deleted': ({ root }) => rmSync(join(root, 'packages/lib/src/other.ts')),
  'a module is renamed': ({ root }) =>
    renameSync(join(root, 'src/a.js'), join(root, 'src/renamed.js')),
  "a new file takes over a relative import's resolution": ({ write }) =>
    write('src/a.ts', "export const a = 'ts'"),
  'a module appears in a new folder': ({ write }) =>
    write('src/deep/new.ts', 'export const deep = 1'),
  "a package.json's exports change": ({ write }) =>
    write('packages/lib/package.json', { name: 'lib', exports: { '.': './src/util.ts' } }),
  "a tsconfig's paths change": ({ write }) =>
    write('tsconfig.json', {
      extends: './tsconfig.base.json',
      compilerOptions: { paths: { '@lib/*': ['./packages/lib/src/other.ts'] } },
      include: ['src', 'packages']
    }),
  'a config an extends chain points at changes': ({ write }) =>
    write('tsconfig.base.json', {
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        allowJs: true,
        paths: { '@lib/*': ['./packages/lib/src/other.ts'] }
      }
    }),
  'a nearer tsconfig claims a package': ({ write }) =>
    write('packages/lib/tsconfig.json', {
      compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' },
      include: ['src']
    }),
  'galactica.config.json changes': ({ write }) =>
    write('galactica.config.json', { exclude: ['packages/lib/src/other.ts'] }),
  'an imported file that is no module is deleted': ({ root }) =>
    rmSync(join(root, 'src/styles.css'))
}

for (const [name, change] of Object.entries(changes)) {
  test(`the cache sees that ${name}`, async t => {
    const repo = cachedRepository(t)
    const before = await repo.run()
    const changed = await sees(repo, change)
    assert.notEqual(output(changed), output(before), 'the change shows in the output')
  })
  test(`in a git work tree, the cache sees that ${name}`, async t => {
    const repo = cachedRepository(t, base, gitRepository)
    await repo.run()
    await sees(repo, change)
  })
}

test('a package appearing in node_modules, and leaving again, is seen', async t => {
  const repo = cachedRepository(t)
  await repo.run()
  await sees(repo, ({ write }) => {
    write('node_modules/ext/package.json', { name: 'ext', main: 'index.js' })
    write('node_modules/ext/index.js', 'export const ext = 1')
  })
  await sees(repo, ({ root }) => rmSync(join(root, 'node_modules'), { recursive: true }))
})

const commit = (root: string, message: string) =>
  git(
    root,
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--quiet',
    '--all',
    '--message',
    message
  )

test('in a git work tree, a staged rename and an unstaged deletion are seen', async t => {
  const repo = cachedRepository(t, base, gitRepository)
  git(repo.root, 'add', '.')
  commit(repo.root, 'base')
  await repo.run()
  await sees(repo, ({ root }) => git(root, 'mv', 'src/a.js', 'src/moved.js'))
  await sees(repo, ({ root }) => rmSync(join(root, 'packages/lib/src/other.ts')))
})

test('in a git work tree, a module that stops being ignored is seen', async t => {
  const files = { ...base, '.gitignore': 'hidden.ts\n', 'src/hidden.ts': 'export const hidden = 1' }
  const repo = cachedRepository(t, files, gitRepository)
  await repo.run()
  await sees(repo, ({ write }) => write('.gitignore', ''))
})

test('switching git branches with different files is seen', async t => {
  const repo = cachedRepository(t, base, gitRepository)
  git(repo.root, 'checkout', '--quiet', '-b', 'main')
  git(repo.root, 'add', '.')
  commit(repo.root, 'main')
  await repo.run()
  git(repo.root, 'checkout', '--quiet', '-b', 'feature')
  repo.write('src/feature.ts', 'export const feature = 1')
  repo.write('src/a.js', 'export const a = 2')
  git(repo.root, 'add', '.')
  await sees(repo, ({ root }) => commit(root, 'feature'))
  await sees(repo, ({ root }) => git(root, 'checkout', '--quiet', 'main'))
  await sees(repo, ({ root }) => git(root, 'checkout', '--quiet', 'feature'))
})

test('a timestamp within the second of the run is not trusted, so that run caches no model', async t => {
  const repo = cachedRepository(t)
  const file = join(repo.root, 'src/a.js')
  const now = new Date(Math.floor(Date.now() / 1000) * 1000)
  utimesSync(file, now, now)
  await repo.run()
  const second = await repo.run()
  assert.ok(!fromCache(second))
  assert.equal(output(second), output(repo.fresh()))
  const older = new Date(now.getTime() - 10_000)
  utimesSync(file, older, older)
  await repo.run()
  assert.ok(fromCache(await repo.run()))
})

test('a model cached by another build, or a damaged one, is replaced', async t => {
  const repo = cachedRepository(t)
  await repo.run()
  const file = join(repo.cache, 'model.json')
  const text = readFileSync(file, 'utf8')
  const [header, body] = text.split('\n')
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(header!), build: 'other' })}\n${body}`)
  assert.ok(!fromCache(await repo.run()))
  assert.ok(fromCache(await repo.run()))
  writeFileSync(file, text.slice(0, -20))
  const recovered = await repo.run()
  assert.ok(!fromCache(recovered))
  assert.equal(output(recovered), output(repo.fresh()))
  assert.ok(fromCache(await repo.run()))
})
