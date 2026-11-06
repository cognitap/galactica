import { byId, element, breakable, plural, formatted, KINDS, linked } from './dom.js'
import { noteOf } from './links.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./search.js').Target} Target */
/** @typedef {import('../page-data.ts').PageArea} PageArea */
/** @typedef {import('../page-data.ts').PageModule} PageModule */
/** @typedef {import('../page-data.ts').PagePackage} PagePackage */
/** @typedef {import('./navigation.js').Selection} Selection */
/** @typedef {{ readonly index: number, readonly item: HTMLElement, readonly select: HTMLElement, readonly tag: HTMLElement, readonly symbolAt: ((position: number) => HTMLElement) | undefined }} ModuleView */
/** @typedef {ReturnType<typeof mapView>} MapView */

/**
 * @param {PageData} data
 * @param {(selection: Selection) => void} onSelection
 */
export function mapView(data, onSelection) {
  const PALETTE = 8
  /** @param {number} folder */
  const folderKey = folder => (folder < PALETTE ? String(folder) : 'other')
  /**
   * The last segment of an area path, the name its node shows, with break
   * opportunities between words so a long name wraps instead of overflowing.
   * @param {string} path
   */
  function nodeName(path) {
    if (path === '.') return [element('span', 'package-root', 'package root')]
    const name = path.slice(path.lastIndexOf('/') + 1)
    /** @type {Node[]} */
    const nodes = []
    for (const word of name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[-_.])/)) {
      if (nodes.length > 0) nodes.push(element('wbr'))
      nodes.push(document.createTextNode(word))
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
   * @param {PageModule['symbols'][number]} symbol
   */
  function symbolItem(module, symbol) {
    const entry = element('li', 'symbol')
    const kind = symbol.default ? `default ${symbol.kind}` : symbol.kind
    const head = element('div', 'symbol-head')
    const where = linked(
      data.source,
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
    linked(data.source, name, module.path, undefined, `Open ${module.path} in the repository`)
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

  /**
   * The modules of `area` that are of a kind in `kinds`, with their exported symbols.
   * @param {PageArea} area
   * @param {ReadonlySet<ModuleKind>} kinds
   */
  function listedIn(area, kinds) {
    const modules = area.modules.filter(module => kinds.has(data.modules[module].kind))
    const exported = modules.reduce((sum, module) => sum + data.modules[module].symbols.length, 0)
    return { modules, exported }
  }

  /** @param {number} index */
  function areaBox(index) {
    const area = data.areas[index]
    const box = element('article', 'area')
    box.dataset.folder = folderKey(area.folder)
    const head = element('header', 'area-head')
    const title = element('h3')
    const select = selectButton('area-select', `Select ${area.path}`)
    select.setAttribute('aria-controls', 'detail')
    select.append(...nodeName(area.label))
    title.append(select)
    const tag = relationTag()
    const count = element('span')
    const meta = element('p', 'area-meta')
    meta.append(count)
    if (area.cycle) meta.append(element('span', 'cycle-mark', 'cycle'))
    head.append(title, tag, meta)
    box.append(head)

    /** @param {ReadonlySet<ModuleKind>} kinds */
    const filter = kinds => {
      const { modules, exported } = listedIn(area, kinds)
      count.textContent = plural(modules.length, 'module')
      box.hidden = modules.length === 0
      return { shown: modules.length, exported }
    }
    return { index, box, select, tag, filter }
  }

  /**
   * The panel that lists the modules of one area, the selected one or the one
   * holding the selected module. Rows are drawn the first time their area opens
   * and kept, so the selection highlight can mark them by class.
   * @param {(view: ModuleView) => void} onRowDrawn
   */
  function detailPanel(onRowDrawn) {
    const panel = byId('detail')
    const heading = element('h2', 'detail-title')
    heading.id = 'detail-heading'
    heading.tabIndex = -1
    const meta = element('p', 'area-meta')
    const list = element('ul', 'modules')
    const idle = element('p', 'empty', 'Select an area to list its modules.')
    panel.setAttribute('aria-labelledby', heading.id)
    panel.append(heading, meta, list, idle)

    /** @type {number | undefined} */
    let open
    /** @type {ReadonlySet<ModuleKind>} */
    let kinds = new Set()
    const update = () => {
      panel.classList.toggle('is-open', open !== undefined)
      heading.hidden = meta.hidden = list.hidden = open === undefined
      idle.hidden = open !== undefined
      if (open === undefined) {
        list.replaceChildren()
        return
      }
      const area = data.areas[open]
      heading.replaceChildren(...areaTitle(area.label))
      heading.title = area.path
      const { modules, exported } = listedIn(area, kinds)
      meta.replaceChildren(
        element('span', '', plural(modules.length, 'module')),
        element('span', '', plural(exported, 'symbol'))
      )
      if (area.cycle) meta.append(element('span', 'cycle-mark', 'cycle'))
      const usualKind = usualKindOf(area.kinds)
      list.replaceChildren(
        ...modules.map(module => {
          let view = moduleViews.get(module)
          if (view === undefined) {
            view = { index: module, ...moduleItem(data.modules[module], usualKind) }
            onRowDrawn(view)
          }
          return view.item
        })
      )
    }
    return {
      /** @param {number | undefined} area */
      show(area) {
        if (area === open) return
        // Focus inside rows about to leave the page would fall back to the body.
        const left = open
        const focused = left !== undefined && panel.contains(document.activeElement)
        open = area
        update()
        if (focused && left !== undefined) areaViews[left].select.focus()
      },
      /** @param {ReadonlySet<ModuleKind>} shown */
      filter(shown) {
        kinds = shown
        update()
      }
    }
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
    const path = element('code')
    path.append(...breakable(pkg.dir === '.' ? 'repository root' : pkg.dir))
    dir.append(path)
    head.append(heading, dir)

    // One column per layer, the lowest on the left, so the map reads from foundations up.
    const columns = element('div', 'columns')
    columns.style.setProperty('--layers', String(pkg.rows.length))
    const lines = pkg.rows.toReversed().map(row => {
      const line = element('div', 'column')
      const areas = element('div', 'column-areas')
      const boxes = row.map(boxOf)
      areas.append(...boxes.map(({ box }) => box))
      line.append(element('p', 'column-label', `Layer ${data.areas[row[0]].layer}`), areas)
      columns.append(line)
      return { line, boxes }
    })
    const empty = element('p', 'empty', 'Every module here is of a kind the filter hides.')
    section.append(head, columns, empty)
    if (pkg.areaCycles.length > 0 || pkg.moduleCycles.length > 0) section.append(cyclesSection(pkg))
    return { section, lines, empty }
  }

  function legend() {
    const folders = byId('folders')
    data.folders.slice(0, PALETTE).forEach((folder, index) => {
      const item = element('li')
      item.dataset.folder = String(index)
      const name =
        folder === '.' ? element('span', '', 'package root') : element('code', '', folder)
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

  /** Largest source/config packages first, with names breaking ties deterministically. */
  const packageOrder = data.packages
    .map((pkg, index) => ({
      pkg,
      index,
      size: pkg.rows.flat().reduce((count, area) => {
        const { source, config } = data.areas[area].kinds
        return count + source + config
      }, 0)
    }))
    .sort(
      (a, b) => b.size - a.size || (a.pkg.name < b.pkg.name ? -1 : a.pkg.name > b.pkg.name ? 1 : 0)
    )

  function packageNav() {
    if (data.packages.length < 2) return
    const nav = byId('packages')
    const label = element('label', '', 'Package')
    label.setAttribute('for', 'package-picker')
    const picker = /** @type {HTMLSelectElement} */ (element('select'))
    picker.id = 'package-picker'
    packageOrder.forEach(({ pkg, index }) => {
      const option = element('option', '', pkg.name)
      option.setAttribute('value', `package-${index}`)
      picker.append(option)
    })
    picker.addEventListener('change', () => {
      location.hash = picker.value
    })
    nav.append(label, picker)
    nav.hidden = false
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

  byId('repository').textContent = data.repository
  const note = data.source === null ? undefined : noteOf(data.source)
  if (note !== undefined) {
    byId('source-note').textContent = note
    byId('source-note').hidden = false
  }
  legend()
  packageNav()

  /** @type {AreaView[]} */
  const areaViews = []
  /** @type {Map<number, ModuleView>} */
  const moduleViews = new Map()
  /** @param {ModuleView} view */
  const onRowDrawn = view => {
    moduleViews.set(view.index, view)
    view.select.addEventListener('click', () => onSelection({ kind: 'module', index: view.index }))
  }
  /** @param {number} index */
  const boxOf = index => {
    const view = areaBox(index)
    view.select.addEventListener('click', () => onSelection({ kind: 'area', index }))
    areaViews[index] = view
    return view
  }
  const sections = packageOrder.map(({ pkg, index }) => packageSection(pkg, index, boxOf))
  byId('map').append(...sections.map(({ section }) => section))
  const detail = detailPanel(onRowDrawn)

  /** @param {ReadonlySet<ModuleKind>} shown */
  const filter = shown => {
    let areas = 0
    let modules = 0
    let symbols = 0
    for (const { filter } of areaViews) {
      const { shown: listed, exported } = filter(shown)
      areas += listed === 0 ? 0 : 1
      modules += listed
      symbols += exported
    }
    detail.filter(shown)
    for (const { lines, empty } of sections) {
      for (const { line, boxes } of lines) line.hidden = boxes.every(({ box }) => box.hidden)
      empty.hidden = lines.some(({ line }) => !line.hidden)
    }
    const hiddenKinds = /** @type {ModuleKind[]} */ (Object.keys(KINDS))
      .filter(kind => !shown.has(kind))
      .map(kind => ({ kind, count: data.modules.filter(module => module.kind === kind).length }))
      .filter(({ count }) => count > 0)
      .map(({ kind, count }) => plural(count, KINDS[kind].one, KINDS[kind].many))
    const hidden = hiddenKinds.length === 0 ? '' : ` (+${hiddenKinds.join(' and ')} hidden)`
    byId('counts').textContent = [
      plural(data.packages.length, 'package'),
      plural(areas, 'area'),
      plural(modules, 'module') + hidden,
      plural(symbols, 'exported symbol')
    ].join(' · ')
  }

  return {
    areas: areaViews,
    modules: moduleViews,
    filter,
    filterButtons: kindFilter,
    showArea: detail.show
  }
}
