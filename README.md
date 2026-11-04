# Galactica

Galactica maps a JavaScript or TypeScript repository, for coding agents and for the people who work with them. Both views come from the same analysis, so they never disagree.

- **For agents:** five commands answer the questions an agent asks while it works, and a skill tells the agent when to ask them.
- **For humans:** one self-contained HTML page shows where everything lives and what it touches.

Galactica is inspired by [codemap](https://github.com/peterretief/codemap), which draws a similar page for Go modules.

## Status

The five agent commands and `html` work from a checkout. Galactica is not on npm yet, and `init` does not exist yet. Work is tracked in the Galactica project in Linear.

To run the commands, build Galactica once, then run `dist/cli.js` from the repository you want to map, or pass that repository with `--root`:

```sh
pnpm install
pnpm build
node /path/to/galactica/dist/cli.js overview --root /path/to/repository
```

There is no cache yet, so each command analyzes the whole repository. On Radiant, about 500 modules, a command takes under a second.

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

`galactica init` installs a skill in `.agents/skills/galactica/`, which agents that follow the Agent Skills standard read. The skill tells an agent to run `overview` when it starts in an unfamiliar repository, `where` instead of grep, and `uses` before it edits a file.

Galactica keeps its analysis in a cache that git ignores, so it adds nothing to the repository except the optional skill. An optional `galactica.config.json` at the repository root overrides the defaults.

## What it reads

- JavaScript and TypeScript, including JSX and CommonJS.
- Vue, Svelte and Astro files, using the compiler already installed in the repository.
- Monorepos, with each workspace package as the top level of the map.
