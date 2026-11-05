import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.ts'
import { emptyConfig } from '../src/model.ts'
import { gitlab, invalidConfigs, validConfigs } from './config-examples.ts'
import { schemaErrors } from './json-schema.ts'
import { repository } from './temp-repository.ts'

const schema = JSON.parse(
  readFileSync(new URL('../schema/galactica.config.schema.json', import.meta.url), 'utf8')
)

test('a repository without galactica.config.json has the empty config', t => {
  assert.equal(loadConfig(repository(t, { 'package.json': {} })), emptyConfig)
})

test('loadConfig reads every option, area paths normalized and in file order', t => {
  const root = repository(t, {
    'galactica.config.json': {
      ...validConfigs.full,
      areas: { 'src/b/**': 'src/b/', 'src/a/**': 'src/a' }
    }
  })
  assert.deepEqual(loadConfig(root), {
    include: ['src/**', 'scripts/**'],
    exclude: ['src/generated/**'],
    kinds: { source: ['docs/.vitepress/theme/**'] },
    areas: [
      { glob: 'src/b/**', area: 'src/b' },
      { glob: 'src/a/**', area: 'src/a' }
    ],
    sourceUrl: gitlab
  })
})

test('each invalid config fails with one line naming the file and the key', t => {
  for (const { config, message } of invalidConfigs) {
    const root = repository(t, { 'galactica.config.json': config })
    assert.throws(
      () => loadConfig(root),
      error =>
        error instanceof ConfigError && error.message === `galactica.config.json: ${message}`,
      message
    )
  }
})

test('a file that is no JSON fails naming the file', t => {
  const root = repository(t, { 'galactica.config.json': '{ "kinds": ' })
  assert.throws(
    () => loadConfig(root),
    error =>
      error instanceof ConfigError &&
      error.message.startsWith('galactica.config.json: invalid JSON: ')
  )
})

const readmeConfigs = [
  ...readFileSync(new URL('../README.md', import.meta.url), 'utf8').matchAll(/```json\n([^]*?)```/g)
].map(([, block]) => JSON.parse(block!) as object)

test('the README shows the full config and the VitePress one', () => {
  assert.deepEqual(readmeConfigs, [validConfigs.full, validConfigs.vitepressTheme])
})

test('the schema accepts exactly the configs loadConfig accepts', t => {
  for (const [name, config] of [
    ...Object.entries(validConfigs),
    ...readmeConfigs.map((config, index) => [`README example ${index + 1}`, config] as const)
  ]) {
    assert.deepEqual(schemaErrors(schema, config), [], name)
    loadConfig(repository(t, { 'galactica.config.json': config }))
  }
  for (const { config, message } of invalidConfigs) {
    assert.notDeepEqual(schemaErrors(schema, config), [], message)
  }
})
