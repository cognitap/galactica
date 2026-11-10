/**
 * The command table: each command's argument, the options it takes, and the
 * pure function from the graph to its `--json` object. The CLI parses argv
 * against this table, so adding a command is one entry here and one renderer.
 */

import type { Command, Failure, Output, Warning } from './contract.ts'
import { cycles } from './cycles.ts'
import { health } from './health.ts'
import type { Config, Graph, RepoPath } from './model.ts'
import { overview } from './overview.ts'
import { importPath } from './path.ts'
import { deps, outline, uses, where } from './queries.ts'

export interface Input {
  /** The positional argument. Empty for a command that takes none. */
  readonly argument: string
  /** The second positional. Empty for a command that takes one or none. */
  readonly second: string
  readonly depth: number
  readonly all: boolean
  /** The current directory relative to the root, undefined when it lies outside. */
  readonly cwd: RepoPath | undefined
}

/** What a command answers from: the graph, the config it was built with, and the warnings of the analysis that built it. */
export interface Repository {
  readonly graph: Graph
  readonly config: Config
  /** Sorted by path, then message. */
  readonly warnings: readonly Warning[]
}

/** The options only some commands take. */
export const commandOptions = {
  depth: {
    type: 'string',
    value: '<n>',
    summary: 'Import steps uses and deps follow (default: 1)'
  },
  all: {
    type: 'boolean',
    value: '',
    summary: 'List every module of each area in overview, or every import chain in path'
  }
} as const

type CommandOption = keyof typeof commandOptions

interface CommandSpec {
  /** The positional argument's name in the usage text. Absent when the command takes none. */
  readonly argument?: string
  /** The second positional's name. Present only when the command takes two. */
  readonly second?: string
  readonly options: readonly CommandOption[]
  readonly summary: string
  readonly run: (repository: Repository, input: Input) => Output | Failure
}

export const commandTable: { readonly [C in Command]: CommandSpec } = {
  overview: {
    options: ['all'],
    summary: 'Packages, their areas by layer, and the most imported modules',
    run: ({ graph, warnings }, { all }) => overview(graph, all, warnings)
  },
  where: {
    argument: 'name',
    options: [],
    summary: 'Where an exported symbol is defined',
    run: ({ graph }, { argument }) => where(graph, argument)
  },
  outline: {
    argument: 'file',
    options: [],
    summary: 'The exported symbols of one module',
    run: ({ graph }, { argument, cwd }) => outline(graph, argument, cwd)
  },
  uses: {
    argument: 'subject',
    options: ['depth'],
    summary: 'What depends on the subject, and every test that does',
    run: ({ graph }, { argument, cwd, depth }) => uses(graph, argument, cwd, depth)
  },
  deps: {
    argument: 'subject',
    options: ['depth'],
    summary: 'What the subject depends on, in the workspace and outside it',
    run: ({ graph }, { argument, cwd, depth }) => deps(graph, argument, cwd, depth)
  },
  path: {
    argument: 'from',
    second: 'to',
    options: ['all'],
    summary: 'The import chain from one module to another',
    run: ({ graph }, { argument, second, cwd, all }) =>
      importPath(graph, argument, second, cwd, all)
  },
  cycles: {
    options: [],
    summary: 'Each import cycle, which imports run at load time, and where to break it',
    run: ({ graph }) => cycles(graph)
  },
  health: {
    options: [],
    summary: 'Import cycles, oversized areas and imports that reach into another package',
    run: ({ graph, config }) => health(graph, config.health?.areaModules)
  }
}
