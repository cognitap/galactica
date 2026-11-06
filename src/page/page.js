import { indexesOf } from './indexes.js'
import { hrefOf, noteOf } from './links.js'
import { entriesOf, hiddenBy, search } from './search.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../page-data.ts').PageArea} PageArea */
/** @typedef {import('../page-data.ts').PageModule} PageModule */
/** @typedef {import('../page-data.ts').PagePackage} PagePackage */
/** @typedef {import('../page-data.ts').IndexGaps} IndexGaps */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./search.js').SearchEntry} SearchEntry */
/** @typedef {import('./search.js').Target} Target */
/** @typedef {{ readonly kind: 'area' | 'module', readonly index: number }} Selection */
/** @typedef {'uses' | 'used-by'} Relation */

/** Folder colours the stylesheet defines. Further folders share one neutral colour. */
const PALETTE = 8

/** @param {string} id */
const byId = id => /** @type {HTMLElement} */ (document.getElementById(id))

/** @type {PageData} */
const data = JSON.parse(byId('galactica-data').textContent ?? '')

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** One formatter for every count, since `toLocaleString` builds a new one on each call. */
const formatted = new Intl.NumberFormat('en').format

/**
 * @param {number} count
 * @param {string} one
 * @param {string} [many]
 */
const plural = (count, one, many = `${one}s`) => `${formatted(count)} ${count === 1 ? one : many}`

/** @param {number} folder */
const folderKey = folder => (folder < PALETTE ? String(folder) : 'other')

/** Eight rows read at a glance; on large maps this keeps most areas open and closes the few big ones that hold most modules. */
const COLLAPSE_PAST = 8

const KINDS = /** @type {const} */ ({
  source: { label: 'Source', one: 'source module', many: 'source modules' },
  config: { label: 'Config', one: 'config module', many: 'config modules' },
  test: { label: 'Tests', one: 'test', many: 'tests' },
  story: { label: 'Stories', one: 'story', many: 'stories' }
})

/** Tests and stories only use the code, so the map opens on the code. */
const SHOWN_AT_FIRST = /** @type {ReadonlySet<ModuleKind>} */ (new Set(['source', 'config']))

/**
 * Text that a narrow box may break only after a slash or before a dot, so a
 * file name never splits inside a word.
 * @param {string} text
 */
function breakable(text) {
  /** @type {Node[]} */
  const nodes = []
  for (const part of text.split(/(?<=\/)|(?=\.)/)) {
    if (nodes.length > 0) nodes.push(element('wbr'))
    nodes.push(document.createTextNode(part))
  }
  return nodes
}

/**
 * A path whose last segment reads first, with the folders before it dimmed.
 * @param {string} path
 */
function areaTitle(path) {
  if (path === '.') return [element('span', 'package-root', 'package root')]
  const slash = path.lastIndexOf('/') + 1
  const folders = element('span', 'folders-of')
  folders.append(...breakable(path.slice(0, slash)))
  return [folders, ...breakable(path.slice(slash))]
}

/**
 * @param {number} importers
 * @param {number} imports
 */
function arrows(importers, imports) {
  const node = element('span', 'arrows', `← ${importers}  → ${imports}`)
  node.title = `Imported by ${plural(importers, 'module')} outside tests and stories, imports ${plural(imports, 'module')}`
  return node
}

/**
 * A toggle button that selects what `label` names.
 * @param {string} className
 * @param {string} label
 */
function selectButton(className, label) {
  const button = element('button', className)
  button.setAttribute('type', 'button')
  button.setAttribute('aria-pressed', 'false')
  button.setAttribute('aria-label', label)
  button.title = label
  return button
}

/**
 * `node` wrapped in a link to the module, or to a line of it, when the page has
 * a source to link to. The address is assigned as a property, so it is never parsed as markup.
 * @template {HTMLElement} T
 * @param {T} node
 * @param {string} path
 * @param {number | undefined} line
 * @param {string} name the link's accessible name, which includes the path and the line
 */
