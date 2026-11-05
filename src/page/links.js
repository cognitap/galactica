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

/**
 * The header note for a map that includes changes the links cannot show.
 * @param {PageSource} source
 */
export function noteOf(source) {
  const changes = []
  if (source.unpushed > 0) {
    changes.push(`${source.unpushed} unpushed commit${source.unpushed === 1 ? '' : 's'}`)
  }
  if (source.uncommitted) changes.push('uncommitted changes')
  if (changes.length === 0) return undefined
  const linked =
    source.unpushed > 0
      ? `${source.shortCommit}, the newest commit on ${source.remote}`
      : `commit ${source.shortCommit}`
  return `Links point to ${linked}; this map also includes ${changes.join(' and ')}.`
}
