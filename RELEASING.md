# Releasing Callis

For the owner. Agents never publish or change anything on npm ([AGENTS.md](AGENTS.md#hard-rules)). How releases work in general is in [CONTRIBUTING.md](CONTRIBUTING.md#releases).

| What | How | Provenance |
| --- | --- | --- |
| A placeholder `0.0.1` of each package, which only reserves the name | By hand, from an empty directory, and deprecated at once ([1](#1-reserve-the-name-with-a-placeholder)) | No, and it contains no code |
| Every real release, from 0.1.0 on | The Release workflow, when the owner merges the version PR ([2](#2-the-version-pr), [3](#3-every-release)) | Yes |

npm only configures a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for a package that exists. The placeholder makes the package exist, so that 0.1.0 can already come from the workflow, with provenance.

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
- **The first real version must be 0.1.0, not 0.0.1.** The packages in the repository stay at 0.0.0 until their first version PR. A `minor` changeset takes 0.0.0 to 0.1.0. A package with only `patch` changesets would become 0.0.1, which the placeholder already holds. The [release guard](#2-the-version-pr) then fails the release run. Without the guard, `changeset publish` would skip the version silently, because npm already has it. Catch it in the version PR ([3](#3-every-release), step 1).

## 2. The version PR

Once the Release workflow is on `main`, every push to `main` with pending changesets opens or updates the PR `chore: version packages`. It stays open until the owner releases.

> **Do not merge the version PR before 0.1.0 is ready.** Merging it publishes every package it lists to npm, and npm never takes a version back.

Safeguards that make an accidental release unlikely:

- **The PR is a draft,** and every update turns it back into one. A draft cannot be merged, so releasing takes a deliberate *Ready for review* first.
- **Its body lists each package with the version it will publish,** for example `@callis/core@0.1.0`, followed by its changelog entry.
- **It gets no CI by itself,** because the workflow's token starts no workflows, and the branch rules require CI. So it must also be closed and reopened before it can be merged.
- **Nothing is published while changesets are pending.** The workflow then only updates the version PR, and only merging it consumes the changesets. Never delete pending changesets by hand: with nothing pending, the next push to `main` starts the publish step.
- **Nothing below 0.1.0 is ever published.** `pnpm release`, the workflow's publish step, starts with the release guard, `pnpm check:release` ([`scripts/check-release-versions.ts`](scripts/check-release-versions.ts)). The guard fails the run before anything is built or published if any public workspace package is below 0.1.0. That includes 0.0.0, the placeholder's 0.0.1, and prereleases of 0.1.0. So even a run with nothing pending cannot publish the `0.0.0` on `main`. Run `pnpm check:release` to see what it says; today it fails on `@callis/core@0.0.0`, as it should.

Once, before the first release, give the `npm` environment `main` as its only deployment branch:

```sh
gh api -X PUT repos/losol/callis/environments/npm --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST repos/losol/callis/environments/npm/deployment-branch-policies -f name=main -f type=branch
```

## 3. Every release

This covers 0.1.0 and every release after it.

1. **Review the version PR** like any other. Every bumped `package.json` has the version you expect: 0.1.0 for a package's first release, never 0.0.1 (the placeholder's), and never 1.0.0 before 1.0. Every `CHANGELOG.md` entry reads well for users.
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

This covers `@callis/fhir-r4`, `@callis/fhir-r5` and `@callis/ucum` (only after T0007's license check, [ADR-0007](docs/adr/0007-ucum-split.md)), and any later package. It gets the same placeholder, so that its first real version also comes from the workflow:

1. **The PR that adds the package also adds a `minor` changeset for it.** Its first version is then 0.1.0. Without one, the release guard fails every publish run on its `0.0.0` until it has one.
2. **Reserve the name** ([1](#1-reserve-the-name-with-a-placeholder)) with its `PKG` and `PKG_DIR`, for example `@callis/fhir-r4` and `packages/fhir-r4`, before its first version PR is merged.
3. **Create its trusted publisher** right before you merge that version PR ([3](#3-every-release), step 2), and release as usual.

For the first release, do steps 2 and 3 for every package that 0.1.0 includes.

## When something goes wrong

- **Pause releases** with `gh workflow disable release.yml`, and resume them with `gh workflow enable release.yml`. While the workflow is disabled, the version PR is not updated and nothing is published.
- **A publish fails with an authentication error** (E401, E403, E404 or ENEEDAUTH). Check the trusted publisher: it may be missing, expired, stage-only, or have a field that does not match. The workflow name is case-sensitive. Fix it on npm, then re-run the failed job, or run `gh workflow run release.yml --ref main`.
- **The release run fails at the release guard** (`::error title=Release guard::…`): a public package is below 0.1.0. Give it a `minor` changeset and release through the version PR.
- **A version that is already on npm is skipped, not failed.** `changeset publish` only publishes versions that npm does not have yet, so such a run still succeeds. After every release, check that `npm view <package> dist-tags` shows the new version ([3](#3-every-release), step 5). npm never accepts the same version twice, even after an unpublish: add a changeset that bumps past it. This is also how to fix a bad release.
