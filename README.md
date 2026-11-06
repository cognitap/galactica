# Galactica

Galactica maps imports in JavaScript and TypeScript repositories. Browse the dependency graph in an offline HTML file, or use the CLI to find what a change affects and which tests cover it.

![Three layers of Immich’s web app. The selected side-bar area depends on modals, and layouts depends on side-bar.](https://raw.githubusercontent.com/cognitap/galactica/main/docs/images/immich-map.png)

## Quick start

Requires Node.js 24.1.0 or newer. Install Galactica, then open a map from your repository.

```sh
npm install -g @cognitap/galactica
galactica html --open
```

This writes `galactica.html` in the current directory. To give Codex, Claude Code, or Cursor the repository skill, run `galactica init`.

## CLI

| Command          | What it shows                                             |
| ---------------- | --------------------------------------------------------- |
| `overview`       | Packages, areas and dependency layers                     |
| `where <name>`   | Definitions of a named symbol                             |
| `outline <file>` | A file’s exports and signatures                           |
| `uses <file>`    | Importers and tests that reach the file                   |
| `deps <file>`    | The file’s dependencies                                   |
| `cycles`         | Import cycles and where to break them                     |
| `health`         | Cycles, oversized areas and cross-package private imports |

Add `--json` for structured output. Test reach follows imports, so tests that load code at runtime may need a separate search. [Command reference](https://github.com/cognitap/galactica/blob/main/docs/commands.md) · [Configuration](https://github.com/cognitap/galactica/blob/main/docs/configuration.md) · [Benchmarks](https://github.com/cognitap/galactica/blob/main/docs/benchmark.md)

Galactica 0.x is experimental and published under `latest`. [Release policy](https://github.com/cognitap/galactica/blob/main/RELEASE_POLICY.md)

The map was inspired by [codemap](https://github.com/peterretief/codemap). MIT licensed.
