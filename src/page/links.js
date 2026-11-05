/** @typedef {import('../source-links.ts').PageSource} PageSource */

/**
 * The address of a module, or of a line in it, in the repository host. Each path
 * segment is percent-encoded and the slashes are kept. Without a line, the
 * template loses its `#...{line}` fragment.
 * @param {PageSource} source
 * @param {string} path the module's path from the root
 * @param {number} [line]
 */
export function hrefOf(source, path, line) {
  const full = source.prefix === '' ? path : `${source.prefix}/${path}`
  const encoded = full.split('/').map(encodeURIComponent).join('/')
  let template = source.template
  const hash = template.lastIndexOf('#')
  if (line === undefined && hash >= 0 && template.slice(hash).includes('{line}')) {
    template = template.slice(0, hash)
  }
  return template
    .replaceAll('{path}', () => encoded)
    .replaceAll('{line}', () => (line === undefined ? '' : String(line)))
}
