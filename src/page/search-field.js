import { byId, element, breakable, kindNames } from './dom.js'
import { hiddenBy, search } from './search.js'

/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */
/** @typedef {import('./search.js').Target} Target */
/** @typedef {import('./search.js').SearchEntry} SearchEntry */

/**
 * @param {readonly SearchEntry[]} entries
 * @param {() => ReadonlySet<ModuleKind>} shownKinds
 * @param {(target: Target) => void} go
 */
export function searchField(entries, shownKinds, go) {
  const input = /** @type {HTMLInputElement} */ (byId('search'))
  const list = byId('search-results')
  /** @type {readonly SearchEntry[]} */
  let results = []
  let active = -1

  /**
   * @param {number} index
   * @param {boolean} [reveal] Scroll keyboard choices into view. Pointer choices are already visible.
   */
  const activate = (index, reveal = true) => {
    active = index
    ;[...list.children].forEach((option, position) =>
      option.setAttribute('aria-selected', String(position === index))
    )
    if (index < 0) return input.removeAttribute('aria-activedescendant')
    input.setAttribute('aria-activedescendant', `search-option-${index}`)
    if (reveal) list.children[index].scrollIntoView({ block: 'nearest' })
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
    node.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch' && active !== index) activate(index, false)
    })
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

  byId('clear-search').addEventListener('click', () => {
    input.value = ''
    close()
    input.focus()
  })
  input.addEventListener('focus', refresh)
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
