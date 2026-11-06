# Changelog

[Release policy](RELEASE_POLICY.md)

## Unreleased

## 0.2.0

- The HTML map shows each layer as a column of compact area boxes, with the lowest layer on the left. Narrow screens stack layers as rows, with the highest on top.
- Selecting an area lists its modules in a panel and draws lines to the areas it depends on and the areas that depend on it.
- Areas within a layer are ordered so that those lines cross less.
- The data embedded in the map is a third smaller: 400 KB → 270 KB on Radiant.
- The map's script and styles are minified, and the script is an ES module.
- The npm package is smaller: no source maps, and Vue files are read with `@vue/compiler-sfc` alone, without the Vue runtime. The download goes from 170 KB to 115 KB and the install from 47 MB to 40 MB.

## 0.1.6

This release has breaking changes that should have bumped the minor version. From here on, they do.

**Security**

- **Breaking:** The skill, the template and the README run `npx --prefix / @cognitap/galactica`. Plain `npx` inside a repository could run a copy of Galactica that the repository planted in `node_modules`. Run `init` again to update an unedited skill.
- `init` and `html` refuse to write through a symbolic link that the repository controls.
- The cache lives only in the user cache folder, so a repository can't ship a cache that falsifies the map.
- Modules and configs that link outside the repository, aren't regular files, or are over 10 MB are skipped with a warning.
- **Breaking:** Workspace and config globs are matched without backtracking. Extglobs and other unsupported syntax are ignored with a warning; write `{src,scripts}/**` instead of `@(src|scripts)/**`.

**Output**

- **Breaking:** `uses` lists tests closest first and says how each one reaches the subject. Tests that only reach it through a widely imported hub are counted, not listed. `--json` adds `via` and `hub`.
- **Breaking:** `overview` groups unresolved imports by likely cause. `--json` adds the full `unresolvedImports` list. Imports that were previously dropped silently now count as unresolved.
- **Breaking:** Shorter messages: one line for unknown commands, a suggestion for mistyped options, and an explicit message for repositories with no JS or TS modules. The text output no longer suggests a bare `galactica` command.
- **Breaking:** `outline` and `where` name export aliases, and `deps` cuts specifiers off at 120 characters.
- **Breaking:** `health` calls its findings "cross-package private imports"; the JSON field `internalImports` is unchanged.
- `html --json` and `init --json` report what they wrote.
- `uses` says that it only lists tests that import the subject.

**Analysis**

- An import whose names are used only as types no longer counts toward `cycles` and `health`. On Immich, `cycles` went from 6 cycles to 5, and the largest from 89 modules to 4.
- Very deep files and expressions are read in full instead of crashing, so Galactica now maps microsoft/TypeScript.
- More imports resolve:
  - `jsconfig.json` aliases;
  - package `imports` that point at Vue, Svelte and Astro files;
  - declaration-only workspace entries;
  - symlink and letter-case variants of a path.
- More test and fixture folder names are recognized.
- Warm commands and large HTML maps are faster.
- The package ships an npm shrinkwrap that pins the Vue and Svelte compilers.

## 0.1.5

- Add `health`, which lists concrete findings about the structure with no score: each import cycle with the imports to break, each area with at least 20 source modules and 5 times the median area of its package, and each import outside tests and stories that reaches into another workspace package by a relative path or by a subpath its `exports` does not list, with the public specifier to use instead where one exists. It always exits with code 0. On Vitest it finds 4 cycles, 2 oversized areas and 20 such imports.
- The page has a Health section above the map, closed at first, that lists the same findings grouped by kind with a count for each. Choosing a finding selects its module or area on the map, and its line links to the import.
- The agent skill names `health` among the other commands.
- `galactica.config.json` takes `health.areaModules`, a fixed number of source modules above which an area is oversized, in place of the relative rule.

## 0.1.4

- A workspace import resolves through an export condition the repository defines for its own source, such as Vitest's `__vitest_source__` or TanStack Query's `@tanstack/custom-condition`, when the standard conditions reach no module.
- An import of a workspace package that a bundler such as tsup, tsdown, unbuild, Rollup or Vite builds reaches its source: a target such as `dist/node/index.js` or `build/modern/index.js` with no tsconfig `outDir` maps to the same file under `src`. In Vite's repository, the 180 imports of `vite`, 4 of `vite/module-runner` and 8 of `@vitejs/plugin-legacy` that stayed unresolved now reach `packages/vite/src` and `packages/plugin-legacy/src`.

## 0.1.3

- Add `cycles`, which lists each import cycle with its modules in dependency order and every import that closes it, as `path:line` with the names it takes. It marks each import `used at load time` or `used later`, lists cycles with a load-time import first, and marks `break here` on the imports to cut, with the usual fixes.
- `uses` and `deps` end with one line for each import cycle the subject is in, and their `--json` gains a `cycles` field.
- The agent skill tells agents to check that an edit adds no import cycle, and to break an existing one only when asked or when it causes a load-time bug.

## 0.1.2

- An import whose name npm could not publish, such as SvelteKit's `$lib/...` without `.svelte-kit`, or `virtual:` and `astro:` modules a bundler provides, counts as unresolved instead of as an external package with that name.
- `html` prints the path of the page it wrote relative to the current directory, such as `wrote galactica.html (812 KB)`, so its output is the same wherever the repository sits.

## 0.1.1

- `overview` prints how many warnings the analysis has, such as a workspace package without a name, and its `--json` lists them in a new `warnings` field. Each warning is one line, with paths from the repository root.
- A relative import into `node_modules`, such as `../node_modules/@astrojs/starlight/dist/Foo.astro`, counts as an external import of that package instead of being dropped.
- The README says how Nuxt and SvelteKit configs that `nuxi prepare` or `svelte-kit sync` generate affect the map, and its examples match the current output.

## 0.1.0

The first release. Galactica is experimental during `0.x`: a minor version can change the command output, the config or the skill.

- Add `overview`, `where`, `outline`, `uses` and `deps`, which print short text by default and the JSON that `docs/json-output.md` documents with `--json`.
- Add `html`, which writes a self-contained, searchable map of the repository's packages, areas and layers, with links to each module and symbol in the repository host.
- Add `init`, which installs the agent skill for Codex and Claude Code and a rule that points Cursor's agent to it.
- Read JavaScript and TypeScript, including JSX and CommonJS, and the script blocks of Vue, Svelte and Astro files.
- Resolve imports through tsconfig paths, workspace packages and barrel re-exports to the module that defines each name.
- Read optional overrides from `galactica.config.json`, with a JSON Schema in the package.
- Cache what each file gives between runs, and answer an unchanged repository from a cached model.
- Never run code from the repository being mapped.
- Require Node.js 24.1.0 or newer, and say so in one line on an older version.
