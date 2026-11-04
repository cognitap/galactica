/**
 * The symbols a module exports, read from its source text alone. There is no
 * program and no type checker, so one module is read without its imports.
 */

import ts from 'typescript'
import type { Language, SymbolKind } from './contract.ts'
import type { RepoPath, SymbolFacts } from './model.ts'

/** The languages TypeScript parses directly. Framework files need their own compiler. */
export type ScriptLanguage = Exclude<Language, 'vue' | 'svelte' | 'astro'>

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

export function isScriptLanguage(language: Language): language is ScriptLanguage {
  return Object.hasOwn(scriptKinds, language)
}

const maxLength = 160

const collapsed = (text: string) => text.replace(/\s+/g, ' ').trim()

const fits = (text: string) => collapsed(text).length <= maxLength

function oneLine(text: string): string {
  const line = collapsed(text)
  return fits(line) ? line : `${line.slice(0, maxLength - 1)}…`
}

type Guard<T extends ts.Node> = (node: ts.Node) => node is T

function when<T extends ts.Node, R>(
  is: Guard<T>,
  then: (node: T, scope: Scope) => R
): (node: ts.Node, scope: Scope) => R | undefined {
  return (node, scope) => (is(node) ? then(node, scope) : undefined)
}

function firstOf<R>(
  rules: readonly ((node: ts.Node, scope: Scope) => R | undefined)[],
  node: ts.Node,
  scope: Scope
): R | undefined {
  for (const rule of rules) {
    const result = rule(node, scope)
    if (result !== undefined) return result
  }
  return undefined
}

type NamedVariable = ts.VariableDeclaration & { readonly name: ts.Identifier }

type DeclarationStatement =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration

type Declaration = DeclarationStatement | NamedVariable

const isDeclarationStatement = (node: ts.Node): node is DeclarationStatement =>
  ts.isFunctionDeclaration(node) ||
  ts.isClassDeclaration(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isEnumDeclaration(node)

const isNamedVariable = (node: ts.Node): node is NamedVariable =>
  ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)

interface Scope {
  readonly source: ts.SourceFile
  /** The top-level declarations by name, the first one for a name declared twice. */
  readonly locals: ReadonlyMap<string, Declaration>
  /** Every top-level function declaration of a name, so overloads become one symbol. */
  readonly functions: ReadonlyMap<string, readonly ts.FunctionDeclaration[]>
}

/** A symbol before its exported name and default flag are known. */
interface Described {
  readonly kind: SymbolKind
  readonly line: number
  readonly signature: string
  readonly doc: string | undefined
}

interface Exported {
  readonly name: string
  readonly default: boolean
  readonly described: Described
}

/**
 * The node's source text with comments removed and any run of whitespace or
 * comments between two tokens turned into one space.
 */
function flat(node: ts.Node, source: ts.SourceFile): string {
  const tokens = leavesOf(node, source).filter(leaf => leaf.end > leaf.getStart(source))
  return tokens
    .map((token, index) => {
      const gap = index > 0 && token.getStart(source) > tokens[index - 1]!.end
      return `${gap ? ' ' : ''}${token.getText(source)}`
    })
    .join('')
}

function leavesOf(node: ts.Node, source: ts.SourceFile): readonly ts.Node[] {
  const children = node.getChildren(source).filter(child => !ts.isJSDoc(child))
  return children.length === 0 ? [node] : children.flatMap(child => leavesOf(child, source))
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

const keptModifiers: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.AsyncKeyword,
  ts.SyntaxKind.ConstKeyword
])

function modifiersOf(node: ts.Node): ReadonlySet<ts.SyntaxKind> {
  return new Set(ts.canHaveModifiers(node) ? ts.getModifiers(node)?.map(({ kind }) => kind) : [])
}

function prefixOf(node: ts.Node, source: ts.SourceFile): string {
  const modifiers = (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined) ?? []
  return modifiers
    .filter(({ kind }) => keptModifiers.has(kind))
    .map(modifier => `${modifier.getText(source)} `)
    .join('')
}

function listOf(nodes: readonly ts.Node[] | undefined, source: ts.SourceFile): string {
  return nodes ? `<${nodes.map(node => flat(node, source)).join(', ')}>` : ''
}

function heritageOf(
  clauses: readonly ts.HeritageClause[] | undefined,
  source: ts.SourceFile
): string {
  return (clauses ?? []).map(clause => ` ${flat(clause, source)}`).join('')
}

