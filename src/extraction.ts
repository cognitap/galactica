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
  /** Why the framework's compiler could not read the file, which then has no imports. */
  readonly failure?: string
}

export const hashOf = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/** The default export every framework file has, named after the file. */
function componentOf(path: RepoPath): SymbolFacts {
  const file = path.slice(path.lastIndexOf('/') + 1)
  const name = file.slice(0, file.lastIndexOf('.'))
  return { name, kind: 'component', line: 1, default: true, signature: `component ${name}` }
}

function blockExtraction(path: RepoPath, block: ScriptBlock): Extraction {
  const source = parseScript(path, block.language, block.text)
  const shift = <T extends { readonly line: number }>(item: T): T => ({
    ...item,
    line: item.line + block.offset
  })
  // The file's default export is its component, whatever a block exports as default.
  const symbols = block.exports ? symbolsOf(source).filter(symbol => !symbol.default) : []
  return { symbols: symbols.map(shift), imports: importsOf(source).map(shift) }
}

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
    const failure = (error instanceof Error ? error.message : String(error)).split('\n')[0]!
    return { symbols: [component], imports: [], failure }
  }
  const extractions = blocks.map(block => blockExtraction(path, block))
  const symbols = [component, ...extractions.flatMap(extraction => extraction.symbols)]
  return {
    symbols: symbols.sort((a, b) => a.line - b.line || compare(a.name, b.name)),
    imports: extractions.flatMap(extraction => extraction.imports)
  }
}

/** `load` gives the framework's compiler module, and is absent when Galactica was installed without it. */
export function extract(
  path: RepoPath,
  language: Language,
  bytes: Buffer,
  load?: () => unknown
): Extraction {
  const text = bytes.toString('utf8')
  if (!isScriptLanguage(language)) return frameworkExtraction(path, language, text, load)
  const source = parseScript(path, language, text)
  return { symbols: symbolsOf(source), imports: importsOf(source) }
}
