/** Command-line metadata, help, and one validation path for analysis and writer commands. */

import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import { commandOptions, commandTable, type Input as CommandInput } from './commands.ts'
import type { Command, WriterCommand } from './contract.ts'
import { toRepoPath, type RepoPath } from './model.ts'
import { defaultCommand } from './skill.ts'
import { templateProblem } from './source-links.ts'

const htmlOptions = {
  out: { type: 'string', value: '<file>', summary: 'File html writes (default: galactica.html)' },
  open: { type: 'boolean', value: '', summary: 'Open the written file in the default browser' },
  'source-url': {
    type: 'string',
    value: '<template>',
    summary:
      'Where html links source, with {commit}, {path} and {line}; "none" turns links off (default: sourceUrl in galactica.config.json, else the GitHub remote)'
  }
} as const

const initOptions = {
  command: {
    type: 'string',
    value: '<cmd>',
    summary: `Command the skill tells agents to run (default: ${defaultCommand})`
  },
  force: {
    type: 'boolean',
    value: '',
    summary: 'Overwrite a skill file edited since init wrote it'
  }
} as const

const options = {
  root: { type: 'string' },
  json: { type: 'boolean' },
  'no-cache': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  ...commandOptions,
  ...htmlOptions,
  ...initOptions
} satisfies ParseArgsOptionsConfig

const flagOptions = { ...commandOptions, ...htmlOptions, ...initOptions }
type Flag = keyof typeof flagOptions
const flags = Object.keys(flagOptions) as Flag[]
const htmlFlags = Object.keys(htmlOptions) as Flag[]
const initFlags = Object.keys(initOptions) as Flag[]

const optionValue = (option: Flag) =>
  flagOptions[option].value === '' ? '' : ` ${flagOptions[option].value}`

const flagList = (names: readonly Flag[]) =>
  names.map(option => ` [--${option}${optionValue(option)}]`).join('')

type Row = readonly [string, string]

