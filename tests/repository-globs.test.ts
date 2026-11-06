import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { repository } from './temp-repository.ts'

const hostile = `packages/${'*a'.repeat(14)}b`

for (const source of ['pnpm', 'npm', 'include', 'exclude', 'kinds', 'areas']) {
  test(`hostile ${source} glob finishes without backtracking`, t => {
    const path = `packages/${'a'.repeat(40)}`
    const root = repository(t, {
      'package.json': { name: 'root', ...(source === 'npm' ? { workspaces: [hostile] } : {}) },
      ...(source === 'pnpm' ? { 'pnpm-workspace.yaml': `packages: ["${hostile}"]\n` } : {}),
      [`${path}/package.json`]: { name: 'member' },
      [`${path}/index.ts`]: 'export const value = 1',
      'galactica.config.json': {
        ...(source === 'include' ? { include: [`${hostile}/**`] } : {}),
        ...(source === 'exclude' ? { exclude: [`${hostile}/**`] } : {}),
        ...(source === 'kinds' ? { kinds: { test: [`${hostile}/**`] } } : {}),
        ...(source === 'areas' ? { areas: { [`${hostile}/**`]: 'group' } } : {})
      }
    })
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { analyzeRepository } from './src/analysis.ts';
      import { loadConfig } from './src/config.ts';
      import { graphOf } from './src/graph.ts';
      const root = process.argv[1];
      const config = loadConfig(root);
      const { model } = analyzeRepository(root, config);
      graphOf(model, config);
      assert.equal(Object.keys(model.modules).length, ${source === 'include' ? 0 : 1});
    `,
        root
      ],
      { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000 }
    )
    assert.equal(result.error, undefined, `${source}: ${result.error}`)
    assert.equal(result.status, 0, result.stderr)
  })
}

test('unsupported glob warnings identify every config key and workspace source', async t => {
  const { discover } = await import('../src/discovery.ts')
  const { loadConfig } = await import('../src/config.ts')
  for (const source of ['pnpm', 'npm']) {
    const root = repository(t, {
      'package.json': { name: 'root', workspaces: ['@(packages)/*'] },
      ...(source === 'pnpm' ? { 'pnpm-workspace.yaml': 'packages: ["@(packages)/*"]\n' } : {}),
      'galactica.config.json': {
        include: ['@(src)/**'],
        exclude: ['@(gen)/**'],
        kinds: { test: ['@(tests)/**'] },
        areas: { '@(src)/**': 'src' }
      }
    })
    const warnings = discover(root, loadConfig(root)).warnings
    assert.equal(warnings.length, 5)
    for (const key of ['include[0]', 'exclude[0]', 'kinds.test[0]', 'areas["@(src)/**"]']) {
      assert.ok(
        warnings.some(
          warning =>
            warning.path === 'galactica.config.json' &&
            warning.message.startsWith(`${key}: glob ignored:`)
        ),
        key
      )
    }
    assert.ok(
      warnings.some(
        warning =>
          warning.path === (source === 'pnpm' ? 'pnpm-workspace.yaml' : 'package.json') &&
          warning.message.includes('workspace pattern')
      )
    )
  }
})
