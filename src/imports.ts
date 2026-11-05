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
  /** Where the line is read when it is not the specifier's. */
  readonly at?: ts.Node
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

/** A name a module passes on, as it exports it and as its source module exports it. */
interface Passed {
  readonly exported: string
  readonly taken: string
}

const passedBy = (specifier: ts.ExportSpecifier): Passed => ({
  exported: specifier.name.text,
  taken: nameOf(specifier)
})

/** Without an entry for each name passed on unrenamed, `{ a as b, a }` would read as `{ a as b }`. */
function renamesOf(passed: readonly Passed[]): Edge['renames'] {
  const renamed = new Set(
    passed.filter(({ exported, taken }) => exported !== taken).map(({ taken }) => taken)
  )
  const entries = passed
    .filter(({ taken }) => renamed.has(taken))
    .map(({ exported, taken }) => [exported, taken] as const)
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
          ? renamesOf(named.map(passedBy))
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

/** A name a top-level import binds in the module, with the import it comes from. */
export interface Binding {
  readonly specifier: ts.Expression
  readonly syntax: ImportSyntax
  /** As the imported module exports it. */
  readonly taken: string
  readonly typeOnly: boolean
}

export function bindingsOf(source: ts.SourceFile): ReadonlyMap<string, Binding> {
  const bindings = new Map<string, Binding>()
  for (const statement of source.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      const reference = statement.moduleReference
      if (!ts.isExternalModuleReference(reference)) continue
      bindings.set(statement.name.text, {
        specifier: reference.expression,
        syntax: 'import-equals',
        taken: '*',
        typeOnly: statement.isTypeOnly
      })
    }
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue
    const clause = statement.importClause
    const typeOnly = clause.phaseModifier === ts.SyntaxKind.TypeKeyword
    const bind = (name: ts.Identifier, taken: string, inlineType = false) =>
      bindings.set(name.text, {
        specifier: statement.moduleSpecifier,
        syntax: 'declaration',
        taken,
        typeOnly: typeOnly || inlineType
      })
    if (clause.name) bind(clause.name, 'default')
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) bind(named.name, '*')
    for (const element of named && ts.isNamedImports(named) ? named.elements : []) {
      bind(element.name, nameOf(element), element.isTypeOnly)
    }
  }
  return bindings
}

interface PassedOn extends Passed {
  readonly binding: Binding
  readonly typeOnly: boolean
}

/** What `export { local }` and `export default local` at the top level pass on of the imported bindings they name. */
function passedOn(node: ts.Node, bindings: ReadonlyMap<string, Binding>): readonly PassedOn[] {
  if (node.parent?.kind !== ts.SyntaxKind.SourceFile) return []
  if (ts.isExportAssignment(node) && !node.isExportEquals && ts.isIdentifier(node.expression)) {
    const binding = bindings.get(node.expression.text)
    if (binding === undefined) return []
    return [{ exported: 'default', taken: binding.taken, binding, typeOnly: binding.typeOnly }]
  }
  if (!ts.isExportDeclaration(node) || node.moduleSpecifier) return []
  const clause = node.exportClause
  return (clause && ts.isNamedExports(clause) ? clause.elements : []).flatMap(specifier => {
    const binding = bindings.get(nameOf(specifier))
    if (binding === undefined) return []
    const typeOnly = node.isTypeOnly || specifier.isTypeOnly || binding.typeOnly
    return [{ exported: specifier.name.text, taken: binding.taken, binding, typeOnly }]
  })
}

/** One re-export for each import whose bindings `node` passes on, at the line of `node`. */
function reexportsOf(node: ts.Node, bindings: ReadonlyMap<string, Binding>): readonly Taken[] {
  const byImport = Map.groupBy(passedOn(node, bindings), ({ binding }) => binding.specifier)
  return [...byImport].map(([specifier, passed]) => ({
    specifier,
    at: node,
    syntax: passed[0]!.binding.syntax,
    form: 'reexport',
    names: passed.map(({ taken }) => taken),
    renames: renamesOf(passed),
    typeOnly: passed.every(({ typeOnly }) => typeOnly),
    dynamic: false
  }))
}

const rules = [
  when(ts.isImportDeclaration, fromImportDeclaration),
  when(ts.isExportDeclaration, fromExportDeclaration),
  when(ts.isImportEqualsDeclaration, fromImportEquals),
  when(isRequireCall, call => fromCall(call, false)),
  when(isImportCall, call => fromCall(call, true))
]

function takenBy(node: ts.Node, bindings: ReadonlyMap<string, Binding>): readonly Taken[] {
  for (const rule of rules) {
    const taken = rule(node)
    if (taken !== undefined) return [taken]
  }
  return reexportsOf(node, bindings)
}

const sortedNames = (names: readonly string[]) =>
  [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/**
 * Options under which module resolution ignores import syntax, so TypeScript
 * gives a mode only for an override. Empty options would not do, since the
 * defaults of TypeScript 6 resolve package exports, which reads the syntax.
 */
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
  const bindings = bindingsOf(source)
  const imports: Import[] = []
  const visit = (node: ts.Node): void => {
    for (const taken of takenBy(node, bindings)) {
      const specifier = taken.specifier
      if (!specifier || !ts.isStringLiteralLike(specifier)) continue
      const resolutionMode = overrideOf(source, specifier)
      const at = taken.at ?? specifier
      imports.push({
        specifier: specifier.text,
        syntax: taken.syntax,
        ...(resolutionMode === undefined ? {} : { resolutionMode }),
        line: source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1,
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
