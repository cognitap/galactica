/**
 * The HTML page: one self-contained file with the stylesheet, the page script
 * and the page data inlined, so it opens from disk with no network requests.
 */

import { readFileSync } from 'node:fs'
import type { Graph } from './model.ts'
import { pageData, type PageData } from './page-data.ts'
import type { PageSource } from './source-links.ts'

// Source tests and the installed module both read the package's built browser assets.
const pageFile = (name: string) =>
  readFileSync(new URL(`../dist/page/${name}`, import.meta.url), 'utf8')

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/** Every `<` escaped, so no `</script` or `<!--` in a signature or doc can end the data block early. */
const embedded = (data: PageData) => JSON.stringify(data).replaceAll('<', '\\u003c')

/** `areaModules` is the config's `health.areaModules`, undefined for the relative rule. */
export function htmlOf(
  graph: Graph,
  source: PageSource | null = null,
  areaModules?: number
): string {
  const slots: Readonly<Record<string, string>> = {
    title: escapeHtml(`${graph.repository.name} · Galactica`),
    style: pageFile('page.css'),
    script: pageFile('page.js'),
    data: embedded(pageData(graph, source, areaModules))
  }
  return pageFile('page.html').replaceAll(/\{\{(\w+)\}\}/g, (_, slot: string) => slots[slot]!)
}
