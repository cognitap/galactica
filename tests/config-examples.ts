/** Every config the tests use, so `tests/config.test.ts` can check each against the schema and `loadConfig`. */

import type { TestContext } from 'node:test'
import { loadConfig } from '../src/config.ts'
import type { Config } from '../src/model.ts'
import { repository } from './temp-repository.ts'

export const gitlab = 'https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}'

export const validConfigs = {
  empty: {},
  full: {
    $schema: './node_modules/@cognitap/galactica/schema/galactica.config.schema.json',
    include: ['src/**', 'scripts/**'],
    exclude: ['src/generated/**'],
    kinds: { source: ['docs/.vitepress/theme/**'] },
    areas: { 'src/components/**': 'src/components' },
    sourceUrl: gitlab
  },
  vitepressTheme: { kinds: { source: ['docs/.vitepress/theme/**'] } },
  selection: { include: ['src/**', 'scripts/**'], exclude: ['src/generated/**'] },
  everything: { include: ['**'] },
  warmChange: {
    exclude: ['src/legacy.cjs'],
    kinds: { test: ['src/b.ts'] },
    areas: { 'src/a.ts': 'src/core' }
  },
  areaOrder: {
    areas: {
      'src/components/**/*.stories.tsx': 'src/stories',
      'src/components/**': 'src/components'
    }
  },
  areaOutsidePackage: { areas: { 'packages/ui/**': 'src' } },
  areaInNestedPackage: { areas: { 'scripts/**': 'packages/ui' } },
  layeredAreas: { areas: { 'src/lib/**': 'src/core' } },
  themeAndComponents: {
    kinds: { source: ['docs/.vitepress/theme/**'] },
    areas: { 'src/components/**': 'src/components' }
  },
  kindClash: { kinds: { story: ['**/*.example.tsx'], test: ['src/**'] } },
  sourceUrlNone: { sourceUrl: 'none' },
  rootArea: { areas: { 'src/**': '.' } },
  trailingSlash: { areas: { 'src/a/**': 'src/a/' } }
} as const

/** Each with the whole line `loadConfig` fails with. */
export const invalidConfigs: readonly { readonly config: object; readonly message: string }[] = [
  { config: [], message: 'expected an object, got array' },
  {
    config: { colour: 'blue' },
    message: 'colour: unknown key; expected $schema, include, exclude, kinds, areas or sourceUrl'
  },
  { config: { $schema: 1 }, message: '$schema: expected a string, got number' },
  { config: { include: 'src/**' }, message: 'include: expected an array of globs, got string' },
  { config: { include: [] }, message: 'include: list at least one glob' },
  { config: { include: [1] }, message: 'include[0]: expected a string, got number' },
  { config: { exclude: [''] }, message: 'exclude[0]: glob must not be empty' },
  { config: { exclude: ['src\\gen\\**'] }, message: 'exclude[0]: glob must use forward slashes' },
  { config: { exclude: ['/src/**'] }, message: 'exclude[0]: glob must be relative to the root' },
  { config: { exclude: ['C:/src/**'] }, message: 'exclude[0]: glob must be relative to the root' },
  {
    config: { exclude: ['src/**', './gen/**'] },
    message: 'exclude[1]: glob must start at the root, with no leading ./'
  },
  {
    config: { exclude: ['src/../gen/**'] },
    message: 'exclude[0]: glob must not leave the root with ..'
  },
  { config: { kinds: [] }, message: 'kinds: expected an object, got array' },
  {
    config: { kinds: { storyy: ['.storybook/**'] } },
    message: 'kinds.storyy: unknown kind; expected source, test, story or config'
  },
  {
    config: { kinds: { story: '.storybook/**' } },
    message: 'kinds.story: expected an array of globs, got string'
  },
  {
    config: { kinds: { test: ['e2e/**', '../e2e/**'] } },
    message: 'kinds.test[1]: glob must not leave the root with ..'
  },
  { config: { areas: ['src'] }, message: 'areas: expected an object, got array' },
  {
    config: { areas: { 'src/**': 1 } },
    message: 'areas["src/**"]: expected a string, got number'
  },
  {
    config: { areas: { '/src/**': 'src' } },
    message: 'areas["/src/**"]: glob must be relative to the root'
  },
  {
    config: { areas: { 'src/**': '../elsewhere' } },
    message: 'areas["src/**"]: area path must not leave the root with ..'
  },
  { config: { areas: { 'src/**': '' } }, message: 'areas["src/**"]: area path must not be empty' },
  { config: { sourceUrl: true }, message: 'sourceUrl: expected a string, got boolean' },
  {
    config: { sourceUrl: 'ftp://example.com/{path}' },
    message: 'sourceUrl: a source URL template must start with http:// or https://'
  },
  {
    config: { sourceUrl: 'https://example.com/{commit}' },
    message: 'sourceUrl: a source URL template must contain {path}'
  }
]

/** `config` as `loadConfig` reads it from a repository of its own. */
export function loaded(t: TestContext, config: object): Config {
  return loadConfig(repository(t, { 'galactica.config.json': config }))
}
