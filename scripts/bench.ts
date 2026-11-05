/**
 * How long Galactica takes on a repository, against the targets in AGENTS.md:
 * a first run under 10 seconds and a run with a warm cache under half a
 * second. It runs the built CLI as a child process, cold with the cache
 * deleted and then warm, for `overview` and for `uses` of a well-connected
 * module, and times the phases in a separate child that runs the same steps.
 * Every run must succeed and a warm run must print what the cold one did.
 *
 * pnpm bench [root] [--runs 5] [--uses <module>] [--json] [--check]
 */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'

const targets = { cold: 10_000, warm: 500 } as const
type Cache = keyof typeof targets

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const probe = fileURLToPath(new URL('bench-phases.ts', import.meta.url))

const { cacheDirectory }: typeof import('../src/cache.ts') = await import(
  new URL('../dist/cache.js', import.meta.url).href
)

interface Probe {
  readonly phases: Readonly<Record<string, number>>
  readonly modules: { readonly reused: number; readonly reread: number; readonly parsed: number }
  readonly moduleCount: number
  readonly fileCount: number
  readonly busiest: string
}

function node(args: readonly string[], cwd: string) {
  const start = performance.now()
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 })
  const ms = performance.now() - start
  if (result.status !== 0) {
    throw new Error(`node ${args.join(' ')} exited with ${result.status}: ${result.stderr}`)
  }
  return { ms, stdout: result.stdout }
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const { values, positionals } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    uses: { type: 'string' },
    json: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false }
  },
  allowPositionals: true
})
const runs = Number(values.runs)
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs must be at least 1, got ${values.runs}`)
}
const root = resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0] ?? '.')
const cacheDir = cacheDirectory(root)
const clearCache = () => rmSync(cacheDir, { recursive: true, force: true })

const probeRun = (args: readonly string[]): Probe =>
  JSON.parse(node([probe, root, ...args], root).stdout)

clearCache()
const survey = probeRun(['overview'])
const subject = values.uses ?? survey.busiest
const commands: readonly (readonly string[])[] = [['overview'], ['uses', subject]]
node([cli, ...commands[0]!], root)

interface Series {
  readonly command: string
  readonly cache: Cache
  readonly wall: number[]
  readonly phases: Probe['phases'][]
}

const startup: number[] = []
const series = commands.map(command =>
  (['cold', 'warm'] as const).map((cache): Series => ({
    command: command[0]!,
    cache,
    wall: [],
    phases: []
  }))
)

for (let run = 0; run < runs; run++) {
  startup.push(node(['-e', '0'], root).ms)
  for (const [index, command] of commands.entries()) {
    const [coldSeries, warmSeries] = series[index]!
    const name = command.join(' ')
    clearCache()
    const cold = node([cli, ...command], root)
    const warm = node([cli, ...command], root)
    if (warm.stdout !== cold.stdout) {
      throw new Error(`${name} printed differently with a warm cache`)
    }
    coldSeries!.wall.push(cold.ms)
    warmSeries!.wall.push(warm.ms)

    clearCache()
    const coldProbe = probeRun(command)
    const warmProbe = probeRun(command)
    if (coldProbe.modules.parsed !== coldProbe.moduleCount) {
      throw new Error(`${name} parsed ${coldProbe.modules.parsed} of ${coldProbe.moduleCount} cold`)
    }
    if (warmProbe.modules.reused !== warmProbe.moduleCount) {
      throw new Error(`${name} reused ${warmProbe.modules.reused} of ${warmProbe.moduleCount} warm`)
    }
    coldSeries!.phases.push(coldProbe.phases)
    warmSeries!.phases.push(warmProbe.phases)
  }
}

const results = series.flat().map(({ command, cache, wall }) => {
  const value = median(wall)
  return {
    command,
    cache,
    median: value,
    min: Math.min(...wall),
    max: Math.max(...wall),
    samples: wall,
    target: targets[cache],
    met: value < targets[cache]
  }
})

const phaseMedians = Object.fromEntries(
  series
    .flat()
    .map(({ command, cache, phases }) => [
      `${command} ${cache}`,
      Object.fromEntries(
        Object.keys(phases[0]!).map(phase => [phase, median(phases.map(sample => sample[phase]!))])
      )
    ])
)

const report = {
  root,
  files: survey.fileCount,
  modules: survey.moduleCount,
  runs,
  subject,
  nodeStartup: median(startup),
  results,
  phases: phaseMedians
}

const ms = (value: number) => `${Math.round(value).toLocaleString('en')} ms`

function table(rows: readonly (readonly string[])[], leftColumns = 1): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map(row => row[column]!.length)))
  return rows
    .map(row =>
      row
        .map((cell, column) =>
          column < leftColumns ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)
        )
        .join('  ')
    )
    .join('\n')
}

const phaseLabels: Readonly<Record<string, string>> = {
  typescript: 'typescript import',
  galactica: 'galactica import',
  discovery: 'discovery',
  parse: 'parse',
  cache: 'config, stats and cache',
  resolution: 'resolution',
  barrels: 'barrels',
  graph: 'graph',
  command: 'command and render'
}

if (values.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const columns = Object.keys(phaseMedians)
  console.log(
    [
      `Galactica benchmark of ${root}`,
      `${report.modules.toLocaleString('en')} modules in ${report.files.toLocaleString('en')} files, median of ${runs} runs, uses ${subject}`,
      '',
      table(
        [
          ['command', 'cache', 'median', 'range', 'target', ''],
          ...results.map(result => [
            result.command,
            result.cache,
            ms(result.median),
            `${ms(result.min)} to ${ms(result.max)}`,
            `under ${ms(result.target)}`,
            result.met ? 'met' : 'MISSED'
          ])
        ],
        2
      ),
      '',
      table([
        ['phase', ...columns],
        ['node startup', ...columns.map(() => ms(report.nodeStartup))],
        ...Object.entries(phaseLabels).map(([phase, label]) => [
          label,
          ...columns.map(column => ms(phaseMedians[column]![phase]!))
        ]),
        [
          'sum',
          ...columns.map(column =>
            ms(
              Object.values(phaseMedians[column]!).reduce(
                (sum, value) => sum + value,
                report.nodeStartup
              )
            )
          )
        ]
      ])
    ].join('\n')
  )
}

if (values.check && results.some(result => !result.met)) process.exitCode = 1
