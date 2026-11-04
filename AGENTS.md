# Galactica

Galactica analyzes a JavaScript or TypeScript repository into one internal model. The agent commands and the HTML page both render that model, so they never disagree.

## Terms

- **Package:** a workspace package in a monorepo. A single-package repository has one package.
- **Module:** one source file, including `.vue`, `.svelte` and `.astro` files.
- **Area:** a group of modules within one package, usually a folder. The HTML page draws each area as a box. Galactica groups areas automatically, and `galactica.config.json` can override the grouping.
- **Symbol:** an exported function, class, component, type, interface, enum or constant.
- **Edge:** an import from one module to another, resolved through tsconfig paths, workspace packages and barrel re-exports to the module that defines the symbol.
- **Layer:** an area's position in the dependency order. An area only depends on areas in lower layers. Areas in an import cycle share one layer. Tests and stories never affect layers.

## Structure

- `src/cli.ts`: command-line entry point.
- `src/contract.ts`: the public `--json` output types and `SCHEMA_VERSION`. It imports nothing, which `tests/contract.test.ts` enforces.
- `src/model.ts`: the cached `Model` of per-module facts, and the in-memory `Graph` derived from it.
- `src/discovery.ts`: `discover` lists a repository's packages, and its modules with their language, kind, tsconfig and package, and collects config warnings. `compilerOptionsOf` gives the options for one module.
- `src/source-file.ts`: what a path is. `languageOf` and `kindOf` classify a file from its path alone.
- `src/symbols.ts`: what a module exports. `symbolsOf` reads a module's `SymbolFacts` from its text alone, with no program and no type checker.
- `src/repository-files.ts`: which files a repository has. Uses `git ls-files` so `.gitignore` applies, and a directory walk outside a git work tree, which ignores `.gitignore`.
- `src/workspace.ts`: which packages a workspace names, from `pnpm-workspace.yaml` or the root `package.json` `workspaces`. `packageOf` gives the package of a path.
- `src/package-resolution.ts`: which source module a bare specifier reaches when it names a workspace package, through `exports` or the entry fields, and back from build output to source.
- `src/compiler-settings.ts`: which tsconfig applies to a file, following `extends` and project references, and the defaults when none does.
- `docs/json-output.md`: reference for the `--json` output. Update it with `src/contract.ts`.
- `tests/`: `node:test` suites. CLI tests run the built `dist/`, and unit tests import `src/` directly. `tests/temp-repository.ts` writes a throwaway repository for a test.
- `tests/fixtures/<case>/`: one small repository per hard analysis case in `repo/`, with its expected `Model` in `expected.json` and, where the case is about derived data, `expected-graph.json`. `tests/fixtures/README.md` states the conventions. Formatters never touch these files, because the expected files pin line numbers.
- `tests/fixtures.ts`: lists the cases, reads and writes the expected files, and holds the aspect table. Each aspect is one part of the expected files with the issue that implements it. `tests/fixtures.test.ts` checks each expected file against its repository, and compares each implemented aspect with the analyzer's output. `tests/update-fixtures.ts` rewrites the implemented aspects.

## Conventions

- The public contract is the output of the commands, in text and in `--json`. Treat changes to it as breaking. The model and the cache format are private.
- Analyze source with the TypeScript compiler API, and read framework files with the compiler from the target repository's `node_modules`. Never run the code being mapped.
- Write nothing into the target repository except what `galactica init` installs. The cache lives in `node_modules/.cache/galactica`.
- Work with zero config. Every option in `galactica.config.json` is an override, never a requirement.
- The HTML page is one file with no network requests. Inline all scripts, styles and data.
- Output is deterministic: the same repository produces byte-identical output.
- A first run on about 3,000 files takes under 10 seconds, and a command with a warm cache takes under half a second. Do not merge changes that break these targets.
- Support Node.js 24 and newer.

## Commands

`pnpm check` runs format, lint, typecheck and tests. Run it before every commit.

`pnpm fixtures:update` rewrites the implemented aspects of every expected file from the analyzer's output. Run it when a change to the output is intended, and review the diff under `tests/fixtures` as part of the change. When an issue implements an aspect, give the aspect a check in `tests/fixtures.ts` and remove the cases it finishes from `pendingIn`.