function linked(node, path, line, name) {
  const { source } = data
  if (source === null) return node
  const anchor = /** @type {HTMLAnchorElement} */ (element('a', 'source-link'))
  anchor.setAttribute('aria-label', name)
  anchor.href = hrefOf(source, path, line)
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.append(...node.childNodes)
  node.append(anchor)
  return node
}

const relationTag = () => {
  const tag = element('span', 'relation-tag')
  tag.hidden = true
  return tag
}

/**
 * @param {PageModule} module
 * @param {PageModule['symbols'][number]} symbol
 */
function symbolItem(module, symbol) {
  const entry = element('li', 'symbol')
  const kind = symbol.default ? `default ${symbol.kind}` : symbol.kind
  const head = element('div', 'symbol-head')
  const where = linked(
    element('span', '', `line ${symbol.line}`),
    module.path,
    symbol.line,
    `Open ${symbol.name} at line ${symbol.line} of ${module.path} in the repository`
  )
  head.append(element('span', '', kind), where)
  entry.append(head, element('code', 'signature', symbol.signature))
  if (symbol.doc !== undefined) entry.append(element('p', 'doc', symbol.doc))
  return entry
}

/**
 * @param {PageModule} module
 * @param {string} usualKind the kind most modules of its area have, which needs no tag
 */
function moduleItem(module, usualKind) {
  const item = element('li', 'module')
  const select = selectButton('module-select', `Select ${module.path}`)
  const tag = relationTag()
  const name = element('span', 'module-name')
  name.append(...breakable(module.label))
  linked(name, module.path, undefined, `Open ${module.path} in the repository`)
  const head = [name, tag]
  if (module.kind !== usualKind) head.push(element('span', 'kind-tag', module.kind))
  head.push(arrows(module.importers, module.imports))
  if (module.symbols.length === 0) {
    const row = element('div', 'module-row')
    row.title = `${module.path}, no exported symbols`
    row.append(...head)
    item.append(row, select)
    return { item, select, tag, symbolAt: undefined }
  }
  const details = /** @type {HTMLDetailsElement} */ (element('details'))
  const summary = element('summary')
  summary.title = `${module.path}, ${plural(module.symbols.length, 'exported symbol')}`
  summary.append(...head)
  details.append(summary)
  /** @type {HTMLElement[] | undefined} */
  let entries
  const listSymbols = () => {
    if (entries !== undefined) return entries
    entries = module.symbols.map(symbol => symbolItem(module, symbol))
    const symbols = element('ul', 'symbols')
    symbols.append(...entries)
    details.append(symbols)
    return entries
  }
  summary.addEventListener('click', listSymbols)
  details.addEventListener('toggle', listSymbols)
  /** @param {number} position */
  const symbolAt = position => {
    const entry = listSymbols()[position]
    details.open = true
    return entry
  }
  item.append(details, select)
  return { item, select, tag, symbolAt }
}

/** @typedef {ReturnType<typeof areaBox>} AreaView */

/** @param {PageArea['kinds']} kinds */
const usualKindOf = kinds =>
  /** @type {(keyof PageArea['kinds'])[]} */ (Object.keys(kinds)).reduce((usual, kind) =>
    kinds[kind] > kinds[usual] ? kind : usual
  )

/** @typedef {{ readonly index: number } & ReturnType<typeof moduleItem>} ModuleView */

/**
 * @param {number} index
 * @param {(view: ModuleView) => void} onRowDrawn
 * @param {() => void} onExpand
 */
