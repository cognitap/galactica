# Galactica

Galactica maps a JavaScript or TypeScript repository, for coding agents and for the people who work with them. Both views come from the same analysis, so they never disagree.

- **For agents:** seven commands answer the questions an agent asks while it works, and a skill tells the agent when to ask them.
- **For humans:** one self-contained HTML page shows where everything lives and what it touches.

Galactica is inspired by [codemap](https://github.com/peterretief/codemap), which draws a similar page for Go modules.

## Installation

Galactica needs Node.js 24.1.0 or newer. It runs in any repository with no install and no config:

```sh
npx --prefix / @cognitap/galactica overview
```

Keep `--prefix /`. Without it, npx run inside a repository runs the copy of `@cognitap/galactica` in that repository's `node_modules`, even one that `package.json` does not list, and reads the repository's `.npmrc`. [What it reads](#what-it-reads) says what `--prefix /` guarantees.

To pin a version for a team, install it as a dev dependency and run it through the package manager, for example `pnpm add -D @cognitap/galactica` and `pnpm exec galactica overview`.

Galactica is experimental while its version is `0.x`: a minor version can change the command output, the config or the skill. The [changelog](CHANGELOG.md) marks each breaking change, and the [release policy](RELEASE_POLICY.md) says what the public contract covers.

## Usage

Run each command from the repository you want to map, or pass that repository with `--root`. The first command in a repository analyzes every file and keeps what each file gives on its own in a cache. A later command parses only the files that changed since. On Radiant, about 500 modules, the first command takes about 0.8 seconds and a later one about 0.1 seconds.

The examples below write `galactica` for `npx --prefix / @cognitap/galactica`.

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

Every command except `html` and `init` prints short text by default and structured output with `--json`. The [JSON output reference](docs/json-output.md) documents the fields. A subject is a module path, a package name, a package directory or an area path. `uses` and `deps` follow `--depth` import steps, 1 by default, and `overview --all` ranks every module instead of the top five of each area. `overview` also counts the warnings of the analysis, such as a workspace package without a name, which it skips, or a `tsconfig.json` it cannot read, and its `--json` lists them. A command that cannot answer prints one line to stderr and exits with code 1.

These options apply across commands:

| Option          | Effect                                                            |
| --------------- | ----------------------------------------------------------------- |
| `--root <dir>`  | Use this repository instead of the current directory.             |
| `--json`        | Print the JSON object instead of text. Not for `html` and `init`. |
| `--no-cache`    | Analyze every file, and neither read nor write the cache.         |
| `--depth <n>`   | How many import steps `uses` and `deps` follow. 1 by default.     |
| `--all`         | List every module of each area in `overview`, not the top five.   |
| `-h, --help`    | Print every command and option.                                   |
| `-v, --version` | Print the version.                                                |

`html` and `init` take the options described in their sections below.

`uses` lists what imports a file, with the names each direct dependent takes, and every test that imports it at any distance, closest first. A test that imports it through other modules names the module its path starts from. Tests that reach it only through a hub, a module that much of the repository imports, are counted per hub rather than listed. Only tests that import the file are listed, so an end-to-end, playground or fixture-driven test that loads it another way can be missing. On Radiant:

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
1  tests/package/kbd-types.tsx  Kbd, KbdGroup, KbdGroupProps, KbdProps
1  tests/package/kbd.test.ts  Kbd, KbdGroup
2  tests/browser/Command.test.tsx  via .storybook/examples/CommandExamples.tsx
2  tests/browser/DataSlot.test.tsx  via src/components/Command/Command.tsx
2  tests/browser/DisclosureTriggerState.test.tsx  via src/components/Command/Command.tsx
2  tests/package/charts.test.ts  via src/index.ts
2  tests/package/command-types.tsx  via src/components/Command/Command.tsx
2  tests/package/command.test.ts  via src/components/Command/Command.tsx
2  tests/package/context-menu.test.ts  via src/index.ts
2  tests/package/empty-state.test.ts  via src/components/Command/Command.tsx
2  tests/package/menu-features.test.ts  via src/index.ts
2  tests/package/menubar.test.ts  via src/index.ts
2  tests/package/multi-select-tags-input.test.ts  via src/index.ts
2  tests/package/otp-field.test.ts  via src/index.ts
2  tests/package/package.test.ts  via src/index.ts
2  tests/package/theme-definition.test.ts  via src/index.ts
2  tests/package/types.tsx  via src/index.ts
3  tests/browser/EmptyState.test.tsx  via src/components/Command/Command.tsx
Lists only tests that import the subject, directly or through other modules. End-to-end, playground and fixture-driven tests that load it another way, such as through a dev server, a build or a config file, can be missing, so also search for tests named after the feature.
```

`deps` lists what a file or area imports, inside the workspace and outside it:

```text
$ galactica deps src/cn.ts
src/cn.ts (module): 1 dependency within depth 1, 1 external package, 0 unresolved imports
1  src/themes/tokens.ts  typographyRoles
packages: none
external: cn
unresolved: none
```

`cycles` lists each import cycle among the modules that run, with its modules in dependency order and every import between them. Each import is marked `used at load time` when the importer reads the name in top-level code, which can fail while the cycle loads, or `used later` when only functions read it. Cycles with a load-time import come first. `break here` marks the imports that point back up the order: cutting all of them ends the cycle, and the order keeps load-time imports and cuts the fewest names it can. `uses` and `deps` end with a line for each cycle the subject is in. On [Vite](https://github.com/vitejs/vite) at `4835128`:

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
cycle 8: 2 modules, used later, in dependency order:
  packages/vite/src/node/packages.ts
  packages/vite/src/node/utils.ts
imports (1 to break):
  packages/vite/src/node/utils.ts:48 -> packages/vite/src/node/packages.ts  PackageCache, findNearestPackageData  used later  break here
  packages/vite/src/node/packages.ts:13 -> packages/vite/src/node/utils.ts  createFilter, isInNodeModules, normalizePath, safeRealpathSync, stripBomTag, tryStatSync  used later
…
```

`health` lists concrete findings about the structure, with no score: every import cycle, as `cycles` lists it with the imports to break; each area that is far larger than the rest of its package; and each import in code other than tests and stories that reaches into another workspace package's internals. An area is oversized when it holds at least 20 source modules, tests, stories and config aside, and at least 5 times the median of its package's areas. `health.areaModules` in the config replaces that rule with a fixed number. An import reaches into another package when it is a relative path into that package's directory, or names a subpath of the package that its `exports` does not list. Each such import shows the specifier to change and, where one exists, the public specifier that gives the same import: the package name or an exported subpath that reaches the same module or exports the same names. `health` always exits with code 0. On [Vitest](https://github.com/vitest-dev/vitest) at `71ad4df`:

```text
$ galactica health
4 import cycles, 2 oversized areas, 20 internal imports
…
oversized areas (at least 20 source modules and 5 times the median area of their package):
  packages/browser/src/client/tester/expect  28 source modules, package median 3.5
  packages/vitest/src/node  31 source modules, package median 5.5
imports into another package's internals:
…
  packages/browser/src/client/orchestrator.ts:16  ../../../vitest/src/utils/tasks.js  generateFileHash  relative path into vitest  use vitest/node
  packages/browser/src/client/tester/runner.ts:30  ../../../../utils/src/source-map  createStackString, parseStacktrace  relative path into @vitest/utils  use @vitest/utils/source-map
  packages/browser/src/client/tester/runner.ts:31  ../../../../vitest/src/utils/tasks  getTestName  relative path into vitest  no public entry gives it
…
```

`html` writes the map for people to `galactica.html` in the current directory, or to the file `--out` names, and prints the path and size. It refuses, with one line and exit code 1, to write the page through a symbolic link: the file itself, or a folder inside the repository above it, may not be one. `--open` opens the file in the default browser. The page is one file that loads nothing from the network, so it opens from disk and can be shared as an attachment. Each package is a section, largest first by its source and config modules; a compact package picker jumps between them. Inside it, each area is a box in a row by layer: the bottom row imports no other area, and each row above imports only from rows below, except areas marked as a cycle. A box is wider when its modules export more symbols, and its colour marks its top-level folder. An area of more than eight modules starts collapsed to its counts, and its module count expands it. Each module expands to list its exported symbols with their signatures and docs. The Show buttons filter the map by kind: source and config modules show at first, and tests and stories stay hidden until you show them. The header counts the visible modules and lists the hidden modules by kind. A module's kind comes from its name and folder, or from `kinds` in the config. Search still finds what the filter hides, marks it, and shows its kind when you choose it. To leave generated files out of the map, list them in `exclude`. On Radiant, the page is about 440 KB and takes under a second to write.

The search field finds areas, modules and exported symbols as you type. Press `/` to focus it, the arrow keys to move through the matches, Enter to go to one and Escape to close the list or clear the field. Exact matches come first, then names that start with what you typed, then names that contain it. Going to a symbol opens its module.

Above the map, a Health section lists what `health` finds, grouped by kind with a count for each: import cycles with the imports to break, oversized areas, and imports into another package's internals with the specifier to use instead. It starts closed, and its heading opens it. Each finding names a module or an area: choosing it selects that module or area on the map, as search does, and its line links to the import in the repository.

Select a box title, or the circle at the end of a module's row, to see what it uses and what uses it. The page marks its dependencies and its dependents and dims everything else, and a bar at the top gives the counts, the same that `deps` and `uses` give at depth 1, with every test that reaches it while tests are shown, and how many of the modules it relates to the filter hides, by kind. Press Escape or Clear to end the selection. The selection is kept in the address, as `#module=src%2Fcn.ts` or `#area=src%2Fcomponents`, so a link opens the map on the same view.

Each module path and each symbol's line is a link to that file and line in the repository host, at the newest commit the remote is known to have, and opens in a new tab. Galactica reads the `origin` remote, or the first remote by name when there is none, and links to `HEAD` when a remote-tracking ref contains it. Otherwise it links to the merge base of `HEAD` with the branch's upstream, else with `<remote>/HEAD`, `<remote>/main` or `<remote>/master`, using only local refs and never fetching, so fetch first to link to a newer commit. The map is built from the working tree, so a symbol whose file changed after the linked commit may link to a slightly different line. It recognises GitHub remotes in the `https://`, `git@github.com:` and `ssh://` forms. A repository whose root is a folder of a larger repository links through that folder. If the map includes unpushed commits or changes to tracked files, the page header says which commit its links point to and what the map includes beyond it. Without git, a commit, or a GitHub remote, the page shows plain paths. The links are built by the page script from one `source` entry in the embedded data, so the page still loads nothing from the network.

`--source-url <template>` sets the link for another host, with `{commit}`, `{path}` and `{line}` in place, for example GitLab:

```sh
galactica html --source-url 'https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}'
```

The template must start with `http://` or `https://` and contain `{path}`. Each segment of the path is percent-encoded. A link to a module has no line, so the template loses its `#...{line}` fragment. `--source-url none` turns links off.

`init` installs the agent skill in `.agents/skills/galactica/`, which Codex reads, and in `.claude/skills/galactica/`, which Claude Code reads. Cursor's agent did not open the skill from either folder in testing, so `init` also writes the rule `.cursor/rules/galactica.mdc`, which Cursor requests by the skill's description and which sends it to the skill. It writes those three files and nothing else, and prints each path with whether it was created, updated or unchanged. The skill tells an agent to run `overview` when it starts in an unfamiliar repository, `where` instead of grep, and `uses` before it edits a file, then the tests `uses` lists. It also tells the agent to check that an edit adds no import cycle, and to break an existing one only when asked or when it causes a load-time bug.

The skill runs `npx --prefix / @cognitap/galactica` by default. `--command` sets the command it runs instead, for example when Galactica is a dev dependency of a repository you trust, or a build from a checkout:

```sh
npx --prefix / @cognitap/galactica init --command "pnpm exec galactica"
node /path/to/galactica/dist/bin.js init --command "node /path/to/galactica/dist/bin.js"
```

Running `init` again updates each file to the current version, unless someone edited it. Each file records a hash of what `init` wrote, so `init` keeps an edited file, says so, and replaces it only with `--force`. It exits with code 1 only when it kept every file. When any of the three paths, or a folder above it inside the repository such as a `.claude` linked to `~/.claude`, is a symbolic link, `init` refuses in one line, writes nothing and exits with code 1. It writes all three files or none. The skill is also at `skills/galactica/` in this repository, so the [skills CLI](https://github.com/vercel-labs/skills) installs it for any agent it supports, in place of `init`:

```sh
npx --prefix / skills add cognitap/galactica
```

`--prefix /` keeps npm from running a `skills` package planted in the repository you are in. A skill installed this way runs `npx --prefix / @cognitap/galactica`, and `npx --prefix / skills update` updates it.

Galactica keeps the symbols and imports of each file, and the model built from them, in a cache, so it adds nothing to the repository except the optional skill. The cache is in the user cache folder, under `galactica/` and a hash of the repository's real path: `~/Library/Caches` on macOS, `$XDG_CACHE_HOME` or `~/.cache` on Linux, and `%LOCALAPPDATA%` on Windows. Galactica never reads a cache from the repository, so a repository cannot ship a cache that changes what Galactica reports. It creates the folder readable by you alone, and runs with no cache when that folder is a symlink, belongs to another user or lies inside the repository, or when there is no home folder. Earlier versions kept the cache in `node_modules/.cache/galactica`, which you can delete. A file whose size and modification time are unchanged is not read again, and a file whose content is unchanged is not parsed again. The whole cache is discarded when Galactica, TypeScript, `vue` or `svelte` changes version, or a compiler is installed or removed. Everything that depends on more than one file, such as where an import leads, is worked out again on every run, so the cache never gives a stale answer. Deleting the cache is always safe. `--no-cache` analyzes every file and neither reads nor writes the cache.

## Configuration

Galactica needs no config. To override a default, add `galactica.config.json` to the repository root, the directory that `--root` names. Every option is optional:

```json
{
  "$schema": "./node_modules/@cognitap/galactica/schema/galactica.config.schema.json",
  "include": ["src/**", "scripts/**"],
  "exclude": ["src/generated/**"],
  "kinds": { "source": ["docs/.vitepress/theme/**"] },
  "areas": { "src/components/**": "src/components" },
  "sourceUrl": "https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}",
  "health": { "areaModules": 40 }
}
```

- `include` lists globs. Galactica maps a module only when its path matches one of them. Without `include`, it maps every module.
- `exclude` lists globs of modules to leave out, including modules that `include` matches.
- `kinds` maps a kind, `source`, `test`, `story` or `config`, to globs. A module that matches them has that kind, whatever its name and folder say. A module can match the globs of one kind only.
- `areas` maps a glob to an area path. A module that matches the glob is in that area instead of its folder's area. When a module matches several globs, the first in the file decides. The area path must be inside the module's package. Layers, cycles and the page treat these areas like any other.
- `sourceUrl` is the link template that `html --source-url` takes, `none` included. `--source-url` wins over it.
- `health.areaModules` is a whole number. With it, `health` and the page call an area oversized when it holds more source modules than this number, in place of the rule relative to its package.

A glob matches the path from the repository root, with forward slashes. It supports `*`, `**`, `?`, character classes such as `[ab]` and `[!a]`, brace alternatives such as `{src,scripts}/**`, and integer ranges such as `{1..3}`. Matching takes linear time in the path length, with at most 1,024 pattern tokens. Patterns longer than 1,024 characters, brace expansion beyond 64 alternatives or 1,024 tokens, extglobs such as `@(src|scripts)`, escapes and POSIX named character classes are ignored with a warning. These limits also apply to workspace patterns. `*` matches within one folder and `**` matches any number of folders, but neither matches a name that starts with a dot, so `**/*.tsx` misses `.storybook/preview.tsx` and `.storybook/**` finds it. `include` and `exclude` only narrow the files Galactica already reads. They never add a file that git ignores or a file in `node_modules`, `dist` or another build folder. An import of source that the config leaves out is counted as unresolved.

Names ending in `-spec` before their extension, such as `app.e2e-spec.ts`, are tests, as are modules under `__tests__`, `test`, `tests`, `__testfixtures__`, `__fixtures__`, `testdata`, `testData`, `fixtures` or `__mocks__`. Tests and fixtures do not shape source layers or count toward oversized areas.

By default, a module in a folder whose name starts with a dot is a `config` module, such as `.storybook/main.ts` or `.github/scripts/release.mjs`. The subfolders of `.storybook` are the exception: they hold what stories render, such as Radiant's demo components in `.storybook/examples/`, so their modules are stories. Vite keeps the components of its documentation site in `docs/.vitepress/theme/`, where they are `config` modules by default. This config makes them source:

```json
{ "kinds": { "source": ["docs/.vitepress/theme/**"] } }
```

`$schema` points an editor at `schema/galactica.config.schema.json`, which ships in the package, for completion and checks. Galactica ignores it. When the config is not valid, every command exits with code 1 and prints one line that names the key:

```text
galactica: galactica.config.json: kinds.storyy: unknown kind; expected source, test, story or config
```

A change to the config needs no cache action. The cache holds only what each file gives on its own, so no entry depends on the config. A module that the config leaves out is not read, and a later run parses it again when the config brings it back.

## What it reads

- JavaScript and TypeScript, including JSX and CommonJS.
- Vue, Svelte and Astro files. Each one exports its component, named after the file. Galactica reads the imports and exports of a Vue file's `<script>` and `<script setup>`, and of a Svelte file's instance and module scripts, with Galactica's own `vue/compiler-sfc` and `svelte/compiler`, which it installs as optional dependencies. It reads Vue 2 components and Svelte 4 syntax too, since it reads only the script blocks. Only `<script>` and a Svelte module script can export. A file whose compiler is missing, because Galactica was installed with `--omit=optional`, or fails on it, keeps its component and has no imports. Galactica reads an Astro file's frontmatter as text, with no compiler, and not the `<script>` tags in its body.
- Monorepos, with each workspace package as the top level of the map.

Deno repositories are not supported. When the root contains `deno.json` or `deno.jsonc`, analysis commands and `html` exit with code 1 and explain the limitation. Deno workspaces, import maps and `jsr:`, `npm:` and URL imports require resolution that Galactica does not implement.

Private `#` specifiers in a package's `imports` map resolve to its script and framework files. Extensionless script targets work with bundler resolution, including when an unavailable generated config leaves the resolution mode unset. Galactica uses the nearest package scope, so a child package does not inherit its parent's private mappings.

An import of a workspace package reaches the package's source, never its build output, which a fresh clone does not have. Galactica follows the package's `exports`, or its `types`, `module` and `main` when it has no `exports`. A condition the repository defines for its own source, such as Vitest's `__vitest_source__`, counts when the standard conditions reach no module. A target in a tsconfig `outDir` maps back to that config's `rootDir`. A target in `dist`, `build`, `lib`, `out`, `esm` or `cjs` that no tsconfig builds is taken as bundler output and maps to the same path under `src`, first as it is and then without each format folder such as `esm`, `modern` or `node`. So `dist/node/index.js` reaches `src/node/index.ts` and `build/modern/index.js` reaches `src/index.ts`. A bundle of the package root named after the package, as Rollup names one, such as `dist/compiler-sfc.cjs.js`, reaches `src/index`. Galactica neither runs nor reads the bundler config. Existing JSON, metadata, styles and declaration files count as files without a module edge; source is preferred when available. When no source or known non-module file exists, the import stays unresolved. To name a source that differs, add a `source` condition to the export, which Galactica prefers to all others.

Nuxt and SvelteKit generate the tsconfig files that a project's own `tsconfig.json` extends, `.nuxt/tsconfig*.json` and `.svelte-kit/tsconfig.json`, and git ignores them. Until `nuxi prepare` or `svelte-kit sync` has run in the clone, Galactica cannot read the aliases those files declare, such as Nuxt's `#imports` or SvelteKit's `$lib`, so imports through them reach no module, and `overview` counts a warning for each config it cannot read. On elk, a Nuxt app, 40 imports stay unresolved. Nuxt also imports components and composables with no import statement, so those dependencies have no edge, and 51 of elk's 61 root areas sit in layer 0. Galactica runs neither command, since both run code from the repository. Run it yourself first when you trust that code.

Imports through symlinks or a different letter case reach the discovered source module when the filesystem resolves that spelling. Known data assets and declarations create no code dependency; other files and source omitted from the map count as unresolved. A missing `paths` target falls back to the npm package name when the specifier can name one.

Galactica never runs code from the repository it maps, so it is safe to run on a repository you just cloned or downloaded when you start it with `npx --prefix / @cognitap/galactica`, or from a copy installed outside that repository. With `--prefix /`, npm looks for installed packages and a project `.npmrc` in `/` instead of the repository. It takes Galactica from its cache or from the registry in your own npm config, and never runs a `node_modules/@cognitap/galactica` or `node_modules/.bin/galactica` that the repository holds, listed in its `package.json` or not. `tests/npx-shadow.test.ts` checks this against a repository that plants both and an `.npmrc` naming another registry. Plain `npx @cognitap/galactica` run inside the repository has no such guarantee, and neither has a command set with `init --command`, such as `pnpm exec galactica`, which runs the repository's own install.

Galactica itself loads no module from the repository's `node_modules`. It runs git with `core.fsmonitor`, optional index writes and the filter drivers of the repository's own config turned off, so a `.git` folder that came with a download cannot make git run a program. A tool that acts on a file in the repository before Galactica starts, such as a version manager that reads `.nvmrc` or `.tool-versions` and switches Node.js or npm, is outside this guarantee.

## Performance

The targets are a first run under 10 seconds on a repository of about 3,000 modules, and any command with a warm cache under half a second. `pnpm bench` measures both:

```sh
node scripts/synthetic-repo.ts /tmp/synthetic --modules 3000
pnpm bench /tmp/synthetic
```

It runs the built CLI as a child process for `overview` and for `uses` of the source module with the most importers, first with the cache deleted and then with the cache warm. It prints the median and range of 5 runs, and the time of each phase. `--runs` sets the number of runs, `--uses` the module, `--json` prints the result as JSON, and `--check` exits with code 1 when a median misses its target. `scripts/synthetic-repo.ts` writes a pnpm workspace shaped like Radiant, and the same options always give the same files. The Benchmark job in CI runs `pnpm bench --check` on 3,000 synthetic modules, writes the table to the job summary and fails when a median misses its target.

On an Apple M1 Pro with Node.js 26, both targets hold. These are the medians of `overview` over 5 runs, and `uses` is within 0.1 seconds of them:

| Repository                                              | Modules | First run | Warm   |
| ------------------------------------------------------- | ------- | --------- | ------ |
| Synthetic, `--modules 3000`                             | 3,000   | 2.5 s     | 0.17 s |
| [tldraw](https://github.com/tldraw/tldraw) at `27b47cb` | 2,932   | 3.2 s     | 0.20 s |

A first run here starts with the files already in the operating system's file cache, and spends most of its time parsing modules. A warm run answers from the cached model: it stats every file and directory the last full analysis depended on, compares git's file listing, and reuses the model when nothing changed, without loading TypeScript. Of its 0.2 seconds, Node.js startup takes about 30 ms, the checks and the model 60 to 90 ms, and the graph 40 to 60 ms. A command after a change runs the full analysis again, apart from the parse of unchanged modules, and discovery and import resolution dominate it.

## Development

Build Galactica from a checkout, then run `dist/bin.js` where you would run `galactica`:

```sh
pnpm install
pnpm build
node /path/to/galactica/dist/bin.js overview --root /path/to/repository
```

`pnpm check` runs format, lint, typecheck and the tests, and then installs the packed package in a throwaway repository and runs it there. [RELEASE_POLICY.md](RELEASE_POLICY.md) describes how a version is released.

`pnpm test:coverage` builds and runs the existing Node test suite with coverage. It fails below aggregate floors of 90% lines, 85% branches and 90% functions. CI runs this through `pnpm check` and uploads `coverage/`, including when a floor fails. The directory contains an HTML report (`coverage/lcov-report/index.html`), LCOV and a JSON summary.

Coverage includes every production TypeScript module under `src/`, even modules no test loads, and the pure page helpers `search.js`, `links.js` and `indexes.js`. Build source maps merge CLI subprocess coverage from `dist/` into the same source files, so each module is counted once. Tests, fixtures, dependencies and build copies of the plain page scripts are outside the report. The browser-executed `src/page/page.js` is also outside this Node percentage; `tests/page.test.ts` checks its behavior in Chrome.

`pnpm test:browser` builds and runs the HTML map tests in headless Chrome. Install Google Chrome in its usual location, or set `CHROME_PATH` to the absolute path of its executable. An explicit `CHROME_PATH` takes precedence over automatic discovery. Local runs without Chrome show a skip reason; when `CI` is set, missing Chrome fails the suite. The main CI check verifies Chrome and supplies its path before running `pnpm check`.
