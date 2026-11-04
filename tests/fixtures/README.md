# Fixture conventions

Each `expected.json` is the spec for the analyzer. It holds the `Model` from `src/model.ts` without the `hash` of each module. Paths are relative to the case's `repo/` directory. Every case keeps these conventions.

## Packages

- Every fixture has a root `package.json`. `repository.name` is its `name`.
- A single-package fixture has one package with `dir` `"."`. A workspace lists only the packages its manifest names.

## Symbols

- A symbol is an exported top-level declaration: a function, class, interface, type alias, enum, or each name a `const`, `let` or `var` statement declares outside a destructuring pattern. `declare` declarations count. Overloads are one symbol at the first signature.
- `line` is the line of the declaration's name. A local declaration exported with `export default name`, `export { name as default }`, `export = name` or `module.exports = name` keeps its own line and name, with `default: true`. `export { a as b }` of a local declaration is named `b`, at the line of `a`.
- An anonymous default export is named `"default"`. A default export of an expression that names no local declaration is a `const` named `"default"`, on the line of the `export`.
- A module has one symbol per name, sorted by line, then name.
- `signature` is one line of at most 160 characters. Whitespace collapses to one space, comments are dropped, and a longer signature is cut to 159 characters and `…`. `export` and `default` are dropped, and `async`, `declare` and `abstract` are kept.
- A function signature is `function name<T>(params): Ret`. Parameters keep their names, `?`, `...` and types, and drop default values, also inside destructuring. The return type appears only when the source writes one. An overloaded function shows its implementation.
- A `const` initialized by an arrow or function expression reads `const name = <T>(params): Ret =>`. A `forwardRef` or `memo` component reads `const Name = forwardRef<A>((params) =>)`, with the callee and type arguments as written, and a wrapped name such as `memo(Card)` stays as written.
- Any other `const` reads `const name: T` when annotated. Otherwise it shows a literal value that fits, as in `const PI = 3.14159`, or the shape of the value: `[...]`, `{...}`, `` `...` ``, `'...'`, `callee(...)` or `new Callee(...)`. `as const` stays. Any other value gives `const name`.
- A class reads `class Name<T> extends X implements Y`, an interface `interface Name<T> extends X` and an enum `enum Name`. A type alias reads `type Name<T> = <right-hand side>` when that fits, else `type Name<T> = …`.
- `doc` is the first sentence of the closest `/** */` comment, cut like a signature, and is absent when there is none.
- A component is a function whose own `return`, or arrow body, gives JSX, whatever its name. So is a `const` initialized by `forwardRef`, `memo`, `React.forwardRef` or `React.memo`, and a class extending `Component` or `PureComponent`, or the same on `React`.
- A `.vue`, `.svelte` or `.astro` file exports one implicit default component. It is named after the file, on line 1, with the signature `component Name`.
- CommonJS exports are the properties of `module.exports = { ... }` that name a local declaration, listed at that declaration, and each `exports.name = value` or `module.exports.name = value`, on the line of the assignment.

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

## Checking and updating

`tests/fixtures.ts` splits the expected files into aspects, such as module paths, packages, kinds, symbols and edges, and names the issue that implements each one. The tests compare every implemented aspect with the analyzer's output and list the others as `todo` with their issue. When a change to the output is intended, `pnpm fixtures:update` rewrites the implemented aspects from the analyzer and keeps the hand-written content of the rest.

The files are JSON with a two-space indent. Arrays of strings and numbers, and objects with at most two such fields, stay on one line. A test fails when a file is written any other way.
