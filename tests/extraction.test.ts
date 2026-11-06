import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import type { Language } from '../src/contract.ts'
import { extract, type Extraction } from '../src/extraction.ts'
import type { RepoPath } from '../src/model.ts'

const require = createRequire(import.meta.url)
const vue = () => require('vue/compiler-sfc')
const svelte = () => require('svelte/compiler')

const component = (name: string) => ({
  name,
  kind: 'component',
  line: 1,
  default: true,
  signature: `component ${name}`
})

const read = (path: string, language: Language, lines: readonly string[], load?: () => unknown) =>
  extract(path as RepoPath, language, Buffer.from(lines.join('\n')), load)

const brief = ({ symbols, imports, failure }: Extraction) => ({
  symbols: symbols.map(({ name, line, kind }) => [name, line, kind]),
  imports: imports.map(({ specifier, line, names }) => [specifier, line, names]),
  ...(failure === undefined ? {} : { failure })
})

test('a Vue <script setup> gives its imports at their lines in the file, and no exports', () => {
  const extraction = read(
    'src/Counter.vue',
    'vue',
    [
      '<template><span>{{ count }}</span></template>',
      '',
      '<script setup lang="ts">',
      "import { ref } from 'vue'",
      "import type { Count } from './count'",
      'export const ignored = 1',
      '</script>'
    ],
    vue
  )
  assert.deepEqual(extraction.symbols, [component('Counter')])
  assert.deepEqual(brief(extraction).imports, [
    ['vue', 4, ['ref']],
    ['./count', 5, ['Count']]
  ])
})

test('a Vue <script> gives the exports, and imports come from both blocks in file order', () => {
  const extraction = read(
    'src/Panel.vue',
    'vue',
    [
      '<script setup lang="ts">',
      "import { a } from './a'",
      '</script>',
      '<script lang="ts">',
      "import { b } from './b'",
      'export interface PanelProps { open: boolean }',
      'export default { inheritAttrs: false }',
      '</script>'
    ],
    vue
  )
  assert.deepEqual(brief(extraction), {
    symbols: [
      ['Panel', 1, 'component'],
      ['PanelProps', 6, 'interface']
    ],
    imports: [
      ['./a', 2, ['a']],
      ['./b', 5, ['b']]
    ]
  })
})

test('a template-only Vue component has its component and nothing else', () => {
  const extraction = read('src/Badge.vue', 'vue', ['<template><b>new</b></template>'], vue)
  assert.deepEqual(extraction, { symbols: [component('Badge')], imports: [] })
})

test('a Vue block in lang="tsx" parses its JSX', () => {
  const extraction = read(
    'src/List.vue',
    'vue',
    [
      '<script lang="tsx">',
      "import { h } from 'vue'",
      'export function Item(props: { label: string }) {',
      '  return <li>{props.label}</li>',
      '}',
      '</script>'
    ],
    vue
  )
  assert.deepEqual(brief(extraction), {
    symbols: [
      ['List', 1, 'component'],
      ['Item', 3, 'component']
    ],
    imports: [['vue', 2, ['h']]]
  })
})

test('a Svelte module script gives the exports, and the instance script only imports', () => {
  for (const opening of ['<script module lang="ts">', '<script context="module" lang="ts">']) {
    const extraction = read(
      'src/Counter.svelte',
      'svelte',
      [
        opening,
        "  import { start } from './start'",
        '  export const initial: number = start',
        '</script>',
        '',
        '<script lang="ts">',
        "  import { formatCount } from './format'",
        '  export const notExported = 1',
        '  let { count }: { count: number } = $props()',
        '</script>',
        '',
        '<span>{formatCount(count)}</span>'
      ],
      svelte
    )
    assert.deepEqual(
      brief(extraction),
      {
        symbols: [
          ['Counter', 1, 'component'],
          ['initial', 3, 'const']
        ],
        imports: [
          ['./start', 2, ['start']],
          ['./format', 7, ['formatCount']]
        ]
      },
      opening
    )
  }
})

test('an Astro frontmatter gives the imports and exports at their lines', () => {
  const extraction = read('src/pages/index.astro', 'astro', [
    '---',
    "import Layout from '../layouts/Layout.astro'",
    'export const prerender = true',
    '---',
    '<Layout />'
  ])
  assert.deepEqual(brief(extraction), {
    symbols: [
      ['index', 1, 'component'],
      ['prerender', 3, 'const']
    ],
    imports: [['../layouts/Layout.astro', 2, ['default']]]
  })
})

