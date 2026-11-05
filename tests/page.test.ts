import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { htmlOf } from '../src/html.ts'
import { emptyConfig } from '../src/model.ts'
import { chrome, openPage } from './browser.ts'
import { defines, edge, modelOf, type Spec } from './models.ts'

const big = Object.fromEntries(
  Array.from({ length: 10 }, (_, index): [string, Spec] => [
    `src/big/m${String(index + 1).padStart(2, '0')}.ts`,
    index === 0 ? { symbols: [defines('bigThing', 4, { signature: 'const bigThing = 1' })] } : {}
  ])
)

const html = htmlOf(
  graphOf(
    modelOf({
      ...big,
      'src/small/util.ts': { symbols: [defines('formatDate')] },
      'src/small/util.test.ts': { edges: [edge('src/small/util.ts')] },
      'src/small/util.stories.tsx': { edges: [edge('src/small/util.ts')] },
      'tests/e2e.test.ts': { edges: [edge('src/small/util.ts')] }
    }),
    emptyConfig
  )
)

/** Functions the page tests read the page through, as a reader sees it. */
const helpers = `
  const visible = node => node !== null && node !== undefined && node.checkVisibility()
  const box = path => [...document.querySelectorAll('.area')].find(
    node => node.querySelector('.area-select').getAttribute('aria-label') === 'Select ' + path
  )
  const rows = path => [...box(path).querySelectorAll('.module')].filter(visible)
    .map(row => row.querySelector('.module-name').textContent)
  const toggle = path => box(path).querySelector('.area-toggle')
  const filter = () => [...document.querySelectorAll('#kind-filter button')]
    .map(button => button.textContent + ' ' + button.getAttribute('aria-pressed'))
  const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))
  const type = async text => {
    const field = document.getElementById('search')
    field.focus()
    field.value = text
    field.dispatchEvent(new Event('input'))
    await frame()
  }
  const press = async key => {
    document.getElementById('search').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    await frame()
  }
`

async function page(t: TestContext, fragment = '') {
  const tab = await openPage(t, chrome!)
  await tab.load(html, fragment)
  return <T>(body: string) => tab.run<T>(helpers + body)
}

const skip = chrome === undefined ? 'no Chrome to drive' : false

test(
  'an area past eight modules starts collapsed and lists its modules on demand',
  { skip },
  async t => {
    const run = await page(t)
    assert.deepEqual(
      await run(`return {
      expanded: toggle('src/big').getAttribute('aria-expanded'),
      label: toggle('src/big').textContent,
      big: rows('src/big'),
      small: rows('src/small'),
      smallToggle: visible(toggle('src/small'))
    }`),
      { expanded: 'false', label: '10 modules', big: [], small: ['util.ts'], smallToggle: false }
    )
    assert.deepEqual(
      await run(`toggle('src/big').click(); await frame()
      return { expanded: toggle('src/big').getAttribute('aria-expanded'), big: rows('src/big') }`),
      {
        expanded: 'true',
        big: Object.keys(big).map(path => path.slice('src/big/'.length))
      }
    )
    assert.deepEqual(
      await run(`toggle('src/big').click(); await frame()
      return { expanded: toggle('src/big').getAttribute('aria-expanded'), big: rows('src/big') }`),
      { expanded: 'false', big: [] }
    )
  }
)

test(
  'the kind filter shows source and config at first, and each button shows or hides its kind',
  { skip },
  async t => {
    const run = await page(t)
    assert.deepEqual(
      await run(`return {
      filter: filter(),
      counts: document.getElementById('counts').textContent,
      tests: visible(box('tests')),
      small: rows('src/small')
    }`),
      {
        filter: ['Source 11 true', 'Tests 2 false', 'Stories 1 false'],
        counts: '1 package · 2 areas · 11 modules · 2 exported symbols',
        tests: false,
        small: ['util.ts']
      }
    )
    assert.deepEqual(
      await run(`[...document.querySelectorAll('#kind-filter button')][1].click(); await frame()
      return {
        filter: filter(),
        counts: document.getElementById('counts').textContent,
        tests: rows('tests'),
        small: rows('src/small')
      }`),
      {
        filter: ['Source 11 true', 'Tests 2 true', 'Stories 1 false'],
        counts: '1 package · 3 areas · 13 modules · 2 exported symbols',
        tests: ['e2e.test.ts'],
        small: ['util.test.ts', 'util.ts']
      }
    )
  }
)

test(
  'search finds a module the filter hides, says so, and shows its kind when chosen',
  { skip },
  async t => {
    const run = await page(t)
    assert.deepEqual(
      await run(`await type('e2e')
      return [...document.querySelectorAll('#search-results .result')].map(result =>
        [...result.children].map(part => part.textContent))`),
      [['tests/e2e.test.ts', 'module', 'tests', 'tests hidden by the filter']]
    )
    assert.deepEqual(
      await run(`await press('Enter')
      return {
        filter: filter(),
        tests: rows('tests'),
        selected: box('tests').querySelector('.module-select').getAttribute('aria-pressed'),
        hash: decodeURIComponent(location.hash)
      }`),
      {
        filter: ['Source 11 true', 'Tests 2 true', 'Stories 1 false'],
        tests: ['e2e.test.ts'],
        selected: 'true',
        hash: '#module=tests/e2e.test.ts'
      }
    )
  }
)

test(
  'an address naming a module in a collapsed area expands the area and selects the module',
  { skip },
  async t => {
    const run = await page(t, '#module=src%2Fbig%2Fm07.ts')
    assert.deepEqual(
      await run(`const row = [...box('src/big').querySelectorAll('.module')]
        .find(node => node.querySelector('.module-name').textContent === 'm07.ts')
      return {
        expanded: toggle('src/big').getAttribute('aria-expanded'),
        shown: rows('src/big').length,
        selected: row.querySelector('.module-select').getAttribute('aria-pressed'),
        focused: document.activeElement === row.querySelector('.module-select')
      }`),
      { expanded: 'true', shown: 10, selected: 'true', focused: true }
    )
  }
)

test('a symbol chosen in search opens its module and shows the symbol', { skip }, async t => {
  const run = await page(t)
  assert.deepEqual(
    await run(`await type('bigThing'); await press('Enter')
      return [...document.querySelectorAll('.symbol')].filter(visible).map(symbol => symbol.querySelector('.signature').textContent)`),
    ['const bigThing = 1']
  )
})

test(
  'the selection bar counts the related modules the filter hides, by kind',
  { skip },
  async t => {
    const run = await page(t, '#module=src%2Fsmall%2Futil.ts')
    assert.equal(
      await run(`return document.querySelector('#selection-summary .count-hidden').textContent`),
      '2 tests and 1 story hidden by the filter'
    )
  }
)
