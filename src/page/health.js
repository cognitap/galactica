import { byId, element, breakable, plural, formatted, linked } from './dom.js'

/** @typedef {import('../page-data.ts').PageData} PageData */
/** @typedef {import('./search.js').Target} Target */

/**
 * @param {PageData} data
 * @param {(target: Target) => void} go
 */
export function healthSection(data, go) {
  /**
   * One finding: a button that selects its module or area on the map, what the
   * finding says, and a link to its line when the page links to source.
   * @param {string} label
   * @param {() => void} choose
   * @param {readonly (string | Node)[]} details
   * @param {{ readonly path: string, readonly line: number } | undefined} at
   */
  function findingItem(label, choose, details, at) {
    const item = element('li', 'finding')
    const select = element('button', 'finding-select')
    select.setAttribute('type', 'button')
    select.append(...breakable(label))
    select.addEventListener('click', choose)
    const about = element('span', 'finding-details')
    about.append(...details)
    item.append(select, about)
    if (at !== undefined) {
      item.append(
        linked(
          data.source,
          element('span', 'finding-line', `line ${at.line}`),
          at.path,
          at.line,
          `Open line ${at.line} of ${at.path} in the repository`
        )
      )
    }
    return item
  }

  /**
   * @param {string} title
   * @param {number} count
   * @param {string | undefined} note
   * @param {readonly HTMLElement[]} items
   */
  function findingGroup(title, count, note, items) {
    const group = element('section', 'health-group')
    const heading = element('h3', '', title)
    heading.append(' ', element('span', 'health-count', formatted(count)))
    group.append(heading)
    if (note !== undefined) group.append(element('p', 'health-note', note))
    if (items.length === 0) {
      group.append(element('p', 'health-none', 'None'))
    } else {
      const list = element('ul', 'findings')
      list.append(...items)
      group.append(list)
    }
    return group
  }

  /** @param {readonly string[]} names */
  const namesText = names => (names.length === 0 ? 'side effect only' : names.join(', '))

  /**
   * The findings of `health`, grouped by kind.
   */
  function healthGroups() {
    const { health } = data
    /** @param {number} module */
    const goModule = module => () => go({ kind: 'module', module })
    const cycles = health.cycles.map(cycle => {
      const item = element('li', 'health-cycle')
      const members = cycle.modules.map(index => data.modules[index].path)
      const shown = members.slice(0, 3).join(', ')
      const more = members.length > 3 ? ` and ${members.length - 3} more` : ''
      const use = cycle.loadTime ? 'used at load time' : 'used later'
      item.append(
        element(
          'p',
          'health-cycle-modules',
          `${plural(members.length, 'module')}, ${use}: ${shown}${more}`
        )
      )
      const breaks = element('ul', 'findings')
      breaks.append(
        ...cycle.breaks.map(({ from, to, line, names }) =>
          findingItem(
            data.modules[from].path,
            goModule(from),
            [`break the import of ${data.modules[to].path}: ${namesText(names)}`],
            { path: data.modules[from].path, line }
          )
        )
      )
      item.append(breaks)
      return item
    })
    const oversized = health.oversized.map(({ area, modules, median }) =>
      findingItem(
        data.areas[area].path,
        () => go({ kind: 'area', area }),
        [`${plural(modules, 'source module')}, package median ${formatted(median)}`],
        undefined
      )
    )
    const internal = health.internal.map(finding => {
      const reach =
        finding.reach === 'relative'
          ? `relative path into ${finding.package}`
          : `subpath ${finding.package} does not export`
      const instead = finding.instead === null ? 'no public entry gives it' : 'use '
      const details = [
        element('code', '', finding.specifier),
        ` ${namesText(finding.names)}, ${reach}, ${instead}`
      ]
      if (finding.instead !== null) details.push(element('code', '', finding.instead))
      return findingItem(data.modules[finding.from].path, goModule(finding.from), details, {
        path: data.modules[finding.from].path,
        line: finding.line
      })
    })
    const rule =
      health.areaModules === null
        ? 'At least 20 source modules and 5 times the median area of their package.'
        : `More than ${plural(health.areaModules, 'source module')}, by health.areaModules.`
    return [
      findingGroup(
        'Import cycles',
        cycles.length,
        'Each import to break points back up the cycle’s dependency order.',
        cycles
      ),
      findingGroup('Oversized areas', oversized.length, rule, oversized),
      findingGroup(
        'Imports into another package',
        internal.length,
        'A relative path into another package, or a subpath its exports do not list. Tests and stories are left out.',
        internal
      )
    ]
  }

  const { health } = data
  const toggle = byId('health-toggle')
  const body = byId('health-body')
  toggle.append(
    element(
      'span',
      'health-counts',
      [
        plural(health.cycles.length, 'import cycle'),
        plural(health.oversized.length, 'oversized area'),
        plural(health.internal.length, 'internal import')
      ].join(' · ')
    )
  )
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    if (open && body.childElementCount === 0) body.append(...healthGroups())
    toggle.setAttribute('aria-expanded', String(open))
    body.hidden = !open
  })
}
