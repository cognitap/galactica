# Security

[README](../README.md) · [Commands](commands.md) · [Configuration](configuration.md) · [How it reads a repository](how-it-reads.md) · **Security** · [JSON output](json-output.md)

Agents run Galactica on repositories they just cloned or downloaded. Galactica treats the mapped repository as untrusted: it never runs the repository's code and writes nothing to it unless asked.

## Run it with `--prefix /`

```sh
npx --prefix / @cognitap/galactica overview
```

With `--prefix /`, npm looks for installed packages and a project `.npmrc` in `/` instead of the repository. It takes Galactica from its cache or from the registry in your own npm config. It never runs a `node_modules/@cognitap/galactica` or `node_modules/.bin/galactica` that the repository holds, whether its `package.json` lists it or not. `tests/npx-shadow.test.ts` checks this against a repository that plants both and an `.npmrc` naming another registry.

These have no such guarantee:

- plain `npx @cognitap/galactica` run inside the repository;
- a command set with `init --command`, such as `pnpm exec galactica`, which runs the repository's own install.

A copy of Galactica installed outside the repository is as safe as `--prefix /`. The same applies to the skills CLI: `npx --prefix / skills add cognitap/galactica` keeps npm from running a `skills` package planted in the repository.

## What it never runs

- Galactica loads no module from the repository, including its `node_modules`. It reads Vue and Svelte with its own compilers.
- It runs no bundler, framework generator or package script.
- It runs git with `core.fsmonitor`, optional index writes and the repository's own filter drivers turned off, so a `.git` folder that came with a download cannot make git run a program.

A tool that acts on a file in the repository before Galactica starts, such as a version manager that reads `.nvmrc` or `.tool-versions` and switches Node.js or npm, is outside this guarantee.

## What it reads

Before reading repository content, including source modules, compiler configs, workspace manifests, `galactica.config.json` and installed skill files, Galactica requires a regular file inside the root after following links, of at most 10 MB.

- A module that fails this check is skipped with a warning.
- An unsafe optional config, such as a `tsconfig.json`, is skipped with a warning. A tsconfig `extends` target outside the root is refused too.
- An unsafe `galactica.config.json`, or an existing skill file that `init` must read, fails the command with one line.

Globs from the config and workspace manifests are matched in linear time with bounded size, so a hostile pattern cannot stall a run. See [Globs](configuration.md#globs).

## What it writes

Galactica writes to the repository only when you run `html` or `init`:

- `html` writes one file, `galactica.html` or the `--out` path.
- `init` writes the three skill files and nothing else. It writes all three or none.

Both refuse, with one line and exit code 1, to write through a symbolic link: neither the file nor a folder above it inside the repository may be one, such as a `.claude` linked to `~/.claude`.

## The cache

The cache lives only in the user cache folder, never in the repository, and Galactica never reads a cache from the repository. A repository therefore cannot ship a cache that changes what Galactica reports.

Galactica creates the cache folder readable by you alone. It runs with no cache when that folder is a symlink, belongs to another user or lies inside the repository, or when there is no home folder.
