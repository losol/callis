# Releasing Callis

For the owner. Agents never publish or change anything on npm ([AGENTS.md](AGENTS.md#hard-rules)). How releases work in general is in [CONTRIBUTING.md](CONTRIBUTING.md#releases).

## Release tracking

Release scope is the owner-selected GitHub milestone, independent of roadmap waves. The authority and assignment rules live in [CONTRIBUTING](CONTRIBUTING.md#release-scope-and-tracking); use its one-tracker-per-milestone policy rather than a second release ledger. Confirm the milestone's task/PR scope and tracking issue when preparing the version PR, and preserve unselected work and manual assignments.

After the owner-authorized workflow publishes, record the actual version-PR/release commit, package release links, registry versions/provenance and fresh installed-consumer verification in the release tracker. Only then close the tracker and milestone. Merged preparation, simulated tarballs and CI/native approval alone are not published verification. Remaining policy or product follow-ups keep their own states and do not silently enter the next milestone. Future release scope and 1.0 criteria remain owner decisions.

The first five-package `0.1.0` release was published from `b92db53135f9556471d9689b5315c73a10f264ea` on 2026-11-07 CET (2026-11-06 23:38–23:39 UTC). Its [closed historical milestone](https://github.com/losol/callis/milestone/1), [release tracker #115](https://github.com/losol/callis/issues/115) and [package Releases](https://github.com/losol/callis/releases) hold the history. The first-release preparation sections below record the path used; they do not announce a pending or new publication.

| What | How | Provenance |
| --- | --- | --- |
| A placeholder `0.0.1` of each package, which only reserves the name | By hand, from an empty directory, and deprecated at once ([1](#1-reserve-the-name-with-a-placeholder)) | No, and it contains no code |
| Every real release, from 0.1.0 on | The Release workflow, when the owner merges the version PR ([2](#2-the-version-pr), [3](#3-every-release)) | Yes |
| Prereleases, such as `0.1.0-next.0`, under the npm dist-tag `next` | The same, while Changesets is in prerelease mode ([5](#5-prereleases)) | Yes |

npm only configures a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for a package that exists. The placeholder makes the package exist, so that 0.1.0 can already come from the workflow, with provenance.

## Release scope and readiness

The first stable 0.1 release supports the implemented subset, not all of phase 1. [T0025](docs/tasks/T0025-public-api-release.md) supplies the small public API, [T0036](docs/tasks/T0036-playground.md) the playground and [T0037](docs/tasks/T0037-first-release-readiness.md) the release preparation. Later 0.x releases extend support and update limitations, executable examples and per-phase R4/R5 conformance. [T0038](docs/tasks/T0038-public-api-completion.md) completes the phase-1 API later. The 1.0 scope and criteria remain open.

Before any version PR is merged, review its actual package/version inventory, peer dependencies, pending changesets and prerelease state. All packages the workflow would publish must meet their documented support, license and smoke-test requirements; publishing generated model data does not claim model-aware evaluation is ready. If an included package is unready, resolve the staging decision with the owner first. The existing workflow is not a selective core-only release gate. Do not delete changesets to exclude packages.

The [first-0.1 inventory and owner checklist](docs/releases/0.1.0.md) is the preparation record of the first release: the source and registry state, the settings and the external gates as they were observed before it was published.

These are release-preparation requirements, not authorization for an agent to publish, merge a version PR or change settings. Use the current files as evidence: all five packages in `packages/` have been released, so the `0.0.0` and `0.0.1` examples below describe the setup of a new package, not the current state.

## Five-package first release

The owner selected R6 for the first stable 0.1 release on 2026-11-06. The [inventory](docs/releases/0.1.0.md) was `@callis/core`, `@callis/ucum`, `@callis/fhir-r4`, `@callis/fhir-r5` and `@callis/fhir-r6`, all `0.1.0`, with four companion peers `^0.1.0`. R6 supplies published `6.0.0-snapshot1` draft metadata, not final-R6 validation or a public model-aware evaluator option.

[T0039](docs/tasks/T0039-fhir-r6-model.md) supplied the provider, and [T0040](docs/tasks/T0040-fhir-r6-validation.md) made the default and stable release-consumer checks cover all five packages. The workflow then regenerated the version PR, [#93](https://github.com/losol/callis/pull/93). After the owner merged it, the workflow published all five packages as `0.1.0` ([Release tracking](#release-tracking)).

What that release relied on still holds: the workflow discovers every unpublished workspace package, a source `0.0.0` with a `minor` changeset becomes `0.1.0`, and one with only `patch` changesets becomes `0.0.1`, which the placeholder already holds ([1](#1-reserve-the-name-with-a-placeholder), [4](#4-a-new-public-package)). To keep a package out of a release, do not remove changesets, mark it private or add conditional release exclusions; resolve it with the owner first ([Release scope and readiness](#release-scope-and-readiness)).

## 1. Reserve the name with a placeholder

Do this once per package, any time before the version PR that first releases the package is merged. Sign in to npm with an account that owns the `@callis` scope and has 2FA (`npm login`, then `npm whoami`).

The placeholder is built in an empty temporary directory from a minimal `package.json`. The real package, its build and Changesets are not involved.

```sh
PKG=@callis/core                 # the package to reserve
PKG_DIR=packages/core            # its directory in the repository
CALLIS=~/path/to/callis          # a checkout of this repository, for the LICENSE

cd "$(mktemp -d)"
cat > package.json <<JSON
{
  "name": "$PKG",
  "version": "0.0.1",
  "description": "Placeholder that reserves the name. Use $PKG 0.1.0 or later.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/losol/callis.git",
    "directory": "$PKG_DIR"
  },
  "homepage": "https://github.com/losol/callis#readme"
}
JSON
cat > README.md <<MD
# $PKG

Placeholder, use >=0.1.0.

This version contains no code. It only reserves the name, so that every real release, from 0.1.0 on, is published from GitHub Actions with provenance. Callis is a FHIRPath engine for TypeScript: <https://github.com/losol/callis>.
MD
cp "$CALLIS/LICENSE" .

npm publish --dry-run            # the tarball holds exactly package.json, README.md and LICENSE
npm publish --access public --otp <code>
npm deprecate "$PKG@0.0.1" "Placeholder without code. Use $PKG 0.1.0 or later." --otp <code>
```

Check the result:

```sh
npm view "$PKG" versions dist-tags     # [ '0.0.1' ] and { latest: '0.0.1' }
npm view "$PKG@0.0.1" deprecated       # the deprecation message
```

If `npm view` returns 404 after a successful publish, check how the package was published. A scoped package published without `--access public` is restricted (private): it is hidden from anonymous `npm view`, and npm adds no provenance to it. `npm access get status "$PKG"` shows how it is published, and `npm access set status=public "$PKG" --otp <code>` makes it public. A new package can also take a few minutes to show up.

**Dist-tags.** The first publish makes 0.0.1 `latest`. Until 0.1.0 is out, `npm install @callis/core` therefore installs the placeholder, with a deprecation warning, and there is nothing to import. The workflow publishes 0.1.0 under `latest` (the Changesets default), which replaces it. 0.0.1 stays deprecated.

- **Never unpublish the placeholder.** npm never accepts a version number twice, and unpublishing a package's last version blocks the name for 24 hours.
- **The first real version must be 0.1.0, not 0.0.1.** A new package starts at 0.0.0 until its first version PR; an existing prerelease package follows section 5. A `minor` changeset takes 0.0.0 to 0.1.0. A package with only `patch` changesets would become 0.0.1, which the placeholder already holds. That does **not** fail: `changeset publish` skips every version that is already on npm, so the release run succeeds, publishes nothing for that package, and `latest` still points to the empty placeholder. Catch it in the version PR ([3](#3-every-release), step 1).

## 2. The version PR

Once the Release workflow is on `main`, every push to `main` with pending changesets opens or updates the PR `chore: version packages`. It stays open until the owner releases.

> **Merge the version PR only to release.** Merging it publishes every package it lists to npm, and npm never takes a version back. In prerelease mode ([5](#5-prereleases)) it publishes prereleases under `next` instead, which is how to try out a release first.

Safeguards that make an accidental release unlikely:

- **The PR is a draft,** and every update turns it back into one. A draft cannot be merged, so releasing takes a deliberate *Ready for review* first.
- **Its body lists each package with the version it will publish,** for example `@callis/core@0.1.0`, followed by its changelog entry.
- **It gets no CI by itself,** because the workflow's token starts no workflows, and CI must be verified before the owner merges it. It must be closed and reopened to start those checks. Do not assume branch rules enforce them: confirm current repository settings; the [0.1 audit](docs/releases/0.1.0.md#read-only-npm-and-repository-audit) did not observe a required-status-check rule, and [#155](https://github.com/losol/callis/issues/155) tracks adding one.
- **No 1.0.0 before 1.0.** The Release workflow runs `pnpm check:changesets` in a job of its own, with read access only, before it changes the version PR or publishes. A pending `major` changeset for a package below 1.0.0, or a public package at 1.0.0 or above that no release tag at 1.0.0 or above backs, stops the run. CI runs the same check on the version PR ([3](#3-every-release), step 3).
- **Nothing is published while changesets are pending.** The workflow then only updates the version PR, and only merging it consumes the changesets. Never delete pending changesets by hand: with nothing pending, the next push to `main` would publish what is on `main`, for example `@callis/core@0.0.0`. `pnpm exec changeset publish-plan` shows what that would be.

Give the `npm` environment `main` as its only deployment branch, once ([Repository settings](CONTRIBUTING.md#repository-settings); [#155](https://github.com/losol/callis/issues/155) tracks it):

```sh
gh api -X PUT repos/losol/callis/environments/npm --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST repos/losol/callis/environments/npm/deployment-branch-policies -f name=main -f type=branch
```

## 3. Every release

This covers 0.1.0 and every release after it.

1. **Review the version PR** like any other. Every bumped `package.json` has the version you expect: 0.1.0 for a package's first release (or `0.1.0-next.N` in prerelease mode), never 0.0.1 (the placeholder's), and never 1.0.0 before 1.0 (CI and the Release workflow fail on it too, through `pnpm check:changesets`). Every `CHANGELOG.md` entry reads well for users.
2. **Check that every package it bumps has a working trusted publisher on npm.** For a package's first release from the workflow, which is 0.1.0 for the first packages, create one now. A new trusted publisher expires if no publish succeeds within two days. On npmjs.com, open the package settings, then *Trusted publisher*, then *GitHub Actions*:
   - organization or user `losol`, repository `callis`, workflow `release.yml`, environment `npm`
   - **allow direct `npm publish`**. Trusted publishers created after 2026-09-03 only allow `npm stage publish` by default, and Changesets publishes directly.
   - If you created a trusted publisher earlier, check that it is still valid. One that has not published within two days of its creation has expired and cannot be used or edited. Delete it and create it again.
3. **Mark the PR ready for review, then close and reopen it,** so that CI and the PR-title check run. The workflow's token starts no workflows by itself. Merge the PR once both pass. If `main` gets a push in the meantime, the workflow updates the PR and turns it back into a draft: start this step again.
4. **The Release run on `main`** publishes every bumped package with provenance, tags it (for example `@callis/core@0.1.0`) and creates a GitHub release. Check the run in *Actions*.
5. **Check the result:**

   ```sh
   npm view @callis/core dist-tags                    # latest is the new version
   npm view @callis/core@0.1.0 dist.attestations      # names a SLSA provenance

   # A fresh project can install and import it.
   cd "$(mktemp -d)"
   npm init -y && npm install @callis/core@0.1.0
   node --input-type=module -e "import * as callis from '@callis/core'; console.log(Object.keys(callis))"
   ```

   The npm page shows the README and a provenance badge.
6. **After a package's first publish from the workflow,** set npm package settings → *Publishing access* → *Require two-factor authentication and disallow tokens*.

## 4. A new public package

This covers any package that is not on npm yet. It gets the same placeholder, so that its first real version also comes from the workflow:

1. **The PR that adds the package also adds a `minor` changeset for it.** Its first version is then 0.1.0. Without a pending changeset, a run with nothing else pending would try to publish its `0.0.0`.
2. **Reserve the name** ([1](#1-reserve-the-name-with-a-placeholder)) with its `PKG` and `PKG_DIR`, for example `@callis/fhir-r4` and `packages/fhir-r4`, before its first version PR is merged.
3. **Create its trusted publisher** right before you merge that version PR ([3](#3-every-release), step 2), and release as usual.

## 5. Prereleases

While `.changeset/pre.json` exists with `"mode": "pre"`, Changesets is in prerelease mode, with the tag in that file (`next`):

- The version PR is titled `chore: version packages (next)`, and its versions are prereleases: first `0.1.0-next.0`, then `0.1.0-next.1`, and so on.
- Merging it publishes them under the npm dist-tag `next`. `latest` does not move: `npm install @callis/core` still gets the last stable version, and `npm install @callis/core@next` gets the prerelease. The GitHub release is marked as a prerelease.
- Changesets moves the changesets it has used into `.changeset/pre/` instead of deleting them, so the stable release still lists them.
- A prerelease is published like any release, with provenance. Its first publish also validates the trusted publisher, which then no longer expires.

Release as in [3](#3-every-release), but check `next` instead of `latest`:

```sh
npm view @callis/core dist-tags                         # next is the new prerelease; latest has not moved
npm view @callis/core@0.1.0-next.0 dist.attestations    # names a SLSA provenance
```

**To end prereleases,** run `pnpm changeset pre exit` in a PR and merge it. The next version PR, `chore: version packages`, then releases the stable versions under `latest`, and its changelog entry lists every change from the prereleases. The `next` tag still points to the last prerelease after that. Move it with `npm dist-tag add @callis/core@<version> next --otp <code>`, or remove it with `npm dist-tag rm @callis/core next --otp <code>`.

## When something goes wrong

- **Pause releases** with `gh workflow disable release.yml`, and resume them with `gh workflow enable release.yml`. While the workflow is disabled, the version PR is not updated and nothing is published.
- **A publish fails with an authentication error** (E401, E403, E404 or ENEEDAUTH). Check the trusted publisher: it may be missing, expired, stage-only, or have a field that does not match. The workflow name is case-sensitive. Fix it on npm, then re-run the failed job, or run `gh workflow run release.yml --ref main`.
- **The Release run fails at *Check versions*.** `main` has a pending `major` changeset for a package below 1.0.0, a public package at 1.0.0 or above, or a changeset that Changesets cannot read or that names an unknown package; the job log names the file. Nothing was changed or published. Fix it in a PR, for example by changing a `major` changeset to `minor`. If a version PR with 1.0.0 was merged, first revert its commit in that PR, which brings its changesets back. Every run on `main` stops until the fix is merged.
- **A version that is already on npm is skipped, not failed.** `changeset publish` only publishes versions that npm does not have yet, so such a run still succeeds. After every release, check that `npm view <package> dist-tags` shows the new version ([3](#3-every-release), step 5). npm never accepts the same version twice, even after an unpublish: add a changeset that bumps past it. This is also how to fix a bad release.
