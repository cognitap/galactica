/**
 * A synthetic pnpm workspace for the benchmark: packages of React components
 * in groups behind barrels, with tests, stories and shared utilities. Its
 * shape follows Radiant, which has 6.7 imports and 3.6 exported symbols per
 * module, an eighth of the imports type-only, a few modules that most others
 * import, and 6 KB per module. With the defaults this gives 6.5 imports, 3.4
 * symbols, 14% type-only and 6 KB. The same options give the same bytes.
 *
 * node scripts/synthetic-repo.ts <dir> [--modules 3000] [--packages 4] [--seed 1]
 */

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

export interface Options {
  /** Exactly how many modules the repository has. */
  readonly modules: number
  readonly packages: number
  readonly seed: number
}

export const defaults: Options = { modules: 3000, packages: 4, seed: 1 }

/** Repository path to file text, sorted by path. */
export type Files = ReadonlyMap<string, string>

const componentsPerGroup = 8
const utilityShare = 0.08

const prefixes =
  'Action Badge Card Data Dialog Field Filter Form Grid Icon Input List Media Menu Nav Panel Popover Range Search Select Status Tab Tag Tool'.split(
    ' '
  )
const suffixes =
  'Bar Body Button Cell Content Footer Group Header Item Label Layout Link Overlay Picker Portal Preview Root Row Section Separator Slot Summary Trigger View'.split(
    ' '
  )

const componentName = (index: number) => {
  const base =
    prefixes[index % prefixes.length]! +
    suffixes[Math.floor(index / prefixes.length) % suffixes.length]!
  const round = Math.floor(index / (prefixes.length * suffixes.length))
  return round === 0 ? base : `${base}${round + 1}`
}

