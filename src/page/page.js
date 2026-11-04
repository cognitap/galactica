import { entriesOf, search } from './search.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../page-data.ts').PageArea} PageArea */
/** @typedef {import('../page-data.ts').PageModule} PageModule */
/** @typedef {import('../page-data.ts').PagePackage} PagePackage */
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

/**
 * @param {number} count
 * @param {string} one
 * @param {string} [many]
 */
const plural = (count, one, many = `${one}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

/** @param {number} folder */
const folderKey = folder => (folder < PALETTE ? String(folder) : 'other')

/** @param {PageModule} module */
const isCode = module => module.kind === 'source' || module.kind === 'config'

const LISTED = 8

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

const relationTag = () => {
  const tag = element('span', 'relation-tag')
  tag.hidden = true
  return tag
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
  const head = [name, tag]
  if (module.kind !== usualKind) head.push(element('span', 'kind-tag', module.kind))
  head.push(arrows(module.importers, module.imports))
  if (module.symbols.length === 0) {
    const row = element('div', 'module-row')
    row.title = `${module.path}, no exported symbols`
    row.append(...head)
    item.append(row, select)
    return { item, select, tag, details: undefined, symbols: [] }
  }
  const details = /** @type {HTMLDetailsElement} */ (element('details'))
  const summary = element('summary')
  summary.title = `${module.path}, ${plural(module.symbols.length, 'exported symbol')}`
  summary.append(...head)
  const symbols = element('ul', 'symbols')
  const entries = module.symbols.map(symbol => {
    const entry = element('li', 'symbol')
    const kind = symbol.default ? `default ${symbol.kind}` : symbol.kind
    const symbolHead = element('div', 'symbol-head')
    symbolHead.append(element('span', '', kind), element('span', '', `line ${symbol.line}`))
    entry.append(symbolHead, element('code', 'signature', symbol.signature))
    if (symbol.doc !== undefined) entry.append(element('p', 'doc', symbol.doc))
    symbols.append(entry)
    return entry
  })
  details.append(summary, symbols)
  item.append(details, select)
  return { item, select, tag, details, symbols: entries }
}

/** @typedef {ReturnType<typeof areaBox>} AreaView */

/** @param {PageArea['kinds']} kinds */
const usualKindOf = kinds =>
  /** @type {(keyof PageArea['kinds'])[]} */ (Object.keys(kinds)).reduce((usual, kind) =>
    kinds[kind] > kinds[usual] ? kind : usual
  )

/**
 * An area box, and what the toggle and its "Show more" button update.
 * @param {number} index
 */
function areaBox(index) {
  const area = data.areas[index]
  const box = element('article', 'area')
  box.dataset.folder = folderKey(area.folder)
  const head = element('header', 'area-head')
  const title = element('h3')
  const select = selectButton('area-select', `Select ${area.path}`)
  select.append(...areaTitle(area.label))
  title.append(select)
  const tag = relationTag()
  const meta = element('p', 'area-meta')
  head.append(title, tag, meta)
  const list = element('ul', 'modules')
  const usualKind = usualKindOf(area.kinds)
  const items = area.modules.map(index => {
    const module = data.modules[index]
    const view = moduleItem(module, usualKind)
    list.append(view.item)
    return { index, module, ...view }
  })
  const more = element('button', 'more')
  more.setAttribute('type', 'button')
  more.setAttribute('aria-expanded', 'false')
  box.append(head, list, more)

  let showTests = false
  const update = () => {
    const expanded = more.getAttribute('aria-expanded') === 'true'
    let shown = 0
    let exported = 0
    for (const { module, item } of items) {
      const kept = showTests || isCode(module)
      item.hidden = !kept || (!expanded && shown >= LISTED)
      if (!kept) continue
      shown += 1
      exported += module.symbols.length
    }
    more.hidden = shown <= LISTED
    more.textContent = expanded ? 'Show fewer' : `Show ${shown - LISTED} more`
    box.hidden = shown === 0
    box.style.setProperty('--weight', String(Math.sqrt(exported)))
    meta.replaceChildren(
      element('span', '', plural(shown, 'module')),
      element('span', '', plural(exported, 'symbol'))
    )
    if (area.cycle) meta.append(element('span', 'cycle-mark', 'cycle'))
    return { shown, exported }
  }
  more.addEventListener('click', () => {
    more.setAttribute('aria-expanded', String(more.getAttribute('aria-expanded') !== 'true'))
    update()
  })
  /** @param {boolean} withTests */
  const filter = withTests => {
    showTests = withTests
    return update()
  }
  /** @param {HTMLElement} item a module of this box, listed past the first few when it has to be */
  const reveal = item => {
    if (!item.hidden) return
    more.setAttribute('aria-expanded', 'true')
    update()
  }
  return { index, box, select, tag, filter, reveal, items }
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
 */
function packageSection(pkg, index) {
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
    const boxes = row.map(areaBox)
    areas.append(...boxes.map(({ box }) => box))
    line.append(element('p', 'row-label', `Layer ${data.areas[row[0]].layer}`), areas)
    rows.append(line)
    return { line, boxes }
  })
  const empty = element('p', 'empty', 'Only tests and stories. Show them to see this package.')
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

/**
 * The search field, a combobox whose listbox offers the best matches.
 * @param {readonly SearchEntry[]} entries
 * @param {() => boolean} showingTests
 * @param {(target: Target) => void} go
 */
function searchField(entries, showingTests, go) {
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
    node.addEventListener('mousedown', event => event.preventDefault())
    node.addEventListener('click', () => choose(index))
    return node
  }
  const refresh = () => {
    if (input.value.trim() === '') return close()
    results = search(entries, input.value, showingTests())
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
 * What the selection bar says: the counts `uses` and `deps` give, and what the toggle hides.
 * @param {Selection} selection
 * @param {boolean} showTests
 */
function summaryOf(selection, showTests) {
  const subject = subjectOf(selection)
  const parts = [
    element('span', 'selection-kind', selection.kind),
    element('code', 'selection-path', subject.path),
    element('span', 'count-uses', `uses ${subject.uses.length.toLocaleString('en')}`),
    element('span', 'count-used-by', `used by ${subject.usedBy.length.toLocaleString('en')}`)
  ]
  if (showTests) {
    parts.push(element('span', 'count-used-by', plural(subject.usedByTests.length, 'test')))
    return parts
  }
  const hidden = new Set(subject.usedByTests)
  for (const index of [...subject.uses, ...subject.usedBy]) {
    if (!isCode(data.modules[index])) hidden.add(index)
  }
  if (hidden.size > 0) {
    parts.push(
      element(
        'span',
        'count-hidden',
        `${hidden.size.toLocaleString('en')} hidden with tests and stories`
      )
    )
  }
  return parts
}

/**
 * Marks the selection, what it uses and what uses it, by toggling classes on
 * the boxes and rows already drawn, so a selection redraws nothing.
 * @param {readonly AreaView[]} areaViews
 * @param {AreaView['items']} moduleViews
 */
function highlighter(areaViews, moduleViews) {
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
   * @param {boolean} showTests whether tests and stories that relate to it are marked
   */
  return (selection, showTests) => {
    for (const step of undo) step()
    undo = []
    document.body.classList.toggle('has-selection', selection !== undefined)
    if (selection === undefined) return
    document.body.dataset.selection = selection.kind
    const subject = subjectOf(selection)
    /** @type {Map<number, Set<Relation>>} */
    const modules = new Map()
    /**
     * @param {readonly number[]} indexes
     * @param {Relation} relation
     */
    const relate = (indexes, relation) => {
      for (const index of indexes) {
        if (showTests || isCode(data.modules[index])) {
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
      const { item, tag } = moduleViews[index]
      add(
        item,
        [...relations].map(relation => `is-${relation}`)
      )
      label(tag, [...relations].map(relation => RELATIONS[relation].one).join(' · '))
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
      const { item, select } = moduleViews[selection.index]
      add(item, ['is-selected'])
      add(areaViews[data.modules[selection.index].area].box, ['has-selected'])
      press(select)
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

function draw() {
  byId('repository').textContent = data.repository
  legend()
  packageNav()
  const sections = data.packages.map(packageSection)
  const boxes = sections.flatMap(({ lines }) => lines.flatMap(({ boxes }) => boxes))
  byId('map').append(...sections.map(({ section }) => section))
  /** @type {AreaView[]} */
  const areaViews = []
  /** @type {AreaView['items']} */
  const moduleViews = []
  for (const view of boxes) {
    areaViews[view.index] = view
    for (const item of view.items) moduleViews[item.index] = item
  }

  const light = highlighter(areaViews, moduleViews)
  const bar = byId('selection')
  /** @type {Selection | undefined} */
  let selection
  const describe = () => {
    light(selection, showingTests())
    bar.hidden = selection === undefined
    if (selection !== undefined)
      byId('selection-summary').replaceChildren(...summaryOf(selection, showingTests()))
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
  for (const view of areaViews) {
    view.select.addEventListener('click', () =>
      toggleSelection({ kind: 'area', index: view.index })
    )
  }
  for (const view of moduleViews) {
    view.select.addEventListener('click', () =>
      toggleSelection({ kind: 'module', index: view.index })
    )
  }
  byId('clear-selection').addEventListener('click', () => select(undefined))
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && selection !== undefined && event.target !== byId('search')) {
      select(undefined)
    }
  })

  /** @param {Target} target */
  const go = target => {
    if (target.kind === 'area') {
      select({ kind: 'area', index: target.area })
      const { box, select: button } = areaViews[target.area]
      box.scrollIntoView({ block: 'nearest' })
      button.focus({ preventScroll: true })
      return
    }
    select({ kind: 'module', index: target.module })
    const view = moduleViews[target.module]
    areaViews[data.modules[target.module].area].reveal(view.item)
    if (target.kind === 'symbol' && view.details !== undefined) view.details.open = true
    const shown = target.kind === 'symbol' ? view.symbols[target.symbol] : view.item
    shown.scrollIntoView({ block: 'center' })
    view.select.focus({ preventScroll: true })
  }

  const toggle = byId('toggle-tests')
  /** @param {boolean} showTests */
  const show = showTests => {
    toggle.setAttribute('aria-pressed', String(showTests))
    let areas = 0
    let modules = 0
    let symbols = 0
    for (const { filter } of boxes) {
      const { shown, exported } = filter(showTests)
      areas += shown === 0 ? 0 : 1
      modules += shown
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
  const showingTests = () => toggle.getAttribute('aria-pressed') === 'true'
  const field = searchField(entriesOf(data), showingTests, go)
  toggle.addEventListener('click', () => {
    show(!showingTests())
    field.refresh()
    describe()
  })
  show(false)

  /** Applies a fragment that names a selection, showing tests and stories when it is one. */
  const follow = () => {
    const named = selectionOf(location.hash)
    if (named === undefined) return
    const hidden =
      named.kind === 'area'
        ? data.areas[named.index].kinds.source + data.areas[named.index].kinds.config === 0
        : !isCode(data.modules[named.index])
    if (hidden && !showingTests()) show(true)
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
