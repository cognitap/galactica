/**
 * Which TypeScript compiler settings apply to a module, decided as an editor
 * decides it: the nearest `tsconfig.json` whose files include the module, or
 * one of its project references that does. A module no config claims gets
 * defaults that resolve like a bundler and allow JavaScript.
 */

import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import ts from 'typescript'
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

export interface Config {
  readonly path: RepoPath
  readonly parsed: ts.ParsedCommandLine
  /** The build output directory, when it lies inside the repository and apart from the config's sources. */
  readonly outDir: RepoPath | undefined
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
  readonly configs: () => readonly Config[]
  readonly warnings: () => readonly Warning[]
}

/** Reads configs on demand under `root` and remembers each one, so a config is parsed once per run. */
export function compilerSettings(root: string): CompilerSettings {
  const parsed = new Map<string, Parsed | undefined>()
  const extendedConfigCache = new Map<string, ts.ExtendedConfigCacheEntry>()
  const warnings: Warning[] = []

  function parse(configFile: string): Parsed | undefined {
    if (parsed.has(configFile)) return parsed.get(configFile)
    const path = toRepoPath(root, configFile)
    const report = (diagnostic: ts.Diagnostic) =>
      warnings.push({
        path,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      })
    const commandLine = ts.getParsedCommandLineOfConfigFile(
      configFile,
      undefined,
      { ...ts.sys, onUnRecoverableConfigFileDiagnostic: report },
      extendedConfigCache,
      undefined,
      frameworkExtensions
    )
    if (!commandLine) {
      parsed.set(configFile, undefined)
      return undefined
    }
    commandLine.errors.forEach(report)
    // TypeScript checks options, deprecations included, only when it builds a
    // program. With no root files, building one reads no source file.
    ts.createProgram({
      rootNames: [],
      options: commandLine.options,
      projectReferences: commandLine.projectReferences
    })
      .getOptionsDiagnostics()
      .forEach(report)
    const result = {
      config: { path, parsed: commandLine, outDir: outDirOf(root, configFile, commandLine) },
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
        const found = ts.sys.fileExists(configFile) && claiming(configFile, file, seen)
        if (found) return found
        if (dir === root) break
      }
      return undefined
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
function outDirOf(
  root: string,
  configFile: string,
  commandLine: ts.ParsedCommandLine
): RepoPath | undefined {
  const outDir = commandLine.options.outDir
  return outDir && isInside(root, outDir) && !isInside(outDir, configFile)
    ? toRepoPath(root, outDir)
    : undefined
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
