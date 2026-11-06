# Agent benchmark

Does the Galactica skill make a coding agent better at changing a repository than grep alone? This page gives the method, the numbers from the run of 2026-11-06, where Galactica does not help, and how to rerun it. The harness is in [`bench/agents/`](../bench/agents/README.md), and the graded runs are in [`bench/agents/results/2026-11-06/`](../bench/agents/results/2026-11-06/).

## Results

Galactica helped on one kind of task: naming the tests to run after an edit, when some of those tests reach the changed file in a way grep does not follow. There, the skill with the instruction raised accuracy from 47% to 78% with Sonnet and from 82% to 100% with Opus. On the other four tasks every condition scored 100%. There the skill made the impact question cheaper and most other runs dearer. The skill alone, without the instruction, changed little for Sonnet, which loaded it in 4 of 24 runs.

144 runs: 6 tasks, 3 conditions, 2 models, 4 runs each, $20.36 in all.

| Model  | Condition  | Accuracy | Cost per run | Turns (median) | Used Galactica |
| ------ | ---------- | -------- | ------------ | -------------- | -------------- |
| Sonnet | without    | 82%      | $0.082       | 6.5            | 0 of 24        |
| Sonnet | skill      | 82%      | $0.080       | 6              | 4 of 24        |
| Sonnet | instructed | 93%      | $0.088       | 7              | 24 of 24       |
| Opus   | without    | 94%      | $0.180       | 7              | 0 of 24        |
| Opus   | skill      | 99%      | $0.206       | 9              | 19 of 24       |
| Opus   | instructed | 100%     | $0.211       | 8              | 24 of 24       |

Accuracy and cost are means over runs. "Used Galactica" counts runs that loaded the skill or ran a Galactica command. No run ended in an error.

By task, as mean accuracy and cost per run over 4 runs:

| Task          | Model  | without       | skill         | instructed    |
| ------------- | ------ | ------------- | ------------- | ------------- |
| `hono-tests`  | Sonnet | 44% · $0.041  | 58% · $0.041  | 81% · $0.038  |
| `hono-tests`  | Opus   | 65% · $0.115  | 92% · $0.122  | 100% · $0.121 |
| `vite-tests`  | Sonnet | 50% · $0.044  | 33% · $0.053  | 75% · $0.065  |
| `vite-tests`  | Opus   | 100% · $0.136 | 100% · $0.184 | 100% · $0.191 |
| `nest-tests`  | Sonnet | 100% · $0.038 | 100% · $0.036 | 100% · $0.051 |
| `nest-tests`  | Opus   | 100% · $0.104 | 100% · $0.160 | 100% · $0.154 |
| `nest-impact` | Sonnet | 100% · $0.070 | 100% · $0.051 | 100% · $0.044 |
| `nest-impact` | Opus   | 100% · $0.167 | 100% · $0.135 | 100% · $0.142 |
| `hono-rename` | Sonnet | 100% · $0.168 | 100% · $0.168 | 100% · $0.167 |
| `hono-rename` | Opus   | 100% · $0.274 | 100% · $0.312 | 100% · $0.312 |
| `nest-rename` | Sonnet | 100% · $0.131 | 100% · $0.132 | 100% · $0.163 |
| `nest-rename` | Opus   | 100% · $0.285 | 100% · $0.326 | 100% · $0.348 |

[`summary.md`](../bench/agents/results/2026-11-06/summary.md) adds tool calls and the number of tests each answer named. `results.json` holds every graded run.

### Where Galactica helps

- **Tests that import through a package name.** In hono, two adapter packages import the core as `hono/utils/encode`, and their tests reach `decodeBase64` through it. Without the skill, Opus missed all four adapter tests in every run, and its 4 runs scored 58% to 67%. With the instruction it named all 12 required tests in every run. Sonnet's 4 runs went from 25%–58% to 75%–83%, and it still missed the adapters' end-to-end tests in every run.
- **Tests that load code through a dev server.** Vite's playground suites check sourcemaps through a running dev server, so no import leads to them. Galactica does not find them either. The skill tells the agent to grep the test folders for the feature's name. With the instruction, Sonnet named both suites in 2 of 4 runs and one of them in a third, against both in 1 of 4 runs without the skill.
- **Impact questions, on cost.** On `nest-impact`, every condition found all 8 files and 6 tests, but with Galactica the answers took fewer turns and cost 15% to 37% less.

### Where Galactica doesn't help

- **Renames.** Every run renamed every reference correctly, and all 48 changed no other file. The new name is a grep away, and the work is the edits: 27 to 41 turns per run. The skill only added the cost of loading it, up to 22% with Opus.
- **Distinctive names.** In nest, every importer of `cli-colors.util.ts` and of `selectExceptionFilterMetadata` comes through the `@nestjs/common/internal` barrel and a `paths` alias, which grepping the file path misses. The agents grepped the exported names instead and found everything. On `nest-tests`, the skill made Opus cost about 50% more and name a median of 17.5 tests where 5 were needed, since `uses` lists every test that reaches the file.
- **A strong model on a known layout.** Opus found Vite's playground tests in every run without the skill. Galactica added turns and cost 35% to 40% more.
- **The skill alone.** Without the instruction, Sonnet loaded the skill only for the impact question, never before an edit. Opus loaded it in 19 of 24 runs.

### Caveats

