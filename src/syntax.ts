/**
 * How TypeScript parses a script module. Each module is parsed once, and the
 * readers of its symbols and its imports walk the same tree.
 */

import ts from 'typescript'
import type { RepoPath } from './model.ts'
import type { ScriptLanguage } from './source-file.ts'

const scriptKinds: Readonly<Record<ScriptLanguage, ts.ScriptKind>> = {
  ts: ts.ScriptKind.TS,
  mts: ts.ScriptKind.TS,
  cts: ts.ScriptKind.TS,
  tsx: ts.ScriptKind.TSX,
  js: ts.ScriptKind.JS,
  mjs: ts.ScriptKind.JS,
  cjs: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX
}

/**
 * The module's syntax tree, with parent pointers. `format` is the module
 * format TypeScript implies for the file, which import resolution reads back
 * from the tree.
 */
export function parseScript(
  path: RepoPath,
  language: ScriptLanguage,
  text: string,
  format?: ts.ResolutionMode
): ts.SourceFile {
  return ts.createSourceFile(
    path,
    text,
    { languageVersion: ts.ScriptTarget.Latest, impliedNodeFormat: format },
    true,
    scriptKinds[language]
  )
}
