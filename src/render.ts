/**
 * The text form of each command, built only from its `--json` object, so the
 * two forms never disagree.
 */

import type {
  Command,
  Deps,
  Failure,
  Outline,
  Output,
  Overview,
  Reached,
  Subject,
  SymbolRef,
  Uses,
  Where
} from './contract.ts'

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

function renderUses({ subject, depth, modules, tests }: Uses): readonly string[] {
  return [
    `${subjectLabel(subject)}: ${plural(modules.length, 'dependent')} within depth ${depth}, ${plural(tests.length, 'test')}`,
    ...(modules.length === 0 ? ['no dependents'] : capped(modules.map(reachedLine))),
    ...(tests.length === 0 ? ['no tests'] : ['tests:', ...capped(tests.map(reachedLine))])
  ]
}

function renderDeps({
  subject,
  depth,
  modules,
  packages,
  external,
  unresolved
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
        ])
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
  deps: renderDeps
}

export function render(result: Output | Failure): string {
  if ('error' in result) return `galactica: ${result.error.message}`
  const renderer = renderers[result.command] as (output: Output) => readonly string[]
  return renderer(result).join('\n')
}
