import { byId } from './dom.js'
import { kindsOf, subjectOf } from './indexes.js'
import { mapView } from './map-view.js'
import { selectionView } from './highlight.js'
import { searchField } from './search-field.js'
import { entriesOf, hiddenBy } from './search.js'
import { healthSection } from './health.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./search.js').Target} Target */
/** @typedef {import('./indexes.js').Selection} Selection */
/** @typedef {import('./map-view.js').ModuleView} ModuleView */

/** Tests and stories only use the code, so the map opens on the code. */
const SHOWN_AT_FIRST = /** @type {ReadonlySet<ModuleKind>} */ (new Set(['source', 'config']))

/** @param {PageData} data */
export function draw(data) {
  /** @param {Selection | undefined} selection */
  function fragmentOf(selection) {
    return selection === undefined
      ? ''
      : `#${selection.kind}=${encodeURIComponent(subjectOf(data, selection).path)}`
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
    const index = (kind === 'area' ? data.areas : data.modules).findIndex(
      item => item.path === path
    )
    return index < 0 ? undefined : { kind, index }
  }

  /** @type {Selection | undefined} */
  let selection
  let shown = SHOWN_AT_FIRST
  const describe = () => {
    view.showArea(
      selection === undefined
        ? undefined
        : selection.kind === 'area'
          ? selection.index
          : data.modules[selection.index].area
    )
    light(selection, shown)
  }
  /** @param {Selection | undefined} next */
  const select = next => {
    selection = next
    describe()
    history.replaceState(null, '', location.href.split('#')[0] + fragmentOf(selection))
  }
  const view = mapView(data, next => {
    const openingPanel = selection === undefined
    select(next)
    if (openingPanel && next.kind === 'area') {
      areaViews[next.index].box.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
  const { areas: areaViews, modules: moduleViews } = view
  const light = selectionView(data, view)
  byId('clear-selection').addEventListener('click', () => select(undefined))
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (!view.dismissGuide() && selection !== undefined) select(undefined)
  })

  /** @param {ReadonlySet<ModuleKind>} kinds */
  const show = kinds => {
    shown = kinds
    syncKinds(shown)
    view.filter(shown)
  }
  /** @param {Target} target */
  const go = target => {
    view.setLayersOpen(true)
    const missing = hiddenBy({ kinds: kindsOf(data, target) }, shown)
    if (missing.length > 0) {
      show(new Set([...shown, ...missing]))
      field.refresh()
    }
    if (target.kind === 'area') {
      select({ kind: 'area', index: target.area })
      const { box, select: button } = areaViews[target.area]
      box.scrollIntoView({ block: 'nearest', inline: 'center' })
      button.focus({ preventScroll: true })
      return
    }
    select({ kind: 'module', index: target.module })
    areaViews[data.modules[target.module].area].box.scrollIntoView({
      block: 'nearest',
      inline: 'center'
    })
    const moduleView = /** @type {ModuleView} */ (moduleViews.get(target.module))
    const place =
      target.kind === 'symbol'
        ? moduleView.details().querySelectorAll('.symbol')[target.symbol]
        : moduleView.select
    place.scrollIntoView({ block: 'center' })
    moduleView.select.focus({ preventScroll: true })
  }

  const field = searchField(entriesOf(data), () => shown, go)
  healthSection(data, go)
  const syncKinds = view.kindFilter(kind => {
    const next = new Set(shown)
    if (!next.delete(kind)) next.add(kind)
    show(next)
    field.refresh()
    if (selection !== undefined) {
      const area = selection.kind === 'area' ? selection.index : data.modules[selection.index].area
      if (areaViews[area].box.hidden) return select(undefined)
      if (selection.kind === 'module' && !shown.has(data.modules[selection.index].kind)) {
        return select({ kind: 'area', index: area })
      }
    }
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
