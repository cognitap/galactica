# Changelog

[Release policy](RELEASE_POLICY.md)

## Unreleased

## 0.1.0

The first release. Galactica is experimental during `0.x`: a minor version can change the command output, the config or the skill.

- Add `overview`, `where`, `outline`, `uses` and `deps`, which print short text by default and the JSON that `docs/json-output.md` documents with `--json`.
- Add `html`, which writes a self-contained, searchable map of the repository's packages, areas and layers, with links to each module and symbol in the repository host.
- Add `init`, which installs the agent skill for Codex and Claude Code and a rule that points Cursor's agent to it.
- Read JavaScript and TypeScript, including JSX and CommonJS, and the script blocks of Vue, Svelte and Astro files.
- Resolve imports through tsconfig paths, workspace packages and barrel re-exports to the module that defines each name.
- Read optional overrides from `galactica.config.json`, with a JSON Schema in the package.
- Cache what each file gives between runs, and answer an unchanged repository from a cached model.
- Never run code from the repository being mapped.
- Require Node.js 24.1.0 or newer, and say so in one line on an older version.
