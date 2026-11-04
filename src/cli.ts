#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import { analyzeRepository } from './analysis.ts'
import { commandOptions, commandTable, type CommandOption, type Input } from './commands.ts'
import { SCHEMA_VERSION, type Command, type Failure } from './contract.ts'
import { graphOf } from './graph.ts'
import { toRepoPath, type RepoPath } from './model.ts'
import { render } from './render.ts'

const options = {
  root: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  ...commandOptions
} satisfies ParseArgsOptionsConfig

const pad = (text: string, width: number) => text.padEnd(width)

const optionValue = (option: CommandOption) =>
  commandOptions[option].value === '' ? '' : ` ${commandOptions[option].value}`

function usage(): string {
  const commands = Object.entries(commandTable).map(([name, spec]) => {
    const argument = spec.argument === undefined ? '' : ` <${spec.argument}>`
    const flags = spec.options.map(option => ` [--${option}${optionValue(option)}]`).join('')
    return `  ${pad(`${name}${argument}${flags}`, 29)} ${spec.summary}`
  })
  const commandFlags = (Object.keys(commandOptions) as CommandOption[]).map(
    option => `  ${pad(`--${option}${optionValue(option)}`, 15)}${commandOptions[option].summary}`
  )
  return `Usage: galactica <command> [options]

Map a JavaScript or TypeScript repository.

Commands:
${commands.join('\n')}

A subject is a module path, a package name, a package directory or an area path.

Options:
  --root <dir>   Repository to map (default: current directory)
  --json         Print the JSON object documented in docs/json-output.md
${commandFlags.join('\n')}
  -h, --help     Show this help
  -v, --version  Show the version`
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version
}

export interface Result {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const isCommand = (name: string | undefined): name is Command =>
  name !== undefined && Object.hasOwn(commandTable, name)

const usageFailure = (command: Command, message: string): Failure => ({
  schemaVersion: SCHEMA_VERSION,
  command,
  error: { code: 'usage', message }
})

function insideRoot(root: string, cwd: string): RepoPath | undefined {
  try {
    return toRepoPath(root, cwd)
  } catch {
    return undefined
  }
}

/** The command's input, or a usage failure for a flag or argument it does not take. */
function inputOf(command: Command, argv: readonly string[], cwd: string) {
  const spec = commandTable[command]
  let parsed
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true })
  } catch (error) {
    return usageFailure(command, (error as Error).message)
  }
  const { values, positionals } = parsed
  const foreign = (Object.keys(commandOptions) as CommandOption[]).find(
    option => values[option] !== undefined && !spec.options.includes(option)
  )
  if (foreign !== undefined) return usageFailure(command, `${command} takes no --${foreign}`)
  const operands = positionals.slice(1)
  const wanted = spec.argument === undefined ? 0 : 1
  if (operands.length !== wanted) {
    const shape = spec.argument === undefined ? 'no argument' : `one <${spec.argument}>`
    return usageFailure(command, `${command} takes ${shape}, got ${operands.length}`)
  }
  const depth = values.depth ?? '1'
  if (!/^[1-9]\d*$/.test(depth)) {
    return usageFailure(command, `--depth must be a whole number of at least 1, got ${depth}`)
  }
  const root = resolve(cwd, values.root ?? '.')
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return usageFailure(command, `no directory at --root ${values.root}`)
  }
  const input: Input = {
    argument: operands[0] ?? '',
    depth: Number(depth),
    all: values.all ?? false,
    cwd: insideRoot(root, cwd)
  }
  return { root, json: values.json ?? false, input }
}

export function run(argv: readonly string[], cwd: string): Result {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options,
    allowPositionals: true,
    strict: false
  })
  if (values.help) return { code: 0, stdout: usage(), stderr: '' }
  if (values.version) return { code: 0, stdout: readVersion(), stderr: '' }
  const [name] = positionals
  if (!isCommand(name)) {
    const problem = name === undefined ? 'no command given' : `unknown command ${name}`
    return { code: 1, stdout: '', stderr: `galactica: ${problem}\n\n${usage()}` }
  }
  const parsed = inputOf(name, argv, cwd)
  const json = 'error' in parsed ? argv.includes('--json') : parsed.json
  const output =
    'error' in parsed
      ? parsed
      : commandTable[name].run(graphOf(analyzeRepository(parsed.root).model), parsed.input)
  const failed = 'error' in output
  if (json) return { code: failed ? 1 : 0, stdout: JSON.stringify(output, null, 2), stderr: '' }
  return failed
    ? { code: 1, stdout: '', stderr: render(output) }
    : { code: 0, stdout: render(output), stderr: '' }
}

if (import.meta.main) {
  const result = run(process.argv.slice(2), process.cwd())
  if (result.stdout !== '') console.log(result.stdout)
  if (result.stderr !== '') console.error(result.stderr)
  process.exitCode = result.code
}
