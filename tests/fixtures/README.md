# Fixture conventions

Each `expected.json` is the spec for the analyzer. It holds the `Model` from `src/model.ts` without the `hash` of each module. Paths are relative to the case's `repo/` directory. Every case keeps these conventions.

## Packages

- Every fixture has a root `package.json`. `repository.name` is its `name`.
- A single-package fixture has one package with `dir` `"."`. A workspace lists only the packages its manifest names.

## Symbols

- `line` is the line of the declaration's name. A local declaration exported with `export default name` keeps its own line and name, with `default: true`.
- `signature` is the source text from the declaration keyword to the body, on one line. `export` and `default` are dropped and `async` is kept. A return type appears only when the source writes one.
- A `const` signature is `const Name`, plus the type annotation when the source writes one. The initializer is the body, so `forwardRef` and `memo` components read `const Input`.
- A type alias signature is `type Name`. The right-hand side is the body.
- `doc` is the first sentence of the doc comment, and is absent when there is none.
- A React component is a function with a capitalized name in a `.tsx` or `.jsx` file, or a `const` initialized by `forwardRef` or `memo`.
- A `.vue`, `.svelte` or `.astro` file exports one implicit default component. It is named after the file, on line 1, with the signature `component Name`.
- CommonJS exports are the shorthand properties of `module.exports = { ... }`, listed at their local declarations.

## Edges

- `line` is the line of the module specifier, so a multi-line import points at its `from` line.
- One statement yields one edge per target. `typeOnly` is true when every name it imports is type-only, through `import type` or inline `type` on each specifier.
- `names` are sorted, as the defining module exports them. A default import is `"default"`, a namespace import is `"*"` and a side-effect import is empty.
- `require()` and `import()` take their names from an object destructuring of the result, and are `"*"` when the result is bound whole.
- An import through a barrel points at the defining module, with the barrels in `via`. A barrel's own `export ... from` edges point at the module they name, even when that is another barrel.
- A bare specifier that names no workspace package or self-reference is `external`, with the package name and no subpath. A relative specifier that resolves to no file is `unresolved`.
- A fixture with no `tsconfig.json` resolves as TypeScript does with `moduleResolution: "bundler"` and `allowJs`.

## Derived data

`expected-graph.json` holds only the fields its case is about: `kinds` for every module, `areas` sorted by path, and `cycles` among source modules.
