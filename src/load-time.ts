/**
 * Which imported names a module reads while it loads. Top-level code runs when
 * the module is evaluated: statements, initializers, class bodies and static
 * blocks, decorators, and the bodies of top-level functions and classes that
 * load-time code calls. A function body runs only when called. In an import
 * cycle a name read at load time can come from a module still loading, which
 * is `undefined` in CommonJS and throws "Cannot access before initialization"
 * in ES modules. Read from the syntax tree alone, like the imports themselves.
 *
 * The same walk tells whether any code reads an import's bindings as values,
 * which decides whether TypeScript keeps the import in its output.
 */

import ts from 'typescript'
import { pushChildren } from './syntax.ts'

/** A name an import binds in the module's top-level scope. */
export interface Bound {
  readonly specifier: ts.Expression
  /** As the imported module exports it. */
  readonly taken: string
  /** Written type-only, so emitDecoratorMetadata never reads it. */
  readonly typeOnly?: boolean
}

export const isRequireCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'require' &&
  node.arguments.length === 1

/** How the module uses the bindings of one import. */
export interface Use {
  /** The import's names its load-time code reads. */
  readonly loadTime: readonly string[]
  /**
   * What reads a binding as a value: `code`, or only the decorated signatures
   * that emitDecoratorMetadata reads types from as the class is defined.
   * Absent when only types use the bindings, or nothing does.
   */
  readonly value?: 'code' | 'metadata'
  /** The import's names a decorated signature names in load-time code. */
  readonly metadataLoadTime: readonly string[]
  /** Local bindings JSX may read through a factory selected by compiler options or a pragma. */
  readonly jsx?: JSXRead
}

export interface JSXRead {
  readonly names: readonly string[]
  readonly factory?: string
  readonly fragmentFactory?: string
  readonly fragment?: true
}

/** How the module uses the import at `specifier`, which takes `names`. */
export type Uses = (specifier: ts.Expression, names: readonly string[]) => Use

const unused: Use = { loadTime: [], metadataLoadTime: [] }

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

function rootOf(name: ts.EntityName): ts.Identifier {
  while (ts.isQualifiedName(name)) name = name.left
  return name
}

/** The type metadata records for a rest parameter: its element type, if it names one. */
function restElement(type: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (type && ts.isArrayTypeNode(type)) return type.elementType
  if (type && ts.isTypeReferenceNode(type) && type.typeArguments?.length === 1) {
    return type.typeArguments[0]
  }
  return undefined
}

/**
 * The types of a class's decorated signatures, which emitDecoratorMetadata
 * records: a property's type, an accessor's, the parameters and return type of
 * a method with a body, and the parameters of the constructor with a body when
 * the class or one of them is decorated.
 */
function decoratedTypes(node: ts.ClassLikeDeclaration): readonly ts.TypeNode[] {
  const decorated = (member: ts.Node) =>
    ts.canHaveDecorators(member) && (ts.getDecorators(member)?.length ?? 0) > 0
  const parameters = ({ parameters }: ts.SignatureDeclarationBase) =>
    parameters.map(({ dotDotDotToken, type }) => (dotDotDotToken ? restElement(type) : type))
  const types = node.members.flatMap(member => {
    if (ts.isConstructorDeclaration(member)) {
      const recorded = decorated(node) || member.parameters.some(decorated)
      return recorded && member.body ? parameters(member) : []
    }
    if (ts.isMethodDeclaration(member)) {
      return member.body && (decorated(member) || member.parameters.some(decorated))
        ? [...parameters(member), member.type]
        : []
    }
    if (!decorated(member)) return []
    if (ts.isPropertyDeclaration(member) || ts.isGetAccessor(member)) return [member.type]
    return ts.isSetAccessor(member) ? parameters(member) : []
  })
  return types.filter(type => type !== undefined)
}

/**
 * The name whose value the metadata of `type` reads, found as TypeScript's
 * checker finds it: a type reference, or the one name every member of a union,
 * intersection or conditional type refers to. `null` and `undefined` members
 * count for nothing, as without `strictNullChecks`, which keeps more imports.
 */
