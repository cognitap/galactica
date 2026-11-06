import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { graphOf } from '../src/graph.ts'
import { htmlOf } from '../src/html.ts'
import { emptyConfig, type PackageName } from '../src/model.ts'
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
        counts:
          '1 package · 2 areas · 11 modules (+2 tests and 1 story hidden) · 2 exported symbols',
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
        counts: '1 package · 3 areas · 13 modules (+1 story hidden) · 2 exported symbols',
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

const healthHtml = htmlOf(
  graphOf(
    modelOf(
      {
        'packages/app/src/main.ts': {
          edges: [
            edge('packages/ui/src/cn.ts', {
              line: 3,
              names: ['cn'],
              internal: {
                specifier: '../../ui/src/cn',
                reach: 'relative',
                package: 'ui' as PackageName,
                instead: 'ui'
              }
            })
          ]
        },
        'packages/ui/src/cn.ts': {
          symbols: [defines('cn')],
          edges: [edge('packages/ui/src/theme.ts', { names: ['theme'], line: 2 })]
        },
        'packages/ui/src/theme.ts': {
          symbols: [defines('theme')],
          edges: [edge('packages/ui/src/cn.ts', { names: ['cn'], line: 4 })]
        }
      },
      { app: 'packages/app', ui: 'packages/ui' }
    ),
    emptyConfig
  ),
  {
    template: 'https://github.com/acme/app/blob/abc1234/{path}#L{line}',
    prefix: '',
    shortCommit: 'abc1234',
    uncommitted: false,
    unpushed: 0,
    remote: 'origin'
  }
)

test(
  'the Health section opens on demand, and a finding selects its module and links to its line',
  { skip },
  async t => {
    const tab = await openPage(t, chrome!)
    await tab.load(healthHtml)
    const run = <T>(body: string) => tab.run<T>(helpers + body)
    assert.deepEqual(
      await run(`const health = document.getElementById('health-toggle')
      return {
        tag: health.tagName,
        expanded: health.getAttribute('aria-expanded'),
        controls: health.getAttribute('aria-controls'),
        label: health.textContent.replace(/\\s+/g, ' ').trim(),
        open: visible(document.getElementById('health-body'))
      }`),
      {
        tag: 'BUTTON',
        expanded: 'false',
        controls: 'health-body',
        label: 'Health 1 import cycle · 0 oversized areas · 1 internal import',
        open: false
      }
    )
    assert.deepEqual(
      await run(`document.getElementById('health-toggle').click(); await frame()
      const groups = [...document.querySelectorAll('.health-group h3')].map(node => node.textContent)
      const finding = [...document.querySelectorAll('.finding')].find(node =>
        node.textContent.includes('../../ui/src/cn'))
      return {
        expanded: document.getElementById('health-toggle').getAttribute('aria-expanded'),
        groups,
        finding: finding.querySelector('.finding-details').textContent,
        href: finding.querySelector('.source-link').href
      }`),
      {
        expanded: 'true',
        groups: ['Import cycles 1', 'Oversized areas 0', 'Imports into another package 1'],
        finding: '../../ui/src/cn cn, relative path into ui, use ui',
        href: 'https://github.com/acme/app/blob/abc1234/packages/app/src/main.ts#L3'
      }
    )
    assert.deepEqual(
      await run(`const finding = [...document.querySelectorAll('.finding')].find(node =>
        node.textContent.includes('../../ui/src/cn'))
      finding.querySelector('.finding-select').click(); await frame()
      const row = [...box('packages/app/src').querySelectorAll('.module')]
        .find(node => node.querySelector('.module-name').textContent === 'main.ts')
      return {
        hash: decodeURIComponent(location.hash),
        selected: row.querySelector('.module-select').getAttribute('aria-pressed'),
        focused: document.activeElement === row.querySelector('.module-select')
      }`),
      { hash: '#module=packages/app/src/main.ts', selected: 'true', focused: true }
    )
    assert.deepEqual(
      await run(`document.getElementById('health-toggle').click(); await frame()
      return {
        expanded: document.getElementById('health-toggle').getAttribute('aria-expanded'),
        open: visible(document.getElementById('health-body'))
      }`),
      { expanded: 'false', open: false }
    )
  }
)

