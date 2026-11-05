# Galactica

Galactica maps a JavaScript or TypeScript repository, for coding agents and for the people who work with them. Both views come from the same analysis, so they never disagree.

- **For agents:** five commands answer the questions an agent asks while it works, and a skill tells the agent when to ask them.
- **For humans:** one self-contained HTML page shows where everything lives and what it touches.

Galactica is inspired by [codemap](https://github.com/peterretief/codemap), which draws a similar page for Go modules.

## Status

The five agent commands, `html` and `init` work from a checkout. Galactica is not on npm yet. Work is tracked in the Galactica project in Linear.

To run the commands, build Galactica once, then run `dist/cli.js` from the repository you want to map, or pass that repository with `--root`:

```sh
pnpm install
pnpm build
node /path/to/galactica/dist/cli.js overview --root /path/to/repository
```

The first command in a repository analyzes every file and keeps what each file gives on its own in a cache. A later command parses only the files that changed since. On Radiant, about 500 modules, the first command takes about 0.8 seconds and a later one about 0.3 seconds.

## Usage

Galactica needs Node.js 24 or newer. Once it is published, it runs in any repository with no install and no config:

```sh
npx @cognitap/galactica overview
```

| Command          | Answers                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `overview`       | What is in this repository, and how is it layered?                  |
| `where <name>`   | Where is this defined?                                              |
| `outline <file>` | What does this file contain?                                        |
| `uses <file>`    | What depends on this, and which tests should run after I change it? |
| `deps <file>`    | What does this depend on?                                           |
| `html`           | Write the human map as one HTML file.                               |
| `init`           | Install the agent skill into this repository.                       |

Every command except `html` and `init` prints short text by default and structured output with `--json`. The [JSON output reference](docs/json-output.md) documents the fields. A subject is a module path, a package name, a package directory or an area path. `uses` and `deps` follow `--depth` import steps, 1 by default, and `overview --all` ranks every module instead of the top five of each area. A command that cannot answer prints one line to stderr and exits with code 1.

`uses` lists what imports a file, with the names each direct dependent takes, and every test that reaches it at any distance. On Radiant:

```text
$ galactica uses src/components/Kbd/Kbd.tsx
src/components/Kbd/Kbd.tsx (module): 7 dependents within depth 1, 6 tests
1  .storybook/examples/CommandExamples.tsx  Kbd, KbdGroup
1  .storybook/examples/InputGroupExamples.tsx  Kbd, KbdGroup
1  .storybook/examples/KbdExamples.tsx  Kbd, KbdGroup, KbdProps
1  src/components/Command/Command.tsx  Kbd, KbdGroup
1  src/components/Kbd/Kbd.stories.tsx  Kbd
1  src/index.ts  Kbd, KbdGroup, KbdGroupProps, KbdProps
1  src/recipes/ThemeShowcase.stories.tsx  Kbd, KbdGroup
tests:
1  tests/browser/InputGroup.test.tsx  Kbd
1  tests/browser/Kbd.test.tsx  Kbd, KbdGroup
2  tests/browser/Command.test.tsx
2  tests/browser/DataSlot.test.tsx
2  tests/browser/DisclosureTriggerState.test.tsx
3  tests/browser/EmptyState.test.tsx
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

`html` writes the map for people to `galactica.html` in the current directory, or to the file `--out` names, and prints the path and size. `--open` opens the file in the default browser. The page is one file that loads nothing from the network, so it opens from disk and can be shared as an attachment. Each package is a section, highest in the dependency order first. Inside it, each area is a box in a row by layer: the bottom row imports no other area, and each row above imports only from rows below, except areas marked as a cycle. A box is wider when its modules export more symbols, and its colour marks its top-level folder. Each module expands to list its exported symbols with their signatures and docs. Tests and stories are hidden until you show them. On Radiant, the page is about 440 KB and takes under a second to write.

The search field finds areas, modules and exported symbols as you type. Press `/` to focus it, the arrow keys to move through the matches, Enter to go to one and Escape to close the list or clear the field. Exact matches come first, then names that start with what you typed, then names that contain it. Going to a symbol opens its module.

Select a box title, or the circle at the end of a module's row, to see what it uses and what uses it. The page marks its dependencies and its dependents and dims everything else, and a bar at the top gives the counts, the same that `deps` and `uses` give at depth 1, with every test that reaches it while tests are shown. Press Escape or Clear to end the selection. The selection is kept in the address, as `#module=src%2Fcn.ts` or `#area=src%2Fcomponents`, so a link opens the map on the same view.

Each module path and each symbol's line is a link to that file and line in the repository host, at the newest commit the remote is known to have, and opens in a new tab. Galactica reads the `origin` remote, or the first remote by name when there is none, and links to `HEAD` when a remote-tracking ref contains it. Otherwise it links to the merge base of `HEAD` with the branch's upstream, else with `<remote>/HEAD`, `<remote>/main` or `<remote>/master`, using only local refs and never fetching, so fetch first to link to a newer commit. The map is built from the working tree, so a symbol whose file changed after the linked commit may link to a slightly different line. It recognises GitHub remotes in the `https://`, `git@github.com:` and `ssh://` forms. A repository whose root is a folder of a larger repository links through that folder. If the map includes unpushed commits or changes to tracked files, the page header says which commit its links point to and what the map includes beyond it. Without git, a commit, or a GitHub remote, the page shows plain paths. The links are built by the page script from one `source` entry in the embedded data, so the page still loads nothing from the network.

`--source-url <template>` sets the link for another host, with `{commit}`, `{path}` and `{line}` in place, for example GitLab:

```sh
galactica html --source-url 'https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}'
```

The template must start with `http://` or `https://` and contain `{path}`. Each segment of the path is percent-encoded. A link to a module has no line, so the template loses its `#...{line}` fragment. `--source-url none` turns links off.

`init` installs the agent skill in `.agents/skills/galactica/`, which Codex and Cursor read, and in `.claude/skills/galactica/`, which Claude Code reads. It writes those two files and nothing else, and prints each path with whether it was created, updated or unchanged. The skill tells an agent to run `overview` when it starts in an unfamiliar repository, `where` instead of grep, and `uses` before it edits a file, then the tests `uses` lists.

The skill runs `npx @cognitap/galactica` by default. Until Galactica is on npm, pass the command for your checkout:

```sh
node /path/to/galactica/dist/cli.js init --command "node /path/to/galactica/dist/cli.js"
```

Running `init` again updates a skill file to the current version, unless someone edited it. Each file records a hash of what `init` wrote, so `init` keeps an edited file, says so, and replaces it only with `--force`. It exits with code 1 only when it kept every file. The skill is also at `skills/galactica/` in this repository, where the [skills CLI](https://github.com/vercel-labs/skills) finds it.

Galactica keeps the symbols and imports of each file in a cache, so it adds nothing to the repository except the optional skill. The cache is `node_modules/.cache/galactica/cache.json` when the repository has a `node_modules` folder. Otherwise it is in the user cache folder, under `galactica/` and a hash of the repository path: `~/Library/Caches` on macOS, `$XDG_CACHE_HOME` or `~/.cache` on Linux, and `%LOCALAPPDATA%` on Windows. A file whose size and modification time are unchanged is not read again, and a file whose content is unchanged is not parsed again. A Vue or Svelte file is parsed again when the version of its compiler changes, or the compiler is installed or removed. Everything that depends on more than one file, such as where an import leads, is worked out again on every run, so the cache never gives a stale answer. Deleting the cache is always safe. `--no-cache` analyzes every file and neither reads nor writes the cache.

## Configuration

Galactica needs no config. To override a default, add `galactica.config.json` to the repository root, the directory that `--root` names. Every option is optional:

```json
{
  "$schema": "./node_modules/@cognitap/galactica/schema/galactica.config.schema.json",
  "include": ["src/**", "scripts/**"],
  "exclude": ["src/generated/**"],
  "kinds": { "story": [".storybook/examples/**"] },
  "areas": { "src/components/**": "src/components" },
  "sourceUrl": "https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}"
}
```

- `include` lists globs. Galactica maps a module only when its path matches one of them. Without `include`, it maps every module.
- `exclude` lists globs of modules to leave out, including modules that `include` matches.
- `kinds` maps a kind, `source`, `test`, `story` or `config`, to globs. A module that matches them has that kind, whatever its name and folder say. A module can match the globs of one kind only.
- `areas` maps a glob to an area path. A module that matches the glob is in that area instead of its folder's area. When a module matches several globs, the first in the file decides. The area path must be inside the module's package. Layers, cycles and the page treat these areas like any other.
- `sourceUrl` is the link template that `html --source-url` takes, `none` included. `--source-url` wins over it.

A glob matches the path from the repository root, with forward slashes, as Node.js `path.matchesGlob` does. `*` matches within one folder and `**` matches any number of folders, but neither matches a name that starts with a dot, so `**/*.tsx` misses `.storybook/preview.tsx` and `.storybook/**` finds it. `include` and `exclude` only narrow the files Galactica already reads. They never add a file that git ignores or a file in `node_modules`, `dist` or another build folder. An import of a module that the config leaves out gets no edge.

Radiant keeps demo components in `.storybook/examples/`. By default, a module in a folder whose name starts with a dot is a `config` module, so these 54 modules count as code and shape the layers: `src/recipes`, whose stories import them, sits in layer 9. This config makes them stories, and `src/recipes` drops to layer 6:

```json
{ "kinds": { "story": [".storybook/examples/**"] } }
```

`$schema` points an editor at `schema/galactica.config.schema.json`, which ships in the package, for completion and checks. Galactica ignores it. When the config is not valid, every command exits with code 1 and prints one line that names the key:

```text
galactica: galactica.config.json: kinds.storyy: unknown kind; expected source, test, story or config
```

A change to the config needs no cache action. The cache holds only what each file gives on its own, so no entry depends on the config. A module that the config leaves out is not read, and a later run parses it again when the config brings it back.

## What it reads

- JavaScript and TypeScript, including JSX and CommonJS.
- Vue, Svelte and Astro files. Each one exports its component, named after the file. Galactica reads the imports and exports of a Vue file's `<script>` and `<script setup>`, and of a Svelte file's instance and module scripts, with the compiler the repository already installs: `vue/compiler-sfc` or `svelte/compiler`, from the package that has the file, or else from the repository root. Only `<script>` and a Svelte module script can export. A file whose compiler is missing, or fails on it, keeps its component and has no imports. Galactica reads an Astro file's frontmatter as text, with no compiler, and not the `<script>` tags in its body.
- Monorepos, with each workspace package as the top level of the map.

## Performance

The targets are a first run under 10 seconds on a repository of about 3,000 modules, and any command with a warm cache under half a second. `pnpm bench` measures both:

```sh
node scripts/synthetic-repo.ts /tmp/synthetic --modules 3000
pnpm bench /tmp/synthetic
```

It runs the built CLI as a child process for `overview` and for `uses` of the source module with the most importers, first with the cache deleted and then with the cache warm. It prints the median and range of 5 runs, and the time of each phase. `--runs` sets the number of runs, `--uses` the module, `--json` prints the result as JSON, and `--check` exits with code 1 when a median misses its target. `scripts/synthetic-repo.ts` writes a pnpm workspace shaped like Radiant, and the same options always give the same files. The Benchmark job in CI runs `pnpm bench --check` on 3,000 synthetic modules and writes the table to the job summary.

On an Apple M1 Pro with Node.js 26, a first run meets its target and a warm run does not yet. These are the medians of `overview` over two sets of 5 runs, and `uses` is within 0.2 seconds of them:

| Repository                                              | Modules | First run    | Warm   |
| ------------------------------------------------------- | ------- | ------------ | ------ |
| Synthetic, `--modules 3000`                             | 3,000   | 2.4 s        | 0.87 s |
| [tldraw](https://github.com/tldraw/tldraw) at `27b47cb` | 2,932   | 3.6 to 3.8 s | 1.6 s  |

A first run here starts with the files already in the operating system's file cache. A warm run spends most of its time in discovery, which parses every `tsconfig.json`, and in import resolution. Both run on every command.
