#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import { analyzeRepository } from './analysis.ts'
import { commandOptions, commandTable, type CommandOption, type Input } from './commands.ts'
import { SCHEMA_VERSION, type Command, type Failure } from './contract.ts'
import { graphOf } from './graph.ts'
import { htmlOf } from './html.ts'
import { toRepoPath, type RepoPath } from './model.ts'
import { render } from './render.ts'

const htmlOptions = {
  out: { type: 'string', value: '<file>', summary: 'File html writes (default: galactica.html)' },
  open: { type: 'boolean', value: '', summary: 'Open the written file in the default browser' }
} as const

type HtmlOption = keyof typeof htmlOptions

const options = {
  root: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  ...commandOptions,
  ...htmlOptions
} satisfies ParseArgsOptionsConfig

const pad = (text: string, width: number) => text.padEnd(width)

const flagOptions = { ...commandOptions, ...htmlOptions }
type Flag = keyof typeof flagOptions
const flags = Object.keys(flagOptions) as Flag[]

const optionValue = (option: Flag) =>
  flagOptions[option].value === '' ? '' : ` ${flagOptions[option].value}`

const flagList = (names: readonly Flag[]) =>
  names.map(option => ` [--${option}${optionValue(option)}]`).join('')

function usage(): string {
  const commands = Object.entries(commandTable).map(([name, spec]) => {
    const argument = spec.argument === undefined ? '' : ` <${spec.argument}>`
    return `  ${pad(`${name}${argument}${flagList(spec.options)}`, 29)} ${spec.summary}`
  })
  const html = `  ${pad(`html${flagList(Object.keys(htmlOptions) as HtmlOption[])}`, 29)} Write the map for people as one self-contained HTML file`
  const flagLines = flags.map(
    option => `  ${pad(`--${option}${optionValue(option)}`, 15)}${flagOptions[option].summary}`
  )
  return `Usage: galactica <command> [options]

Map a JavaScript or TypeScript repository.

Commands:
${commands.join('\n')}
${html}

A subject is a module path, a package name, a package directory or an area path.

Options:
  --root <dir>   Repository to map (default: current directory)
  --json         Print the JSON object documented in docs/json-output.md
${flagLines.join('\n')}
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
  return { root, json: values.json ?? false, input }
}

const htmlFailure = (message: string): Result => ({
  code: 1,
  stdout: '',
  stderr: `galactica: ${message}`
})

function openInBrowser(path: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const child = spawn(command, [path], { detached: true, stdio: 'ignore' })
  child.on('error', error => console.error(`galactica: could not open ${path}: ${error.message}`))
  child.unref()
}

/** Writes the HTML page. It has no `--json` form, since its output is the file. */
function html(argv: readonly string[], cwd: string): Result {
  let parsed
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true })
  } catch (error) {
    return htmlFailure((error as Error).message)
  }
  const { values, positionals } = parsed
  const foreign = [...(Object.keys(commandOptions) as CommandOption[]), 'json' as const].find(
    option => values[option] !== undefined
  )
  if (foreign !== undefined) return htmlFailure(`html takes no --${foreign}`)
  if (positionals.length > 1) {
    return htmlFailure(`html takes no argument, got ${positionals.length - 1}`)
  }
  const root = rootOf(cwd, values.root)
  if (root === undefined) return htmlFailure(`no directory at --root ${values.root}`)
  const out = resolve(cwd, values.out ?? 'galactica.html')
  const page = htmlOf(graphOf(analyzeRepository(root).model))
  try {
    writeFileSync(out, page)
  } catch (error) {
    return htmlFailure(`could not write ${out}: ${(error as Error).message}`)
  }
  if (values.open) openInBrowser(out)
  const size = Math.round(Buffer.byteLength(page) / 1024)
  return { code: 0, stdout: `wrote ${out} (${size.toLocaleString('en')} KB)`, stderr: '' }
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
  if (name === 'html') return html(argv, cwd)
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
