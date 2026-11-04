---
name: galactica
description: Maps a JavaScript or TypeScript repository, including Vue, Svelte and Astro files, from its imports. Use when starting a task in an unfamiliar JS or TS repository, when looking for where a function, component, type or constant is defined, and before editing a file, to see what depends on it and which tests to run.
---

# Galactica

Galactica answers questions about this repository from its import graph. Run it from the repository root. Each answer gives `path:line` or a path, so open exactly that file at that line.

## When you start a task here

Run `npx @cognitap/galactica overview` before you read any file. It lists the packages, their areas in dependency order, and the most imported modules, so you know where to look first.

## When you look for where something is defined

Run `npx @cognitap/galactica where <name>` instead of grep. It lists each definition of an exported symbol with its file, line, kind and signature, followed through re-exports to the file that defines it. When it finds nothing, the name is not exported, so search for it with grep.

## Before you edit a file

1. Run `npx @cognitap/galactica uses <file>`. It lists the files that import this one, with the names each takes, and then, in their own group under `tests:`, every test that reaches the file at any distance.
2. Make the edit, and update the dependents it affects.
3. Run the tests in the `tests:` group with the repository's test command.

`uses` also takes a package name, a package directory or a folder. `--depth <n>` follows more import steps to indirect dependents.

## Other commands

- `npx @cognitap/galactica deps <file>` lists what a file imports, inside the repository and outside it.
- `npx @cognitap/galactica outline <file>` lists a file's exported symbols with their lines and signatures, without reading the whole file.
- `--json` on any of these prints structured output.
