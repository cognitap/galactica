# Galactica

Galactica gives coding agents file-level import, impact and cycle answers, and gives people an interactive map of the same JavaScript or TypeScript repository.

Requires **Node.js 24.1.0 or newer**. Experimental `0.x`; this README describes `main`.

![Immich in dark mode with asset-utils.ts selected, dependencies in cyan and dependents in purple](docs/images/immich-map.png)

`asset-utils.ts` selected in [Immich](https://github.com/immich-app/immich/tree/037e5bc0554074bfe91e20b802a6a4ef4a6dd6f9): cyan dependencies, purple dependents.

The same checkout, through the main-branch CLI (excerpt):

```text
$ npx --prefix / @cognitap/galactica uses web/src/lib/utils/string-utils.ts
web/src/lib/utils/string-utils.ts (module): 11 dependents within depth 1, 10 tests
1  web/src/lib/components/album-page/AlbumsList.svelte  normalizeSearchString
1  web/src/lib/components/asset-viewer/AlbumListItem.svelte  normalizeSearchString
1  web/src/lib/components/asset-viewer/face-editor/FaceEditor.svelte  normalizeSearchString
1  web/src/lib/components/shared-components/album-selection/album-selection-utils.ts  normalizeSearchString
…
```

## One analysis, two views

| What agents get                                                                                  | What humans get                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Importers, dependencies, test reach, cycles and package boundaries as concise text or full JSON. | A single HTML file with areas, layers, search and source links. Open it offline or share it.     |
| A skill for Codex, Claude Code and Cursor, installed with `init`.                                | Select a module to highlight its dependencies and dependents; expand it to see exported symbols. |

Scope is JavaScript and TypeScript, including Vue, Svelte and Astro script blocks. Impact follows imports between files. Use a language service for symbol-level references and refactoring. Tests loaded through a dev server, runtime paths or fixtures can be missing from import reach, so also search for tests named after the feature.

## Three terms

- **Area:** modules grouped within one package, usually by folder.
- **Layer:** dependency order within a package; an area imports lower layers, and a cycle shares one layer.
- **Subject:** the module, area or package passed to `uses` or `deps`.

## How it fits

| Tool                                                                                           | Reach for it for                                                           | Galactica's focus                                                                                             |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [grep / ripgrep](https://github.com/BurntSushi/ripgrep)                                        | Text and pattern searches in any language, including runtime-loaded tests. | Follow resolved JS/TS imports through aliases, workspace packages and barrel re-exports.                      |
| [LSP / editor navigation](https://code.visualstudio.com/docs/editing/editingevolved)           | Symbol references, definitions and renames.                                | File-level impact and a portable map; `where` locates exported definitions.                                   |
| [MCP code graphs, e.g. CodeGraphContext](https://github.com/CodeGraphContext/CodeGraphContext) | Indexed symbols, callers, callees and inheritance, through CLI or MCP.     | Focused import questions from one `npx` command, without a server or MCP connection.                          |
| [madge](https://github.com/pahen/madge)                                                        | Module dependency graphs, importers and circular dependencies.             | Workspace areas/layers, import-reachable tests, an agent skill and an interactive HTML view.                  |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)                           | Configurable dependency rules, validation and CI enforcement.              | Ready-made graph questions and health findings; no custom dependency-rule language.                           |
| [aider's repo map](https://aider.chat/docs/repomap.html)                                       | Ranked class/function signatures within a chat token budget.               | Explicit file relationships and complete JSON answers to specific graph questions.                            |
| [repomix](https://repomix.com/guide/)                                                          | Packing repository source into context for an LLM.                         | Graph answers and a map, rather than a source-code bundle.                                                    |
| [`vitest related`](https://vitest.dev/guide/cli.html#vitest-related)                           | Running Vitest tests related to source files through static imports.       | Runner-independent test lists without running the target; runtime-discovered tests still need further search. |

## What the benchmark supports

On the recorded Nest impact task, every condition covered all required files and tests. The instructed skill cost **15–37% less**. It also improved test selection when Hono imports went through package names. The value is precise questions about the import graph: impact, cycles and package boundaries, with one command and no server.

The [144-run benchmark and reproducible harness](docs/benchmark.md) cover Hono, Vite and Nest, two models, three skill conditions and four runs per cell. Rename accuracy did not improve, and the instructed condition cost more overall. Edits and test lists were graded statically; target tests were not executed, extra tests were not penalized, and the sample is small. The linked report includes every number, the recorded Galactica version and the limits.

## Install and run

Galactica needs Node.js 24.1.0 or newer. It runs in any repository with no install and no config:

```sh
npx --prefix / @cognitap/galactica overview
```

Keep `--prefix /` so npm never runs a copy of Galactica planted in the repository you map. Galactica is experimental while its version is `0.x`: a minor version can change the command output, the config or the skill. The [changelog](CHANGELOG.md) marks each breaking change, and the [release policy](RELEASE_POLICY.md) says what the public contract covers.

## Documentation

- [Commands](docs/commands.md): every command and option, the HTML map, the skill and the cache.
- [Configuration](docs/configuration.md): `galactica.config.json`, globs and module kinds.
- [How it reads a repository](docs/how-it-reads.md): frameworks, workspaces, resolution and known limits.
- [Security](docs/security.md): safe invocation and what Galactica reads and writes.
- [JSON output](docs/json-output.md): the `--json` reference.
- [Benchmark](docs/benchmark.md): the agent benchmark report.
- [Contributing](CONTRIBUTING.md): setup, tests, Node.js support and benchmarks.

Galactica's HTML view was inspired by [codemap](https://github.com/peterretief/codemap) for Go modules.