function areaBox(index, onRowDrawn, onExpand) {
  const area = data.areas[index]
  const box = element('article', 'area')
  box.dataset.folder = folderKey(area.folder)
  const head = element('header', 'area-head')
  const title = element('h3')
  const select = selectButton('area-select', `Select ${area.path}`)
  select.append(...areaTitle(area.label))
  title.append(select)
  const tag = relationTag()
  const list = element('ul', 'modules')
  list.id = `area-${index}-modules`
  const toggle = element('button', 'area-toggle')
  toggle.setAttribute('type', 'button')
  toggle.setAttribute('aria-controls', list.id)
  const count = element('span')
  const symbols = element('span')
  const meta = element('p', 'area-meta')
  meta.append(toggle, count, symbols)
  if (area.cycle) meta.append(element('span', 'cycle-mark', 'cycle'))
  head.append(title, tag, meta)
  box.append(head, list)

  const usualKind = usualKindOf(area.kinds)
  /** @type {Map<number, ModuleView>} */
  const views = new Map()
  /** @param {number} module */
  const viewOf = module => {
    let view = views.get(module)
    if (view === undefined) {
      view = { index: module, ...moduleItem(data.modules[module], usualKind) }
      views.set(module, view)
      onRowDrawn(view)
    }
    return view
  }
  /** @type {ReadonlySet<ModuleKind>} */
  let kinds = new Set()
  let opened = false
  const listed = () => area.modules.filter(module => kinds.has(data.modules[module].kind))
  const update = () => {
    const shown = listed()
    const exported = shown.reduce((sum, module) => sum + data.modules[module].symbols.length, 0)
    const collapsible = shown.length > COLLAPSE_PAST
    const open = !collapsible || opened
    toggle.hidden = !collapsible
    count.hidden = collapsible
    toggle.setAttribute('aria-expanded', String(open))
    toggle.textContent = plural(shown.length, 'module')
    count.textContent = toggle.textContent
    symbols.textContent = plural(exported, 'symbol')
    list.replaceChildren(...(open ? shown.map(module => viewOf(module).item) : []))
    list.hidden = !open
    box.hidden = shown.length === 0
    box.style.setProperty('--weight', String(Math.sqrt(exported)))
    return { shown: shown.length, exported }
  }
  toggle.addEventListener('click', () => {
    opened = toggle.getAttribute('aria-expanded') !== 'true'
    update()
    if (opened) onExpand()
  })
  /** @param {ReadonlySet<ModuleKind>} shown */
  const filter = shown => {
    kinds = shown
    return update()
  }
  const reveal = () => {
    opened = true
    update()
  }
  return { index, box, select, tag, filter, reveal }
}

/**
 * @param {PagePackage} pkg
 */
function cyclesSection(pkg) {
  const section = element('section', 'cycles')
  section.append(element('h3', '', 'Cycles'))
  if (pkg.areaCycles.length > 0) {
    section.append(element('h4', '', 'Areas that import each other'))
    const list = element('ul', 'cycle-list')
    for (const cycle of pkg.areaCycles) {
      const entry = element('li')
      const names = cycle.areas.map(index => data.areas[index].label).join(', ')
      const closing = element('ul', 'closing')
      for (const { from, to, line } of cycle.edges) {
        closing.append(
          element('li', '', `${data.modules[from].path}:${line} → ${data.modules[to].path}`)
        )
      }
      entry.append(element('p', 'cycle-areas', names), closing)
      list.append(entry)
    }
    section.append(list)
  }
  if (pkg.moduleCycles.length > 0) {
    section.append(element('h4', '', 'Modules that import each other'))
    const list = element('ul', 'cycle-list')
    for (const cycle of pkg.moduleCycles) {
      const entry = element('li')
      const members = element('ul', 'closing')
      for (const index of cycle) members.append(element('li', '', data.modules[index].path))
      entry.append(members)
      list.append(entry)
    }
    section.append(list)
  }
  return section
}

/**
 * @param {PagePackage} pkg
 * @param {number} index
 * @param {(area: number) => AreaView} boxOf
 */
function packageSection(pkg, index, boxOf) {
  const section = element('section', 'package')
  section.id = `package-${index}`
  const head = element('header', 'package-head')
  const heading = element('h2', '', pkg.name)
  heading.id = `package-${index}-name`
  section.setAttribute('aria-labelledby', heading.id)
  const dir = element('p')
  dir.append(element('code', '', pkg.dir === '.' ? 'repository root' : pkg.dir))
  head.append(heading, dir)

  const rows = element('div', 'rows')
  const lines = pkg.rows.map(row => {
    const line = element('div', 'row')
    const areas = element('div', 'row-areas')
    const boxes = row.map(boxOf)
    areas.append(...boxes.map(({ box }) => box))
    line.append(element('p', 'row-label', `Layer ${data.areas[row[0]].layer}`), areas)
    rows.append(line)
    return { line, boxes }
  })
  const empty = element('p', 'empty', 'Every module here is of a kind the filter hides.')
  section.append(head, rows, empty)
  if (pkg.areaCycles.length > 0 || pkg.moduleCycles.length > 0) section.append(cyclesSection(pkg))
  return { section, lines, empty }
}

