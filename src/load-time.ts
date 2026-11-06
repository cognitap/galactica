/**
 * Which imported names a module reads while it loads. Top-level code runs when
 * the module is evaluated: statements, initializers, class bodies and static
 * blocks, decorators, and the bodies of top-level functions and classes that
 * load-time code calls. A function body runs only when called. In an import
 * cycle a name read at load time can come from a module still loading, which
 * is `undefined` in CommonJS and throws "Cannot access before initialization"
 * in ES modules. Read from the syntax tree alone, like the imports themselves.
 */

import ts from 'typescript'
import { pushChildren } from './syntax.ts'

/** A name an import binds in the module's top-level scope. */
export interface Bound {
  readonly specifier: ts.Expression
  /** As the imported module exports it. */
  readonly taken: string
}

export const isRequireCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'require' &&
  node.arguments.length === 1

/** The names among `names` that the import at `specifier` gives the module's load-time code. */
export type LoadTime = (specifier: ts.Expression, names: readonly string[]) => readonly string[]

/**
 * When code runs: while the module loads, or later. Later code inside a
 * top-level function or class runs when load-time code calls it, so it is
 * recorded under that declaration's name, its owner.
 */
type Runs = { readonly at: 'load' } | { readonly at: 'later'; readonly owner: string | undefined }

const LOAD: Runs = { at: 'load' }

const unwrap = (node: ts.Node): ts.Node =>
  ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node

/** The node whose value `node` is, past parentheses. */
function outerOf(node: ts.Node): ts.Node {
  let outer = node.parent
  while (ts.isParenthesizedExpression(outer)) outer = outer.parent
  return outer
}

const isTopLevelVariable = (node: ts.Node): node is ts.VariableDeclaration =>
  ts.isVariableDeclaration(node) &&
  ts.isVariableStatement(node.parent.parent) &&
  ts.isSourceFile(node.parent.parent.parent)

const isCallable = (node: ts.Node) =>
  ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isClassExpression(node)

/** The top-level name a function or class is declared or stored under, if any. */
function topLevelName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
    return ts.isSourceFile(node.parent) ? node.name?.text : undefined
  }
  const outer = outerOf(node)
  return isTopLevelVariable(outer) && ts.isIdentifier(outer.name) ? outer.name.text : undefined
}

/** The top-level functions and classes, whose bodies run when load-time code calls them. */
function ownersOf(source: ts.SourceFile): ReadonlySet<string> {
  const owners = new Set<string>()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) owners.add(statement.name.text)
    } else if (ts.isVariableStatement(statement)) {
      for (const { name, initializer } of statement.declarationList.declarations) {
        if (ts.isIdentifier(name) && initializer && isCallable(unwrap(initializer))) {
          owners.add(name.text)
        }
      }
    }
  }
  return owners
}

/** `const x = require('...')` at the top level binds `x` like `import * as x`. */
function requireBindings(source: ts.SourceFile): Map<string, Bound & { call: ts.Node }> {
  const bindings = new Map<string, Bound & { call: ts.Node }>()
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const { name, initializer } of statement.declarationList.declarations) {
      const call = initializer && unwrap(initializer)
      if (!call || !isRequireCall(call) || !ts.isIdentifier(name)) continue
      bindings.set(name.text, { specifier: call.arguments[0]!, taken: '*', call })
    }
  }
  return bindings
}

type Add = (name: string) => void

function bindingNames(name: ts.BindingName, add: Add): void {
  if (ts.isIdentifier(name)) add(name.text)
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) bindingNames(element.name, add)
}

function statementNames(statements: readonly ts.Statement[], add: Add): void {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        bindingNames(declaration.name, add)
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      add(statement.name.text)
    }
  }
}

