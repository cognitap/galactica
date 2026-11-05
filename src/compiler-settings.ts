/**
 * Which TypeScript compiler settings apply to a module, decided as an editor
 * decides it: the nearest `tsconfig.json` whose files include the module, or
 * one of its project references that does. A module no config claims gets
 * defaults that resolve like a bundler and allow JavaScript.
 */

import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import ts from 'typescript'
import type { Inputs } from './inputs.ts'
import { toRepoPath, type RepoPath } from './model.ts'

export const defaultCompilerOptions: ts.CompilerOptions = {
  allowJs: true,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  resolveJsonModule: true
}

/** A config problem TypeScript reported. Galactica keeps going and uses what it could parse. */
export interface Warning {
  readonly path: RepoPath
  readonly message: string
}

/** Where a config writes build output, and the source directory that output mirrors, both absolute. */
export interface Build {
  readonly outDir: string
  readonly rootDir: string
}

export interface Config {
  readonly path: RepoPath
  readonly parsed: ts.ParsedCommandLine
  /** Present when the outDir lies inside the repository and apart from the config's sources. */
  readonly build: Build | undefined
}

// Without these, a config's file list never includes framework files, so they
// would fall through to the defaults and lose the project's path aliases.
const frameworkExtensions: readonly ts.FileExtensionInfo[] = ['.vue', '.svelte', '.astro'].map(
  extension => ({ extension, isMixedContent: true, scriptKind: ts.ScriptKind.Deferred })
)

interface Parsed {
  readonly config: Config
  readonly files: ReadonlySet<string>
  readonly references: readonly string[]
}

export interface CompilerSettings {
  /** The config that applies to the absolute `file`, or undefined when the defaults do. */
  readonly configOf: (file: string) => Config | undefined
  /** The config at the absolute `configFile`, whether or not it applies to any file. */
  readonly configAt: (configFile: string) => Config | undefined
  readonly configs: () => readonly Config[]
  readonly warnings: () => readonly Warning[]
}

interface FileSystemEntries {
  readonly files: readonly string[]
  readonly directories: readonly string[]
}

type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => FileSystemEntries,
  realpath: (path: string) => string
) => string[]

// The glob matcher behind `ts.sys.readDirectory`, which the public typings leave out.
const { matchFiles } = ts as unknown as { readonly matchFiles: MatchFiles }

const canonicalFileName = ts.sys.useCaseSensitiveFileNames
  ? (name: string) => name
  : (name: string) => name.toLowerCase()

const noEntries: FileSystemEntries = { files: [], directories: [] }

/**
 * TypeScript's `readDirectory`, answered from the repository's files instead
 * of a walk of the disk. The globs match as TypeScript matches them, through
 * its own matcher over the directories the file list implies.
 */
function listedDirectories(
  root: string,
  files: readonly RepoPath[]
): ts.ParseConfigHost['readDirectory'] {
  const slashed = root.split(sep).join('/').replace(/\/$/, '')
  const tree = new Map<string, { readonly files: string[]; readonly directories: Set<string> }>()
  const entriesAt = (dir: string) => {
    const key = canonicalFileName(dir === '' ? slashed || '/' : `${slashed}/${dir}`)
    const known = tree.get(key)
    if (known) return known
    const made = { files: [], directories: new Set<string>() }
    tree.set(key, made)
    return made
  }
  for (const path of files) {
    const segments = path.split('/')
    let dir = ''
    for (const segment of segments.slice(0, -1)) {
      entriesAt(dir).directories.add(segment)
      dir = dir === '' ? segment : `${dir}/${segment}`
    }
    entriesAt(dir).files.push(segments.at(-1)!)
  }
  const entriesOf = (dir: string): FileSystemEntries => {
    const entries = tree.get(canonicalFileName(dir))
    return entries ? { files: entries.files, directories: [...entries.directories] } : noEntries
  }
  return (path, extensions, excludes, includes, depth) =>
    matchFiles(
      path,
      extensions,
      excludes,
      includes,
      ts.sys.useCaseSensitiveFileNames,
      root,
      depth,
      entriesOf,
      dir => dir
    )
}

/**
 * Reads configs on demand under `root` and remembers each one, so a config is
 * parsed once per run. `files` answers the configs' include globs.
 */