function legend() {
  const folders = byId('folders')
  data.folders.slice(0, PALETTE).forEach((folder, index) => {
    const item = element('li')
    item.dataset.folder = String(index)
    const name = folder === '.' ? element('span', '', 'package root') : element('code', '', folder)
    item.append(element('span', 'swatch'), name)
    folders.append(item)
  })
  if (data.folders.length > PALETTE) {
    const item = element('li')
    item.dataset.folder = 'other'
    item.append(element('span', 'swatch'), element('span', '', 'other folders'))
    folders.append(item)
  }
}

function packageNav() {
  if (data.packages.length < 2) return
  const nav = byId('packages')
  data.packages.forEach((pkg, index) => {
    const link = element('a', '', pkg.name)
    link.setAttribute('href', `#package-${index}`)
    nav.append(link)
  })
  nav.hidden = false
}

/** @param {readonly ModuleKind[]} kinds */
const kindNames = kinds => kinds.map(kind => KINDS[kind].many).join(' and ')

/**
 * @param {readonly SearchEntry[]} entries
 * @param {() => ReadonlySet<ModuleKind>} shownKinds
 * @param {(target: Target) => void} go
 */
function searchField(entries, shownKinds, go) {
  const input = /** @type {HTMLInputElement} */ (byId('search'))
  const list = byId('search-results')
  /** @type {readonly SearchEntry[]} */
  let results = []
  let active = -1

  /** @param {number} index */
  const activate = index => {
    active = index
    ;[...list.children].forEach((option, position) =>
      option.setAttribute('aria-selected', String(position === index))
    )
    if (index < 0) return input.removeAttribute('aria-activedescendant')
    input.setAttribute('aria-activedescendant', `search-option-${index}`)
    list.children[index].scrollIntoView({ block: 'nearest' })
  }
  const close = () => {
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    activate(-1)
  }
  /** @param {number} index */
  const choose = index => {
    const { text, target } = results[index]
    input.value = text
    close()
    go(target)
  }
  /**
   * @param {SearchEntry} entry
   * @param {number} index
   */
  const option = (entry, index) => {
    const node = element('li', 'result')
    node.id = `search-option-${index}`
    node.setAttribute('role', 'option')
    const name = element('span', 'result-name')
    name.append(...breakable(entry.text))
    node.append(name, element('span', 'result-kind', entry.kind))
    node.append(element('span', 'result-where', entry.where))
    const hidden = hiddenBy(entry, shownKinds())
    if (hidden.length > 0) {
      node.append(element('span', 'result-hidden', `${kindNames(hidden)} hidden by the filter`))
    }
    node.addEventListener('mousedown', event => event.preventDefault())
    node.addEventListener('click', () => choose(index))
    return node
  }
  const refresh = () => {
    if (input.value.trim() === '') return close()
    results = search(entries, input.value, shownKinds())
    list.replaceChildren(...results.map(option))
    if (results.length === 0) {
      const none = element('li', 'no-results', 'No matches')
      none.setAttribute('role', 'option')
      none.setAttribute('aria-disabled', 'true')
      list.append(none)
    }
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    activate(results.length > 0 ? 0 : -1)
  }

  input.addEventListener('input', refresh)
  input.addEventListener('blur', close)
  input.addEventListener('keydown', event => {
    const open = !list.hidden
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) return refresh()
      const step = event.key === 'ArrowDown' ? 1 : -1
      activate(Math.min(Math.max(active + step, 0), results.length - 1))
    } else if (event.key === 'Enter' && open && active >= 0) {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (open) close()
      else input.value = ''
    }
  })
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return
    const target = /** @type {HTMLElement} */ (event.target)
    if (target.isContentEditable || target.matches('input, textarea, select')) return
    event.preventDefault()
    input.focus()
    input.select()
  })
  return { refresh: () => !list.hidden && refresh() }
}