/** Gives `add` the names a nested scope declares, which hide a top-level name of the same text inside it. */
function declaredIn(node: ts.Node, add: Add): void {
  if (ts.isBlock(node) || ts.isModuleBlock(node)) statementNames(node.statements, add)
  else if (ts.isCaseBlock(node)) {
    for (const clause of node.clauses) statementNames(clause.statements, add)
  } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const initializer = node.initializer
    if (initializer && ts.isVariableDeclarationList(initializer)) {
      for (const declaration of initializer.declarations) bindingNames(declaration.name, add)
    }
  } else if (ts.isCatchClause(node)) {
    if (node.variableDeclaration) bindingNames(node.variableDeclaration.name, add)
  } else if (isBody(node)) {
    for (const parameter of node.parameters) bindingNames(parameter.name, add)
    if (ts.isFunctionExpression(node) && node.name) add(node.name.text)
  } else if (ts.isClassExpression(node) && node.name) {
    add(node.name.text)
  }
}

/** Whether an identifier reads a binding, rather than naming a property, a declaration or a label. */
function isReference(id: ts.Identifier): boolean {
  const parent = id.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === id
  if (ts.isQualifiedName(parent)) return false
  if (ts.isBindingElement(parent) && parent.propertyName === id) return false
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isMetaProperty(parent)
  ) {
    return false
  }
  return !('name' in parent && parent.name === id && !ts.isShorthandPropertyAssignment(parent))
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (node.modifiers?.some(modifier => modifier.kind === kind) ?? false)

/** A function expression or arrow called where it stands, which runs its body with the caller. */
const isInvoked = (node: ts.Node) => {
  const outer = outerOf(node)
  return (
    (ts.isCallExpression(outer) || ts.isNewExpression(outer)) && unwrap(outer.expression) === node
  )
}

type Body =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration

const isBody = (node: ts.Node): node is Body =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessor(node) ||
  ts.isSetAccessor(node)

/** The top-level declaration whose call runs `node`'s body. A method runs only on a call this pass does not follow. */
function ownerOf(node: Body): string | undefined {
  if (ts.isConstructorDeclaration(node)) return topLevelName(node.parent)
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return topLevelName(node)
  }
  return undefined
}

