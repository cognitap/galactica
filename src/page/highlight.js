import { indexesOf, subjectOf } from './indexes.js'
import { byId, element, plural, kindCount, KINDS } from './dom.js'
import { areaLinks } from './area-links.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./map-view.js').MapView} MapView */
/** @typedef {import('./indexes.js').Selection} Selection */
/** @typedef {import('../page-data.ts').IndexGaps} IndexGaps */
/** @typedef {'uses' | 'used-by'} Relation */

/**
 * @param {PageData} data
 * @param {MapView} view
 */
export function selectionView(data, view) {
  const RELATIONS = /** @type {const} */ ({
    uses: { one: 'dependency', many: 'dependencies' },
    'used-by': { one: 'dependent', many: 'dependents' }
  })

  /**
   * @param {Selection} selection
   * @param {ReadonlySet<ModuleKind>} shown
   */
  function summaryOf(selection, shown) {
    const subject = subjectOf(data, selection)
    const parts = [
      ...(selection.kind === 'module' ? [element('code', 'selection-path', subject.path)] : []),
      element('span', 'count-uses', plural(subject.uses.length, 'dependency', 'dependencies')),
      element('span', 'count-used-by', plural(subject.usedBy.length, 'dependent'))
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
        .map(kind => kindCount(hidden.get(kind) ?? 0, kind))
      parts.push(element('span', 'count-hidden', `${counts.join(' and ')} hidden by the filter`))
    }
    return parts
  }

  /**
   * Marks the selection, what it uses and what uses it, by toggling classes on
   * the boxes and rows already drawn, so a selection redraws nothing.
   * @param {MapView['areas']} areaViews
   * @param {MapView['modules']} drawnRows
   */
  function highlighter(areaViews, drawnRows) {
    const links = areaLinks(view.columns)
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
      if (selection === undefined) {
        links.show(undefined, new Map())
        return
      }
      document.body.dataset.selection = selection.kind
      const subject = subjectOf(data, selection)
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
      /** @type {Map<HTMLElement, Set<Relation>>} */
      const linked = new Map()
      for (const [index, counts] of areas) {
        const { box, tag } = areaViews[index]
        const relations = /** @type {Relation[]} */ (Object.keys(counts)).filter(
          key => counts[key] > 0
        )
        linked.set(box, new Set(relations))
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
      const area = selection.kind === 'area' ? selection.index : data.modules[selection.index].area
      links.show(areaViews[area].box, linked)
      if (selection.kind === 'area') {
        const { box, select } = areaViews[selection.index]
        add(box, ['is-selected'])
        press(select)
      } else {
        add(areaViews[data.modules[selection.index].area].box, ['has-selected'])
        const view = drawnRows.get(selection.index)
        if (view === undefined) return
        add(view.item, ['is-selected'])
        view.details()
        press(view.select)
      }
    }
  }

  const light = highlighter(view.areas, view.modules)
  /**
   * @param {Selection | undefined} selection
   * @param {ReadonlySet<ModuleKind>} shown
   */
  return (selection, shown) => {
    light(selection, shown)
    if (selection !== undefined)
      byId('selection-summary').replaceChildren(...summaryOf(selection, shown))
  }
}