/** Each row's first column padded to the widest, two spaces before the second. */
const columns = (rows: readonly Row[]) => {
  const width = Math.max(...rows.map(([left]) => left.length)) + 2
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`).join('\n')
}

export function usage(): string {
  const commands = Object.entries(commandTable).map(([name, spec]): Row => {
    const argument = spec.argument === undefined ? '' : ` <${spec.argument}>`
    const second = spec.second === undefined ? '' : ` <${spec.second}>`
    return [`${name}${argument}${second}${flagList(spec.options)}`, spec.summary]
  })
  const writers: readonly Row[] = [
    [`html${flagList(htmlFlags)}`, 'Write the map for people as one self-contained HTML file'],
    [`init${flagList(initFlags)}`, 'Install the agent skill for Codex, Cursor and Claude Code']
  ]
  const optionRows: readonly Row[] = [
    ['--root <dir>', 'Repository to map (default: current directory)'],
    [
      '--json',
      'Print the JSON object documented at https://github.com/cognitap/galactica/blob/main/docs/json-output.md'
    ],
    ['--no-cache', 'Analyze every file, without reading or writing the cache'],
    ...flags.map((option): Row => [
      `--${option}${optionValue(option)}`,
      flagOptions[option].summary
    ]),
    ['-h, --help', 'Show this help'],
    ['-v, --version', 'Show the version']
  ]
  return `Usage: galactica <command> [options]

Map a JavaScript or TypeScript repository.

Commands:
${columns([...commands, ...writers])}

A subject is a module path, a package name, a package directory or an area path.

Options:
${columns(optionRows)}`
}

interface CommonInput {
  readonly root: string
  readonly json: boolean
  readonly noCache: boolean | undefined
}

interface AnalysisInput extends CommonInput {
  readonly command: Command
  readonly input: CommandInput
}

export interface HtmlInput extends CommonInput {
  readonly command: 'html'
  readonly out: string | undefined
  readonly open: boolean
  readonly sourceUrl: string | undefined
}

export interface InitInput extends CommonInput {
  readonly command: 'init'
  readonly skillCommand: string
  readonly force: boolean
}

interface InputFailure {
  readonly error: string
  readonly command?: Command | WriterCommand
  readonly json: boolean
}

type Parsed =
  | AnalysisInput
  | HtmlInput
  | InitInput
  | InputFailure
  | { readonly info: 'help' | 'version' }

const isCommand = (name: string | undefined): name is Command =>
  name !== undefined && Object.hasOwn(commandTable, name)

/** Edit distance for a short command-line option, without loading analysis code. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let row = 1; row <= a.length; row++) {
    const next = [row]
    for (let column = 1; column <= b.length; column++)
      next.push(
        Math.min(
          previous[column]! + 1,
          next[column - 1]! + 1,
          previous[column - 1]! + (a[row - 1] === b[column - 1] ? 0 : 1)
        )
      )
    previous = next
  }
  return previous[b.length]!
}

function parseProblem(error: unknown): string {
  const message = (error as Error).message.replace(/\s*\n\s*/g, ' ')
  const unknown = /^Unknown option '([^']+)'/.exec(message)?.[1]
  if (unknown === undefined) return message
  const known = Object.entries(options).flatMap(([name, option]) => [
    `--${name}`,
    ...('short' in option ? [`-${option.short}`] : [])
  ])
  const closest = known
    .map(name => ({
      name,
      score:
        Math.abs(name.length - unknown.length) > 2
          ? Infinity
          : distance(unknown.toLowerCase(), name)
    }))
    .sort((a, b) => a.score - b.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0]!
  return `unknown option ${unknown}; ${closest.score <= 2 ? `did you mean ${closest.name}?` : 'run --help for options'}`
}

function insideRoot(root: string, cwd: string): RepoPath | undefined {
  try {
    return toRepoPath(root, cwd)
  } catch {
    return undefined
  }
}

/** Help and version take precedence; every other command shares strict parsing and validation. */
export function parseInput(argv: readonly string[], cwd: string): Parsed {
  const loose = parseArgs({ args: [...argv], options, allowPositionals: true, strict: false })
  if (loose.values.help) return { info: 'help' }
  if (loose.values.version) return { info: 'version' }
  const [command] = loose.positionals
  if (!isCommand(command) && command !== 'html' && command !== 'init') {
    const problem = command === undefined ? 'no command given' : `unknown command ${command}`
    return { error: `${problem}; run --help for commands`, json: false }
  }
  const fail = (error: string): InputFailure => ({ error, command, json: argv.includes('--json') })
  let parsed
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true })
  } catch (error) {
    return fail(parseProblem(error))
  }
  const { values, positionals } = parsed
  const spec =
    command === 'html'
      ? { options: htmlFlags, argument: undefined, second: undefined }
      : command === 'init'
        ? { options: initFlags, argument: undefined, second: undefined }
        : commandTable[command]
  const foreign = flags.find(
    option => values[option] !== undefined && !(spec.options as readonly string[]).includes(option)
  )
  if (foreign !== undefined) return fail(`${command} takes no --${foreign}`)
  const operands = positionals.slice(1)
  const wanted = spec.second !== undefined ? 2 : spec.argument === undefined ? 0 : 1
  if (operands.length !== wanted) {
    const shape =
      spec.second !== undefined
        ? `<${spec.argument}> and <${spec.second}>`
        : spec.argument === undefined
          ? 'no argument'
          : `one <${spec.argument}>`
    return fail(`${command} takes ${shape}, got ${operands.length}`)
  }
  // Analysis validates depth before the root, preserving its useful argument error.
  const depth = values.depth ?? '1'
  if (isCommand(command) && !/^[1-9]\d*$/.test(depth)) {
    return fail(`--depth must be a whole number of at least 1, got ${depth}`)
  }
  const root = resolve(cwd, values.root ?? '.')
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return fail(`no directory at --root ${values.root}`)
  }
  const common = { root, json: values.json ?? false, noCache: values['no-cache'] }
  if (command === 'html') {
    const sourceUrl = values['source-url']
    const problem =
      sourceUrl === undefined || sourceUrl === 'none' ? undefined : templateProblem(sourceUrl)
    if (problem !== undefined) return fail(`--source-url: ${problem}`)
    return { ...common, command, sourceUrl, out: values.out, open: values.open ?? false }
  }
  if (command === 'init') {
    const skillCommand = values.command ?? defaultCommand
    if (skillCommand.trim() === '') return fail('--command must not be empty')
    return { ...common, command, skillCommand, force: values.force ?? false }
  }
  return {
    ...common,
    command,
    input: {
      argument: operands[0] ?? '',
      second: operands[1] ?? '',
      depth: Number(depth),
      all: values.all ?? false,
      cwd: insideRoot(root, cwd)
    }
  }
}
