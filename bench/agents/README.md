# Agent benchmark

Measures whether the Galactica skill makes a coding agent more accurate or cheaper on real repositories. The results and what they mean are in [docs/benchmark.md](../../docs/benchmark.md).

## Run it

You need Node.js, git, network access to GitHub and a logged-in [Claude Code](https://code.claude.com) `claude` command. Each run costs money. The runner stops starting runs once the next one could take the spend past `--budget-usd`.

```sh
pnpm bench:agents -- --models sonnet,opus --reps 3 --budget-usd 25
```

| Option              | Default                       | Effect                                                        |
| ------------------- | ----------------------------- | ------------------------------------------------------------- |
| `--models`          | `sonnet,opus`                 | Claude Code model aliases to run.                             |
| `--reps`            | `3`                           | Runs of each task, model and condition.                       |
| `--budget-usd`      | `25`                          | Total spend after which no run starts.                        |
| `--run-budget-usd`  | `2`                           | `--max-budget-usd` of each run.                               |
| `--tasks`           | every task                    | Comma-separated task ids from `tasks.ts`.                     |
| `--conditions`      | `without,skill,instructed`    | Conditions to run.                                            |
| `--concurrency`     | `4`                           | Runs at once.                                                 |
| `--timeout-minutes` | `20`                          | Wall time after which a run is stopped.                       |
| `--work`            | `<tmp>/galactica-agent-bench` | Clones of the target repositories and one checkout per run.   |
| `--out`             | `<work>/results-<date>`       | Results. Rerunning with the same `--out` skips finished runs. |

The output folder holds `runs.jsonl`, one graded run per line, `results.json` and `summary.md` with the tables, and `logs/` with each run's Claude Code transcript and the diff it left. `node bench/agents/summary.ts <results.json>` prints the summary again.

## What one run does

1. Clones each target repository once into `--work`, shallow, at the commit `tasks.ts` pins.
2. Adds a git worktree of that commit for the run.
3. Installs the skill for the `skill` and `instructed` conditions with `galactica init --command "node <this repository>/dist/bin.js"`, so the agent runs the build of this checkout. `instructed` also writes the short instruction of `tasks.ts` to `CLAUDE.md`.
4. Runs `claude -p <task prompt>` in the worktree with fixed flags: `--setting-sources project --strict-mcp-config --no-session-persistence`, the tools `Read, Grep, Glob, Bash, Skill`, plus `Edit, Write` for the tasks that edit, and Bash allowed only for the Galactica command, `ls`, `cat`, `grep`, `rg`, `find`, `head`, `tail`, `wc`, `sed -n` and read-only git commands. Any other command is denied, so the agent cannot install dependencies or run the repository's tests.
5. Grades the answer and the worktree, then removes the worktree and the Galactica cache it made.

## Conditions

- `without`: the repository as cloned.
- `skill`: the skill installed by `galactica init`.
- `instructed`: the skill, and a `CLAUDE.md` that tells the agent to use it.

## Tasks and grading

`tasks.ts` holds each task's prompt and its ground truth. The ground truth was established by reading the code at the pinned commit with rg, not from Galactica's output.

- **Impact** (`nest-impact`): the answer ends with `FILES:` and `TESTS:` lists. Accuracy is the share of the required paths listed.
- **Rename** (`hono-rename`, `nest-rename`): the grader parses every source file of the worktree with the TypeScript parser and counts identifiers, so comments and strings don't count. A file is correct when it holds no identifier with the old name and as many with the new name as it held of the old one. Accuracy is the share of correct files. A file that no longer parses is not correct. The summary also counts renames that changed any other file.
- **Edit and name the tests** (`hono-tests`, `vite-tests`, `nest-tests`): the agent edits one file and ends with a `TESTS:` list. The run scores 0 unless that file changed and still parses. Otherwise accuracy is the share of the required tests listed. Tests beyond the required ones cost nothing, so the summary also gives how many tests each answer named.

Nothing from a target repository runs. The issue this harness answers asked for an edit followed by running the tests. Running them would mean installing each repository's dependencies and executing its code, so the agent names the tests instead, and the grader checks the edit statically.

## Adding a task

Add an entry to `tasks` in `tasks.ts`. Establish the required paths by reading the code with rg, and check them: every required path must exist at the pinned commit. To add a repository, pin a commit in `repositories`.
