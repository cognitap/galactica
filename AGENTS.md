# Galactica

Galactica reads a JavaScript or TypeScript repository and builds one model of it. Every output is a rendering of that model, so the agent map and the human map never disagree.

## Terms

- **Module:** one source file.
- **Area:** a directory of modules, the unit the human map draws as a box.
- **Symbol:** an exported function, class, component, type, interface, enum or constant.
- **Edge:** an import from one module to another, resolved through tsconfig paths and barrel re-exports to the module that defines the symbol.
- **Layer:** an area's position in the dependency order. An area only depends on areas in lower layers. Areas in an import cycle share one layer.
- **Map:** the model of the whole repository, serialized as JSON.

## Structure

- `src/cli.ts`: command-line entry point.
- `tests/`: `node:test` suites run against the built `dist/`. Fixture repositories go in `tests/fixtures/`.

## Conventions

- Galactica analyzes source with the TypeScript compiler API. It never runs the code it maps.
- The map JSON is a public contract for agents. Treat field changes as breaking.
- The HTML page is one file with no network requests. Inline all scripts, styles and data.
- Output must be deterministic: the same repository produces byte-identical files.

## Commands

`pnpm check` runs format, lint, typecheck and tests. Run it before every commit.
