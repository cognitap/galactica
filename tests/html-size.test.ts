import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { htmlOf } from '../src/html.ts'
import { emptyConfig } from '../src/model.ts'
import { defines, edge, modelOf, type Spec } from './models.ts'

// Raise only for intentional new page data, after reviewing the encoding and measured growth.
const MAX_EMBEDDED_DATA_BYTES = 22_000

// A fixed workspace with exports, cycles, cross-package imports, tests and stories.
function fixture() {
  const specs: Record<string, Spec> = {}
  for (const pkg of ['core', 'ui']) {
    for (let area = 0; area < 8; area++) {
      const dir = `packages/${pkg}/src/feature-${area}`
      const name = `${pkg}Feature${area}`
      const dependency = `packages/${pkg}/src/feature-${area === 0 ? 1 : area - 1}/index.ts`
      specs[`${dir}/index.ts`] = {
        symbols: [
          defines(name, 3, {
            kind: 'function',
            signature: `function ${name}(value: string): string`,
            doc: 'Formats café labels, including <tags> and </script>.'
          }),
          defines(`${name}Store`, 12, { kind: 'class', signature: `class ${name}Store` }),
          defines(`${name}Options`, 24, {
            kind: 'interface',
            signature: `interface ${name}Options`
          }),
          defines(`${name}Result`, 30, { kind: 'type', signature: `type ${name}Result` }),
          defines(`${name}State`, 36, { kind: 'enum', signature: `enum ${name}State` }),
          defines(`${name}Version`, 42)
        ],
        edges: [
          edge(dependency, { names: [`${pkg}Feature${area === 0 ? 1 : area - 1}`] }),
          ...(pkg === 'ui' ? [edge('packages/core/src/feature-7/index.ts')] : [])
        ]
      }
      specs[`${dir}/view.tsx`] = {
        symbols: [
          defines(`${name}View`, 5, {
            kind: 'component',
            default: true,
            signature: `function ${name}View(props: ${name}Options)`,
            doc: 'Renders the feature.'
          })
        ],
        edges: [edge(`${dir}/index.ts`)]
      }
      specs[`${dir}/index.test.ts`] = {
        edges: [edge(`${dir}/index.ts`), edge(`${dir}/view.tsx`)]
      }
      specs[`${dir}/view.stories.tsx`] = { edges: [edge(`${dir}/view.tsx`)] }
    }
  }
  return graphOf(
    modelOf(specs, { '@acme/core': 'packages/core', '@acme/ui': 'packages/ui' }),
    emptyConfig
  )
}

test('the HTML map stays within its embedded-data byte budget', t => {
  const html = htmlOf(fixture(), {
    template: 'https://github.com/acme/app/blob/abc1234/{path}#L{line}',
    prefix: '',
    shortCommit: 'abc1234',
    unpushed: 0,
    remote: 'origin',
    uncommitted: false
  })
  const block = html.match(
    /<script\s+type="application\/json"\s+id="galactica-data"\s*>([^]*?)<\/script>/
  )
  assert.ok(block, 'the embedded data block is present')
  // Count the actual escaped UTF-8 payload, excluding the surrounding HTML whitespace.
  const bytes = Buffer.byteLength(block[1]!.trim(), 'utf8')
  t.diagnostic(`Embedded HTML data: ${bytes} bytes; budget: ${MAX_EMBEDDED_DATA_BYTES} bytes`)
  assert.ok(
    bytes <= MAX_EMBEDDED_DATA_BYTES,
    `Embedded HTML data is ${bytes} bytes, exceeding the ${MAX_EMBEDDED_DATA_BYTES}-byte budget`
  )
})
