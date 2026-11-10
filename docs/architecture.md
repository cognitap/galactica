# Architecture

[Contributing](../CONTRIBUTING.md) · **Architecture**

Galactica turns a repository into one `Model`, derives one `Graph` from it, and renders every output from that graph. The agent commands and the HTML page read the same data, so they never disagree.

```text
argv ─► cli ─► config ─► model cache ──hit──────────────► Model
                              │                             │
                              └─miss─► analysis ─► Model ───┤
                                       discover              ▼
                                       extract            Graph ─► command ─► JSON ─► text
                                       resolve                │
                                                              └──► page data ─► HTML
```

## 1. Command line

`src/bin.ts` checks the Node.js version through `src/node-version.ts` before anything else loads, then runs `src/cli.ts`. `src/cli-input.ts` parses argv against the command metadata and validates both analysis and writer inputs. `src/cli.ts` routes the request, loads `galactica.config.json` once through `src/config.ts`, analyzes the repository and prints the result. HTML writing and skill installation live in `src/cli-writers.ts`, loaded only for those commands.

## 2. Model cache

`src/model-cache.ts` exports `analyze`, the one way a command gets a `Model`. It stores the last model in the user cache folder with a fingerprint of every input it was derived from: file and directory stats, git's file listing and the config, recorded by `src/inputs.ts`. When nothing changed, it answers from the file without loading TypeScript. Otherwise it runs the analysis and writes a new file.

## 3. Analysis

`src/analysis.ts` turns a root and its `Config` into a `Model` in three stages. It is the only path that loads TypeScript.

- **Discover.** `src/repository-files.ts` lists files through git, so `.gitignore` applies. `src/workspace.ts` finds the packages, `src/discovery.ts` lists the modules with their language, kind, package and tsconfig, and `src/compiler-settings.ts` finds the tsconfig of each file. `src/source-file.ts` classifies a path as source, test, story or config.
- **Extract.** `src/extraction.ts` reads what one module gives from its own bytes: symbols (`src/symbols.ts`), imports (`src/imports.ts`) and load-time reads (`src/load-time.ts`), over one syntax tree from `src/syntax.ts`. `src/frameworks.ts` supplies the script blocks of Vue, Svelte, Astro, MDX and Marko files. `src/cache.ts` keeps extractions between runs, keyed by size and mtime, then content hash.
- **Resolve.** `src/import-resolution.ts` maps each specifier to a module, an external package or an unresolved import. `src/package-resolution.ts` follows workspace packages to their source. `src/internal-imports.ts` marks imports into another package's internals, and `src/barrels.ts` follows re-exports to the defining module.

Extractions depend only on a module's bytes. Everything that depends on more than one file is resolved again on every analysis.

## 4. Model and graph

`src/model.ts` defines the `Model`, the per-module facts, and the `Graph` derived from it. `src/graph.ts` builds the graph purely, reading no files: areas (`src/areas.ts`), layers (`src/layers.ts`), cycles (`src/cycles.ts`), all over `src/strongly-connected.ts`.

## 5. Outputs

- **Commands.** Each entry in `src/commands.ts` is a pure function from the graph to a `--json` object: `src/queries.ts` for `where`, `outline`, `uses` and `deps`, `src/path.ts` for `path`, `src/overview.ts` and `src/health.ts`. `src/subjects.ts` resolves the argument. `src/contract.ts` types the JSON and imports nothing.
- **Text.** `src/render.ts` builds the text of each command from its JSON object alone.
- **HTML.** `src/page-data.ts` turns the graph into the compact data the page embeds. `scripts/build-page.ts` bundles the plain JavaScript in `src/page/` with esbuild; `src/html.ts` inlines that bundle, the stylesheet and the data into one page. The page entry delegates rendering to `map-view.js`, interaction and URL state to `navigation.js`, and search controls, health findings and selection highlighting to their own modules. `src/source-links.ts` and `src/git-source.ts` work out source links; `src/row-order.ts` orders the boxes within each layer to reduce crossing links.
- **Skill.** `src/skill.ts` writes the files `init` installs from `skills/galactica/SKILL.md`.

Adding a command is one entry in `src/commands.ts`, one renderer in `src/render.ts` and its types in `src/contract.ts`. Adding a framework is one entry in `src/frameworks.ts`.

## Trust boundary

Every byte Galactica reads from the mapped repository passes through one of three modules:

- `src/safe-read.ts`: `readRepositoryFile` reads a file only when it is a regular file inside the root after following links, of at most 10 MB. Source modules, compiler configs, workspace manifests, `galactica.config.json` and existing skill files all go through it.
- `src/glob.ts`: matches config and workspace globs with a bounded set of states, linear in the path length, so a hostile pattern cannot stall a run. `globProblem` explains a pattern it ignores.
- `src/repository-files.ts`: runs git through `git`, with `core.fsmonitor`, optional index writes and filter drivers turned off.

Writes go through `src/safe-write.ts`, which refuses symbolic links and writes every file or none. The cache lives in the user cache folder and is never read from the repository.

## Tests

- `tests/fixtures/<case>/`: one small repository per hard analysis case, with its expected `Model` and, where needed, `Graph`. `tests/fixtures.ts` holds the aspect table; `pnpm fixtures:update` rewrites the expected files.
- `tests/determinism.test.ts`: maps fixtures from other folders, locales, time zones and cache states, and checks every output is byte-identical.
- `tests/page.test.ts`: drives the built page in headless Chrome.
- `scripts/pack-and-test.ts`: installs the packed package in a throwaway repository and runs it.
