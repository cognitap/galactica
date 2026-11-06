/** Route validated input, obtain the repository only when needed, and render the result. */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cacheDirectory } from './cache.ts'
import { parseInput, usage } from './cli-input.ts'
import { commandTable, type Repository } from './commands.ts'
import { ConfigError, loadConfig } from './config.ts'
import { SCHEMA_VERSION, type Failure, type Output } from './contract.ts'
import { graphOf } from './graph.ts'
import { analyze } from './model-cache.ts'
import { render } from './render.ts'

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  return pkg.version
}

export interface Result {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** The config, graph and warnings of the repository at `root`, or what is wrong with its config. */
async function analyzed(
  root: string,
  noCache: boolean | undefined
): Promise<Repository | { readonly problem: string }> {
  for (const file of ['deno.json', 'deno.jsonc']) {
    if (statSync(join(root, file), { throwIfNoEntry: false })?.isFile()) {
      return {
        problem: `${file}: Deno repositories are not supported; workspace and import-map resolution would give an incomplete map`
      }
    }
  }
  try {
    const config = loadConfig(root)
    const options = noCache ? {} : { cache: cacheDirectory(root) }
    const { model, summary } = await analyze(root, config, options)
    return { config, graph: graphOf(model, config), warnings: summary.warnings }
  } catch (error) {
    if (error instanceof ConfigError) return { problem: error.message }
    throw error
  }
}

const usageFailure = (command: Failure['command'], message: string): Failure => ({
  schemaVersion: SCHEMA_VERSION,
  command,
  error: { code: 'usage', message }
})

const failure = (message: string): Result => ({
  code: 1,
  stdout: '',
  stderr: `galactica: ${message}`
})

function resultOf(output: Output | Failure, json: boolean): Result {
  const failed = 'error' in output
  if (json) return { code: failed ? 1 : 0, stdout: JSON.stringify(output, null, 2), stderr: '' }
  return failed
    ? { code: 1, stdout: '', stderr: render(output) }
    : { code: 0, stdout: render(output), stderr: '' }
}

export async function run(argv: readonly string[], cwd: string): Promise<Result> {
  const parsed = parseInput(argv, cwd)
  if ('info' in parsed)
    return { code: 0, stdout: parsed.info === 'help' ? usage() : readVersion(), stderr: '' }
  if ('error' in parsed)
    return parsed.command === undefined
      ? failure(parsed.error)
      : resultOf(usageFailure(parsed.command, parsed.error), parsed.json)
  const { command, root, json, noCache } = parsed
  if (command === 'init' || command === 'html') {
    const { installAgents, writeHtml } = await import('./cli-writers.ts')
    let written
    if (command === 'init') written = installAgents(parsed, cwd, readVersion())
    else {
      const repository = await analyzed(root, noCache)
      if ('problem' in repository) return resultOf(usageFailure(command, repository.problem), json)
      written = writeHtml(parsed, repository, cwd)
    }
    if ('problem' in written) return resultOf(usageFailure(command, written.problem), json)
    return {
      code: written.code,
      stdout: json ? JSON.stringify(written.output, null, 2) : written.message,
      stderr: ''
    }
  }
  const repository = await analyzed(root, noCache)
  const output =
    'problem' in repository
      ? usageFailure(command, repository.problem)
      : commandTable[command].run(repository, parsed.input)
  return resultOf(output, json)
}

/** Runs the command that `process.argv` names, as `dist/bin.js` does once Node.js passes its check. */
export async function main(): Promise<void> {
  const result = await run(process.argv.slice(2), process.cwd())
  if (result.stdout !== '') console.log(result.stdout)
  if (result.stderr !== '') console.error(result.stderr)
  process.exitCode = result.code
}
