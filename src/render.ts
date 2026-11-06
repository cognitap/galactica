/**
 * The text form of each command, built only from its `--json` object, so the
 * two forms never disagree.
 */

import type {
  Command,
  Cycle,
  CycleImport,
  Cycles,
  Deps,
  Failure,
  Health,
  InternalImport,
  Outline,
  Output,
  Overview,
  Reached,
  Subject,
  SymbolRef,
  Uses,
  Where
} from './contract.ts'
import { OVERSIZED } from './health.ts'

/** Entries a text list shows before it points at `--json`. */
export const LIST_LIMIT = 50

/** Modules the overview text ranks repo-wide. Exact, since each area lists at least this many of its own. */
const RANKED = 5

const EXPORTS_SHOWN = 6

function capped(lines: readonly string[]): readonly string[] {
  if (lines.length <= LIST_LIMIT) return lines
  return [...lines.slice(0, LIST_LIMIT), `… ${lines.length - LIST_LIMIT} more, use --json`]
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

const listOr = (values: readonly string[], none: string) =>
  values.length === 0 ? none : values.join(', ')

function symbolLine(path: string, symbol: SymbolRef): string {
  const kind = symbol.default ? `default ${symbol.kind}` : symbol.kind
  const doc = symbol.doc === undefined ? '' : `  // ${symbol.doc}`
  return `${path}:${symbol.line}  ${kind}  ${symbol.signature}${doc}`
}

function reachedLine({ distance, path, names }: Reached): string {
  return [String(distance), path, ...(names.length === 0 ? [] : [names.join(', ')])].join('  ')
}

function subjectLabel(subject: Subject): string {
  return subject.kind === 'package'
    ? `${subject.name} (package ${subject.dir})`
    : `${subject.path} (${subject.kind})`
}

function renderOverview({
  all,
  packages,
  cycles,
  unresolved,
  warnings
}: Overview): readonly string[] {
  const areas = packages.flatMap(pkg => pkg.areas)
  const modules = packages.reduce((sum, pkg) => sum + pkg.modules, 0)
  const layered = packages.flatMap(pkg => {
    const layers = [...new Set(pkg.areas.map(area => area.layer))]
    return [
      `${pkg.name} (${pkg.dir}): ${plural(pkg.modules, 'module')} in ${plural(pkg.areas.length, 'area')}`,
      ...layers.map(layer => {
        const members = pkg.areas.filter(area => area.layer === layer)
        return `layer ${layer}: ${members.map(area => `${area.path} (${area.modules})`).join(', ')}`
      })
    ]
  })
  const ranked = areas
    .flatMap(area => area.top)
    .filter(({ importers }) => all || importers > 0)
    .toSorted((a, b) => b.importers - a.importers || (a.path < b.path ? -1 : 1))
    .slice(0, all ? undefined : RANKED)
    .map(({ path, importers, exports }) => {
      const shown = exports.slice(0, EXPORTS_SHOWN).join(', ')
      const more =
        exports.length > EXPORTS_SHOWN ? `, … ${exports.length - EXPORTS_SHOWN} more` : ''
      return `${path}  ${plural(importers, 'importer')}  ${shown}${more}`.trimEnd()
    })
  return [
    `${plural(packages.length, 'package')}, ${plural(modules, 'module')}, ${plural(areas.length, 'area')}`,
    ...layered,
    'most imported:',
    ...capped(ranked),
    `${plural(cycles, 'import cycle')}, ${plural(unresolved, 'unresolved import')}`,
    ...(warnings.length === 0
      ? []
      : [`${plural(warnings.length, 'warning')}, galactica overview --json lists them`]),
    'next: galactica where <name> finds a symbol, galactica uses <file> lists what to check and test before you edit it'
  ]
}

function renderWhere({ name, definitions, suggestions }: Where): readonly string[] {
  if (definitions.length === 0) {
    return [
      `${name}: no definitions`,
      ...(suggestions.length === 0 ? [] : [`similar: ${suggestions.join(', ')}`])
    ]
  }
  return [
    `${name}: ${plural(definitions.length, 'definition')}`,
    ...capped(definitions.map(definition => symbolLine(definition.module.path, definition)))
  ]
}

function renderOutline({ module, symbols }: Outline): readonly string[] {
  return [
    `${module.path} (${module.kind}, area ${module.area}, package ${module.package}): ${plural(symbols.length, 'exported symbol')}`,
    ...(symbols.length === 0
      ? ['no exported symbols']
      : capped(symbols.map(symbol => symbolLine(module.path, symbol))))
  ]
}

const useLabel = (cycle: Cycle) => (cycle.loadTime ? 'used at load time' : 'used later')

/** Other members a subject's cycle line names before it counts the rest. */
const MEMBERS_SHOWN = 3

/** One line per cycle the subject is in, so an agent sees it before editing. */
function cycleLines(cycles: readonly Cycle[], subject: Subject): readonly string[] {
  return cycles.map(cycle => {
    const module = subject.kind === 'module' ? subject.path : undefined
    const others = cycle.modules.filter(path => path !== module)
    const shown = others.slice(0, MEMBERS_SHOWN).join(', ')
    const more = others.length > MEMBERS_SHOWN ? ` and ${others.length - MEMBERS_SHOWN} more` : ''
    const members =
      module === undefined
        ? `of ${plural(cycle.modules.length, 'module')} (${shown}${more})`
        : `with ${shown}${more}`
    return `in an import cycle ${members}, ${useLabel(cycle)}: galactica cycles shows where to break it`
  })
}

function renderUses({ subject, depth, modules, tests, cycles }: Uses): readonly string[] {
  return [
    `${subjectLabel(subject)}: ${plural(modules.length, 'dependent')} within depth ${depth}, ${plural(tests.length, 'test')}`,
    ...(modules.length === 0 ? ['no dependents'] : capped(modules.map(reachedLine))),
    ...(tests.length === 0 ? ['no tests'] : ['tests:', ...capped(tests.map(reachedLine))]),
    ...cycleLines(cycles, subject)
  ]
}

function renderDeps({
  subject,
  depth,
  modules,
  packages,
  external,
  unresolved,
  cycles
}: Deps): readonly string[] {
  return [
    `${subjectLabel(subject)}: ${plural(modules.length, 'dependency', 'dependencies')} within depth ${depth}, ${plural(external.length, 'external package')}, ${plural(unresolved.length, 'unresolved import')}`,
    ...(modules.length === 0 ? ['no dependencies'] : capped(modules.map(reachedLine))),
    `packages: ${listOr(packages, 'none')}`,
    `external: ${listOr(external, 'none')}`,
    ...(unresolved.length === 0
      ? ['unresolved: none']
      : [
          'unresolved:',
          ...capped(unresolved.map(({ from, specifier }) => `${from}  ${specifier}`))
        ]),
    ...cycleLines(cycles, subject)
  ]
}

function importLine({ from, line, to, names, via, use, break: cut }: CycleImport): string {
  return [
    `${from}:${line} -> ${to}`,
    ...(via.length === 0 ? [] : [`via ${via.join(', ')}`]),
    listOr(names, 'side effect only'),
    use === 'load-time' ? 'used at load time' : 'used later',
    ...(cut ? ['break here'] : [])
  ].join('  ')
}

/** Imports to cut first, then those used at load time, so the cap never hides them. */
const importRank = ({ break: cut, use }: CycleImport) =>
  (cut ? 0 : 2) + (use === 'load-time' ? 0 : 1)

function renderCycles({ cycles }: Cycles): readonly string[] {
  if (cycles.length === 0) return ['no import cycles']
  const loading = cycles.filter(cycle => cycle.loadTime).length
  return [
    `${plural(cycles.length, 'import cycle')}, ${loading} used at load time`,
    ...cycles.flatMap((cycle, index) => [
      `cycle ${index + 1}: ${plural(cycle.modules.length, 'module')}, ${useLabel(cycle)}, in dependency order:`,
      ...capped(cycle.modules.map(path => `  ${path}`)),
      `imports (${cycle.imports.filter(({ break: cut }) => cut).length} to break):`,
      ...capped(
        cycle.imports
          .toSorted((a, b) => importRank(a) - importRank(b))
          .map(entry => `  ${importLine(entry)}`)
      )
    ]),
    'break here marks the imports that point back up the order, bringing in the fewest names. To cut one: move what both modules need into a third, lower module, pass a callback instead of importing, or merge modules that cannot be separated.'
  ]
}

/** Imports to break that a cycle of `health` shows before it counts the rest. */
const BREAKS_SHOWN = 3

function healthCycleLines(cycle: Cycle, index: number): readonly string[] {
  const shown = cycle.modules.slice(0, MEMBERS_SHOWN).join(', ')
  const more =
    cycle.modules.length > MEMBERS_SHOWN ? ` and ${cycle.modules.length - MEMBERS_SHOWN} more` : ''
  const breaks = cycle.imports.filter(({ break: cut }) => cut)
  return [
    `  cycle ${index + 1}: ${plural(cycle.modules.length, 'module')}, ${useLabel(cycle)}: ${shown}${more}`,
    ...breaks
      .slice(0, BREAKS_SHOWN)
      .map(
        ({ from, line, to, names }) =>
          `    break ${from}:${line} -> ${to}  ${listOr(names, 'side effect only')}`
      ),
    ...(breaks.length > BREAKS_SHOWN ? [`    … ${breaks.length - BREAKS_SHOWN} more to break`] : [])
  ]
}

function internalLine({
  from,
  line,
  specifier,
  names,
  reach,
  package: owner,
  instead
}: InternalImport): string {
  return [
    `${from}:${line}`,
    specifier,
    listOr(names, 'side effect only'),
    reach === 'relative' ? `relative path into ${owner}` : `subpath ${owner} does not export`,
    instead === undefined ? 'no public entry gives it' : `use ${instead}`
  ].join('  ')
}

function renderHealth({
  cycles,
  areaModules,
  oversizedAreas,
  internalImports
}: Health): readonly string[] {
  const rule =
    areaModules === undefined
      ? `at least ${OVERSIZED.modules} source modules and ${OVERSIZED.times} times the median area of their package`
      : `more than ${areaModules} source modules, by health.areaModules`
  return [
    `${plural(cycles.length, 'import cycle')}, ${plural(oversizedAreas.length, 'oversized area')}, ${plural(internalImports.length, 'internal import')}`,
    ...(cycles.length === 0
      ? ['import cycles: none']
      : ['import cycles, with the imports to break:', ...capped(cycles.flatMap(healthCycleLines))]),
    ...(oversizedAreas.length === 0
      ? [`oversized areas (${rule}): none`]
      : [
          `oversized areas (${rule}):`,
          ...capped(
            oversizedAreas.map(
              ({ path, modules, median }) =>
                `  ${path}  ${plural(modules, 'source module')}, package median ${median}`
            )
          )
        ]),
    ...(internalImports.length === 0
      ? ["imports into another package's internals: none"]
      : [
          "imports into another package's internals:",
          ...capped(internalImports.map(finding => `  ${internalLine(finding)}`))
        ]),
    ...(cycles.length === 0
      ? []
      : ['galactica cycles lists every import of each cycle and how to cut one'])
  ]
}

type Renderers = {
  readonly [C in Command]: (output: Extract<Output, { readonly command: C }>) => readonly string[]
}

const renderers: Renderers = {
  overview: renderOverview,
  where: renderWhere,
  outline: renderOutline,
  uses: renderUses,
  deps: renderDeps,
  cycles: renderCycles,
  health: renderHealth
}

export function render(result: Output | Failure): string {
  if ('error' in result) return `galactica: ${result.error.message}`
  const renderer = renderers[result.command] as (output: Output) => readonly string[]
  return renderer(result).join('\n')
}