/** A generator of numbers in [0, 1) that depends only on `key`. */
function randomOf(key: string): () => number {
  let state = 2166136261
  for (let index = 0; index < key.length; index++) {
    state = Math.imul(state ^ key.charCodeAt(index), 16777619)
  }
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Component {
  readonly name: string
  readonly group: number
  readonly index: number
  readonly test: boolean
  readonly story: boolean
}

interface PackagePlan {
  readonly seed: number
  readonly index: number
  readonly utilities: number
  readonly components: readonly Component[]
  readonly groups: number
}

const packageName = (index: number) => `@synthetic/pkg${index}`
const packageDir = (index: number) => `packages/pkg${index}`
const utilityName = (index: number) => `util${index}`
const utilityPath = (index: number) => `src/utils/${utilityName(index)}`
const groupPath = (group: number) => `src/components/group${group}`
const componentPath = ({ group, name }: Component) => `${groupPath(group)}/${name}/${name}`

/**
 * The package's modules: its index, its utilities, then each group's barrel
 * followed by its components, each with a test and a story, cut at `modules`.
 */
function planPackage(seed: number, index: number, modules: number): PackagePlan {
  const utilities = Math.max(1, Math.round(modules * utilityShare))
  let left = modules - 1 - utilities
  const components: Component[] = []
  let groups = 0
  while (left > 0) {
    if (components.length % componentsPerGroup === 0) {
      groups++
      left--
      if (left === 0) break
    }
    const test = left >= 2
    const story = left >= 3
    components.push({
      name: componentName(components.length),
      group: groups - 1,
      index: components.length,
      test,
      story
    })
    left -= 1 + (test ? 1 : 0) + (story ? 1 : 0)
  }
  return { seed, index, utilities, components, groups }
}

/** A relative specifier from one module to another, both without extension, as `.js`. */
function specifier(from: string, to: string): string {
  const fromParts = dirname(from).split('/')
  const toParts = to.split('/')
  let common = 0
  while (common < fromParts.length && fromParts[common] === toParts[common]) common++
  const up = fromParts.length - common
  const rest = toParts.slice(common).join('/')
  return `${up === 0 ? './' : '../'.repeat(up)}${rest}.js`
}

/** Skewed toward the first utilities, so a few have many importers. */
const pickUtility = (random: () => number, count: number) => Math.floor(count * random() ** 2)

const classLines = (random: () => number, count: number) =>
  Array.from({ length: count }, (_, line) => {
    const size = 1 + Math.floor(random() * 8)
    return `    'inline-flex items-center gap-[var(--syn-gap-${line},0.${size}rem)] rounded-[var(--syn-radius,0.5rem)] px-[var(--syn-padding-inline-${size},0.75rem)] text-[length:var(--syn-font-size,0.875rem)] [color:var(--syn-color-${line},oklch(0.21_0.006_286))]',`
  }).join('\n')

function utilityText(plan: PackagePlan, utility: number): string {
  const random = randomOf(`${plan.seed}:${plan.index}:${utility}:utility`)
  const name = utilityName(utility)
  const lines: string[] = []
  const imports = utility === 0 ? 0 : 1 + Math.floor(random() * 2)
  const taken = new Set<number>()
  for (let count = 0; count < imports; count++) {
    const other = pickUtility(random, utility)
    if (taken.has(other)) continue
    taken.add(other)
    lines.push(`import { ${utilityName(other)}Format } from './${utilityName(other)}.js'`)
  }
  if (random() < 0.4) lines.push("import { clsx } from 'clsx'")
  lines.push(
    '',
    `export interface ${name}Options {`,
    '  readonly prefix?: string',
    '  readonly separator?: string',
    '  readonly limit?: number',
    '}',
    '',
    `/** Formats the parts of ${name} into one string. */`,
    `export function ${name}Format(parts: readonly string[], options: ${name}Options = {}): string {`,
    "  const { prefix = '', separator = ' ', limit = parts.length } = options",
    '  return prefix + parts.slice(0, limit).join(separator)',
    '}',
    '',
    `export function ${name}Merge(...values: readonly (string | undefined)[]): string {`,
    `  return ${lines.some(line => line.includes('clsx')) ? 'clsx(values)' : "values.filter(Boolean).join(' ')"}`,
    '}',
    '',
    `export const ${name}Defaults = {`,
    classLines(random, 4 + Math.floor(random() * 6))
      .replaceAll('    ', '  ')
      .replaceAll("',", "' as string,"),
    '}'
  )
  for (const other of taken) {
    lines.push('', `${utilityName(other)}Format([])`)
  }
  return `${lines.join('\n')}\n`
}

/** The components a component imports: earlier ones in its package, skewed toward its own group. */
function pickComponents(
  random: () => number,
  plan: PackagePlan,
  component: Component,
  count: number
) {
  const picked = new Map<number, Component>()
  for (
    let attempt = 0;
    attempt < count * 3 && picked.size < count && component.index > 0;
    attempt++
  ) {
    const near = random() < 0.6
    const lowest = near ? component.group * componentsPerGroup : 0
    const index = lowest + Math.floor(random() * (component.index - lowest))
    if (index < component.index) picked.set(index, plan.components[index]!)
  }
  return [...picked.values()].sort((a, b) => a.index - b.index)
}

function componentText(
  plans: readonly PackagePlan[],
  plan: PackagePlan,
  component: Component
): string {
  const random = randomOf(`${plan.seed}:${plan.index}:${component.name}:component`)
  const path = componentPath(component)
  const { name } = component
  const lines = ["import { useMemo, useState, type ComponentProps, type ReactNode } from 'react'"]
  if (random() < 0.3) lines.push("import { clsx } from 'clsx'")
  const utilities = [
    ...new Set([
      0,
      pickUtility(random, plan.utilities),
      pickUtility(random, plan.utilities),
      pickUtility(random, plan.utilities)
    ])
  ]
  utilities.sort((a, b) => a - b)
  for (const utility of utilities) {
    const other = utilityName(utility)
    lines.push(
      `import { ${other}Format, ${other}Merge } from '${specifier(path, utilityPath(utility))}'`
    )
  }
  const typed = pickUtility(random, plan.utilities)
  lines.push(
    `import type { ${utilityName(typed)}Options } from '${specifier(path, utilityPath(typed))}'`
  )
  const children = pickComponents(random, plan, component, 1 + Math.floor(random() * 3))
  for (const child of children) {
    lines.push(`import { ${child.name} } from '${specifier(path, componentPath(child))}'`)
  }
  const lower = plans.slice(0, plan.index).filter(other => other.components.length > 0)
  const foreign =
    lower.length > 0 && random() < 0.5 ? lower[Math.floor(random() * lower.length)] : undefined
  const imported = foreign?.components[Math.floor(random() * foreign.components.length)]
  if (foreign && imported) {
    lines.push(
      `import { ${imported.name}, type ${imported.name}Props } from '${packageName(foreign.index)}'`
    )
  }
  const used = [...children.map(child => child.name), ...(imported ? [imported.name] : [])]
  lines.push(
    '',
    `export type ${name}Props = Omit<ComponentProps<'div'>, 'children'> & {`,
    '  readonly children?: ReactNode',
    `  readonly tone?: 'neutral' | 'accent' | 'danger'`,
    `  readonly format?: ${utilityName(typed)}Options`,
    ...(imported ? [`  readonly inner?: ${imported.name}Props`] : []),
    '}',
    '',
    `export const ${name.charAt(0).toLowerCase()}${name.slice(1)}Classes = [`,
    classLines(random, 20 + Math.floor(random() * 40)),
    ']',
    '',
    `export const ${name}Tones = ['neutral', 'accent', 'danger'] as const`,
    `export type ${name}Tone = (typeof ${name}Tones)[number]`,
    ''
  )
  const helpers = 1 + Math.floor(random() * 4)
  for (let helper = 0; helper < helpers; helper++) {
    lines.push(
      `function step${helper}(value: string, count: number): string {`,
      `  return count > ${helper} ? \`\${value}-${helper}\` : value`,
      '}',
      ''
    )
  }
  if (random() < 0.5) {
    lines.push(
      `export function use${name}(initial = false) {`,
      '  const [open, setOpen] = useState(initial)',
      '  return useMemo(() => ({ open, toggle: () => setOpen(value => !value) }), [open])',
      '}',
      ''
    )
  }
  const util = utilityName(utilities[0]!)
  lines.push(
    `/** ${name} lays out its children with the shared spacing. */`,
    `export function ${name}({ children, tone = 'neutral', className, ...props }: ${name}Props) {`,
    `  const label = ${util}Format([${Array.from({ length: helpers }, (_, helper) => `step${helper}(tone, ${helper + 1})`).join(', ')}])`,
    '  return (',
    `    <div {...props} data-tone={tone} className={${util}Merge(className, label)}>`,
    ...used.map(child => `      <${child} />`),
    '      {children}',
    '    </div>',
    '  )',
    '}'
  )
  for (const utility of utilities.slice(1)) {
    lines.push('', `${utilityName(utility)}Merge(${utilityName(utility)}Format([]))`)
  }
  return `${lines.join('\n')}\n`
}

function testText(plan: PackagePlan, component: Component): string {
  const random = randomOf(`${plan.seed}:${plan.index}:${component.name}:test`)
  const path = `${componentPath(component)}.test`
  const { name } = component
  const lines = [
    "import { act } from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import { afterEach, expect, test } from 'vitest'",
    `import { ${name} } from './${name}.js'`
  ]
  const others = pickComponents(random, plan, component, 1)
  if (others.length > 0) {
    lines.push(
      `import { ${others.map(other => other.name).join(', ')} } from '${specifier(path, 'src/index')}'`
    )
  }
  const utility = pickUtility(random, plan.utilities)
  lines.push(
    `import { ${utilityName(utility)}Format } from '${specifier(path, utilityPath(utility))}'`,
    '',
    'const hosts: HTMLElement[] = []',
    'afterEach(() => hosts.splice(0).forEach(host => host.remove()))',
    '',
    'function mount(tree: React.ReactNode) {',
    "  const host = document.createElement('div')",
    '  document.body.append(host)',
    '  hosts.push(host)',
    '  act(() => createRoot(host).render(tree))',
    '  return host',
    '}'
  )
  const cases = 10 + Math.floor(random() * 20)
  for (let index = 0; index < cases; index++) {
    lines.push(
      '',
      `test('${name} renders case ${index}', () => {`,
      `  const host = mount(<${name} tone="accent" data-case="${index}">${others.length > 0 ? `<${others[0]!.name} />` : 'text'}</${name}>)`,
      `  expect(host.querySelector('[data-case="${index}"]')).not.toBeNull()`,
      `  expect(${utilityName(utility)}Format(['a', 'b'], { separator: '-' })).toBe('a-b')`,
      `  expect(host.textContent).toContain('${index > 2 ? 'text' : ''}')`,
      '})'
    )
  }
  return `${lines.join('\n')}\n`
}

function storyText(plan: PackagePlan, component: Component): string {
  const random = randomOf(`${plan.seed}:${plan.index}:${component.name}:story`)
  const path = `${componentPath(component)}.stories`
  const { name } = component
  const lines = [
    "import type { Meta, StoryObj } from '@storybook/react-vite'",
    "import { expect, within } from 'storybook/test'",
    `import { ${name} } from './${name}.js'`
  ]
  const others = pickComponents(random, plan, component, 1)
  for (const other of others) {
    lines.push(`import { ${other.name} } from '${specifier(path, componentPath(other))}'`)
  }
  const utility = pickUtility(random, plan.utilities)
  lines.push(
    `import { ${utilityName(utility)}Merge } from '${specifier(path, utilityPath(utility))}'`,
    '',
    'const meta = {',
    `  title: 'Components/${name}',`,
    `  component: ${name},`,
    "  args: { tone: 'neutral' },",
    "  argTypes: { tone: { control: 'inline-radio', options: ['neutral', 'accent', 'danger'] } }",
    `} satisfies Meta<typeof ${name}>`,
    '',
    'export default meta',
    'type Story = StoryObj<typeof meta>'
  )
  const stories = 3 + Math.floor(random() * 3)
  for (let index = 0; index < stories; index++) {
    lines.push(
      '',
      `export const Variant${index}: Story = {`,
      `  args: { className: ${utilityName(utility)}Merge('variant-${index}', 'story') },`,
      '  play: async ({ canvasElement }) => {',
      `    await expect(within(canvasElement).getByText('Variant ${index} of ${name}')).toBeVisible()`,
      '  },',
      '  render: args => (',
      `    <${name} {...args}>`,
      ...others.map(other => `      <${other.name} />`),
      `      Variant ${index} of ${name}`,
      `    </${name}>`,
      '  )',
      '}'
    )
  }
  return `${lines.join('\n')}\n`
}

function groupText(plan: PackagePlan, group: number): string {
  const lines = plan.components
    .filter(component => component.group === group)
    .flatMap(component => {
      const from = specifier(`${groupPath(group)}/index`, componentPath(component))
      return [
        `export { ${component.name} } from '${from}'`,
        `export type { ${component.name}Props } from '${from}'`
      ]
    })
  return `${lines.join('\n')}\n`
}

function indexText(plan: PackagePlan): string {
  const lines = [
    ...Array.from(
      { length: plan.groups },
      (_, group) => `export * from './components/group${group}/index.js'`
    ),
    ...Array.from({ length: plan.utilities }, (_, utility) => {
      const name = utilityName(utility)
      return `export { ${name}Format, ${name}Merge } from './utils/${name}.js'`
    })
  ]
  return `${lines.join('\n')}\n`
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export function syntheticRepository({ modules, packages, seed }: Options): Files {
  const minimum = packages * 2
  if (!Number.isInteger(modules) || modules < minimum) {
    throw new Error(`--modules must be a whole number of at least ${minimum}, got ${modules}`)
  }
  const plans = Array.from({ length: packages }, (_, index) =>
    planPackage(seed, index, Math.floor(modules / packages) + (index < modules % packages ? 1 : 0))
  )
  const files = new Map<string, string>([
    ['package.json', json({ name: `synthetic-${seed}`, private: true, type: 'module' })],
    ['pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n"],
    [
      'tsconfig.base.json',
      json({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          verbatimModuleSyntax: true
        }
      })
    ]
  ])
  for (const plan of plans) {
    const dir = packageDir(plan.index)
    const dependencies = Object.fromEntries(
      plans.slice(0, plan.index).map(other => [packageName(other.index), 'workspace:*'])
    )
    files.set(
      `${dir}/package.json`,
      json({
        name: packageName(plan.index),
        version: '0.0.0',
        type: 'module',
        exports: { '.': './src/index.ts' },
        dependencies: { ...dependencies, clsx: '2.1.1', react: '19.2.0' }
      })
    )
    files.set(
      `${dir}/tsconfig.json`,
      json({ extends: '../../tsconfig.base.json', include: ['src'] })
    )
    files.set(`${dir}/src/index.ts`, indexText(plan))
    for (let utility = 0; utility < plan.utilities; utility++) {
      files.set(`${dir}/${utilityPath(utility)}.ts`, utilityText(plan, utility))
    }
    for (let group = 0; group < plan.groups; group++) {
      files.set(`${dir}/${groupPath(group)}/index.ts`, groupText(plan, group))
    }
    for (const component of plan.components) {
      const path = `${dir}/${componentPath(component)}`
      files.set(`${path}.tsx`, componentText(plans, plan, component))
      if (component.test) files.set(`${path}.test.tsx`, testText(plan, component))
      if (component.story) files.set(`${path}.stories.tsx`, storyText(plan, component))
    }
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** Writes `files` under `dir`, which must be missing or empty. */
export function writeRepository(dir: string, files: Files): void {
  mkdirSync(dir, { recursive: true })
  if (readdirSync(dir).length > 0) throw new Error(`${dir} is not empty`)
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: {
      modules: { type: 'string', default: String(defaults.modules) },
      packages: { type: 'string', default: String(defaults.packages) },
      seed: { type: 'string', default: String(defaults.seed) }
    },
    allowPositionals: true
  })
  if (positionals.length !== 1) {
    console.error(
      'usage: node scripts/synthetic-repo.ts <dir> [--modules n] [--packages n] [--seed n]'
    )
    process.exit(1)
  }
  const options = {
    modules: Number(values.modules),
    packages: Number(values.packages),
    seed: Number(values.seed)
  }
  const dir = resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0]!)
  const files = syntheticRepository(options)
  writeRepository(dir, files)
  console.log(`wrote ${files.size} files to ${dir}`)
}
