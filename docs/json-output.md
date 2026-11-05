# JSON output

For agent and tool authors. Every command except `html` and `init` prints one JSON object with `--json`. The types are in `src/contract.ts`. Fields not documented here are not part of the contract.

## Rules

- Every object has `schemaVersion` and `command`. `schemaVersion` is one number for the whole contract. It increases when any field of any command is removed, renamed or changes meaning. A new optional field does not increase it.
- Paths are relative to the repository root, use forward slashes and have no leading `./`. An area is named by its directory path. A package is named by its `package.json` name.
- Arrays are sorted as stated below, and the same repository gives byte-identical output. There are no timestamps.
- `uses` and `deps` accept a module path, a package name, a package directory or an area path. Galactica tries them in that order and takes the first kind that matches, so a package directory that is also an area names the package. `outline` accepts only a module path.
- A path reads from the current directory and from the repository root. When the two readings name different subjects of the same kind, the command reports `ambiguous`.
- An area or a package stands for its source and config modules, for both `uses` and `deps`. Its tests and stories use it like any other test or story, so what they import is not a dependency of the subject. Its tests are listed in `uses` `tests`, and its stories in `uses` `modules`.
- A command that cannot answer prints a failure object and exits with code 1. A successful command exits with code 0. An unknown command or no command prints usage and no JSON.

```json
{
  "schemaVersion": 1,
  "command": "outline",
  "error": { "code": "not-found", "message": "no module named src/nope.ts" }
}
```

`error.code` is `not-found`, `ambiguous` or `usage`. `not-found` means no module, package or area matches, and its message names up to three paths that end with the given text. `usage` means an option the command does not take, a missing or extra argument, a `--depth` below 1, a `--root` that is no directory, or an invalid `galactica.config.json`, whose message starts with `galactica.config.json:` and names the key.

## overview

Packages are sorted by name. Areas are sorted by layer, lowest first, then by path. Layer 0 depends on no other area in its package, and areas in one import cycle share a layer. `all` is true when `--all` was given. `top` lists the most imported source and config modules of the area, never tests or stories, so an area of only tests and stories has an empty `top`. It is sorted by `importers` descending, then path. It holds five entries, or all of them with `--all`. `importers` counts the modules other than tests and stories that import the module itself. An import through a barrel counts for the module that defines the name, not for the barrel. `exports` lists the names the module exports, in line order. `cycles` counts import cycles among source modules. `unresolved` counts imports that resolved to nothing.

`warnings` lists every problem the analysis worked around, sorted by `path`, then `message`. `path` is the file the problem is in, such as a `package.json` without a name, a second package with a name another package already has, or a `tsconfig.json` TypeScript reports an error in. `message` is one line, and names files under the root by their path from the root. The text of `overview` gives only their number. Galactica 0.1.0 printed no `warnings`.

```json
{
  "schemaVersion": 1,
  "command": "overview",
  "all": false,
  "packages": [
    {
      "name": "@acme/ui",
      "dir": "packages/ui",
      "modules": 194,
      "areas": [
        {
          "path": "packages/ui/src/primitives",
          "layer": 0,
          "modules": 14,
          "top": [
            { "path": "packages/ui/src/primitives/cn.ts", "importers": 161, "exports": ["cn"] }
          ]
        },
        { "path": "packages/ui/src/components", "layer": 1, "modules": 180, "top": [] }
      ]
    }
  ],
  "cycles": 2,
  "unresolved": 0,
  "warnings": [
    {
      "path": "packages/legacy/package.json",
      "message": "a workspace package without a name is skipped"
    }
  ]
}
```

## where

`galactica where Button --json`

`definitions` lists the modules that define the name, sorted by module path, then line. A module that only re-exports the name is not a definition. A default export is listed under its declaration name with `"default": true`. `doc` is the first sentence of the doc comment and is omitted when there is none. An unknown name is not a failure. It prints `"definitions": []` and exits with code 0. `suggestions` then lists up to three exported names that equal the name but for case, contain it or are contained in it. It is empty when `definitions` is not.