const RELATIONS = /** @type {const} */ ({
  uses: { one: 'dependency', many: 'dependencies' },
  'used-by': { one: 'dependent', many: 'dependents' }
})

/** @param {Selection} selection */
const subjectOf = ({ kind, index }) => (kind === 'area' ? data.areas[index] : data.modules[index])

/**
 * @param {Selection} selection
 * @param {ReadonlySet<ModuleKind>} shown
 */
function summaryOf(selection, shown) {
  const subject = subjectOf(selection)
  const parts = [
    element('span', 'selection-kind', selection.kind),
    element('code', 'selection-path', subject.path),
    element('span', 'count-uses', `uses ${formatted(subject.uses.length)}`),
    element('span', 'count-used-by', `used by ${formatted(subject.usedBy.length)}`)
  ]
  if (shown.has('test')) {
    parts.push(element('span', 'count-used-by', plural(subject.usedByTests.length, 'test')))
  }
  const related = new Set([subject.uses, subject.usedBy, subject.usedByTests].flatMap(indexesOf))
  /** @type {Map<ModuleKind, number>} */
  const hidden = new Map()
  for (const index of related) {
    const { kind } = data.modules[index]
    if (!shown.has(kind)) hidden.set(kind, (hidden.get(kind) ?? 0) + 1)
  }
  if (hidden.size > 0) {
    const counts = /** @type {ModuleKind[]} */ (Object.keys(KINDS))
      .filter(kind => hidden.has(kind))
      .map(kind => plural(hidden.get(kind) ?? 0, KINDS[kind].one, KINDS[kind].many))
    parts.push(element('span', 'count-hidden', `${counts.join(' and ')} hidden by the filter`))
  }
  return parts
}

/**
 * Marks the selection, what it uses and what uses it, by toggling classes on
 * the boxes and rows already drawn, so a selection redraws nothing.
 * @param {readonly AreaView[]} areaViews
 * @param {ReadonlyMap<number, ModuleView>} drawnRows
 */
function highlighter(areaViews, drawnRows) {
  /** @type {(() => void)[]} */
  let undo = []
  /**
   * @param {HTMLElement} node
   * @param {readonly string[]} classes
   */
  const add = (node, classes) => {
    node.classList.add(...classes)
    undo.push(() => node.classList.remove(...classes))
  }
  /**
   * @param {HTMLElement} tag
   * @param {string} text
   */
  const label = (tag, text) => {
    tag.textContent = text
    tag.hidden = false
    undo.push(() => {
      tag.hidden = true
    })
  }
  /** @param {HTMLElement} select */
  const press = select => {
    select.setAttribute('aria-pressed', 'true')
    undo.push(() => select.setAttribute('aria-pressed', 'false'))
  }

  /**
   * @param {Selection | undefined} selection
   * @param {ReadonlySet<ModuleKind>} shown
   */
  return (selection, shown) => {
    for (const step of undo) step()
    undo = []
    document.body.classList.toggle('has-selection', selection !== undefined)
    if (selection === undefined) return
    document.body.dataset.selection = selection.kind
    const subject = subjectOf(selection)
    /** @type {Map<number, Set<Relation>>} */
    const modules = new Map()
    /**
     * @param {IndexGaps} gaps
     * @param {Relation} relation
     */
    const relate = (gaps, relation) => {
      for (const index of indexesOf(gaps)) {
        if (shown.has(data.modules[index].kind)) {
          modules.set(index, (modules.get(index) ?? new Set()).add(relation))
        }
      }
    }
    relate(subject.uses, 'uses')
    relate(subject.usedBy, 'used-by')
    relate(subject.usedByTests, 'used-by')

    /** @type {Map<number, Record<Relation, number>>} */
    const areas = new Map()
    for (const [index, relations] of modules) {
      const view = drawnRows.get(index)
      if (view !== undefined) {
        add(
          view.item,
          [...relations].map(relation => `is-${relation}`)
        )
        label(view.tag, [...relations].map(relation => RELATIONS[relation].one).join(' · '))
      }
      const area = data.modules[index].area
      const counts = areas.get(area) ?? { uses: 0, 'used-by': 0 }
      for (const relation of relations) counts[relation] += 1
      areas.set(area, counts)
    }
    for (const [index, counts] of areas) {
      const { box, tag } = areaViews[index]
      const relations = /** @type {Relation[]} */ (Object.keys(counts)).filter(
        key => counts[key] > 0
      )
      add(
        box,
        relations.map(relation => `is-${relation}`)
      )
      label(
        tag,
        relations
          .map(relation =>
            plural(counts[relation], RELATIONS[relation].one, RELATIONS[relation].many)
          )
          .join(' · ')
      )
    }
    if (selection.kind === 'area') {
      const { box, select } = areaViews[selection.index]
      add(box, ['is-selected'])
      press(select)
    } else {
      add(areaViews[data.modules[selection.index].area].box, ['has-selected'])
      const view = drawnRows.get(selection.index)
      if (view === undefined) return
      add(view.item, ['is-selected'])
      press(view.select)
    }
  }
}