function metadataName(type: ts.TypeNode): string | undefined {
  while (ts.isParenthesizedTypeNode(type) || ts.isNamedTupleMember(type)) type = type.type
  if (ts.isTypeReferenceNode(type)) return rootOf(type.typeName).text
  const members =
    ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)
      ? type.types
      : ts.isConditionalTypeNode(type)
        ? [type.trueType, type.falseType]
        : undefined
  if (members === undefined) return undefined
  const names = new Set<string | undefined>()
  for (const member of members) {
    let inner = member
    while (ts.isParenthesizedTypeNode(inner) || ts.isNamedTupleMember(inner)) inner = inner.type
    const kind = inner.kind
    const nothing =
      kind === ts.SyntaxKind.NeverKeyword ||
      kind === ts.SyntaxKind.UndefinedKeyword ||
      (ts.isLiteralTypeNode(inner) && inner.literal.kind === ts.SyntaxKind.NullKeyword)
    if (!nothing) names.add(metadataName(inner))
  }
  const [name] = names
  return names.size === 1 ? name : undefined
}

/** Pragmas override compiler options; keep their binding roots without choosing the options here. */
function jsxPragmasOf(source: ts.SourceFile): Omit<JSXRead, 'names' | 'fragment'> {
  const pragmas = [...source.text.matchAll(/@jsx(Frag)?\s+([A-Za-z_$][\w$]*)/g)]
  const factory = pragmas.findLast(match => !match[1])?.[2]
  const fragmentFactory = pragmas.findLast(match => match[1])?.[2]
  return {
    ...(factory === undefined ? {} : { factory }),
    ...(fragmentFactory === undefined ? {} : { fragmentFactory })
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

interface DeferredReads {
  readonly load: Set<string>
  readonly later: Map<string, Set<string>>
}

const deferredReads = (): DeferredReads => ({ load: new Set(), later: new Map() })

function readState() {
  return {
    code: deferredReads(),
    metadata: deferredReads(),
    calls: deferredReads(),
    values: new Set<string>(),
    metadataValues: new Set<string>(),
    wholeCalls: new Set<ts.Expression>(),
    jsx: false,
    fragment: false
  }
}

type ReadState = ReturnType<typeof readState>
type Pending = (ts.Node | (() => void))[]

/** Nested declarations hide tracked names until the pending walk leaves their scope. */
function scopesOf(tracked: ReadonlySet<string>, pending: Pending) {
  const hiding: ReadonlySet<string>[] = []
  return {
    isHidden: (name: string) => hiding.some(names => names.has(name)),
    enter(node: ts.Node, visit: () => void) {
      let names: Set<string> | undefined
      declaredIn(node, name => {
        if (tracked.has(name)) (names ??= new Set()).add(name)
      })
      if (names) {
        hiding.push(names)
        pending.push(() => hiding.pop())
      }
      visit()
    }
  }
}

interface Walk {
  readonly bindings: ReadonlyMap<string, Bound>
  readonly owners: ReadonlySet<string>
  readonly boundCalls: ReadonlySet<ts.Node>
  readonly reads: ReadState
  readonly scopes: ReturnType<typeof scopesOf>
  runs: Runs
}

/** A read happens now, or belongs to a declaration whose body may be called later. */
function note(name: string, runs: Runs, reads: DeferredReads): void {
  if (runs.at === 'load') reads.load.add(name)
  else if (runs.owner !== undefined) {
    const names = reads.later.get(runs.owner) ?? new Set()
    reads.later.set(runs.owner, names.add(name))
  }
}

function recordIdentifier(walk: Walk, id: ts.Identifier): void {
  const name = id.text
  if (walk.bindings.has(name) && isReference(id) && !walk.scopes.isHidden(name)) {
    walk.reads.values.add(name)
    note(name, walk.runs, walk.reads.code)
  }
}

function recordCall(
  walk: Walk,
  node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression
): void {
  const callee = unwrap(ts.isTaggedTemplateExpression(node) ? node.tag : node.expression)
  if (
    ts.isIdentifier(callee) &&
    walk.owners.has(callee.text) &&
    !walk.scopes.isHidden(callee.text)
  ) {
    note(callee.text, walk.runs, walk.reads.calls)
  }
  if (walk.runs.at === 'load' && isRequireCall(node) && !walk.boundCalls.has(node)) {
    walk.reads.wholeCalls.add(node.arguments[0]!)
  }
}

function recordMetadata(walk: Walk, node: ts.ClassLikeDeclaration): void {
  for (const type of decoratedTypes(node)) {
    const name = metadataName(type)
    if (name === undefined) continue
    const bound = walk.bindings.get(name)
    if (bound === undefined || bound.typeOnly || walk.scopes.isHidden(name)) continue
    walk.reads.metadataValues.add(name)
    note(name, walk.runs, walk.reads.metadata)
  }
}

function recordExports(
  reads: ReadState,
  { moduleSpecifier, isTypeOnly, exportClause }: ts.ExportDeclaration
): void {
  if (moduleSpecifier || isTypeOnly || !exportClause || !ts.isNamedExports(exportClause)) return
  for (const element of exportClause.elements) {
    if (!element.isTypeOnly) reads.values.add((element.propertyName ?? element.name).text)
  }
}

/** Computed property names in types keep their imports without reading them at run time. */
function recordComputedNames(walk: Walk, type: ts.Node): void {
  const inner: ts.Node[] = [type]
  const expressions: ts.Node[] = []
  for (let next = inner.pop(); next !== undefined; next = inner.pop()) {
    if (ts.isComputedPropertyName(next)) expressions.push(next.expression)
    else pushChildren(inner, next, child => child)
  }
  for (let next = expressions.pop(); next !== undefined; next = expressions.pop()) {
    if (!ts.isIdentifier(next)) pushChildren(expressions, next, child => child)
    else if (
      walk.bindings.has(next.text) &&
      isReference(next) &&
      !walk.scopes.isHidden(next.text)
    ) {
      walk.reads.values.add(next.text)
    }
  }
}

/** Follow calls between top-level owners once, including recursive call graphs. */
function propagateCalls({ code, metadata, calls }: ReadState): void {
  const queue = [...calls.load]
  for (let owner = queue.pop(); owner !== undefined; owner = queue.pop()) {
    for (const name of code.later.get(owner) ?? []) code.load.add(name)
    for (const name of metadata.later.get(owner) ?? []) metadata.load.add(name)
    for (const callee of calls.later.get(owner) ?? []) {
      if (calls.load.has(callee)) continue
      calls.load.add(callee)
      queue.push(callee)
    }
  }
}

/** Translate local reads to the imported names and JSX facts each specifier needs. */
function importUses(
  source: ts.SourceFile,
  imports: ReadonlyMap<string, Bound>,
  bindings: ReadonlyMap<string, Bound>,
  reads: ReadState
): Uses {
  const jsxBindings = new Map<ts.Expression, string[]>()
  if (reads.jsx) {
    for (const [name, binding] of imports) {
      if (binding.typeOnly) continue
      const names = jsxBindings.get(binding.specifier) ?? []
      names.push(name)
      jsxBindings.set(binding.specifier, names)
    }
  }
  const pragmas = reads.jsx ? jsxPragmasOf(source) : {}

  const takenBy = (locals: ReadonlySet<string>) => {
    const taken = new Map<ts.Expression, Set<string>>()
    for (const name of locals) {
      const { specifier, taken: exported } = bindings.get(name)!
      taken.set(specifier, (taken.get(specifier) ?? new Set()).add(exported))
    }
    return (specifier: ts.Expression, names: readonly string[]) =>
      names.filter(name => taken.get(specifier)?.has(name))
  }
  const loadTime = takenBy(reads.code.load)
  const metadataLoadTime = takenBy(reads.metadata.load)
  const valueOf = new Map<ts.Expression, Use['value']>()
  for (const [name, { specifier }] of bindings) {
    if (reads.values.has(name)) valueOf.set(specifier, 'code')
    else if (reads.metadataValues.has(name))
      valueOf.set(specifier, valueOf.get(specifier) ?? 'metadata')
  }
  return (specifier, names) => {
    const value = valueOf.get(specifier)
    const jsxNames = jsxBindings.get(specifier)
    return {
      loadTime: reads.wholeCalls.has(specifier) ? names : loadTime(specifier, names),
      ...(value === undefined ? {} : { value }),
      metadataLoadTime: metadataLoadTime(specifier, names),
      ...(jsxNames === undefined
        ? {}
        : {
            jsx: {
              names: jsxNames,
              ...pragmas,
              ...(reads.fragment ? { fragment: true as const } : {})
            }
          })
    }
  }
}

export function usesOf(source: ts.SourceFile, imports: ReadonlyMap<string, Bound>): Uses {
  const requires = source.text.includes('require')
  if (imports.size === 0 && !requires) return () => unused
  const required = requires ? requireBindings(source) : new Map<string, Bound & { call: ts.Node }>()
  const bindings = new Map<string, Bound>([...imports, ...required])
  const owners = ownersOf(source)

  // Nodes and scope/phase exit steps share one stack, so deep syntax cannot overflow it.
  const pending: Pending = []
  const walk: Walk = {
    bindings,
    owners,
    boundCalls: new Set([...required.values()].map(({ call }) => call)),
    reads: readState(),
    scopes: scopesOf(new Set([...bindings.keys(), ...owners]), pending),
    runs: LOAD
  }
  const visitChildren = (node: ts.Node) => pushChildren(pending, node, child => child)
  /** Visits the children of `node`, those `inside` accepts with `inner`, the rest as before. */
  const split = (node: ts.Node, inner: Runs, inside: (child: ts.Node) => boolean) => {
    const outer = walk.runs
    pending.push(() => {
      walk.runs = outer
    })
    pushChildren(pending, node, child => () => {
      walk.runs = inside(child) ? inner : outer
      visit(child)
    })
  }
  const body = (node: Body) => {
    if (walk.runs.at === 'later' || isInvoked(node)) return visitChildren(node)
    const inner: Runs = { at: 'later', owner: ownerOf(node) }
    split(node, inner, child => !ts.isDecorator(child) && child !== node.name)
  }
  const visit = (node: ts.Node): void => {
    const { SyntaxKind: Kind } = ts
    switch (node.kind) {
      case Kind.Identifier:
        return recordIdentifier(walk, node as ts.Identifier)
      case Kind.ExpressionWithTypeArguments:
        return visit((node as ts.ExpressionWithTypeArguments).expression)
      case Kind.InterfaceDeclaration:
      case Kind.TypeAliasDeclaration:
        return recordComputedNames(walk, node)
      case Kind.ImportDeclaration:
        return
      case Kind.ImportEqualsDeclaration: {
        // `import X = ns.Y` keeps `ns` when X is read as a value, which this walk does not follow.
        const { moduleReference, isTypeOnly } = node as ts.ImportEqualsDeclaration
        if (!isTypeOnly && !ts.isExternalModuleReference(moduleReference)) {
          walk.reads.values.add(rootOf(moduleReference).text)
        }
        return
      }
      case Kind.ExportDeclaration:
        return recordExports(walk.reads, node as ts.ExportDeclaration)
      case Kind.JsxOpeningElement:
      case Kind.JsxSelfClosingElement:
        walk.reads.jsx = true
        break
      case Kind.JsxOpeningFragment:
        walk.reads.jsx = true
        walk.reads.fragment = true
        break
      case Kind.HeritageClause:
        if ((node as ts.HeritageClause).token === Kind.ImplementsKeyword) return
        break
      case Kind.VariableStatement:
      case Kind.ModuleDeclaration:
      case Kind.EnumDeclaration:
        if (hasModifier(node, Kind.DeclareKeyword)) return
        break
      case Kind.ClassDeclaration:
        if (hasModifier(node, Kind.DeclareKeyword)) return
        recordMetadata(walk, node as ts.ClassDeclaration)
        break
      case Kind.CallExpression:
      case Kind.NewExpression:
      case Kind.TaggedTemplateExpression:
        recordCall(walk, node as ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression)
        break
      case Kind.FunctionDeclaration:
        if (hasModifier(node, Kind.DeclareKeyword)) return
        return walk.scopes.enter(node, () => body(node as Body))
      case Kind.FunctionExpression:
      case Kind.ArrowFunction:
      case Kind.MethodDeclaration:
      case Kind.Constructor:
      case Kind.GetAccessor:
      case Kind.SetAccessor:
        return walk.scopes.enter(node, () => body(node as Body))
      case Kind.Block:
      case Kind.ModuleBlock:
      case Kind.CaseBlock:
      case Kind.ForStatement:
      case Kind.ForInStatement:
      case Kind.ForOfStatement:
      case Kind.CatchClause:
        return walk.scopes.enter(node, () => visitChildren(node))
      case Kind.ClassExpression:
        return walk.scopes.enter(node, () => {
          recordMetadata(walk, node as ts.ClassExpression)
          visitChildren(node)
        })
      case Kind.PropertyDeclaration: {
        const property = node as ts.PropertyDeclaration
        if (walk.runs.at === 'later' || hasModifier(property, Kind.StaticKeyword)) break
        const inner: Runs = { at: 'later', owner: topLevelName(property.parent) }
        return split(property, inner, child => child === property.initializer)
      }
      default:
        if (node.kind >= Kind.FirstTypeNode && node.kind <= Kind.LastTypeNode) {
          return recordComputedNames(walk, node)
        }
    }
    visitChildren(node)
  }
  for (const statement of source.statements.toReversed()) pending.push(statement)
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === 'function') next()
    else visit(next)
  }

  propagateCalls(walk.reads)
  return importUses(source, imports, bindings, walk.reads)
}
