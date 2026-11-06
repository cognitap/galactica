import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { htmlOf } from '../src/html.ts'
import { emptyConfig } from '../src/model.ts'
import { pageData } from '../src/page-data.ts'
import type { PageSource } from '../src/source-links.ts'
import { defines, edge, modelOf, type Spec } from './models.ts'

const specs: Readonly<Record<string, Spec>> = {
  'src/app/main.ts': { edges: [edge('src/lib/format.ts')] },
  'src/app/main.test.ts': { edges: [edge('src/app/main.ts')] },
  'src/lib/format.ts': {
    symbols: [
      defines('format', 3, {
        kind: 'function',
        signature: 'function format(html = "</script><!--")',
        doc: 'Ends no </SCRIPT> block early, nor <!-- one.'
      })
    ]
  },
  'src/lib/parse.ts': {}
}

const graph = graphOf(modelOf(specs), emptyConfig)
const html = htmlOf(graph)

test('the page is byte-identical for the same repository', () => {
  const reordered = Object.fromEntries(Object.entries(specs).toReversed())
  assert.equal(htmlOf(graphOf(modelOf(reordered), emptyConfig)), html)
})

test('the page loads nothing from the network', () => {
  const remote = /\b(?:src|href)\s*=\s*["']?\s*(?:[a-z][\w+.-]*:)?\/\//i
  assert.doesNotMatch(html, remote)
  assert.doesNotMatch(html, /<link\b/i)
  assert.doesNotMatch(html, /@import|url\(/i)
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i)
})

test('the embedded data parses back to the page data, whatever the symbols contain', () => {
  const block = html.match(
    /<script\s+type="application\/json"\s+id="galactica-data"\s*>([^]*?)<\/script>/
  )
  assert.ok(block, 'the data block is present')
  assert.deepEqual(JSON.parse(block[1]!), pageData(graph))
  assert.equal(html.match(/<script\b/g)?.length, 2)
})

test('the stylesheet and the page scripts are inlined, and the title names the repository', () => {
  const page = (name: string) =>
    readFileSync(new URL(`../dist/page/${name}`, import.meta.url), 'utf8')
  assert.ok(html.includes(page('page.css')))
  assert.ok(html.includes(page('page.js')))
  assert.doesNotMatch(html, /^\s*(?:import|export)\s/m)
  assert.match(html, /<title>acme · Galactica<\/title>/)
  assert.doesNotMatch(html, /\{\{\w+\}\}/)
})

const source: PageSource = {
  template: 'https://github.com/acme/app/blob/abc1234/{path}#L{line}',
  prefix: '',
  shortCommit: 'abc1234',
  unpushed: 0,
  remote: 'origin',
  uncommitted: true
}

test('links come only from the embedded source, never from static markup', () => {
  const linked = htmlOf(graph, source)
  const block = /<script\s+type="application\/json"\s+id="galactica-data"\s*>([^]*?)<\/script>/
  assert.deepEqual(JSON.parse(linked.match(block)![1]!).source, source)
  const markup = linked.replace(block, '').replace(/<script\b[^>]*>[^]*?<\/script>/g, '')
  assert.doesNotMatch(markup, /https?:|<a\b|\bhref\b/i)
  assert.doesNotMatch(html, /github\.com/)
  assert.equal(JSON.parse(html.match(block)![1]!).source, null)
})
