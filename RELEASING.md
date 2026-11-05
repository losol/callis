# Releasing Callis

For the owner. Agents never publish ([AGENTS.md](AGENTS.md#hard-rules)). How releases work in general is in [CONTRIBUTING.md](CONTRIBUTING.md#releases).

| Release | How | Provenance |
| --- | --- | --- |
| The first release (0.1.0), and the first version of each later public package | By hand, from a reviewed commit on `main` ([1](#1-the-version-pr-for-the-first-release)–[3](#3-check-and-tag)) | No |
| Every later release | The Release workflow ([4](#4-switch-to-the-workflow), [5](#5-every-later-release)) | Yes |

The first version is published by hand because npm only configures a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for a package that exists.

## 1. The version PR for the first release

While `RELEASE_ENABLED` is unset, the workflow does nothing, so make the version PR yourself. Publish only what was reviewed and merged.

```sh
git switch -c version-packages origin/main
pnpm install --frozen-lockfile
pnpm changeset status       # the packages and bumps
pnpm changeset:version      # bumps the versions, writes each CHANGELOG.md, deletes the changesets
git add -A
git commit -m "chore: version packages"
git push -u origin version-packages
gh pr create --title "chore: version packages" --body "Task: T0025"
```

Review the PR like any other:

- Every bumped `package.json` has the version you expect, for example `0.1.0`. A `major` changeset would make it 1.0.0.
- Every `CHANGELOG.md` entry reads well for users.

Squash-merge it once CI passes, and note the merge commit.

## 2. Publish by hand

Sign in to npm with an account that owns the `@callis` scope and has 2FA (`npm login`, then `npm whoami`). Then work in a clean clone of the merge commit:

```sh
git clone https://github.com/losol/callis.git callis-release
cd callis-release
git log -1 --format='%H %s'     # the "chore: version packages" merge commit
pnpm install --frozen-lockfile
pnpm build
pnpm check:packages             # publint, attw, zero dependencies, size budgets
pnpm exec changeset publish-plan
```

`publish-plan` lists exactly the packages and versions that are not on npm yet. Publish each of them, `@callis/core` first:

```sh
cd packages/core
pnpm publish --dry-run          # check the files: README.md, LICENSE, dist/, package.json
pnpm publish --access public --otp <code>
```

- Use `pnpm publish`, not `npm publish`. pnpm adds the root `LICENSE` to the tarball and replaces `workspace:` ranges with real versions.
- If `main` has moved on since the merge, check out the merge commit (`git checkout <sha>`), and add `--no-git-checks`, because pnpm otherwise refuses to publish from a detached HEAD.
- This version has **no provenance**. Only the workflow can add it.

## 3. Check and tag

```sh
npm view @callis/core@0.1.0 version dist-tags
pnpm exec changeset publish-plan     # in callis-release: nothing left to publish

# A fresh project can install and import it.
mkdir /tmp/callis-smoke && cd /tmp/callis-smoke
npm init -y && npm install @callis/core@0.1.0
node --input-type=module -e "import * as callis from '@callis/core'; console.log(Object.keys(callis))"
```

Check that the npm page shows the README. Then, back in `callis-release`, tag the merge commit and create a GitHub release, as the workflow does for later releases:

```sh
git tag "@callis/core@0.1.0"
git push origin "@callis/core@0.1.0"
gh release create "@callis/core@0.1.0" --verify-tag --title "@callis/core@0.1.0" --notes "<the 0.1.0 section of packages/core/CHANGELOG.md>"
```

Do the same for every other package you published.

## 4. Switch to the workflow

Once, after the first release, in this order:

1. **Create the `npm` environment**, with `main` as its only deployment branch. Do this before step 2: a workflow that names an environment that does not exist creates it without any branch rule.

   ```sh
   gh api -X PUT repos/losol/callis/environments/npm --input - <<'JSON'
   { "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
   JSON
   gh api -X POST repos/losol/callis/environments/npm/deployment-branch-policies -f name=main -f type=branch
   ```

2. **Turn releases on:** `gh variable set RELEASE_ENABLED --body true`. From then on the workflow keeps a version PR open while changesets are pending. A run with nothing pending publishes nothing, because every version is already on npm.
3. **The trusted publisher comes later,** right before you merge the first version PR from the workflow ([5](#5-every-later-release), step 3). A new trusted publisher expires if no publish succeeds within two days.

## 5. Every later release

1. PRs add changesets as usual. While changesets are pending, the workflow opens or updates the PR `chore: version packages`.
2. Review it as in [1](#1-the-version-pr-for-the-first-release).
3. **Check that every package it bumps has a working trusted publisher on npm.** For the first release of a package from the workflow, create one now, so that it publishes within two days. On npmjs.com, open the package settings, then *Trusted publisher*, then *GitHub Actions*:
   - organization or user `losol`, repository `callis`, workflow `release.yml`, environment `npm`
   - **allow direct `npm publish`**. Trusted publishers created after 2026-09-03 only allow `npm stage publish` by default, and Changesets publishes directly.
4. **Close and reopen the PR,** so that CI and the PR-title check run. The workflow's token starts no workflows by itself. Merge the PR once both pass.
5. The Release run on `main` publishes every bumped package, tags it and creates a GitHub release. Check the run in *Actions*, then check the provenance: `npm view @callis/core@<version> dist.attestations` names a SLSA provenance, and the npm page shows a provenance badge.
6. After a package's first publish from the workflow, set npm package settings → *Publishing access* → *Require two-factor authentication and disallow tokens*.

## 6. A new public package

This covers `@callis/fhir-r4`, `@callis/fhir-r5` and `@callis/ucum` (only after T0007's license check, [ADR-0007](docs/adr/0007-ucum-split.md)), and any later package. Its first version is published by hand too:

- **In the first release:** publish it in [2](#2-publish-by-hand), after `@callis/core`, and tag it in [3](#3-check-and-tag).
- **After the switch to the workflow:**
  1. The PR that adds the package also adds a changeset for it. Otherwise the next run with nothing pending tries to publish its `0.0.0` and fails.
  2. Before you merge the version PR that first releases it, pause releases: `gh variable set RELEASE_ENABLED --body false`.
  3. Merge the version PR. Publish, check and tag only the new package by hand ([2](#2-publish-by-hand), [3](#3-check-and-tag)).
  4. Turn releases back on (`gh variable set RELEASE_ENABLED --body true`) and start the workflow (`gh workflow run release.yml --ref main`). It publishes the other packages in that version PR, with provenance.
  5. The package gets its trusted publisher before its second release ([5](#5-every-later-release), step 3).

## When something goes wrong

- **Pause releases** with `gh variable set RELEASE_ENABLED --body false`. The workflow is then skipped: nothing is versioned or published.
- **A publish fails with an authentication error** (E401, E403, E404 or ENEEDAUTH). Check the trusted publisher: it may be missing, expired, stage-only, or have a field that does not match. The workflow name is case-sensitive. Fix it on npm, then re-run the failed job, or run `gh workflow run release.yml --ref main`.
- **A published version is final.** npm never accepts the same version again, even after an unpublish, so fix a bad release with a new patch release.