function bindingText(name: ts.BindingName, source: ts.SourceFile): string {
  if (ts.isIdentifier(name)) return name.text
  const elements = name.elements.map(element =>
    ts.isOmittedExpression(element) ? '' : bindingElementText(element, source)
  )
  if (ts.isArrayBindingPattern(name)) return `[${elements.join(', ')}]`
  return elements.length === 0 ? '{}' : `{ ${elements.join(', ')} }`
}

function bindingElementText(element: ts.BindingElement, source: ts.SourceFile): string {
  const rest = element.dotDotDotToken ? '...' : ''
  const property = element.propertyName ? `${flat(element.propertyName, source)}: ` : ''
  return `${rest}${property}${bindingText(element.name, source)}`
}

function parameterText(parameter: ts.ParameterDeclaration, source: ts.SourceFile): string {
  const rest = parameter.dotDotDotToken ? '...' : ''
  const optional = parameter.questionToken ? '?' : ''
  const type = parameter.type ? `: ${flat(parameter.type, source)}` : ''
  return `${rest}${bindingText(parameter.name, source)}${optional}${type}`
}

function callText(fn: ts.SignatureDeclarationBase, source: ts.SourceFile): string {
  const parameters = fn.parameters.map(parameter => parameterText(parameter, source)).join(', ')
  const returns = fn.type ? `: ${flat(fn.type, source)}` : ''
  return `${listOf(fn.typeParameters, source)}(${parameters})${returns}`
}

type FunctionValue = ts.ArrowFunction | ts.FunctionExpression

const isFunctionValue = (node: ts.Node): node is FunctionValue =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node)

function arrowText(fn: FunctionValue, source: ts.SourceFile): string {
  return `${prefixOf(fn, source)}${callText(fn, source)} =>`
}

type Wrapped = ts.ParenthesizedExpression | ts.AsExpression | ts.SatisfiesExpression

const isWrapped = (node: ts.Node): node is Wrapped =>
  ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)

function unwrapped(expression: ts.Expression): ts.Expression {
  return isWrapped(expression) ? unwrapped(expression.expression) : expression
}

function hasAsConst(expression: ts.Expression): boolean {
  if (!isWrapped(expression)) return false
  return (
    (ts.isAsExpression(expression) &&
      ts.isTypeReferenceNode(expression.type) &&
      ts.isIdentifier(expression.type.typeName) &&
      expression.type.typeName.text === 'const') ||
    hasAsConst(expression.expression)
  )
}

const jsxKinds: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment
])

const logicalOperators: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken
])

function isJsx(expression: ts.Expression): boolean {
  const value = unwrapped(expression)
  if (jsxKinds.has(value.kind)) return true
  if (ts.isConditionalExpression(value)) return isJsx(value.whenTrue) || isJsx(value.whenFalse)
  return (
    ts.isBinaryExpression(value) &&
    logicalOperators.has(value.operatorToken.kind) &&
    (isJsx(value.left) || isJsx(value.right))
  )
}

/** Whether a `return` of this function, not of a function nested in it, gives JSX. */
function hasJsxReturn(node: ts.Node): boolean {
  return (
    ts.forEachChild(node, child => {
      if (ts.isFunctionLike(child) || ts.isClassLike(child)) return undefined
      if (ts.isReturnStatement(child)) {
        return child.expression && isJsx(child.expression) ? true : undefined
      }
      return hasJsxReturn(child) || undefined
    }) ?? false
  )
}

function returnsJsx(fn: ts.FunctionLikeDeclaration): boolean {
  if (!fn.body) return false
  return ts.isBlock(fn.body) ? hasJsxReturn(fn.body) : isJsx(fn.body)
}

const componentWrappers: ReadonlySet<string> = new Set([
  'forwardRef',
  'memo',
  'React.forwardRef',
  'React.memo'
])

const componentClasses: ReadonlySet<string> = new Set([
  'Component',
  'PureComponent',
  'React.Component',
  'React.PureComponent'
])

function isWrapperCall(node: ts.Node, source: ts.SourceFile): node is ts.CallExpression {
  return ts.isCallExpression(node) && componentWrappers.has(flat(node.expression, source))
}

