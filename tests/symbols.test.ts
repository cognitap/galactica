import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRepoPath } from '../src/model.ts'
import { isScriptLanguage, symbolsOf, type ScriptLanguage } from '../src/symbols.ts'

const symbols = (lines: readonly string[], language: ScriptLanguage = 'ts') =>
  symbolsOf(parseRepoPath(`src/a.${language}`), language, lines.join('\n'))

const pick = (lines: readonly string[], language?: ScriptLanguage) =>
  symbols(lines, language).map(({ name, kind, line, default: isDefault }) => ({
    name,
    kind,
    line,
    default: isDefault
  }))

const signatures = (lines: readonly string[], language?: ScriptLanguage) =>
  symbols(lines, language).map(symbol => symbol.signature)

const kinds = (lines: readonly string[], language?: ScriptLanguage) =>
  Object.fromEntries(symbols(lines, language).map(symbol => [symbol.name, symbol.kind]))

const docs = (lines: readonly string[]) => symbols(lines).map(symbol => symbol.doc)

test('framework languages are no script languages', () => {
  assert.equal(isScriptLanguage('tsx'), true)
  assert.equal(isScriptLanguage('cjs'), true)
  assert.equal(isScriptLanguage('vue'), false)
})

test('each exported top-level declaration is a symbol at the line of its name', () => {
  assert.deepEqual(
    pick([
      'export function f() {}',
      'export class C {}',
      'export interface I {}',
      'export type T = string',
      'export enum E { A }',
      'export const a = 1, b = 2',
      'export let',
      '  c = 3',
      'export var { d } = { d: 4 }',
      'function hidden() {}',
      'export namespace N {}'
    ]),
    [
      { name: 'f', kind: 'function', line: 1, default: false },
      { name: 'C', kind: 'class', line: 2, default: false },
      { name: 'I', kind: 'interface', line: 3, default: false },
      { name: 'T', kind: 'type', line: 4, default: false },
      { name: 'E', kind: 'enum', line: 5, default: false },
      { name: 'a', kind: 'const', line: 6, default: false },
      { name: 'b', kind: 'const', line: 6, default: false },
      { name: 'c', kind: 'const', line: 8, default: false }
    ]
  )
})

test('declare declarations count, and overloads are one symbol shown by the implementation', () => {
  assert.deepEqual(
    symbols([
      'export declare const version: string',
      '/** Parses. */',
      'export function parse(text: string): number',
      'export function parse(text: string, radix: number): number',
      'export function parse(text: string, radix = 10) {',
      '  return Number.parseInt(text, radix)',
      '}',
      'export declare function load(): void',
      'export declare function load(path: string): void'
    ]),
    [
      {
        name: 'version',
        kind: 'const',
        line: 1,
        default: false,
        signature: 'declare const version: string'
      },
      {
        name: 'parse',
        kind: 'function',
        line: 3,
        default: false,
        signature: 'function parse(text: string, radix)',
        doc: 'Parses.'
      },
      {
        name: 'load',
        kind: 'function',
        line: 8,
        default: false,
        signature: 'declare function load(): void'
      }
    ]
  )
})

test('a default-exported declaration keeps its name, and an anonymous one is named default', () => {
  assert.deepEqual(pick(['export default function Button() {}']), [
    { name: 'Button', kind: 'function', line: 1, default: true }
  ])
  assert.deepEqual(pick(['', 'export default class {}']), [
    { name: 'default', kind: 'class', line: 2, default: true }
  ])
  assert.deepEqual(signatures(['export default function (a: number): number {}']), [
    'function (a: number): number'
  ])
})

test('export default of a local name is that declaration, at its own line', () => {
  assert.deepEqual(pick(['const meta = {}', 'export default meta']), [
    { name: 'meta', kind: 'const', line: 1, default: true }
  ])
  assert.deepEqual(pick(['export function Button() {}', 'export default Button']), [
    { name: 'Button', kind: 'function', line: 1, default: true }
  ])
})

test('export default of any other expression is a const named default, at the export', () => {
  assert.deepEqual(
    symbols(['import { make } from "./make"', '', 'export default make({ a: 1 })']),
    [
      {
        name: 'default',
        kind: 'const',
        line: 3,
        default: true,
        signature: 'const default = make(...)'
      }
    ]
  )
  assert.deepEqual(pick(['import App from "./App"', 'export default App']), [
    { name: 'default', kind: 'const', line: 2, default: true }
  ])
})