export function loadTimeOf(source: ts.SourceFile, imports: ReadonlyMap<string, Bound>): LoadTime {
  const requires = source.text.includes('require')
  if (imports.size === 0 && !requires) return () => []
  const required = requires ? requireBindings(source) : new Map<string, Bound & { call: ts.Node }>()
  const bindings = new Map<string, Bound>([...imports, ...required])
  const boundCalls = new Set([...required.values()].map(({ call }) => call))
  const owners = ownersOf(source)
  const tracked = new Set([...bindings.keys(), ...owners])

  const read = new Set<string>()
  const wholeCalls = new Set<ts.Expression>()
  const started = new Set<string>()
  const readBy = new Map<string, Set<string>>()
  const calledBy = new Map<string, Set<string>>()

  let runs = LOAD
  /**
   * What the walk has left to do, the next step last: a node to visit, or a
   * step such as leaving a scope that runs once everything pushed after it
   * has. A stack, not recursion, so a tree thousands of levels deep cannot
   * overflow the call stack.
   */
  const pending: (ts.Node | (() => void))[] = []
  const visitChildren = (node: ts.Node) => pushChildren(pending, node, child => child)
  /** The tracked names each enclosing nested scope declares, for the scopes that declare any. */
  const hiding: ReadonlySet<string>[] = []
  const isHidden = (name: string) => hiding.some(names => names.has(name))
  let hidden: Set<string> | undefined
  const hide = (name: string) => {
    if (tracked.has(name)) (hidden ??= new Set()).add(name)
  }
  const note = (name: string, load: Set<string>, later: Map<string, Set<string>>) => {
    if (runs.at === 'load') load.add(name)
    else if (runs.owner !== undefined) {
      const names = later.get(runs.owner) ?? new Set()
      later.set(runs.owner, names.add(name))
    }
  }
  /** Visits the children of `node`, those `inside` accepts with `inner`, the rest as before. */
  const split = (node: ts.Node, inner: Runs, inside: (child: ts.Node) => boolean) => {
    const outer = runs
    pending.push(() => {
      runs = outer
    })
    pushChildren(pending, node, child => () => {
      runs = inside(child) ? inner : outer
      visit(child)
    })
  }
  const call = (node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression) => {
    const callee = unwrap(ts.isTaggedTemplateExpression(node) ? node.tag : node.expression)
    if (ts.isIdentifier(callee) && owners.has(callee.text) && !isHidden(callee.text)) {
      note(callee.text, started, calledBy)
    }
    if (runs.at === 'load' && isRequireCall(node) && !boundCalls.has(node)) {
      wholeCalls.add(node.arguments[0]!)
    }
  }
  const body = (node: Body) => {
    if (runs.at === 'later' || isInvoked(node)) return visitChildren(node)
    const inner: Runs = { at: 'later', owner: ownerOf(node) }
    split(node, inner, child => !ts.isDecorator(child) && child !== node.name)
  }
  const inScope = (node: ts.Node, enter: () => void) => {
    hidden = undefined
    declaredIn(node, hide)
    const names = hidden
    if (names) {
      hiding.push(names)
      pending.push(() => hiding.pop())
    }
    enter()
  }

  const visit = (node: ts.Node): void => {
    const { SyntaxKind: Kind } = ts
    switch (node.kind) {
      case Kind.Identifier: {
        const name = (node as ts.Identifier).text
        if (bindings.has(name) && isReference(node as ts.Identifier) && !isHidden(name)) {
          note(name, read, readBy)
        }
        return
      }
      case Kind.ExpressionWithTypeArguments:
        return visit((node as ts.ExpressionWithTypeArguments).expression)
      case Kind.InterfaceDeclaration:
      case Kind.TypeAliasDeclaration:
      case Kind.ImportDeclaration:
      case Kind.ImportEqualsDeclaration:
      case Kind.ExportDeclaration:
        return
      case Kind.HeritageClause:
        if ((node as ts.HeritageClause).token === Kind.ImplementsKeyword) return
        break
      case Kind.VariableStatement:
      case Kind.ModuleDeclaration:
      case Kind.EnumDeclaration:
      case Kind.ClassDeclaration:
        if (hasModifier(node, Kind.DeclareKeyword)) return
        break
      case Kind.CallExpression:
      case Kind.NewExpression:
      case Kind.TaggedTemplateExpression:
        call(node as ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression)
        break
      case Kind.FunctionDeclaration:
        if (hasModifier(node, Kind.DeclareKeyword)) return
        return inScope(node, () => body(node as Body))
      case Kind.FunctionExpression:
      case Kind.ArrowFunction:
      case Kind.MethodDeclaration:
      case Kind.Constructor:
      case Kind.GetAccessor:
      case Kind.SetAccessor:
        return inScope(node, () => body(node as Body))
      case Kind.Block:
      case Kind.ModuleBlock:
      case Kind.CaseBlock:
      case Kind.ForStatement:
      case Kind.ForInStatement:
      case Kind.ForOfStatement:
      case Kind.CatchClause:
      case Kind.ClassExpression:
        return inScope(node, () => visitChildren(node))
      case Kind.PropertyDeclaration: {
        const property = node as ts.PropertyDeclaration
        if (runs.at === 'later' || hasModifier(property, Kind.StaticKeyword)) break
        const inner: Runs = { at: 'later', owner: topLevelName(property.parent) }
        return split(property, inner, child => child === property.initializer)
      }
      default:
        if (node.kind >= Kind.FirstTypeNode && node.kind <= Kind.LastTypeNode) return
    }
    visitChildren(node)
  }
  for (const statement of source.statements.toReversed()) pending.push(statement)
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === 'function') next()
    else visit(next)
  }

  const queue = [...started]
  for (let owner = queue.pop(); owner !== undefined; owner = queue.pop()) {
    for (const name of readBy.get(owner) ?? []) read.add(name)
    for (const callee of calledBy.get(owner) ?? []) {
      if (started.has(callee)) continue
      started.add(callee)
      queue.push(callee)
    }
  }

  const taken = new Map<ts.Expression, Set<string>>()
  for (const name of read) {
    const { specifier, taken: exported } = bindings.get(name)!
    taken.set(specifier, (taken.get(specifier) ?? new Set()).add(exported))
  }
  return (specifier, names) =>
    wholeCalls.has(specifier) ? names : names.filter(name => taken.get(specifier)?.has(name))
}
