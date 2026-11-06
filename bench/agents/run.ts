/**
 * Runs the agent benchmark: each task of tasks.ts, under each condition, for
 * each model, several times, through headless Claude Code, and grades each
 * run statically. See README.md beside this file.
 *
 * pnpm bench:agents -- [--models sonnet,opus] [--reps 3] [--budget-usd 25]
 *   [--tasks hono-rename,...] [--conditions without,skill,instructed]
 *   [--concurrency 4] [--run-budget-usd 2] [--timeout-minutes 20]
 *   [--work <dir>] [--out <dir>]
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { grade, identifierCounts, type Grade } from './grade.ts'
import { summary } from './summary.ts'
import {
  conditions as allConditions,
  instruction,
  repositories,
  tasks as allTasks,
  type Condition,
  type Repository,
  type Task
} from './tasks.ts'

const cli = fileURLToPath(new URL('../../dist/bin.js', import.meta.url))
if (!existsSync(cli)) throw new Error('build Galactica first: pnpm build')
const galactica = `${process.execPath} ${cli}`
const { cacheDirectory }: typeof import('../../src/cache.ts') = await import(
  new URL('../../dist/cache.js', import.meta.url).href
)

const argv = process.argv.slice(2)
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    models: { type: 'string', default: 'sonnet,opus' },
    reps: { type: 'string', default: '3' },
    'budget-usd': { type: 'string', default: '25' },
    'run-budget-usd': { type: 'string', default: '2' },
    tasks: { type: 'string' },
    conditions: { type: 'string', default: allConditions.join(',') },
    concurrency: { type: 'string', default: '4' },
    'timeout-minutes': { type: 'string', default: '20' },
    work: { type: 'string', default: join(tmpdir(), 'galactica-agent-bench') },
    out: { type: 'string' }
  }
})

const positive = (name: string, value: string | undefined) => {
  const number = Number(value)
  if (!(number > 0)) throw new Error(`--${name} must be a positive number, got ${value}`)
  return number
}
const listOf = (value: string) => value.split(',').filter(Boolean)

const models = listOf(values.models)
const reps = positive('reps', values.reps)
const budget = positive('budget-usd', values['budget-usd'])
const runBudget = positive('run-budget-usd', values['run-budget-usd'])
const concurrency = positive('concurrency', values.concurrency)
const timeout = positive('timeout-minutes', values['timeout-minutes']) * 60_000
const conditions = listOf(values.conditions).map(name => {
  if (!(allConditions as readonly string[]).includes(name)) throw new Error(`no condition ${name}`)
  return name as Condition
})
const tasks =
  values.tasks === undefined
    ? allTasks
    : listOf(values.tasks).map(id => {
        const task = allTasks.find(candidate => candidate.id === id)
        if (task === undefined) throw new Error(`no task ${id}`)
        return task
      })

const work = resolve(values.work)
const out = resolve(values.out ?? join(work, `results-${new Date().toISOString().slice(0, 10)}`))
const logs = join(out, 'logs')
mkdirSync(logs, { recursive: true })
const rowsFile = join(out, 'runs.jsonl')

/** Paths `init` and the instruction write, which are not the agent's changes. */
const installed = ['.agents/', '.claude/', '.cursor/', 'CLAUDE.md']

