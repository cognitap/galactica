/**
 * What a module imports, read from its syntax alone: each import-like
 * statement or call with a literal specifier, and the names it takes from the
 * module it names. Where the specifier leads is the resolver's question.
 */

import ts from 'typescript'
import { parseRepoPath, type Edge } from './model.ts'
import { parseScript, type ScriptLanguage } from './syntax.ts'

/** How an import is written, which TypeScript reads its resolution mode from. */
export type ImportSyntax = 'declaration' | 'import-equals' | 'require' | 'import-call'

/** An edge before its target is known. Plain data, read from the module's syntax tree alone. */
export interface Import extends Omit<Edge, 'to' | 'via'> {
  readonly specifier: string
  readonly syntax: ImportSyntax
  /** The `resolution-mode` attribute of a type-only import or export, which overrides the syntax. */
  readonly resolutionMode?: 'import' | 'require'
}

/** What an import takes, before its line is known. */
interface Taken {
  readonly specifier: ts.Expression | undefined
  readonly syntax: ImportSyntax
  readonly form: Edge['form']
  readonly names: readonly string[]
  readonly renames?: Edge['renames']
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
    syntax: 'declaration',
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

const byKey = ([a]: readonly [string, string], [b]: readonly [string, string]) =>
  a < b ? -1 : a > b ? 1 : 0

/** Without an entry for each name passed on unrenamed, `{ a as b, a }` would read as `{ a as b }`. */
function renamesOf(specifiers: readonly ts.ExportSpecifier[]): Edge['renames'] {
  const renamed = new Set(
    specifiers.filter(specifier => nameOf(specifier) !== specifier.name.text).map(nameOf)
  )
  const entries = specifiers
    .filter(specifier => renamed.has(nameOf(specifier)))
    .map(specifier => [specifier.name.text, nameOf(specifier)] as const)
  return entries.length > 0 ? Object.fromEntries(entries.sort(byKey)) : undefined
}

function fromExportDeclaration(node: ts.ExportDeclaration): Taken | undefined {
  if (!node.moduleSpecifier) return undefined
  const clause = node.exportClause
  const named = clause && ts.isNamedExports(clause) ? clause.elements : []
  return {
    specifier: node.moduleSpecifier,
    syntax: 'declaration',
    form: 'reexport',
    names: clause && ts.isNamedExports(clause) ? named.map(nameOf) : ['*'],
    renames:
      clause === undefined
        ? undefined
        : ts.isNamedExports(clause)
          ? renamesOf(named)
          : { [clause.name.text]: '*' },
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
    syntax: 'import-equals',
    form: exported ? 'reexport' : 'import',
    names: ['*'],
    renames: exported ? { [node.name.text]: '*' } : undefined,
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
    syntax: dynamic ? 'import-call' : 'require',
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

/** Options under which module resolution ignores import syntax, so TypeScript gives a mode only for an override. */
const syntaxBlind: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  resolvePackageJsonExports: false,
  resolvePackageJsonImports: false
}

function overrideOf(
  source: ts.SourceFile,
  specifier: ts.StringLiteralLike
): Import['resolutionMode'] {
  const mode = ts.getModeForUsageLocation(source, specifier, syntaxBlind)
  if (mode === undefined) return undefined
  return mode === ts.ModuleKind.CommonJS ? 'require' : 'import'
}

/** The module's imports in source order. Specifiers that are no string literal are skipped. */
export function importsOf(source: ts.SourceFile): readonly Import[] {
  const imports: Import[] = []
  const visit = (node: ts.Node): void => {
    const taken = takenBy(node)
    const specifier = taken?.specifier
    if (taken && specifier && ts.isStringLiteralLike(specifier)) {
      const resolutionMode = overrideOf(source, specifier)
      imports.push({
        specifier: specifier.text,
        syntax: taken.syntax,
        ...(resolutionMode === undefined ? {} : { resolutionMode }),
        line: source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1,
        form: taken.form,
        names: sortedNames(taken.names),
        ...(taken.renames === undefined ? {} : { renames: taken.renames }),
        typeOnly: taken.typeOnly,
        dynamic: taken.dynamic
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return imports
}

const standInText = [
  "import 'declaration'",
  "import x = require('import-equals')",
  "require('require')",
  "import('import-call')"
].join('\n')

interface StandIn {
  readonly source: ts.SourceFile
  readonly specifiers: ReadonlyMap<string, ts.StringLiteralLike>
}

const standIns = new Map<string, StandIn>()

/** A file with one import of each syntax, each specifier naming its syntax, in the language and format given. */
function standInOf(language: ScriptLanguage, format: ts.ResolutionMode): StandIn {
  const key = `${language}:${format}`
  const cached = standIns.get(key)
  if (cached) return cached
  const source = parseScript(parseRepoPath(`stand-in.${language}`), language, standInText, format)
  const specifiers = new Map<string, ts.StringLiteralLike>()
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) specifiers.set(node.text, node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  const standIn = { source, specifiers }
  standIns.set(key, standIn)
  return standIn
}

/**
 * The mode TypeScript resolves an import in. It reads the mode from the
 * specifier's place in the tree and the file's name and format, so the same
 * syntax in a stand-in file of the module's language and format gives the
 * same mode without the module's own tree.
 */
export function resolutionModeOf(
  imported: Pick<Import, 'syntax' | 'resolutionMode'>,
  language: ScriptLanguage,
  format: ts.ResolutionMode,
  options: ts.CompilerOptions
): ts.ResolutionMode {
  if (imported.resolutionMode === 'require') return ts.ModuleKind.CommonJS
  if (imported.resolutionMode === 'import') return ts.ModuleKind.ESNext
  const { source, specifiers } = standInOf(language, format)
  return ts.getModeForUsageLocation(source, specifiers.get(imported.syntax)!, options)
}
