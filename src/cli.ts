#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import { cacheDirectory } from './cache.ts'
import { commandOptions, commandTable, type Input } from './commands.ts'
import { ConfigError, loadConfig } from './config.ts'
import { SCHEMA_VERSION, type Command, type Failure, type Output } from './contract.ts'
import { pageSourceOf } from './git-source.ts'
import { graphOf } from './graph.ts'
import { htmlOf } from './html.ts'
import { toRepoPath, type Config, type Graph, type RepoPath } from './model.ts'
import { analyze } from './model-cache.ts'
import { render } from './render.ts'
import { templateProblem } from './source-links.ts'
import { agentFiles, defaultCommand, installSkill, skillTemplate } from './skill.ts'

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

function usage(): string {
  const commands = Object.entries(commandTable).map(([name, spec]): Row => {
    const argument = spec.argument === undefined ? '' : ` <${spec.argument}>`
    return [`${name}${argument}${flagList(spec.options)}`, spec.summary]
  })
  const writers: readonly Row[] = [
    [`html${flagList(htmlFlags)}`, 'Write the map for people as one self-contained HTML file'],
    [`init${flagList(initFlags)}`, 'Install the agent skill for Codex, Cursor and Claude Code']
  ]
  const optionRows: readonly Row[] = [
    ['--root <dir>', 'Repository to map (default: current directory)'],
    ['--json', 'Print the JSON object documented in docs/json-output.md'],
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

/** The config and graph of the repository at `root`, or what is wrong with its config. */
async function analyzed(
  root: string,
  noCache: boolean | undefined
): Promise<{ readonly config: Config; readonly graph: Graph } | { readonly problem: string }> {
  try {
    const config = loadConfig(root)
    const options = noCache ? {} : { cache: cacheDirectory(root) }
    return { config, graph: graphOf((await analyze(root, config, options)).model, config) }
  } catch (error) {
    if (error instanceof ConfigError) return { problem: error.message }
    throw error
  }
}

function rootOf(cwd: string, given: string | undefined): string | undefined {
  const root = resolve(cwd, given ?? '.')
  return statSync(root, { throwIfNoEntry: false })?.isDirectory() ? root : undefined
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
  const foreign = flags.find(
    option => values[option] !== undefined && !(spec.options as readonly string[]).includes(option)
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
  const root = rootOf(cwd, values.root)
  if (root === undefined) return usageFailure(command, `no directory at --root ${values.root}`)
  const input: Input = {
    argument: operands[0] ?? '',
    depth: Number(depth),
    all: values.all ?? false,
    cwd: insideRoot(root, cwd)
  }
  return { root, json: values.json ?? false, noCache: values['no-cache'], input }
}

/** The command's output, or a usage failure for a problem with the config. */
async function answer(
  command: Command,
  root: string,
  noCache: boolean | undefined,
  input: Input
): Promise<Output | Failure> {
  const repository = await analyzed(root, noCache)
  if ('problem' in repository) return usageFailure(command, repository.problem)
  return commandTable[command].run(repository.graph, input)
}

const failure = (message: string): Result => ({
  code: 1,
  stdout: '',
  stderr: `galactica: ${message}`
})

/** The flags and root of `html` or `init`, or a failure for an argument or another command's flag. */
function writerInput(
  name: 'html' | 'init',
  own: readonly string[],
  argv: readonly string[],
  cwd: string
) {
  let parsed
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true })
  } catch (error) {
    return failure((error as Error).message)
  }
  const { values, positionals } = parsed
  const foreign = [...flags, 'json' as const].find(
    option => values[option] !== undefined && !own.includes(option)
  )
  if (foreign !== undefined) return failure(`${name} takes no --${foreign}`)
  if (positionals.length > 1) {
    return failure(`${name} takes no argument, got ${positionals.length - 1}`)
  }
  const root = rootOf(cwd, values.root)
  if (root === undefined) return failure(`no directory at --root ${values.root}`)
  return { values, root }
}

