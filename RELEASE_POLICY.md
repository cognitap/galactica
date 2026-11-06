# Galactica release policy

Galactica releases on its own schedule, independent of the repositories it maps.

## Versions

Releases follow [SemVer](https://semver.org/). `1.0.0` follows once the
command output, the config and the skill are stable.

During `0.x`, a breaking change bumps the minor version and anything else bumps
the patch version. From `1.0.0`, use the largest applicable SemVer bump. A fix
that requires users to adapt is breaking, even for security. Published versions
are immutable. Prereleases use a version suffix and their own npm tag, never
`latest`.

## Public contract

The contract covers the commands and their options, their text output, their
`--json` output as `docs/json-output.md` documents it, exit codes,
`galactica.config.json` and its schema, the files `init` writes and the skill's
`npx --prefix / @cognitap/galactica` command. Breaking changes include
incompatible changes to any of these, a higher `schemaVersion`, config that no
longer loads and narrowed Node.js support. The model, the cache and the HTML
page's embedded data are private.

## Support

Only the latest release is maintained: the latest `0.x` before `1.0.0`, then the
current major. There are no backports or response deadlines.

Every published version gets a changelog entry with one short line per change a
user would notice. Mark breaking changes and say what to do about them. Leave out
repository, CI and docs housekeeping.
From `1.0.0`, deprecate in a minor before removing in a major; during `0.x`,
direct removal is allowed.

## Releases

[AGENTS.md](AGENTS.md#releases) lists the release steps. The manual **Release Galactica** workflow builds and packs one candidate. It runs the packed-package test, and on `main` it publishes that same archive through npm trusted publishing with provenance. It also checks that npm's integrity matches the candidate's receipt.

The publish job reads fresh npm package metadata and compares the exact version’s SHA-512 integrity with the candidate receipt. A match completes the job. An absent version allows one upload, followed by verification even if the upload returns an error. A different integrity fails the job.

If verification times out, compare the version on npm with the original receipt before retrying. If the version is still absent, fix the cause and retry with the original candidate. Published versions are immutable, so a fix to a published archive ships as a new version.