const readOnlyTools = ['Read', 'Grep', 'Glob', 'Bash', 'Skill']
const editTools = ['Edit', 'Write']
const bashAllowed = [
  galactica,
  'ls',
  'cat',
  'grep',
  'rg',
  'find',
  'head',
  'tail',
  'wc',
  'sed -n',
  'git log',
  'git show',
  'git grep',
  'git ls-files',
  'git diff',
  'git status'
].map(prefix => `Bash(${prefix}:*)`)

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 1 << 28
    }
  )
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd}: ${result.stderr}`)
  return result.stdout
}

/** A shallow clone of the repository at its pinned commit, made once. */
function baseClone(repository: Repository): string {
  const dir = join(work, 'repos', repository.name)
  if (existsSync(join(dir, '.git'))) {
    if (git(dir, ['rev-parse', 'HEAD']).trim() === repository.commit) return dir
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })
  git(dir, ['init', '--quiet'])
  git(dir, ['fetch', '--quiet', '--depth', '1', repository.url, repository.commit])
  git(dir, ['checkout', '--quiet', '--detach', 'FETCH_HEAD'])
  return dir
}

const zeroSeparated = (text: string) => text.split('\0').filter(Boolean)

function checkoutState(root: string) {
  const status = zeroSeparated(
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  )
  const changed: string[] = []
  for (let index = 0; index < status.length; index++) {
    const entry = status[index]!
    const path = entry.slice(3)
    if (entry.startsWith('R') || entry.startsWith('C')) index++
    if (!installed.some(prefix => path === prefix || path.startsWith(prefix))) changed.push(path)
  }
  const tracked = zeroSeparated(git(root, ['ls-files', '-z']))
  const files = [...new Set([...tracked, ...changed])].filter(file => existsSync(join(root, file)))
  return { root, files, changed, exists: (path: string) => existsSync(join(root, path)) }
}

const expectedRenames = new Map<string, ReadonlyMap<string, number>>()
function expectedFor(task: Task, base: string) {
  if (task.grading.kind !== 'rename') return undefined
  let expected = expectedRenames.get(task.id)
  if (expected === undefined) {
    expected = identifierCounts(
      base,
      zeroSeparated(git(base, ['ls-files', '-z'])),
      task.grading.from
    )
    expectedRenames.set(task.id, expected)
  }
  return expected
}

interface Job {
  readonly id: string
  readonly task: Task
  readonly model: string
  readonly condition: Condition
  readonly rep: number
}

interface Transcript {
  readonly answer: string
  readonly modelId: string | undefined
  readonly skillAvailable: boolean
  readonly skillLoaded: boolean
  readonly toolCalls: number
  readonly galacticaCalls: number
  readonly result: Record<string, any> | undefined
}

function readTranscript(file: string): Transcript {
  let modelId: string | undefined
  let skillAvailable = false
  let skillLoaded = false
  let toolCalls = 0
  let galacticaCalls = 0
  let result: Record<string, any> | undefined
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type === 'system' && event.subtype === 'init') {
      modelId = event.model
      skillAvailable = (event.skills ?? []).includes('galactica')
    }
    if (event.type === 'result') result = event
    if (event.type !== 'assistant') continue
    for (const content of event.message?.content ?? []) {
      if (content.type !== 'tool_use') continue
      toolCalls++
      if (content.name === 'Skill' && String(content.input?.skill ?? '').includes('galactica')) {
        skillLoaded = true
      }
      if (content.name === 'Bash' && String(content.input?.command ?? '').includes(cli)) {
        galacticaCalls++
      }
    }
  }
  return {
    answer: String(result?.result ?? ''),
    modelId,
    skillAvailable,
    skillLoaded,
    toolCalls,
    galacticaCalls,
    result
  }
}

function claude(job: Job, cwd: string, transcript: string): Promise<void> {
  const tools = job.task.kind === 'impact' ? readOnlyTools : [...readOnlyTools, ...editTools]
  const env = { ...process.env }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT
  const child = spawn(
    'claude',
    [
      '-p',
      job.task.prompt,
      '--model',
      job.model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-budget-usd',
      String(runBudget),
      '--tools',
      tools.join(','),
      '--allowedTools',
      ...tools.filter(tool => tool !== 'Bash'),
      ...bashAllowed
    ],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const chunks: Buffer[] = []
  const errors: Buffer[] = []
  child.stdout.on('data', chunk => chunks.push(chunk))
  child.stderr.on('data', chunk => errors.push(chunk))
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout)
  return new Promise(done => {
    child.on('close', () => {
      clearTimeout(timer)
      writeFileSync(transcript, Buffer.concat(chunks))
      writeFileSync(`${transcript}.err`, Buffer.concat(errors))
      done()
    })
  })
}

interface Row {
  readonly id: string
  readonly task: string
  readonly kind: Task['kind']
  readonly repository: string
  readonly model: string
  readonly modelId: string | undefined
  readonly condition: Condition
  readonly rep: number
  readonly accuracy: number
  readonly grade: Grade
  readonly costUsd: number
  readonly turns: number
  readonly toolCalls: number
  readonly galacticaCalls: number
  readonly skillAvailable: boolean
  readonly skillLoaded: boolean
  readonly denials: number
  readonly error: string | undefined
  readonly durationMs: number
}

async function run(job: Job): Promise<Row> {
  const repository = repositories[job.task.repository]
  const base = baseClone(repository)
  const root = join(work, 'runs', job.id)
  rmSync(root, { recursive: true, force: true })
  git(base, ['worktree', 'add', '--quiet', '--force', '--detach', root, repository.commit])
  try {
    if (job.condition !== 'without') {
      const init = spawnSync(process.execPath, [cli, 'init', '--command', galactica], {
        cwd: root,
        encoding: 'utf8'
      })
      if (init.status !== 0) throw new Error(`init failed in ${root}: ${init.stderr}`)
    }
    if (job.condition === 'instructed') {
      appendFileSync(join(root, 'CLAUDE.md'), `\n# Agent notes\n\n${instruction}\n`)
    }
    const transcriptFile = join(logs, `${job.id}.jsonl`)
    const started = Date.now()
    await claude(job, root, transcriptFile)
    const durationMs = Date.now() - started
    const transcript = readTranscript(transcriptFile)
    const checkout = checkoutState(root)
    writeFileSync(join(logs, `${job.id}.diff`), git(root, ['diff']))
    const result = transcript.result
    const graded = grade(job.task.grading, transcript.answer, checkout, expectedFor(job.task, base))
    const error =
      result === undefined
        ? 'no result'
        : result.is_error
          ? String(result.subtype ?? 'error')
          : undefined
    return {
      id: job.id,
      task: job.task.id,
      kind: job.task.kind,
      repository: repository.name,
      model: job.model,
      modelId: transcript.modelId,
      condition: job.condition,
      rep: job.rep,
      accuracy: graded.accuracy,
      grade: graded,
      costUsd: Number(result?.total_cost_usd ?? 0),
      turns: Number(result?.num_turns ?? 0),
      toolCalls: transcript.toolCalls,
      galacticaCalls: transcript.galacticaCalls,
      skillAvailable: transcript.skillAvailable,
      skillLoaded: transcript.skillLoaded,
      denials: (result?.permission_denials ?? []).length,
      error,
      durationMs
    }
  } finally {
    const cache = cacheDirectory(root)
    if (cache !== undefined) rmSync(cache, { recursive: true, force: true })
    git(base, ['worktree', 'remove', '--force', root])
  }
}