function wrappedText(argument: ts.Expression, source: ts.SourceFile): string {
  const inner = unwrapped(argument)
  if (isWrapperCall(inner, source)) return wrapperText(inner, source)
  if (isFunctionValue(inner)) return arrowText(inner, source)
  return ts.isIdentifier(inner) ? inner.text : '...'
}

/** `forwardRef<A, B>((params) =>)`, down to the inner-most wrapped function. */
function wrapperText(call: ts.CallExpression, source: ts.SourceFile): string {
  const [first] = call.arguments
  const argument = first ? wrappedText(first, source) : ''
  return `${flat(call.expression, source)}${listOf(call.typeArguments, source)}(${argument})`
}

const literalKinds: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.RegularExpressionLiteral
])

const isLiteral = (node: ts.Node): boolean =>
  literalKinds.has(node.kind) ||
  (ts.isPrefixUnaryExpression(node) && literalKinds.has(node.operand.kind))

const shapeHints = [
  when(ts.isStringLiteral, () => "'...'"),
  when(ts.isArrayLiteralExpression, () => '[...]'),
  when(ts.isObjectLiteralExpression, () => '{...}'),
  when(ts.isTemplateExpression, () => '`...`'),
  when(ts.isNoSubstitutionTemplateLiteral, () => '`...`'),
  when(ts.isCallExpression, (call, { source }) => `${flat(call.expression, source)}(...)`),
  when(ts.isNewExpression, (call, { source }) => `new ${flat(call.expression, source)}(...)`)
]

function initializerText(head: string, initializer: ts.Expression, scope: Scope): string {
  const value = unwrapped(initializer)
  const asConst = hasAsConst(initializer) ? ' as const' : ''
  const literal = ` = ${flat(value, scope.source)}${asConst}`
  if (isLiteral(value) && fits(head + literal)) return literal
  const hint = firstOf(shapeHints, value, scope)
  return hint === undefined ? '' : ` = ${hint}${asConst}`
}

/** A variable, or a value assigned to an export, described the way a `const` declaration is. */
function valueOf(
  head: string,
  type: ts.TypeNode | undefined,
  initializer: ts.Expression | undefined,
  scope: Scope
): Pick<Described, 'kind' | 'signature'> {
  const { source } = scope
  const value = initializer && unwrapped(initializer)
  if (value && isFunctionValue(value)) {
    return {
      kind: returnsJsx(value) ? 'component' : 'function',
      signature: `${head} = ${arrowText(value, source)}`
    }
  }
  if (value && isWrapperCall(value, source)) {
    return { kind: 'component', signature: `${head} = ${wrapperText(value, source)}` }
  }
  if (type) return { kind: 'const', signature: `${head}: ${flat(type, source)}` }
  return {
    kind: 'const',
    signature: initializer ? head + initializerText(head, initializer, scope) : head
  }
}

/** The first sentence of the closest JSDoc comment, on one line. */
function docOf(node: ts.Node): string | undefined {
  const closest = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1)
  const text = ts.getTextOfJSDocComment(closest?.comment)?.trim()
  if (!text) return undefined
  return oneLine(/^[\s\S]*?\.(?=\s)/.exec(text)?.[0] ?? text)
}

function describedFunction(node: ts.FunctionDeclaration, { source, functions }: Scope): Described {
  const group = (node.name && functions.get(node.name.text)) || [node]
  const first = group[0]!
  const shown = group.find(fn => fn.body !== undefined) ?? first
  const star = shown.asteriskToken ? '*' : ''
  const name = shown.name?.text ?? ''
  return {
    kind: returnsJsx(shown) ? 'component' : 'function',
    line: lineOf(first.name ?? first, source),
    signature: oneLine(
      `${prefixOf(shown, source)}function${star} ${name}${callText(shown, source)}`
    ),
    doc: group.map(fn => docOf(fn)).find(doc => doc !== undefined)
  }
}

function isComponentClass(node: ts.ClassDeclaration, source: ts.SourceFile): boolean {
  const extended = node.heritageClauses?.find(
    clause => clause.token === ts.SyntaxKind.ExtendsKeyword
  )?.types[0]
  return extended !== undefined && componentClasses.has(flat(extended.expression, source))
}

function describedClass(node: ts.ClassDeclaration, { source }: Scope): Described {
  const name = node.name ? ` ${node.name.text}` : ''
  const parameters = listOf(node.typeParameters, source)
  return {
    kind: isComponentClass(node, source) ? 'component' : 'class',
    line: lineOf(node.name ?? node, source),
    signature: oneLine(
      `${prefixOf(node, source)}class${name}${parameters}${heritageOf(node.heritageClauses, source)}`
    ),
    doc: docOf(node)
  }
}

