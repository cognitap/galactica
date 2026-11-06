/**
 * One command the way `dist/bin.js` runs it, timed by phase, for
 * `scripts/bench.ts`. It loads the built `dist/` rather than `src/`, since
 * that is the code users run. Prints one JSON object.
 *
 * node scripts/bench-phases.ts <root> <command> [<subject>]
 */

import { performance } from 'node:perf_hooks'
import type { Command } from '../src/contract.ts'

const dist = (name: string) => new URL(`../dist/${name}.js`, import.meta.url).href

const [root, command, subject = ''] = process.argv.slice(2) as [string, Command, string?]

const start = performance.now()
const [
  { cacheDirectory },
  { commandTable },
  { loadConfig },
  graph,
  model,
  { analyze },
  rendering,
  files
] = await Promise.all([
  import(dist('cache')) as Promise<typeof import('../src/cache.ts')>,
  import(dist('commands')) as Promise<typeof import('../src/commands.ts')>,
  import(dist('config')) as Promise<typeof import('../src/config.ts')>,
  import(dist('graph')) as Promise<typeof import('../src/graph.ts')>,
  import(dist('model')) as Promise<typeof import('../src/model.ts')>,
  import(dist('model-cache')) as Promise<typeof import('../src/model-cache.ts')>,
  import(dist('render')) as Promise<typeof import('../src/render.ts')>,
  import(dist('repository-files')) as Promise<typeof import('../src/repository-files.ts')>
])
const galacticaLoaded = performance.now()

const config = loadConfig(root)
const { model: analyzed, summary } = await analyze(root, config, { cache: cacheDirectory(root) })
const analysisDone = performance.now()
const built = graph.graphOf(analyzed, config)
const graphDone = performance.now()
const input = { argument: subject, depth: 1, all: false, cwd: model.toRepoPath(root, root) }
const text = rendering.render(
  commandTable[command].run({ graph: built, config, warnings: summary.warnings }, input)
)
const commandDone = performance.now()

const { typescript, ...durations } = summary.durations
const phases = Object.values(summary.durations).reduce((sum, value) => sum + value, 0)

/** The source module that defines symbols with the most importers, the first by path among equals. */
const busiest = [...built.modules.values()]
  .filter(node => node.kind === 'source' && node.facts.symbols.length > 0)
  .map(node => [node.facts.path, built.incoming.get(node.facts.path)?.length ?? 0] as const)
  .reduce((best, next) => (next[1] > best[1] ? next : best))[0]

console.log(
  JSON.stringify({
    phases: {
      typescript,
      galactica: galacticaLoaded - start,
      ...durations,
      cache: analysisDone - galacticaLoaded - phases,
      graph: graphDone - analysisDone,
      command: commandDone - graphDone
    },
    modules: summary.modules,
    moduleCount: built.modules.size,
    fileCount: files.repositoryFiles(root).length,
    busiest,
    bytes: Buffer.byteLength(text)
  })
)
