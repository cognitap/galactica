# Fixture conventions

Each `expected.json` is the spec for the analyzer. It holds the `Model` from `src/model.ts` without the `hash` of each module. Paths are relative to the case's `repo/` directory. Every case keeps these conventions.

## Packages

- Every fixture has a root `package.json`. `repository.name` is its `name`.
- A single-package fixture has one package with `dir` `"."`. A workspace lists the packages its manifest names, by their `package.json` `name`. The root is a package too, named by its `name` with `dir` `"."`, only when a module lies outside every workspace package.

## Symbols

- A symbol is an exported top-level declaration: a function, class, interface, type alias, enum, or each name a `const`, `let` or `var` statement declares outside a destructuring pattern. `declare` declarations count. Overloads are one symbol at the first signature.
- `line` is the line of the declaration's name. A local declaration exported with `export default name`, `export { name as default }`, `export = name` or `module.exports = name` keeps its own line and name, with `default: true`. `export { a as b }` of a local declaration is named `b`, at the line of `a`.
- An anonymous default export is named `"default"`. A default export of an expression that names no local declaration is a `const` named `"default"`, on the line of the `export`.
- A module has one symbol per name, sorted by line, then name.
- `signature` is one line of at most 160 characters. Whitespace collapses to one space, comments are dropped, and `export` and `default` are dropped, and `async`, `declare` and `abstract` are kept. The members of any object type literal in a signature are separated by `; `, whatever the source used, with no separator before the closing `}`, as in `{ a: string; b?: number }`.
- A function, arrow or `forwardRef` signature over 160 characters is shortened in steps, stopping at the first that fits. First every object destructuring parameter reads `{ … }` and keeps its type, as in `function Button({ … }: ButtonProps)`. Then every parameter whose type is an object type literal reads `{ … }`. Only then is the signature cut to 159 characters and `…`. Any other signature over the limit is cut at once.
- A function signature is `function name<T>(params): Ret`. Parameters keep their names, `?`, `...` and types, and drop default values, also inside destructuring. The return type appears only when the source writes one. An overloaded function shows its implementation.
- A `const` initialized by an arrow or function expression reads `const name = <T>(params): Ret =>`. A `forwardRef` or `memo` component reads `const Name = forwardRef<A>((params) =>)`, with the callee and type arguments as written, and a wrapped name such as `memo(Card)` stays as written.
- Any other `const` reads `const name: T` when annotated. Otherwise it shows a literal value that fits, as in `const PI = 3.14159`, or the shape of the value: `[...]`, `{...}`, `` `...` ``, `'...'`, `callee(...)` or `new Callee(...)`. `as const` stays. Any other value gives `const name`.
- A class reads `class Name<T> extends X implements Y`, an interface `interface Name<T> extends X` and an enum `enum Name`. A type alias reads `type Name<T> = <right-hand side>` when that fits, else `type Name<T> = …`.
- `doc` is the first sentence of the closest `/** */` comment, cut like a signature, and is absent when there is none.
- A component is a function whose own `return`, or arrow body, gives JSX, whatever its name. So is a `const` initialized by `forwardRef`, `memo`, `React.forwardRef` or `React.memo`, and a class extending `Component` or `PureComponent`, or the same on `React`.
- A `.vue`, `.svelte` or `.astro` file exports one implicit default component. It is named after the file, on line 1, with the signature `component Name`.
- A framework file also exports what its exporting script block exports, by the rules above, at the line in the file: a Vue `<script>`, not `<script setup>`, a Svelte module script, not the instance script, and an Astro frontmatter. A default export of a block is the component, so it gives no symbol of its own. The imports come from every script block. The `<script>` tags in an Astro body are not read.
- CommonJS exports are the properties of `module.exports = { ... }` that name a local declaration, listed at that declaration, and each `exports.name = value` or `module.exports.name = value`, on the line of the assignment. An assignment in a chain counts the same, as in `exports = module.exports = createApp` or `var routes = exports.routes = []`.

## Edges

- `line` is the line of the module specifier, so a multi-line import points at its `from` line.
- One statement yields one edge per target. `typeOnly` is true when every name it imports is type-only, through `import type` or inline `type` on each specifier.
- `names` are sorted, as the defining module exports them. A default import is `"default"`, a namespace import is `"*"` and a side-effect import is empty.
- A re-export that renames has `renames`, from each name it exports to the name it takes, with keys sorted. `export { default as Button } from` gives `{ "Button": "default" }` and `export * as ns from` gives `{ "ns": "*" }`. A name passed on both renamed and unrenamed also maps to itself. Edges that rename nothing, and `import` edges, have no `renames`.
- `require()` and `import()` take their names from an object destructuring of the result. They are empty when the result is discarded, and `"*"` when it is used any other way. A `require()` is not `dynamic`.
- An import through a barrel points at the defining module, with the barrels in `via`. A barrel's own `export ... from` edges point at the module they name, even when that is another barrel.
- A specifier that a `paths` alias matches resolves through the alias, as TypeScript resolves it, even when it also names a workspace package or self-reference.
- A bare specifier that names no workspace package or self-reference is `external`, with the package name and no subpath. A Node.js built-in is `external` as `node:<name>`, with or without the prefix in the specifier. A relative or `paths` specifier that resolves to no file is `unresolved`.
- Any other specifier resolves as TypeScript resolves it with the module's tsconfig, in the mode its syntax and file format give. A fixture with no `tsconfig.json` resolves as TypeScript does with `moduleResolution: "bundler"` and `allowJs`. A specifier that names a module by its exact path, such as `./Counter.vue`, resolves to it.
- A specifier with a `?` query, such as Vite's `./worker?worker` or `./logo.svg?raw`, that resolves to nothing whole resolves as the specifier before the `?`. When that resolves to nothing too, the import is `unresolved` with the whole specifier.
- An import of a repository file that is no module, such as a stylesheet, a JSON file or a declaration file, yields no edge.
- `loadTime` lists the `names` the importer reads at load time: in top-level code, a class body apart from methods, constructors and instance fields, a decorator, a function called where it is defined, or a top-level function or class that such code calls by name. A local declaration of the same name in a nested scope hides the import. A `require()` in top-level code reads all its names unless it binds a name, which then counts like an import. It is absent when nothing is read at load time, and on re-exports, type-only and dynamic imports, and the imports of a Vue `<script setup>`, a Svelte instance script and Astro frontmatter.

## Derived data

`expected-graph.json` holds only the fields its case is about: `kinds` for every module, `areas` sorted by path, and `cycles`.

- Each folder is an area. A folder of a single module joins its parent while the parent holds modules of its own, never above the package's directory. A package's directory is an area, `"."` for the root.
- An area's layer is 0 when it imports no other area of its package, and otherwise one above the highest area it imports. Only imports between source and config modules count, type-only ones included and re-exports not. Areas in one import cycle share a layer.
- An area of only tests and stories sits one above the highest area it imports. A test or story in a mixed area does not change that area's layer.
- `cycles` are the import cycles of more than one source or config module, each sorted and the list sorted by first member. Type-only imports and re-exports do not count.

## Checking and updating

`tests/fixtures.ts` splits the expected files into aspects, such as module paths, packages, kinds, symbols and edges, and names the issue that implements each one. The tests compare every implemented aspect with the analyzer's output and list the others as `todo` with their issue. When a change to the output is intended, `pnpm fixtures:update` rewrites the implemented aspects from the analyzer and keeps the hand-written content of the rest.

The files are JSON with a two-space indent. Arrays of strings and numbers, and objects with at most two such fields, stay on one line. A test fails when a file is written any other way.
