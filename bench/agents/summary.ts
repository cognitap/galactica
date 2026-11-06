/**
 * The Markdown summary of a benchmark's runs. Also runs alone on a results
 * file: node bench/agents/summary.ts <results.json>
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { conditions } from './tasks.ts'

export interface SummaryRow {
  readonly task: string
  readonly model: string
  readonly modelId: string | undefined
  readonly condition: string
  readonly accuracy: number
  readonly costUsd: number
  readonly turns: number
  readonly toolCalls: number
  readonly galacticaCalls: number
  readonly skillLoaded: boolean
  readonly error: string | undefined
  readonly grade: {
    readonly lists?: readonly { readonly heading: string; readonly listed: number }[]
    readonly rename?: {
      readonly leftovers: readonly string[]
      readonly unparsable: readonly string[]
      readonly extra: readonly string[]
    }
  }
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length

const median = (values: readonly number[]) => {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const percent = (value: number) => (Number.isNaN(value) ? '' : `${Math.round(value * 100)}%`)
const dollars = (value: number) => (Number.isNaN(value) ? '' : `$${value.toFixed(3)}`)
const usedGalactica = (row: SummaryRow) => row.skillLoaded || row.galacticaCalls > 0

const table = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`)
  ].join('\n')

const ordered = <T>(values: Iterable<T>) => [...new Set(values)]

export function summary(rows: readonly SummaryRow[]): string {
  const models = ordered(rows.map(row => row.model))
  const tasks = ordered(rows.map(row => row.task))
  const select = (model: string, condition: string, task?: string) =>
    rows.filter(
      row =>
        row.model === model &&
        row.condition === condition &&
        (task === undefined || row.task === task)
    )

  const overall = models.flatMap(model =>
    conditions.flatMap(condition => {
      const group = select(model, condition)
      if (group.length === 0) return []
      return [
        [
          model,
          condition,
          String(group.length),
          percent(mean(group.map(row => row.accuracy))),
          dollars(mean(group.map(row => row.costUsd))),
          median(group.map(row => row.turns)).toString(),
          median(group.map(row => row.toolCalls)).toString(),
          percent(group.filter(usedGalactica).length / group.length),
          String(group.filter(row => row.error !== undefined).length)
        ]
      ]
    })
  )

  const byTask = tasks.flatMap(task =>
    models.map(model => [
      task,
      model,
      ...conditions.map(condition => {
        const group = select(model, condition, task)
        if (group.length === 0) return ''
        return `${percent(mean(group.map(row => row.accuracy)))} · ${dollars(mean(group.map(row => row.costUsd)))} · ${group.filter(usedGalactica).length}/${group.length}`
      })
    ])
  )

  const named = tasks.flatMap(task =>
    models.flatMap(model => {
      const counts = conditions.map(condition =>
        select(model, condition, task).map(
          row => row.grade.lists?.find(list => list.heading === 'TESTS')?.listed
        )
      )
      if (counts.flat().every(count => count === undefined)) return []
      return [
        [
          task,
          model,
          ...counts.map(group => {
            const known = group.filter((count): count is number => count !== undefined)
            return known.length === 0 ? '' : median(known).toString()
          })
        ]
      ]
    })
  )

  const renames = rows.filter(row => row.grade.rename !== undefined)
  const clean = (row: SummaryRow) =>
    row.grade.rename!.leftovers.length === 0 &&
    row.grade.rename!.unparsable.length === 0 &&
    row.grade.rename!.extra.length === 0

  const modelIds = ordered(rows.map(row => `${row.model} = ${row.modelId ?? 'unknown'}`))
  const total = rows.reduce((sum, row) => sum + row.costUsd, 0)

  return `# Agent benchmark summary

${rows.length} runs, $${total.toFixed(2)} in all. Models: ${modelIds.join(', ')}.

## By model and condition

Accuracy and cost are means over runs, turns and tool calls medians. "Galactica used" counts runs that loaded the skill or ran a Galactica command.

${table(['Model', 'Condition', 'Runs', 'Accuracy', 'Cost per run', 'Turns', 'Tool calls', 'Galactica used', 'Errors'], overall)}

## By task

Each cell: accuracy · cost per run · runs that used Galactica.

${table(['Task', 'Model', ...conditions], byTask)}

## Tests named

The median number of test files each answer listed.

${table(['Task', 'Model', ...conditions], named)}

## Renames

${renames.filter(clean).length} of ${renames.length} rename runs left no old name, no unparsable file and no change outside the files that held the name.
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (file === undefined) throw new Error('usage: node bench/agents/summary.ts <results.json>')
  process.stdout.write(summary(JSON.parse(readFileSync(file, 'utf8'))))
}
