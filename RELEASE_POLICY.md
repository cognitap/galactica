# Galactica release policy

Galactica releases on its own schedule, independent of the repositories it maps.

## Versions

Releases follow [SemVer](https://semver.org/). `0.x` releases are experimental
and publish under `latest`; say so in the README and release notes. `1.0.0`
follows once the command output, the config and the skill are stable.

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

Every published version gets a changelog entry with one line per user-visible
change. Mark breaking changes and show a short before and after.
From `1.0.0`, deprecate in a minor before removing in a major; during `0.x`,
direct removal is allowed.

## Release workflow

Releases use native pnpm versioning and reviewed changelog notes. In a pull
request, run `pnpm version patch --no-git-tag-version` (or `minor`, following
the rules above), move the applicable Unreleased notes under a `## <version>`
heading in `CHANGELOG.md` and commit both. The first release is `0.1.0`.

From a clean checkout, `pnpm release:prepare` checks the version and notes,
builds and packs once, runs `scripts/pack-and-test.ts` against that archive and
dry-runs its publication. It writes `release/galactica.tgz` and a
`release.json` receipt recording the version, source commit and SHA-512
integrity. Source checks are left to CI, which must pass before merging to
`main`.

Only experimental `0.x` versions are accepted. Enabling `1.0.0` requires a
reviewed change to the release script once the command output, the config and
the skill are stable.

The manual **Release Galactica** workflow prepares and uploads a candidate. With
`publish` selected on `main`, a separate job holding npm OIDC permission
publishes that same archive and checks that npm's integrity matches the
receipt. Preparation refuses to publish while the manifest is `private`.

### First publication

Trusted publishing is configured in the settings of a package that already
exists on npm, so the first version is published by hand:

1. Confirm the npm account can publish to the `@cognitap` scope and recheck the
   MIT notice.
2. Run **Release Galactica** on `main` without `publish`, and download its
   `galactica-<commit>-<attempt>` artifact.
3. Check that the archive matches the receipt:
   `echo "sha512-$(openssl dgst -sha512 -binary galactica.tgz | openssl base64 -A)"`
   prints the receipt's `integrity`.
4. Publish that archive: `npm publish galactica.tgz --access public`.
5. Check that `pnpm view @cognitap/galactica@<version> dist.integrity` matches
   the receipt.

When the next release is ready, add an npm trusted publisher for repository
`cognitap/galactica`, workflow `release.yml` and environment `npm`, restrict that
GitHub environment to `main`, and publish through it within two days, before the
unused configuration expires. Published versions cannot be republished to test
the setup. Later releases publish from the workflow with provenance and no
stored token; the first publication by hand has no CI provenance.

### Failed publication and fixes

Fix the cause and rerun the failed publish job; it reuses the original
candidate. The job checks npm before uploading, skips an existing version
only when its integrity matches, and retries verification while npm propagates
the release. A different integrity fails immediately. Never regenerate a candidate or change
its source to retry. If the publishing workflow itself needs a fix, dispatch it
on `main` with `publish` and `candidate_run_id` set to the original run ID; it
skips preparation and publishes that run's existing artifact. To verify manually:

```sh
pnpm view @cognitap/galactica@<version> dist.integrity
```

If it matches the receipt, the release succeeded; if it differs, stop and
investigate. Published versions are immutable, so fixes ship as a new version
with new notes.
