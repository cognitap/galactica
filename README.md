# Galactica

Galactica maps a JavaScript or TypeScript repository, for coding agents and for the people who work with them. Both views come from the same analysis, so they never disagree.

- **For agents:** five commands answer the questions an agent asks while it works, and a skill tells the agent when to ask them.
- **For humans:** one self-contained HTML page shows where everything lives and what it touches.

Galactica is inspired by [codemap](https://github.com/peterretief/codemap), which draws a similar page for Go modules.

## Status

Not usable yet. Work is tracked in the Galactica project in Linear.

## Planned usage

Galactica needs Node.js 24 or newer. It runs in any repository with no install and no config:

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

Every command except `html` and `init` prints short text by default and structured output with `--json`.

`galactica init` installs a skill in `.agents/skills/galactica/`, which agents that follow the Agent Skills standard read. The skill tells an agent to run `overview` when it starts in an unfamiliar repository, `where` instead of grep, and `uses` before it edits a file.

Galactica keeps its analysis in a cache that git ignores, so it adds nothing to the repository except the optional skill. An optional `galactica.config.json` at the repository root overrides the defaults.

## What it reads

- JavaScript and TypeScript, including JSX and CommonJS.
- Vue, Svelte and Astro files, using the compiler already installed in the repository.
- Monorepos, with each workspace package as the top level of the map.
