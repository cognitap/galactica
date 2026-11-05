/**
 * What a framework file holds for the TypeScript extraction: its script
 * blocks, each with the lines of the file before it. Each framework is one
 * entry of the table, which says what compiler, if any, finds its blocks.
 */

import ts from 'typescript'
import type { Language } from './contract.ts'
import type { RepoPath } from './model.ts'
import type { ScriptLanguage } from './syntax.ts'

export type FrameworkLanguage = Exclude<Language, ScriptLanguage>

export interface ScriptBlock {
  readonly text: string
  /** The lines of the file before the block's text, which every line read from the block is shifted by. */
  readonly offset: number
  readonly language: ScriptLanguage
  /** Whether the block's exports are the module's. */
  readonly exports: boolean
}

/** The package entry that parses a framework's files. */
interface CompilerEntry {
  readonly package: string
  readonly entry: string
}

interface Framework {
  readonly compiler?: CompilerEntry
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
    exports
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
    exports
  })
  return [
    ...(module ? [blockOf(module, true)] : []),
    ...(instance ? [blockOf(instance, false)] : [])
  ]
}

const fence = /^﻿?\s*---\r?\n/
const closingFence = /^---\r?$/m

/**
 * The frontmatter, read as text. `@astrojs/compiler` is nested under `astro`
 * in a pnpm install and cannot be resolved from the package that has the
 * file, and the frontmatter is all the extraction reads.
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
      exports: true
    }
  ]
}

const frameworks: Readonly<Record<FrameworkLanguage, Framework>> = {
  vue: { compiler: { package: 'vue', entry: 'vue/compiler-sfc' }, blocks: vueBlocks },
  svelte: { compiler: { package: 'svelte', entry: 'svelte/compiler' }, blocks: svelteBlocks },
  astro: { blocks: astroBlocks }
}

/**
 * The file's script blocks in file order. None when its framework needs a
 * compiler and `compiler` is undefined. Throws when the compiler does.
 */
export function scriptBlocksOf(
  language: FrameworkLanguage,
  path: RepoPath,
  text: string,
  compiler: unknown
): readonly ScriptBlock[] {
  const framework = frameworks[language]
  if (framework.compiler && compiler === undefined) return []
  return [...framework.blocks(text, path, compiler)].sort((a, b) => a.offset - b.offset)
}

/** A framework file compiles to an ES module, so its imports resolve as a TypeScript ES module's do. */
export const frameworkScript = { language: 'ts', format: ts.ModuleKind.ESNext } as const