function describedInterface(node: ts.InterfaceDeclaration, { source }: Scope): Described {
  const head = `${prefixOf(node, source)}interface ${node.name.text}`
  const parameters = listOf(node.typeParameters, source)
  return {
    kind: 'interface',
    line: lineOf(node.name, source),
    signature: oneLine(`${head}${parameters}${heritageOf(node.heritageClauses, source)}`),
    doc: docOf(node)
  }
}

function describedType(node: ts.TypeAliasDeclaration, { source }: Scope): Described {
  const head = `${prefixOf(node, source)}type ${node.name.text}${listOf(node.typeParameters, source)} =`
  const full = `${head} ${flat(node.type, source)}`
  return {
    kind: 'type',
    line: lineOf(node.name, source),
    signature: oneLine(fits(full) ? full : `${head} …`),
    doc: docOf(node)
  }
}

function describedEnum(node: ts.EnumDeclaration, { source }: Scope): Described {
  return {
    kind: 'enum',
    line: lineOf(node.name, source),
    signature: oneLine(`${prefixOf(node, source)}enum ${node.name.text}`),
    doc: docOf(node)
  }
}

function describedVariable(node: NamedVariable, scope: Scope): Described {
  const { source } = scope
  const statement = node.parent.parent
  const keyword = node.parent.getFirstToken(source)?.getText(source) ?? 'const'
  const head = `${prefixOf(statement, source)}${keyword} ${node.name.text}`
  const { kind, signature } = valueOf(head, node.type, node.initializer, scope)
  return { kind, line: lineOf(node.name, source), signature: oneLine(signature), doc: docOf(node) }
}

const describers = [
  when(ts.isFunctionDeclaration, describedFunction),
  when(ts.isClassDeclaration, describedClass),
  when(ts.isInterfaceDeclaration, describedInterface),
  when(ts.isTypeAliasDeclaration, describedType),
  when(ts.isEnumDeclaration, describedEnum),
  when(isNamedVariable, describedVariable)
]

function described(declaration: Declaration, scope: Scope): Described {
  return firstOf(describers, declaration, scope)!
}

/** An exported expression that is no local declaration, at the line of the statement that exports it. */
function describedValue(
  name: string,
  value: ts.Expression,
  statement: ts.Statement,
  scope: Scope
): Described {
  const { kind, signature } = valueOf(`const ${name}`, undefined, value, scope)
  return {
    kind,
    line: lineOf(statement, scope.source),
    signature: oneLine(signature),
    doc: docOf(statement)
  }
}

/** A local declaration when `value` names one, else the value itself. */
function exportedValue(
  name: string,
  value: ts.Expression,
  statement: ts.Statement,
  scope: Scope
): Exported {
  const local = ts.isIdentifier(value) ? scope.locals.get(value.text) : undefined
  if (local === undefined) {
    return {
      name,
      default: name === 'default',
      described: describedValue(name, value, statement, scope)
    }
  }
  const own = local.name?.text ?? 'default'
  return name === 'default'
    ? { name: own, default: true, described: described(local, scope) }
    : {
        name,
        default: false,
        described: { ...described(local, scope), line: lineOf(statement, scope.source) }
      }
}

function exportedDeclaration(node: DeclarationStatement, scope: Scope): readonly Exported[] {
  const modifiers = modifiersOf(node)
  if (!modifiers.has(ts.SyntaxKind.ExportKeyword)) return []
  return [
    {
      name: node.name?.text ?? 'default',
      default: modifiers.has(ts.SyntaxKind.DefaultKeyword),
      described: described(node, scope)
    }
  ]
}

function exportedVariables(node: ts.VariableStatement, scope: Scope): readonly Exported[] {
  if (!modifiersOf(node).has(ts.SyntaxKind.ExportKeyword)) return []
  return node.declarationList.declarations.filter(isNamedVariable).map(declaration => ({
    name: declaration.name.text,
    default: false,
    described: described(declaration, scope)
  }))
}

