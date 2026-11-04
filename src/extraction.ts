/**
 * What one module gives from its own bytes: its symbols and its imports before
 * resolution. Nothing here reads another file, so a result holds for as long
 * as the bytes, and so their hash, are the same.
 */

import { createHash } from 'node:crypto'
import type { Language } from './contract.ts'
import { importsOf, type Import } from './imports.ts'
import type { RepoPath, SymbolFacts } from './model.ts'
import { symbolsOf } from './symbols.ts'
import { isScriptLanguage, parseScript } from './syntax.ts'

export interface Extraction {
  readonly symbols: readonly SymbolFacts[]
  readonly imports: readonly Import[]
}

export const hashOf = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

export function extract(path: RepoPath, language: Language, bytes: Buffer): Extraction {
  if (!isScriptLanguage(language)) return { symbols: [], imports: [] }
  const source = parseScript(path, language, bytes.toString('utf8'))
  return { symbols: symbolsOf(source), imports: importsOf(source) }
}
