import { hrefOf } from './links.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('../contract.ts').ModuleKind} ModuleKind */

/** @param {string} id */
export const byId = id => /** @type {HTMLElement} */ (document.getElementById(id))

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
export function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** One formatter for every count, since `toLocaleString` builds a new one on each call. */
export const formatted = new Intl.NumberFormat('en').format

/**
 * @param {number} count
 * @param {string} one
 * @param {string} [many]
 */
export const plural = (count, one, many = `${one}s`) =>
  `${formatted(count)} ${count === 1 ? one : many}`

export const KINDS = /** @type {const} */ ({
  source: { label: 'Source', one: 'source module', many: 'source modules' },
  config: { label: 'Config', one: 'config module', many: 'config modules' },
  test: { label: 'Tests', one: 'test', many: 'tests' },
  story: { label: 'Stories', one: 'story', many: 'stories' }
})

/**
 * @param {number} count
 * @param {ModuleKind} kind
 */
export const kindCount = (count, kind) => plural(count, KINDS[kind].one, KINDS[kind].many)

/**
 * Prefer path breaks after slashes, keeping each filename together when it fits.
 * @param {string} text
 */
export function breakable(text) {
  /** @type {Node[]} */
  const nodes = []
  for (const part of text.split(/(?<=\/)/)) {
    if (nodes.length > 0) nodes.push(element('wbr'))
    nodes.push(element('span', 'path-segment', part))
  }
  return nodes
}

/**
 * `node` wrapped in a link to the module, or to a line of it, when the page has
 * a source to link to. The address is assigned as a property, so it is never parsed as markup.
 * @template {HTMLElement} T
 * @param {PageData['source']} source
 * @param {T} node
 * @param {string} path
 * @param {number | undefined} line
 * @param {string} name the link's accessible name, which includes the path and the line
 */
export function linked(source, node, path, line, name) {
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

/** @param {readonly ModuleKind[]} kinds */
export const kindNames = kinds => kinds.map(kind => KINDS[kind].many).join(' and ')