/** @param {Selection | undefined} selection */
function fragmentOf(selection) {
  return selection === undefined
    ? ''
    : `#${selection.kind}=${encodeURIComponent(subjectOf(selection).path)}`
}

/**
 * The selection a fragment names, undefined for any other fragment.
 * @param {string} fragment
 * @returns {Selection | undefined}
 */
function selectionOf(fragment) {
  const match = /^#(area|module)=(.*)$/.exec(fragment)
  if (match === null) return undefined
  let path = ''
  try {
    path = decodeURIComponent(match[2])
  } catch {
    return undefined
  }
  const kind = /** @type {Selection['kind']} */ (match[1])
  const index = (kind === 'area' ? data.areas : data.modules).findIndex(item => item.path === path)
  return index < 0 ? undefined : { kind, index }
}

/**
 * @param {(kind: ModuleKind) => void} flip
 */
function kindFilter(flip) {
  /** @type {Map<ModuleKind, number>} */
  const counts = new Map()
  for (const { kind } of data.modules) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  const group = byId('kind-filter')
  const buttons = /** @type {ModuleKind[]} */ (Object.keys(KINDS))
    .filter(kind => counts.has(kind))
    .map(kind => {
      const button = element('button', 'toggle', KINDS[kind].label)
      button.setAttribute('type', 'button')
      button.append(' ', element('span', 'kind-count', formatted(counts.get(kind) ?? 0)))
      button.addEventListener('click', () => flip(kind))
      return { kind, button }
    })
  group.append(...buttons.map(({ button }) => button))
  /** @param {ReadonlySet<ModuleKind>} shown */
  return shown => {
    for (const { kind, button } of buttons) {
      button.setAttribute('aria-pressed', String(shown.has(kind)))
    }
  }
}

/**
 * @param {Target} target
 * @param {ReadonlySet<ModuleKind>} shown
 * @returns {readonly ModuleKind[]}
 */
function missingKinds(target, shown) {
  const held =
    target.kind === 'area'
      ? /** @type {ModuleKind[]} */ (Object.keys(KINDS)).filter(
          kind => data.areas[target.area].kinds[kind] > 0
        )
      : [data.modules[target.module].kind]
  return held.some(kind => shown.has(kind)) ? [] : held
}

/**
 * One finding: a button that selects its module or area on the map, what the
 * finding says, and a link to its line when the page links to source.
 * @param {string} label
 * @param {() => void} choose
 * @param {readonly (string | Node)[]} details
 * @param {{ readonly path: string, readonly line: number } | undefined} at
 */
function findingItem(label, choose, details, at) {
  const item = element('li', 'finding')
  const select = element('button', 'finding-select')
  select.setAttribute('type', 'button')
  select.append(...breakable(label))
  select.addEventListener('click', choose)
  const about = element('span', 'finding-details')
  about.append(...details)
  item.append(select, about)
  if (at !== undefined) {
    item.append(
      linked(
        element('span', 'finding-line', `line ${at.line}`),
        at.path,
        at.line,
        `Open line ${at.line} of ${at.path} in the repository`
      )
    )
  }
  return item
}

