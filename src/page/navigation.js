import { byId, KINDS } from './dom.js'
import { mapView } from './map-view.js'
import { selectionView } from './highlight.js'
import { searchField } from './search-field.js'
import { entriesOf } from './search.js'
import { healthSection } from './health.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./search.js').Target} Target */
/** @typedef {{ readonly kind: 'area' | 'module', readonly index: number }} Selection */
/** @typedef {import('./map-view.js').ModuleView} ModuleView */

/** Tests and stories only use the code, so the map opens on the code. */
const SHOWN_AT_FIRST = /** @type {ReadonlySet<ModuleKind>} */ (new Set(['source', 'config']))

/** @param {PageData} data */
export function draw(data) {
  /** @param {Selection} selection */
  const subjectOf = ({ kind, index }) => (kind === 'area' ? data.areas[index] : data.modules[index])
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
    const index = (kind === 'area' ? data.areas : data.modules).findIndex(
      item => item.path === path
    )
    return index < 0 ? undefined : { kind, index }
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

  /** @type {Selection | undefined} */
  let selection
  let shown = SHOWN_AT_FIRST
  const describe = () => light(selection, shown)
  /** @param {Selection | undefined} next */
  const select = next => {
    selection = next
    describe()
    history.replaceState(null, '', location.href.split('#')[0] + fragmentOf(selection))
  }
  /** @param {Selection} next */
  const toggleSelection = next =>
    select(selection?.kind === next.kind && selection.index === next.index ? undefined : next)

  const view = mapView(data, toggleSelection, describe)
  const { areas: areaViews, modules: moduleViews } = view
  const light = selectionView(data, view)
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
    view.filter(shown)
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
  healthSection(data, go)
  const pressed = view.filterButtons(kind => {
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