export function compilerSettings(
  root: string,
  files: readonly RepoPath[],
  inputs: Inputs
): CompilerSettings {
  const commandLines = new Map<string, ts.ParsedCommandLine>()
  const parsed = new Map<string, Parsed | undefined>()
  const extendedConfigCache = new Map<string, ts.ExtendedConfigCacheEntry>()
  const warnings: Warning[] = []
  const reads = {
    fileExists: inputs.fileExists,
    readFile: inputs.readFile,
    directoryExists: inputs.directoryExists,
    realpath: inputs.realpath,
    getDirectories: inputs.getDirectories,
    getCurrentDirectory: () => root
  }
  const parseHost = {
    ...reads,
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: listedDirectories(root, files)
  }
  // With no root files, a program reads no source file. Its referenced configs
  // come from `commandLineOf`, so none is parsed twice, and its current
  // directory is the root, so a warning's text is the same wherever the
  // command runs.
  const programHost: ts.CompilerHost = {
    ...reads,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCanonicalFileName: canonicalFileName,
    getNewLine: () => '\n',
    getSourceFile: () => undefined,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    writeFile: () => {},
    getParsedCommandLine: configFile => commandLineOf(configFile, () => {})
  }

  /** The config file's command line, parsed once per run. `report` hears when the file cannot be read. */
  function commandLineOf(
    configFile: string,
    report: ts.DiagnosticReporter
  ): ts.ParsedCommandLine | undefined {
    const known = commandLines.get(configFile)
    if (known) return known
    const commandLine = ts.getParsedCommandLineOfConfigFile(
      configFile,
      undefined,
      { ...parseHost, onUnRecoverableConfigFileDiagnostic: report },
      extendedConfigCache,
      undefined,
      frameworkExtensions
    )
    if (commandLine) commandLines.set(configFile, commandLine)
    return commandLine
  }

  function parse(configFile: string): Parsed | undefined {
    if (parsed.has(configFile)) return parsed.get(configFile)
    const path = toRepoPath(root, configFile)
    const report = (diagnostic: ts.Diagnostic) =>
      warnings.push({
        path,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      })
    const commandLine = commandLineOf(configFile, report)
    if (!commandLine) {
      parsed.set(configFile, undefined)
      return undefined
    }
    commandLine.errors.forEach(report)
    // TypeScript checks options, deprecations included, only when it builds a program.
    ts.createProgram({
      rootNames: [],
      options: commandLine.options,
      projectReferences: commandLine.projectReferences,
      host: programHost
    })
      .getOptionsDiagnostics()
      .forEach(report)
    const result = {
      config: { path, parsed: commandLine, build: buildOf(root, configFile, commandLine) },
      files: new Set(commandLine.fileNames),
      references: (commandLine.projectReferences ?? [])
        .map(reference => ts.resolveProjectReferencePath(reference))
        .filter(reference => isInside(root, reference))
    }
    parsed.set(configFile, result)
    return result
  }

  function claiming(configFile: string, file: string, seen: Set<string>): Config | undefined {
    if (seen.has(configFile)) return undefined
    seen.add(configFile)
    const config = parse(configFile)
    if (!config) return undefined
    if (config.files.has(file)) return config.config
    for (const reference of config.references) {
      const found = claiming(reference, file, seen)
      if (found) return found
    }
    return undefined
  }

  return {
    configOf(file) {
      const seen = new Set<string>()
      for (let dir = dirname(file); isInside(root, dir); dir = dirname(dir)) {
        const configFile = join(dir, 'tsconfig.json')
        const found = reads.fileExists(configFile) && claiming(configFile, file, seen)
        if (found) return found
        if (dir === root) break
      }
      return undefined
    },
    configAt(configFile) {
      return parse(configFile)?.config
    },
    configs() {
      return [...parsed.values()].flatMap(entry => (entry ? [entry.config] : []))
    },
    warnings() {
      return warnings
    }
  }
}

// An outDir that holds its own config holds the sources too, so it marks no build output.
function buildOf(
  root: string,
  configFile: string,
  { options }: ts.ParsedCommandLine
): Build | undefined {
  const { outDir } = options
  return outDir && isInside(root, outDir) && !isInside(outDir, configFile)
    ? { outDir, rootDir: options.rootDir ?? dirname(configFile) }
    : undefined
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