const done = new Map<string, Row>()
if (existsSync(rowsFile)) {
  for (const line of readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean)) {
    const row: Row = JSON.parse(line)
    done.set(row.id, row)
  }
}

const jobs: Job[] = []
for (let rep = 1; rep <= reps; rep++) {
  for (const task of tasks) {
    for (const model of models) {
      for (const condition of conditions) {
        const id = `${task.id}-${model}-${condition}-r${rep}`
        if (!done.has(id)) jobs.push({ id, task, model, condition, rep })
      }
    }
  }
}

for (const repository of new Set(tasks.map(task => task.repository))) {
  git(baseClone(repositories[repository]), ['worktree', 'prune'])
}

let spent = [...done.values()].reduce((sum, row) => sum + row.costUsd, 0)
let running = 0
let skipped = 0
const costs = [...done.values()].map(row => row.costUsd)
const typicalCost = () =>
  costs.length === 0 ? runBudget / 4 : costs.reduce((a, b) => a + b, 0) / costs.length

async function worker() {
  for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
    if (spent + (running + 1) * typicalCost() > budget) {
      skipped++
      continue
    }
    running++
    try {
      const row = await run(job)
      spent += row.costUsd
      costs.push(row.costUsd)
      done.set(row.id, row)
      appendFileSync(rowsFile, `${JSON.stringify(row)}\n`)
      console.log(
        `${row.id} accuracy ${row.accuracy.toFixed(2)} $${row.costUsd.toFixed(3)} spent $${spent.toFixed(2)}${row.error ? ` ${row.error}` : ''}`
      )
    } catch (error) {
      console.error(`${job.id} failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      running--
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker))

const rows = [...done.values()].sort((a, b) => a.id.localeCompare(b.id))
writeFileSync(join(out, 'results.json'), `${JSON.stringify(rows, null, 2)}\n`)
writeFileSync(join(out, 'summary.md'), summary(rows))
console.log(
  `${rows.length} runs, $${spent.toFixed(2)} spent${skipped > 0 ? `, ${skipped} skipped for the budget` : ''}. Results in ${out}`
)