test('export { ... } lists local declarations under their exported names', () => {
  assert.deepEqual(
    pick([
      'import { outside } from "./outside"',
      'function a() {}',
      'const b = 1',
      'class C {}',
      'export { a, b as renamed, outside, C as default }',
      'export { other } from "./other"'
    ]),
    [
      { name: 'a', kind: 'function', line: 2, default: false },
      { name: 'renamed', kind: 'const', line: 3, default: false },
      { name: 'C', kind: 'class', line: 4, default: true }
    ]
  )
})

test('export = of a local name is that declaration, and of anything else a const named default', () => {
  assert.deepEqual(pick(['function run() {}', 'export = run']), [
    { name: 'run', kind: 'function', line: 1, default: true }
  ])
  assert.deepEqual(signatures(['export = { a: 1 }']), ['const default = {...}'])
})

test('CommonJS exports are object properties naming locals and assignments to exports', () => {
  assert.deepEqual(
    symbols(
      [
        'const port = 3000',
        'function start() {}',
        'module.exports = { port, begin: start, inline: 1 }',
        'module.exports.stop = function (code) {}',
        '/** Restarts. */',
        'exports.restart = start'
      ],
      'cjs'
    ),
    [
      { name: 'port', kind: 'const', line: 1, default: false, signature: 'const port = 3000' },
      { name: 'begin', kind: 'function', line: 2, default: false, signature: 'function start()' },
      {
        name: 'stop',
        kind: 'function',
        line: 4,
        default: false,
        signature: 'const stop = (code) =>'
      },
      {
        name: 'restart',
        kind: 'function',
        line: 6,
        default: false,
        signature: 'function start()'
      }
    ]
  )
  assert.deepEqual(pick(['class Server {}', 'module.exports = Server'], 'js'), [
    { name: 'Server', kind: 'class', line: 1, default: true }
  ])
})

test('one symbol per name, sorted by line, then name', () => {
  assert.deepEqual(
    pick([
      'export const zeta = 1, alpha = 2',
      'export interface Shape {}',
      'export const Shape = {}',
      'export { alpha }'
    ]).map(({ name, line }) => `${line} ${name}`),
    ['1 alpha', '1 zeta', '2 Shape']
  )
})

test('a function returning JSX is a component, whatever its name', () => {
  assert.deepEqual(
    kinds(
      [
        'export function view() { return <div /> }',
        'export const Arrow = () => <></>',
        'export const Paren = () => (<p>a</p>)',
        'export const Maybe = function ({ on }) { if (!on) return null; return on && <b /> }',
        'export function Branch(on) { return on ? null : <i /> }',
        'export function Nested() { return items.map(() => <li />) }',
        'export function Helper() { const render = () => { return <a /> }; return render }',
        'export function useValue() { return 1 }'
      ],
      'tsx'
    ),
    {
      view: 'component',
      Arrow: 'component',
      Paren: 'component',
      Maybe: 'component',
      Branch: 'component',
      Nested: 'function',
      Helper: 'function',
      useValue: 'function'
    }
  )
})

test('forwardRef and memo calls and React component classes are components', () => {
  assert.deepEqual(
    kinds(
      [
        'export const A = forwardRef((props, ref) => null)',
        'export const B = React.memo(Base)',
        'export const C = memo(forwardRef(function C(props, ref) { return null }))',
        'export class D extends React.Component {}',
        'export class E extends PureComponent<Props> {}',
        'export class F extends Base {}',
        'export const G = wrap(() => null)'
      ],
      'ts'
    ),
    {
      A: 'component',
      B: 'component',
      C: 'component',
      D: 'component',
      E: 'component',
      F: 'class',
      G: 'const'
    }
  )
})

test('JSX parses in tsx, jsx and js, and a .ts file reads angle brackets as type assertions', () => {
  for (const language of ['tsx', 'jsx', 'js'] as const) {
    assert.deepEqual(
      kinds(['export const View = () => <div />'], language),
      { View: 'component' },
      language
    )
  }
  assert.deepEqual(kinds(['export const n = <number>value'], 'ts'), { n: 'const' })
})

