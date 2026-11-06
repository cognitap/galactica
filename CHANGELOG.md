# Changelog

[Release policy](RELEASE_POLICY.md)

## Unreleased

- **Breaking, ships in 0.2.0:** the skill that `init` writes, the skill template and the README run Galactica with `npx --prefix / @cognitap/galactica` instead of `npx @cognitap/galactica`. Run inside a repository, plain npx ran a `node_modules/@cognitap/galactica` that the repository holds, even one its `package.json` does not list, and read the repository's `.npmrc`, so a hostile repository could run its own code in place of Galactica. With `--prefix /`, npm ignores both. Run `init` again to update an unedited skill. Before: `npx @cognitap/galactica overview`. After: `npx --prefix / @cognitap/galactica overview`.
- A file nested too deeply for TypeScript to parse, such as a chain of thousands of `else if`, no longer crashes every command. Its module stays, with no symbols or imports, and the analysis adds one warning that names the file.
- A deeply nested expression, such as a 3,000-term string concatenation or the 1,500-term sum in microsoft/TypeScript's `binderBinaryExpressionStress.ts`, is read in full instead of crashing with `RangeError: Maximum call stack size exceeded`. Galactica now maps microsoft/TypeScript.
- A workspace `package.json` whose `exports` nests conditions or fallbacks more than 32 levels deep leaves the import unresolved with a warning, instead of crashing.
- An import that passes through more than 100 barrels points at its first barrel instead of crashing.
- Read JavaScript aliases from `jsconfig.json` when no `tsconfig.json` is present in the same folder.
- Resolve workspace package tsconfig extensions before installing dependencies.
- Suppress TypeScript deprecation and output-layout migration notices that do not affect the map.
- Do not warn when a workspace package exports `./package.json` metadata.
- Recognize `*-spec.*` tests and `__testfixtures__`, `__fixtures__`, `testdata`, `testData`, `fixtures` and `__mocks__` folders as tests, so fixtures no longer shape source layers or count as oversized areas.
- **Breaking:** Match workspace and config globs without backtracking, with documented size and syntax limits. Before, `@(src|scripts)/**` used Node’s matcher; now extglobs, escapes, POSIX named classes and patterns beyond the limits are ignored with a warning. Use `{src,scripts}/**` instead.
- Pin CI and release actions to commit SHAs and reduce the npm publishing job to Node setup, candidate download and publication.
- Ship an npm shrinkwrap with exact versions and integrity hashes for the full Vue and Svelte compiler dependency tree used by npm and npx; verify it from the packed package.
- The HTML map header lists hidden tests, stories and other filtered module kinds beside its visible module count.
- The HTML map fits phone widths, wraps paths at slashes and keeps filenames together when they fit.
- The HTML map opens on the largest source and config package and uses a compact package picker, including in large workspaces.
- **Breaking:** Bound overview layer lists and overview/cycles text at about 6 KB. Before: text listed every area and cycle; after: omitted counts point to the complete `--json` output.
- **Breaking:** Refuse analysis and HTML generation when the root contains `deno.json` or `deno.jsonc`. Before: Deno repositories produced an incomplete map; after: commands exit with code 1 and explain the unsupported workspace and import-map resolution.

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
