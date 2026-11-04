import {
  MODEL_FORMAT,
  type Edge,
  type Model,
  type ModuleFacts,
  type PackageName,
  type RepoPath,
  type SymbolFacts,
  type Target
} from '../src/model.ts'

export const edge = (to: string, fields: Partial<Edge> = {}): Edge => ({
  to: { kind: 'module', path: to as RepoPath },
  line: 1,
  form: 'import',
  names: ['x'],
  typeOnly: false,
  dynamic: false,
  via: [],
  ...fields
})

export const edgeTo = (to: Target, fields: Partial<Edge> = {}): Edge => ({
  ...edge('', fields),
  to
})

export const defines = (
  name: string,
  line = 1,
  fields: Partial<SymbolFacts> = {}
): SymbolFacts => ({
  name,
  kind: 'const',
  line,
  default: false,
  signature: `const ${name}`,
  ...fields
})

export type Spec = Partial<Pick<ModuleFacts, 'symbols' | 'edges'>>

/** A model of `specs`, in one root package named acme unless `packages` names others. */
export function modelOf(
  specs: Readonly<Record<string, Spec>>,
  packages: Readonly<Record<string, string>> = { acme: '.' }
): Model {
  return {
    format: MODEL_FORMAT,
    repository: { name: 'acme' },
    packages: Object.fromEntries(
      Object.entries(packages).map(([name, dir]) => [name as PackageName, { dir: dir as RepoPath }])
    ),
    modules: Object.fromEntries(
      Object.entries(specs).map(([path, { symbols = [], edges = [] }]) => [
        path,
        { path: path as RepoPath, hash: 'h', symbols, edges }
      ])
    )
  }
}
