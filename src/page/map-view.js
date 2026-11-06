import { byId, element, breakable, plural, formatted, kindCount, KINDS, linked } from './dom.js'
import { noteOf } from './links.js'
import { compareText } from './search.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('../page-data.ts').PageArea} PageArea */
/** @typedef {import('../page-data.ts').PageModule} PageModule */
/** @typedef {import('../page-data.ts').PagePackage} PagePackage */
/** @typedef {import('./indexes.js').Selection} Selection */
/** @typedef {{ readonly index: number, readonly item: HTMLElement, readonly select: HTMLElement, readonly tag: HTMLElement, readonly details: () => HTMLElement }} ModuleView */
/** @typedef {ReturnType<typeof mapView>} MapView */

/**
 * @param {PageData} data
 * @param {(selection: Selection) => void} onSelection
 */
export function mapView(data, onSelection) {
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
   */
  function moduleItem(module) {
    const item = element('li', 'module')
    item.dataset.kind = module.kind
    const select = selectButton('module-select', `Select ${module.path}`)
    const name = element('span', 'module-name')
    name.append(...breakable(module.label))
    const tag = relationTag()
    select.append(name, tag, arrows(module.importers, module.imports))
    item.append(select)

    /** @type {HTMLElement | undefined} */
    let body
    const details = () => {
      if (body !== undefined) return body
      body = element('div', 'module-details')
      const meta = element('div', 'module-meta')
      meta.append(element('span', 'kind-tag', module.kind))
      if (data.source !== null) {
        meta.append(
          linked(
            data.source,
            element('span', '', 'Open source ↗'),
            module.path,
            undefined,
            `Open source for ${module.path} in the repository`
          )
        )
      }
      body.append(meta)
      if (module.symbols.length > 0) {
        const symbols = element('ul', 'symbols')
        symbols.append(...module.symbols.map(symbol => symbolItem(module, symbol)))
        body.append(symbols)
      }
      item.append(body)
      return body
    }
    return { item, select, tag, details }
  }

  /** @typedef {ReturnType<typeof areaBox>} AreaView */

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
    box.dataset.path = area.path
    const title = element('span', 'area-title')
    const select = selectButton('area-select', `Select ${area.path}`)
    select.setAttribute('aria-controls', 'detail')
    title.append(...nodeName(area.label))
    const tag = relationTag()
    const count = element('span')
    count.id = `area-kinds-${index}`
    select.setAttribute('aria-describedby', count.id)
    const meta = element('span', 'area-meta')
    meta.append(count)
    if (area.cycle) meta.append(element('span', 'cycle-mark', 'cycle'))
    select.append(title, meta, tag)
    box.append(select)

    /** @param {ReadonlySet<ModuleKind>} kinds */
    const filter = kinds => {
      const { modules, exported } = listedIn(area, kinds)
      const visibleKinds = /** @type {ModuleKind[]} */ (Object.keys(KINDS)).filter(
        kind => kinds.has(kind) && area.kinds[kind] > 0
      )
      count.replaceChildren(
        ...visibleKinds.flatMap((kind, position) => {
          const total = area.kinds[kind]
          const text =
            kind === 'source' || kind === 'config' ? plural(total, kind) : kindCount(total, kind)
          const label = element('span', 'kind-tag', text)
          label.dataset.kind = kind
          return position === 0 ? [label] : [' · ', label]
        })
      )
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
    const heading = byId('detail-heading')
    const meta = byId('detail-meta')
    const list = byId('detail-modules')

    /** @type {number | undefined} */
    let open
    /** @type {ReadonlySet<ModuleKind>} */
    let kinds = new Set()
    const update = () => {
      panel.hidden = open === undefined
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
      list.replaceChildren(
        ...modules.map(module => {
          let view = moduleViews.get(module)
          if (view === undefined) {
            view = { index: module, ...moduleItem(data.modules[module]) }
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
   * @param {number} index
   * @param {(area: number) => AreaView} boxOf
   */
  function packageSection(pkg, index, boxOf) {
    const section = element('section', 'package')
    section.id = `package-${index}`
    let headingId = 'layers-heading'
    if (data.packages.length > 1) {
      const head = element('header', 'package-head')
      const heading = element('h3', '', pkg.name)
      heading.id = `package-${index}-name`
      headingId = heading.id
      head.append(heading)
      if (pkg.dir !== '.') {
        const path = element('code')
        path.append(...breakable(pkg.dir))
        head.append(path)
      }
      section.append(head)
    }
    section.setAttribute('aria-labelledby', headingId)

    const browser = element('div', 'layer-browser')
    const columns = element('div', 'columns')
    browser.append(columns)
    const lines = pkg.rows.toReversed().map(row => {
      const line = element('div', 'column')
      const areas = element('div', 'column-areas')
      const boxes = row.map(boxOf)
      areas.append(...boxes.map(({ box }) => box))
      line.append(element('p', 'column-label', `Layer ${data.areas[row[0]].layer}`), areas)
      columns.append(line)
      return { line, boxes }
    })
    const empty = element(
      'p',
      'empty',
      lines.length ? 'No matching modules in this package.' : 'This package has no modules.'
    )
    section.append(browser, empty)
    if (lines.length > 1) {
      browser.setAttribute('role', 'region')
      browser.setAttribute('aria-labelledby', headingId)
      const update = () => {
        const end = browser.scrollWidth - browser.clientWidth
        browser.tabIndex = end > 1 ? 0 : -1
        browser.classList.toggle('more-left', browser.scrollLeft > 1)
        browser.classList.toggle('more-right', browser.scrollLeft < end - 1)
      }
      browser.addEventListener('scroll', update)
      const resized = new ResizeObserver(update)
      resized.observe(browser)
      resized.observe(columns)
    }
    return { section, columns, lines, empty }
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
    .sort((a, b) => b.size - a.size || compareText(a.pkg.name, b.pkg.name))

  const layers = byId('layers-body')
  const layersToggle = byId('layers-toggle')
  const guide = byId('map-guide')
  const guideToggle = byId('guide-toggle')
  /** @param {boolean} open */
  function setLayersOpen(open) {
    layers.hidden = !open
    layersToggle.setAttribute('aria-expanded', String(open))
    guideToggle.hidden = !open
  }
  /** @param {boolean} open */
  function setGuideOpen(open) {
    guide.hidden = !open
    guideToggle.setAttribute('aria-expanded', String(open))
  }
  layersToggle.addEventListener('click', () => setLayersOpen(layers.hidden === true))
  guideToggle.addEventListener('click', () => setGuideOpen(guide.hidden === true))
  const dismissGuide = () => {
    if (layers.hidden || guide.hidden) return false
    setGuideOpen(false)
    guideToggle.focus()
    return true
  }
  byId('close-guide').addEventListener('click', dismissGuide)

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
      setLayersOpen(true)
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
    const controls = /** @type {ModuleKind[]} */ (Object.keys(KINDS))
      .filter(kind => counts.has(kind))
      .map(kind => {
        const label = element('label', 'kind-option')
        label.dataset.kind = kind
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.addEventListener('change', () => flip(kind))
        label.append(
          input,
          KINDS[kind].label,
          ' ',
          element('span', 'kind-count', formatted(counts.get(kind) ?? 0))
        )
        group.append(label)
        return { kind, input }
      })
    /** @param {ReadonlySet<ModuleKind>} shown */
    return shown => {
      for (const { kind, input } of controls) input.checked = shown.has(kind)
    }
  }

  byId('repository').textContent = data.repository
  const note = data.source === null ? undefined : noteOf(data.source)
  if (note !== undefined) {
    byId('source-note').textContent = note
    byId('source-note').hidden = false
  }
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
    const noResults = modules === 0
    const notice = byId('map-empty')
    notice.hidden = !noResults
    notice.textContent = data.modules.length
      ? 'Choose a module kind to show its areas.'
      : 'This repository has no modules.'
    let layers = 0
    for (const { section, lines, empty } of sections) {
      section.hidden = noResults
      for (const { line, boxes } of lines) line.hidden = boxes.every(({ box }) => box.hidden)
      const visibleLayers = lines.filter(({ line }) => !line.hidden).length
      layers += visibleLayers
      empty.hidden = visibleLayers > 0
    }
    byId('layer-counts').textContent = `${plural(layers, 'layer')} · ${plural(areas, 'area')}`
    const hiddenKinds = /** @type {ModuleKind[]} */ (Object.keys(KINDS))
      .filter(kind => !shown.has(kind))
      .map(kind => ({ kind, count: data.modules.filter(module => module.kind === kind).length }))
      .filter(({ count }) => count > 0)
      .map(({ kind, count }) => kindCount(count, kind))
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
    kindFilter,
    setLayersOpen,
    dismissGuide,
    showArea: detail.show,
    columns: sections.map(({ columns }) => columns)
  }
}
