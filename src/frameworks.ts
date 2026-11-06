/**
 * What a framework file holds for the TypeScript extraction: its script
 * blocks, each with the lines of the file before it. Each framework is one
 * entry of the table, which says what compiler, if any, finds its blocks.
 * A compiler is Galactica's own optional dependency. Requiring one from the
 * repository being mapped would run that repository's code.
 */

import { createRequire } from 'node:module'
import type { Warning } from './compiler-settings.ts'
import type { Language } from './contract.ts'
import type { RepoPath } from './model.ts'

export interface ScriptBlock {
  readonly text: string
  /** The lines of the file before the block's text, which every line read from the block is shifted by. */
  readonly offset: number
  readonly language: ScriptLanguage
  /** Whether the block's exports are the module's. */
  readonly exports: boolean
  /** Whether the block runs as the module loads, rather than per component instance or render. */
  readonly loads: boolean
}

interface Framework {
  /** The module that parses the framework's files. */
  readonly compiler?: string
  /** Throws when the compiler throws, or gives output of another shape. */
  readonly blocks: (text: string, path: RepoPath, compiler: unknown) => readonly ScriptBlock[]
}

const languageByLang: Readonly<Record<string, ScriptLanguage>> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  jsx: 'jsx'
}

const scriptLanguageOf = (lang: string | undefined): ScriptLanguage =>
  (lang !== undefined && languageByLang[lang]) || 'js'

const linesBefore = (text: string, offset: number) => text.slice(0, offset).split('\n').length - 1

interface VueBlock {
  readonly content: string
  readonly lang?: string
  readonly loc: { readonly start: { readonly line: number } }
}

interface VueCompiler {
  readonly parse: (
    text: string,
    options: { readonly filename: string }
  ) => {
    readonly descriptor: { readonly script: VueBlock | null; readonly scriptSetup: VueBlock | null }
  }
}

function vueBlocks(text: string, path: RepoPath, compiler: unknown): readonly ScriptBlock[] {
  const { script, scriptSetup } = (compiler as VueCompiler).parse(text, {
    filename: path
  }).descriptor
  const blockOf = (block: VueBlock, exports: boolean): ScriptBlock => ({
    text: block.content,
    offset: block.loc.start.line - 1,
    language: scriptLanguageOf(block.lang),
    exports,
    loads: exports
  })
  return [
    ...(script ? [blockOf(script, true)] : []),
    ...(scriptSetup ? [blockOf(scriptSetup, false)] : [])
  ]
}

interface SvelteScript {
  readonly content: { readonly start: number; readonly end: number }
  readonly attributes: readonly {
    readonly name: string
    readonly value: true | readonly { readonly data: string }[]
  }[]
}

interface SvelteCompiler {
  readonly parse: (
    text: string,
    options: { readonly modern: true }
  ) => { readonly instance?: SvelteScript | null; readonly module?: SvelteScript | null }
}

function svelteLangOf({ attributes }: SvelteScript): string | undefined {
  const value = attributes.find(attribute => attribute.name === 'lang')?.value
  return value === true ? undefined : value?.[0]?.data
}

/** The module script, `<script module>` or `context="module"`, is the only one that can export. */
function svelteBlocks(text: string, _path: RepoPath, compiler: unknown): readonly ScriptBlock[] {
  const { instance, module } = (compiler as SvelteCompiler).parse(text, { modern: true })
  const blockOf = (script: SvelteScript, exports: boolean): ScriptBlock => ({
    text: text.slice(script.content.start, script.content.end),
    offset: linesBefore(text, script.content.start),
    language: scriptLanguageOf(svelteLangOf(script)),
    exports,
    loads: exports
  })
  return [
    ...(module ? [blockOf(module, true)] : []),
    ...(instance ? [blockOf(instance, false)] : [])
  ]
}

const fence = /^﻿?\s*---\r?\n/
const closingFence = /^---\r?$/m

/**
 * The frontmatter, read as text. It is all the extraction reads, so
 * Galactica ships no Astro compiler for it.
 */
function astroBlocks(text: string): readonly ScriptBlock[] {
  const open = fence.exec(text)
  if (!open) return []
  const start = open[0].length
  const close = closingFence.exec(text.slice(start))
  if (!close) return []
  return [
    {
      text: text.slice(start, start + close.index),
      offset: linesBefore(text, start),
      language: 'ts',
      exports: true,
      loads: false
    }
  ]
}

/** One entry per framework, keyed by its file extension. */
const frameworks = {
  vue: { compiler: '@vue/compiler-sfc', blocks: vueBlocks },
  svelte: { compiler: 'svelte/compiler', blocks: svelteBlocks },
  astro: { blocks: astroBlocks }
} satisfies Readonly<Partial<Record<Language, Framework>>>

export type FrameworkLanguage = keyof typeof frameworks
export const frameworkLanguages = Object.keys(frameworks) as readonly FrameworkLanguage[]

/** The languages TypeScript parses directly. Framework files need their own compiler. */
export type ScriptLanguage = Exclude<Language, FrameworkLanguage>

export function isScriptLanguage(language: Language): language is ScriptLanguage {
  return !Object.hasOwn(frameworks, language)
}

/**
 * The file's script blocks in file order. None when its framework needs a
 * compiler and there is no `load`. Throws when loading or running the
 * compiler does.
 */
export function scriptBlocksOf(
  language: FrameworkLanguage,
  path: RepoPath,
  text: string,
  load: (() => unknown) | undefined
): readonly ScriptBlock[] {
  const framework: Framework = frameworks[language]
  if (framework.compiler && !load) return []
  return [...framework.blocks(text, path, load?.())].sort((a, b) => a.offset - b.offset)
}

/** The compiler a language's files are read with. */
interface Compiler {
  readonly entry: string
  /** Requires the compiler module. Absent when Galactica was installed without it. */
  readonly load?: () => unknown
}

const require = createRequire(import.meta.url)
const compilers = new Map<FrameworkLanguage, Compiler>()

/** Galactica's own compiler for `language`, resolved once. Undefined when the language needs none. */
export function compilerOf(language: Language): Compiler | undefined {
  if (isScriptLanguage(language)) return undefined
  const framework: Framework = frameworks[language]
  const entry = framework.compiler
  if (entry === undefined) return undefined
  let compiler = compilers.get(language)
  if (!compiler) {
    let file: string | undefined
    try {
      file = require.resolve(entry)
    } catch {}
    compiler = file === undefined ? { entry } : { entry, load: () => require(file) }
    compilers.set(language, compiler)
  }
  return compiler
}

/** A framework module its compiler did not read, because it is missing or failed with `failure`. */
export interface Unread {
  readonly path: RepoPath
  readonly language: Language
  readonly compiler: Compiler
  readonly failure?: string
}

/** One warning per language, on its first unread module. */
export function unreadWarnings(unread: readonly Unread[]): readonly Warning[] {
  const groups = Map.groupBy(unread, ({ language }) => language)
  return [...groups.values()].map(modules => {
    const [{ path, language, compiler, failure }] = modules as [Unread, ...Unread[]]
    const cause =
      failure === undefined
        ? `${compiler.entry} is not installed with Galactica`
        : `${compiler.entry} failed on ${path}: ${failure}`
    const files =
      modules.length === 1 ? `1 .${language} file has` : `${modules.length} .${language} files have`
    return { path, message: `${cause}; ${files} no imports` }
  })
}