```json
{
  "schemaVersion": 1,
  "command": "where",
  "name": "Button",
  "definitions": [
    {
      "module": {
        "path": "packages/ui/src/components/Button.tsx",
        "package": "@acme/ui",
        "area": "packages/ui/src/components",
        "kind": "source"
      },
      "name": "Button",
      "kind": "component",
      "line": 12,
      "default": true,
      "signature": "function Button(props: ButtonProps): JSX.Element",
      "doc": "Primary action button."
    }
  ],
  "suggestions": []
}
```

## outline

`galactica outline src/cn.ts --json`

`symbols` lists the exported declarations of one module in line order. `kind` is one of `function`, `class`, `component`, `type`, `interface`, `enum` or `const`. A module `kind` is one of `source`, `test`, `story` or `config`.

```json
{
  "schemaVersion": 1,
  "command": "outline",
  "module": { "path": "src/cn.ts", "package": "@acme/app", "area": "src", "kind": "source" },
  "symbols": [
    {
      "name": "cn",
      "kind": "function",
      "line": 3,
      "default": false,
      "signature": "function cn(...inputs: ClassValue[]): string",
      "doc": "Joins class names."
    }
  ]
}
```

## uses

`galactica uses src/cn.ts --depth 2 --json`

`--depth` is 1 by default. `modules` lists the non-test modules that depend on the subject within `--depth`, stories included, sorted by `distance`, then path. `distance` 1 is a direct import, including an import that passes through the subject as a barrel and a barrel that re-exports from it. Farther out, an import that only passes through a barrel depends on the module that defines the name, not on everything the barrel re-exports. `names` lists what a direct dependent imports from the subject. It is empty beyond distance 1. Modules inside the subject are not listed.

`tests` lists every test module that depends on the subject at any distance, whatever `--depth` is, because the question is which tests to run. It has the same order as `modules`.

```json
{
  "schemaVersion": 1,
  "command": "uses",
  "subject": { "kind": "module", "path": "src/cn.ts", "package": "@acme/app" },
  "depth": 2,
  "modules": [
    {
      "path": "src/components/Button.tsx",
      "package": "@acme/app",
      "area": "src/components",
      "kind": "source",
      "distance": 1,
      "names": ["cn"]
    }
  ],
  "tests": [
    {
      "path": "src/components/Button.test.tsx",
      "package": "@acme/app",
      "area": "src/components",
      "kind": "test",
      "distance": 2,
      "names": []
    }
  ]
}
```

The subject has one of three shapes: `{ "kind": "module", "path", "package" }`, `{ "kind": "area", "path", "package" }` or `{ "kind": "package", "name", "dir" }`.

## deps

`galactica deps @acme/ui --json`

`modules` lists the workspace modules the subject depends on within `--depth`, sorted by `distance`, then path. It excludes modules inside the subject. An import through a barrel reaches both the barrel and the module that defines the name, so `deps` and `uses` agree at distance 1. The walk goes on from the defining module only, not from the barrel. `packages` lists the workspace packages those modules belong to, except the subject's own, sorted. `external` lists the npm package names the subject imports, without subpaths or versions, sorted. `unresolved` lists imports inside the subject that resolved to nothing, sorted by `from`, then `specifier`.

```json
{
  "schemaVersion": 1,
  "command": "deps",
  "subject": { "kind": "package", "name": "@acme/ui", "dir": "packages/ui" },
  "depth": 1,
  "modules": [
    {
      "path": "packages/tokens/src/index.ts",
      "package": "@acme/tokens",
      "area": "packages/tokens/src",
      "kind": "source",
      "distance": 1,
      "names": ["colors"]
    }
  ],
  "packages": ["@acme/tokens"],
  "external": ["clsx", "react"],
  "unresolved": [{ "from": "packages/ui/src/legacy.ts", "specifier": "./gone" }]
}
```