test('function signatures keep parameter names, types, ? and ..., and drop default values', () => {
  assert.deepEqual(
    signatures([
      'export async function load<T = {}>(',
      '  url: string,',
      '  { retries = 3, signal: abort, ...rest }: Options = {},',
      '  [first, , third = 1]: T[],',
      '  verbose?: boolean,',
      '  ...extra: T[]',
      '): Promise<T> {}',
      'export function* ids() {}',
      'export function plain(a, b = 2) {}'
    ]),
    [
      'async function load<T = {}>(url: string, { retries, signal: abort, ...rest }: Options, [first, , third]: T[], verbose?: boolean, ...extra: T[]): Promise<T>',
      'function* ids()',
      'function plain(a, b)'
    ]
  )
})

test('function-valued consts read as arrows without the body, and wrappers show the inner function', () => {
  assert.deepEqual(
    signatures(
      [
        'export const add = async <T,>(a: T, b = a): Promise<T> => { return a }',
        'export const named = function named(x: number) { return x }',
        'export const Input = forwardRef<HTMLInputElement, Props>(({ size = 1, ...props }, ref) => {',
        '  return <input ref={ref} />',
        '})',
        'export const Card = memo(forwardRef(function Card(props: Props, ref) { return null }))',
        'export const Same = React.memo(Base)',
        'export const Odd = memo(make())'
      ],
      'tsx'
    ),
    [
      'const add = async <T>(a: T, b): Promise<T> =>',
      'const named = (x: number) =>',
      'const Input = forwardRef<HTMLInputElement, Props>(({ size, ...props }, ref) =>)',
      'const Card = memo(forwardRef((props: Props, ref) =>))',
      'const Same = React.memo(Base)',
      'const Odd = memo(...)'
    ]
  )
})

test('other consts show their annotation, a short literal, or a hint at the shape of the value', () => {
  assert.deepEqual(
    signatures([
      'export const typed: Record<string, number> = {}',
      "export const name = 'galactica'",
      'export const negative = -1',
      'export const on = true',
      'export const none = null',
      'export const tag = `plain`',
      'export const pattern = /a+/g',
      `export const long = '${'x'.repeat(160)}'`,
      'export const list = [1, 2]',
      'export const sizes = ["s", "m"] as const',
      'export const config = { a: 1 } satisfies Config',
      'export const greeting = `hi ${name}`',
      'export const button = cva("base", { variants: {} })',
      'export const tree = (freezeTree(nodes) as Tree)',
      'export const cache = new Map<string, number>()',
      'export const alias = other.value',
      'export let pending'
    ]),
    [
      'const typed: Record<string, number>',
      "const name = 'galactica'",
      'const negative = -1',
      'const on = true',
      'const none = null',
      'const tag = `plain`',
      'const pattern = /a+/g',
      "const long = '...'",
      'const list = [...]',
      'const sizes = [...] as const',
      'const config = {...}',
      'const greeting = `...`',
      'const button = cva(...)',
      'const tree = freezeTree(...)',
      'const cache = new Map(...)',
      'const alias',
      'let pending'
    ]
  )
})

test('classes, interfaces, enums and type aliases keep their heads', () => {
  assert.deepEqual(
    signatures([
      'export abstract class Store<T> extends Base<T> implements Readable, Writable {}',
      'export declare class Native {}',
      'export interface Props<T = string> extends Base, Other<T> { a: T }',
      'export const enum Flag { On }',
      'export declare enum Mode { A }',
      'export type Pair<A, B> = [A, B]',
      `export type Long = ${Array.from({ length: 30 }, (_, i) => `'value${i}'`).join(' | ')}`
    ]),
    [
      'abstract class Store<T> extends Base<T> implements Readable, Writable',
      'declare class Native',
      'interface Props<T = string> extends Base, Other<T>',
      'const enum Flag',
      'declare enum Mode',
      'type Pair<A, B> = [A, B]',
      'type Long = …'
    ]
  )
})

test('signatures are one line without comments, cut at 160 characters', () => {
  const [multiline, long] = signatures([
    'export function f(',
    '  a: {',
    '    /** The first. */',
    '    first: string // trailing',
    '    second: number',
    '  }',
    ') {}',
    `export function g(${Array.from({ length: 40 }, (_, i) => `p${i}: number`).join(', ')}) {}`
  ])
  assert.equal(multiline, 'function f(a: { first: string; second: number })')
  assert.equal(long?.length, 160)
  assert.ok(long?.endsWith('…'), long)
})