/**
 * @param {string} title
 * @param {number} count
 * @param {string | undefined} note
 * @param {readonly HTMLElement[]} items
 */
function findingGroup(title, count, note, items) {
  const group = element('section', 'health-group')
  const heading = element('h3', '', title)
  heading.append(' ', element('span', 'health-count', formatted(count)))
  group.append(heading)
  if (note !== undefined) group.append(element('p', 'health-note', note))
  if (items.length === 0) {
    group.append(element('p', 'health-none', 'None'))
  } else {
    const list = element('ul', 'findings')
    list.append(...items)
    group.append(list)
  }
  return group
}

/** @param {readonly string[]} names */
const namesText = names => (names.length === 0 ? 'side effect only' : names.join(', '))

/**
 * The findings of `health`, grouped by kind.
 * @param {(target: Target) => void} go
 */
function healthGroups(go) {
  const { health } = data
  /** @param {number} module */
  const goModule = module => () => go({ kind: 'module', module })
  const cycles = health.cycles.map(cycle => {
    const item = element('li', 'health-cycle')
    const members = cycle.modules.map(index => data.modules[index].path)
    const shown = members.slice(0, 3).join(', ')
    const more = members.length > 3 ? ` and ${members.length - 3} more` : ''
    const use = cycle.loadTime ? 'used at load time' : 'used later'
    item.append(
      element(
        'p',
        'health-cycle-modules',
        `${plural(members.length, 'module')}, ${use}: ${shown}${more}`
      )
    )
    const breaks = element('ul', 'findings')
    breaks.append(
      ...cycle.breaks.map(({ from, to, line, names }) =>
        findingItem(
          data.modules[from].path,
          goModule(from),
          [`break the import of ${data.modules[to].path}: ${namesText(names)}`],
          { path: data.modules[from].path, line }
        )
      )
    )
    item.append(breaks)
    return item
  })
  const oversized = health.oversized.map(({ area, modules, median }) =>
    findingItem(
      data.areas[area].path,
      () => go({ kind: 'area', area }),
      [`${plural(modules, 'source module')}, package median ${formatted(median)}`],
      undefined
    )
  )
  const internal = health.internal.map(finding => {
    const reach =
      finding.reach === 'relative'
        ? `relative path into ${finding.package}`
        : `subpath ${finding.package} does not export`
    const instead = finding.instead === null ? 'no public entry gives it' : 'use '
    const details = [
      element('code', '', finding.specifier),
      ` ${namesText(finding.names)}, ${reach}, ${instead}`
    ]
    if (finding.instead !== null) details.push(element('code', '', finding.instead))
    return findingItem(data.modules[finding.from].path, goModule(finding.from), details, {
      path: data.modules[finding.from].path,
      line: finding.line
    })
  })
  const rule =
    health.areaModules === null
      ? 'At least 20 source modules and 5 times the median area of their package.'
      : `More than ${plural(health.areaModules, 'source module')}, by health.areaModules.`
  return [
    findingGroup(
      'Import cycles',
      cycles.length,
      'Each import to break points back up the cycle’s dependency order.',
      cycles
    ),
    findingGroup('Oversized areas', oversized.length, rule, oversized),
    findingGroup(
      'Imports into another package',
      internal.length,
      'A relative path into another package, or a subpath its exports do not list. Tests and stories are left out.',
      internal
    )
  ]
}

/**
 * The Health section above the map, closed at first. Its findings are drawn
 * the first time it opens.
 * @param {(target: Target) => void} go
 */
function healthSection(go) {
  const { health } = data
  const toggle = byId('health-toggle')
  const body = byId('health-body')
  toggle.append(
    element(
      'span',
      'health-counts',
      [
        plural(health.cycles.length, 'import cycle'),
        plural(health.oversized.length, 'oversized area'),
        plural(health.internal.length, 'internal import')
      ].join(' · ')
    )
  )
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    if (open && body.childElementCount === 0) body.append(...healthGroups(go))
    toggle.setAttribute('aria-expanded', String(open))
    body.hidden = !open
  })
}

