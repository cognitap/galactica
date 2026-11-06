# Configuration

[README](../README.md) · [Commands](commands.md) · **Configuration** · [How it reads a repository](how-it-reads.md) · [Security](security.md) · [JSON output](json-output.md)

Galactica needs no config. To override a default, add `galactica.config.json` to the repository root, the directory that `--root` names. Every option is optional:

```json
{
  "$schema": "./node_modules/@cognitap/galactica/schema/galactica.config.schema.json",
  "include": ["src/**", "scripts/**"],
  "exclude": ["src/generated/**"],
  "kinds": { "source": ["docs/.vitepress/theme/**"] },
  "areas": { "src/components/**": "src/components" },
  "sourceUrl": "https://gitlab.example.com/group/repo/-/blob/{commit}/{path}#L{line}",
  "health": { "areaModules": 40 }
}
```

## Options

- `include` lists globs. Galactica maps a module only when its path matches one of them. Without `include`, it maps every module.
- `exclude` lists globs of modules to leave out, including modules that `include` matches.
- `kinds` maps a kind, `source`, `test`, `story` or `config`, to globs. See [Kinds](#kinds).
- `areas` maps a glob to an area path. A module that matches the glob is in that area instead of its folder's area. When a module matches several globs, the first in the file decides. The area path must be inside the module's package. Layers, cycles and the page treat these areas like any other.
- `sourceUrl` is the link template that [`html --source-url`](commands.md#source-links) takes, `none` included. `--source-url` wins over it.
- `health.areaModules` is a whole number. With it, `health` and the page call an area oversized when it holds more source modules than this number, in place of the rule relative to its package.
- `$schema` points an editor at `schema/galactica.config.schema.json`, which ships in the package, for completion and checks. Galactica ignores it.

`include` and `exclude` only narrow the files Galactica already reads. They never add a file that git ignores or a file in `node_modules`, `dist` or another build folder. An import of source that the config leaves out is counted as unresolved.

When the config is not valid, every command exits with code 1 and prints one line that names the key:

```text
galactica: galactica.config.json: kinds.storyy: unknown kind; expected source, test, story or config
```

A change to the config needs no cache action. The cache holds only what each file gives on its own, so no entry depends on the config.

## Globs

A glob matches the path from the repository root, with forward slashes. It supports `*`, `**`, `?`, character classes such as `[ab]` and `[!a]`, brace alternatives such as `{src,scripts}/**`, and integer ranges such as `{1..3}`.

`*` matches within one folder and `**` matches any number of folders. Neither matches a name that starts with a dot, so `**/*.tsx` misses `.storybook/preview.tsx` and `.storybook/**` finds it.

Matching takes linear time in the path length. Galactica ignores, with a warning, patterns longer than 1,024 characters, brace expansion beyond 64 alternatives or 1,024 tokens, extglobs such as `@(src|scripts)`, escapes and POSIX named character classes. These limits also apply to workspace patterns.

## Kinds

Each module has one kind: `source`, `test`, `story` or `config`. Tests and stories never shape layers or count toward oversized areas, and the page hides them at first.

By default, Galactica reads the kind from the name and folder:

- Names such as `*.test.ts`, `*.spec.ts` and `app.e2e-spec.ts` are tests, as are modules under `__tests__`, `test`, `tests`, `__testfixtures__`, `__fixtures__`, `testdata`, `testData`, `fixtures` or `__mocks__`.
- Names such as `*.stories.tsx` are stories.
- A module in a folder whose name starts with a dot is `config`, such as `.storybook/main.ts` or `.github/scripts/release.mjs`. The subfolders of `.storybook` are the exception: they hold what stories render, such as demo components in `.storybook/examples/`, so their modules are stories.

A module that matches the globs of a kind in `kinds` has that kind, whatever its name and folder say. A module can match the globs of one kind only.

For example, Vite keeps the components of its documentation site in `docs/.vitepress/theme/`, where they are `config` modules by default. This config makes them source:

```json
{ "kinds": { "source": ["docs/.vitepress/theme/**"] } }
```
