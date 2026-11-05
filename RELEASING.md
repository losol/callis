# Releasing Callis

For the owner. Agents never publish or change anything on npm ([AGENTS.md](AGENTS.md#hard-rules)). How releases work in general is in [CONTRIBUTING.md](CONTRIBUTING.md#releases).

| What | How | Provenance |
| --- | --- | --- |
| A placeholder `0.0.1` of each package, which only reserves the name | By hand, from an empty directory, and deprecated at once ([1](#1-reserve-the-name-with-a-placeholder)) | No, and it contains no code |
| Every real release, from 0.1.0 on | The Release workflow, through the version PR ([2](#2-turn-on-the-workflow), [3](#3-every-release)) | Yes |

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

**Dist-tags.** The first publish makes 0.0.1 `latest`. Until 0.1.0 is out, `npm install @callis/core` therefore installs the placeholder, with a deprecation warning, and there is nothing to import. The workflow publishes 0.1.0 under `latest` (the Changesets default), which replaces it. 0.0.1 stays deprecated.

- **Never unpublish the placeholder.** npm never accepts a version number twice, and unpublishing a package's last version blocks the name for 24 hours.
- **The first real version must be 0.1.0, not 0.0.1.** The packages in the repository stay at 0.0.0 until their first version PR. A `minor` changeset takes 0.0.0 to 0.1.0. A package with only `patch` changesets would become 0.0.1, which the placeholder already holds, and its publish would fail.

## 2. Turn on the workflow

Once, when 0.1.0 is ready, in this order:

1. **Create the `npm` environment**, with `main` as its only deployment branch. Do this before step 3: a workflow that names an environment that does not exist creates it without any branch rule.

   ```sh
   gh api -X PUT repos/losol/callis/environments/npm --input - <<'JSON'
   { "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
   JSON
   gh api -X POST repos/losol/callis/environments/npm/deployment-branch-policies -f name=main -f type=branch
   ```

2. **Check that changesets are pending** on `main`: `pnpm changeset status` lists the bumps, and every package goes to 0.1.0. With changesets pending, the workflow's first run opens the version PR. With nothing pending it would publish what is on `main`, for example `@callis/core@0.0.0`, as `pnpm exec changeset publish-plan` shows. So never turn releases on while nothing is pending.
3. **Turn releases on:** `gh variable set RELEASE_ENABLED --body true`. The next push to `main` opens the PR `chore: version packages`. To open it right away, run `gh workflow run release.yml --ref main`.

## 3. Every release

This covers 0.1.0 and every release after it.

1. **Review the version PR** like any other. Every bumped `package.json` has the version you expect: 0.1.0 for a package's first release, and never 1.0.0 before 1.0. Every `CHANGELOG.md` entry reads well for users.
2. **Check that every package it bumps has a working trusted publisher on npm.** For a package's first release from the workflow, which is 0.1.0 for the first packages, create one now. A new trusted publisher expires if no publish succeeds within two days. On npmjs.com, open the package settings, then *Trusted publisher*, then *GitHub Actions*:
   - organization or user `losol`, repository `callis`, workflow `release.yml`, environment `npm`
   - **allow direct `npm publish`**. Trusted publishers created after 2026-09-03 only allow `npm stage publish` by default, and Changesets publishes directly.
3. **Close and reopen the PR,** so that CI and the PR-title check run. The workflow's token starts no workflows by itself. Merge the PR once both pass.
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

1. **The PR that adds the package also adds a `minor` changeset for it.** Its first version is then 0.1.0. Without a pending changeset, a run with nothing else pending would try to publish its `0.0.0`.
2. **Reserve the name** ([1](#1-reserve-the-name-with-a-placeholder)) with its `PKG` and `PKG_DIR`, for example `@callis/fhir-r4` and `packages/fhir-r4`, before its first version PR is merged.
3. **Create its trusted publisher** right before you merge that version PR ([3](#3-every-release), step 2), and release as usual.

For the first release, do steps 2 and 3 for every package that 0.1.0 includes.

## When something goes wrong

- **Pause releases** with `gh variable set RELEASE_ENABLED --body false`. The workflow is then skipped: nothing is versioned or published.
- **A publish fails with an authentication error** (E401, E403, E404 or ENEEDAUTH). Check the trusted publisher: it may be missing, expired, stage-only, or have a field that does not match. The workflow name is case-sensitive. Fix it on npm, then re-run the failed job, or run `gh workflow run release.yml --ref main`.
- **A publish fails because the version exists.** npm never accepts the same version twice, even after an unpublish. Add a changeset that bumps past it; this is also how to fix a bad release.