function openInBrowser(path: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
  child.on('error', error => console.error(`galactica: could not open ${path}: ${error.message}`))
  child.unref()
}

/** Writes the HTML page. It has no `--json` form, since its output is the file. */
async function html(argv: readonly string[], cwd: string): Promise<Result> {
  const input = writerInput('html', htmlFlags, argv, cwd)
  if ('code' in input) return input
  const { values, root } = input
  const flag = values['source-url']
  const problem = flag === undefined || flag === 'none' ? undefined : templateProblem(flag)
  if (problem !== undefined) return failure(`--source-url: ${problem}`)
  const repository = await analyzed(root, values['no-cache'])
  if ('problem' in repository) return failure(repository.problem)
  const template = flag ?? repository.config.sourceUrl
  const out = resolve(cwd, values.out ?? 'galactica.html')
  const source = template === 'none' ? null : (pageSourceOf(root, template) ?? null)
  const page = htmlOf(repository.graph, source)
  try {
    writeFileSync(out, page)
  } catch (error) {
    return failure(`could not write ${out}: ${(error as Error).message}`)
  }
  if (values.open) openInBrowser(out)
  const size = Math.round(Buffer.byteLength(page) / 1024)
  return { code: 0, stdout: `wrote ${out} (${size.toLocaleString('en')} KB)`, stderr: '' }
}

/**
 * Installs the agent skill. Agents run it unattended, so an edited file is
 * reported rather than asked about, and it fails only when every file was kept.
 */
function init(argv: readonly string[], cwd: string): Result {
  const input = writerInput('init', initFlags, argv, cwd)
  if ('code' in input) return input
  const { values, root } = input
  const command = values.command ?? defaultCommand
  if (command.trim() === '') return failure('--command must not be empty')
  const files = agentFiles({ template: skillTemplate(), command, version: readVersion() })
  let installed
  try {
    installed = installSkill(root, files, values.force ?? false)
  } catch (error) {
    return failure(`could not install the skill: ${(error as Error).message}`)
  }
  const lines = installed.map(({ path, status }) => {
    const shown = relative(cwd, join(root, path))
    return status === 'kept'
      ? `kept ${shown}: edited since galactica wrote it, --force overwrites it`
      : `${status} ${shown}`
  })
  const allKept = installed.every(({ status }) => status === 'kept')
  return { code: allKept ? 1 : 0, stdout: lines.join('\n'), stderr: '' }
}

export async function run(argv: readonly string[], cwd: string): Promise<Result> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options,
    allowPositionals: true,
    strict: false
  })
  if (values.help) return { code: 0, stdout: usage(), stderr: '' }
  if (values.version) return { code: 0, stdout: readVersion(), stderr: '' }
  const [name] = positionals
  if (name === 'html') return html(argv, cwd)
  if (name === 'init') return init(argv, cwd)
  if (!isCommand(name)) {
    const problem = name === undefined ? 'no command given' : `unknown command ${name}`
    return { code: 1, stdout: '', stderr: `galactica: ${problem}\n\n${usage()}` }
  }
  const parsed = inputOf(name, argv, cwd)
  const json = 'error' in parsed ? argv.includes('--json') : parsed.json
  const output =
    'error' in parsed ? parsed : await answer(name, parsed.root, parsed.noCache, parsed.input)
  const failed = 'error' in output
  if (json) return { code: failed ? 1 : 0, stdout: JSON.stringify(output, null, 2), stderr: '' }
  return failed
    ? { code: 1, stdout: '', stderr: render(output) }
    : { code: 0, stdout: render(output), stderr: '' }
}

if (import.meta.main) {
  const result = await run(process.argv.slice(2), process.cwd())
  if (result.stdout !== '') console.log(result.stdout)
  if (result.stderr !== '') console.error(result.stderr)
  process.exitCode = result.code
}
