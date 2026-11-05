# Changelog

[Release policy](RELEASE_POLICY.md)

## Unreleased

- Add `cycles`, which lists each import cycle with its modules in dependency order and every import that closes it, as `path:line` with the names it takes. It marks each import `used at load time` or `used later`, lists cycles with a load-time import first, and marks `break here` on the imports to cut, with the usual fixes.
- `uses` and `deps` end with one line for each import cycle the subject is in, and their `--json` gains a `cycles` field.

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
