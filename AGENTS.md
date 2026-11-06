# Galactica

Galactica analyzes a JavaScript or TypeScript repository into one `Model`, derives one `Graph`, and renders the agent commands and the HTML page from it, so they never disagree. [docs/architecture.md](docs/architecture.md) explains the flow; [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and tests.

## Rules

### Security

Agents run Galactica on repositories they just cloned or downloaded. Treat the mapped repository as hostile.

- Never run its code. Load no module from it, including its `node_modules`, and run no bundler, generator or script. Read Vue and Svelte with Galactica's own exact-pinned optional `vue/compiler-sfc` and `svelte/compiler`; read Astro frontmatter as text.
- Read repository bytes only through `readRepositoryFile` in `src/safe-read.ts`: a regular file inside the root after following links, at most 10 MB.
- Match repository-controlled globs only through `src/glob.ts`, which is linear in the path length.
- Run git only through `git` in `src/repository-files.ts`, which turns off `core.fsmonitor`, optional index writes and filter drivers.
- Write nothing into the repository except the files `init` installs and the page `html` writes, both through `src/safe-write.ts`. Never read a cache from the repository; the cache lives in the user cache folder only.
- Skill text and docs run Galactica as `npx --prefix / @cognitap/galactica`; `tests/npx-shadow.test.ts` checks why.

### Output

- The public contract is the command output, text and `--json`, the config and its schema, and the files `init` writes. [RELEASE_POLICY.md](RELEASE_POLICY.md) defines breaking changes. The model, the cache and the page data are private.
- Output is deterministic: the same repository gives byte-identical output in any folder, locale, time zone or cache state. `tests/determinism.test.ts` checks it.
- Text is rendered only from the `--json` object, so the two never disagree. Update `src/contract.ts` and `docs/json-output.md` together.
- Work with zero config. Every option in `galactica.config.json` is an override.
- The HTML page is one file with no network requests. Inline all scripts, styles and data.

### Performance

A first run on about 3,000 modules takes under 10 seconds, and a command with a warm cache under half a second. Do not merge changes that break these targets. CI checks them with `pnpm bench --check`; [CONTRIBUTING.md](CONTRIBUTING.md#benchmarks) shows how to run it.

### Node.js

Support Node.js 24.1.0 and newer; [CONTRIBUTING.md](CONTRIBUTING.md#nodejs-versions) says where the minimum is stated and how CI tests it. Keep `src/bin.ts` and `src/node-version.ts` free of other imports and of syntax older Node.js cannot parse, so an older version gets the one-line refusal.

## Terms

- **Package:** a workspace package. A single-package repository has one.
- **Module:** one source file, including `.vue`, `.svelte` and `.astro` files.
- **Kind:** source, test, story or config, from the path or the config's `kinds`. Tests and stories never shape layers.
- **Area:** a group of modules within one package, usually a folder. The config's `areas` can override it.
- **Symbol:** an exported function, class, component, type, interface, enum or constant.
- **Edge:** an import from one module to another, resolved through tsconfig paths, workspace packages and barrel re-exports to the module that defines the symbol.
- **Layer:** an area's position in the dependency order within its package. Areas in an import cycle share one layer.
- **Cycle:** source and config modules that reach each other through imports, type-only imports and re-exports aside.
- **Type-only import:** an import the compiled module does not make: written `import type`, or in TypeScript with no name read as a value, unless `verbatimModuleSyntax` or decorator metadata keeps it.
- **Load time:** an import is used at load time when the importer reads its name in code that runs while the module evaluates.
- **Cross-package private import:** an import into another workspace package past its public entries. `health` lists them; its JSON field is `internalImports`.

## Architecture map

| Stage           | Modules                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| Command line    | `bin`, `node-version`, `cli`, `cli-input`, `cli-writers`, `commands`, `config`      |
| Model cache     | `model-cache`, `inputs`, `cache`, `cache-schema`                                    |
| Discover        | `repository-files`, `workspace`, `discovery`, `compiler-settings`, `source-file`    |
| Extract         | `analysis`, `extraction`, `syntax`, `symbols`, `imports`, `load-time`, `frameworks` |
| Resolve         | `import-resolution`, `package-resolution`, `internal-imports`, `barrels`            |
| Model and graph | `model`, `graph`, `areas`, `layers`, `cycles`, `strongly-connected`                 |
| Commands        | `subjects`, `queries`, `overview`, `health`, `contract`, `render`                   |
| HTML page       | `html`, `page-data`, `source-links`, `git-source`, `row-order`, `page/`             |
| Skill           | `skill`, `skills/galactica/SKILL.md`                                                |
| Trust boundary  | `safe-read`, `glob`, `safe-write`, `repository-files`, `paths`, `json`              |

All modules are under `src/`. A new analysis command is one entry in `commandTable` in `commands.ts`, one renderer in `render.ts` and its types in `contract.ts`; `cli-input.ts` derives parsing and help from the table. `html` and `init` write files through `cli-writers.ts`. A new framework is one entry in the `frameworks` table in `frameworks.ts`, plus its language in `languages` in `contract.ts`, which imports nothing by design.

## Commands

- `pnpm check` runs format, lint, typecheck and every test. Run it before every commit.
- `pnpm fixtures:update` rewrites the implemented aspects of `tests/fixtures/*/expected*.json`. Run it when an output change is intended, and review the diff. When an issue implements an aspect, give it a check in `tests/fixtures.ts` and remove the cases it finishes from `pendingIn`. Formatters never touch fixtures, because expected files pin line numbers.
- Add each config a test uses to `tests/config-examples.ts`; `tests/config.test.ts` checks them and the examples in `docs/configuration.md` against the schema.

## Releases

Follow [RELEASE_POLICY.md](RELEASE_POLICY.md):

1. Open PR `Release Galactica <version>`: run `pnpm version patch --no-git-tag-version` (`minor` for a breaking change during `0.x`), move Unreleased notes under `## <version>`, commit, and run `pnpm release:prepare`.
2. Squash-merge after CI passes, then run the **Release Galactica** workflow on `main` with `publish`.
3. Verify `pnpm view @cognitap/galactica@<version> dist.integrity` matches `release.json` (never rerun `publish` for an existing version).
4. Create GitHub release `v<version>` titled `Galactica <version>` at `sourceCommit`.
