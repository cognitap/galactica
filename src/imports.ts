/**
 * What a module imports, read from its syntax alone: each import-like
 * statement or call with a literal specifier, and the names it takes from the
 * module it names. Where the specifier leads is the resolver's question.
 */

import ts from 'typescript'
import type { Edge } from './model.ts'

/** An edge before its target is known. */
export interface Import extends Omit<Edge, 'to' | 'via'> {
  /** The specifier as written, which TypeScript also reads the resolution mode from. */
  readonly specifier: ts.StringLiteralLike
}

/** What an import takes, before its line is known. */
interface Taken {
  readonly specifier: ts.Expression | undefined
  readonly form: Edge['form']
  readonly names: readonly string[]
  readonly typeOnly: boolean
  readonly dynamic: boolean
}

type Guard<T extends ts.Node> = (node: ts.Node) => node is T

function when<T extends ts.Node>(
  is: Guard<T>,
  then: (node: T) => Taken | undefined
): (node: ts.Node) => Taken | undefined {
  return node => (is(node) ? then(node) : undefined)
}

const nameOf = (specifier: ts.ImportSpecifier | ts.ExportSpecifier) =>
  (specifier.propertyName ?? specifier.name).text

const allTypeOnly = (specifiers: readonly { readonly isTypeOnly: boolean }[]) =>
  specifiers.length > 0 && specifiers.every(specifier => specifier.isTypeOnly)

function fromImportDeclaration(node: ts.ImportDeclaration): Taken {
  const clause = node.importClause
  const bindings = clause?.namedBindings
  const named = bindings && ts.isNamedImports(bindings) ? bindings.elements : []
  return {
    specifier: node.moduleSpecifier,
    form: 'import',
    names: [
      ...(clause?.name ? ['default'] : []),
      ...(bindings && ts.isNamespaceImport(bindings) ? ['*'] : []),
      ...named.map(nameOf)
    ],
    typeOnly:
      clause?.phaseModifier === ts.SyntaxKind.TypeKeyword ||
      (clause?.name === undefined && allTypeOnly(named)),
    dynamic: false
  }
}

function fromExportDeclaration(node: ts.ExportDeclaration): Taken | undefined {
  if (!node.moduleSpecifier) return undefined
  const clause = node.exportClause
  const named = clause && ts.isNamedExports(clause) ? clause.elements : []
  return {
    specifier: node.moduleSpecifier,
    form: 'reexport',
    names: clause && ts.isNamedExports(clause) ? named.map(nameOf) : ['*'],
    typeOnly: node.isTypeOnly || allTypeOnly(named),
    dynamic: false
  }
}

function fromImportEquals(node: ts.ImportEqualsDeclaration): Taken | undefined {
  const reference = node.moduleReference
  if (!ts.isExternalModuleReference(reference)) return undefined
  const exported = ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
  return {
    specifier: reference.expression,
    form: exported ? 'reexport' : 'import',
    names: ['*'],
    typeOnly: node.isTypeOnly,
    dynamic: false
  }
}

const isRequireCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'require' &&
  node.arguments.length === 1

const isImportCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword

type Wrapper = ts.ParenthesizedExpression | ts.AwaitExpression

const isWrapper = (node: ts.Node): node is Wrapper =>
  ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)

/** The node that uses a call's result, past parentheses and `await`. */
function userOf(call: ts.CallExpression): ts.Node {
  let node: ts.Node = call
  while (isWrapper(node.parent)) node = node.parent
  return node.parent
}

function destructuredNames(pattern: ts.ObjectBindingPattern): readonly string[] {
  const names = pattern.elements.map(element => {
    if (element.dotDotDotToken) return undefined
    const key = element.propertyName ?? element.name
    return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined
  })
  return names.every(name => name !== undefined) ? names : ['*']
}

/**
 * The names a `require()` or `import()` result gives up: those an object
 * destructuring reads, none when the result is discarded, else all of them.
 */
function namesUsed(call: ts.CallExpression): readonly string[] {
  const user = userOf(call)
  if (ts.isExpressionStatement(user) || ts.isVoidExpression(user)) return []
  if (ts.isVariableDeclaration(user) && ts.isObjectBindingPattern(user.name)) {
    return destructuredNames(user.name)
  }
  return ['*']
}

function fromCall(call: ts.CallExpression, dynamic: boolean): Taken {
  return {
    specifier: call.arguments[0],
    form: 'import',
    names: namesUsed(call),
    typeOnly: false,
    dynamic
  }
}

const rules = [
  when(ts.isImportDeclaration, fromImportDeclaration),
  when(ts.isExportDeclaration, fromExportDeclaration),
  when(ts.isImportEqualsDeclaration, fromImportEquals),
  when(isRequireCall, call => fromCall(call, false)),
  when(isImportCall, call => fromCall(call, true))
]

function takenBy(node: ts.Node): Taken | undefined {
  for (const rule of rules) {
    const taken = rule(node)
    if (taken !== undefined) return taken
  }
  return undefined
}

const sortedNames = (names: readonly string[]) =>
  [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** The module's imports in source order. Specifiers that are no string literal are skipped. */
export function importsOf(source: ts.SourceFile): readonly Import[] {
  const imports: Import[] = []
  const visit = (node: ts.Node): void => {
    const taken = takenBy(node)
    const specifier = taken?.specifier
    if (taken && specifier && ts.isStringLiteralLike(specifier)) {
      imports.push({
        specifier,
        line: source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1,
        form: taken.form,
        names: sortedNames(taken.names),
        typeOnly: taken.typeOnly,
        dynamic: taken.dynamic
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}
