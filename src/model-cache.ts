/**
 * The cache of the derived model, beside the cache of extractions. After a
 * full analysis, `model.json` holds one line with the stamp and the
 * fingerprint of everything the model was derived from, then the model and
 * its summary. A command whose inputs are all unchanged answers from it with
 * no discovery, no resolution and no TypeScript. This is the one way a
 * command analyzes a repository.
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Analysis, Summary } from './analysis.ts'
import { currentStamp, isRecord, replaceFile, sameStamp, type Stamp } from './cache.ts'
import { fingerprintOf, recordInputs, unchanged, type Fingerprint } from './inputs.ts'
import { MODEL_FORMAT, type Config, type Model } from './model.ts'

export const MODEL_CACHE_FORMAT = 1

export interface Options {
  /** The cache folder. Without one, the analysis runs in full and nothing is written. */
  readonly cache?: string
}

interface Header extends Stamp {
  readonly format: typeof MODEL_CACHE_FORMAT
  readonly inputs: Fingerprint
}

/** What a hit gives back beside the model. A hit's module counts and durations follow from being one. */
interface Body {
  readonly model: Model
  readonly warnings: Summary['warnings']
  readonly unresolved: number
  readonly skipped: Summary['skipped']
}

const modelFile = (directory: string) => join(directory, 'model.json')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isWarning = (value: unknown): value is Summary['warnings'][number] =>
  isRecord(value) && typeof value.path === 'string' && typeof value.message === 'string'

const isCounts = (value: unknown): value is Summary['skipped'] =>
  isRecord(value) && Object.values(value).every(count => typeof count === 'number')

/**
 * The body, by its envelope. The modules are taken as this build wrote them,
 * which the stamp vouches for. Checking each would cost a share of what the
 * cache saves.
 */
function bodyOf(value: unknown): Body | undefined {
  if (!isRecord(value)) return undefined
  const { model, warnings, unresolved, skipped } = value
  if (!isRecord(model) || model.format !== MODEL_FORMAT) return undefined
  if (!isRecord(model.repository) || !isRecord(model.packages) || !isRecord(model.modules)) {
    return undefined
  }
  if (!Array.isArray(warnings) || !warnings.every(isWarning)) return undefined
  if (typeof unresolved !== 'number' || !isCounts(skipped)) return undefined
  return { model: model as unknown as Model, warnings, unresolved, skipped }
}

/** The cached analysis, when the file is this build's and every input it records is unchanged. */
function readModel(
  directory: string,
  stamp: Stamp,
  root: string,
  config: Config
): Analysis | undefined {
  let text: string
  try {
    text = readFileSync(modelFile(directory), 'utf8')
  } catch {
    return undefined
  }
  const newline = text.indexOf('\n')
  if (newline === -1) return undefined
  const header = parseJson(text.slice(0, newline))
  if (!isRecord(header) || header.format !== MODEL_CACHE_FORMAT || !sameStamp(header, stamp)) {
    return undefined
  }
  const inputs = fingerprintOf(header.inputs)
  if (!inputs || !unchanged(root, inputs, config)) return undefined
  const body = bodyOf(parseJson(text.slice(newline + 1)))
  if (!body) return undefined
  const { model, ...summary } = body
  return {
    model,
    summary: {
      ...summary,
      modules: { reused: Object.keys(model.modules).length, reread: 0, parsed: 0 },
      durations: { typescript: 0, discovery: 0, parse: 0, resolution: 0, barrels: 0 }
    }
  }
}

function writeModel(
  directory: string,
  stamp: Stamp,
  inputs: Fingerprint,
  { model, summary }: Analysis
): void {
  const header: Header = { format: MODEL_CACHE_FORMAT, ...stamp, inputs }
  const body: Body = {
    model,
    warnings: summary.warnings,
    unresolved: summary.unresolved,
    skipped: summary.skipped
  }
  replaceFile(modelFile(directory), `${JSON.stringify(header)}\n${JSON.stringify(body)}`)
}

/**
 * The repository's analysis: from the model cache when every recorded input
 * is unchanged, else in full, with the inputs recorded for the next run.
 * The analysis, and TypeScript with it, loads only for a full run.
 */
export async function analyze(
  rootDir: string,
  config: Config,
  { cache }: Options = {}
): Promise<Analysis> {
  const root = resolve(rootDir)
  const store = cache === undefined ? undefined : { directory: cache, stamp: currentStamp() }
  if (store) {
    const cached = readModel(store.directory, store.stamp, root, config)
    if (cached) return cached
  }
  const started = performance.now()
  const [{ analyzeRepository }, { default: ts }] = await Promise.all([
    import('./analysis.ts'),
    import('typescript')
  ])
  const typescript = performance.now() - started
  const recorder = store && recordInputs(root, ts.sys, config)
  const analysis = analyzeRepository(root, config, { cache, inputs: recorder?.inputs })
  if (store && recorder) {
    const inputs = recorder.fingerprint()
    if (inputs) writeModel(store.directory, store.stamp, inputs, analysis)
  }
  const { summary } = analysis
  return { ...analysis, summary: { ...summary, durations: { ...summary.durations, typescript } } }
}
