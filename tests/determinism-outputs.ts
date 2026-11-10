/**
 * Prints, as one JSON object, what every command answers for a repository,
 * text and `--json`, and the page `html` writes. It runs the built CLI in this
 * process, from the current directory, so its caller picks the directory, the
 * environment and the cache.
 *
 * node tests/determinism-outputs.ts <page-file> <subjects> [extra flags...]
 *
 * `<subjects>` caps how many packages, areas and modules the subject commands
 * ask about, most imported first, or `all`.
 */

import { readFileSync } from 'node:fs'
import type { Overview, Outline } from '../src/contract.ts'

const { run }: typeof import('../src/cli.ts') = await import(
  new URL('../dist/cli.js', import.meta.url).href
)

const [page, cap, ...flags] = process.argv.slice(2)
const limit = cap === 'all' ? Infinity : Number(cap)
const cwd = process.cwd()
const outputs: Record<string, string> = {}

async function record(...args: string[]): Promise<string> {
  const result = await run([...args, ...flags], cwd)
  const key = args.join(' ')
  outputs[key] = `${result.code}\n${result.stdout}\n${result.stderr}`
  return result.stdout
}

async function both(...args: string[]): Promise<string> {
  await record(...args)
  return record(...args, '--json')
}

const overview: Overview = JSON.parse(await both('overview', '--all'))
await both('overview')
await both('cycles')
await both('health')
const packages = overview.packages
const areas = packages.flatMap(({ areas }) => areas)
const modules = areas
  .flatMap(({ top }) => top)
  .toSorted((a, b) => b.importers - a.importers)
  .slice(0, limit)
  .map(({ path }) => path)
const subjects = [
  ...packages.slice(0, limit).flatMap(({ name, dir }) => [name, dir]),
  ...areas.slice(0, limit).map(({ path }) => path),
  ...modules
]
const names = new Set(['doesNotExist'])
for (const module of modules) {
  const outline: Outline = JSON.parse(await both('outline', module))
  for (const { name } of outline.symbols ?? []) names.add(name)
}
for (const name of names) await both('where', name)
for (const subject of new Set(subjects)) {
  await both('uses', subject)
  await both('deps', subject)
  await record('uses', subject, '--depth', '9', '--json')
  await record('deps', subject, '--depth', '9', '--json')
}
const [first, second] = modules
if (first !== undefined && second !== undefined) {
  await both('path', first, second)
  await both('path', second, first)
  await both('path', first, second, '--all')
}
if (first !== undefined) await both('path', first, first)
const html = await run(['html', '--out', page!, ...flags], cwd)
outputs.html = `${html.code}\n${html.stderr}\n${html.code === 0 ? readFileSync(page!, 'utf8') : ''}`

process.stdout.write(JSON.stringify(outputs))