const serverDir = 'packages/features/calendar/scheduling/availability/server'
const longArea = `${serverDir}/src/calendar/scheduling/availability/slots`
const longModule = `${longArea}/slots.worker.module.ts`
const manyPackages = Object.fromEntries(
  Array.from({ length: 112 }, (_, i) => [`@acme/tool-${i}`, `packages/tool-${i}`])
)
const workspaceHtml = htmlOf(
  graphOf(
    modelOf(
      {
        'packages/plugin/esbuild.js': { edges: [edge(longModule)] },
        ...Object.fromEntries(Object.values(manyPackages).map(dir => [`${dir}/index.ts`, {}])),
        [longModule]: { symbols: [defines('availableSlots')] },
        [`${longArea}/booking.ts`]: {},
        [`${longArea}/dates.ts`]: {},
        [`${longArea}/slots.test.ts`]: { edges: [edge(longModule)] },
        [`${longArea}/slots.stories.tsx`]: {}
      },
      { '@acme/plugin': 'packages/plugin', '@acme/server': serverDir, ...manyPackages }
    ),
    emptyConfig
  )
)

test(
  'the map opens on the largest code package and keeps 114 package choices compact',
  { skip },
  async t => {
    const tab = await openPage(t, chrome!)
    await tab.load(workspaceHtml)
    assert.equal(
      await tab.run("return document.querySelector('.package h2').textContent"),
      '@acme/server'
    )
    assert.ok(
      await tab.run(
        "return document.getElementById('packages').getBoundingClientRect().height <= 60"
      )
    )
    assert.equal(await tab.run("return document.querySelectorAll('#packages option').length"), 114)
    assert.equal(
      await tab.run(`
    const choice = document.querySelector('#packages select')
    choice.value = [...choice.options].find(option => option.textContent === '@acme/plugin').value
    choice.dispatchEvent(new Event('change'))
    return document.querySelector(location.hash + ' h2').textContent
  `),
      '@acme/plugin'
    )
  }
)

for (const width of [390, 1280]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(
      `long map paths fit ${width}px in ${colorScheme} mode and wrap at slashes`,
      { skip },
      async t => {
        const tab = await openPage(t, chrome!, { width, colorScheme })
        await tab.load(workspaceHtml)
        const state = await tab.run<{
          width: number
          scrollWidth: number
          background: string
          filenameLines: number
          splits: string[]
        }>(`
        const name = [...document.querySelectorAll('.module-name')]
          .find(node => node.textContent === 'slots.worker.module.ts')
        const range = document.createRange()
        const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT)
        const tops = new Set()
        while (walker.nextNode()) {
          range.selectNodeContents(walker.currentNode)
          for (const rect of range.getClientRects()) tops.add(rect.top)
        }
        return {
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          background: getComputedStyle(document.body).backgroundColor,
          filenameLines: tops.size,
          splits: [...document.querySelectorAll('.area-select wbr, .module-name wbr')]
            .map(node => node.previousSibling.textContent)
        }
      `)
        assert.equal(state.width, width)
        assert.ok(
          state.scrollWidth <= width,
          `${state.scrollWidth}px page overflows ${width}px viewport`
        )
        assert.equal(
          state.background,
          colorScheme === 'dark' ? 'rgb(19, 19, 21)' : 'rgb(248, 248, 246)'
        )
        assert.equal(state.filenameLines, 1, 'keep the filename together')
        assert.ok(state.splits.length > 0)
        assert.ok(
          state.splits.every(part => part.endsWith('/')),
          'only insert path breaks after slashes'
        )
        if (process.env['PAGE_SCREENSHOT_DIR']) {
          await tab.screenshot(
            `${process.env['PAGE_SCREENSHOT_DIR']}/dev-729-${width}-${colorScheme}.png`
          )
          await tab.run(
            "document.querySelector('.package').scrollIntoView(); await new Promise(resolve => requestAnimationFrame(resolve))"
          )
          await tab.screenshot(
            `${process.env['PAGE_SCREENSHOT_DIR']}/dev-729-${width}-${colorScheme}-map.png`
          )
        }
      }
    )
  }
}
