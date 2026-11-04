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
- `src/contract.ts`: the public `--json` output types and `SCHEMA_VERSION`. Imports nothing from `src/model.ts`.
- `src/model.ts`: the cached `Model` of per-module facts, and the in-memory `Graph` derived from it.
- `docs/json-output.md`: reference for the `--json` output. Update it with `src/contract.ts`.
- `tests/`: `node:test` suites run against the built `dist/`. Fixture repositories go in `tests/fixtures/`.

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
