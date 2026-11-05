/**
 * What a framework file holds for the TypeScript extraction: its script
 * blocks, each with the lines of the file before it. Each framework is one
 * entry of the table, which says what compiler, if any, finds its blocks.
 * A compiler comes from the repository being mapped, from the package that
 * has the file, else from the root.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import ts from 'typescript'
import type { Warning } from './compiler-settings.ts'
import type { Language } from './contract.ts'
import { parseRepoPath, type RepoPath } from './model.ts'
import { isScriptLanguage, type ScriptLanguage } from './syntax.ts'

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
 * compiler and there is no `load`. Throws when loading or running the
 * compiler does.
 */
export function scriptBlocksOf(
  language: FrameworkLanguage,
  path: RepoPath,
  text: string,
  load: (() => unknown) | undefined
): readonly ScriptBlock[] {
  const framework = frameworks[language]
  if (framework.compiler && !load) return []
  return [...framework.blocks(text, path, load?.())].sort((a, b) => a.offset - b.offset)
}

/** The compiler a package's framework files of one language are read with. */
export interface Compiler {
  readonly entry: string
  /** Its version, or `missing`, which decides whether a cached extraction still holds. */
  readonly stamp: string
  /** Requires the compiler module. Absent when it is missing. */
  readonly load?: () => unknown
}

function resolveCompiler({ package: name, entry }: CompilerEntry, from: string): Compiler {
  const require = createRequire(join(from, 'package.json'))
  const file = require.resolve(entry)
  const manifest = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
  return { entry, stamp: String(manifest.version), load: () => require(file) }
}

/**
 * The compiler for a module of `language` in the package at `dir`, resolved
 * once per language and package. Undefined when the language needs none.
 */
export function compilerResolver(
  root: string
): (language: Language, dir: RepoPath) => Compiler | undefined {
  const resolved = new Map<string, Compiler>()
  return (language, dir) => {
    const entry = isScriptLanguage(language) ? undefined : frameworks[language].compiler
    if (!entry) return undefined
    const key = `${language}\0${dir}`
    const known = resolved.get(key)
    if (known) return known
    let compiler: Compiler = { entry: entry.entry, stamp: 'missing' }
    for (const from of new Set([join(root, dir), root])) {
      try {
        compiler = resolveCompiler(entry, from)
        break
      } catch {}
    }
    resolved.set(key, compiler)
    return compiler
  }
}

/** A framework module its compiler did not read, because it is missing or failed with `failure`. */
export interface Unread {
  readonly path: RepoPath
  readonly language: Language
  /** The directory of the module's package. */
  readonly dir: RepoPath
  readonly compiler: Compiler
  readonly failure?: string
}

/** One warning per compiler and package, on the package's manifest. */
export function unreadWarnings(unread: readonly Unread[]): readonly Warning[] {
  const groups = Map.groupBy(unread, ({ compiler, dir }) => `${compiler.entry}\0${dir}`)
  return [...groups.values()].map(modules => {
    const [{ path, language, dir, compiler, failure }] = modules as [Unread, ...Unread[]]
    const cause =
      failure === undefined
        ? `${compiler.entry} not found`
        : `${compiler.entry} failed on ${path}: ${failure}`
    const files =
      modules.length === 1 ? `1 .${language} file has` : `${modules.length} .${language} files have`
    return { path: parseRepoPath(`${dir}/package.json`), message: `${cause}; ${files} no imports` }
  })
}

/** A framework file compiles to an ES module, so its imports resolve as a TypeScript ES module's do. */
export const frameworkScript = { language: 'ts', format: ts.ModuleKind.ESNext } as const