- **Sample size.** Four runs per cell. Differences within one task are only as reliable as their ranges, which the bullets above give. The overall accuracy rows average six tasks, four of which scored 100% everywhere, so they say little beyond the two test tasks.
- **Self-graded ground truth.** We wrote the tasks and their ground truth, by reading the code with rg. For the test tasks, the required tests are the static import closure plus the vite playground suites, which is close to what `uses` computes, and so favors a graph tool by construction. A reviewer could call the adapters' end-to-end tests optional. Extra tests are not penalized, so an answer that names every test scores 100%. The tests-named column of the summary shows how far each condition over-listed.
- **Edits are checked statically.** A run passes if the named file changed and parses. Whether each edit is correct was read by hand for a sample of 4, which were.
- **Harness defects.** Three runs were discarded and rerun: two where `pnpm check` rebuilt `dist` while they ran Galactica, and one where the agent's shell found an older Node.js on its `PATH`. The harness now runs Galactica with the absolute path of the Node.js that runs it. Each discarded run is counted in the spend below, not in the tables. 102 commands were denied, spread evenly across conditions, mostly `sed -i`, `perl` and pipes during renames.
- **Version.** Galactica at commit `bf57e21` with the skill of that commit, Claude Code 2.1.318.

### What changed since the earlier runs

An earlier run on 2026-11-06 covered 165 graph lookups on vite and hono for about $8. Plain grep scored 96% to 98%, and Galactica made graph questions 13% to 49% cheaper and no more accurate, except for importers through the package name. Trusting the test list lowered accuracy. Since then, the skill leads with when Galactica helps and tells the agent to grep the test folders for tests the list can miss, `uses` says through which importer each test reaches the file, and private imports resolve. This benchmark adds nest with `paths` aliases, renames and edits, a stricter Bash allowlist with read-only git, and grades the lists that end each answer rather than searching the whole answer. Its tasks are new, so its numbers do not compare one to one with the earlier run.

### Spend

The run of record cost $20.36. A smoke run of 6 tasks cost $0.64, and the 3 discarded runs $0.71: $21.71 in all.

## Method

Each run is one headless Claude Code session (`claude -p`, Claude Code 2.1.318) on a fresh git worktree of a target repository at a pinned commit. The agent gets `Read`, `Grep`, `Glob`, `Bash` and `Skill`, and `Edit` and `Write` for the tasks that edit. Bash may run only the Galactica command, `ls`, `cat`, `grep`, `rg`, `find`, `head`, `tail`, `wc`, `sed -n` and read-only git commands. Settings come from the project only, with no MCP servers.

Three conditions:

- **without**: the repository as cloned.
- **skill**: the skill that `galactica init` installs, nothing else.
- **instructed**: the skill, and a `CLAUDE.md` with one instruction: load the skill and use its commands for any question about where code lives, what depends on a file, which tests to run, or import cycles.

Two models, Claude Code's `sonnet` and `opus` aliases, which resolved to `claude-sonnet-5-5` and `claude-opus-5-5`. Four runs of each task, model and condition: 144 runs.

Three repositories:

| Repository                             | Commit    | Why                                                                                     |
| -------------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| [hono](https://github.com/honojs/hono) | `eb754bd` | Adapter packages import the core through the package name, such as `hono/utils/encode`. |
| [vite](https://github.com/vitejs/vite) | `4835128` | Playground tests reach the server code through a dev server, not through imports.       |
| [nest](https://github.com/nestjs/nest) | `6e83cc8` | tsconfig `paths` aliases (`@nestjs/common/*`) and a barrel, `@nestjs/common/internal`.  |

Six tasks, two of each kind:

| Task          | Kind                    | What the agent does                                                                                    |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `nest-impact` | Impact                  | Lists the source files that use `cli-colors.util.ts`, all through the alias and barrel, and the tests. |
| `hono-rename` | Rename                  | Renames `encodeBase64` to `bytesToBase64` across the core and two adapter packages.                    |
| `nest-rename` | Rename                  | Renames `randomStringGenerator` to `generateRandomId` across five packages.                            |
| `hono-tests`  | Edit and name the tests | Makes `decodeBase64` throw a named error, then names the tests to run.                                 |
| `vite-tests`  | Edit and name the tests | Makes `injectSourcesContent` record unreadable sources as empty strings, then names the tests to run.  |
| `nest-tests`  | Edit and name the tests | Makes `selectExceptionFilterMetadata` prefer the most specific filter, then names the tests to run.    |

### Grading

The ground truth of each task was established at the pinned commit by reading the code and searching it with rg, not from Galactica's output. `bench/agents/tasks.ts` holds it.

- **Impact:** the answer ends with `FILES:` and `TESTS:` lists. Accuracy is the share of the 8 required source files and 6 required tests listed.
- **Rename:** the grader parses every source file of the worktree with the TypeScript parser and counts identifiers, so comments and strings don't count. A file is correct when it holds no identifier with the old name, as many with the new name as it held of the old one, and still parses. Accuracy is the share of the files that held the name, 9 in hono and 12 in nest.
- **Edit and name the tests:** the run scores 0 unless the agent changed the named file and it still parses. Otherwise accuracy is the share of the required tests in its `TESTS:` list: the tests that exercise a module calling the changed function, found by following imports with rg (12 in hono, 5 in nest), and in vite the unit test plus the two playground suites that check sourcemap content.

The issue asked for an edit followed by running the tests. Nothing here runs: running a target repository's tests means installing its dependencies and executing its code. So the agent names the tests instead, and the grader checks the edit statically. Whether each edit is correct beyond parsing was read by hand for a sample, not graded.

## How to rerun

You need Node.js, git, network access to GitHub and a logged-in `claude`. From a checkout of Galactica:

```sh
pnpm install
pnpm bench:agents -- --models sonnet,opus --reps 4 --budget-usd 25
```

The command builds Galactica, clones the three repositories at their pinned commits into a temporary folder, runs every task under every condition, and writes `results.json`, `summary.md` and each run's transcript and diff. It stops starting runs when the next one could take the spend past `--budget-usd`, and rerunning it with the same `--out` folder runs only what is missing. [`bench/agents/README.md`](../bench/agents/README.md) lists every option and says how to add a task.
