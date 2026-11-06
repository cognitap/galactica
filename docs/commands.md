# Commands

[README](../README.md) · **Commands** · [Configuration](configuration.md) · [How it reads a repository](how-it-reads.md) · [Security](security.md) · [JSON output](json-output.md)

Run each command from the repository you want to map, or pass that repository with `--root`. The examples write `galactica` for `npx --prefix / @cognitap/galactica`. [Security](security.md#run-it-with---prefix-) explains why to keep `--prefix /`.

To pin a version for a team, install it as a dev dependency and run it through the package manager, for example `pnpm add -D @cognitap/galactica` and `pnpm exec galactica overview`.

The smaller examples use [Radiant](https://github.com/cognitap/radiant), Cognitap's React interaction components and presentation primitives.

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

## Common behavior

Every command prints short text by default and structured output with `--json`, including `html` and `init` results and failures. The [JSON output reference](json-output.md) documents the fields. In text mode, a command that cannot answer prints one line to stderr and exits with code 1. Unknown commands point to `--help`, and a close option typo suggests the known option.

A subject is a module path, a package name, a package directory or an area path.

| Option          | Effect                                                          |
| --------------- | --------------------------------------------------------------- |
| `--root <dir>`  | Use this repository instead of the current directory.           |
| `--json`        | Print the JSON result or failure instead of text.               |
| `--no-cache`    | Analyze every file, and neither read nor write the cache.       |
| `--depth <n>`   | How many import steps `uses` and `deps` follow. 1 by default.   |
| `--all`         | List every module of each area in `overview`, not the top five. |
| `-h, --help`    | Print every command and option.                                 |
| `-v, --version` | Print the version.                                              |

`html` and `init` take the options described in their sections below.

## overview

`overview` lists the packages, their areas by layer and the top five modules of each area by importers. `--all` ranks every module instead.

It also counts the warnings of the analysis, such as a workspace package without a name, which it skips, or a `tsconfig.json` it cannot read, and its `--json` lists them. An empty or non-JavaScript/TypeScript repository is reported clearly, with exit code 0.

`overview --json` adds `unresolvedImports`: every unresolved import with file, line, full specifier and likely cause, including tests and stories. The `unresolved` count stays numeric. The text groups likely build or generated targets, virtual modules or schemes, URLs, and missing or unmapped files. These are hints, not build diagnostics.

## where and outline

`where <name>` finds the modules that export a symbol. `outline <file>` lists what a module exports. Both label exported aliases, such as `Root (alias of Slot)`, and their JSON keeps both the export name and the original declaration signature. For local names and symbol-level references, use grep or a language service.

## uses

`uses` lists what imports a subject, with the names each direct dependent takes, and every test that imports it at any distance, closest first. A test that imports it through other modules names the module its path starts from. Tests that reach it only through a hub, a module that much of the repository imports, are counted per hub rather than listed.

Only tests that import the subject are listed. An end-to-end, playground or fixture-driven test that loads it another way, such as through a dev server, a build or a config file, can be missing, so also search for tests named after the feature.

```text
$ galactica uses src/components/Kbd/Kbd.tsx
src/components/Kbd/Kbd.tsx (module): 7 dependents within depth 1, 21 tests
1  .storybook/examples/CommandExamples.tsx  Kbd, KbdGroup
1  .storybook/examples/InputGroupExamples.tsx  Kbd, KbdGroup
1  .storybook/examples/KbdExamples.tsx  Kbd, KbdGroup, KbdProps
1  src/components/Command/Command.tsx  Kbd, KbdGroup
1  src/components/Kbd/Kbd.stories.tsx  Kbd
1  src/index.ts  Kbd, KbdGroup, KbdGroupProps, KbdProps
1  src/recipes/ThemeShowcase.stories.tsx  Kbd, KbdGroup
tests, closest first:
1  tests/browser/InputGroup.test.tsx  Kbd
1  tests/browser/Kbd.test.tsx  Kbd, KbdGroup
1  tests/package/input-group.test.ts  Kbd, KbdGroup
…
2  tests/browser/Command.test.tsx  via .storybook/examples/CommandExamples.tsx
2  tests/browser/DataSlot.test.tsx  via src/components/Command/Command.tsx
…
3  tests/browser/EmptyState.test.tsx  via src/components/Command/Command.tsx
Lists only tests that import the subject, directly or through other modules. End-to-end, playground and fixture-driven tests that load it another way, such as through a dev server, a build or a config file, can be missing, so also search for tests named after the feature.
```

## deps

`deps` lists what a subject imports, inside the workspace and outside it:

```text
$ galactica deps src/cn.ts
src/cn.ts (module): 1 dependency within depth 1, 1 external package, 0 unresolved imports
1  src/themes/tokens.ts  typographyRoles
packages: none
external: cn
unresolved: none
```

`deps` of a module starts from that exact file, even a test or story. `deps` of a package or area starts from its source and config modules: tests, stories and fixtures classified as tests are not starting points, so imports made only by those files are omitted. The external and unresolved lists describe the starting modules only. Use `overview --json` for every unresolved import in the repository. Text shortens long specifiers; JSON keeps them complete.

`uses` and `deps` follow `--depth` import steps, 1 by default, and end with a line for each cycle the subject is in.

## cycles

`cycles` lists each import cycle among the modules that run, with its modules in dependency order and every import between them. Type-only imports and re-exports do not form cycles.

Each import is marked `used at load time` when the importer reads the name in top-level code, which can fail while the cycle loads, or `used later` when only functions read it. Cycles with a load-time import come first. `break here` marks the imports that point back up the order: cutting all of them ends the cycle. The order keeps load-time imports and cuts the fewest names it can. On [Vite](https://github.com/vitejs/vite) at `4835128`:

```text
$ galactica cycles
16 import cycles, 7 used at load time
…
cycle 5: 2 modules, used at load time, in dependency order:
  playground/hmr/entry-cycle/entry-cycle.js
  playground/hmr/entry-cycle/dep.js
imports (1 to break):
  playground/hmr/entry-cycle/dep.js:1 -> playground/hmr/entry-cycle/entry-cycle.js  name  used later  break here
  playground/hmr/entry-cycle/entry-cycle.js:1 -> playground/hmr/entry-cycle/dep.js  describe  used at load time
…
```

## health

`health` lists concrete findings about the structure, with no score, and always exits with code 0:

- every import cycle, as `cycles` lists it, with the imports to break;
- each oversized area: at least 20 source modules, tests, stories and config aside, and at least 5 times the median of its package's areas. [`health.areaModules`](configuration.md#options) replaces that rule with a fixed number;
- each import outside tests and stories that reaches into another workspace package's internals: a relative path into that package's directory, or a subpath that its `exports` does not list. Each one shows the specifier to change and, where one exists, the public specifier that gives the same import.

On [Vitest](https://github.com/vitest-dev/vitest) at `71ad4df`:

```text
$ galactica health
4 import cycles, 2 oversized areas, 20 cross-package private imports
…
oversized areas (at least 20 source modules and 5 times the median area of their package):
  packages/browser/src/client/tester/expect  28 source modules, package median 3.5
  packages/vitest/src/node  31 source modules, package median 5.5
cross-package private imports:
…
  packages/browser/src/client/orchestrator.ts:16  ../../../vitest/src/utils/tasks.js  generateFileHash  relative path into vitest  use vitest/node
  packages/browser/src/client/tester/runner.ts:31  ../../../../vitest/src/utils/tasks  getTestName  relative path into vitest  no public entry gives it
…
```

## html

`html` writes the map for people to `galactica.html` in the current directory, or to the file `--out` names, and prints the path and size. `--open` opens it in the default browser. With `--json`, it reports the absolute path and exact byte count. It refuses to write through a symbolic link; see [Security](security.md#what-it-writes).

The page is one file that loads nothing from the network, so it opens from disk and can be shared as an attachment. On Radiant, it is about 440 KB and takes under a second to write.

### Reading the map

- Each package is a section, largest first; a package picker jumps between them.
- Each area is a box in a row by layer. The bottom row imports no other area, and each row above imports only from rows below, except areas marked as a cycle. A wider box exports more symbols, and its colour marks its top-level folder.
- Selecting an area lists its modules in a panel beside the map, or at the bottom of a narrow screen. Each module expands to list its exported symbols with signatures and docs. Clearing the selection closes the panel.
- The Show buttons filter by kind. Source and config modules show at first; tests and stories stay hidden until you show them. A module's kind comes from its name and folder, or from [`kinds`](configuration.md#kinds) in the config. To leave generated files out entirely, list them in `exclude`.
- Search finds areas, modules and exported symbols, including what the filter hides. Press `/` to focus it, the arrow keys to move, Enter to go and Escape to close or clear. Exact matches come first, then prefixes, then substrings.
- Select a box title, or the circle at the end of a module's row, to highlight its dependencies and dependents. The bar at the top gives the same counts as `deps` and `uses` at depth 1. Escape or Clear ends the selection. The selection is kept in the address, as `#module=src%2Fcn.ts` or `#area=src%2Fcomponents`, so a link opens the same view.
- The Health section above the map lists what `health` finds. Choosing a finding selects its module or area, and its line links to the import.

### Source links

Each module path and symbol line links to the file in the repository host, at the newest commit the remote is known to have. Galactica reads the `origin` remote, or the first remote by name, and links to `HEAD` when a remote-tracking ref contains it. Otherwise it links to the merge base of `HEAD` with the upstream, else with `<remote>/HEAD`, `<remote>/main` or `<remote>/master`. It uses only local refs and never fetches, so fetch first to link to a newer commit. When the map includes unpushed commits or changes to tracked files, the page header says so.

GitHub remotes in `https://`, `git@github.com:` and `ssh://` forms are recognised. Without git, a commit or a GitHub remote, the page shows plain paths. `--source-url <template>` sets the link for another host, with `{commit}`, `{path}` and `{line}` in place:

```sh
galactica html --source-url 'https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}'
```

The template must start with `http://` or `https://` and contain `{path}`. A link to a module has no line, so the template loses its `#...{line}` fragment. `--source-url none` turns links off. The config's [`sourceUrl`](configuration.md#options) sets the same template, and the option wins over it.

## init

`init` installs the agent skill for Codex, Claude Code and Cursor. It writes three files and nothing else:

- `.agents/skills/galactica/SKILL.md`, which Codex reads;
- `.claude/skills/galactica/SKILL.md`, which Claude Code reads;
- `.cursor/rules/galactica.mdc`, a rule that sends Cursor's agent to the skill.

The skill leads with `uses` before an edit, then asks the agent to also grep for tests named after the feature and run both sets. It pairs `where` with grep, suggests `overview` when the agent does not know where to start, and asks it to check that an edit adds no import cycle.

The skill runs `npx --prefix / @cognitap/galactica` by default. `--command` sets another command, for example when Galactica is a dev dependency of a repository you trust, or a build from a checkout:

```sh
npx --prefix / @cognitap/galactica init --command "pnpm exec galactica"
node /path/to/galactica/dist/bin.js init --command "node /path/to/galactica/dist/bin.js"
```

Running `init` again updates each file, unless someone edited it. Each file records a hash of what `init` wrote, so `init` keeps an edited file, says so, and replaces it only with `--force`. It exits with code 1 only when it kept every file or could not complete the request. It writes all three files or none.

The skill is also at `skills/galactica/` in this repository, so the [skills CLI](https://github.com/vercel-labs/skills) installs it for any agent it supports, in place of `init`:

```sh
npx --prefix / skills add cognitap/galactica
```

`npx --prefix / skills update` updates it.

## Speed and the cache

The first command in a repository analyzes every file and caches what each file gives on its own. A later command parses only the files that changed. On Radiant, about 500 modules, the first command takes about 0.8 seconds and a later one about 0.1 seconds.

The targets are a first run under 10 seconds on about 3,000 modules, and any command with a warm cache under half a second. On an Apple M1 Pro with Node.js 26, the medians of `overview` over 5 runs are:

| Repository                                              | Modules | First run | Warm   |
| ------------------------------------------------------- | ------- | --------- | ------ |
| Synthetic, `--modules 3000`                             | 3,000   | 2.5 s     | 0.17 s |
| [tldraw](https://github.com/tldraw/tldraw) at `27b47cb` | 2,932   | 3.2 s     | 0.20 s |

The cache is in the user cache folder, under `galactica/` and a hash of the repository's real path: `~/Library/Caches` on macOS, `$XDG_CACHE_HOME` or `~/.cache` on Linux, and `%LOCALAPPDATA%` on Windows. A file whose size and modification time are unchanged is not read again, and a file whose content is unchanged is not parsed again. The whole cache is discarded when Galactica, TypeScript, `vue` or `svelte` changes version, or a compiler is installed or removed.

Everything that depends on more than one file, such as where an import leads, is worked out again unless no input changed, so the cache never gives a stale answer. A change to the config needs no cache action. Deleting the cache is always safe. Earlier versions kept the cache in `node_modules/.cache/galactica`, which you can delete.
