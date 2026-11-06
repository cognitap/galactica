/**
 * Grading of one run, statically: the lists that end the answer against the
 * required paths, and for edits the files the agent left in its checkout,
 * parsed with TypeScript. Nothing from the target repository is run.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import type { AnswerList, Grading } from './tasks.ts'

export interface ListGrade {
  readonly heading: string
  readonly required: number
  readonly missed: readonly string[]
  readonly listed: number
  /** Listed paths that are no file of the repository. */
  readonly unknown: readonly string[]
}

export interface Grade {
  /** Share of the task done, from 0 to 1. */
  readonly accuracy: number
  readonly lists?: readonly ListGrade[]
  readonly edit?: {
    readonly changed: boolean
    readonly parses: boolean
    readonly others: readonly string[]
  }
  readonly rename?: {
    readonly files: number
    readonly correct: number
    readonly leftovers: readonly string[]
    readonly unparsable: readonly string[]
    readonly extra: readonly string[]
  }
}

const headingLine = /^[\s>*_#-]*(FILES|TESTS)[\s*_]*:[\s*_]*(.*)$/i
const pathToken = /[\w@$.[\]()+-]+(?:\/[\w@$.[\]()+-]+)*\.[A-Za-z]+/

const normalize = (token: string) => token.replace(/^\.?\//, '').replace(/:\d+(?::\d+)?$/, '')

/** The paths under each heading line, taking the last line of each heading. */
export function answerLists(text: string): Map<string, string[]> {
  const lists = new Map<string, string[]>()
  let current: string[] | undefined
  for (const line of text.split('\n')) {
    const heading = headingLine.exec(line)
    if (heading) {
      current = []
      lists.set(heading[1]!.toUpperCase(), current)
      const rest = heading[2]!.match(new RegExp(pathToken, 'g')) ?? []
      current.push(...rest.map(normalize))
      continue
    }
    if (current === undefined || line.trim().startsWith('```')) continue
    const token = pathToken.exec(line.replaceAll('`', ' '))
    if (token) current.push(normalize(token[0]))
  }
  return lists
}

function gradeLists(
  lists: readonly AnswerList[],
  answer: string,
  exists: (path: string) => boolean
): { grades: ListGrade[]; found: number; required: number } {
  const given = answerLists(answer)
  let found = 0
  let required = 0
  const grades = lists.map(({ heading, required: paths }) => {
    const listed = new Set(given.get(heading) ?? [])
    const missed = paths.filter(path => !listed.has(path))
    found += paths.length - missed.length
    required += paths.length
    return {
      heading,
      required: paths.length,
      missed,
      listed: listed.size,
      unknown: [...listed].filter(path => !exists(path))
    }
  })
  return { grades, found, required }
}

const sourceExtensions = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** How many identifiers named `name` the module's syntax tree holds. Comments and strings do not count. */
function identifierCount(file: string, text: string, name: string): number {
  if (!text.includes(name)) return 0
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  let count = 0
  const stack: ts.Node[] = [source]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (ts.isIdentifier(node) && node.text === name) count++
    node.forEachChild(child => {
      stack.push(child)
    })
  }
  return count
}

function parses(file: string, text: string): boolean {
  const { diagnostics } = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve }
  })
  return (diagnostics ?? []).length === 0
}

/** The files of `root` holding identifiers named `name`, with their counts. */
export function identifierCounts(
  root: string,
  files: readonly string[],
  name: string
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of files) {
    if (!sourceExtensions.test(file)) continue
    let text: string
    try {
      text = readFileSync(join(root, file), 'utf8')
    } catch {
      continue
    }
    const count = identifierCount(file, text, name)
    if (count > 0) counts.set(file, count)
  }
  return counts
}

export interface Checkout {
  readonly root: string
  /** Every file of the checkout after the run, tracked or new. */
  readonly files: readonly string[]
  /** The files the agent changed, added or deleted. */
  readonly changed: readonly string[]
  readonly exists: (path: string) => boolean
}

/**
 * Grades a run. `expected` holds, for a rename, the count of the old name in
 * each file of the pristine checkout, which the renamed checkout must hold of
 * the new name.
 */
export function grade(
  grading: Grading,
  answer: string,
  checkout: Checkout,
  expected?: ReadonlyMap<string, number>
): Grade {
  const read = (file: string) => readFileSync(join(checkout.root, file), 'utf8')
  const existing = checkout.changed.filter(checkout.exists)
  const unparsable = existing.filter(
    file => sourceExtensions.test(file) && !parses(file, read(file))
  )

  if (grading.kind === 'lists') {
    const { grades, found, required } = gradeLists(grading.lists, answer, checkout.exists)
    return { accuracy: found / required, lists: grades }
  }

  if (grading.kind === 'edit') {
    const { grades, found, required } = gradeLists(grading.lists, answer, checkout.exists)
    const changed = checkout.changed.includes(grading.file)
    const ok = changed && checkout.exists(grading.file) && !unparsable.includes(grading.file)
    return {
      accuracy: ok ? found / required : 0,
      lists: grades,
      edit: {
        changed,
        parses: ok,
        others: checkout.changed.filter(file => file !== grading.file)
      }
    }
  }

  if (expected === undefined) throw new Error('a rename needs the expected counts')
  const touched = checkout.files.filter(file => sourceExtensions.test(file))
  const before = identifierCounts(checkout.root, touched, grading.from)
  const after = identifierCounts(checkout.root, touched, grading.to)
  const correct = [...expected].filter(
    ([file, count]) => !before.has(file) && after.get(file) === count && !unparsable.includes(file)
  ).length
  return {
    accuracy: correct / expected.size,
    rename: {
      files: expected.size,
      correct,
      leftovers: [...before.keys()],
      unparsable,
      extra: checkout.changed.filter(file => !expected.has(file))
    }
  }
}