function draw() {
  byId('repository').textContent = data.repository
  const note = data.source === null ? undefined : noteOf(data.source)
  if (note !== undefined) {
    byId('source-note').textContent = note
    byId('source-note').hidden = false
  }
  legend()
  packageNav()

  /** @type {Selection | undefined} */
  let selection
  let shown = SHOWN_AT_FIRST
  /** @type {AreaView[]} */
  const areaViews = []
  /** @type {Map<number, ModuleView>} */
  const moduleViews = new Map()
  const light = highlighter(areaViews, moduleViews)
  const bar = byId('selection')
  const describe = () => {
    light(selection, shown)
    bar.hidden = selection === undefined
    if (selection !== undefined)
      byId('selection-summary').replaceChildren(...summaryOf(selection, shown))
  }
  /** @param {Selection | undefined} next */
  const select = next => {
    selection = next
    describe()
    history.replaceState(null, '', location.href.split('#')[0] + fragmentOf(selection))
  }
  /** @param {Selection} next */
  const toggleSelection = next =>
    select(selection?.kind === next.kind && selection.index === next.index ? undefined : next)

  /** @param {ModuleView} view */
  const onRowDrawn = view => {
    moduleViews.set(view.index, view)
    view.select.addEventListener('click', () =>
      toggleSelection({ kind: 'module', index: view.index })
    )
  }
  /** @param {number} index */
  const boxOf = index => {
    const view = areaBox(index, onRowDrawn, describe)
    view.select.addEventListener('click', () => toggleSelection({ kind: 'area', index }))
    areaViews[index] = view
    return view
  }
  const sections = data.packages.map((pkg, index) => packageSection(pkg, index, boxOf))
  byId('map').append(...sections.map(({ section }) => section))

  byId('clear-selection').addEventListener('click', () => select(undefined))
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selection !== undefined && event.target !== byId('search')) {
      select(undefined)
    }
  })

  /** @param {ReadonlySet<ModuleKind>} kinds */
  const show = kinds => {
    shown = kinds
    pressed(shown)
    let areas = 0
    let modules = 0
    let symbols = 0
    for (const { filter } of areaViews) {
      const { shown: listed, exported } = filter(shown)
      areas += listed === 0 ? 0 : 1
      modules += listed
      symbols += exported
    }
    for (const { lines, empty } of sections) {
      for (const { line, boxes } of lines) line.hidden = boxes.every(({ box }) => box.hidden)
      empty.hidden = lines.some(({ line }) => !line.hidden)
    }
    byId('counts').textContent = [
      plural(data.packages.length, 'package'),
      plural(areas, 'area'),
      plural(modules, 'module'),
      plural(symbols, 'exported symbol')
    ].join(' · ')
  }

  /** @param {Target} target */
  const go = target => {
    const missing = missingKinds(target, shown)
    if (missing.length > 0) {
      show(new Set([...shown, ...missing]))
      field.refresh()
    }
    if (target.kind === 'area') {
      select({ kind: 'area', index: target.area })
      const { box, select: button } = areaViews[target.area]
      box.scrollIntoView({ block: 'nearest' })
      button.focus({ preventScroll: true })
      return
    }
    areaViews[data.modules[target.module].area].reveal()
    select({ kind: 'module', index: target.module })
    const view = /** @type {ModuleView} */ (moduleViews.get(target.module))
    const place =
      target.kind === 'symbol' && view.symbolAt !== undefined
        ? view.symbolAt(target.symbol)
        : view.item
    place.scrollIntoView({ block: 'center' })
    view.select.focus({ preventScroll: true })
  }

  const field = searchField(entriesOf(data), () => shown, go)
  healthSection(go)
  const pressed = kindFilter(kind => {
    const next = new Set(shown)
    if (!next.delete(kind)) next.add(kind)
    show(next)
    field.refresh()
    describe()
  })
  show(shown)

  const follow = () => {
    const named = selectionOf(location.hash)
    if (named === undefined) return
    go(
      named.kind === 'area'
        ? { kind: 'area', area: named.index }
        : { kind: 'module', module: named.index }
    )
  }
  follow()
  window.addEventListener('hashchange', follow)
}

draw()