/** `export { a, b as c }` without `from`. Names that are no local declaration are re-exports. */
function exportedSpecifiers(node: ts.ExportDeclaration, scope: Scope): readonly Exported[] {
  if (node.moduleSpecifier || !node.exportClause || !ts.isNamedExports(node.exportClause)) {
    return []
  }
  return node.exportClause.elements.flatMap(specifier => {
    const local = (specifier.propertyName ?? specifier.name).text
    const declaration = scope.locals.get(local)
    if (declaration === undefined) return []
    const isDefault = specifier.name.text === 'default'
    return [
      {
        name: isDefault ? local : specifier.name.text,
        default: isDefault,
        described: described(declaration, scope)
      }
    ]
  })
}

/** `export default value` and `export = value`. */
function exportedAssignment(node: ts.ExportAssignment, scope: Scope): readonly Exported[] {
  return [exportedValue('default', unwrapped(node.expression), node, scope)]
}

const isModuleExports = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'module' &&
  node.name.text === 'exports'

const isExportsObject = (node: ts.Node): boolean =>
  isModuleExports(node) || (ts.isIdentifier(node) && node.text === 'exports')

/** The `key: local` and shorthand `local` properties of `module.exports = { ... }`. */
function exportedProperties(object: ts.ObjectLiteralExpression, scope: Scope): readonly Exported[] {
  return object.properties.flatMap(property => {
    const value = ts.isShorthandPropertyAssignment(property)
      ? property.name
      : ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)
        ? unwrapped(property.initializer)
        : undefined
    const declaration = value && ts.isIdentifier(value) ? scope.locals.get(value.text) : undefined
    const key = property.name
    if (!declaration || !key || ts.isComputedPropertyName(key)) return []
    return [{ name: key.text, default: false, described: described(declaration, scope) }]
  })
}

/** CommonJS: `module.exports = ...`, `module.exports.name = ...` and `exports.name = ...`. */
function exportedCommonJs(node: ts.ExpressionStatement, scope: Scope): readonly Exported[] {
  const assignment = node.expression
  if (
    !ts.isBinaryExpression(assignment) ||
    assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken
  ) {
    return []
  }
  const { left } = assignment
  const right = unwrapped(assignment.right)
  if (isModuleExports(left)) {
    return ts.isObjectLiteralExpression(right)
      ? exportedProperties(right, scope)
      : [exportedValue('default', right, node, scope)]
  }
  if (ts.isPropertyAccessExpression(left) && isExportsObject(left.expression)) {
    return [exportedValue(left.name.text, right, node, scope)]
  }
  return []
}

const statementRules = [
  when(isDeclarationStatement, exportedDeclaration),
  when(ts.isVariableStatement, exportedVariables),
  when(ts.isExportDeclaration, exportedSpecifiers),
  when(ts.isExportAssignment, exportedAssignment),
  when(ts.isExpressionStatement, exportedCommonJs)
]

function localsOf(statements: readonly ts.Statement[]): readonly Declaration[] {
  return statements.flatMap((statement): readonly Declaration[] => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.filter(isNamedVariable)
    }
    return isDeclarationStatement(statement) && statement.name ? [statement] : []
  })
}

function scopeOf(source: ts.SourceFile): Scope {
  const locals = new Map<string, Declaration>()
  const functions = new Map<string, ts.FunctionDeclaration[]>()
  for (const declaration of localsOf(source.statements)) {
    const name = declaration.name!.text
    if (!locals.has(name)) locals.set(name, declaration)
    if (ts.isFunctionDeclaration(declaration)) {
      functions.set(name, [...(functions.get(name) ?? []), declaration])
    }
  }
  return { source, locals, functions }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The module's exported declarations, one per name, sorted by line, then name. */
export function symbolsOf(
  path: RepoPath,
  language: ScriptLanguage,
  text: string
): readonly SymbolFacts[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKinds[language]
  )
  const scope = scopeOf(source)
  const exported = source.statements
    .flatMap(statement => firstOf(statementRules, statement, scope) ?? [])
    .sort((a, b) => a.described.line - b.described.line || compare(a.name, b.name))
  const byName = new Map<string, Exported>()
  for (const entry of exported) {
    const kept = byName.get(entry.name)
    byName.set(entry.name, kept ? { ...kept, default: kept.default || entry.default } : entry)
  }
  return [...byName.values()].map(({ name, default: isDefault, described }) => ({
    name,
    kind: described.kind,
    line: described.line,
    default: isDefault,
    signature: described.signature,
    ...(described.doc === undefined ? {} : { doc: described.doc })
  }))
}
