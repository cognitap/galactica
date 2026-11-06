# Contributing to Galactica

[README](README.md) · [Commands](docs/commands.md) · [Configuration](docs/configuration.md) · [How it reads a repository](docs/how-it-reads.md) · [Security](docs/security.md) · [JSON output](docs/json-output.md)

## Set up

You need Node.js and pnpm. `.nvmrc` pins the development Node.js version, and `package.json` pins pnpm.

```sh
pnpm install
pnpm build
node dist/bin.js overview --root /path/to/repository
```

Run `dist/bin.js` wherever you would run `galactica`. To try the skill against your build, run `init --command "node /path/to/galactica/dist/bin.js"` in the target repository.

## Workflow

1. Work on a branch and open a pull request against `main`.
2. Run `pnpm check` before every commit. It runs format, lint, typecheck and the tests, then installs the packed package in a throwaway repository and runs it there. CI runs the same check.
3. When a change to the analysis output is intended, run `pnpm fixtures:update` and review the diff under `tests/fixtures` as part of the change.
4. When the `--json` output changes, update `src/contract.ts` and [docs/json-output.md](docs/json-output.md) together. Command output, config and the files `init` writes are the public contract; [RELEASE_POLICY.md](RELEASE_POLICY.md) says what counts as breaking.
5. When the config gains an example, add it to `tests/config-examples.ts`. `tests/config.test.ts` checks the examples in [docs/configuration.md](docs/configuration.md) against the schema and the loader.

[AGENTS.md](AGENTS.md) holds the project rules: determinism, never running the mapped code, and the performance targets.

## Tests

| Command              | Runs                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `pnpm check`         | Format, lint, typecheck, `pnpm test`.                                  |
| `pnpm test`          | Build, every suite with coverage, then the packed-package smoke test.  |
| `pnpm test:coverage` | Build and every suite with coverage.                                   |
| `pnpm test:browser`  | Build and the HTML map tests in headless Chrome.                       |
| `pnpm test:node`     | Build and the Node unit and CLI suites on the pinned development Node. |
| `pnpm test:package`  | Build and the packed-package smoke test.                               |

CLI tests run the built `dist/`; unit tests import `src/` directly.

### Coverage

`pnpm test:coverage` fails below 90% lines, 85% branches and 90% functions in aggregate. It writes `coverage/`, with an HTML report at `coverage/lcov-report/index.html`, LCOV and a JSON summary. CI uploads it, including when a floor fails.

Coverage includes every production module under `src/`, even modules no test loads, and the pure page helpers `search.js`, `links.js` and `indexes.js`. Source maps merge CLI subprocess coverage from `dist/` into the same source files. The browser-only `src/page/page.js` is outside the Node percentage; `tests/page.test.ts` checks it in Chrome.

### Chrome

The browser tests need Google Chrome in its usual location, or `CHROME_PATH` set to the absolute path of its executable. `CHROME_PATH` wins over discovery. Locally, the suite skips with a reason when it finds no Chrome. When `CI` is set, missing Chrome fails it.

### Node.js versions

Galactica supports Node.js 24.1.0 and newer. That is the support baseline for the first release: the Node.js 24 line from 24.1.0, and every later major. `package.json` `engines` and the startup check in `src/node-version.ts` state the same minimum, and `tests/node-version.test.ts` keeps them equal. Older versions, Node.js 22 included, get a one-line refusal. Keep `src/bin.ts` and `src/node-version.ts` free of other imports and of syntax older Node.js cannot parse, so that refusal still prints.

CI runs the Node unit and CLI suites on the latest Node.js 24 and 26 on Linux. The main check uses `.nvmrc` for coverage, browser tests and the packed-package test.

To check another Node.js version locally:

```sh
pnpm build
nvm use 24
node scripts/test-node.ts
```

Run `node scripts/test-node.ts` directly, not through pnpm: pnpm pins script runtimes through `devEngines` and `pnpm-workspace.yaml`. The script prints the Node.js executable and version it tests.

## Benchmarks

`pnpm bench` measures the speed targets: a first run under 10 seconds on about 3,000 modules, and a warm command under half a second.

```sh
node scripts/synthetic-repo.ts /tmp/synthetic --modules 3000
pnpm bench /tmp/synthetic
```

It runs the built CLI for `overview` and for `uses` of the most-imported source module, cold and then warm, and prints the median and range of 5 runs with the time of each phase. `--runs` sets the number of runs, `--uses` the module, `--json` prints JSON, and `--check` exits with code 1 when a median misses its target. The synthetic repository is a pnpm workspace shaped like Radiant, and the same options always write the same files. CI runs `pnpm bench --check` on 3,000 synthetic modules.

The agent benchmark lives in [bench/agents](bench/agents/README.md), and its results in [docs/benchmark.md](docs/benchmark.md).

## Releases

[RELEASE_POLICY.md](RELEASE_POLICY.md) covers versions, the public contract and support. [AGENTS.md](AGENTS.md#releases) lists the release steps.
