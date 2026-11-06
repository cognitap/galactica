/** @typedef {'uses' | 'used-by'} Relation */

const SVG = 'http://www.w3.org/2000/svg'

/** Below this width the layers stack as rows (see page.css), where links would only tangle. */
const STACKED = '(max-width: 48rem)'

/**
 * Curves from the selected area's box to the boxes of the areas it depends on
 * and that depend on it, in one SVG layer behind each package's columns. Only
 * one selection is ever drawn, so the whole layer is redrawn whenever the
 * layout can have moved: on selection, filtering and resizing.
 * @param {readonly HTMLElement[]} columnSets one `.columns` element per package
 */
export function areaLinks(columnSets) {
  const layers = new Map(
    columnSets.map(columns => {
      const layer = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, 'svg'))
      layer.classList.add('area-links')
      layer.setAttribute('role', 'group')
      layer.setAttribute('aria-label', 'Area dependencies')
      columns.prepend(layer)
      return [columns, layer]
    })
  )
  const stacked = matchMedia(STACKED)

  const tip = document.createElement('div')
  tip.className = 'connector-tip'
  tip.hidden = true
  document.body.append(tip)
  /** @type {HTMLElement | undefined} */
  let destination
  const clearTrace = () => {
    destination?.classList.remove('link-destination')
    destination = undefined
    tip.hidden = true
  }
  /** @param {number} x @param {number} y */
  const placeTip = (x, y) => {
    tip.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - tip.offsetWidth - 8))}px`
    const top = y + tip.offsetHeight + 20 > innerHeight ? y - tip.offsetHeight - 8 : y + 12
    tip.style.top = `${Math.max(8, Math.min(top, innerHeight - tip.offsetHeight - 8))}px`
  }
  document.addEventListener('scroll', clearTrace, true)

  /** @type {{ from: HTMLElement, to: ReadonlyMap<HTMLElement, ReadonlySet<Relation>> } | undefined} */
  let drawn

  /**
   * A curve leaving `a` towards `b` and entering `b`, from the facing sides of
   * the two boxes. Boxes in one column, which import each other through a
   * cycle, are joined by a loop out of their left sides.
   * @param {DOMRect} a
   * @param {DOMRect} b
   * @param {number} offset separates reciprocal links
   */
  function curve(a, b, offset) {
    const ay = a.top + a.height / 2 + offset
    const by = b.top + b.height / 2 + offset
    if (Math.abs(a.left - b.left) < 1) {
      const bulge = Math.min(40, 12 + Math.abs(by - ay) / 6)
      return `M ${a.left} ${ay} C ${a.left - bulge} ${ay} ${b.left - bulge} ${by} ${b.left} ${by}`
    }
    const [ax, bx] = a.left < b.left ? [a.right, b.left] : [a.left, b.right]
    const mid = (ax + bx) / 2
    return `M ${ax} ${ay} C ${mid} ${ay} ${mid} ${by} ${bx} ${by}`
  }

  function draw() {
    clearTrace()
    for (const layer of layers.values()) layer.replaceChildren()
    if (drawn === undefined || stacked.matches || drawn.from.hidden) return
    const columns = /** @type {HTMLElement} */ (drawn.from.closest('.columns'))
    const layer = /** @type {SVGSVGElement} */ (layers.get(columns))
    const origin = columns.getBoundingClientRect()
    /** @param {HTMLElement} box */
    const placed = box => {
      const { left, top, width, height } = box.getBoundingClientRect()
      return new DOMRect(left - origin.left, top - origin.top, width, height)
    }
    layer.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`)
    const selected = drawn.from
    const from = placed(selected)
    for (const [box, relations] of drawn.to) {
      // Areas of other packages are highlighted in their own sections, with no line across.
      if (box.hidden || box === drawn.from || box.closest('.columns') !== columns) continue
      const to = placed(box)
      for (const relation of relations) {
        const path = document.createElementNS(SVG, 'path')
        path.classList.add(`link-${relation}`)
        const outgoing = relation === 'uses'
        const target = outgoing ? box : selected
        const source = outgoing ? selected : box
        const label = `${source.dataset.path} depends on ${target.dataset.path}`
        const offset = relations.size < 2 ? 0 : outgoing ? -5 : 5
        const d = curve(from, to, offset)
        path.setAttribute('d', d)
        const hit = document.createElementNS(SVG, 'path')
        hit.setAttribute('d', d)
        hit.classList.add('link-hit')
        const group = document.createElementNS(SVG, 'g')
        group.setAttribute('role', 'img')
        group.setAttribute('aria-label', label)
        const trace = () => {
          clearTrace()
          destination = target
          target.classList.add('link-destination')
          tip.textContent = label
          tip.hidden = false
        }
        group.addEventListener('pointerenter', event => {
          trace()
          placeTip(event.clientX, event.clientY)
        })
        group.addEventListener('pointermove', event => {
          if (tip.hidden) trace()
          placeTip(event.clientX, event.clientY)
        })
        group.addEventListener('pointerleave', clearTrace)
        group.append(path, hit)
        layer.append(group)
      }
    }
  }

  const resized = new ResizeObserver(() => draw())
  for (const columns of columnSets) resized.observe(columns)
  stacked.addEventListener('change', draw)

  return {
    /**
     * @param {HTMLElement | undefined} from the selected area's box, or the box of the selected module's area
     * @param {ReadonlyMap<HTMLElement, ReadonlySet<Relation>>} to the boxes of related areas
     */
    show(from, to) {
      drawn = from === undefined ? undefined : { from, to }
      draw()
    }
  }
}