test('an Astro file without frontmatter has its component and nothing else', () => {
  for (const lines of [
    ['<p>Hello</p>', "<script>import './client'</script>"],
    ['<p>---</p>', '---'],
    ['---', "import a from './a'"]
  ]) {
    assert.deepEqual(read('src/Plain.astro', 'astro', lines), {
      symbols: [component('Plain')],
      imports: []
    })
  }
})

test('an Astro frontmatter may follow a byte order mark and blank lines', () => {
  const extraction = read('src/Page.astro', 'astro', [
    '﻿',
    '  ',
    '---\r',
    "import a from './a'\r",
    '---\r',
    '<p />'
  ])
  assert.deepEqual(brief(extraction).imports, [['./a', 4, ['default']]])
})

test('without its compiler, a Vue or Svelte file has its component and no imports', () => {
  const lines = ['<script>', "import a from './a'", '</script>']
  assert.deepEqual(read('src/A.vue', 'vue', lines), { symbols: [component('A')], imports: [] })
  assert.deepEqual(read('src/B.svelte', 'svelte', lines), {
    symbols: [component('B')],
    imports: []
  })
})

test('when the compiler throws, the file has its component, no imports, and the first line of the error', () => {
  const throwing = () => ({
    parse() {
      throw new Error('cannot read this\nat line 3')
    }
  })
  assert.deepEqual(read('src/A.vue', 'vue', ['<script>'], throwing), {
    symbols: [component('A')],
    imports: [],
    failure: 'cannot read this'
  })
  const broken = read('src/B.svelte', 'svelte', ['<script>', 'import {', '</script>'], svelte)
  assert.deepEqual(broken.symbols, [component('B')])
  assert.equal(typeof broken.failure, 'string')
})

/** `count` terms joined by `separator`, which TypeScript parses into a tree `count` levels deep. */
const chain = (count: number, term: (index: number) => string, separator: string) =>
  Array.from({ length: count }, (_, index) => term(index)).join(separator)

test('a deep expression still gives its symbols, imports and load-time reads', () => {
  const extraction = read('src/deep.ts', 'ts', [
    "import { b } from './b'",
    `export const x = ${chain(5000, index => (index === 0 ? 'b' : `'s${index}'`), ' + ')}`,
    `export const y = ${chain(5000, () => 'b', ' as unknown')}`,
    `export function f() { return ${chain(5000, () => 'b', ' || ')} }`
  ])
  assert.deepEqual(brief(extraction), {
    symbols: [
      ['x', 2, 'const'],
      ['y', 3, 'const'],
      ['f', 4, 'function']
    ],
    imports: [['./b', 1, ['b']]]
  })
  assert.deepEqual(extraction.imports[0]?.loadTime, ['b'])
})

test('a file nested deeper than the parser can follow gives a failure in place of a crash', () => {
  const extraction = read('src/deep.ts', 'ts', [
    "import { b } from './b'",
    'export function f(x: number) {',
    chain(5000, index => `if (x === ${index}) return b`, '\nelse '),
    '}'
  ])
  assert.deepEqual(brief(extraction), {
    symbols: [],
    imports: [],
    failure: 'Maximum call stack size exceeded'
  })
})

test('only a TypeScript module marks an import whose bindings only types use, never JavaScript or a Vue block', () => {
  const elided = (path: string, language: Language, lines: readonly string[]) =>
    read(path, language, lines, vue).imports.map(({ specifier, elided }) => [specifier, elided])
  const lines = ["import { User } from './user'", '/** @param {User} user */', 'export let user']
  assert.deepEqual(elided('a.ts', 'ts', lines), [['./user', 'unless-verbatim']])
  assert.deepEqual(elided('a.mts', 'mts', lines), [['./user', 'unless-verbatim']])
  assert.deepEqual(elided('a.js', 'js', lines), [['./user', undefined]])
  assert.deepEqual(
    elided('Card.vue', 'vue', [
      '<script setup lang="ts">',
      "import User from './User.vue'",
      'let user: User',
      '</script>',
      '<template><User /></template>'
    ]),
    [['./User.vue', undefined]]
  )
})
