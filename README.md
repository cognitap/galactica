# Galactica

Galactica gives coding agents file-level import, impact and cycle answers, and gives people an interactive map of the same JavaScript or TypeScript repository.

Requires **Node.js 24.1.0 or newer**. Run it in any repository, with no install and no config:

```sh
npx --prefix / @cognitap/galactica overview
```

Keep `--prefix /`: it stops npm from running a copy of Galactica planted in the repository you map. [Security](https://github.com/cognitap/galactica/blob/main/docs/security.md) explains why. To pin a version for a team, install it as a dev dependency, for example `pnpm add -D @cognitap/galactica`, and run `pnpm exec galactica overview`.

![Immich in dark mode with asset-utils.ts selected, dependencies in cyan and dependents in purple](https://raw.githubusercontent.com/cognitap/galactica/main/docs/images/immich-map.png)

`asset-utils.ts` selected in [Immich](https://github.com/immich-app/immich/tree/037e5bc0554074bfe91e20b802a6a4ef4a6dd6f9): cyan dependencies, purple dependents.

## One analysis, two views

| What agents get                                                                                  | What humans get                                                                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Importers, dependencies, test reach, cycles and package boundaries as concise text or full JSON. | A single HTML file with areas, layers, search and source links. Open it offline or share it.     |
| A skill for Codex, Claude Code and Cursor, installed with `init`.                                | Select a module to highlight its dependencies and dependents; expand it to see exported symbols. |

## Three terms

- **Area:** modules grouped within one package, usually by folder.
- **Layer:** dependency order within a package; an area imports lower layers, and a cycle shares one layer.
- **Subject:** the module, area or package passed to `uses` or `deps`.

## Commands

The examples write `galactica` for `npx --prefix / @cognitap/galactica`. Every command prints short text, or JSON with `--json`. The first run in a repository analyzes every file; later runs reuse a cache outside the repository and parse only what changed.

| Command          | Answers                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `overview`       | What is in this repository, and how is it layered?                  |
| `where <name>`   | Where is this defined?                                              |
| `outline <file>` | What does this file contain?                                        |
| `uses <file>`    | What depends on this, and which tests should run after I change it? |
| `deps <file>`    | What does this depend on?                                           |
| `cycles`         | Which modules import each other in a loop, and where do I cut it?   |
| `health`         | Is the structure healthy, and which imports should change?          |
| `html`           | Write the human map as one HTML file.                               |
| `init`           | Install the agent skill into this repository.                       |

`uses` lists what imports a file, with the names each importer takes, and every test that reaches it through imports, closest first. On the same Immich checkout (excerpt):

```text
$ galactica uses web/src/lib/utils/string-utils.ts
web/src/lib/utils/string-utils.ts (module): 11 dependents within depth 1, 10 tests
1  web/src/lib/components/album-page/AlbumsList.svelte  normalizeSearchString
1  web/src/lib/components/asset-viewer/AlbumListItem.svelte  normalizeSearchString
1  web/src/lib/components/asset-viewer/face-editor/FaceEditor.svelte  normalizeSearchString
1  web/src/lib/components/shared-components/album-selection/album-selection-utils.ts  normalizeSearchString
…
```

To give your agent the skill, run `init` in the repository. It writes three files and nothing else:

```sh
npx --prefix / @cognitap/galactica init
```

[Commands](https://github.com/cognitap/galactica/blob/main/docs/commands.md) documents every command, option and example.

## How it fits

| Tool                                                                                 | Reach for it for                                               | Galactica's focus                                                                          |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [ripgrep](https://github.com/BurntSushi/ripgrep)                                     | Text searches in any language, including runtime-loaded tests. | Resolved JS/TS imports through aliases, workspace packages and barrel re-exports.          |
| [LSP / editor navigation](https://code.visualstudio.com/docs/editing/editingevolved) | Symbol references, definitions and renames.                    | File-level impact and a portable map.                                                      |
| [madge](https://github.com/pahen/madge)                                              | Module dependency graphs and circular dependencies.            | Workspace areas and layers, import-reachable tests, an agent skill and an interactive map. |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)                 | Custom dependency rules enforced in CI.                        | Ready-made graph questions and health findings, with no rule language.                     |

## What the benchmark supports

Galactica helps most when an agent must name the tests to run after an edit, and some of those tests reach the changed file in a way grep does not follow. On the two such tasks, Hono tests that import through a package name and Vite tests that load code through a dev server, the instructed skill raised Sonnet's test-selection score from **47% to 78%**, and Opus's from 82% to 100%. The score is the share of required tests the agent named; extra tests are not penalized.

Cost depends on the task. On the one impact task, every condition found every file and test, and Galactica made the answers 15–37% cheaper. Across all six tasks, the instructed condition cost more per run: 7% more with Sonnet and 17% more with Opus. Renames did not improve.

The sample is small: 144 runs, four per task, model and condition, on three repositories. Edits were graded statically, and the target repositories' test suites were not executed. The [benchmark report](https://github.com/cognitap/galactica/blob/main/docs/benchmark.md) is authoritative, with every number, the method and its limits.

## Limits

- **Files, not symbols.** Impact follows imports between files. Use a language service for symbol-level references and refactoring.
- **Imports only.** Tests loaded through a dev server, a build, runtime paths or fixtures can be missing from `uses`, so also search for tests named after the feature.
- **JavaScript and TypeScript.** Vue, Svelte and Astro script blocks are read; Deno repositories are not supported. Framework aliases from generated configs, such as Nuxt's `#imports`, need `nuxi prepare` or `svelte-kit sync` first.
- **Experimental `0.x`.** A minor version can change the command output, the config or the skill. The [release policy](https://github.com/cognitap/galactica/blob/main/RELEASE_POLICY.md) says what the public contract covers.

## Documentation

- [Commands](https://github.com/cognitap/galactica/blob/main/docs/commands.md): every command and option, the HTML map, the skill and the cache.
- [Configuration](https://github.com/cognitap/galactica/blob/main/docs/configuration.md): optional `galactica.config.json`, globs and module kinds.
- [How it reads a repository](https://github.com/cognitap/galactica/blob/main/docs/how-it-reads.md): frameworks, workspaces, resolution and known limits.
- [Security](https://github.com/cognitap/galactica/blob/main/docs/security.md): safe invocation and what Galactica reads and writes.
- [JSON output](https://github.com/cognitap/galactica/blob/main/docs/json-output.md): the `--json` reference.
- [Benchmark](https://github.com/cognitap/galactica/blob/main/docs/benchmark.md): the agent benchmark report.
- [Contributing](https://github.com/cognitap/galactica/blob/main/CONTRIBUTING.md): setup, tests, Node.js support and benchmarks.

Galactica's HTML view was inspired by [codemap](https://github.com/peterretief/codemap) for Go modules. MIT licensed.
