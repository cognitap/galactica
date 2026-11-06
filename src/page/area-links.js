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
      layer.setAttribute('aria-hidden', 'true')
      columns.prepend(layer)
      return [columns, layer]
    })
  )
  const stacked = matchMedia(STACKED)

  /** @type {{ from: HTMLElement, to: ReadonlyMap<HTMLElement, ReadonlySet<Relation>> } | undefined} */
  let drawn

  /**
   * A curve leaving `a` towards `b` and entering `b`, from the facing sides of
   * the two boxes. Boxes in one column, which import each other through a
   * cycle, are joined by a loop out of their left sides.
   * @param {DOMRect} a
   * @param {DOMRect} b
   */
  function curve(a, b) {
    const ay = a.top + a.height / 2
    const by = b.top + b.height / 2
    if (Math.abs(a.left - b.left) < 1) {
      const bulge = Math.min(40, 12 + Math.abs(by - ay) / 6)
      return `M ${a.left} ${ay} C ${a.left - bulge} ${ay} ${b.left - bulge} ${by} ${b.left} ${by}`
    }
    const [ax, bx] = a.left < b.left ? [a.right, b.left] : [a.left, b.right]
    const mid = (ax + bx) / 2
    return `M ${ax} ${ay} C ${mid} ${ay} ${mid} ${by} ${bx} ${by}`
  }

  function draw() {
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
    const from = placed(drawn.from)
    for (const [box, relations] of drawn.to) {
      // Areas of other packages are highlighted in their own sections, with no line across.
      if (box.hidden || box === drawn.from || box.closest('.columns') !== columns) continue
      const to = placed(box)
      for (const relation of relations) {
        const path = document.createElementNS(SVG, 'path')
        path.classList.add(`link-${relation}`)
        path.setAttribute('d', curve(from, to))
        layer.append(path)
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