const names = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`)

test('type literal members are separated by `; ` whatever the source used', () => {
  assert.deepEqual(
    signatures([
      'export function multiline({ a }: {',
      '  title: string',
      '  files: readonly string[]',
      '  reset?: boolean',
      '}) {}',
      'export function mixed(x: { a: 1, b: 2; c: 3, }) {}',
      'export function semicolons(x: { a: 1; b: 2; }) {}',
      'export function nested(x: { a: { b: 1',
      'c: 2 }, d: string[] }): { e: 1, f: 2 } {}',
      'export function methods(x: { run(): void, readonly id: string }) {}',
      'export function empty(x: {}) {}',
      'export type Shape = {',
      '  a: string',
      '  b: number',
      '}',
      "export const config: { mode: 'a' | 'b', depth: number } = { mode: 'a', depth: 1 }"
    ]),
    [
      'function multiline({ a }: { title: string; files: readonly string[]; reset?: boolean })',
      'function mixed(x: { a: 1; b: 2; c: 3 })',
      'function semicolons(x: { a: 1; b: 2 })',
      'function nested(x: { a: { b: 1; c: 2 }; d: string[] }): { e: 1; f: 2 }',
      'function methods(x: { run(): void; readonly id: string })',
      'function empty(x: {})',
      'type Shape = { a: string; b: number }',
      "const config: { mode: 'a' | 'b'; depth: number }"
    ]
  )
})

test('an over-long signature shortens its binding patterns, then its type literals, then is cut', () => {
  const props = names('property', 14).join(', ')
  const members = names('member', 14)
    .map(name => `${name}: string`)
    .join('\n  ')
  const [named, inline, arrow, wrapped, stillLong, cut, fits] = signatures(
    [
      `export function Named({ ${props} }: NamedProps) {}`,
      `export function Inline({ ${props} }: {\n  ${members}\n}) {}`,
      `export const Arrow = ({ ${props} }: ArrowProps): number => 1`,
      `export const Wrapped = forwardRef<HTMLDivElement, WrappedProps>(({ ${props} }, ref) => null)`,
      `export function Long(first: { ${members.replaceAll('\n  ', ', ')} }, ${names('second', 14).join(', ')}, last: string) {}`,
      `export function Cut(${names('parameter', 30).join(', ')}) {}`,
      `export function Fits({ a, b }: { a: string; b: string }) {}`
    ],
    'tsx'
  )
  assert.equal(named, 'function Named({ … }: NamedProps)')
  assert.equal(inline, 'function Inline({ … }: { … })')
  assert.equal(arrow, 'const Arrow = ({ … }: ArrowProps): number =>')
  assert.equal(wrapped, 'const Wrapped = forwardRef<HTMLDivElement, WrappedProps>(({ … }, ref) =>)')
  assert.equal(
    stillLong?.startsWith('function Long(first: { … }, second0, second1'),
    true,
    stillLong
  )
  assert.equal(stillLong?.length, 160)
  assert.ok(stillLong?.endsWith('…'), stillLong)
  assert.equal(cut?.length, 160)
  assert.ok(cut?.startsWith('function Cut(parameter0, parameter1'), cut)
  assert.equal(fits, 'function Fits({ a, b }: { a: string; b: string })')
})

test('shortening stops at the first level that fits', () => {
  const props = names('property', 14).join(', ')
  assert.deepEqual(
    signatures([`export function A({ ${props} }: { one: 1; two: 2 }, third: { three: 3 }) {}`]),
    ['function A({ … }: { one: 1; two: 2 }, third: { three: 3 })']
  )
})

test('doc is the first sentence of the closest JSDoc, on one line', () => {
  assert.deepEqual(
    docs([
      '/** Adds two numbers. The result is not rounded. */',
      'export function add() {}',
      '/**',
      ' * Spans',
      ' * two lines.',
      ' * More.',
      ' */',
      'export function wrap() {}',
      '/** No period @deprecated use other */',
      'export function old() {}',
      '/** Ignored. */',
      '/** Closest. */',
      'export const value = 1',
      '// Not a doc comment.',
      'export function plain() {}',
      '/** v1.2 stays whole. */',
      'export function version() {}',
      `/** ${'word '.repeat(50)}*/`,
      'export function long() {}'
    ]),
    [
      'Adds two numbers.',
      'Spans two lines.',
      'No period',
      'Closest.',
      undefined,
      'v1.2 stays whole.',
      `${'word '.repeat(32).slice(0, 159)}…`
    ]
  )
})
