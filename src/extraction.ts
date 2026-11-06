/**
 * What one module gives from its own bytes: its symbols and its imports before
 * resolution. Nothing here reads another file, so a result holds for as long
 * as the bytes, and so their hash, are the same.
 */

import { createHash } from 'node:crypto'
import type { Language } from './contract.ts'
import { scriptBlocksOf, type FrameworkLanguage, type ScriptBlock } from './frameworks.ts'
import { importsOf, type Import } from './imports.ts'
import { compare, type RepoPath, type SymbolFacts } from './model.ts'
import { symbolsOf } from './symbols.ts'
import { isScriptLanguage } from './source-file.ts'
import { parseScript } from './syntax.ts'

export interface Extraction {
  readonly symbols: readonly SymbolFacts[]
  readonly imports: readonly Import[]
  /** Why the file could not be read, by the framework's compiler or by TypeScript. It then has no imports. */
  readonly failure?: string
}

export const hashOf = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

function withoutLoadTime(imported: Import): Import {
  const { loadTime: _, ...rest } = imported
  return rest
}

/** The default export every framework file has, named after the file. */
function componentOf(path: RepoPath): SymbolFacts {
  const file = path.slice(path.lastIndexOf('/') + 1)
  const name = file.slice(0, file.lastIndexOf('.'))
  return { name, kind: 'component', line: 1, default: true, signature: `component ${name}` }
}

function blockExtraction(path: RepoPath, block: ScriptBlock, loads: boolean): Extraction {
  const source = parseScript(path, block.language, block.text)
  const shift = <T extends { readonly line: number }>(item: T): T => ({
    ...item,
    line: item.line + block.offset
  })
  // The file's default export is its component, whatever a block exports as default.
  const symbols = block.exports ? symbolsOf(source).filter(symbol => !symbol.default) : []
  const imports = loads ? importsOf(source) : importsOf(source).map(withoutLoadTime)
  return { symbols: symbols.map(shift), imports: imports.map(shift) }
}

const firstLineOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]!

function frameworkExtraction(
  path: RepoPath,
  language: FrameworkLanguage,
  text: string,
  load: (() => unknown) | undefined
): Extraction {
  const component = componentOf(path)
  let blocks: readonly ScriptBlock[]
  try {
    blocks = scriptBlocksOf(language, path, text, load)
  } catch (error) {
    return { symbols: [component], imports: [], failure: firstLineOf(error) }
  }
  // Only a Vue `<script>` or a Svelte module script runs as the module loads.
  // `<script setup>`, a Svelte instance script and Astro frontmatter run per
  // component instance or render.
  const extractions = blocks.map(block =>
    blockExtraction(path, block, block.exports && language !== 'astro')
  )
  const symbols = [component, ...extractions.flatMap(extraction => extraction.symbols)]
  return {
    symbols: symbols.sort((a, b) => a.line - b.line || compare(a.name, b.name)),
    imports: extractions.flatMap(extraction => extraction.imports)
  }
}

/**
 * `load` gives the framework's compiler module, and is absent when Galactica
 * was installed without it. A file TypeScript cannot parse, such as one nested
 * deeper than its parser's stack allows, gives a failure in place of a crash.
 */
export function extract(
  path: RepoPath,
  language: Language,
  bytes: Buffer,
  load?: () => unknown
): Extraction {
  const text = bytes.toString('utf8')
  const script = isScriptLanguage(language)
  try {
    if (!script) return frameworkExtraction(path, language, text, load)
    const source = parseScript(path, language, text)
    return { symbols: symbolsOf(source), imports: importsOf(source) }
  } catch (error) {
    return { symbols: script ? [] : [componentOf(path)], imports: [], failure: firstLineOf(error) }
  }
}
