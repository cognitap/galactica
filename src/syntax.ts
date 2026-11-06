/**
 * How TypeScript parses a script module. Each module is parsed once, and the
 * readers of its symbols and its imports walk the same tree.
 */

import ts from 'typescript'
import type { RepoPath } from './model.ts'
import type { ScriptLanguage } from './frameworks.ts'

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

type Rule<C, R> = (node: ts.Node, context: C) => R | undefined

/** A rule of a table: `then` gives the result for a node `is` accepts, and no node else gives one. */
export function when<T extends ts.Node, C, R>(
  is: (node: ts.Node) => node is T,
  then: (node: T, context: C) => R
): Rule<C, R> {
  return (node, context) => (is(node) ? then(node, context) : undefined)
}

/** The result of the first rule that gives one for `node`. */
export function firstOf<C, R>(
  rules: readonly Rule<C, R>[],
  node: ts.Node,
  context: C
): R | undefined {
  for (const rule of rules) {
    const result = rule(node, context)
    if (result !== undefined) return result
  }
  return undefined
}

/**
 * Pushes the children of `node` onto `stack`, each as `wrap` gives it, so that
 * they pop in source order. A walk that keeps its own stack this way has no
 * depth limit, where recursion overflows on a tree thousands of levels deep.
 */
export function pushChildren<T>(stack: T[], node: ts.Node, wrap: (child: ts.Node) => T): void {
  const start = stack.length
  ts.forEachChild(node, child => {
    stack.push(wrap(child))
  })
  for (let low = start, high = stack.length - 1; low < high; low++, high--) {
    ;[stack[low], stack[high]] = [stack[high]!, stack[low]!]
  }
}
