# How it reads a repository

[README](../README.md) · [Commands](commands.md) · [Configuration](configuration.md) · **How it reads a repository** · [Security](security.md) · [JSON output](json-output.md)

Galactica reads source statically with the TypeScript compiler API. It never runs the repository's code, a bundler config or a framework's generator. This page says what it reads and where static reading stops.

## Languages and frameworks

- JavaScript and TypeScript, including JSX and CommonJS.
- Vue, Svelte and Astro files. Each one exports its component, named after the file.
  - Galactica reads the imports and exports of a Vue file's `<script>` and `<script setup>`, and of a Svelte file's instance and module scripts. It uses its own `@vue/compiler-sfc` and `svelte/compiler`, installed as optional dependencies. Because it reads only script blocks, Vue 2 components and Svelte 4 syntax work too. Only `<script>` and a Svelte module script can export.
  - A file whose compiler is missing, because Galactica was installed with `--omit=optional`, or fails on it, keeps its component and has no imports.
  - An Astro file's frontmatter is read as text, with no compiler. The `<script>` tags in its body are not read.

Impact follows imports between files. For symbol-level references and refactoring, use a language service.

## Monorepos

Each workspace package, from `pnpm-workspace.yaml` or the root `package.json` `workspaces`, is the top level of the map. A single-package repository has one package.

An import of a workspace package reaches the package's source, never its build output, which a fresh clone does not have:

- Galactica follows the package's `exports`, or its `types`, `module` and `main` when it has no `exports`. A `source` condition wins over all others, so add one when the source differs from what the other conditions name.
- A condition the repository defines for its own source, such as Vitest's `__vitest_source__`, counts when the standard conditions reach no module.
- A target in a tsconfig `outDir` maps back to that config's `rootDir`.
- A target in `dist`, `build`, `lib`, `out`, `esm` or `cjs` that no tsconfig builds is taken as bundler output. It maps to the same path under `src`, first as it is and then without each format folder such as `esm`, `modern` or `node`. So `dist/node/index.js` reaches `src/node/index.ts` and `build/modern/index.js` reaches `src/index.ts`.
- A bundle of the package root named after the package, as Rollup names one, such as `dist/compiler-sfc.cjs.js`, reaches `src/index`.

Existing JSON, metadata, styles and declaration files count as files without a module edge. When no source or known non-module file exists, the import stays unresolved.

## Other resolution

- tsconfig `paths` aliases, `extends` chains and project references apply per file. A `paths` alias that matches wins over a workspace package, as it does for TypeScript. A missing `paths` target falls back to the npm package name when the specifier can name one.
- Private `#` specifiers in a package's `imports` map resolve to its script and framework files, from the nearest package scope, so a child package does not inherit its parent's mappings. Extensionless script targets work with bundler resolution, including when an unavailable generated config leaves the resolution mode unset.
- Imports through symlinks or a different letter case reach the source module when the filesystem resolves that spelling.
- Barrel re-exports are followed to the module that defines each name.
- A `?` query, such as Vite's `?worker`, is dropped when the import does not resolve with it.

`overview --json` lists every import that stays unresolved, with a likely cause.

## Known limits

**Generated framework configs.** Nuxt and SvelteKit generate the tsconfig files a project's own `tsconfig.json` extends, `.nuxt/tsconfig*.json` and `.svelte-kit/tsconfig.json`, and git ignores them. Until `nuxi prepare` or `svelte-kit sync` has run in the clone, Galactica cannot read the aliases they declare, such as Nuxt's `#imports` or SvelteKit's `$lib`. Imports through them reach no module, and `overview` counts a warning for each config it cannot read. On elk, a Nuxt app, 40 imports stay unresolved. Galactica runs neither command, since both run code from the repository. Run it yourself first when you trust that code.

**Auto-imports.** Nuxt imports components and composables with no import statement, so those dependencies have no edge. On elk, 51 of 61 root areas sit in layer 0.

**Tests loaded another way.** Tests loaded through a dev server, a build, runtime paths or fixtures can be missing from `uses`. Also search for tests named after the feature.

**Deno.** Deno repositories are not supported. When the root contains `deno.json` or `deno.jsonc`, analysis commands and `html` exit with code 1 and explain why. Deno workspaces, import maps and `jsr:`, `npm:` and URL imports need resolution that Galactica does not implement.
